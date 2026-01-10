/**
 * Hook WebRTC pour les appels audio/vidéo
 * 
 * CORRECTIFS APPLIQUÉS (Fix One-Way Audio):
 * - Logic déplacée : capture média et création PC dans acceptCall()
 * - case 'offer' : stocke uniquement l'offre et sonne (pas de média, pas de PC)
 * - acceptCall() : capture flux -> crée PC -> ajoute tracks -> setRemote -> createAnswer
 * - Gestion file d'attente ICE améliorée pour le mode 'ringing'
 * - Timeout d'expiration pour offre en attente
 */

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
  
  // Config ICE dynamique (chargée depuis le backend)
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([
    { urls: 'stun:stun.l.google.com:19302' } // Fallback minimal
  ]);
  
  // Refs pour éviter les race conditions
  const callTypeRef = useRef<CallType>('video');
  const isCallerRef = useRef<boolean>(false);
  const iceServersRef = useRef<RTCIceServer[]>(iceServers);
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // FIX ONE-WAY AUDIO: Stockage de l'offre en attente
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingOfferTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // File d'attente ICE candidates
  const pendingCandidatesQueue = useRef<RTCIceCandidateInit[]>([]);
  const isRemoteDescriptionSet = useRef<boolean>(false);

  const currentCallRef = useRef<{
    targetId: string | null;
    callerId: string | null;
  }>({ targetId: null, callerId: null });

  // Timeout pour ICE failed
  const disconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Charger la config ICE depuis le backend au montage
  useEffect(() => {
    const fetchIceConfig = async () => {
      try {
        console.log('🔄 Récupération config TURN...');
        const res = await fetch(`${API_BASE_URL}/api/webrtc-config`);
        const data = await res.json();
        if (data.iceServers) {
          setIceServers(data.iceServers);
          iceServersRef.current = data.iceServers;
          console.log('✅ Config TURN chargée:', data.iceServers.length, 'serveurs');
        }
      } catch (e) {
        console.error('❌ Erreur config TURN, usage fallback:', e);
      }
    };
    fetchIceConfig();
  }, []);

  // Sync ref avec state
  useEffect(() => {
    iceServersRef.current = iceServers;
  }, [iceServers]);

  /**
   * Gestionnaire d'erreur centralisé pour WebRTC
   */
  const handleCallError = useCallback((error: Error, context: string) => {
    console.error(`❌ WebRTC Error [${context}]:`, error);
    toast.error(`Appel échoué: ${error.message}`);
    return error;
  }, []);

  /**
   * Accès caméra/micro selon le type d'appel
   */
  const initializeLocalStream = useCallback(async (type: CallType): Promise<boolean> => {
    try {
      console.log(`📹 Initialisation média pour: ${type}`);
      
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: type === 'video' ? {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        } : false
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);
      
      console.log('✅ Stream obtenu:', {
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length
      });
      
      return true;
    } catch (error) {
      console.error('❌ Erreur média:', error);
      
      // Fallback audio si la vidéo échoue
      if (type === 'video') {
        try {
          console.log('🔄 Fallback: audio seul...');
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = audioStream;
          setLocalStream(audioStream);
          return true;
        } catch (audioError) {
          console.error('❌ Échec fallback audio:', audioError);
        }
      }
      return false;
    }
  }, []);

  /**
   * Nettoyage des ressources locales SANS envoyer de signal
   */
  const cleanupLocalResources = useCallback(() => {
    console.log('🧹 Nettoyage ressources locales...');

    // Annuler les timeouts
    if (disconnectTimeoutRef.current) {
      clearTimeout(disconnectTimeoutRef.current);
      disconnectTimeoutRef.current = null;
    }
    if (pendingOfferTimeoutRef.current) {
      clearTimeout(pendingOfferTimeoutRef.current);
      pendingOfferTimeoutRef.current = null;
    }

    // Fermer la connexion peer
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Arrêter les tracks média
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    // Reset state
    setLocalStream(null);
    setRemoteStream(null);
    setCallState('idle');
    setCallType('video');
    setIsCaller(false);
    
    // Reset refs
    currentCallRef.current = { targetId: null, callerId: null };
    isRemoteDescriptionSet.current = false;
    pendingCandidatesQueue.current = [];
    pendingOfferRef.current = null;
    isCallerRef.current = false;
    callTypeRef.current = 'video';
  }, []);

  /**
   * Fin d'appel avec signal optionnel
   */
  const endCall = useCallback((userInitiated = false) => {
    if (userInitiated) {
      console.log('🛑 Fin d\'appel (action utilisateur)');
      if (currentCallRef.current.targetId && signaling) {
        signaling.sendSignal(currentCallRef.current.targetId, 'call-ended');
      } else if (currentCallRef.current.callerId && signaling) {
        signaling.sendSignal(currentCallRef.current.callerId, 'call-ended');
      }
    }
    cleanupLocalResources();
  }, [signaling, cleanupLocalResources]);

  /**
   * Vidage immédiat de la file d'attente ICE
   */
  const processPendingCandidates = useCallback(async () => {
    if (!peerConnectionRef.current) return;

    const candidates = [...pendingCandidatesQueue.current];
    pendingCandidatesQueue.current = [];

    console.log(`🔄 Traitement ${candidates.length} ICE en attente`);

    for (const candidate of candidates) {
      try {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('✅ ICE ajouté depuis file');
      } catch (e) {
        // Ignorer les erreurs d'ufrag obsolète
        const errMsg = String(e);
        if (!errMsg.includes('ufrag')) {
          console.error('❌ Erreur ICE delayed:', e);
        }
      }
    }
  }, []);

  /**
   * Création PeerConnection avec serveurs ICE
   */
  const createPeerConnection = useCallback((targetId: string) => {
    console.log('🔧 Création PeerConnection vers', targetId);
    
    // Configuration ICE dynamique (chargée depuis le backend)
    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceCandidatePoolSize: 2,
      iceTransportPolicy: 'all' as RTCIceTransportPolicy
    });
    
    console.log('🔧 PeerConnection créée avec', iceServersRef.current.length, 'serveurs ICE');

    pc.onicegatheringstatechange = () => {
      console.log('🧊 ICE gathering state:', pc.iceGatheringState);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && signaling) {
        const candidateType = event.candidate.type || 'unknown';
        console.log(`🧊 ICE candidate: type=${candidateType}`);
        signaling.sendSignal(targetId, 'ice-candidate', event.candidate.toJSON());
      }
    };

    pc.ontrack = (event) => {
      console.log('📥 Track distant reçu:', event.track.kind, 'muted:', event.track.muted);
      
      // Gestionnaires pour les tracks muets
      event.track.onmute = () => {
        console.log('⚠️ Track distant muet:', event.track.kind);
      };
      
      event.track.onunmute = () => {
        console.log('✅ Track distant restauré:', event.track.kind);
      };
      
      event.track.onended = () => {
        console.log('🔇 Track distant terminé:', event.track.kind);
      };
      
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      } else {
        // Créer un MediaStream si pas fourni
        const stream = new MediaStream();
        stream.addTrack(event.track);
        setRemoteStream(stream);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('🌐 ICE state:', pc.iceConnectionState);

      if (disconnectTimeoutRef.current) {
        clearTimeout(disconnectTimeoutRef.current);
        disconnectTimeoutRef.current = null;
      }

      if (['connected', 'completed'].includes(pc.iceConnectionState)) {
        setCallState('connected');
        // Log transceivers pour debug
        const transceivers = pc.getTransceivers();
        console.log('📡 Transceivers après connexion:', transceivers.map(t => ({
          mid: t.mid,
          direction: t.direction,
          senderTrack: t.sender?.track?.kind || 'none',
          receiverTrack: t.receiver?.track?.kind || 'none'
        })));
      }

      if (pc.iceConnectionState === 'disconnected') {
        try { pc.restartIce(); } catch (e) { /* ignore */ }
      }

      if (pc.iceConnectionState === 'failed') {
        console.log('⚠️ ICE failed - attente 3s...');
        disconnectTimeoutRef.current = setTimeout(() => {
          if (peerConnectionRef.current?.iceConnectionState === 'failed') {
            console.log('❌ ICE définitivement failed');
            cleanupLocalResources();
          }
        }, 3000);
      }
    };

    return pc;
  }, [signaling, cleanupLocalResources]);

  /**
   * Gestionnaire signaux WebSocket
   */
  useEffect(() => {
    if (!signaling) return;

    const handleSignalMessage = async (message: any) => {
      if (!message) return;
      const { type, sender_id, payload, data } = message;
      const signalData = data || payload || {};
      const sdpData = payload || signalData.sdp || signalData;

      switch (type) {
        case 'offer':
          // FIX ONE-WAY AUDIO: On ne fait QUE stocker l'offre et sonner
          // Pas de média, pas de PeerConnection ici!
          console.log('🔔 Offre reçue de', sender_id);
          
          if (!sdpData || !sdpData.sdp) {
            console.error('❌ Offre invalide: pas de SDP');
            return;
          }

          // Correction du type SDP si nécessaire
          if (!sdpData.type || sdpData.type === 'null') {
            sdpData.type = 'offer';
          }

          // Reset si nécessaire
          if (callState !== 'idle') {
            cleanupLocalResources();
          }

          // Déterminer le type d'appel
          const incomingType: CallType = (payload?.callType === 'audio' || sdpData?.callType === 'audio') ? 'audio' : 'video';
          console.log('📞 Type d\'appel entrant:', incomingType);

          // STOCKER L'OFFRE (sera traitée dans acceptCall)
          pendingOfferRef.current = sdpData;
          
          // Timeout d'expiration de l'offre (60s)
          if (pendingOfferTimeoutRef.current) {
            clearTimeout(pendingOfferTimeoutRef.current);
          }
          pendingOfferTimeoutRef.current = setTimeout(() => {
            if (pendingOfferRef.current) {
              console.log('🕒 Offre expirée');
              pendingOfferRef.current = null;
              if (callState === 'ringing') {
                cleanupLocalResources();
              }
            }
          }, 60000);

          // Mettre à jour l'état pour faire sonner
          currentCallRef.current = { targetId: sender_id, callerId: sender_id };
          setCallType(incomingType);
          callTypeRef.current = incomingType;
          setIsCaller(false);
          isCallerRef.current = false;
          setCallState('ringing');
          break;

        case 'answer':
          if (!isCallerRef.current || !peerConnectionRef.current) {
            console.log('⚠️ Answer ignorée: pas d\'appel sortant');
            return;
          }
          
          console.log('✅ Answer reçue de', sender_id);

          try {
            // Correction du type SDP
            if (!sdpData.type || sdpData.type === 'null') {
              sdpData.type = 'answer';
            }

            await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(sdpData));
            isRemoteDescriptionSet.current = true;
            
            // Traiter les ICE en attente
            await processPendingCandidates();
            
            // Vérifier les transceivers
            const transceivers = peerConnectionRef.current.getTransceivers();
            console.log('📡 CALLER Transceivers après answer:', transceivers.map(t => ({
              mid: t.mid,
              direction: t.direction,
              senderTrack: t.sender?.track?.kind || 'none',
              receiverTrack: t.receiver?.track?.kind || 'none',
              receiverMuted: t.receiver?.track?.muted
            })));

            setCallState('connected');
            console.log('✅ Appel connecté (caller)');
          } catch (err) {
            console.error('❌ Erreur traitement answer:', err);
            handleCallError(err instanceof Error ? err : new Error(String(err)), 'answer');
          }
          break;

        case 'ice-candidate':
          // Toujours accepter les ICE, même en ringing (on les queue)
          if (peerConnectionRef.current && isRemoteDescriptionSet.current) {
            try {
              await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(payload));
            } catch (e) {
              const errMsg = String(e);
              if (!errMsg.includes('ufrag')) {
                console.error('❌ Erreur ICE:', e);
              }
            }
          } else {
            // En ringing ou avant setRemoteDescription -> queue
            console.log('📦 ICE mis en file (en attente)');
            pendingCandidatesQueue.current.push(payload);
          }
          break;

        case 'call-rejected':
          console.log('📞 Appel rejeté par', sender_id);
          toast.info('Appel rejeté');
          cleanupLocalResources();
          break;

        case 'call-ended':
          console.log('📞 Appel terminé par', sender_id);
          cleanupLocalResources();
          break;

        case 'error':
          console.error('📥 Erreur signaling:', message);
          if (isCallerRef.current) {
            toast.error(message.message || 'Erreur de connexion');
            cleanupLocalResources();
          }
          break;
      }
    };

    signaling.onMessage(handleSignalMessage);
  }, [signaling, callState, cleanupLocalResources, processPendingCandidates, handleCallError]);

  /**
   * Appeler un utilisateur (CALLER)
   */
  const callUser = useCallback(async (targetId: string, type: CallType = 'video') => {
    if (!currentUserId || !signaling) {
      console.log('⚠️ Impossible d\'appeler: pas connecté');
      return;
    }

    try {
      // Reset propre
      cleanupLocalResources();
      
      console.log('📞 Démarrage appel vers', targetId, '- type:', type);
      
      setCallState('calling');
      setCallType(type);
      callTypeRef.current = type;
      setIsCaller(true);
      isCallerRef.current = true;
      currentCallRef.current = { targetId, callerId: currentUserId };

      // 1. Initialiser le média
      const mediaOk = await initializeLocalStream(type);
      if (!mediaOk) {
        throw new Error('Impossible d\'accéder au micro/caméra');
      }

      // 2. Créer la PeerConnection
      const pc = createPeerConnection(targetId);
      peerConnectionRef.current = pc;
      isRemoteDescriptionSet.current = false;
      pendingCandidatesQueue.current = [];

      // 3. Ajouter les tracks locaux (crée automatiquement les transceivers)
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          console.log(`📤 CALLER: Ajout track ${track.kind}`);
          pc.addTrack(track, localStreamRef.current!);
        });
        
        // Forcer les transceivers en sendrecv
        pc.getTransceivers().forEach(t => {
          if (t.direction === 'sendonly') {
            t.direction = 'sendrecv';
          }
        });
      }

      // 5. Créer et envoyer l'offre
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === 'video'
      });
      
      if (!offer.type) {
        (offer as any).type = 'offer';
      }
      
      await pc.setLocalDescription(offer);

      console.log('📤 Envoi offer:', { type: offer.type, sdpLength: offer.sdp?.length });
      
      signaling.sendSignal(targetId, 'offer', {
        type: offer.type,
        sdp: offer.sdp,
        callType: type
      });

      console.log('✅ Offre envoyée');

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      handleCallError(err, 'callUser');
      cleanupLocalResources();
    }
  }, [currentUserId, signaling, initializeLocalStream, createPeerConnection, cleanupLocalResources, handleCallError]);

  /**
   * Accepter un appel (CALLEE) - APPROCHE SIMPLIFIÉE
   * Pattern: PC -> setRemote -> getTracks -> replaceTrack sur transceivers -> createAnswer
   */
  const acceptCall = useCallback(async () => {
    if (!currentCallRef.current.callerId || !pendingOfferRef.current) {
      console.error('❌ acceptCall: offre ou caller manquant');
      return;
    }

    const callerId = currentCallRef.current.callerId;
    const storedOffer = pendingOfferRef.current;

    try {
      console.log('✅ Acceptation appel de', callerId);

      // 1. Initialiser le média
      const mediaOk = await initializeLocalStream(callTypeRef.current);
      if (!mediaOk) {
        throw new Error('Impossible d\'accéder au micro/caméra');
      }

      // 2. Créer la PeerConnection
      const pc = createPeerConnection(callerId);
      peerConnectionRef.current = pc;

      // 3. DÉFINIR L'OFFRE DISTANTE EN PREMIER (crée les transceivers)
      await pc.setRemoteDescription(new RTCSessionDescription(storedOffer));
      isRemoteDescriptionSet.current = true;
      console.log('✅ Remote description set');

      // 4. Récupérer les transceivers créés par l'offre et y attacher nos tracks
      const transceivers = pc.getTransceivers();
      console.log(`📡 CALLEE: ${transceivers.length} transceivers après setRemote`);
      
      if (localStreamRef.current) {
        const localTracks = localStreamRef.current.getTracks();
        console.log(`📤 CALLEE: ${localTracks.length} tracks locaux à attacher`);
        
        for (const track of localTracks) {
          // Trouver le transceiver correspondant au type de track
          const transceiver = transceivers.find(t => 
            t.receiver.track?.kind === track.kind
          );
          
          if (transceiver) {
            // Remplacer le track du sender par notre track local
            await transceiver.sender.replaceTrack(track);
            // Forcer la direction en sendrecv
            transceiver.direction = 'sendrecv';
            console.log(`✅ Track ${track.kind} attaché via replaceTrack (dir: sendrecv)`);
          } else {
            // Pas de transceiver existant, en créer un nouveau
            pc.addTrack(track, localStreamRef.current!);
            console.log(`✅ Track ${track.kind} ajouté via addTrack`);
          }
        }
      } else {
        throw new Error('Stream local non disponible');
      }

      // 5. Traiter les candidats ICE en attente
      await processPendingCandidates();

      // 6. Créer et envoyer la réponse
      const answer = await pc.createAnswer();
      if (!answer.type) (answer as any).type = 'answer';
      await pc.setLocalDescription(answer);

      // 7. Debug: vérifier l'état final des transceivers
      const finalTransceivers = pc.getTransceivers();
      console.log('📡 CALLEE Transceivers FINAL:', finalTransceivers.map(t => ({
        mid: t.mid,
        direction: t.direction,
        senderTrack: t.sender?.track?.kind || 'none',
        senderEnabled: t.sender?.track?.enabled,
        receiverTrack: t.receiver?.track?.kind || 'none'
      })));

      // 8. Envoyer la réponse
      console.log('📤 Envoi answer:', { type: answer.type, sdpLength: answer.sdp?.length });
      signaling.sendSignal(callerId, 'answer', {
        type: answer.type,
        sdp: answer.sdp
      });

      setCallState('connected');
      pendingOfferRef.current = null;
      console.log('✅ Answer envoyée - Appel connecté (callee)');

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      handleCallError(err, 'acceptCall');
      if (signaling && callerId) {
        signaling.sendSignal(callerId, 'call-ended');
      }
      cleanupLocalResources();
    }
  }, [initializeLocalStream, createPeerConnection, processPendingCandidates, signaling, cleanupLocalResources, handleCallError]);

  /**
   * Rejeter un appel
   */
  const rejectCall = useCallback(() => {
    if (currentCallRef.current.callerId && signaling) {
      signaling.sendSignal(currentCallRef.current.callerId, 'call-rejected');
    }
    cleanupLocalResources();
  }, [signaling, cleanupLocalResources]);

  /**
   * Cleanup au démontage
   */
  useEffect(() => {
    return () => {
      console.log('🧹 useWebRTC unmount cleanup');
      if (disconnectTimeoutRef.current) {
        clearTimeout(disconnectTimeoutRef.current);
      }
      if (pendingOfferTimeoutRef.current) {
        clearTimeout(pendingOfferTimeoutRef.current);
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

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
    rejectCall
  };
};
