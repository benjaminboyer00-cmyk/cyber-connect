/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Hook d'Upload par Chunks - Manipulation de Flux Réseaux (SAÉ 3.02)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Ce hook découpe les fichiers en chunks et les envoie séquentiellement
 * au serveur Python pour réassemblage via FormData (multipart/form-data).
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
 * Découpe un fichier binaire en chunks (Blob)
 */
function splitFileIntoChunks(file: File, chunkSize: number): Blob[] {
  const chunks: Blob[] = [];
  let offset = 0;
  
  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    chunks.push(file.slice(offset, end));
    offset = end;
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
   * Format: FormData avec file, filename, part, total
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
      // Découper en chunks binaires (64KB)
      const chunkSize = SERVER_CONFIG.CHUNKS.SIZE;
      const chunks = splitFileIntoChunks(file, chunkSize);
      const totalChunks = chunks.length;
      
      console.log(`[ChunkUpload] File "${file.name}" split into ${totalChunks} chunks (${chunkSize} bytes each)`);
      
      setState(prev => ({ ...prev, totalChunks }));
      
      // Envoyer chaque chunk séquentiellement via FormData
      let fileUrl: string | null = null;
      
      // Générer un nom de fichier unique UNE SEULE FOIS pour tous les chunks
      const uniqueFilename = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${file.name}`;
      console.log(`[ChunkUpload] Using unique filename: ${uniqueFilename}`);
      
      for (let i = 0; i < chunks.length; i++) {
        setState(prev => ({
          ...prev,
          currentChunk: i + 1,
          progress: Math.round(((i + 1) / totalChunks) * 100),
        }));

        console.log(`[ChunkUpload] Sending chunk ${i + 1}/${totalChunks}...`);

        // Créer le FormData avec les champs requis
        const formData = new FormData();
        formData.append('file', chunks[i], uniqueFilename);
        formData.append('filename', uniqueFilename);
        formData.append('part', String(i + 1)); // 1-indexed pour le serveur
        formData.append('total', String(totalChunks));
        formData.append('user_id', userId);

        const response = await fetch(getEndpointUrl('UPLOAD_CHUNK'), {
          method: 'POST',
          body: formData, // FormData = multipart/form-data automatique
          signal: AbortSignal.timeout(SERVER_CONFIG.TIMEOUTS.UPLOAD),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[ChunkUpload] Chunk ${i + 1} failed:`, errorText);
          throw new Error(`Chunk ${i + 1} failed: ${response.status} ${response.statusText}`);
        }

        const result: any = await response.json();

        // Supporte plusieurs formats de réponse selon le backend
        // - { complete: true, file_url: "..." }
        // - { status: "complete", url: "..." }
        const maybeUrl: string | null =
          (typeof result?.file_url === 'string' && result.file_url) ||
          (typeof result?.url === 'string' && result.url) ||
          (typeof result?.fileUrl === 'string' && result.fileUrl) ||
          null;

        const isComplete =
          result?.complete === true ||
          result?.status === 'complete' ||
          result?.status === 'completed';

        if (isComplete) {
          if (!maybeUrl) {
            console.error('[ChunkUpload] Upload complete but no URL returned:', result);
            throw new Error("Upload terminé mais aucune URL n'a été renvoyée par le serveur");
          }

          fileUrl = maybeUrl;
          console.log('[ChunkUpload] Upload complete:', fileUrl);
        }
      }

      if (!fileUrl) {
        throw new Error("Upload terminé mais l'URL finale est manquante");
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
