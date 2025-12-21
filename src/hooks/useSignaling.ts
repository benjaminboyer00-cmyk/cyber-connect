/**
 * Hook WebSocket pour le signaling WebRTC (appels audio/vidéo)
 * 
 * CORRECTIFS APPLIQUÉS:
 * - isConnectingRef pour empêcher les connexions multiples
 * - userIdRef pour ne reconnecter QUE si userId change
 * - Heartbeat ping/pong toutes les 25 secondes (requis par Hugging Face)
 * - userId retiré des dépendances de connect()
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { SERVER_CONFIG } from '@/config/server';

export type SignalType = 'offer' | 'answer' | 'ice-candidate' | 'call-request' | 'call-accepted' | 'call-rejected' | 'call-ended';

export interface SignalMessage {
  type: SignalType | 'pong';
  sender_id?: string;
  target_id?: string;
  payload?: RTCSessionDescriptionInit | RTCIceCandidateInit | { callType?: 'audio' | 'video' };
}

export function useSignaling(userId: string | undefined) {
  const [isConnected, setIsConnected] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{ from: string; callType: 'audio' | 'video' } | null>(null);
  
  // Refs critiques pour stabilité
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageCallbackRef = useRef<((msg: SignalMessage) => void) | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // NOUVEAU: Protection contre les connexions multiples
  const isConnectingRef = useRef<boolean>(false);
  const userIdRef = useRef<string | undefined>(undefined);
  
  // NOUVEAU: Heartbeat pour Hugging Face (évite les déconnexions)
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Construire l'URL WebSocket (stable, pas de dépendance à userId)
  const getWsUrl = useCallback((uid: string) => {
    const wsBase = SERVER_CONFIG.BASE_URL.replace('https', 'wss').replace('http', 'ws');
    return `${wsBase}/ws/${uid}`;
  }, []);

  // Connexion WebSocket - NE DÉPEND PLUS DE userId
  const connect = useCallback(() => {
    const uid = userIdRef.current;
    if (!uid) {
      console.log('[Signaling] ⚠️ Pas de userId, connexion annulée');
      return;
    }

    // PROTECTION: Ne pas créer de nouveau socket si déjà connecté/en cours
    if (isConnectingRef.current) {
      console.log('[Signaling] ⏳ Connexion déjà en cours, ignoré');
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[Signaling] ✅ Déjà connecté, ignoré');
      return;
    }
    if (wsRef.current?.readyState === WebSocket.CONNECTING) {
      console.log('[Signaling] ⏳ Socket en état CONNECTING, ignoré');
      return;
    }

    isConnectingRef.current = true;
    const url = getWsUrl(uid);
    console.log('[Signaling] 🔌 Connexion à', url);
    
    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('[Signaling] ✅ Connecté');
        isConnectingRef.current = false;
        setIsConnected(true);
        
        // HEARTBEAT: Ping toutes les 25 secondes pour maintenir la connexion HF
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            console.log('[Signaling] 💓 Envoi ping...');
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onclose = (e) => {
        console.log('[Signaling] ❌ Déconnecté', e.code, e.reason);
        isConnectingRef.current = false;
        setIsConnected(false);
        wsRef.current = null;
        
        // Arrêter le heartbeat
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        
        // Reconnexion automatique après 3 secondes SI userId est toujours valide
        if (userIdRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[Signaling] 🔄 Tentative de reconnexion...');
            connect();
          }, 3000);
        }
      };

      ws.onerror = (e) => {
        console.error('[Signaling] ⚠️ Erreur WebSocket:', e);
        isConnectingRef.current = false;
      };

      ws.onmessage = (event) => {
        try {
          const data: SignalMessage = JSON.parse(event.data);
          
          // Ignorer les pong (juste un ack du serveur)
          if (data.type === 'pong') {
            console.log('[Signaling] 💓 Pong reçu');
            return;
          }
          
          console.log('[Signaling] 📨 Message reçu:', data.type, 'de', data.sender_id);

          // Gérer les appels entrants
          if (data.type === 'call-request' && data.sender_id) {
            const payload = data.payload as { callType?: 'audio' | 'video' };
            setIncomingCall({
              from: data.sender_id,
              callType: payload?.callType || 'audio',
            });
          } else if (data.type === 'call-rejected' || data.type === 'call-ended') {
            setIncomingCall(null);
          }

          // Callback externe pour le hook WebRTC
          if (onMessageCallbackRef.current) {
            onMessageCallbackRef.current(data);
          }
        } catch (err) {
          console.error('[Signaling] ❌ Erreur parsing message:', err);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('[Signaling] ❌ Erreur création WebSocket:', err);
      isConnectingRef.current = false;
    }
  }, [getWsUrl]); // PAS de userId dans les dépendances!

  // Déconnexion propre
  const disconnect = useCallback(() => {
    console.log('[Signaling] 🔌 Déconnexion...');
    
    // Annuler reconnexion programmée
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    // Arrêter le heartbeat
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    
    // Fermer le socket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    isConnectingRef.current = false;
    setIsConnected(false);
  }, []);

  // Envoyer un signal
  const sendSignal = useCallback((targetId: string, type: SignalType, payload?: unknown) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('[Signaling] ⚠️ WebSocket non connecté');
      return false;
    }

    const message = {
      type,
      target_id: targetId,
      payload,
    };

    console.log('[Signaling] 📤 Envoi signal:', type, 'vers', targetId);
    wsRef.current.send(JSON.stringify(message));
    return true;
  }, []);

  // S'abonner aux messages (pour le hook WebRTC)
  const onMessage = useCallback((callback: (msg: SignalMessage) => void) => {
    onMessageCallbackRef.current = callback;
  }, []);

  // Accepter un appel
  const acceptCall = useCallback(() => {
    if (incomingCall) {
      sendSignal(incomingCall.from, 'call-accepted', { callType: incomingCall.callType });
    }
  }, [incomingCall, sendSignal]);

  // Refuser un appel
  const rejectCall = useCallback(() => {
    if (incomingCall) {
      sendSignal(incomingCall.from, 'call-rejected');
      setIncomingCall(null);
    }
  }, [incomingCall, sendSignal]);

  // Terminer un appel
  const endCall = useCallback((targetId: string) => {
    sendSignal(targetId, 'call-ended');
    setIncomingCall(null);
  }, [sendSignal]);

  // EFFET PRINCIPAL: Connexion uniquement si userId CHANGE
  useEffect(() => {
    // Si userId a changé ET est valide
    if (userId && userId !== userIdRef.current) {
      console.log('[Signaling] 👤 userId changé:', userIdRef.current, '->', userId);
      
      // Déconnecter l'ancien si existant
      if (userIdRef.current) {
        disconnect();
      }
      
      // Mettre à jour la ref et connecter
      userIdRef.current = userId;
      connect();
    }
    
    // Si userId devient null/undefined, déconnecter
    if (!userId && userIdRef.current) {
      console.log('[Signaling] 👤 userId supprimé, déconnexion');
      userIdRef.current = undefined;
      disconnect();
    }
    
    // Cleanup au démontage
    return () => {
      // Ne déconnecter que si le composant est vraiment démonté
      // (pas juste un re-render)
    };
  }, [userId, connect, disconnect]);

  // Cleanup final au démontage du composant
  useEffect(() => {
    return () => {
      userIdRef.current = undefined;
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    incomingCall,
    sendSignal,
    onMessage,
    acceptCall,
    rejectCall,
    endCall,
    setIncomingCall,
  };
}
