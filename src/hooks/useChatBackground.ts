import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '@/config/api';

const STORAGE_KEY = 'cyber-connect-chat-backgrounds';

// Stockage local comme fallback
function getLocalBackgrounds(): Record<string, string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveLocalBackground(conversationId: string, url: string) {
  const all = getLocalBackgrounds();
  all[conversationId] = url;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

function removeLocalBackground(conversationId: string) {
  const all = getLocalBackgrounds();
  delete all[conversationId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function useChatBackground(conversationId: string | null, userId: string | undefined) {
  const [background, setBackground] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Charger le fond au changement de conversation
  useEffect(() => {
    if (!conversationId) {
      setBackground(null);
      return;
    }

    // D'abord charger depuis le local
    const local = getLocalBackgrounds()[conversationId];
    if (local) {
      setBackground(local);
    }

    // Puis charger depuis le backend
    loadBackgroundFromServer(conversationId);

    // Polling toutes les 3 secondes pour sync en temps réel
    pollIntervalRef.current = setInterval(() => {
      loadBackgroundFromServer(conversationId);
    }, 3000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [conversationId]);

  const loadBackgroundFromServer = async (convId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/chat-background/${convId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.background?.url) {
          setBackground(data.background.url);
          saveLocalBackground(convId, data.background.url);
        }
      }
    } catch (e) {
      // Utiliser le local en cas d'erreur
    }
  };

  const setConversationBackground = useCallback(async (url: string) => {
    if (!conversationId || !userId) return { error: new Error('Missing data') };

    setLoading(true);
    try {
      // Sauvegarder en local immédiatement
      saveLocalBackground(conversationId, url);
      setBackground(url);

      // Sauvegarder sur le backend
      const response = await fetch(`${API_BASE_URL}/api/chat-background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversationId,
          background_url: url,
          set_by: userId
        })
      });

      if (!response.ok) {
        console.log('Fond sauvegardé localement uniquement');
      }

      return { error: null };
    } catch (e) {
      return { error: e as Error };
    } finally {
      setLoading(false);
    }
  }, [conversationId, userId]);

  const clearBackground = useCallback(async () => {
    if (!conversationId) return;

    // Supprimer du local
    removeLocalBackground(conversationId);
    setBackground(null);

    // Supprimer du backend
    try {
      await fetch(`${API_BASE_URL}/api/chat-background/${conversationId}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.log('Suppression locale uniquement');
    }
  }, [conversationId]);

  return {
    background,
    loading,
    setConversationBackground,
    clearBackground
  };
}
