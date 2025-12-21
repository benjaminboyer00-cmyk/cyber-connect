/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Hook de Messages - Architecture Client/Serveur (SAÉ 3.02)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * CORRECTIFS APPLIQUÉS:
 * - Déchiffrement ciblé via /api/decrypt_message pour les nouveaux messages
 * - Plus de fetchMessages() complet dans le handler Realtime
 * - Protection anti-unmount avec isMountedRef
 */

import { useState, useEffect, useCallback, useRef } from 'react';
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
  
  // Refs pour éviter les boucles infinies
  const conversationIdRef = useRef<string | null>(conversationId);
  const userIdRef = useRef<string | undefined>(userId);
  const isFetchingRef = useRef<boolean>(false);
  const lastFetchTimeRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  
  // Mettre à jour les refs quand les valeurs changent
  useEffect(() => {
    conversationIdRef.current = conversationId;
    userIdRef.current = userId;
  }, [conversationId, userId]);
  
  // Track mount state
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Vérifier si le serveur Python est disponible
  useEffect(() => {
    let cancelled = false;
    checkServerHealth().then((result) => {
      if (!cancelled && isMountedRef.current) {
        setServerAvailable(result);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Helper pour set state seulement si monté
  const safeSetState = useCallback(<T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: T | ((prev: T) => T)) => {
    if (isMountedRef.current) {
      setter(value);
    }
  }, []);

  /**
   * Récupérer le profil d'un utilisateur
   */
  const getProfile = useCallback(async (profileId: string): Promise<Profile | null> => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', profileId)
        .single();
      return data;
    } catch {
      return null;
    }
  }, []);

  /**
   * Déchiffrer un seul message via le serveur Python
   */
  const decryptSingleMessage = useCallback(async (encryptedContent: string): Promise<string> => {
    try {
      const response = await fetch(
        `${SERVER_CONFIG.BASE_URL}/api/decrypt_message`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: encryptedContent }),
          signal: AbortSignal.timeout(5000),
        }
      );

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      return data.decrypted || encryptedContent;
    } catch (error) {
      console.error('[decryptSingleMessage] ❌ Erreur:', error);
      return encryptedContent; // Retourner le contenu original en cas d'échec
    }
  }, []);

  /**
   * Récupération des messages via le serveur Python
   */
  const fetchMessages = useCallback(async () => {
    const convId = conversationIdRef.current;
    const uid = userIdRef.current;
    
    if (!convId) {
      safeSetState(setMessages, []);
      safeSetState(setLoading, false);
      return;
    }

    // Protection: debounce et anti-concurrent
    const now = Date.now();
    if (isFetchingRef.current || (now - lastFetchTimeRef.current < 500)) {
      console.log('[fetchMessages] ⏳ Appel ignoré (debounce ou fetch en cours)');
      return;
    }
    
    isFetchingRef.current = true;
    lastFetchTimeRef.current = now;

    try {
      console.log('[fetchMessages] 📥 Récupération via serveur Python...');
      
      const response = await fetch(
        `${SERVER_CONFIG.BASE_URL}/api/get_messages/${convId}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(SERVER_CONFIG.TIMEOUTS.REQUEST),
        }
      );

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      const messagesData: Message[] = Array.isArray(data) ? data : (data.messages || []);

      console.log('[fetchMessages] ✅ Messages déchiffrés:', messagesData.length);

      // Get sender profiles
      const senderIds = [...new Set(messagesData?.map(m => m.sender_id).filter(Boolean) as string[])];
      
      let profileMap = new Map<string, Profile>();
      if (senderIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('*')
          .in('id', senderIds);
        profileMap = new Map(profiles?.map(p => [p.id, p]));
      }

      const messagesWithSenders: MessageWithSender[] = messagesData.map(m => ({
        ...m,
        sender: m.sender_id ? profileMap.get(m.sender_id) || null : null
      }));

      const uniqueMessages = Array.from(new Map(messagesWithSenders.map(m => [m.id, m])).values());

      console.log('[fetchMessages] 🔄 Mise à jour du state avec', uniqueMessages.length, 'messages');
      safeSetState(setMessages, uniqueMessages);
      safeSetState(setLoading, false);

      // Mark messages as read
      if (uid && messagesData?.length) {
        const unreadIds = messagesData
          .filter(m => !m.is_read && m.sender_id !== uid)
          .map(m => m.id);

        if (unreadIds.length) {
          await supabase
            .from('messages')
            .update({ is_read: true })
            .in('id', unreadIds);
        }
      }
      
      isFetchingRef.current = false;
    } catch (error) {
      isFetchingRef.current = false;
      console.error('[fetchMessages] ❌ Erreur, fallback Supabase direct:', error);
      
      // Fallback: lecture directe depuis Supabase (messages resteront chiffrés)
      const convId = conversationIdRef.current;
      if (!convId) return;
      
      const { data: messagesData, error: supabaseError } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });

      if (supabaseError) {
        console.error('Error fetching messages:', supabaseError);
        safeSetState(setLoading, false);
        return;
      }

      const senderIds = [...new Set(messagesData?.map(m => m.sender_id).filter(Boolean) as string[])];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', senderIds.length > 0 ? senderIds : ['']);

      const profileMap = new Map(profiles?.map(p => [p.id, p]));

      const messagesWithSenders: MessageWithSender[] = (messagesData || []).map(m => ({
        ...m,
        sender: m.sender_id ? profileMap.get(m.sender_id) || null : null
      }));

      safeSetState(setMessages, messagesWithSenders);
      safeSetState(setLoading, false);
    }
  }, [safeSetState]);

  // Fetch messages quand conversationId change
  useEffect(() => {
    fetchMessages();
  }, [conversationId, fetchMessages]);

  /**
   * Real-time subscription avec déchiffrement ciblé
   */
  useEffect(() => {
    if (!conversationId) return;

    console.log('[Realtime] 📡 Abonnement aux messages de', conversationId);

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
          if (!isMountedRef.current) return;
          
          const newMessage = payload.new as Message;
          console.log('[Realtime] 📨 Nouveau message détecté:', newMessage.id);

          try {
            // DÉCHIFFREMENT CIBLÉ: appeler /api/decrypt_message pour CE message uniquement
            let decryptedContent = newMessage.content || '';
            
            if (newMessage.content && newMessage.content.startsWith('gAAAA')) {
              console.log('[Realtime] 🔓 Déchiffrement du nouveau message...');
              decryptedContent = await decryptSingleMessage(newMessage.content);
            }

            // Récupérer le profil du sender
            const senderProfile = newMessage.sender_id 
              ? await getProfile(newMessage.sender_id)
              : null;

            // Ajouter le message déchiffré au state (un seul setState pour éviter les race conditions)
            if (!isMountedRef.current) return;
            
            setMessages((prev) => {
              // Vérifier si le message existe déjà (éviter les doublons)
              if (prev.some(m => m.id === newMessage.id)) {
                console.log('[Realtime] ⚠️ Message déjà présent, ignoré');
                return prev;
              }
              
              const messageWithSender: MessageWithSender = {
                ...newMessage,
                content: decryptedContent,
                sender: senderProfile
              };
              
              console.log('[Realtime] ✅ Message ajouté:', messageWithSender.id);
              return [...prev, messageWithSender];
            });

            // Mark as read if not from current user
            const currentUserId = userIdRef.current;
            if (currentUserId && newMessage.sender_id !== currentUserId) {
              await supabase
                .from('messages')
                .update({ is_read: true })
                .eq('id', newMessage.id);
            }
          } catch (error) {
            console.error('[Realtime] ❌ Erreur traitement message:', error);
            // Fallback: refetch all messages
            await fetchMessages();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload) => {
          const deletedId = payload.old?.id;
          if (deletedId) {
            console.log('[Realtime] 🗑️ Message supprimé:', deletedId);
            safeSetState(setMessages, (prev: MessageWithSender[]) => 
              prev.filter(m => m.id !== deletedId)
            );
          }
        }
      )
      .subscribe();

    return () => {
      console.log('[Realtime] 📴 Désabonnement de', conversationId);
      supabase.removeChannel(channel);
    };
  }, [conversationId, decryptSingleMessage, getProfile, safeSetState, fetchMessages]);

  /**
   * Envoi de message via le serveur Python
   */
  const sendMessage = async (content: string, imageUrl?: string): Promise<{ error: Error | null }> => {
    if (!conversationId || !userId) {
      return { error: new Error('Invalid state: missing conversationId or userId') };
    }

    try {
      console.log('[sendMessage] 📤 Envoi via serveur Python...');
      
      const payload: Record<string, unknown> = {
        conversation_id: conversationId,
        sender_id: userId,
        content: content,
        encrypt: true,
      };
      
      if (imageUrl) {
        payload.image_url = imageUrl;
      }
      
      const response = await fetch(getEndpointUrl('SEND_MESSAGE'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SERVER_CONFIG.TIMEOUTS.REQUEST),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Server error: ${response.status}`);
      }

      const result = await response.json();
      
      console.log('[sendMessage] ✅ Message envoyé:', {
        messageId: result.message_id,
        encrypted: result.encrypted,
      });

      // Le message sera ajouté via Realtime (pas de double-ajout manuel)
      return { error: null };

    } catch (error) {
      console.error('[sendMessage] ❌ Erreur:', error);
      
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Erreur de communication avec le serveur Python';
      
      return { 
        error: new Error(
          `Échec de l'envoi via le serveur Python: ${errorMessage}. ` +
          'Vérifiez que le serveur est en cours d\'exécution.'
        )
      };
    }
  };

  return { 
    messages, 
    loading, 
    sendMessage, 
    refetch: fetchMessages,
    serverAvailable,
  };
}
