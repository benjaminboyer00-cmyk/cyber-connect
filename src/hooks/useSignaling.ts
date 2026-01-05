/**
 * Hook WebSocket pour le signaling WebRTC
 *
 * CORRECTIFS APPLIQUÉS:
 * - useRef pour le WebSocket (empêche doubles connexions)
 * - Pas de reconnexion sur code 1000 (Normal Closure)
 * - Ping/heartbeat toutes les 20 secondes vers HuggingFace
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { SERVER_CONFIG } from '@/config/server';

export type SignalType =
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'call-request'
  | 'call-accepted'
  | 'call-rejected'
  | 'call-ended';

export interface SignalMessage {
  type: SignalType | 'pong';
  sender_id?: string;
  target_id?: string;
  payload?: RTCSessionDescriptionInit | RTCIceCandidateInit | { callType?: 'audio' | 'video' };
}

type ConnectionListener = (connected: boolean) => void;

type SharedSignalingSocket = {
  userId: string;
  ws: WebSocket | null;
  isConnecting: boolean;
  manualClose: boolean;
  reconnectTimeout: ReturnType<typeof setTimeout> | null;
  pingInterval: ReturnType<typeof setInterval> | null;
  messageListeners: Set<(msg: SignalMessage) => void>;
  connectionListeners: Set<ConnectionListener>;
};

// Singleton global (useRef au niveau module)
let sharedSocket: SharedSignalingSocket | null = null;

const buildWsUrl = (uid: string) => {
  const wsBase = SERVER_CONFIG.BASE_URL.replace('https', 'wss').replace('http', 'ws');
  return `${wsBase}/ws/${uid}`;
};

const shouldLogSignal = (type: SignalMessage['type']) =>
  type === 'call-request' ||
  type === 'call-accepted' ||
  type === 'call-rejected' ||
  type === 'call-ended';

const notifyConnection = (connected: boolean) => {
  if (!sharedSocket) return;
  for (const cb of sharedSocket.connectionListeners) {
    try {
      cb(connected);
    } catch {
      // ignore
    }
  }
};

const broadcastMessage = (msg: SignalMessage) => {
  if (!sharedSocket) return;
  for (const cb of sharedSocket.messageListeners) {
    try {
      cb(msg);
    } catch (e) {
      console.error('[Signaling] listener error:', e);
    }
  }
};

const clearSharedTimers = () => {
  if (!sharedSocket) return;

  if (sharedSocket.reconnectTimeout) {
    clearTimeout(sharedSocket.reconnectTimeout);
    sharedSocket.reconnectTimeout = null;
  }

  if (sharedSocket.pingInterval) {
    clearInterval(sharedSocket.pingInterval);
    sharedSocket.pingInterval = null;
  }
};

const connectSharedSocket = (uid: string) => {
  // Créer l'objet singleton si besoin
  if (!sharedSocket) {
    sharedSocket = {
      userId: uid,
      ws: null,
      isConnecting: false,
      manualClose: false,
      reconnectTimeout: null,
      pingInterval: null,
      messageListeners: new Set(),
      connectionListeners: new Set(),
    };
  }

  // Réinitialiser pour ce user
  sharedSocket.userId = uid;
  sharedSocket.manualClose = false;

  const current = sharedSocket;

  // Protection multi-connexion via isConnecting (useRef pattern)
  if (current.isConnecting) {
    console.log('[Signaling] Connexion déjà en cours, ignoré');
    return;
  }
  if (current.ws?.readyState === WebSocket.OPEN || current.ws?.readyState === WebSocket.CONNECTING) {
    console.log('[Signaling] WebSocket déjà connecté/en cours');
    return;
  }

  clearSharedTimers();

  current.isConnecting = true;
  const url = buildWsUrl(uid);
  console.log('[Signaling] Connexion WebSocket vers:', url);

  try {
    const ws = new WebSocket(url);
    current.ws = ws;

    ws.onopen = () => {
      if (!sharedSocket) return;
      console.log('[Signaling] ✅ WebSocket connecté');
      sharedSocket.isConnecting = false;
      notifyConnection(true);

      // Heartbeat toutes les 20 secondes (HuggingFace)
      clearSharedTimers();
      sharedSocket.pingInterval = setInterval(() => {
        const s = sharedSocket;
        if (!s?.ws || s.ws.readyState !== WebSocket.OPEN) return;
        s.ws.send(JSON.stringify({ type: 'ping' }));
      }, 20000); // 20 secondes
    };

    ws.onclose = (e) => {
      const s = sharedSocket;
      if (!s) return;

      console.log('[Signaling] WebSocket fermé - code:', e.code, 'reason:', e.reason);
      s.isConnecting = false;
      s.ws = null;
      notifyConnection(false);

      clearSharedTimers();

      // Pas de reconnexion si fermeture manuelle
      if (s.manualClose) {
        console.log('[Signaling] Fermeture manuelle - pas de reconnexion');
        return;
      }

      // NE PAS reconnecter sur code 1000 (Normal Closure)
      if (e.code === 1000) {
        console.log('[Signaling] Fermeture normale (1000) - pas de reconnexion auto');
        return;
      }

      // NE PAS reconnecter sur code 1012 (Server-initiated)
      if (e.code === 1012) {
        console.log('[Signaling] Fermeture serveur (1012) - pas de reconnexion auto');
        return;
      }

      // Reconnexion uniquement si on a des listeners actifs
      if (s.messageListeners.size === 0 && s.connectionListeners.size === 0) {
        console.log('[Signaling] Aucun listener actif - pas de reconnexion');
        return;
      }

      // Reconnexion pour les erreurs réseau
      console.warn('[Signaling] Reconnexion dans 3s (code:', e.code, ')');
      s.reconnectTimeout = setTimeout(() => {
        if (!sharedSocket || sharedSocket.userId !== uid) return;
        connectSharedSocket(uid);
      }, 3000);
    };

    ws.onerror = (err) => {
      const s = sharedSocket;
      if (s) s.isConnecting = false;
      console.error('[Signaling] WebSocket error:', err);
    };

    ws.onmessage = (event) => {
      try {
        const data: any = JSON.parse(event.data);

        if (data.type === 'pong') return; // Ignore pong silencieusement

        // Gérer les erreurs du backend
        if (data.type === 'error') {
          console.error('[Signaling] 📥 Signal error de', data.target_id || 'undefined', ':', data.message);
          // Broadcast l'erreur pour que useWebRTC puisse la gérer
          broadcastMessage(data as SignalMessage);
          return;
        }

        if (shouldLogSignal(data.type)) {
          console.log('[Signaling] 📨', data.type, 'de', data.sender_id);
        }

        broadcastMessage(data as SignalMessage);
      } catch (err) {
        console.error('[Signaling] parse error:', err);
      }
    };

  } catch (err) {
    current.isConnecting = false;
    console.error('[Signaling] WebSocket creation error:', err);
  }
};

const ensureSharedSocket = (uid: string) => {
  // Si on change d'utilisateur, fermer l'ancien singleton
  if (sharedSocket && sharedSocket.userId !== uid) {
    sharedSocket.manualClose = true;
    clearSharedTimers();
    try {
      sharedSocket.ws?.close(1000, 'user_changed');
    } catch {
      // ignore
    }
    sharedSocket = null;
  }

  connectSharedSocket(uid);
  return sharedSocket!;
};

const closeSharedSocket = (reason: string) => {
  if (!sharedSocket) return;

  sharedSocket.manualClose = true;
  clearSharedTimers();

  try {
    sharedSocket.ws?.close(1000, reason);
  } catch {
    // ignore
  }

  sharedSocket.ws = null;
  notifyConnection(false);
  sharedSocket = null;
};

export function useSignaling(userId: string | undefined) {
  const [isConnected, setIsConnected] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{ from: string; callType: 'audio' | 'video' } | null>(null);

  const onMessageCallbackRef = useRef<((msg: SignalMessage) => void) | null>(null);

  const handleSharedMessage = useCallback(
    (data: SignalMessage) => {
      if (data.type === 'call-request' && data.sender_id) {
        const payload = data.payload as { callType?: 'audio' | 'video' };
        setIncomingCall({ from: data.sender_id, callType: payload?.callType || 'audio' });
      } else if (data.type === 'call-rejected' || data.type === 'call-ended') {
        setIncomingCall(null);
      }

      onMessageCallbackRef.current?.(data);
    },
    []
  );

  useEffect(() => {
    // Logout / pas d'utilisateur: fermer le singleton
    if (!userId) {
      setIncomingCall(null);
      setIsConnected(false);
      if (sharedSocket) closeSharedSocket('logout');
      return;
    }

    const shared = ensureSharedSocket(userId);

    // S'abonner aux messages & états de connexion
    const connectionListener: ConnectionListener = (connected) => setIsConnected(connected);

    shared.messageListeners.add(handleSharedMessage);
    shared.connectionListeners.add(connectionListener);

    // sync initial
    setIsConnected(shared.ws?.readyState === WebSocket.OPEN);

    // Cleanup: on se désabonne seulement (NE PAS fermer le WS ici)
    return () => {
      shared.messageListeners.delete(handleSharedMessage);
      shared.connectionListeners.delete(connectionListener);
    };
  }, [userId, handleSharedMessage]);

  const sendSignal = useCallback((targetId: string, type: SignalType, payload?: unknown) => {
    const ws = sharedSocket?.ws;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[Signaling] WebSocket not connected');
      return false;
    }

    ws.send(
      JSON.stringify({
        type,
        target_id: targetId,
        payload,
      })
    );

    if (type !== 'ice-candidate') {
      console.log('[Signaling] 📤', type, '->', targetId);
    }

    return true;
  }, []);

  const onMessage = useCallback((callback: (msg: SignalMessage) => void) => {
    onMessageCallbackRef.current = callback;
  }, []);

  const acceptCall = useCallback(() => {
    if (incomingCall) {
      sendSignal(incomingCall.from, 'call-accepted', { callType: incomingCall.callType });
    }
  }, [incomingCall, sendSignal]);

  const rejectCall = useCallback(() => {
    if (incomingCall) {
      sendSignal(incomingCall.from, 'call-rejected');
      setIncomingCall(null);
    }
  }, [incomingCall, sendSignal]);

  const endCall = useCallback(
    (targetId: string) => {
      sendSignal(targetId, 'call-ended');
      setIncomingCall(null);
    },
    [sendSignal]
  );

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
