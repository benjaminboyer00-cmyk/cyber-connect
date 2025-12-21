/**
 * Hook WebRTC pour les appels audio/vidéo
 * 
 * CORRECTIFS APPLIQUÉS:
 * - cleanupLocalResources() séparé de endCall() pour éviter la dépendance circulaire
 * - endCall() envoie le signal SEULEMENT sur action utilisateur
 * - createPeerConnection n'appelle plus endCall() directement
 * - File d'attente ICE rigoureuse (addIceCandidate SEULEMENT après remoteDescription)
 */

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
  /**
   * Termine l'appel et envoie call-ended UNIQUEMENT si userInitiated === true.
   * Par défaut userInitiated=false → nettoie les ressources sans envoyer de signal.
   */
  endCall: (userInitiated?: boolean) => void;
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

  // Timeout pour ICE disconnected/failed
  const disconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // FIX: Ref synchrone pour savoir si on est l'appelant (évite race condition sur callState)
  const isCallerRef = useRef<boolean>(false);

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

  /**
   * NOUVEAU: Nettoyage des ressources locales SANS envoyer de signal
   * Cette fonction est stable (pas de dépendances variables)
   */
  const cleanupLocalResources = useCallback(() => {
    console.log('🧹 Nettoyage ressources locales...');

    // Annuler le timeout de déconnexion
    if (disconnectTimeoutRef.current) {
      clearTimeout(disconnectTimeoutRef.current);
      disconnectTimeoutRef.current = null;
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
    setIsCaller(false);
    
    // Reset refs
    currentCallRef.current = { targetId: null, callerId: null };
    isRemoteDescriptionSet.current = false;
    pendingCandidatesQueue.current = [];
    isCallerRef.current = false; // FIX: Reset de la ref synchrone
  }, []); // PAS de dépendances = fonction stable

  /**
   * Fin d'appel.
   * @param userInitiated - Doit être explicitement `true` pour envoyer le signal call-ended.
   *                        Empêche tout envoi automatique (cleanup, unmount, etc.)
   */
  const endCall = useCallback((userInitiated = false) => {
    if (userInitiated) {
      console.log('🛑 Fin d\'appel (action utilisateur)');

      // Envoyer le signal de fin AVANT de nettoyer
      if (currentCallRef.current.targetId && signaling) {
        signaling.sendSignal(currentCallRef.current.targetId, 'call-ended');
      } else if (currentCallRef.current.callerId && signaling) {
        signaling.sendSignal(currentCallRef.current.callerId, 'call-ended');
      }
    }

    // Toujours nettoyer les ressources
    cleanupLocalResources();
  }, [signaling, cleanupLocalResources]);

  /**
   * Création PeerConnection
   * N'utilise plus endCall() - utilise cleanupLocalResources() pour les échecs
   */
  const createPeerConnection = useCallback((targetId: string) => {
    console.log('🔧 Création PeerConnection vers', targetId);
    
    // Configuration ICE Metered.ca officielle
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun.relay.metered.ca:80" },
        {
          urls: "turn:standard.relay.metered.ca:80",
          username: "2ce8447dffad525621446d76",
          credential: "vQ4YEJGIKoc9MmTx",
        },
        {
          urls: "turn:standard.relay.metered.ca:443",
          username: "2ce8447dffad525621446d76",
          credential: "vQ4YEJGIKoc9MmTx",
        },
        {
          urls: "turns:standard.relay.metered.ca:443?transport=tcp",
          username: "2ce8447dffad525621446d76",
          credential: "vQ4YEJGIKoc9MmTx",
        },
      ],
    });

    // Logs utiles pour diagnostiquer les chutes d'appel
    pc.onicegatheringstatechange = () => {
      console.log('🧊 ICE gathering state:', pc.iceGatheringState);
    };

    
    pc.onicecandidateerror = (event: any) => {
      console.error('🧊❌ ICE candidate error:', {
        errorCode: event?.errorCode,
        errorText: event?.errorText,
        url: event?.url,
        address: event?.address,
        port: event?.port,
      });
    };

    pc.onconnectionstatechange = () => {
      // Ne pas raccrocher/cleaner sur des états transitoires ici.
      // La logique "fatale" est gérée via iceConnectionState === 'failed'.
      if (pc.connectionState === 'failed') {
        console.warn('🔗 connectionState failed');
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && signaling) {
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
        return;
      }

      if (pc.iceConnectionState === 'disconnected') {
        // IMPORTANT: ne plus auto-terminer l'appel sur disconnected.
        // On tente plutôt un restart ICE, et on laisse l'utilisateur raccrocher si besoin.
        console.log('⚠️ ICE disconnected - tentative restartIce (pas de cleanup auto)');
        try {
          pc.restartIce();
        } catch (e) {
          console.log('⚠️ restartIce indisponible/échoué:', e);
        }
        return;
      }

      if (pc.iceConnectionState === 'failed') {
        console.log('⚠️ ICE failed - attente 3s avant cleanup...');
        disconnectTimeoutRef.current = setTimeout(() => {
          if (peerConnectionRef.current?.iceConnectionState === 'failed') {
            console.log('❌ ICE toujours failed après 3s - nettoyage');
            cleanupLocalResources();
          }
        }, 3000);
        return;
      }

      if (pc.iceConnectionState === 'closed') {
        console.log('🛑 ICE closed - nettoyage local');
        cleanupLocalResources();
      }
    };

    return pc;
  }, [signaling, cleanupLocalResources]); // PAS endCall dans les dépendances!

  // Vidage file d'attente ICE
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

  // Gestionnaire signaux WebSocket
  useEffect(() => {
    if (!signaling) return;

    const handleSignalMessage = async (message: any) => {
      if (!message) return;
      
      const { type, sender_id, payload } = message;
      if (type !== 'ice-candidate') {
        console.log(`📥 Signal ${type} de ${sender_id}`);
      }

      switch (type) {
        case 'offer':
          // Ignorer si déjà en appel
          if (callState !== 'idle' && callState !== 'ringing') {
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
            cleanupLocalResources();
          }
          break;

        case 'answer':
          // FIX: Utiliser isCallerRef au lieu de callState (évite race condition)
          if (!isCallerRef.current || !peerConnectionRef.current) {
            console.log('⚠️ Pas en appel sortant (isCallerRef:', isCallerRef.current, ')');
            return;
          }

          try {
            await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload));
            isRemoteDescriptionSet.current = true;
            await processPendingCandidates();
            console.log('✅ Réponse traitée');
          } catch (error) {
            console.error('❌ Erreur réponse:', error);
            cleanupLocalResources();
          }
          break;

        case 'ice-candidate':
          try {
            // CRITIQUE: Ne faire addIceCandidate QUE si remoteDescription est set
            if (isRemoteDescriptionSet.current && peerConnectionRef.current) {
              await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(payload));
              console.log('✅ ICE ajouté immédiatement');
            } else {
              pendingCandidatesQueue.current.push(payload);
              console.log('📦 ICE mis en file (remoteDesc pas encore set)');
            }
          } catch (error) {
            console.error('❌ Erreur ICE:', error);
          }
          break;

        case 'call-rejected':
          console.log('📞 Appel rejeté par distant');
          cleanupLocalResources();
          break;

        case 'call-ended':
          console.log('📞 Appel terminé par distant');
          cleanupLocalResources();
          break;
      }
    };

    signaling.onMessage(handleSignalMessage);
  }, [signaling, callState, initializeLocalStream, createPeerConnection, processPendingCandidates, cleanupLocalResources]);

  // Appeler un utilisateur
  const callUser = useCallback(async (targetId: string) => {
    if (callState !== 'idle' || !currentUserId || !signaling) {
      console.log('⚠️ Impossible d\'appeler');
      return;
    }

    try {
      console.log('📞 Appel vers', targetId);
      setCallState('calling');
      setIsCaller(true);
      isCallerRef.current = true; // FIX: Mise à jour synchrone
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
      cleanupLocalResources();
    }
  }, [callState, currentUserId, signaling, initializeLocalStream, createPeerConnection, cleanupLocalResources]);

  // Accepter un appel
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
      cleanupLocalResources();
    }
  }, [callState, signaling, cleanupLocalResources]);

  // Rejeter un appel
  const rejectCall = useCallback(() => {
    if (callState === 'ringing' && currentCallRef.current.callerId && signaling) {
      signaling.sendSignal(currentCallRef.current.callerId, 'call-rejected');
    }
    cleanupLocalResources();
  }, [callState, signaling, cleanupLocalResources]);

  // Cleanup au démontage - DIRECT sans dépendance (évite cleanup intempestif sur HMR)
  useEffect(() => {
    return () => {
      console.log('🧹 useWebRTC unmount cleanup');
      // Cleanup DIRECT (pas via cleanupLocalResources pour éviter problèmes de dépendances)
      if (disconnectTimeoutRef.current) {
        clearTimeout(disconnectTimeoutRef.current);
        disconnectTimeoutRef.current = null;
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
    };
  }, []); // IMPORTANT: [] = seulement au vrai démontage, pas sur re-render

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
