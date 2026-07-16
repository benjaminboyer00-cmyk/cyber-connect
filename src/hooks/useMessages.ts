/**
 * Hook de Messages avec déchiffrement temps réel
 * 
 * CORRECTIFS APPLIQUÉS:
 * - Déchiffrement ciblé via POST /api/decrypt_message pour les nouveaux messages Realtime
 * - Protection anti-unmount avec isMountedRef
 * - Évite les fetchMessages() complets dans le handler Realtime
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SERVER_CONFIG, getEndpointUrl, checkServerHealth } from '@/config/server';
import { isLikelyEncrypted } from '@/lib/crypto';
import type { Tables } from '@/integrations/supabase/types';
import { toast } from 'sonner';

type Message = Tables<'messages'>;
type Profile = Tables<'profiles'>;

export interface MessageWithSender extends Message {
  sender: Profile | null;
  reply_to_id?: string | null;
  replyTo?: MessageWithSender | null;
  /** Bulle affichée en optimiste avant confirmation serveur. */
  _pending?: boolean;
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
   * Déchiffrer un seul message via POST /api/decrypt_message
   */
  const decryptSingleMessage = useCallback(async (
    encryptedContent: string,
    conversationId?: string | null,
    forUserId?: string,
  ): Promise<string> => {
    try {
      const response = await fetch(
        `${SERVER_CONFIG.BASE_URL}/api/decrypt_message`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // On transmet l'identité pour que le serveur vérifie l'appartenance
          // à la conversation avant de déchiffrer (pas d'oracle ouvert).
          body: JSON.stringify({
            content: encryptedContent,
            conversation_id: conversationId ?? undefined,
            user_id: forUserId ?? undefined,
          }),
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
      return encryptedContent;
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
      
      const messagesUrl = uid
        ? `${SERVER_CONFIG.BASE_URL}/api/get_messages/${convId}?user_id=${encodeURIComponent(uid)}`
        : `${SERVER_CONFIG.BASE_URL}/api/get_messages/${convId}`;
      const response = await fetch(
        messagesUrl,
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

      console.log('[fetchMessages] ✅ Messages récupérés:', messagesData.length);

      // Fallback de déchiffrement côté frontend avec Promise.all pour paralléliser
      const processedMessages = await Promise.all(
        messagesData.map(async (msg: any) => {
          // Si le backend n'a pas pu déchiffrer
          if (msg.content && msg._decrypted === false && isLikelyEncrypted(msg.content)) {
            try {
              console.log(`[fetchMessages] 🔓 Tentative de déchiffrement frontend pour message ${msg.id}`);
              
              const decryptedContent = await decryptSingleMessage(msg.content, convId, uid);
              
              // Vérifier que le déchiffrement a réussi (ne commence pas par [Erreur)
              if (decryptedContent && !decryptedContent.startsWith('[Erreur')) {
                return {
                  ...msg,
                  content: decryptedContent,
                  _decrypted: true,
                  _fallback_decrypted: true // Flag pour indiquer que c'est un fallback frontend
                };
              }
            } catch (error) {
              console.warn(`[fetchMessages] ⚠️ Échec déchiffrement frontend pour message ${msg.id}:`, error);
            }
          }
          return msg;
        })
      );

      // Utiliser les messages traités
      const messagesDataProcessed: Message[] = processedMessages as Message[];

      // Get sender profiles
      const senderIds = [...new Set(messagesDataProcessed.map(m => m.sender_id).filter(Boolean) as string[])];
      
      let profileMap = new Map<string, Profile>();
      if (senderIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('*')
          .in('id', senderIds);
        profileMap = new Map(profiles?.map(p => [p.id, p]));
      }

      const messagesWithSenders: MessageWithSender[] = messagesDataProcessed.map(m => ({
        ...m,
        sender: m.sender_id ? profileMap.get(m.sender_id) || null : null
      }));

      const uniqueMessages = Array.from(new Map(messagesWithSenders.map(m => [m.id, m])).values());

      console.log('[fetchMessages] 🔄 Mise à jour du state avec', uniqueMessages.length, 'messages');
      safeSetState(setMessages, uniqueMessages);
      safeSetState(setLoading, false);

      // Mark messages as read
      if (uid && messagesDataProcessed.length) {
        const unreadIds = messagesDataProcessed
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
      toast.error('Failed to load messages');
      
      // Fallback: lecture directe depuis Supabase
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

  // NB : le fetch initial est déclenché par l'effet d'abonnement Realtime
  // plus bas (qui appelle fetchMessages() puis subscribeToMessages()).
  // On évite ainsi un double appel réseau au changement de conversation.

  // Quand aucune conversation n'est sélectionnée, on vide la liste (sans réseau).
  useEffect(() => {
    if (!conversationId) {
      safeSetState(setMessages, []);
      safeSetState(setLoading, false);
    }
  }, [conversationId, safeSetState]);

  /**
   * Fonction pour s'abonner aux messages Realtime
   */
  const subscribeToMessages = useCallback((convId: string) => {
    console.log(`[Realtime] 📡 Abonnement aux messages de ${convId}`);
    
    // VÉRIFIE que supabase est bien configuré
    if (!supabase) {
      console.error('❌ Supabase non initialisé');
      return null;
    }
    
    const subscription = supabase
      .channel(`messages:${convId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${convId}`
        },
        async (payload) => {
          if (!isMountedRef.current) return;
          
          const newMessage = payload.new as Message;
          console.log('[Realtime] 📨 NOUVEAU MESSAGE REALTIME:', payload);
          console.log('[Realtime] 📨 Nouveau message détecté:', newMessage.id);

          try {
            // DÉCHIFFREMENT IMMÉDIAT via POST /api/decrypt_message
            let decryptedContent = newMessage.content || '';
            
            if (isLikelyEncrypted(newMessage.content)) {
              console.log('[Realtime] 🔓 Déchiffrement du nouveau message...');
              decryptedContent = await decryptSingleMessage(newMessage.content, convId, userIdRef.current);
            }

            // Récupérer le profil du sender
            const senderProfile = newMessage.sender_id 
              ? await getProfile(newMessage.sender_id)
              : null;

            if (!isMountedRef.current) return;
            
            // Ajouter le message déchiffré au state (un seul setState)
            setMessages((prev) => {
              // Vérifier si le message existe déjà
              if (prev.some(m => m.id === newMessage.id)) {
                console.log('[Realtime] ⚠️ Message déjà présent, ignoré');
                return prev;
              }

              const messageWithSender: MessageWithSender = {
                ...newMessage,
                content: decryptedContent,
                sender: senderProfile
              };

              // Réconciliation optimiste : si c'est notre propre message qui
              // revient du serveur, on remplace la bulle "en attente" au lieu
              // d'en ajouter une seconde (évite le doublon).
              if (newMessage.sender_id === userIdRef.current) {
                const idx = prev.findIndex(m =>
                  m._pending &&
                  m.content === decryptedContent &&
                  (m.image_url || null) === (newMessage.image_url || null)
                );
                if (idx !== -1) {
                  const copy = [...prev];
                  copy[idx] = messageWithSender;
                  console.log('[Realtime] ♻️ Bulle optimiste réconciliée:', messageWithSender.id);
                  return copy;
                }
              }

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
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${convId}`
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
      .subscribe((status) => {
        console.log(`[Realtime] Subscription status: ${status}`);
        if (status === 'SUBSCRIBED') {
          console.log(`[Realtime] ✅ Abonnement actif pour ${convId}`);
        } else if (status === 'CHANNEL_ERROR') {
          console.error(`[Realtime] ❌ Erreur d'abonnement pour ${convId}`);
        }
      });
    
    return subscription;
  }, [decryptSingleMessage, getProfile, safeSetState]);

  /**
   * Real-time subscription avec déchiffrement ciblé immédiat
   */
  useEffect(() => {
    if (!conversationId) return;

    console.log(`🔄 Initialisation messages pour ${conversationId}`);
    
    // 1. Charger les messages existants
    fetchMessages();
    
    // 2. S'abonner aux nouveaux messages
    const subscription = subscribeToMessages(conversationId);
    
    // 3. Nettoyage
    return () => {
      console.log(`🧹 Nettoyage subscription ${conversationId}`);
      if (subscription) {
        supabase?.removeChannel(subscription);
      }
    };
  }, [conversationId, fetchMessages, subscribeToMessages]);

  /**
   * Envoi de message via le serveur Python
   */
  const sendMessage = async (content: string, imageUrl?: string, replyToId?: string): Promise<{ error: Error | null }> => {
    if (!conversationId || !userId) {
      return { error: new Error('Invalid state: missing conversationId or userId') };
    }

    // UI optimiste : on affiche immédiatement une bulle "en attente".
    // Elle sera réconciliée (ou remplacée) quand le message reviendra en
    // Realtime, et retirée si l'envoi échoue.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticMessage: MessageWithSender = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: userId,
      content,
      image_url: imageUrl ?? null,
      is_read: true,
      created_at: new Date().toISOString(),
      reply_to_id: replyToId ?? null,
      sender: null,
      _pending: true,
    } as MessageWithSender;
    safeSetState(setMessages, (prev: MessageWithSender[]) => [...prev, optimisticMessage]);

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
      
      if (replyToId) {
        payload.reply_to_id = replyToId;
      }
      
      const response = await fetch(getEndpointUrl('SEND_MESSAGE'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SERVER_CONFIG.TIMEOUTS.REQUEST),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // Handle Pydantic validation errors (array of objects) and regular errors
        let errorMessage = `Server error: ${response.status}`;
        if (typeof errorData.detail === 'string') {
          errorMessage = errorData.detail;
        } else if (Array.isArray(errorData.detail)) {
          // Pydantic validation error format
          errorMessage = errorData.detail.map((e: any) => e.msg || e.message || JSON.stringify(e)).join(', ');
        } else if (errorData.error) {
          errorMessage = String(errorData.error);
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      
      console.log('[sendMessage] ✅ Message envoyé:', {
        messageId: result.message_id,
        encrypted: result.encrypted,
      });

      return { error: null };

    } catch (error) {
      console.error('[sendMessage] ❌ Erreur:', error);

      // Rollback : on retire la bulle optimiste puisque l'envoi a échoué.
      safeSetState(setMessages, (prev: MessageWithSender[]) => prev.filter(m => m.id !== tempId));

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
