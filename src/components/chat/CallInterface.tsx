import { useRef, useEffect, useState } from 'react';
import { PhoneOff, Mic, MicOff, Video, VideoOff, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

interface CallInterfaceProps {
  isOpen: boolean;
  callType: 'audio' | 'video';
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  remoteName: string;
  remoteAvatar?: string;
  onEndCall: () => void;
}

// Formater la durée en MM:SS ou HH:MM:SS
const formatDuration = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export function CallInterface({
  isOpen,
  callType,
  localStream,
  remoteStream,
  remoteName,
  remoteAvatar,
  onEndCall,
}: CallInterfaceProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // Démarrer le chrono quand l'interface s'ouvre
  useEffect(() => {
    if (isOpen) {
      startTimeRef.current = Date.now();
      setCallDuration(0);
      
      timerRef.current = setInterval(() => {
        if (startTimeRef.current) {
          const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
          setCallDuration(elapsed);
        }
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      startTimeRef.current = null;
      setCallDuration(0);
    }
    
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isOpen]);

  // Attacher les streams aux éléments vidéo
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      console.log('[CallInterface] 🎥 Attaching local stream:', {
        id: localStream.id,
        audioTracks: localStream.getAudioTracks().length,
        videoTracks: localStream.getVideoTracks().length
      });
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteStream) {
      console.log('[CallInterface] 📹 Attaching remote stream:', {
        id: remoteStream.id,
        audioTracks: remoteStream.getAudioTracks().length,
        videoTracks: remoteStream.getVideoTracks().length,
        callType: callType
      });
      
      // Pour les appels vidéo, utiliser l'élément video
      if (remoteVideoRef.current && callType === 'video') {
        remoteVideoRef.current.srcObject = remoteStream;
        remoteVideoRef.current.play().catch(err => {
          console.warn('[CallInterface] ⚠️ Autoplay vidéo bloqué:', err);
        });
      }
      
      // Pour les appels audio OU vidéo, TOUJOURS attacher l'audio séparément
      if (remoteAudioRef.current) {
        const audioEl = remoteAudioRef.current;
        audioEl.srcObject = remoteStream;
        audioEl.volume = 1.0; // Volume max
        audioEl.muted = false; // S'assurer que l'élément n'est pas muté
        
        // Log les tracks audio avec TOUS les détails
        const audioTracks = remoteStream.getAudioTracks();
        console.log('[CallInterface] 🔊 Audio tracks DÉTAIL:', audioTracks.map(t => ({
          id: t.id,
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState,
          label: t.label,
          kind: t.kind
        })));
        
        // Log si le track est muted (problème courant)
        if (audioTracks.length > 0 && audioTracks[0].muted) {
          console.warn('[CallInterface] ⚠️ TRACK AUDIO DISTANT MUTÉ! Attente unmute...');
        }
        
        // Écouter quand le track devient unmuted
        audioTracks.forEach(track => {
          track.onunmute = () => {
            console.log('[CallInterface] 🔊 Track audio unmuted!');
            audioEl.play().catch(console.warn);
          };
          track.onended = () => {
            console.log('[CallInterface] 🔇 Track audio ended');
          };
        });
        
        audioEl.play().then(() => {
          console.log('[CallInterface] ✅ Audio playing!');
        }).catch(err => {
          console.warn('[CallInterface] ⚠️ Autoplay audio bloqué:', err);
        });
      }
    }
  }, [remoteStream, callType]);

  // Toggle mute
  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  // Toggle video
  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  if (!isOpen) return null;

  // Handler pour forcer la lecture audio si bloquée
  const handleUserInteraction = () => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.play().catch(console.warn);
    }
    if (remoteVideoRef.current && remoteStream && callType === 'video') {
      remoteVideoRef.current.play().catch(console.warn);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col"
      onClick={handleUserInteraction}
    >
      {/* Élément audio invisible pour jouer l'audio distant (IMPORTANT pour appels audio) */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        style={{ display: 'none' }}
      />
      {/* Header avec chrono */}
      <div className="absolute top-4 left-0 right-0 z-10 flex justify-center">
        <Badge variant="secondary" className="px-4 py-2 text-lg font-mono flex items-center gap-2">
          <Clock className="w-4 h-4 text-green-500" />
          <span className={remoteStream ? 'text-green-500' : 'text-muted-foreground'}>
            {formatDuration(callDuration)}
          </span>
        </Badge>
      </div>

      {/* Zone vidéo principale */}
      <div className="flex-1 relative flex items-center justify-center">
        {callType === 'video' && remoteStream ? (
          // Vidéo distante en plein écran - IMPORTANT: PAS de muted pour entendre l'audio distant
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
            onLoadedMetadata={(e) => {
              // Forcer la lecture quand les métadonnées sont chargées
              (e.target as HTMLVideoElement).play().catch(console.warn);
            }}
          />
        ) : (
          // Avatar pour appel audio ou en attente
          <div className="flex flex-col items-center gap-6">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-primary/20 animate-pulse" style={{ transform: 'scale(1.2)' }} />
              <Avatar className="w-32 h-32 border-4 border-primary">
                <AvatarImage src={remoteAvatar} />
                <AvatarFallback className="text-4xl bg-primary/20 text-primary">
                  {remoteName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold">{remoteName}</p>
              <p className="text-muted-foreground">
                {remoteStream ? 'En appel...' : 'Connexion...'}
              </p>
            </div>
          </div>
        )}

        {/* Vidéo locale (Picture-in-Picture) */}
        {callType === 'video' && localStream && (
          <div className="absolute bottom-24 right-6 w-40 h-56 rounded-xl overflow-hidden border-2 border-border shadow-lg">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover mirror"
              style={{ transform: 'scaleX(-1)' }}
            />
          </div>
        )}
      </div>

      {/* Contrôles en bas */}
      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-background/90 to-transparent">
        <div className="flex items-center justify-center gap-6">
          {/* Mute */}
          <Button
            variant={isMuted ? 'destructive' : 'secondary'}
            size="lg"
            className="rounded-full w-14 h-14"
            onClick={toggleMute}
          >
            {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
          </Button>

          {/* Toggle vidéo (seulement pour appels vidéo) */}
          {callType === 'video' && (
            <Button
              variant={isVideoOff ? 'destructive' : 'secondary'}
              size="lg"
              className="rounded-full w-14 h-14"
              onClick={toggleVideo}
            >
              {isVideoOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
            </Button>
          )}

          {/* Raccrocher */}
          <Button
            variant="destructive"
            size="lg"
            className="rounded-full w-16 h-16"
            onClick={onEndCall}
          >
            <PhoneOff className="w-7 h-7" />
          </Button>
        </div>
      </div>
    </div>
  );
}
