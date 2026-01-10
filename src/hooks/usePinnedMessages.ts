import { useState, useEffect, useCallback } from 'react';

interface PinnedMessage {
  messageId: string;
  conversationId: string;
  pinnedAt: number;
  pinnedBy: string;
}

const STORAGE_KEY = 'cyber-connect-pinned-messages';

function getStoredPinned(): PinnedMessage[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function savePinned(pinned: PinnedMessage[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pinned));
}

export function usePinnedMessages(conversationId: string | null, userId: string | undefined) {
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);

  useEffect(() => {
    const all = getStoredPinned();
    const forConv = conversationId 
      ? all.filter(p => p.conversationId === conversationId)
      : [];
    setPinnedMessages(forConv);
  }, [conversationId]);

  const pinMessage = useCallback((messageId: string) => {
    if (!conversationId || !userId) return;

    const all = getStoredPinned();
    
    // Vérifier si déjà épinglé
    if (all.some(p => p.messageId === messageId)) return;

    const newPinned: PinnedMessage = {
      messageId,
      conversationId,
      pinnedAt: Date.now(),
      pinnedBy: userId,
    };

    const updated = [...all, newPinned];
    savePinned(updated);
    setPinnedMessages(prev => [...prev, newPinned]);
  }, [conversationId, userId]);

  const unpinMessage = useCallback((messageId: string) => {
    const all = getStoredPinned();
    const updated = all.filter(p => p.messageId !== messageId);
    savePinned(updated);
    setPinnedMessages(prev => prev.filter(p => p.messageId !== messageId));
  }, []);

  const isMessagePinned = useCallback((messageId: string): boolean => {
    return pinnedMessages.some(p => p.messageId === messageId);
  }, [pinnedMessages]);

  const getPinnedMessageIds = useCallback((): string[] => {
    return pinnedMessages.map(p => p.messageId);
  }, [pinnedMessages]);

  return {
    pinnedMessages,
    pinMessage,
    unpinMessage,
    isMessagePinned,
    getPinnedMessageIds,
  };
}
