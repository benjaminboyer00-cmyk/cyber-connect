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

  // File d'attente ICE candidates (FIX CRITIQUE)
  const pendingCandidatesQueue = useRef<RTCIceCandidateInit[]>([]);
  const isRemoteDescriptionSet = useRef<boolean>(false);

  const currentCallRef = useRef<{
    targetId: string | null;
    callerId: string | null;
  }>({ targetId: null, callerId: null });

  // Timeout pour ICE disconnected (évite les faux positifs)
  const disconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Accès caméra/micro
  const initializeLocalStream = useCallback(async (): Promise<boolean> => {
    try {
      console.log('📹 Initialisation média...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      console.log('✅ Média initialisé');
      return true;
    } catch (error) {
      console.error('❌ Erreur média:', error);
      setCallState('failed');
      return false;
    }
  }, []);

  // 2. Fin d'appel (avec protection contre appels multiples)
  const endCall = useCallback(() => {
    // Éviter les appels multiples si déjà idle
    if (callState === 'idle') {
      console.log('⚠️ Déjà en idle, ignore endCall');
      return;
    }

    console.log('🛑 Fin d\'appel');

    // Annuler le timeout de déconnexion si actif
    if (disconnectTimeoutRef.current) {
      clearTimeout(disconnectTimeoutRef.current);
      disconnectTimeoutRef.current = null;
    }

    if (currentCallRef.current.targetId && signaling) {
      signaling.sendSignal(currentCallRef.current.targetId, 'call-ended');
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    setLocalStream(null);
    setRemoteStream(null);
    setCallState('idle');
    setIsCaller(false);
    currentCallRef.current = { targetId: null, callerId: null };
    isRemoteDescriptionSet.current = false;
    pendingCandidatesQueue.current = [];
  }, [signaling, callState]);

  // 3. Création PeerConnection
  const createPeerConnection = useCallback((targetId: string) => {
    console.log('🔧 Création PeerConnection vers', targetId);
    
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && signaling) {
        console.log('📤 Envoi ICE candidate');
        signaling.sendSignal(targetId, 'ice-candidate', event.candidate.toJSON());
      }
    };

    pc.ontrack = (event) => {
      console.log('📥 Track distant reçu');
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('🌐 ICE state:', pc.iceConnectionState);
      
      // Annuler tout timeout précédent
      if (disconnectTimeoutRef.current) {
        clearTimeout(disconnectTimeoutRef.current);
        disconnectTimeoutRef.current = null;
      }

      if (['connected', 'completed'].includes(pc.iceConnectionState)) {
        setCallState('connected');
      } else if (pc.iceConnectionState === 'disconnected') {
        // 'disconnected' est souvent transitoire - attendre 3s avant de couper
        console.log('⏳ ICE disconnected - attente 3s avant timeout...');
        disconnectTimeoutRef.current = setTimeout(() => {
          if (peerConnectionRef.current?.iceConnectionState === 'disconnected') {
            console.log('⏰ Timeout ICE - fin d\'appel');
            endCall();
          }
        }, 3000);
      } else if (pc.iceConnectionState === 'failed') {
        // 'failed' est fatal - fin immédiate
        console.log('❌ ICE failed - fin d\'appel');
        endCall();
      }
      // 'closed' n'appelle plus endCall() car c'est nous qui fermons
    };

    return pc;
  }, [signaling, endCall]);

  // 4. Vidage file d'attente ICE
  const processPendingCandidates = useCallback(async () => {
    if (!peerConnectionRef.current) return;

    console.log(`🔄 Traitement ${pendingCandidatesQueue.current.length} ICE en attente`);

    while (pendingCandidatesQueue.current.length > 0) {
      const candidate = pendingCandidatesQueue.current.shift();
      if (candidate) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          console.log('✅ ICE ajouté depuis file');
        } catch (e) {
          console.error('❌ Erreur ICE delayed:', e);
        }
      }
    }
  }, []);

  // 5. Gestionnaire signaux WebSocket
  useEffect(() => {
    if (!signaling) return;

    const handleSignalMessage = async (message: any) => {
      if (!message) return;
      
      const { type, sender_id, payload } = message;
      console.log(`📥 Signal ${type} de ${sender_id}`);

      switch (type) {
        case 'offer':
          if (callState !== 'idle') {
            console.log('⚠️ Déjà en appel, ignore offre');
            return;
          }

          try {
            setCallState('ringing');
            currentCallRef.current = { targetId: sender_id, callerId: sender_id };
            setIsCaller(false);

            await initializeLocalStream();

            const pc = createPeerConnection(sender_id);
            peerConnectionRef.current = pc;
            isRemoteDescriptionSet.current = false;
            pendingCandidatesQueue.current = [];

            if (localStreamRef.current) {
              localStreamRef.current.getTracks().forEach(track => {
                pc.addTrack(track, localStreamRef.current!);
              });
            }

            await pc.setRemoteDescription(new RTCSessionDescription(payload));
            isRemoteDescriptionSet.current = true;

            await processPendingCandidates();
            console.log('🔔 Appel entrant prêt - en attente acceptation');

          } catch (error) {
            console.error('❌ Erreur traitement offre:', error);
            endCall();
          }
          break;

        case 'answer':
          if (callState !== 'calling' || !peerConnectionRef.current) {
            console.log('⚠️ Pas en appel sortant');
            return;
          }

          try {
            await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload));
            isRemoteDescriptionSet.current = true;
            await processPendingCandidates();
            console.log('✅ Réponse traitée');
          } catch (error) {
            console.error('❌ Erreur réponse:', error);
            endCall();
          }
          break;

        case 'ice-candidate':
          try {
            if (isRemoteDescriptionSet.current && peerConnectionRef.current) {
              await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(payload));
              console.log('✅ ICE ajouté immédiatement');
            } else {
              pendingCandidatesQueue.current.push(payload);
              console.log('📦 ICE mis en file');
            }
          } catch (error) {
            console.error('❌ Erreur ICE:', error);
          }
          break;

        case 'call-rejected':
          console.log('📞 Appel rejeté');
          endCall();
          break;

        case 'call-ended':
          console.log('📞 Appel terminé par distant');
          endCall();
          break;
      }
    };

    signaling.onMessage(handleSignalMessage);
  }, [signaling, callState, initializeLocalStream, createPeerConnection, processPendingCandidates, endCall]);

  // --- ACTIONS ---
  const callUser = useCallback(async (targetId: string) => {
    if (callState !== 'idle' || !currentUserId || !signaling) {
      console.log('⚠️ Impossible d\'appeler');
      return;
    }

    try {
      console.log('📞 Appel vers', targetId);
      setCallState('calling');
      setIsCaller(true);
      currentCallRef.current = { targetId, callerId: currentUserId };

      await initializeLocalStream();

      const pc = createPeerConnection(targetId);
      peerConnectionRef.current = pc;
      isRemoteDescriptionSet.current = false;
      pendingCandidatesQueue.current = [];

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      signaling.sendSignal(targetId, 'offer', offer);
      console.log('📤 Offre envoyée');

    } catch (error) {
      console.error('❌ Erreur appel:', error);
      endCall();
    }
  }, [callState, currentUserId, signaling, initializeLocalStream, createPeerConnection, endCall]);

  const acceptCall = useCallback(async () => {
    if (callState !== 'ringing' || !peerConnectionRef.current || !currentCallRef.current.callerId) {
      console.log('⚠️ Aucun appel à accepter');
      return;
    }

    try {
      console.log('✅ Acceptation appel');
      const pc = peerConnectionRef.current;
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      signaling.sendSignal(currentCallRef.current.callerId, 'answer', answer);
      setCallState('connected');
    } catch (error) {
      console.error('❌ Erreur acceptation:', error);
      endCall();
    }
  }, [callState, signaling, endCall]);

  const rejectCall = useCallback(() => {
    if (callState === 'ringing' && currentCallRef.current.callerId && signaling) {
      signaling.sendSignal(currentCallRef.current.callerId, 'call-rejected');
    }
    endCall();
  }, [callState, signaling, endCall]);

  // Cleanup - SEULEMENT ressources locales, PAS de signaling
  useEffect(() => {
    return () => {
      // Annuler le timeout
      if (disconnectTimeoutRef.current) {
        clearTimeout(disconnectTimeoutRef.current);
      }
      // Fermer la connexion sans envoyer de signal
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      // Arrêter les tracks média
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
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
