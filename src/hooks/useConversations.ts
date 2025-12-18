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

    // Create new conversation
    const { data: newConvo, error: convoError } = await supabase
      .from('conversations')
      .insert({ is_group: false })
      .select()
      .single();

    if (convoError || !newConvo) return null;

    // Add both users as members
    await supabase
      .from('conversation_members')
      .insert([
        { conversation_id: newConvo.id, user_id: userId },
        { conversation_id: newConvo.id, user_id: friendId }
      ]);

    fetchConversations();
    return newConvo.id;
  };

  return { conversations, loading, createConversation, refetch: fetchConversations };
}