import { Pin } from 'lucide-react';

interface PinnedMessage {
  id: string;
  content: string | null;
  file_url?: string | null;
  sender?: {
    username: string | null;
  } | null;
}

interface PinnedMessagesBarProps {
  pinnedMessages: PinnedMessage[];
  onUnpin?: (messageId: string) => void;
}

export function PinnedMessagesBar({ pinnedMessages, onUnpin }: PinnedMessagesBarProps) {
  if (pinnedMessages.length === 0) return null;

  return (
    <div className="px-4 py-2 border-b border-border bg-amber-500/10 backdrop-blur-sm">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 mb-1">
          <Pin className="w-4 h-4" />
          <span className="text-xs font-medium">
            {pinnedMessages.length} message{pinnedMessages.length > 1 ? 's' : ''} épinglé{pinnedMessages.length > 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {pinnedMessages.slice(0, 5).map((msg) => (
            <div 
              key={msg.id}
              className="flex-shrink-0 bg-background/80 rounded-lg px-3 py-2 max-w-[200px] border border-amber-500/30 cursor-pointer hover:bg-background transition-colors group relative"
              onClick={() => {
                const el = document.getElementById(`msg-${msg.id}`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            >
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400 truncate">
                {msg.sender?.username || 'Utilisateur'}
              </p>
              <p className="text-sm truncate">
                {msg.content || (msg.file_url ? '📎 Fichier' : '...')}
              </p>
              {onUnpin && (
                <button
                  className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnpin(msg.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
