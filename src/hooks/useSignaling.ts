/**
 * Hook WebSocket pour le signaling WebRTC (appels audio/vidéo)
 *
 * Objectif (stabilité):
 * - Conserver UN SEUL WebSocket actif pendant toute la session utilisateur (singleton hors hook)
 * - Éviter les boucles de fermeture/reconnexion (Code 1000) causées par un cleanup React (StrictMode/HMR)
 * - Réduire le bruit console (pas de spam ping/pong / ice-candidate)
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

// Singleton global: persiste même si les composants montent/démontent.
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

  // Protection multi-connexion
  if (current.isConnecting) return;
  if (current.ws?.readyState === WebSocket.OPEN || current.ws?.readyState === WebSocket.CONNECTING) return;

  clearSharedTimers();

  current.isConnecting = true;
  const url = buildWsUrl(uid);

  try {
    const ws = new WebSocket(url);
    current.ws = ws;

    ws.onopen = () => {
      if (!sharedSocket) return;
      sharedSocket.isConnecting = false;
      notifyConnection(true);

      // Heartbeat (HF): ping toutes les 25s (sans spam console)
      clearSharedTimers();
      sharedSocket.pingInterval = setInterval(() => {
        const s = sharedSocket;
        if (!s?.ws || s.ws.readyState !== WebSocket.OPEN) return;
        s.ws.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
    };

    ws.onclose = (e) => {
      const s = sharedSocket;
      if (!s) return;

      s.isConnecting = false;
      s.ws = null;
      notifyConnection(false);

      clearSharedTimers();

      // Pas de reconnexion si c'est nous qui avons fermé
      if (s.manualClose) return;

      // FIX: Ne pas reconnecter sur fermeture normale (1000) ou serveur-initiée (1012)
      // Cela évite les boucles de reconnexion infinies
      if (e.code === 1000 || e.code === 1012) {
        console.log('[Signaling] Fermeture normale (code:', e.code, ') - pas de reconnexion auto');
        return;
      }

      // Reconnexion douce si on a au moins un listener actif
      if (s.messageListeners.size === 0 && s.connectionListeners.size === 0) return;

      // Reconnexion uniquement pour les erreurs réseau
      console.warn('[Signaling] socket closed:', e.code, e.reason, '- reconnexion dans 3s');
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
        const data: SignalMessage = JSON.parse(event.data);

        if (data.type === 'pong') return;

        if (shouldLogSignal(data.type)) {
          console.log('[Signaling] 📨', data.type, 'de', data.sender_id);
        }

        broadcastMessage(data);
      } catch (err) {
        console.error('[Signaling] parse error:', err);
      }
    };

    // sync état au cas où
    if (ws.readyState === WebSocket.OPEN) {
      current.isConnecting = false;
      notifyConnection(true);
    }
  } catch (err) {
    current.isConnecting = false;
    console.error('[Signaling] WebSocket creation error:', err);
  }
};

const ensureSharedSocket = (uid: string) => {
  // Si on change d'utilisateur, on ferme l'ancien singleton
  if (sharedSocket && sharedSocket.userId !== uid) {
    // fermeture volontaire (pas de reconnexion)
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
      // Gérer les appels entrants localement
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

    // sync
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

    // Log uniquement pour les signaux "appel"
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
