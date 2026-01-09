import { useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';
import { EphemeralImage } from './EphemeralImage';
import { SERVER_CONFIG } from '@/config/server';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';
import type { MessageWithSender } from '@/hooks/useMessages';

type Profile = Tables<'profiles'>;

interface MessageBubbleProps {
  message: MessageWithSender;
  isOwn: boolean;
  currentUserId: string;
  formatTime: (dateStr: string | null) => string;
}

export function MessageBubble({ message, isOwn, currentUserId, formatTime }: MessageBubbleProps) {
  const [translation, setTranslation] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

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
      
      <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'}`}>
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
              }`}
            >
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
            </div>
            
            {/* Traduction affichée en dessous */}
            {translation && (
              <div className="mt-1 px-3 py-1.5 bg-muted/50 rounded-lg border border-border/50">
                <p className="text-sm italic text-muted-foreground">{translation}</p>
              </div>
            )}
          </div>
        </div>
        
        <p className={`text-xs text-muted-foreground mt-1 ${isOwn ? 'text-right' : ''}`}>
          {formatTime(message.created_at)}
        </p>
      </div>
    </div>
  );
}
