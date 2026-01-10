import { useState } from 'react';
import { Globe, Loader2, Music } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';
import { EphemeralImage } from './EphemeralImage';
import { SERVER_CONFIG } from '@/config/server';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';
import type { MessageWithSender } from '@/hooks/useMessages';

type Profile = Tables<'profiles'>;

/**
 * Détecte et extrait les liens Spotify d'un message
 * Supporte: tracks, albums, playlists, artists, episodes
 */
function extractSpotifyLinks(text: string): { type: string; id: string; url: string }[] {
  const spotifyRegex = /https?:\/\/open\.spotify\.com\/(track|album|playlist|artist|episode)\/([a-zA-Z0-9]+)(\?[^\s]*)?/g;
  const matches: { type: string; id: string; url: string }[] = [];
  let match;
  
  while ((match = spotifyRegex.exec(text)) !== null) {
    matches.push({
      type: match[1],
      id: match[2],
      url: match[0].split('?')[0] // URL sans query params
    });
  }
  
  return matches;
}

/**
 * Composant Spotify Embed Player
 */
function SpotifyEmbed({ type, id }: { type: string; id: string }) {
  // Hauteur selon le type de contenu
  const height = type === 'track' || type === 'episode' ? 80 : 152;
  
  return (
    <div className="mt-2 rounded-lg overflow-hidden">
      <iframe
        src={`https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`}
        width="100%"
        height={height}
        frameBorder="0"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        className="rounded-lg"
      />
    </div>
  );
}

// Réactions disponibles
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

interface MessageBubbleProps {
  message: MessageWithSender;
  isOwn: boolean;
  currentUserId: string;
  formatTime: (dateStr: string | null) => string;
  onReply?: (message: MessageWithSender) => void;
  onReaction?: (messageId: string, emoji: string) => void;
  reactionCounts?: { [emoji: string]: number };
  hasUserReacted?: (messageId: string, emoji: string) => boolean;
  isPinned?: boolean;
  onPin?: (messageId: string) => void;
  onUnpin?: (messageId: string) => void;
  allMessages?: MessageWithSender[];
}

export function MessageBubble({ message, isOwn, currentUserId, formatTime, onReply, onReaction, reactionCounts, hasUserReacted, isPinned, onPin, onUnpin, allMessages = [] }: MessageBubbleProps) {
  const [translation, setTranslation] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  
  // Trouver le message auquel on répond
  const replyToMessage = (message as any).reply_to_id 
    ? allMessages.find(m => m.id === (message as any).reply_to_id) 
    : null;
  
  // Vérifier s'il y a des réactions
  const hasReactions = reactionCounts && Object.keys(reactionCounts).length > 0;

  const handleTranslate = async () => {
    if (!message.content || isTranslating || translation) return;

    setIsTranslating(true);
    try {
      const response = await fetch(`${SERVER_CONFIG.BASE_URL}${SERVER_CONFIG.ENDPOINTS.TRANSLATE}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: message.content,
        }),
      });

      if (!response.ok) {
        throw new Error('Erreur lors de la traduction');
      }

      const data = await response.json();
      setTranslation(data.translated || data.translated_text || data.translation || data.text);
    } catch (error) {
      console.error('Translation error:', error);
      toast.error('Impossible de traduire le message');
    } finally {
      setIsTranslating(false);
    }
  };

  const isAudio = message.image_url?.match(/\.(webm|mp3|wav|ogg|m4a|mp4)$/i);
  const spotifyLinks = message.content ? extractSpotifyLinks(message.content) : [];

  return (
    <div className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
      {!isOwn && (
        <Avatar className="w-8 h-8">
          <AvatarImage src={message.sender?.avatar_url || ''} />
          <AvatarFallback className="text-xs bg-muted">
            {message.sender?.username?.charAt(0).toUpperCase() || '?'}
          </AvatarFallback>
        </Avatar>
      )}
      
      <div 
        className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'} group relative`}
        onMouseEnter={() => setShowReactions(true)}
        onMouseLeave={() => setShowReactions(false)}
      >
        {/* Menu réactions flottant */}
        {showReactions && (
          <div className={`absolute -top-8 ${isOwn ? 'right-0' : 'left-0'} flex items-center gap-0.5 bg-card border border-border rounded-full px-1 py-0.5 shadow-lg z-10`}>
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => onReaction?.(message.id, emoji)}
                className="hover:scale-125 transition-transform p-1 text-sm"
                title={`Réagir avec ${emoji}`}
              >
                {emoji}
              </button>
            ))}
            {onReply && (
              <button
                onClick={() => onReply(message)}
                className="hover:bg-muted rounded p-1 ml-1 text-xs text-muted-foreground"
                title="Répondre"
              >
                ↩️
              </button>
            )}
            {(onPin || onUnpin) && (
              <button
                onClick={() => isPinned ? onUnpin?.(message.id) : onPin?.(message.id)}
                className={`hover:bg-muted rounded p-1 ml-1 text-xs ${isPinned ? 'text-yellow-500' : 'text-muted-foreground'}`}
                title={isPinned ? 'Désépingler' : 'Épingler'}
              >
                📌
              </button>
            )}
          </div>
        )}

        <div className="flex items-start gap-1">
          {/* Bouton traduire - seulement pour les messages reçus avec du texte */}
          {!isOwn && message.content && !isAudio && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 mt-1 text-muted-foreground hover:text-primary"
              onClick={handleTranslate}
              disabled={isTranslating || !!translation}
              title="Traduire"
            >
              {isTranslating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Globe className="w-3.5 h-3.5" />
              )}
            </Button>
          )}
          
          <div className="flex flex-col">
            <div
              className={`px-4 py-2 rounded-2xl ${
                isOwn
                  ? 'bg-gradient-to-r from-primary to-accent text-primary-foreground rounded-br-md'
                  : 'bg-muted text-foreground rounded-bl-md'
              } ${isPinned ? 'ring-2 ring-yellow-500/50' : ''}`}
            >
              {/* Message de réponse (style WhatsApp) */}
              {replyToMessage && (
                <div 
                  className={`mb-2 p-2 rounded-lg border-l-4 ${isOwn ? 'bg-white/10 border-white/50' : 'bg-primary/10 border-primary/50'} cursor-pointer`}
                  onClick={() => {
                    const el = document.getElementById(`msg-${replyToMessage.id}`);
                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                >
                  <p className={`text-xs font-medium ${isOwn ? 'text-white/80' : 'text-primary'}`}>
                    ↩️ {replyToMessage.sender?.username || 'Utilisateur'}
                  </p>
                  <p className={`text-xs truncate ${isOwn ? 'text-white/60' : 'text-muted-foreground'}`}>
                    {replyToMessage.content?.slice(0, 50) || '📎 Fichier'}
                    {(replyToMessage.content?.length || 0) > 50 ? '...' : ''}
                  </p>
                </div>
              )}
              {isPinned && (
                <div className="flex items-center gap-1 text-[10px] text-yellow-500 mb-1">
                  <span>📌</span>
                  <span>Épinglé</span>
                </div>
              )}
              {message.image_url && (
                isAudio ? (
                  <VoiceMessagePlayer src={message.image_url} isOwn={isOwn} />
                ) : (
                  <EphemeralImage 
                    src={message.image_url}
                    messageId={message.id}
                    reporterId={currentUserId}
                    createdAt={message.created_at || new Date().toISOString()}
                    duration={60}
                    isOwn={isOwn}
                  />
                )
              )}
              {message.content && <p className="text-sm">{message.content}</p>}
              
              {/* Spotify Embeds */}
              {spotifyLinks.length > 0 && (
                <div className="space-y-2">
                  {spotifyLinks.map((link, index) => (
                    <SpotifyEmbed key={`${link.id}-${index}`} type={link.type} id={link.id} />
                  ))}
                </div>
              )}
            </div>
            
            {/* Traduction affichée en dessous */}
            {translation && (
              <div className="mt-1 px-3 py-1.5 bg-muted/50 rounded-lg border border-border/50">
                <p className="text-sm italic text-muted-foreground">{translation}</p>
              </div>
            )}
          </div>
        </div>
        
        {/* Réactions affichées */}
        {hasReactions && (
          <div className={`flex flex-wrap gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
            {Object.entries(reactionCounts!).map(([emoji, count]) => (
              <button
                key={emoji}
                onClick={() => onReaction?.(message.id, emoji)}
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                  hasUserReacted?.(message.id, emoji)
                    ? 'bg-primary/20 border-primary text-primary'
                    : 'bg-muted/50 border-border hover:bg-muted'
                }`}
              >
                <span>{emoji}</span>
                <span className="text-[10px]">{count}</span>
              </button>
            ))}
          </div>
        )}
        
        <p className={`text-xs text-muted-foreground mt-1 ${isOwn ? 'text-right' : ''}`}>
          {formatTime(message.created_at)}
        </p>
      </div>
    </div>
  );
}
