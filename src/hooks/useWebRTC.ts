import { useState, useEffect, useRef, useCallback } from 'react';

interface UseWebRTCReturn {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  callState: 'idle' | 'calling' | 'ringing' | 'connected' | 'failed';
  isCaller: boolean;
  currentCall: { targetId: string | null; callerId: string | null };
  callUser: (targetId: string) => Promise<void>;
  acceptCall: () => Promise<void>;
  endCall: () => void;
  rejectCall: () => void;
}

export const useWebRTC = (
  currentUserId: string | null,
  signaling: any // Votre objet signaling existant (de useSignaling)
): UseWebRTCReturn => {
  const [callState, setCallState] = useState<'idle' | 'calling' | 'ringing' | 'connected' | 'failed'>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCaller, setIsCaller] = useState(false);
  
  // Références pour les connexions et streams
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  
  // File d'attente pour les ICE candidates (CORRECTION BUG 2)
  const pendingCandidatesQueue = useRef<RTCIceCandidate[]>([]);
  const isRemoteDescriptionSet = useRef<boolean>(false);
  
  // Informations sur l'appel en cours
  const currentCallRef = useRef<{
    targetId: string | null;
    callerId: string | null;
  }>({ targetId: null, callerId: null });

  // Initialisation du stream local
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

  // Création de la connexion PeerConnection
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
    
    // Gestion des ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && currentCallRef.current.targetId) {
        console.log('📤 Envoi ICE candidate à', currentCallRef.current.targetId);
        signaling.sendSignal({
          type: 'ice-candidate',
          target_id: currentCallRef.current.targetId,
          data: event.candidate.toJSON()
        });
      }
    };

    // Gestion des tracks entrants
    pc.ontrack = (event) => {
      console.log('📥 Réception track distant');
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    // Gestion des changements d'état ICE
    pc.oniceconnectionstatechange = () => {
      console.log('🌐 ICE connection state:', pc.iceConnectionState);
      
      if (pc.iceConnectionState === 'disconnected' || 
          pc.iceConnectionState === 'failed' ||
          pc.iceConnectionState === 'closed') {
        console.log('🔌 Connexion ICE terminée');
        endCall();
      }
    };

    // Gestion des changements d'état de la connexion
    pc.onconnectionstatechange = () => {
      console.log('🔗 PeerConnection state:', pc.connectionState);
    };

    return pc;
  }, [signaling]);

  // Traitement de la file d'attente des ICE candidates (CORRECTION BUG 2)
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
    const handleSignalMessage = async (message: any) => {
      console.log(`📥 Message ${message.type} de ${message.sender_id}`);

      switch (message.type) {
        case 'offer':
          // Réception d'une offre (quelqu'un nous appelle)
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

            // Initialiser le stream local
            await initializeLocalStream();

            // Créer la PeerConnection
            const pc = createPeerConnection();
            peerConnectionRef.current = pc;
            isRemoteDescriptionSet.current = false;
            pendingCandidatesQueue.current = [];

            // Ajouter le stream local
            if (localStreamRef.current) {
              localStreamRef.current.getTracks().forEach(track => {
                pc.addTrack(track, localStreamRef.current!);
              });
            }

            // Définir l'offre distante
            await pc.setRemoteDescription(new RTCSessionDescription(message.data));
            isRemoteDescriptionSet.current = true;

            // Traiter les candidats en attente
            await processPendingCandidates();

            // Créer et envoyer la réponse
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            signaling.sendSignal({
              type: 'answer',
              target_id: message.sender_id,
              data: answer
            });

          } catch (error) {
            console.error('❌ Erreur traitement offre:', error);
            endCall();
          }
          break;

        case 'answer':
          // Réception d'une réponse (l'appelé a accepté)
          if (callState !== 'calling' || !peerConnectionRef.current) {
            console.log('⚠️ Pas en appel ou PeerConnection manquante');
            return;
          }

          try {
            const pc = peerConnectionRef.current;
            
            // Définir la réponse distante
            await pc.setRemoteDescription(new RTCSessionDescription(message.data));
            isRemoteDescriptionSet.current = true;
            setCallState('connected');
            
            // Traiter les candidats en attente
            await processPendingCandidates();
            
            console.log('✅ Réponse traitée, connexion établie');
          } catch (error) {
            console.error('❌ Erreur traitement réponse:', error);
            endCall();
          }
          break;

        case 'ice-candidate':
          // Réception d'un candidat ICE
          try {
            const candidate = new RTCIceCandidate(message.data);
            const pc = peerConnectionRef.current;

            if (pc && isRemoteDescriptionSet.current) {
              // Si la description distante est prête, ajouter directement
              await pc.addIceCandidate(candidate);
              console.log('✅ Candidat ICE ajouté immédiatement');
            } else {
              // Sinon, mettre en file d'attente
              pendingCandidatesQueue.current.push(candidate);
              console.log('📦 Candidat ICE mis en file d\'attente');
            }
          } catch (error) {
            console.error('❌ Erreur traitement ICE candidate:', error);
          }
          break;

        case 'call-rejected':
          // L'appel a été rejeté
          console.log('📞 Appel rejeté');
          endCall();
          break;

        case 'call-ended':
          // L'appel a été terminé par l'autre partie
          console.log('📞 Appel terminé par l\'autre partie');
          endCall();
          break;
      }
    };

    // ADAPTATION : On utilise le système de lastMessage de votre signaling existant
    if (signaling.lastMessage) {
      handleSignalMessage(signaling.lastMessage);
    }
  }, [signaling.lastMessage, callState, initializeLocalStream, createPeerConnection, processPendingCandidates]);

  // Fonction pour appeler un utilisateur
  const callUser = useCallback(async (targetId: string) => {
    if (callState !== 'idle' || !currentUserId) {
      console.log('⚠️ Impossible d\'appeler: déjà en appel ou userId manquant');
      return;
    }

    try {
      setCallState('calling');
      currentCallRef.current = { targetId, callerId: currentUserId };
      setIsCaller(true);

      // Initialiser le stream local
      const streamReady = await initializeLocalStream();
      if (!streamReady) {
        endCall();
        return;
      }

      // Créer la PeerConnection
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;
      isRemoteDescriptionSet.current = false;
      pendingCandidatesQueue.current = [];

      // Ajouter le stream local
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      // Créer et envoyer l'offre
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await pc.setLocalDescription(offer);

      signaling.sendSignal({
        type: 'offer',
        target_id: targetId,
        data: offer
      });

      console.log('📞 Appel initié vers', targetId);

    } catch (error) {
      console.error('❌ Erreur initiation appel:', error);
      endCall();
    }
  }, [callState, currentUserId, signaling, initializeLocalStream, createPeerConnection]);

  // Fonction pour accepter un appel
  const acceptCall = useCallback(async () => {
    if (callState !== 'ringing' || !peerConnectionRef.current || !currentCallRef.current.callerId) {
      console.log('⚠️ Aucun appel à accepter');
      return;
    }

    try {
      // La réponse est déjà envoyée dans handleSignalMessage pour 'offer'
      // On change juste l'état pour indiquer que l'appel est accepté
      setCallState('connected');
      console.log('✅ Appel accepté');
    } catch (error) {
      console.error('❌ Erreur acceptation appel:', error);
      endCall();
    }
  }, [callState]);

  // Fonction pour terminer un appel
  const endCall = useCallback(() => {
    console.log('🛑 Fin d\'appel');
    
    // Envoyer notification de fin d'appel
    if (currentCallRef.current.targetId) {
      signaling.sendSignal({
        type: 'call-ended',
        target_id: currentCallRef.current.targetId
      });
    }

    // Fermer la PeerConnection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Réinitialiser les états
    setCallState('idle');
    setRemoteStream(null);
    setIsCaller(false);
    currentCallRef.current = { targetId: null, callerId: null };
    isRemoteDescriptionSet.current = false;
    pendingCandidatesQueue.current = [];

    // Arrêter les tracks locaux mais conserver le stream pour un prochain appel
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }
  }, [signaling]);

  // Fonction pour rejeter un appel
  const rejectCall = useCallback(() => {
    if (callState === 'ringing' && currentCallRef.current.callerId) {
      signaling.sendSignal({
        type: 'call-rejected',
        target_id: currentCallRef.current.callerId
      });
    }
    endCall();
  }, [callState, signaling, endCall]);

  // Nettoyage à la destruction
  useEffect(() => {
    return () => {
      endCall();
    };
  }, [endCall]);

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
