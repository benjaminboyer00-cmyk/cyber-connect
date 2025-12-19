import { useState, useEffect, useCallback } from 'react';
import { Flag, Clock, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getEndpointUrl } from '@/config/server';

interface EphemeralImageProps {
  src: string;
  messageId: string;
  reporterId: string;
  duration?: number; // Durée en secondes (défaut: 60)
  isOwn?: boolean;
}

export function EphemeralImage({ 
  src, 
  messageId, 
  reporterId, 
  duration = 60,
  isOwn = false 
}: EphemeralImageProps) {
  const [timeLeft, setTimeLeft] = useState(duration);
  const [isExpired, setIsExpired] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const [hasReported, setHasReported] = useState(false);

  // Countdown timer
  useEffect(() => {
    if (isExpired) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          setIsExpired(true);
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isExpired]);

  // Report image
  const handleReport = useCallback(async () => {
    if (isReporting || hasReported) return;
    
    setIsReporting(true);
    
    try {
      const response = await fetch(getEndpointUrl('REPORT'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: messageId,
          reporter_id: reporterId,
          reason: 'Contenu inapproprié',
          image_url: src,
        }),
      });

      if (response.ok) {
        setHasReported(true);
        toast.success('Image signalée', {
          description: 'Merci, l\'image sera examinée par nos modérateurs.',
        });
      } else {
        throw new Error('Report failed');
      }
    } catch (error) {
      console.error('[EphemeralImage] Report error:', error);
      toast.error('Erreur lors du signalement');
    } finally {
      setIsReporting(false);
    }
  }, [messageId, reporterId, src, isReporting, hasReported]);

  // Image expirée
  if (isExpired) {
    return (
      <div className="flex items-center gap-2 py-3 px-4 bg-muted/50 rounded-lg border border-border/50">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground italic">Image expirée</span>
      </div>
    );
  }

  // Calcul du pourcentage pour la barre de progression
  const progressPercent = (timeLeft / duration) * 100;
  
  // Couleur selon le temps restant
  const getTimerColor = () => {
    if (timeLeft <= 10) return 'text-destructive';
    if (timeLeft <= 30) return 'text-amber-500';
    return 'text-muted-foreground';
  };

  return (
    <div className="relative group">
      {/* Image */}
      <div className="relative overflow-hidden rounded-lg">
        <img 
          src={src} 
          alt="Image éphémère" 
          className="max-w-full rounded-lg cursor-pointer hover:opacity-95 transition-opacity"
          onClick={() => window.open(src, '_blank')}
        />
        
        {/* Overlay gradient avec timer */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
        
        {/* Timer Badge */}
        <div className={`absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/60 backdrop-blur-sm ${getTimerColor()}`}>
          <Clock className="w-3.5 h-3.5" />
          <span className="text-xs font-medium tabular-nums">
            {timeLeft}s
          </span>
        </div>

        {/* Progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
          <div 
            className="h-full bg-primary transition-all duration-1000 ease-linear"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Report Button - visible on hover, pas pour ses propres images */}
      {!isOwn && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReport}
          disabled={isReporting || hasReported}
          className={`absolute top-2 right-2 h-8 px-2 opacity-0 group-hover:opacity-100 transition-opacity
            ${hasReported 
              ? 'bg-amber-500/20 text-amber-500' 
              : 'bg-black/60 text-white hover:bg-black/80 hover:text-destructive'
            }`}
        >
          {hasReported ? (
            <>
              <AlertTriangle className="w-3.5 h-3.5 mr-1" />
              <span className="text-xs">Signalé</span>
            </>
          ) : (
            <>
              <Flag className="w-3.5 h-3.5 mr-1" />
              <span className="text-xs">Signaler</span>
            </>
          )}
        </Button>
      )}
    </div>
  );
}
