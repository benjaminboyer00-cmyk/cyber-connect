import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/config/api';

export type CallState = 'idle' | 'calling' | 'ringing' | 'connected' | 'failed';
export type CallType = 'audio' | 'video';

interface UseWebRTCReturn {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  callState: CallState;
  callType: CallType;
  isCaller: boolean;
  currentCall: { targetId: string | null; callerId: string | null };
  callUser: (targetId: string, type?: CallType) => Promise<void>;
  acceptCall: () => Promise<void>;
  endCall: (userInitiated?: boolean) => void;
  rejectCall: () => void;
  toggleAudio: (enabled: boolean) => void;
  toggleVideo: (enabled: boolean) => void;
  switchCamera: () => Promise<void>;
}

interface WebRTCConfig {
  iceServers: RTCIceServer[];
  stunServers: string[];
  turnServers?: Array<{
    urls: string;
    username?: string;
    credential?: string;
  }>;
}

export const useWebRTC = (
  currentUserId: string | null,
  signaling: any
): UseWebRTCReturn => {
  const [callState, setCallState] = useState<CallState>('idle');
  const [callType, setCallType] = useState<CallType>('video');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCaller, setIsCaller] = useState(false);
  
  // Références
  const callTypeRef = useRef<CallType>('video');
  const isCallerRef = useRef<boolean>(false);
  const iceServersRef = useRef<RTCIceServer[]>([
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingCandidatesQueue = useRef<RTCIceCandidateInit[]>([]);
  const currentCallRef = useRef<{ targetId: string | null; callerId: string | null }>({ 
    targetId: null, 
    callerId: null 
  });
  
  // Références pour les pistes
  const localAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const localVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const remoteAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const remoteVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  
  // État des médias
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const activeCameraRef = useRef<'user' | 'environment'>('user');

  // 1. CHARGEMENT CONFIG SERVEUR AVANCÉ
  useEffect(() => {
    const fetchIceConfig = async () => {
      try {
        console.log('🔄 Chargement configuration ICE...');
        const res = await fetch(`${API_BASE_URL}/api/webrtc-config`);
        const data: WebRTCConfig = await res.json();
        
        const servers: RTCIceServer[] = [];
        
        // STUN servers
        if (data.stunServers && data.stunServers.length > 0) {
          data.stunServers.forEach(url => {
            servers.push({ urls: url });
          });
        }
        
        // TURN servers
        if (data.turnServers && data.turnServers.length > 0) {
          data.turnServers.forEach(server => {
            servers.push({
              urls: server.urls,
              username: server.username,
              credential: server.credential
            });
          });
        }
        
        // Ice servers personnalisés
        if (data.iceServers && data.iceServers.length > 0) {
          servers.push(...data.iceServers);
        }
        
        // Fallback si pas de serveurs
        if (servers.length === 0) {
          servers.push(
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          );
        }
        
        iceServersRef.current = servers;
        console.log('✅ Configuration ICE chargée:', servers.length, 'serveurs');
      } catch (error) {
        console.error('⚠️ Erreur chargement config ICE, fallback:', error);
      }
    };
    
    fetchIceConfig();
  }, []);

  // 2. NETTOYAGE COMPLET
  const cleanupLocalResources = useCallback(() => {
    console.log('🧹 Nettoyage complet des ressources...');
    
    // Fermer la connexion peer
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    // Arrêter les pistes locales
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      localStreamRef.current = null;
      setLocalStream(null);
    }
    
    // Arrêter les pistes distantes
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      remoteStreamRef.current = null;
      setRemoteStream(null);
    }
    
    // Réinitialiser les refs
    localAudioTrackRef.current = null;
    localVideoTrackRef.current = null;
    remoteAudioTrackRef.current = null;
    remoteVideoTrackRef.current = null;
    
    // Réinitialiser les états
    setCallState('idle');
    pendingCandidatesQueue.current = [];
    pendingOfferRef.current = null;
    isCallerRef.current = false;
    setIsCaller(false);
    
    currentCallRef.current = { targetId: null, callerId: null };
    
    console.log('✅ Nettoyage terminé');
  }, []);

  // 3. GESTION CAMÉRA/MICRO AVANCÉE
  const initializeLocalStream = useCallback(async (
    type: CallType, 
    cameraFacingMode: 'user' | 'environment' = 'user'
  ): Promise<boolean> => {
    try {
      console.log(`🎬 Initialisation flux ${type} avec caméra ${cameraFacingMode}`);
      
      // Nettoyage préalable
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          track.stop();
        });
        localStreamRef.current = null;
      }
      
      // Configuration média
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: type === 'video' ? {
          facingMode: cameraFacingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } : false
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Stockage des pistes
      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();
      
      if (audioTracks.length > 0) {
        localAudioTrackRef.current = audioTracks[0];
        localAudioTrackRef.current.enabled = isAudioEnabled;
      }
      
      if (videoTracks.length > 0) {
        localVideoTrackRef.current = videoTracks[0];
        localVideoTrackRef.current.enabled = isVideoEnabled && type === 'video';
      }
      
      localStreamRef.current = stream;
      setLocalStream(stream);
      
      return true;
    } catch (error: any) {
      console.error('❌ Erreur initialisation média:', error);
      
      if (error.name === 'NotAllowedError') {
        toast.error("Accès à la caméra/micro refusé");
      } else if (error.name === 'NotFoundError') {
        toast.error("Aucun périphérique média trouvé");
      }
      
      return false;
    }
  }, [isAudioEnabled, isVideoEnabled]);

  // 4. CRÉATION CONNEXION ROBUSTE
  const createPeerConnection = useCallback((targetId: string) => {
    console.log('🔗 Création connexion WebRTC pour:', targetId);
    
    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceCandidatePoolSize: 10
    });

    // Gestion des candidats ICE
    pc.onicecandidate = (event) => {
      if (event.candidate && signaling) {
        signaling.sendSignal(targetId, 'ice-candidate', event.candidate.toJSON());
      }
    };

    // Gestion des pistes distantes
    pc.ontrack = (event) => {
      console.log('📥 Réception piste distante:', event.track.kind);
      
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }
      
      // Vérifier si la piste existe déjà
      const existingTrack = remoteStreamRef.current
        .getTracks()
        .find(t => t.id === event.track.id);
      
      if (!existingTrack) {
        remoteStreamRef.current.addTrack(event.track);
        
        // Stocker la référence
        if (event.track.kind === 'audio') {
          remoteAudioTrackRef.current = event.track;
        } else if (event.track.kind === 'video') {
          remoteVideoTrackRef.current = event.track;
        }
        
        setRemoteStream(new MediaStream(remoteStreamRef.current.getTracks()));
      }
    };

    // Surveiller l'état de la connexion
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log('🌐 État ICE:', state);
      
      switch (state) {
        case 'connected':
          setCallState('connected');
          break;
        case 'failed':
          cleanupLocalResources();
          break;
      }
    };

    return pc;
  }, [signaling, cleanupLocalResources]);

  // 5. TERMINER L'APPEL (définie avant acceptCall pour éviter la référence circulaire)
  const endCall = useCallback((userInitiated: boolean = false) => {
    console.log(`📞 Fin d'appel${userInitiated ? ' (initié par utilisateur)' : ''}`);
    
    if (userInitiated) {
      const targetId = currentCallRef.current.targetId || currentCallRef.current.callerId;
      if (targetId) {
        signaling.sendSignal(targetId, 'call-ended', {
          reason: 'user-ended'
        });
      }
    }
    
    cleanupLocalResources();
    toast.info('Appel terminé');
  }, [signaling, cleanupLocalResources]);

  // 6. REJETER L'APPEL
  const rejectCall = useCallback(() => {
    console.log('❌ Rejet d\'appel');
    
    if (currentCallRef.current.callerId) {
      signaling.sendSignal(currentCallRef.current.callerId, 'call-rejected', {
        reason: 'busy'
      });
    }
    
    cleanupLocalResources();
    toast.warning('Appel rejeté');
  }, [signaling, cleanupLocalResources]);

  // 7. GESTION DES SIGNALISATIONS
  useEffect(() => {
    if (!signaling) return;

    const handleSignal = async (msg: any) => {
      const { type, sender_id, payload, data } = msg;
      const sdp = payload || data?.sdp || data;
      
      console.log('📨 Signal reçu:', type, 'de', sender_id);

      switch (type) {
        case 'offer':
          console.log('🔔 Offre reçue de', sender_id);
          
          const isVideo = sdp.sdp?.includes('m=video');
          const detectedType = isVideo ? 'video' : 'audio';
          
          pendingOfferRef.current = sdp;
          currentCallRef.current = { targetId: sender_id, callerId: sender_id };
          
          setCallType(detectedType);
          callTypeRef.current = detectedType;
          setIsCaller(false);
          isCallerRef.current = false;
          
          setCallState('ringing');
          break;

        case 'answer':
          console.log('✅ Réponse reçue');
          if (peerConnectionRef.current) {
            try {
              await peerConnectionRef.current.setRemoteDescription(
                new RTCSessionDescription(sdp)
              );
              
              // Traiter les candidats ICE en attente
              for (const candidate of pendingCandidatesQueue.current) {
                await peerConnectionRef.current.addIceCandidate(
                  new RTCIceCandidate(candidate)
                );
              }
              pendingCandidatesQueue.current = [];
            } catch (error) {
              console.error('❌ Erreur application réponse:', error);
            }
          }
          break;

        case 'ice-candidate':
          const candidate = new RTCIceCandidate(payload);
          
          if (peerConnectionRef.current && 
              peerConnectionRef.current.remoteDescription) {
            try {
              await peerConnectionRef.current.addIceCandidate(candidate);
            } catch (error) {
              console.error('❌ Erreur ajout candidat ICE:', error);
            }
          } else {
            pendingCandidatesQueue.current.push(payload);
          }
          break;

        case 'call-ended':
          console.log('📞 Appel terminé par l\'autre partie');
          cleanupLocalResources();
          break;

        case 'call-rejected':
          console.log('❌ Appel rejeté');
          cleanupLocalResources();
          break;
      }
    };

    signaling.onMessage(handleSignal);
    
    return () => {
      if (signaling.offMessage) {
        signaling.offMessage(handleSignal);
      }
    };
  }, [signaling, cleanupLocalResources]);

  // 8. LANCER UN APPEL (CALLER)
  const callUser = useCallback(async (
    targetId: string, 
    type: CallType = 'video'
  ): Promise<void> => {
    if (!currentUserId) {
      toast.error('Vous devez être connecté pour appeler');
      return;
    }

    console.log(`📞 Démarrage appel ${type} vers ${targetId}`);
    
    // Nettoyage préalable
    cleanupLocalResources();
    
    setIsCaller(true);
    isCallerRef.current = true;
    currentCallRef.current = { targetId, callerId: currentUserId };
    setCallType(type);
    callTypeRef.current = type;
    setCallState('calling');

    try {
      // A. Initialiser le flux média
      const mediaSuccess = await initializeLocalStream(type);
      if (!mediaSuccess) {
        setCallState('failed');
        return;
      }

      // B. Créer la connexion peer
      const pc = createPeerConnection(targetId);
      peerConnectionRef.current = pc;

      // C. Ajouter les pistes locales
      if (localStreamRef.current) {
        const tracks = localStreamRef.current.getTracks();
        
        tracks.forEach(track => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      // D. Créer et envoyer l'offre
      const offerOptions: RTCOfferOptions = {
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === 'video'
      };

      const offer = await pc.createOffer(offerOptions);
      await pc.setLocalDescription(offer);
      
      signaling.sendSignal(targetId, 'offer', { 
        type: 'offer', 
        sdp: offer.sdp,
        callType: type
      });

    } catch (error: any) {
      console.error('❌ Erreur lors de l\'appel:', error);
      setCallState('failed');
      endCall(true);
    }
  }, [currentUserId, signaling, initializeLocalStream, createPeerConnection, cleanupLocalResources, endCall]);

  // 9. ACCEPTER UN APPEL (CALLEE)
  const acceptCall = useCallback(async (): Promise<void> => {
    if (!pendingOfferRef.current || !currentCallRef.current.callerId) {
      toast.error('Aucun appel à accepter');
      return;
    }

    const callerId = currentCallRef.current.callerId;
    console.log(`✅ Acceptation appel de ${callerId}`);

    try {
      setCallState('connected');
      
      // A. Initialiser le flux média
      const mediaSuccess = await initializeLocalStream(callTypeRef.current);
      if (!mediaSuccess) {
        endCall(true);
        return;
      }

      // B. Créer la connexion peer
      const pc = createPeerConnection(callerId);
      peerConnectionRef.current = pc;

      // C. Ajouter les pistes locales
      if (localStreamRef.current) {
        const tracks = localStreamRef.current.getTracks();
        
        tracks.forEach(track => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      // D. Appliquer l'offre distante
      await pc.setRemoteDescription(
        new RTCSessionDescription(pendingOfferRef.current)
      );

      // E. Ajouter les candidats ICE en attente
      for (const candidate of pendingCandidatesQueue.current) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingCandidatesQueue.current = [];

      // F. Créer et envoyer la réponse
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      signaling.sendSignal(callerId, 'answer', { 
        type: 'answer', 
        sdp: answer.sdp 
      });

    } catch (error: any) {
      console.error('❌ Erreur acceptation appel:', error);
      endCall(true);
    }
  }, [initializeLocalStream, createPeerConnection, signaling, endCall]);

  // 10. COMMANDES MÉDIA
  const toggleAudio = useCallback((enabled: boolean) => {
    if (localAudioTrackRef.current) {
      localAudioTrackRef.current.enabled = enabled;
      setIsAudioEnabled(enabled);
    }
  }, []);

  const toggleVideo = useCallback((enabled: boolean) => {
    if (localVideoTrackRef.current) {
      localVideoTrackRef.current.enabled = enabled;
      setIsVideoEnabled(enabled);
    }
  }, []);

  const switchCamera = useCallback(async () => {
    if (callTypeRef.current !== 'video' || !localStreamRef.current) return;
    
    try {
      const newCameraFacingMode = activeCameraRef.current === 'user' ? 'environment' : 'user';
      activeCameraRef.current = newCameraFacingMode;
      
      // Créer un nouveau flux avec l'autre caméra
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newCameraFacingMode },
        audio: isAudioEnabled
      });
      
      // Remplacer la piste vidéo
      const newVideoTrack = stream.getVideoTracks()[0];
      
      if (localVideoTrackRef.current && peerConnectionRef.current) {
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find(s => s.track?.kind === 'video');
        
        if (videoSender) {
          await videoSender.replaceTrack(newVideoTrack);
          localVideoTrackRef.current.stop();
          
          // Mettre à jour les références
          localVideoTrackRef.current = newVideoTrack;
          
          // Mettre à jour le flux local
          const audioTrack = localStreamRef.current.getAudioTracks()[0];
          const newStream = new MediaStream([audioTrack, newVideoTrack]);
          localStreamRef.current = newStream;
          setLocalStream(newStream);
        }
      }
      
      // Arrêter les pistes non utilisées
      stream.getTracks().forEach(track => {
        if (track.kind === 'audio') {
          track.stop();
        }
      });
      
    } catch (error) {
      console.error('❌ Erreur changement caméra:', error);
    }
  }, [isAudioEnabled]);

  return {
    localStream,
    remoteStream,
    callState,
    callType,
    isCaller,
    currentCall: currentCallRef.current,
    callUser,
    acceptCall,
    endCall,
    rejectCall,
    toggleAudio,
    toggleVideo,
    switchCamera
  };
};