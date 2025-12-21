import { useState, useEffect, useRef, useCallback } from 'react';

export type CallState = 'idle' | 'calling' | 'ringing' | 'connected' | 'failed';

interface UseWebRTCReturn {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  callState: CallState;
  isCaller: boolean;
  currentCall: { targetId: string | null; callerId: string | null };
  callUser: (targetId: string) => Promise<void>;
  acceptCall: () => Promise<void>;
  endCall: () => void;
  rejectCall: () => void;
}

export const useWebRTC = (
  currentUserId: string | null,
  signaling: any
): UseWebRTCReturn => {
  const [callState, setCallState] = useState<CallState>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCaller, setIsCaller] = useState(false);
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  
  // File d'attente pour les ICE candidates
  const pendingCandidatesQueue = useRef<RTCIceCandidate[]>([]);
  const isRemoteDescriptionSet = useRef<boolean>(false);
  
  const currentCallRef = useRef<{
    targetId: string | null;
    callerId: string | null;
  }>({ targetId: null, callerId: null });

  const initializeLocalStream = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      return true;
    } catch (error) {
      console.error('❌ Erreur accès média:', error);
      setCallState('failed');
      return false;
    }
  }, []);

  const endCall = useCallback(() => {
    console.log('🛑 Fin d\'appel');
    
    if (currentCallRef.current.targetId && signaling) {
      signaling.sendSignal(currentCallRef.current.targetId, 'call-ended');
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    setCallState('idle');
    setRemoteStream(null);
    setIsCaller(false);
    currentCallRef.current = { targetId: null, callerId: null };
    isRemoteDescriptionSet.current = false;
    pendingCandidatesQueue.current = [];

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }
  }, [signaling]);

  const createPeerConnection = useCallback(() => {
    const config: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10
    };

    const pc = new RTCPeerConnection(config);
    
    pc.onicecandidate = (event) => {
      if (event.candidate && currentCallRef.current.targetId && signaling) {
        console.log('📤 Envoi ICE candidate à', currentCallRef.current.targetId);
        signaling.sendSignal(currentCallRef.current.targetId, 'ice-candidate', event.candidate.toJSON());
      }
    };

    pc.ontrack = (event) => {
      console.log('📥 Réception track distant');
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('🌐 ICE connection state:', pc.iceConnectionState);
      
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        setCallState('connected');
      } else if (pc.iceConnectionState === 'disconnected' || 
          pc.iceConnectionState === 'failed' ||
          pc.iceConnectionState === 'closed') {
        console.log('🔌 Connexion ICE terminée');
        endCall();
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('🔗 PeerConnection state:', pc.connectionState);
    };

    return pc;
  }, [signaling, endCall]);

  const processPendingCandidates = useCallback(async () => {
    if (!peerConnectionRef.current) return;

    console.log(`🔄 Traitement de ${pendingCandidatesQueue.current.length} candidats en attente`);
    
    while (pendingCandidatesQueue.current.length > 0) {
      const candidate = pendingCandidatesQueue.current.shift();
      if (candidate) {
        try {
          await peerConnectionRef.current.addIceCandidate(candidate);
          console.log('✅ Candidat ICE ajouté depuis la file d\'attente');
        } catch (error) {
          console.error('❌ Erreur ajout candidat en attente:', error);
        }
      }
    }
  }, []);

  // Gestion des messages de signalisation
  useEffect(() => {
    if (!signaling) return;

    const handleSignalMessage = async (message: any) => {
      console.log(`📥 Message ${message.type} de ${message.sender_id}`);

      switch (message.type) {
        case 'offer':
          if (callState !== 'idle') {
            console.log('⚠️ En appel, ignore offre');
            return;
          }

          try {
            setCallState('ringing');
            currentCallRef.current = {
              targetId: message.sender_id,
              callerId: message.sender_id
            };
            setIsCaller(false);

            await initializeLocalStream();

            const pc = createPeerConnection();
            peerConnectionRef.current = pc;
            isRemoteDescriptionSet.current = false;
            pendingCandidatesQueue.current = [];

            if (localStreamRef.current) {
              localStreamRef.current.getTracks().forEach(track => {
                pc.addTrack(track, localStreamRef.current!);
              });
            }

            await pc.setRemoteDescription(new RTCSessionDescription(message.payload));
            isRemoteDescriptionSet.current = true;

            await processPendingCandidates();

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            signaling.sendSignal(message.sender_id, 'answer', answer);

          } catch (error) {
            console.error('❌ Erreur traitement offre:', error);
            endCall();
          }
          break;

        case 'answer':
          if (callState !== 'calling' || !peerConnectionRef.current) {
            console.log('⚠️ Pas en appel ou PeerConnection manquante');
            return;
          }

          try {
            const pc = peerConnectionRef.current;
            
            await pc.setRemoteDescription(new RTCSessionDescription(message.payload));
            isRemoteDescriptionSet.current = true;
            
            await processPendingCandidates();
            
            console.log('✅ Réponse traitée, connexion établie');
          } catch (error) {
            console.error('❌ Erreur traitement réponse:', error);
            endCall();
          }
          break;

        case 'ice-candidate':
          try {
            const candidate = new RTCIceCandidate(message.payload);
            const pc = peerConnectionRef.current;

            if (pc && isRemoteDescriptionSet.current) {
              await pc.addIceCandidate(candidate);
              console.log('✅ Candidat ICE ajouté immédiatement');
            } else {
              pendingCandidatesQueue.current.push(candidate);
              console.log('📦 Candidat ICE mis en file d\'attente');
            }
          } catch (error) {
            console.error('❌ Erreur traitement ICE candidate:', error);
          }
          break;

        case 'call-rejected':
          console.log('📞 Appel rejeté');
          endCall();
          break;

        case 'call-ended':
          console.log('📞 Appel terminé par l\'autre partie');
          endCall();
          break;
      }
    };

    signaling.onMessage(handleSignalMessage);
  }, [signaling, callState, initializeLocalStream, createPeerConnection, processPendingCandidates, endCall]);

  const callUser = useCallback(async (targetId: string) => {
    if (callState !== 'idle' || !currentUserId || !signaling) {
      console.log('⚠️ Impossible d\'appeler: déjà en appel ou userId manquant');
      return;
    }

    try {
      setCallState('calling');
      currentCallRef.current = { targetId, callerId: currentUserId };
      setIsCaller(true);

      const streamReady = await initializeLocalStream();
      if (!streamReady) {
        endCall();
        return;
      }

      const pc = createPeerConnection();
      peerConnectionRef.current = pc;
      isRemoteDescriptionSet.current = false;
      pendingCandidatesQueue.current = [];

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await pc.setLocalDescription(offer);

      signaling.sendSignal(targetId, 'offer', offer);

      console.log('📞 Appel initié vers', targetId);

    } catch (error) {
      console.error('❌ Erreur initiation appel:', error);
      endCall();
    }
  }, [callState, currentUserId, signaling, initializeLocalStream, createPeerConnection, endCall]);

  const acceptCall = useCallback(async () => {
    if (callState !== 'ringing' || !peerConnectionRef.current || !currentCallRef.current.callerId) {
      console.log('⚠️ Aucun appel à accepter');
      return;
    }

    try {
      setCallState('connected');
      console.log('✅ Appel accepté');
    } catch (error) {
      console.error('❌ Erreur acceptation appel:', error);
      endCall();
    }
  }, [callState, endCall]);

  const rejectCall = useCallback(() => {
    if (callState === 'ringing' && currentCallRef.current.callerId && signaling) {
      signaling.sendSignal(currentCallRef.current.callerId, 'call-rejected');
    }
    endCall();
  }, [callState, signaling, endCall]);

  useEffect(() => {
    return () => {
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
    isCaller,
    currentCall: currentCallRef.current,
    callUser,
    acceptCall,
    endCall,
    rejectCall
  };
};
