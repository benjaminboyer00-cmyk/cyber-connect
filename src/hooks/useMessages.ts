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
  // Tous les useState doivent être appelés dans le même ordre à chaque render
  const [messages, setMessages] = useState<MessageWithSender[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);
  
  // Refs pour éviter les boucles infinies (refs sont stables entre les renders)
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
  
  // Track mount state pour éviter les updates après unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Vérifier si le serveur Python est disponible au montage
  useEffect(() => {
    let cancelled = false;
    checkServerHealth().then((result) => {
      if (!cancelled && isMountedRef.current) {
        setServerAvailable(result);
      }
    });
    return () => { cancelled = true; };
  }, []);

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * RÉCUPÉRATION DES MESSAGES VIA LE SERVEUR PYTHON (DÉCHIFFREMENT)
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Les messages sont stockés chiffrés dans Supabase.
   * Le serveur Python les déchiffre avant de les renvoyer au client.
   * La clé de chiffrement reste côté serveur (sécurité maximale).
   */
  // fetchMessages avec debounce et protection contre appels concurrents
  const fetchMessages = useCallback(async () => {
    const convId = conversationIdRef.current;
    const uid = userIdRef.current;
    
    if (!convId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    // Protection: éviter les appels concurrents et debounce de 500ms
    const now = Date.now();
    if (isFetchingRef.current || (now - lastFetchTimeRef.current < 500)) {
      console.log('[fetchMessages] ⏳ Appel ignoré (debounce ou fetch en cours)');
      return;
    }
    
    isFetchingRef.current = true;
    lastFetchTimeRef.current = now;
    
    // Helper pour set state seulement si monté
    const safeSetState = <T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: T) => {
      if (isMountedRef.current) {
        setter(value);
      }
    };

    try {
      console.log('[fetchMessages] 📥 Récupération via serveur Python (déchiffrement)...');
      
      // Appel à l'endpoint de déchiffrement du serveur Python
      const response = await fetch(
        `${SERVER_CONFIG.BASE_URL}/api/get_messages/${convId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(SERVER_CONFIG.TIMEOUTS.REQUEST),
        }
      );

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      // Le serveur renvoie soit { messages: [...] } soit directement [...]
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

      // Déduplication par id (évite les ré-affichages si le serveur renvoie des doublons)
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
  }, []); // Pas de dépendances - utilise les refs

  // Fetch messages quand conversationId change
  useEffect(() => {
    fetchMessages();
  }, [conversationId, fetchMessages]);

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
          
          console.log('[Realtime] 📨 Nouveau message détecté, rafraîchissement...');
          
          // Rafraîchir via le serveur Python pour obtenir le message déchiffré
          await fetchMessages();

          // Mark as read if not from current user
          const currentUserId = userIdRef.current;
          if (currentUserId && newMessage.sender_id !== currentUserId) {
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
  }, [conversationId, fetchMessages]);

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

      // Petit délai pour laisser le temps à la DB de propager
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Rafraîchir la liste pour récupérer le message déchiffré
      console.log('[sendMessage] 🔄 Rafraîchissement des messages...');
      await fetchMessages();

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
