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

  // Accès caméra/micro selon le type d'appel avec vérification des devices
  const initializeLocalStream = useCallback(async (type: CallType): Promise<boolean> => {
    try {
      console.log(`📹 Initialisation média pour: ${type}`);
      
      // D'abord lister les devices disponibles
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        console.log('📋 Devices disponibles:', devices.map(d => `${d.kind}: ${d.label || 'non nommé'}`));
      } catch (deviceError) {
        console.warn('⚠️ Impossible de lister les devices:', deviceError);
      }
      
      // Constraintes flexibles
      const constraints: MediaStreamConstraints = {
        audio: type !== 'video' ? true : {
          echoCancellation: true,
          noiseSuppression: true
        },
        video: type === 'video' ? {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        } : false
      };
      
      console.log('🎯 Contraintes:', constraints);
      
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
      
      // Fallback: essayer sans vidéo si c'était un appel vidéo
      if (type === 'video') {
        console.log('🔄 Fallback: essai audio seul...');
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = audioStream;
          setLocalStream(audioStream);
          console.log('✅ Stream audio obtenu en fallback');
          return true;
        } catch (audioError) {
          console.error('❌ Échec fallback audio:', audioError);
        }
      }
      
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
    
    // Configuration ICE avec serveurs STUN/TURN metered.ca
    const pc = new RTCPeerConnection({
      iceServers: [
        // STUN Google
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // TURN metered.ca avec credentials valides
        {
          urls: 'turn:a.relay.metered.ca:80',
          username: 'e8dd65c92c80d446b55a3545',
          credential: 'R9I6Uhz6arbFeNOJiD953Ffh4RDMEdyP1cIshZ_H-_nt90-9'
        },
        {
          urls: 'turn:a.relay.metered.ca:80?transport=tcp',
          username: 'e8dd65c92c80d446b55a3545',
          credential: 'R9I6Uhz6arbFeNOJiD953Ffh4RDMEdyP1cIshZ_H-_nt90-9'
        },
        {
          urls: 'turn:a.relay.metered.ca:443',
          username: 'e8dd65c92c80d446b55a3545',
          credential: 'R9I6Uhz6arbFeNOJiD953Ffh4RDMEdyP1cIshZ_H-_nt90-9'
        },
        {
          urls: 'turns:a.relay.metered.ca:443?transport=tcp',
          username: 'e8dd65c92c80d446b55a3545',
          credential: 'R9I6Uhz6arbFeNOJiD953Ffh4RDMEdyP1cIshZ_H-_nt90-9'
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
      const trackInfo = {
        kind: event.track.kind,
        id: event.track.id,
        streamId: event.streams[0]?.id,
        enabled: event.track.enabled,
        muted: event.track.muted
      };
      console.log('📥 Track distant reçu:', trackInfo);
      
      if (event.streams && event.streams[0]) {
        // Vérifier que ce n'est pas le même stream que le local
        const remoteStreamId = event.streams[0].id;
        const localStreamId = localStreamRef.current?.id;
        
        if (remoteStreamId === localStreamId) {
          console.warn('⚠️ ATTENTION: Le stream distant a le même ID que le local!');
        } else {
          console.log('✅ Stream distant différent du local:', { remoteStreamId, localStreamId });
        }
        
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
        
        // Log des transceivers pour debug
        const transceivers = pc.getTransceivers();
        console.log('📡 Transceivers après connexion:', transceivers.map(t => ({
          mid: t.mid,
          direction: t.direction,
          currentDirection: t.currentDirection,
          sender: t.sender.track?.kind,
          receiver: t.receiver.track?.kind
        })));
        
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
      
      const { type, sender_id, payload, data } = message;
      if (type !== 'ice-candidate') {
        console.log(`📥 Signal ${type} de ${sender_id}`);
      }

      // Extraire les données SDP (peut être dans payload ou data.sdp)
      const signalData = data || {};
      const sdpData = payload || signalData.sdp || signalData;

      switch (type) {
        case 'offer':
          if (callState !== 'idle' && callState !== 'ringing') {
            console.log('⚠️ Déjà en appel, ignore offre');
            return;
          }

          try {
            console.log('🔍 Analyse offer reçue:', {
              hasPayload: !!payload,
              hasData: !!data,
              hasSdp: !!sdpData,
              sdpType: sdpData?.type,
              sdpLength: sdpData?.sdp?.length
            });

            // VALIDATION CRITIQUE
            if (!sdpData) {
              console.error('❌ Offer sans SDP');
              throw new Error('Invalid offer: missing SDP data');
            }

            // CORRECTION du type si null/undefined
            if (!sdpData.type || sdpData.type === 'null' || sdpData.type === null) {
              console.warn('⚠️ Type SDP invalide, correction à "offer"');
              sdpData.type = 'offer';
            }

            // VÉRIFICATION finale
            if (sdpData.type !== 'offer') {
              console.error(`❌ Type SDP incorrect: ${sdpData.type}, attendu: offer`);
              sdpData.type = 'offer'; // Correction forcée
            }

            console.log('✅ Offer validée, traitement...');

            setCallState('ringing');
            currentCallRef.current = { targetId: sender_id, callerId: sender_id };
            setIsCaller(false);
            isCallerRef.current = false;
            
            // Extraire le callType depuis l'offer (envoyé par l'appelant)
            const incomingType: CallType = (payload?.callType === 'audio' || sdpData?.callType === 'audio') ? 'audio' : 'video';
            console.log('📞 Type d\'appel reçu:', incomingType);
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

            await pc.setRemoteDescription(new RTCSessionDescription(sdpData));
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
            // Extraire les données SDP pour answer aussi
            const answerData = payload || signalData.sdp || signalData;

            // VALIDATION du SDP avant utilisation
            console.log('📥 Réception answer de', sender_id);
            
            // VALIDER que l'answer a un type valide
            if (!answerData || typeof answerData !== 'object') {
              console.error('❌ Answer invalide: payload manquant ou incorrect', answerData);
              throw new Error('Invalid answer: missing or incorrect payload');
            }
            
            // CORRECTION du type si null/undefined
            if (!answerData.type || answerData.type === 'null' || answerData.type === null) {
              console.warn('⚠️ Type SDP invalide pour answer, correction à "answer"');
              answerData.type = 'answer';
            }
            
            // VÉRIFIER le type SDP
            if (!['offer', 'answer', 'pranswer', 'rollback'].includes(answerData.type)) {
              console.error('❌ Type SDP invalide:', answerData.type);
              answerData.type = 'answer';
              console.log('🔧 Type SDP corrigé à "answer"');
            }
            
            console.log('✅ Answer validée:', {
              type: answerData.type,
              hasSdp: !!answerData.sdp,
              sdpLength: answerData.sdp?.length || 0
            });

            await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answerData));
            isRemoteDescriptionSet.current = true;
            
            // Vider immédiatement la file d'attente ICE
            await processPendingCandidates();
            
            // IMPORTANT: Le caller doit passer en 'connected' après avoir reçu l'answer
            setCallState('connected');
            console.log('✅ Réponse traitée - Appel connecté');
            
            // Note: L'answer est créée dans acceptCall, pas ici
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

      // CRÉATION DE L'OFFRE avec validation
      console.log('🎯 Création offer avec contraintes...');
      
      const offerOptions: RTCOfferOptions = {
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: false
      };
      
      const offer = await pc.createOffer(offerOptions);
      
      // LOG détaillé
      console.log('📤 Offer générée:', {
        type: offer.type,
        sdpLength: offer.sdp?.length || 0,
        sdpPreview: offer.sdp?.substring(0, 100) + '...'
      });
      
      // VALIDATION et CORRECTION du type (cast en any pour éviter erreur TS)
      if (!offer.type || (offer.type as any) === 'null' || offer.type === null) {
        console.warn('⚠️ Offer sans type valide, correction...');
        (offer as any).type = 'offer';
      }
      
      // S'assurer que le SDP n'est pas vide
      if (!offer.sdp || offer.sdp.length < 10) {
        console.error('❌ SDP trop court ou vide');
        throw new Error('SDP invalide: trop court ou vide');
      }
      
      await pc.setLocalDescription(offer);
      
      // PRÉPARATION pour envoi - inclure le callType pour que le destinataire sache le type d'appel
      const offerToSend = {
        type: offer.type,
        sdp: offer.sdp,
        callType: type  // 'audio' ou 'video' - important pour le destinataire
      };
      
      // DEBUG DÉTAILLÉ avant envoi
      console.log(`📡 [SEND_SIGNAL_DEBUG] Envoi offer:`, {
        type: 'offer',
        targetId: targetId,
        dataKeys: Object.keys(offerToSend),
        sdpPresent: !!offerToSend.sdp,
        sdpType: offerToSend.type,
        sdpTypeValid: offerToSend.type === 'offer' || offerToSend.type === 'answer',
        sdpLength: offerToSend.sdp?.length || 0,
        sdpPreview: offerToSend.sdp?.substring(0, 100) + '...'
      });
      
      // STRINGIFY pour voir exactement ce qui est envoyé
      const payloadToSend = {
        type: 'offer',
        target_id: targetId,
        payload: offerToSend
      };
      
      console.log('📦 Payload envoyé (stringifié):', JSON.stringify(payloadToSend, null, 2));
      
      // Vérifier que signaling est disponible
      if (!signaling) {
        console.error('❌ Signaling non disponible pour envoyer offer');
        throw new Error('Signaling not available');
      }
      
      signaling.sendSignal(targetId, 'offer', offerToSend);
      console.log('✅ Offre envoyée avec succès');

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
      
      // VALIDATION et CORRECTION du type answer (cast en any pour éviter erreur TS)
      if (!answer.type || (answer.type as any) === 'null' || answer.type === null) {
        console.warn('⚠️ Answer sans type valide, correction...');
        (answer as any).type = 'answer';
      }
      
      await pc.setLocalDescription(answer);

      // DEBUG DÉTAILLÉ avant envoi de l'answer
      const answerToSend: RTCSessionDescriptionInit = {
        type: answer.type,
        sdp: answer.sdp
      };
      
      console.log(`📡 [SEND_SIGNAL_DEBUG] Envoi answer:`, {
        type: 'answer',
        targetId: currentCallRef.current.callerId,
        dataKeys: Object.keys(answerToSend),
        sdpPresent: !!answerToSend.sdp,
        sdpType: answerToSend.type,
        sdpTypeValid: answerToSend.type === 'offer' || answerToSend.type === 'answer',
        sdpLength: answerToSend.sdp?.length || 0,
        sdpPreview: answerToSend.sdp?.substring(0, 100) + '...'
      });
      
      // STRINGIFY pour voir exactement ce qui est envoyé
      const answerPayloadToSend = {
        type: 'answer',
        target_id: currentCallRef.current.callerId,
        payload: answerToSend
      };
      
      console.log('📦 Answer payload envoyé (stringifié):', JSON.stringify(answerPayloadToSend, null, 2));
      
      // Vérifier que signaling est disponible
      if (!signaling) {
        console.error('❌ Signaling non disponible pour envoyer answer');
        throw new Error('Signaling not available');
      }

      signaling.sendSignal(currentCallRef.current.callerId, 'answer', answerToSend);
      setCallState('connected');
      console.log('✅ Answer envoyée avec succès');
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
