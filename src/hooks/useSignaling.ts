/**
 * Hook WebSocket pour le signaling WebRTC (appels audio/vidéo)
 * Se connecte à wss://[SERVER_URL]/ws/${userId}
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { SERVER_CONFIG } from '@/config/server';

export type SignalType = 'offer' | 'answer' | 'ice-candidate' | 'call-request' | 'call-accepted' | 'call-rejected' | 'call-ended';

export interface SignalMessage {
  type: SignalType;
  sender_id?: string;
  target_id?: string;
  payload?: RTCSessionDescriptionInit | RTCIceCandidateInit | { callType?: 'audio' | 'video' };
}

export function useSignaling(userId: string | undefined) {
  const [isConnected, setIsConnected] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{ from: string; callType: 'audio' | 'video' } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageCallbackRef = useRef<((msg: SignalMessage) => void) | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Construire l'URL WebSocket
  const getWsUrl = useCallback(() => {
    if (!userId) return null;
    const wsBase = SERVER_CONFIG.BASE_URL.replace('https', 'wss').replace('http', 'ws');
    return `${wsBase}/ws/${userId}`;
  }, [userId]);

  // Connexion WebSocket
  const connect = useCallback(() => {
    const url = getWsUrl();
    if (!url || wsRef.current?.readyState === WebSocket.OPEN) return;

    console.log('[Signaling] 🔌 Connexion à', url);
    
    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('[Signaling] ✅ Connecté');
        setIsConnected(true);
      };

      ws.onclose = (e) => {
        console.log('[Signaling] ❌ Déconnecté', e.code, e.reason);
        setIsConnected(false);
        wsRef.current = null;
        
        // Reconnexion automatique après 3 secondes
        if (userId) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[Signaling] 🔄 Tentative de reconnexion...');
            connect();
          }, 3000);
        }
      };

      ws.onerror = (e) => {
        console.error('[Signaling] ⚠️ Erreur WebSocket:', e);
      };

      ws.onmessage = (event) => {
        try {
          const data: SignalMessage = JSON.parse(event.data);
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
    }
  }, [getWsUrl, userId]);

  // Déconnexion
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
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

  // Connexion automatique quand userId est disponible
  useEffect(() => {
    if (userId) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [userId, connect, disconnect]);

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
