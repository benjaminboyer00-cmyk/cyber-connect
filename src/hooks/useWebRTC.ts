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
  
  // Configuration avancée
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ]);
  
  // Références
  const callTypeRef = useRef<CallType>('video');
  const isCallerRef = useRef<boolean>(false);
  const iceServersRef = useRef<RTCIceServer[]>(iceServers);
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
  const [activeCamera, setActiveCamera] = useState<'user' | 'environment'>('user');

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
          servers.push(...iceServers);
        }
        
        setIceServers(servers);
        iceServersRef.current = servers;
        console.log('✅ Configuration ICE chargée:', servers.length, 'serveurs');
      } catch (error) {
        console.error('⚠️ Erreur chargement config ICE, fallback:', error);
        iceServersRef.current = iceServers;
      }
    };
    
    fetchIceConfig();
  }, []);

  // 2. GESTION CAMÉRA/MICRO AVANCÉE
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
          track.enabled = false;
        });
        localStreamRef.current = null;
      }
      
      // Configuration média
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        },
        video: type === 'video' ? {
          facingMode: cameraFacingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
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
      console.log(`✅ Flux ${type} initialisé:`, {
        audio: audioTracks.length,
        video: videoTracks.length
      });
      
      return true;
    } catch (error: any) {
      console.error('❌ Erreur initialisation média:', error);
      
      // Gestion des erreurs spécifiques
      if (error.name === 'NotAllowedError') {
        toast.error("Accès à la caméra/micro refusé. Veuillez autoriser l'accès.");
      } else if (error.name === 'NotFoundError') {
        toast.error("Aucun périphérique média trouvé.");
      } else if (error.name === 'NotReadableError') {
        toast.error("Le périphérique est déjà utilisé par une autre application.");
      } else {
        toast.error("Erreur d'accès aux périphériques média.");
      }
      
      return false;
    }
  }, [isAudioEnabled, isVideoEnabled]);

  // 3. NETTOYAGE COMPLET
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
        track.enabled = false;
      });
      localStreamRef.current = null;
    }
    
    // Arrêter les pistes distantes
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      remoteStreamRef.current = null;
    }
    
    // Réinitialiser les refs
    localAudioTrackRef.current = null;
    localVideoTrackRef.current = null;
    remoteAudioTrackRef.current = null;
    remoteVideoTrackRef.current = null;
    
    // Réinitialiser les états
    setLocalStream(null);
    setRemoteStream(null);
    setCallState('idle');
    pendingCandidatesQueue.current = [];
    pendingOfferRef.current = null;
    isCallerRef.current = false;
    setIsCaller(false);
    
    currentCallRef.current = { targetId: null, callerId: null };
    
    console.log('✅ Nettoyage terminé');
  }, []);

  // 4. CRÉATION CONNEXION ROBUSTE
  const createPeerConnection = useCallback((targetId: string) => {
    console.log('🔗 Création connexion WebRTC pour:', targetId);
    
    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      sdpSemantics: 'unified-plan'
    });

    // Gestion des candidats ICE
    pc.onicecandidate = (event) => {
      if (event.candidate && signaling) {
        console.log('📤 Envoi candidat ICE:', event.candidate.candidate);
        signaling.sendSignal(targetId, 'ice-candidate', event.candidate.toJSON());
      }
    };

    // Gestion des pistes distantes (MÉTHODE CORRIGÉE)
    pc.ontrack = (event) => {
      console.log('📥 Réception piste distante:', event.track.kind, event.track.id);
      
      // S'assurer qu'on a bien un flux
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
        setRemoteStream(remoteStreamRef.current);
      }
      
      // Vérifier si la piste existe déjà
      const existingTrack = remoteStreamRef.current
        .getTracks()
        .find(t => t.id === event.track.id);
      
      if (!existingTrack) {
        // Ajouter la piste au flux distant
        remoteStreamRef.current.addTrack(event.track);
        
        // Stocker la référence
        if (event.track.kind === 'audio') {
          remoteAudioTrackRef.current = event.track;
        } else if (event.track.kind === 'video') {
          remoteVideoTrackRef.current = event.track;
        }
        
        console.log(`✅ Piste ${event.track.kind} ajoutée au flux distant`);
        
        // Forcer la mise à jour du state
        setRemoteStream(new MediaStream(remoteStreamRef.current.getTracks()));
      }
      
      // Écouter la fin de la piste
      event.track.onended = () => {
        console.log(`⏹️ Piste distante ${event.track.kind} terminée`);
      };
    };

    // Surveiller l'état de la connexion
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log('🌐 État ICE:', state);
      
      switch (state) {
        case 'connected':
          console.log('✅ Connexion WebRTC établie!');
          setCallState('connected');
          toast.success('Connexion établie');
          break;
        case 'disconnected':
          console.warn('⚠️ Connexion WebRTC perdue');
          toast.warning('Connexion instable...');
          break;
        case 'failed':
          console.error('❌ Échec connexion WebRTC');
          toast.error('Échec de la connexion');
          cleanupLocalResources();
          break;
        case 'closed':
          console.log('🔒 Connexion WebRTC fermée');
          break;
      }
    };

    // Surveiller l'état de la négociation
    pc.onnegotiationneeded = async () => {
      console.log('🔄 Négociation nécessaire');
    };

    // Surveiller les changements de signaux
    pc.onsignalingstatechange = () => {
      console.log('📡 État signalisation:', pc.signalingState);
    };

    return pc;
  }, [signaling, cleanupLocalResources]);

  // 5. GESTION DES SIGNALISATIONS
  useEffect(() => {
    if (!signaling) return;

    const handleSignal = async (msg: any) => {
      const { type, sender_id, payload, data } = msg;
      const sdp = payload || data?.sdp || data;
      
      console.log('📨 Signal reçu:', type, 'de', sender_id);

      switch (type) {
        case 'offer':
          console.log('🔔 Offre reçue de', sender_id);
          
          // Détection type d'appel
          const isVideo = sdp.sdp?.includes('m=video');
          const detectedType = isVideo ? 'video' : 'audio';
          
          pendingOfferRef.current = sdp;
          currentCallRef.current = { targetId: sender_id, callerId: sender_id };
          
          setCallType(detectedType);
          callTypeRef.current = detectedType;
          setIsCaller(false);
          isCallerRef.current = false;
          
          setCallState('ringing');
          toast.info(`Appel ${detectedType} entrant...`);
          break;

        case 'answer':
          console.log('✅ Réponse reçue');
          if (peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'closed') {
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
              
              console.log('✅ Description distante appliquée');
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
              console.log('✅ Candidat ICE ajouté');
            } catch (error) {
              console.error('❌ Erreur ajout candidat ICE:', error);
            }
          } else {
            pendingCandidatesQueue.current.push(payload);
            console.log('📦 Candidat ICE mis en file d\'attente');
          }
          break;

        case 'call-ended':
          console.log('📞 Appel terminé par l\'autre partie');
          toast.info('Appel terminé');
          cleanupLocalResources();
          break;

        case 'call-rejected':
          console.log('❌ Appel rejeté');
          toast.warning('Appel rejeté');
          cleanupLocalResources();
          break;
          
        case 'media-toggle':
          console.log('🎚️ Commande média reçue:', payload);
          if (payload.audio !== undefined) {
            // Ici, vous pouvez ajuster le volume ou autres paramètres
          }
          break;
      }
    };

    signaling.onMessage(handleSignal);
    
    return () => {
      signaling.offMessage(handleSignal);
    };
  }, [signaling, cleanupLocalResources]);

  // 6. LANCER UN APPEL (CALLER)
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
        toast.error('Impossible d\'accéder aux périphériques média');
        setCallState('failed');
        return;
      }

      // B. Créer la connexion peer
      const pc = createPeerConnection(targetId);
      peerConnectionRef.current = pc;

      // C. Ajouter TOUTES les pistes locales
      if (localStreamRef.current) {
        const tracks = localStreamRef.current.getTracks();
        console.log(`➕ Ajout de ${tracks.length} pistes locales`);
        
        tracks.forEach(track => {
          const sender = pc.addTrack(track, localStreamRef.current!);
          
          // Surveiller les changements de piste
          sender.track?.addEventListener('ended', () => {
            console.log(`⏹️ Piste locale ${track.kind} terminée`);
          });
        });
      }

      // D. Créer et envoyer l'offre
      const offerOptions: RTCOfferOptions = {
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === 'video',
        iceRestart: false,
        voiceActivityDetection: true
      };

      console.log('🔄 Création offre...');
      const offer = await pc.createOffer(offerOptions);
      
      await pc.setLocalDescription(offer);
      
      console.log('📤 Envoi offre...');
      signaling.sendSignal(targetId, 'offer', { 
        type: 'offer', 
        sdp: offer.sdp,
        callType: type
      });

      // E. Timeout pour la réponse
      setTimeout(() => {
        if (callState === 'calling') {
          console.log('⏰ Timeout appel non répondu');
          toast.error('Appel non répondu');
          endCall(true);
        }
      }, 45000); // 45 secondes

    } catch (error: any) {
      console.error('❌ Erreur lors de l\'appel:', error);
      toast.error(`Erreur: ${error.message || 'Échec de l\'appel'}`);
      setCallState('failed');
      cleanupLocalResources();
    }
  }, [currentUserId, signaling, initializeLocalStream, createPeerConnection, cleanupLocalResources, callState]);

  // 7. ACCEPTER UN APPEL (CALLEE)
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
        toast.error('Impossible d\'accéder aux périphériques média');
        endCall(true);
        return;
      }

      // B. Créer la connexion peer
      const pc = createPeerConnection(callerId);
      peerConnectionRef.current = pc;

      // C. Ajouter TOUTES les pistes locales
      if (localStreamRef.current) {
        const tracks = localStreamRef.current.getTracks();
        console.log(`➕ Ajout de ${tracks.length} pistes locales (acceptation)`);
        
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

      console.log('✅ Appel accepté et réponse envoyée');
      toast.success('Appel connecté');

    } catch (error: any) {
      console.error('❌ Erreur acceptation appel:', error);
      toast.error(`Erreur: ${error.message || 'Échec de l\'acceptation'}`);
      endCall(true);
    }
  }, [initializeLocalStream, createPeerConnection, signaling, endCall]);

  // 8. COMMANDES MÉDIA
  const toggleAudio = useCallback((enabled: boolean) => {
    if (localAudioTrackRef.current) {
      localAudioTrackRef.current.enabled = enabled;
      setIsAudioEnabled(enabled);
      
      // Informer l'autre partie
      if (currentCallRef.current.targetId) {
        signaling.sendSignal(currentCallRef.current.targetId, 'media-toggle', {
          audio: enabled
        });
      }
      
      console.log(`🎤 Audio ${enabled ? 'activé' : 'désactivé'}`);
    }
  }, [signaling]);

  const toggleVideo = useCallback((enabled: boolean) => {
    if (localVideoTrackRef.current) {
      localVideoTrackRef.current.enabled = enabled;
      setIsVideoEnabled(enabled);
      
      // Si on désactive la vidéo, on peut aussi remplacer par une piste noire
      if (!enabled && callType === 'video') {
        // Optionnel: envoyer une frame noire
      }
      
      // Informer l'autre partie
      if (currentCallRef.current.targetId) {
        signaling.sendSignal(currentCallRef.current.targetId, 'media-toggle', {
          video: enabled
        });
      }
      
      console.log(`📹 Vidéo ${enabled ? 'activée' : 'désactivée'}`);
    }
  }, [signaling, callType]);

  const switchCamera = useCallback(async () => {
    if (callType !== 'video' || !localStreamRef.current) return;
    
    try {
      const newCameraFacingMode = activeCamera === 'user' ? 'environment' : 'user';
      
      // Créer un nouveau flux avec l'autre caméra
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newCameraFacingMode },
        audio: isAudioEnabled
      });
      
      // Remplacer la piste vidéo
      const newVideoTrack = stream.getVideoTracks()[0];
      const oldVideoTrack = localVideoTrackRef.current;
      
      if (oldVideoTrack && peerConnectionRef.current) {
        // Récupérer le sender vidéo
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find(s => s.track?.kind === 'video');
        
        if (videoSender) {
          await videoSender.replaceTrack(newVideoTrack);
          oldVideoTrack.stop();
          
          // Mettre à jour les références
          localVideoTrackRef.current = newVideoTrack;
          
          // Mettre à jour le flux local
          if (localStreamRef.current) {
            const audioTrack = localStreamRef.current.getAudioTracks()[0];
            const newStream = new MediaStream([audioTrack, newVideoTrack]);
            localStreamRef.current = newStream;
            setLocalStream(newStream);
          }
          
          setActiveCamera(newCameraFacingMode);
          console.log(`🔄 Caméra changée: ${newCameraFacingMode}`);
        }
      }
      
      // Arrêter les pistes non utilisées du nouveau flux
      stream.getTracks().forEach(track => {
        if (track.kind === 'audio' || track !== newVideoTrack) {
          track.stop();
        }
      });
      
    } catch (error) {
      console.error('❌ Erreur changement caméra:', error);
      toast.error('Impossible de changer de caméra');
    }
  }, [callType, activeCamera, isAudioEnabled]);

  // 9. TERMINER L'APPEL
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

  // 10. REJETER L'APPEL
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

  // 11. GESTION DES ERREURS RÉSEAU
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (callState !== 'idle') {
        endCall(true);
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [callState, endCall]);

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