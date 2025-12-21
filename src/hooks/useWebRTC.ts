import { useState, useEffect, useRef, useCallback } from 'react';
import { useSignaling, SignalMessage } from './useSignaling';

export type CallState = 'idle' | 'calling' | 'receiving' | 'connected' | 'failed';

interface UseWebRTCReturn {
  callState: CallState;
  callType: 'audio' | 'video';
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  incomingCall: { from: string; callType: 'audio' | 'video' } | null;
  signalingConnected: boolean;
  startCall: (targetUserId: string, type: 'audio' | 'video') => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
}

export const useWebRTC = (userId: string | undefined): UseWebRTCReturn => {
  const signaling = useSignaling(userId);
  
  const [callState, setCallState] = useState<CallState>('idle');
  const [callType, setCallType] = useState<'audio' | 'video'>('audio');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const targetUserIdRef = useRef<string | null>(null);
  
  // File d'attente pour les ICE candidates
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  // Cleanup
  const cleanup = useCallback(() => {
    console.log('[WebRTC] 🧹 Cleanup');
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    setLocalStream(null);
    setRemoteStream(null);
    setCallState('idle');
    targetUserIdRef.current = null;
    pendingCandidatesRef.current = [];
  }, []);

  // Traiter les candidats en attente
  const processPendingCandidates = useCallback(async (pc: RTCPeerConnection) => {
    console.log(`[WebRTC] 🧊 Traitement de ${pendingCandidatesRef.current.length} candidats en attente`);
    
    while (pendingCandidatesRef.current.length > 0) {
      const candidate = pendingCandidatesRef.current.shift();
      if (candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          console.log('[WebRTC] ✅ Candidat ICE ajouté depuis la file');
        } catch (err) {
          console.error('[WebRTC] ❌ Erreur ajout candidat:', err);
        }
      }
    }
  }, []);

  // Créer la PeerConnection
  const createPeerConnection = useCallback((targetId: string) => {
    console.log('[WebRTC] 🔧 Création PeerConnection');
    
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnectionRef.current = pc;
    targetUserIdRef.current = targetId;
    pendingCandidatesRef.current = [];

    pc.onicecandidate = (event) => {
      if (event.candidate && targetUserIdRef.current) {
        console.log('[WebRTC] 📤 Envoi ICE candidate');
        signaling.sendSignal(targetUserIdRef.current, 'ice-candidate', event.candidate.toJSON());
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] 🔄 ICE state:', pc.iceConnectionState);
      
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        setCallState('connected');
      } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        console.log('[WebRTC] ❌ Connexion perdue');
        cleanup();
      }
    };

    pc.ontrack = (event) => {
      console.log('[WebRTC] 📥 Track distant reçu');
      if (event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    return pc;
  }, [signaling, cleanup]);

  // Initialiser le stream local
  const initLocalStream = useCallback(async (isVideo: boolean) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: isVideo,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (err) {
      console.error('[WebRTC] ❌ Erreur accès média:', err);
      setCallState('failed');
      return null;
    }
  }, []);

  // Démarrer un appel
  const startCall = useCallback(async (targetUserId: string, type: 'audio' | 'video') => {
    if (callState !== 'idle' || !userId) {
      console.log('[WebRTC] ⚠️ Impossible de démarrer l\'appel');
      return;
    }

    console.log('[WebRTC] 📞 Démarrage appel vers', targetUserId, 'type:', type);
    
    setCallState('calling');
    setCallType(type);

    const stream = await initLocalStream(type === 'video');
    if (!stream) return;

    const pc = createPeerConnection(targetUserId);
    
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    // Envoyer demande d'appel
    signaling.sendSignal(targetUserId, 'call-request', { callType: type });

    // Créer et envoyer l'offre
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    signaling.sendSignal(targetUserId, 'offer', offer);
    
    console.log('[WebRTC] ✅ Offre envoyée');
  }, [callState, userId, signaling, initLocalStream, createPeerConnection]);

  // Accepter un appel
  const acceptCall = useCallback(async () => {
    const incoming = signaling.incomingCall;
    if (!incoming || callState !== 'receiving') {
      console.log('[WebRTC] ⚠️ Pas d\'appel à accepter');
      return;
    }

    console.log('[WebRTC] ✅ Acceptation appel de', incoming.from);
    
    // Notifier l'appelant
    signaling.sendSignal(incoming.from, 'call-accepted', { callType: incoming.callType });
    signaling.setIncomingCall(null);
  }, [callState, signaling]);

  // Rejeter un appel
  const rejectCall = useCallback(() => {
    const incoming = signaling.incomingCall;
    if (incoming) {
      signaling.sendSignal(incoming.from, 'call-rejected');
      signaling.setIncomingCall(null);
    }
    cleanup();
  }, [signaling, cleanup]);

  // Terminer un appel
  const endCall = useCallback(() => {
    if (targetUserIdRef.current) {
      signaling.sendSignal(targetUserIdRef.current, 'call-ended');
    }
    cleanup();
  }, [signaling, cleanup]);

  // Gérer les messages de signalisation
  useEffect(() => {
    const handleMessage = async (msg: SignalMessage) => {
      console.log('[WebRTC] 📨 Message reçu:', msg.type);

      switch (msg.type) {
        case 'call-request': {
          // Appel entrant géré par useSignaling
          if (callState === 'idle') {
            setCallState('receiving');
            const payload = msg.payload as { callType?: 'audio' | 'video' };
            setCallType(payload?.callType || 'audio');
          }
          break;
        }

        case 'offer': {
          // Recevoir une offre
          if (!msg.sender_id) break;
          
          const isVideo = callType === 'video';
          const stream = await initLocalStream(isVideo);
          if (!stream) break;

          const pc = createPeerConnection(msg.sender_id);
          
          stream.getTracks().forEach(track => {
            pc.addTrack(track, stream);
          });

          await pc.setRemoteDescription(new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit));
          
          // Traiter les candidats en attente
          await processPendingCandidates(pc);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          
          signaling.sendSignal(msg.sender_id, 'answer', answer);
          console.log('[WebRTC] ✅ Réponse envoyée');
          break;
        }

        case 'answer': {
          // Recevoir une réponse
          const pc = peerConnectionRef.current;
          if (pc && callState === 'calling') {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit));
            
            // Traiter les candidats en attente
            await processPendingCandidates(pc);
            
            console.log('[WebRTC] ✅ Réponse traitée');
          }
          break;
        }

        case 'ice-candidate': {
          const pc = peerConnectionRef.current;
          const candidate = msg.payload as RTCIceCandidateInit;
          
          if (pc && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
              console.log('[WebRTC] 🧊 ICE candidate ajouté directement');
            } catch (err) {
              console.error('[WebRTC] ❌ Erreur ajout ICE:', err);
            }
          } else {
            pendingCandidatesRef.current.push(candidate);
            console.log('[WebRTC] ⏳ ICE candidate en file d\'attente');
          }
          break;
        }

        case 'call-accepted': {
          console.log('[WebRTC] 📞 Appel accepté par le destinataire');
          break;
        }

        case 'call-rejected':
        case 'call-ended': {
          console.log('[WebRTC] 📞 Appel terminé/rejeté');
          cleanup();
          break;
        }
      }
    };

    signaling.onMessage(handleMessage);
  }, [signaling, callState, callType, initLocalStream, createPeerConnection, processPendingCandidates, cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    callState,
    callType,
    localStream,
    remoteStream,
    incomingCall: signaling.incomingCall,
    signalingConnected: signaling.isConnected,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
  };
};
