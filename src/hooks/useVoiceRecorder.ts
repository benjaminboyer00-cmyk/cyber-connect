/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Hook d'Enregistrement Vocal - Messages Audio (SAÉ 3.02)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Ce hook utilise l'API MediaRecorder pour capturer l'audio du microphone
 * et le convertir en fichier uploadable.
 */

import { useState, useRef, useCallback } from 'react';

interface VoiceRecorderState {
  isRecording: boolean;
  duration: number;
  audioBlob: Blob | null;
  audioUrl: string | null;
  error: string | null;
}

export function useVoiceRecorder() {
  const [state, setState] = useState<VoiceRecorderState>({
    isRecording: false,
    duration: 0,
    audioBlob: null,
    audioUrl: null,
    error: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  /**
   * Démarre l'enregistrement audio
   */
  const startRecording = useCallback(async () => {
    try {
      // Demander l'accès au microphone
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        } 
      });
      
      streamRef.current = stream;
      chunksRef.current = [];

      // Créer le MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      });
      
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { 
          type: mediaRecorder.mimeType 
        });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        setState(prev => ({
          ...prev,
          isRecording: false,
          audioBlob,
          audioUrl,
        }));

        // Arrêter le stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
      };

      mediaRecorder.onerror = () => {
        setState(prev => ({
          ...prev,
          isRecording: false,
          error: 'Erreur lors de l\'enregistrement',
        }));
      };

      // Démarrer l'enregistrement
      mediaRecorder.start(100); // Collecter des chunks toutes les 100ms

      // Timer pour la durée
      let duration = 0;
      timerRef.current = setInterval(() => {
        duration += 1;
        setState(prev => ({ ...prev, duration }));
      }, 1000);

      setState({
        isRecording: true,
        duration: 0,
        audioBlob: null,
        audioUrl: null,
        error: null,
      });

      console.log('[VoiceRecorder] Recording started');

    } catch (error) {
      console.error('[VoiceRecorder] Error:', error);
      setState(prev => ({
        ...prev,
        error: 'Impossible d\'accéder au microphone. Vérifiez les permissions.',
      }));
    }
  }, []);

  /**
   * Arrête l'enregistrement
   */
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording) {
      mediaRecorderRef.current.stop();
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      console.log('[VoiceRecorder] Recording stopped');
    }
  }, [state.isRecording]);

  /**
   * Annule l'enregistrement en cours ou supprime l'audio enregistré
   */
  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording) {
      mediaRecorderRef.current.stop();
    }
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (state.audioUrl) {
      URL.revokeObjectURL(state.audioUrl);
    }

    setState({
      isRecording: false,
      duration: 0,
      audioBlob: null,
      audioUrl: null,
      error: null,
    });

    console.log('[VoiceRecorder] Recording cancelled');
  }, [state.isRecording, state.audioUrl]);

  /**
   * Convertit le blob audio en File pour l'upload
   */
  const getAudioFile = useCallback((): File | null => {
    if (!state.audioBlob) return null;
    
    const extension = state.audioBlob.type.includes('webm') ? 'webm' : 'mp4';
    const fileName = `voice_${Date.now()}.${extension}`;
    
    return new File([state.audioBlob], fileName, { 
      type: state.audioBlob.type 
    });
  }, [state.audioBlob]);

  /**
   * Formate la durée en MM:SS
   */
  const formatDuration = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  return {
    ...state,
    startRecording,
    stopRecording,
    cancelRecording,
    getAudioFile,
    formatDuration,
  };
}
