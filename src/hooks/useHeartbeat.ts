/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Hook de Heartbeat - Gestion de la Présence (SAÉ 3.02)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Ce hook envoie des heartbeats au serveur Python pour maintenir le statut
 * "en ligne" de l'utilisateur.
 * 
 * Protocoles utilisés:
 * - WebSocket (principal): Les navigateurs ne supportent pas UDP natif
 * - HTTP (fallback): Si WebSocket échoue
 * 
 * Le serveur Python fait le bridge vers la logique UDP interne.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { SERVER_CONFIG, getWebSocketUrl, getEndpointUrl } from '@/config/server';

interface HeartbeatState {
  isConnected: boolean;
  protocol: 'websocket' | 'http' | 'none';
  lastHeartbeat: Date | null;
  error: string | null;
}

export function useHeartbeat(userId: string | undefined) {
  const [state, setState] = useState<HeartbeatState>({
    isConnected: false,
    protocol: 'none',
    lastHeartbeat: null,
    error: null,
  });
  
  const wsRef = useRef<WebSocket | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Envoie un heartbeat via HTTP (fallback)
   */
  const sendHttpHeartbeat = useCallback(async (status: string = 'online') => {
    if (!userId) return false;
    
    try {
      const response = await fetch(getEndpointUrl('HEARTBEAT'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, status }),
        signal: AbortSignal.timeout(5000),
      });
      
      if (response.ok) {
        setState(prev => ({
          ...prev,
          isConnected: true,
          protocol: 'http',
          lastHeartbeat: new Date(),
          error: null,
        }));
        return true;
      }
    } catch (error) {
      console.warn('[Heartbeat] HTTP fallback failed:', error);
    }
    
    return false;
  }, [userId]);

  /**
   * Connecte via WebSocket
   */
  const connectWebSocket = useCallback(() => {
    if (!userId || wsRef.current?.readyState === WebSocket.OPEN) return;
    
    try {
      const wsUrl = getWebSocketUrl('HEARTBEAT');
      console.log('[Heartbeat] Connecting to WebSocket:', wsUrl);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      ws.onopen = () => {
        console.log('[Heartbeat] WebSocket connected');
        setState(prev => ({
          ...prev,
          isConnected: true,
          protocol: 'websocket',
          error: null,
        }));
        
        // Envoyer le premier heartbeat
        ws.send(JSON.stringify({ user_id: userId, status: 'online' }));
        
        // Configurer l'intervalle de heartbeat
        intervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ user_id: userId, status: 'online' }));
            setState(prev => ({ ...prev, lastHeartbeat: new Date() }));
          }
        }, SERVER_CONFIG.UDP.HEARTBEAT_INTERVAL);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[Heartbeat] Received:', data);
        } catch {
          // Ignorer les messages non-JSON
        }
      };
      
      ws.onerror = (error) => {
        console.warn('[Heartbeat] WebSocket error:', error);
        setState(prev => ({ ...prev, error: 'WebSocket error' }));
      };
      
      ws.onclose = () => {
        console.log('[Heartbeat] WebSocket closed');
        setState(prev => ({ ...prev, isConnected: false, protocol: 'none' }));
        
        // Clear interval
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        
        // Tenter de reconnecter après 5 secondes
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[Heartbeat] Attempting reconnection...');
          connectWebSocket();
        }, 5000);
      };
      
    } catch (error) {
      console.warn('[Heartbeat] WebSocket connection failed, using HTTP fallback');
      
      // Fallback vers HTTP
      intervalRef.current = setInterval(() => {
        sendHttpHeartbeat('online');
      }, SERVER_CONFIG.UDP.HEARTBEAT_INTERVAL);
      
      sendHttpHeartbeat('online');
    }
  }, [userId, sendHttpHeartbeat]);

  /**
   * Déconnecte proprement
   */
  const disconnect = useCallback(() => {
    // Envoyer un dernier heartbeat "offline"
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ user_id: userId, status: 'offline' }));
      wsRef.current.close();
    } else {
      sendHttpHeartbeat('offline');
    }
    
    // Nettoyer
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    wsRef.current = null;
    
    setState({
      isConnected: false,
      protocol: 'none',
      lastHeartbeat: null,
      error: null,
    });
  }, [userId, sendHttpHeartbeat]);

  // Effet principal
  useEffect(() => {
    if (!userId) return;
    
    // Connecter
    connectWebSocket();
    
    // Cleanup à la déconnexion
    return () => {
      disconnect();
    };
  }, [userId, connectWebSocket, disconnect]);

  // Gérer la fermeture de la page
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ user_id: userId, status: 'offline' }));
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [userId]);

  return {
    ...state,
    disconnect,
    reconnect: connectWebSocket,
  };
}
