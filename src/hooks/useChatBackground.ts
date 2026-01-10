import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ChatBackground {
  conversationId: string;
  backgroundUrl: string;
  setBy: string;
  updatedAt: string;
}

const STORAGE_KEY = 'cyber-connect-chat-backgrounds';

// Stockage local comme fallback
function getLocalBackgrounds(): Record<string, ChatBackground> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveLocalBackground(conversationId: string, bg: ChatBackground) {
  const all = getLocalBackgrounds();
  all[conversationId] = bg;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function useChatBackground(conversationId: string | null, userId: string | undefined) {
  const [background, setBackground] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Charger le fond au changement de conversation
  useEffect(() => {
    if (!conversationId) {
      setBackground(null);
      return;
    }

    // D'abord charger depuis le local
    const local = getLocalBackgrounds()[conversationId];
    if (local) {
      setBackground(local.backgroundUrl);
    }

    // Puis essayer de charger depuis Supabase (metadata de conversation)
    loadBackgroundFromDB(conversationId);

    // Écouter les changements en temps réel
    const channel = supabase
      .channel(`conv-bg-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          filter: `id=eq.${conversationId}`
        },
        (payload) => {
          console.log('📸 Fond de conversation mis à jour:', payload);
          const newMetadata = (payload.new as any)?.metadata;
          if (newMetadata?.background_url) {
            setBackground(newMetadata.background_url);
            saveLocalBackground(conversationId, {
              conversationId,
              backgroundUrl: newMetadata.background_url,
              setBy: newMetadata.background_set_by || '',
              updatedAt: newMetadata.background_updated_at || new Date().toISOString()
            });
          } else if (newMetadata && !newMetadata.background_url) {
            // Fond supprimé
            setBackground(null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  const loadBackgroundFromDB = async (convId: string) => {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('metadata')
        .eq('id', convId)
        .single();

      if (!error && data?.metadata?.background_url) {
        setBackground(data.metadata.background_url);
        // Mettre à jour le cache local
        saveLocalBackground(convId, {
          conversationId: convId,
          backgroundUrl: data.metadata.background_url,
          setBy: data.metadata.background_set_by || '',
          updatedAt: data.metadata.background_updated_at || new Date().toISOString()
        });
      }
    } catch (e) {
      console.log('Fond depuis local uniquement');
    }
  };

  const setConversationBackground = useCallback(async (url: string) => {
    if (!conversationId || !userId) return { error: new Error('Missing data') };

    setLoading(true);
    try {
      // Sauvegarder en local immédiatement
      const bgData: ChatBackground = {
        conversationId,
        backgroundUrl: url,
        setBy: userId,
        updatedAt: new Date().toISOString()
      };
      saveLocalBackground(conversationId, bgData);
      setBackground(url);

      // Essayer de sauvegarder dans Supabase
      const { error } = await supabase
        .from('conversations')
        .update({
          metadata: {
            background_url: url,
            background_set_by: userId,
            background_updated_at: new Date().toISOString()
          }
        })
        .eq('id', conversationId);

      if (error) {
        console.log('Fond sauvegardé localement uniquement:', error.message);
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
    const all = getLocalBackgrounds();
    delete all[conversationId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    setBackground(null);

    // Essayer de supprimer de Supabase
    try {
      await supabase
        .from('conversations')
        .update({ metadata: {} })
        .eq('id', conversationId);
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
