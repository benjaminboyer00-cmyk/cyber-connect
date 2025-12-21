import { useEffect, useRef } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

interface IncomingCallModalProps {
  isOpen: boolean;
  callerName: string;
  callerAvatar?: string;
  callType: 'audio' | 'video';
  onAccept: () => void;
  onReject: () => void;
}

// Son de sonnerie (oscillateur web audio)
const playRingtone = (audioContextRef: React.MutableRefObject<AudioContext | null>, oscillatorRef: React.MutableRefObject<OscillatorNode | null>, gainRef: React.MutableRefObject<GainNode | null>) => {
  try {
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 440;
    oscillator.type = 'sine';
    gainNode.gain.value = 0.3;
    
    oscillatorRef.current = oscillator;
    gainRef.current = gainNode;
    
    oscillator.start();
    
    // Pattern de sonnerie : bip-bip-pause
    let isOn = true;
    const interval = setInterval(() => {
      if (gainRef.current) {
        isOn = !isOn;
        gainRef.current.gain.value = isOn ? 0.3 : 0;
      }
    }, 500);
    
    return interval;
  } catch (err) {
    console.error('Erreur audio:', err);
    return null;
  }
};

const stopRingtone = (
  audioContextRef: React.MutableRefObject<AudioContext | null>, 
  oscillatorRef: React.MutableRefObject<OscillatorNode | null>,
  intervalRef: React.MutableRefObject<NodeJS.Timeout | null>
) => {
  if (intervalRef.current) {
    clearInterval(intervalRef.current);
    intervalRef.current = null;
  }
  if (oscillatorRef.current) {
    oscillatorRef.current.stop();
    oscillatorRef.current = null;
  }
  if (audioContextRef.current) {
    audioContextRef.current.close();
    audioContextRef.current = null;
  }
};

export function IncomingCallModal({
  isOpen,
  callerName,
  callerAvatar,
  callType,
  onAccept,
  onReject,
}: IncomingCallModalProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Jouer la sonnerie quand le modal s'ouvre
  useEffect(() => {
    if (isOpen) {
      const interval = playRingtone(audioContextRef, oscillatorRef, gainRef);
      intervalRef.current = interval;
    } else {
      stopRingtone(audioContextRef, oscillatorRef, intervalRef);
    }
    
    return () => {
      stopRingtone(audioContextRef, oscillatorRef, intervalRef);
    };
  }, [isOpen]);

  const handleAccept = () => {
    stopRingtone(audioContextRef, oscillatorRef, intervalRef);
    onAccept();
  };

  const handleReject = () => {
    stopRingtone(audioContextRef, oscillatorRef, intervalRef);
    onReject();
  };

  return (
    <Dialog open={isOpen}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader className="text-center">
          <DialogTitle className="text-center flex items-center justify-center gap-2">
            Appel entrant
            <Badge variant="destructive" className="animate-pulse">
              {callType === 'video' ? '📹' : '📞'}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-center">
            {callType === 'video' ? 'Appel vidéo' : 'Appel audio'}
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex flex-col items-center gap-6 py-6">
          {/* Avatar avec animation de pulsation */}
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-green-500/30 animate-ping" />
            <div className="absolute inset-0 rounded-full bg-green-500/20 animate-pulse" style={{ animationDelay: '0.5s' }} />
            <Avatar className="w-24 h-24 border-4 border-green-500 relative">
              <AvatarImage src={callerAvatar} />
              <AvatarFallback className="text-2xl bg-green-500/20 text-green-500">
                {callerName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {/* Badge d'appel */}
            <div className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center animate-bounce">
              {callType === 'video' ? (
                <Video className="w-3 h-3 text-white" />
              ) : (
                <Phone className="w-3 h-3 text-white" />
              )}
            </div>
          </div>
          
          <div className="text-center">
            <p className="text-lg font-semibold">{callerName}</p>
            <p className="text-sm text-muted-foreground animate-pulse">vous appelle...</p>
          </div>
          
          {/* Boutons Accepter / Refuser */}
          <div className="flex items-center gap-6">
            <Button
              variant="destructive"
              size="lg"
              className="rounded-full w-16 h-16"
              onClick={handleReject}
            >
              <PhoneOff className="w-6 h-6" />
            </Button>
            
            <Button
              size="lg"
              className="rounded-full w-16 h-16 bg-green-500 hover:bg-green-600"
              onClick={handleAccept}
            >
              {callType === 'video' ? (
                <Video className="w-6 h-6" />
              ) : (
                <Phone className="w-6 h-6" />
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
