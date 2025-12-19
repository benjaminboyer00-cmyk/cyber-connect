/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Hook de Messages - Architecture Client/Serveur (SAÉ 3.02)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * IMPORTANT: Ce hook a été modifié pour respecter l'architecture Client/Serveur
 * exigée par la SAÉ 3.02.
 * 
 * Flux de données:
 * - AVANT (Interdit): Client -> Supabase directement
 * - APRÈS (Obligatoire): Client -> Serveur Python -> Supabase
 * 
 * Le serveur Python est le point de passage OBLIGATOIRE pour l'envoi de messages.
 * La lecture reste via Supabase Realtime pour des raisons de performance.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SERVER_CONFIG, getEndpointUrl, checkServerHealth } from '@/config/server';
import type { Tables } from '@/integrations/supabase/types';

type Message = Tables<'messages'>;
type Profile = Tables<'profiles'>;

export interface MessageWithSender extends Message {
  sender: Profile | null;
}

export function useMessages(conversationId: string | null, userId: string | undefined) {
  const [messages, setMessages] = useState<MessageWithSender[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);

  // Vérifier si le serveur Python est disponible au montage
  useEffect(() => {
    checkServerHealth().then(setServerAvailable);
  }, []);

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

  // Real-time subscription (lecture reste via Supabase pour performance)
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

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * ENVOI DE MESSAGE - PASSAGE OBLIGATOIRE PAR LE SERVEUR PYTHON
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Cette fonction a été modifiée pour respecter l'architecture SAÉ 3.02:
   * - Le message est envoyé au serveur Python via HTTP/TCP
   * - Le serveur Python chiffre le message (Fernet/AES-128)
   * - Le serveur Python insère dans Supabase avec SERVICE_ROLE_KEY
   * 
   * SI LE SERVEUR PYTHON EST DOWN, L'ENVOI ÉCHOUE (comportement voulu)
   */
  const sendMessage = async (content: string, imageUrl?: string): Promise<{ error: Error | null }> => {
    if (!conversationId || !userId) {
      return { error: new Error('Invalid state: missing conversationId or userId') };
    }

    // Vérification optionnelle - on log mais on ne bloque plus
    const isServerUp = await checkServerHealth();
    if (!isServerUp) {
      console.warn('[sendMessage] ⚠️ Health check échoué, tentative d\'envoi quand même...');
    }

    try {
      console.log('[sendMessage] 📤 Envoi via serveur Python...');
      
      // ═══════════════════════════════════════════════════════════════════════
      // REQUÊTE HTTP/TCP VERS LE SERVEUR PYTHON (Port 7860)
      // ═══════════════════════════════════════════════════════════════════════
      
      // Construire le payload - ne pas inclure image_url si vide (évite erreur 422)
      const payload: Record<string, unknown> = {
        conversation_id: conversationId,
        sender_id: userId,
        content: content,
        encrypt: true,
      };
      
      // Ajouter image_url seulement si présent
      if (imageUrl) {
        payload.image_url = imageUrl;
      }
      
      const response = await fetch(getEndpointUrl('SEND_MESSAGE'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SERVER_CONFIG.TIMEOUTS.REQUEST),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Server error: ${response.status}`);
      }

      const result = await response.json();
      
      console.log('[sendMessage] ✅ Message envoyé via serveur Python:', {
        messageId: result.message_id,
        encrypted: result.encrypted,
        timestamp: result.timestamp,
      });

      return { error: null };

    } catch (error) {
      console.error('[sendMessage] ❌ Erreur:', error);
      
      // Message d'erreur explicite pour l'architecture Client/Serveur
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Erreur de communication avec le serveur Python';
      
      return { 
        error: new Error(
          `Échec de l'envoi via le serveur Python: ${errorMessage}. ` +
          'Vérifiez que server.py est en cours d\'exécution sur le port 7860.'
        )
      };
    }
  };

  return { 
    messages, 
    loading, 
    sendMessage, 
    refetch: fetchMessages,
    serverAvailable, // Exposer l'état du serveur pour l'UI
  };
}
