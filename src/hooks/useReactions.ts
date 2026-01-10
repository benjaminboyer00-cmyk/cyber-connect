import { useState, useEffect, useCallback } from 'react';

interface Reaction {
  emoji: string;
  userId: string;
  timestamp: number;
}

interface MessageReactions {
  [messageId: string]: Reaction[];
}

const STORAGE_KEY = 'cyber-connect-reactions';

function getStoredReactions(): MessageReactions {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveReactions(reactions: MessageReactions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reactions));
}

export function useReactions(userId: string | undefined) {
  const [reactions, setReactions] = useState<MessageReactions>({});

  useEffect(() => {
    setReactions(getStoredReactions());
  }, []);

  const addReaction = useCallback((messageId: string, emoji: string) => {
    if (!userId) return;

    setReactions(prev => {
      const messageReactions = prev[messageId] || [];
      
      // Vérifier si l'utilisateur a déjà réagi avec cet emoji
      const existingIndex = messageReactions.findIndex(
        r => r.userId === userId && r.emoji === emoji
      );

      let updated: Reaction[];
      if (existingIndex >= 0) {
        // Retirer la réaction si elle existe déjà (toggle)
        updated = messageReactions.filter((_, i) => i !== existingIndex);
      } else {
        // Ajouter la réaction
        updated = [...messageReactions, { emoji, userId, timestamp: Date.now() }];
      }

      const newReactions = { ...prev, [messageId]: updated };
      saveReactions(newReactions);
      return newReactions;
    });
  }, [userId]);

  const getReactions = useCallback((messageId: string): Reaction[] => {
    return reactions[messageId] || [];
  }, [reactions]);

  const getReactionCounts = useCallback((messageId: string): { [emoji: string]: number } => {
    const messageReactions = reactions[messageId] || [];
    const counts: { [emoji: string]: number } = {};
    
    messageReactions.forEach(r => {
      counts[r.emoji] = (counts[r.emoji] || 0) + 1;
    });
    
    return counts;
  }, [reactions]);

  const hasUserReacted = useCallback((messageId: string, emoji: string): boolean => {
    if (!userId) return false;
    const messageReactions = reactions[messageId] || [];
    return messageReactions.some(r => r.userId === userId && r.emoji === emoji);
  }, [reactions, userId]);

  return {
    reactions,
    addReaction,
    getReactions,
    getReactionCounts,
    hasUserReacted
  };
}
