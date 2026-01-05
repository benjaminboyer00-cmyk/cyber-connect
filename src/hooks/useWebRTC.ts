/**
 * Hook WebRTC pour les appels audio/vidéo
 * 
 * CORRECTIFS APPLIQUÉS:
 * - cleanupLocalResources() séparé de endCall() - N'ENVOIE PAS de signal
 * - endCall() envoie le signal SEULEMENT sur action utilisateur explicite
 * - isCallerRef pour éviter les race conditions
 * - pendingCandidatesQueue vidée immédiatement après setRemoteDescription
 * - Configuration TURN Metered.ca (ports 80, 443, UDP et TCP)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';

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
  
  // Refs pour éviter les race conditions
  const callTypeRef = useRef<CallType>('video');
  const isCallerRef = useRef<boolean>(false);
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // File d'attente ICE candidates
  const pendingCandidatesQueue = useRef<RTCIceCandidateInit[]>([]);
  const isRemoteDescriptionSet = useRef<boolean>(false);

  const currentCallRef = useRef<{
    targetId: string | null;
    callerId: string | null;
  }>({ targetId: null, callerId: null });

  // Timeout pour ICE failed
  const disconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Gestionnaire d'erreur centralisé pour WebRTC
   */
  const handleCallError = useCallback((error: Error, context: string) => {
    console.error(`❌ WebRTC Error [${context}]:`, error);
    
    // Réinitialiser les ressources
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    // Notifier l'utilisateur
    toast.error(`Call failed: ${error.message}`);
    
    // Réinitialiser l'état
    setCallState('failed');
    setRemoteStream(null);
    
    return error;
  }, []);

  // Accès caméra/micro selon le type d'appel
  const initializeLocalStream = useCallback(async (type: CallType): Promise<boolean> => {
    try {
      console.log(`📹 Initialisation média (${type})...`);
      const constraints = {
        audio: true,
        video: type === 'video'
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);
      console.log('✅ Média initialisé:', { 
        audio: stream.getAudioTracks().length, 
        video: stream.getVideoTracks().length 
      });
      return true;
    } catch (error) {
      console.error('❌ Erreur média:', error);
      setCallState('failed');
      return false;
    }
  }, []);

  /**
   * Nettoyage des ressources locales SANS envoyer de signal
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
    setCallType('video');
    setIsCaller(false);
    
    // Reset refs
    currentCallRef.current = { targetId: null, callerId: null };
    isRemoteDescriptionSet.current = false;
    pendingCandidatesQueue.current = [];
    isCallerRef.current = false;
    callTypeRef.current = 'video';
  }, []);

  /**
   * Fin d'appel.
   * @param userInitiated - Doit être explicitement `true` pour envoyer le signal call-ended.
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

    // Toujours nettoyer les ressources (SANS envoyer de signal)
    cleanupLocalResources();
  }, [signaling, cleanupLocalResources]);

  /**
   * Vidage immédiat de la file d'attente ICE après setRemoteDescription
   */
  const processPendingCandidates = useCallback(async () => {
    if (!peerConnectionRef.current) return;

    const candidates = [...pendingCandidatesQueue.current];
    pendingCandidatesQueue.current = []; // Vider immédiatement

    console.log(`🔄 Traitement ${candidates.length} ICE en attente`);

    for (const candidate of candidates) {
      try {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('✅ ICE ajouté depuis file');
      } catch (e) {
        console.error('❌ Erreur ICE delayed:', e);
      }
    }
  }, []);

  /**
   * Création PeerConnection avec configuration TURN Metered.ca
   */
  const createPeerConnection = useCallback((targetId: string) => {
    console.log('🔧 Création PeerConnection vers', targetId);
    
    // Configuration ICE optimisée : 1 STUN (Google) + 2 TURN (openrelay gratuit)
    const pc = new RTCPeerConnection({
      iceServers: [
        // 1. STUN gratuit de Google (pour NAT traversal simple)
        { urls: 'stun:stun.l.google.com:19302' },
        // 2. TURN gratuit (pour les connexions difficiles)
        { 
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        { 
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject', 
          credential: 'openrelayproject'
        }
      ],
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'all' as RTCIceTransportPolicy
    });

    pc.onicegatheringstatechange = () => {
      console.log('🧊 ICE gathering state:', pc.iceGatheringState);
    };
    
    pc.onicecandidateerror = (event: any) => {
      console.error('🧊❌ ICE candidate error:', {
        errorCode: event?.errorCode,
        errorText: event?.errorText,
        url: event?.url,
      });
    };

    pc.onconnectionstatechange = () => {
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
        console.log('⚠️ ICE disconnected - tentative restartIce');
        try {
          pc.restartIce();
        } catch (e) {
          console.log('⚠️ restartIce indisponible:', e);
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
  }, [signaling, cleanupLocalResources]);

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
          if (callState !== 'idle' && callState !== 'ringing') {
            console.log('⚠️ Déjà en appel, ignore offre');
            return;
          }

          try {
            setCallState('ringing');
            currentCallRef.current = { targetId: sender_id, callerId: sender_id };
            setIsCaller(false);
            isCallerRef.current = false;
            
            const incomingType: CallType = 'video';
            callTypeRef.current = incomingType;
            setCallType(incomingType);

            await initializeLocalStream(incomingType);

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

            // Vider immédiatement la file d'attente ICE
            await processPendingCandidates();
            console.log('🔔 Appel entrant prêt - en attente acceptation');

          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            handleCallError(err, 'offer processing');
            cleanupLocalResources();
          }
          break;

        case 'answer':
          // Utiliser isCallerRef au lieu de callState (évite race condition)
          if (!isCallerRef.current || !peerConnectionRef.current) {
            console.log('⚠️ Pas en appel sortant (isCallerRef:', isCallerRef.current, ')');
            return;
          }

          try {
            await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload));
            isRemoteDescriptionSet.current = true;
            
            // Vider immédiatement la file d'attente ICE
            await processPendingCandidates();
            console.log('✅ Réponse traitée');
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            handleCallError(err, 'answer processing');
            cleanupLocalResources();
          }
          break;

        case 'ice-candidate':
          try {
            if (isRemoteDescriptionSet.current && peerConnectionRef.current) {
              await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(payload));
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

        case 'error':
          // Gérer les erreurs du backend (utilisateur non connecté, etc.)
          const errorData = message as any;
          const errorMessage = errorData.message || 'Erreur de signaling';
          const errorTargetId = errorData.target_id || 'inconnu';
          
          console.error(`📥 Signal error from ${errorData.sender_id || 'server'}: ${errorMessage}`);
          console.error(`Error details:`, {
            target: errorTargetId,
            code: errorData.code,
            available: errorData.available_users
          });
          
          // Si on est en train d'appeler et que l'erreur concerne notre target, annuler l'appel
          if (isCallerRef.current && currentCallRef.current.targetId === errorTargetId) {
            console.error('❌ Call failed due to signaling error');
            
            // Notifier l'utilisateur
            toast.error(`Call failed: ${errorMessage}`);
            
            // Fermer la connexion WebRTC si elle existe
            if (peerConnectionRef.current) {
              peerConnectionRef.current.close();
              peerConnectionRef.current = null;
            }
            
            setCallState('failed');
            cleanupLocalResources();
          }
          break;
      }
    };

    signaling.onMessage(handleSignalMessage);
  }, [signaling, callState, initializeLocalStream, createPeerConnection, processPendingCandidates, cleanupLocalResources, handleCallError]);

  // Appeler un utilisateur
  const callUser = useCallback(async (targetId: string, type: CallType = 'video') => {
    if (callState !== 'idle' || !currentUserId || !signaling) {
      console.log('⚠️ Impossible d\'appeler');
      return;
    }

    try {
      console.log('📞 Appel vers', targetId, '- type:', type);
      setCallState('calling');
      setCallType(type);
      callTypeRef.current = type;
      setIsCaller(true);
      isCallerRef.current = true;
      currentCallRef.current = { targetId, callerId: currentUserId };

      await initializeLocalStream(type);

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
      const err = error instanceof Error ? error : new Error(String(error));
      handleCallError(err, 'call initiation');
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
      const err = error instanceof Error ? error : new Error(String(error));
      handleCallError(err, 'call acceptance');
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

  // Cleanup au démontage - UNIQUEMENT cleanupLocalResources (pas d'envoi de signal)
  useEffect(() => {
    return () => {
      console.log('🧹 useWebRTC unmount cleanup');
      // Cleanup DIRECT sans envoyer de signal
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
