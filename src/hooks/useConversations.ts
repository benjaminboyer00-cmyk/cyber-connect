import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Conversation = Tables<'conversations'>;
type Profile = Tables<'profiles'>;
type Message = Tables<'messages'>;

export interface ConversationWithDetails extends Conversation {
  members: Profile[];
  lastMessage: Message | null;
  unreadCount: number;
}

export function useConversations(userId: string | undefined) {
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    if (!userId) return;

    // Get user's conversation memberships
    const { data: memberships, error: memberError } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', userId);

    if (memberError || !memberships?.length) {
      setLoading(false);
      return;
    }

    const conversationIds = memberships.map(m => m.conversation_id);

    // Get conversations
    const { data: convos } = await supabase
      .from('conversations')
      .select('*')
      .in('id', conversationIds);

    // Get all members for these conversations
    const { data: allMembers } = await supabase
      .from('conversation_members')
      .select('conversation_id, user_id')
      .in('conversation_id', conversationIds);

    // Get profiles for all members
    const memberUserIds = [...new Set(allMembers?.map(m => m.user_id) || [])];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .in('id', memberUserIds);

    const profileMap = new Map(profiles?.map(p => [p.id, p]));

    // Get last message and unread count for each conversation
    const conversationsWithDetails: ConversationWithDetails[] = await Promise.all(
      (convos || []).map(async (conv) => {
        const convMembers = allMembers
          ?.filter(m => m.conversation_id === conv.id)
          .map(m => profileMap.get(m.user_id))
          .filter((p): p is Profile => p !== undefined && p.id !== userId) || [];

        // Get last message
        const { data: lastMsg } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        // Get unread count
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', conv.id)
          .eq('is_read', false)
          .neq('sender_id', userId);

        return {
          ...conv,
          members: convMembers,
          lastMessage: lastMsg,
          unreadCount: count || 0
        };
      })
    );

    // Sort by last message time
    conversationsWithDetails.sort((a, b) => {
      const timeA = a.lastMessage?.created_at || a.created_at || '';
      const timeB = b.lastMessage?.created_at || b.created_at || '';
      return timeB.localeCompare(timeA);
    });

    setConversations(conversationsWithDetails);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const createConversation = async (friendId: string): Promise<string | null> => {
    if (!userId) return null;

    // Check if conversation already exists
    const { data: existingMemberships } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', userId);

    if (existingMemberships?.length) {
      for (const membership of existingMemberships) {
        const { data: otherMember } = await supabase
          .from('conversation_members')
          .select('user_id')
          .eq('conversation_id', membership.conversation_id)
          .eq('user_id', friendId)
          .maybeSingle();

        if (otherMember) {
          return membership.conversation_id;
        }
      }
    }

    // Create new conversation using database function
    const { data, error } = await supabase.rpc('create_conversation_with_members', {
      member_ids: [friendId],
      conversation_name: null,
      is_group_chat: false
    });

    if (error) {
      console.error('Error creating conversation:', error);
      return null;
    }

    await fetchConversations();
    return data;
  };

  const createGroupConversation = async (memberIds: string[], name: string): Promise<string | null> => {
    if (!userId || memberIds.length === 0) return null;

    // Create group conversation using database function
    const { data, error } = await supabase.rpc('create_conversation_with_members', {
      member_ids: memberIds,
      conversation_name: name,
      is_group_chat: true
    });

    if (error) {
      console.error('Error creating group:', error);
      return null;
    }

    await fetchConversations();
    return data;
  };

  const deleteConversation = async (conversationId: string): Promise<boolean> => {
    if (!userId) return false;

    // Delete messages first
    await supabase
      .from('messages')
      .delete()
      .eq('conversation_id', conversationId);

    // Delete membership
    const { error: memberError } = await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);

    if (memberError) {
      console.error('Error leaving conversation:', memberError);
      return false;
    }

    // Try to delete the conversation (will work if no other members)
    await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId);

    await fetchConversations();
    return true;
  };

  return { conversations, loading, createConversation, createGroupConversation, deleteConversation, refetch: fetchConversations };
}