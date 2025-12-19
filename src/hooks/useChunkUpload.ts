/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Hook d'Upload par Chunks - Manipulation de Flux Réseaux (SAÉ 3.02)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Ce hook découpe les fichiers en chunks et les envoie séquentiellement
 * au serveur Python pour réassemblage.
 * 
 * Cela valide la contrainte "manipulation de flux réseaux" de la SAÉ.
 */

import { useState, useCallback } from 'react';
import { SERVER_CONFIG, getEndpointUrl } from '@/config/server';

interface UploadState {
  uploading: boolean;
  progress: number;
  currentChunk: number;
  totalChunks: number;
  error: string | null;
}

interface ChunkUploadResult {
  success: boolean;
  fileUrl: string | null;
  error?: string;
}

/**
 * Génère un identifiant unique pour l'upload
 */
function generateUploadId(): string {
  return `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Convertit un fichier en base64
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Enlever le préfixe "data:image/xxx;base64,"
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Découpe une chaîne base64 en chunks
 */
function splitIntoChunks(data: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }
  return chunks;
}

export function useChunkUpload() {
  const [state, setState] = useState<UploadState>({
    uploading: false,
    progress: 0,
    currentChunk: 0,
    totalChunks: 0,
    error: null,
  });

  /**
   * Upload un fichier par chunks vers le serveur Python
   */
  const uploadFileByChunks = useCallback(async (
    file: File,
    userId: string
  ): Promise<ChunkUploadResult> => {
    // Vérification de la taille
    if (file.size > SERVER_CONFIG.CHUNKS.MAX_FILE_SIZE) {
      return {
        success: false,
        fileUrl: null,
        error: `Fichier trop volumineux (max ${SERVER_CONFIG.CHUNKS.MAX_FILE_SIZE / 1024 / 1024}MB)`,
      };
    }

    setState({
      uploading: true,
      progress: 0,
      currentChunk: 0,
      totalChunks: 0,
      error: null,
    });

    try {
      // Convertir en base64
      console.log('[ChunkUpload] Converting file to base64...');
      const base64Data = await fileToBase64(file);
      
      // Découper en chunks
      const chunkSize = SERVER_CONFIG.CHUNKS.SIZE;
      const chunks = splitIntoChunks(base64Data, chunkSize);
      const totalChunks = chunks.length;
      const uploadId = generateUploadId();
      
      console.log(`[ChunkUpload] File split into ${totalChunks} chunks`);
      
      setState(prev => ({ ...prev, totalChunks }));
      
      // Envoyer chaque chunk séquentiellement
      let fileUrl: string | null = null;
      
      for (let i = 0; i < chunks.length; i++) {
        setState(prev => ({
          ...prev,
          currentChunk: i + 1,
          progress: Math.round((i / totalChunks) * 100),
        }));
        
        console.log(`[ChunkUpload] Sending chunk ${i + 1}/${totalChunks}...`);
        
        const response = await fetch(getEndpointUrl('UPLOAD_CHUNK'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            upload_id: uploadId,
            chunk_index: i,
            total_chunks: totalChunks,
            data: chunks[i],
            file_name: file.name,
            user_id: userId,
          }),
          signal: AbortSignal.timeout(SERVER_CONFIG.TIMEOUTS.UPLOAD),
        });
        
        if (!response.ok) {
          throw new Error(`Chunk ${i + 1} failed: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        // Si c'est le dernier chunk, on récupère l'URL
        if (result.complete && result.file_url) {
          fileUrl = result.file_url;
          console.log('[ChunkUpload] Upload complete:', fileUrl);
        }
      }
      
      setState(prev => ({
        ...prev,
        uploading: false,
        progress: 100,
        error: null,
      }));
      
      return {
        success: true,
        fileUrl,
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      console.error('[ChunkUpload] Error:', errorMessage);
      
      setState(prev => ({
        ...prev,
        uploading: false,
        error: errorMessage,
      }));
      
      return {
        success: false,
        fileUrl: null,
        error: errorMessage,
      };
    }
  }, []);

  /**
   * Reset l'état
   */
  const reset = useCallback(() => {
    setState({
      uploading: false,
      progress: 0,
      currentChunk: 0,
      totalChunks: 0,
      error: null,
    });
  }, []);

  return {
    ...state,
    uploadFileByChunks,
    reset,
  };
}
