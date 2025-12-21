/**
 * Hook WebRTC pour les appels audio/vidéo
 * Utilise le hook useSignaling pour l'échange de signaux
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useSignaling, SignalMessage } from './useSignaling';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export type CallState = 'idle' | 'calling' | 'receiving' | 'connected' | 'ended';

export function useWebRTC(userId: string | undefined) {
  const [callState, setCallState] = useState<CallState>('idle');
  const [callType, setCallType] = useState<'audio' | 'video'>('audio');
  const [remoteUserId, setRemoteUserId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const {
    isConnected: signalingConnected,
    incomingCall,
    sendSignal,
    onMessage,
    acceptCall: signalingAcceptCall,
    rejectCall: signalingRejectCall,
    endCall: signalingEndCall,
    setIncomingCall,
  } = useSignaling(userId);

  // Créer une nouvelle connexion peer
  const createPeerConnection = useCallback(() => {
    console.log('[WebRTC] 🔧 Création PeerConnection');
    
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate && remoteUserId) {
        console.log('[WebRTC] 🧊 ICE candidate local');
        sendSignal(remoteUserId, 'ice-candidate', event.candidate.toJSON());
      }
    };

    pc.ontrack = (event) => {
      console.log('[WebRTC] 📹 Track distant reçu');
      setRemoteStream(event.streams[0]);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] 🔄 ICE state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected') {
        setCallState('connected');
      } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        handleEndCall();
      }
    };

    pcRef.current = pc;
    return pc;
  }, [remoteUserId, sendSignal]);

  // Obtenir le flux média local
  const getLocalMedia = useCallback(async (type: 'audio' | 'video') => {
    try {
      const constraints = {
        audio: true,
        video: type === 'video',
      };
      console.log('[WebRTC] 🎤 Demande accès média:', constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setLocalStream(stream);
      return stream;
    } catch (err) {
      console.error('[WebRTC] ❌ Erreur accès média:', err);
      throw err;
    }
  }, []);

  // Initier un appel
  const startCall = useCallback(async (targetUserId: string, type: 'audio' | 'video') => {
    if (!signalingConnected) {
      console.warn('[WebRTC] ⚠️ Signaling non connecté');
      return;
    }

    console.log('[WebRTC] 📞 Démarrage appel', type, 'vers', targetUserId);
    
    setCallType(type);
    setRemoteUserId(targetUserId);
    setCallState('calling');

    // Envoyer la demande d'appel
    sendSignal(targetUserId, 'call-request', { callType: type });
  }, [signalingConnected, sendSignal]);

  // Accepter un appel entrant
  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;

    console.log('[WebRTC] ✅ Acceptation appel de', incomingCall.from);
    
    setCallType(incomingCall.callType);
    setRemoteUserId(incomingCall.from);
    setCallState('connected');

    try {
      // Obtenir le média local
      const stream = await getLocalMedia(incomingCall.callType);
      
      // Créer peer connection
      const pc = createPeerConnection();
      
      // Ajouter les tracks locaux
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Signaler l'acceptation
      signalingAcceptCall();
      
      // Ajouter les candidats en attente
      for (const candidate of pendingCandidatesRef.current) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingCandidatesRef.current = [];
      
    } catch (err) {
      console.error('[WebRTC] ❌ Erreur acceptation:', err);
      handleEndCall();
    }
  }, [incomingCall, getLocalMedia, createPeerConnection, signalingAcceptCall]);

  // Refuser un appel
  const rejectCall = useCallback(() => {
    signalingRejectCall();
    setCallState('idle');
  }, [signalingRejectCall]);

  // Terminer un appel
  const handleEndCall = useCallback(() => {
    console.log('[WebRTC] 📴 Fin appel');
    
    // Arrêter les tracks locaux
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }

    // Fermer peer connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // Signaler la fin si on a un destinataire
    if (remoteUserId) {
      signalingEndCall(remoteUserId);
    }

    setRemoteStream(null);
    setRemoteUserId(null);
    setCallState('idle');
    setIncomingCall(null);
    pendingCandidatesRef.current = [];
  }, [localStream, remoteUserId, signalingEndCall, setIncomingCall]);

  // Gérer les signaux entrants
  useEffect(() => {
    onMessage(async (msg: SignalMessage) => {
      const senderId = msg.sender_id;
      
      switch (msg.type) {
        case 'call-accepted': {
          console.log('[WebRTC] 📞 Appel accepté par', senderId);
          
          try {
            // Obtenir le média local
            const stream = await getLocalMedia(callType);
            
            // Créer peer connection
            const pc = createPeerConnection();
            
            // Ajouter les tracks
            stream.getTracks().forEach((track) => {
              pc.addTrack(track, stream);
            });

            // Créer et envoyer l'offre
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            if (senderId) {
              sendSignal(senderId, 'offer', offer);
            }
            
            setCallState('connected');
          } catch (err) {
            console.error('[WebRTC] ❌ Erreur création offre:', err);
            handleEndCall();
          }
          break;
        }

        case 'offer': {
          console.log('[WebRTC] 📥 Offre reçue de', senderId);
          
          const pc = pcRef.current;
          if (!pc) {
            console.warn('[WebRTC] ⚠️ Pas de PeerConnection');
            return;
          }

          try {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit));
            
            // Créer et envoyer la réponse
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            if (senderId) {
              sendSignal(senderId, 'answer', answer);
            }
          } catch (err) {
            console.error('[WebRTC] ❌ Erreur traitement offre:', err);
          }
          break;
        }

        case 'answer': {
          console.log('[WebRTC] 📥 Réponse reçue de', senderId);
          
          const pc = pcRef.current;
          if (!pc) return;

          try {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit));
          } catch (err) {
            console.error('[WebRTC] ❌ Erreur traitement réponse:', err);
          }
          break;
        }

        case 'ice-candidate': {
          console.log('[WebRTC] 🧊 ICE candidate reçu');
          
          const pc = pcRef.current;
          const candidate = msg.payload as RTCIceCandidateInit;
          
          if (pc && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
              console.error('[WebRTC] ❌ Erreur ajout ICE candidate:', err);
            }
          } else {
            // Stocker pour plus tard
            pendingCandidatesRef.current.push(candidate);
          }
          break;
        }

        case 'call-rejected':
        case 'call-ended': {
          console.log('[WebRTC] 📴 Appel terminé/refusé');
          handleEndCall();
          break;
        }
      }
    });
  }, [onMessage, callType, getLocalMedia, createPeerConnection, sendSignal, handleEndCall]);

  // Mettre à jour l'état quand un appel entrant arrive
  useEffect(() => {
    if (incomingCall && callState === 'idle') {
      setCallState('receiving');
    }
  }, [incomingCall, callState]);

  return {
    callState,
    callType,
    localStream,
    remoteStream,
    incomingCall,
    signalingConnected,
    startCall,
    acceptCall,
    rejectCall,
    endCall: handleEndCall,
  };
}
