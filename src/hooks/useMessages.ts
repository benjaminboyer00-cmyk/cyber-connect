import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Message = Tables<'messages'>;
type Profile = Tables<'profiles'>;

export interface MessageWithSender extends Message {
  sender: Profile | null;
}

export function useMessages(conversationId: string | null, userId: string | undefined) {
  const [messages, setMessages] = useState<MessageWithSender[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMessages = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const { data: messagesData, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching messages:', error);
      setLoading(false);
      return;
    }

    // Get sender profiles
    const senderIds = [...new Set(messagesData?.map(m => m.sender_id).filter(Boolean) as string[])];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .in('id', senderIds);

    const profileMap = new Map(profiles?.map(p => [p.id, p]));

    const messagesWithSenders: MessageWithSender[] = (messagesData || []).map(m => ({
      ...m,
      sender: m.sender_id ? profileMap.get(m.sender_id) || null : null
    }));

    setMessages(messagesWithSenders);
    setLoading(false);

    // Mark messages as read
    if (userId && messagesData?.length) {
      const unreadIds = messagesData
        .filter(m => !m.is_read && m.sender_id !== userId)
        .map(m => m.id);

      if (unreadIds.length) {
        await supabase
          .from('messages')
          .update({ is_read: true })
          .in('id', unreadIds);
      }
    }
  }, [conversationId, userId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Real-time subscription
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        async (payload) => {
          const newMessage = payload.new as Message;
          
          // Get sender profile
          const { data: sender } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', newMessage.sender_id || '')
            .maybeSingle();

          const messageWithSender: MessageWithSender = {
            ...newMessage,
            sender
          };

          setMessages(prev => [...prev, messageWithSender]);

          // Mark as read if not from current user
          if (userId && newMessage.sender_id !== userId) {
            await supabase
              .from('messages')
              .update({ is_read: true })
              .eq('id', newMessage.id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, userId]);

  const sendMessage = async (content: string, imageUrl?: string) => {
    if (!conversationId || !userId) return { error: new Error('Invalid state') };

    const { error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: userId,
        content,
        image_url: imageUrl || null
      });

    return { error };
  };

  return { messages, loading, sendMessage, refetch: fetchMessages };
}