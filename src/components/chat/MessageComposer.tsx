import { useState, useRef } from 'react';
import { Send, Image, X, Loader2, Mic, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useChunkUpload } from '@/hooks/useChunkUpload';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { GifPicker } from './GifPicker';
import { toast } from 'sonner';
import type { MessageWithSender } from '@/hooks/useMessages';

interface MessageComposerProps {
  currentUserId: string | undefined;
  onSendMessage: (content: string, imageUrl?: string, replyToId?: string) => void;
  replyingTo: MessageWithSender | null;
  onCancelReply: () => void;
}

/**
 * Barre de composition : saisie texte, image, message vocal, GIF,
 * aperçus (image/audio), indicateur d'enregistrement et barre de réponse.
 * Extrait de ChatArea pour alléger le composant.
 */
export function MessageComposer({
  currentUserId,
  onSendMessage,
  replyingTo,
  onCancelReply,
}: MessageComposerProps) {
  const [message, setMessage] = useState('');
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFileByChunks, uploading, reset: resetUpload } = useChunkUpload();
  const {
    isRecording,
    duration,
    audioBlob,
    audioUrl,
    startRecording,
    stopRecording,
    cancelRecording,
    getAudioFile,
    formatDuration,
  } = useVoiceRecorder();

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Veuillez sélectionner une image');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("L'image ne doit pas dépasser 10 Mo");
      return;
    }

    setSelectedImage(file);
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    resetUpload();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async () => {
    if (!message.trim() && !selectedImage && !audioBlob) return;
    if (!currentUserId) return;

    let imageUrl: string | undefined;

    // Upload image via chunks (serveur Python SAÉ)
    if (selectedImage) {
      const result = await uploadFileByChunks(selectedImage, currentUserId);
      if (result.success && result.fileUrl) {
        imageUrl = result.fileUrl;
      } else {
        toast.error(result.error || "Erreur lors de l'envoi de l'image");
        clearImage();
        return;
      }
    }

    // Upload audio via chunks (serveur Python SAÉ)
    if (audioBlob) {
      const audioFile = getAudioFile();
      if (audioFile) {
        const result = await uploadFileByChunks(audioFile, currentUserId);
        if (result.success && result.fileUrl) {
          imageUrl = result.fileUrl;
        } else {
          toast.error(result.error || "Erreur lors de l'envoi du message vocal");
          cancelRecording();
          resetUpload();
          return;
        }
      }
      cancelRecording();
    }

    onSendMessage(
      message || (audioBlob ? '🎤 Message vocal' : ''),
      imageUrl,
      replyingTo?.id,
    );
    setMessage('');
    clearImage();
    onCancelReply();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Aperçu image */}
      {imagePreview && (
        <div className="px-4 py-2 border-t border-border bg-muted/30">
          <div className="max-w-3xl mx-auto flex items-center gap-2">
            <div className="relative">
              <img src={imagePreview} alt="Preview" className="h-20 w-20 object-cover rounded-lg" />
              <Button
                variant="destructive"
                size="icon"
                className="absolute -top-2 -right-2 h-6 w-6"
                onClick={clearImage}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
            <span className="text-sm text-muted-foreground">{selectedImage?.name}</span>
          </div>
        </div>
      )}

      {/* Aperçu audio */}
      {audioUrl && !isRecording && (
        <div className="px-4 py-2 border-t border-border bg-muted/30">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <div className="flex items-center gap-2 flex-1">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <Mic className="w-5 h-5 text-primary" />
              </div>
              <audio src={audioUrl} controls className="h-10 flex-1" />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive shrink-0"
              onClick={cancelRecording}
            >
              <Trash2 className="w-5 h-5" />
            </Button>
          </div>
        </div>
      )}

      {/* Indicateur d'enregistrement */}
      {isRecording && (
        <div className="px-4 py-3 border-t border-border bg-destructive/10">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-destructive animate-pulse" />
              <span className="text-sm font-medium text-destructive">Enregistrement en cours…</span>
              <span className="font-mono-ds text-sm text-muted-foreground">{formatDuration(duration)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={cancelRecording}
                className="text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Annuler
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={stopRecording}
                className="bg-destructive hover:bg-destructive/90"
              >
                <Square className="w-4 h-4 mr-1" />
                Arrêter
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Barre de réponse */}
      {replyingTo && (
        <div className="px-4 py-2 border-t border-border bg-primary/10">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="label-file text-[0.6rem] text-primary shrink-0">Réponse à {replyingTo.sender?.username}</span>
              <span className="text-xs text-muted-foreground truncate">{replyingTo.content?.slice(0, 50) || '📎 Fichier'}</span>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCancelReply}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Saisie */}
      <div className="p-2 sm:p-4 border-t border-border bg-card">
        <div className="max-w-3xl mx-auto flex items-center gap-1 sm:gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageSelect}
            accept="image/*"
            className="hidden"
          />
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground shrink-0 h-9 w-9"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || isRecording}
            title="Joindre une image"
          >
            <Image className="w-5 h-5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className={`shrink-0 h-9 w-9 ${isRecording ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={uploading}
            title="Message vocal"
          >
            {isRecording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </Button>

          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground shrink-0 h-9 w-9"
              onClick={() => setGifPickerOpen(!gifPickerOpen)}
              disabled={uploading || isRecording}
              title="GIF"
            >
              <span className="font-mono-ds text-[0.6rem] font-semibold tracking-wider">GIF</span>
            </Button>
            <GifPicker
              isOpen={gifPickerOpen}
              onClose={() => setGifPickerOpen(false)}
              onSelectGif={(gifUrl) => {
                onSendMessage('', gifUrl, replyingTo?.id);
                onCancelReply();
                setGifPickerOpen(false);
              }}
            />
          </div>

          <Input
            placeholder="Écrivez un message…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-background"
            disabled={uploading || isRecording}
          />

          <Button
            onClick={handleSend}
            size="icon"
            disabled={(!message.trim() && !selectedImage && !audioBlob) || uploading || isRecording}
            className="shrink-0 h-9 w-9"
            title="Envoyer"
          >
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </Button>
        </div>
      </div>
    </>
  );
}
