import { useState, useRef, useEffect } from 'react';
import { Send, Image, Phone, Video, MoreVertical, Users, X, Loader2, Mic, Square, Trash2, UserMinus, Smile, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useChunkUpload } from '@/hooks/useChunkUpload';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { MessageBubble } from './MessageBubble';
import { GifPicker } from './GifPicker';
import { DiscordBotSettings } from '../settings/DiscordBotSettings';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';
import type { MessageWithSender } from '@/hooks/useMessages';
import type { CallState } from '@/hooks/useWebRTC';

type Profile = Tables<'profiles'>;

interface ChatAreaProps {
  contact: Profile | null;
  messages: MessageWithSender[];
  currentUserId: string | undefined;
  onSendMessage: (content: string, imageUrl?: string) => void;
  loading: boolean;
  isGroup?: boolean;
  groupName?: string;
  members?: Profile[];
  // Props WebRTC depuis Index (optionnelles pour rétrocompatibilité)
  callState?: CallState;
  signalingConnected?: boolean;
  onStartCall?: (targetUserId: string, type: 'audio' | 'video') => void;
  onRemoveFriend?: (friendId: string) => void;
  // Réactions
  onReaction?: (messageId: string, emoji: string) => void;
  getReactionCounts?: (messageId: string) => { [emoji: string]: number };
  hasUserReacted?: (messageId: string, emoji: string) => boolean;
  // Messages épinglés
  pinnedMessages?: MessageWithSender[];
  isMessagePinned?: (messageId: string) => boolean;
  onPinMessage?: (messageId: string) => void;
  onUnpinMessage?: (messageId: string) => void;
  // Fond de chat par conversation
  chatBackground?: string | null;
  onSetChatBackground?: (url: string) => void;
  onClearChatBackground?: () => void;
}

export function ChatArea({ 
  contact, 
  messages, 
  currentUserId, 
  onSendMessage, 
  loading, 
  isGroup, 
  groupName, 
  members,
  callState = 'idle',
  signalingConnected = false,
  onStartCall,
  onRemoveFriend,
  onReaction,
  getReactionCounts,
  hasUserReacted,
  pinnedMessages = [],
  isMessagePinned,
  onPinMessage,
  onUnpinMessage,
  chatBackground,
  onSetChatBackground,
  onClearChatBackground,
}: ChatAreaProps) {
  const [message, setMessage] = useState('');
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [replyingTo, setReplyingTo] = useState<MessageWithSender | null>(null);
  const [discordSettingsOpen, setDiscordSettingsOpen] = useState(false);
  const [bgDialogOpen, setBgDialogOpen] = useState(false);
  const [bgUrl, setBgUrl] = useState('');
  const bgInputRef = useRef<HTMLInputElement>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFileByChunks, uploading, progress, reset: resetUpload } = useChunkUpload();
  const { 
    isRecording, 
    duration, 
    audioBlob, 
    audioUrl, 
    startRecording, 
    stopRecording, 
    cancelRecording, 
    getAudioFile,
    formatDuration 
  } = useVoiceRecorder();

  // Auto-scroll vers le dernier message
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handlers pour les appels
  const handleStartAudioCall = () => {
    if (contact?.id && onStartCall) {
      onStartCall(contact.id, 'audio');
      toast.info(`Appel audio vers ${contact.username || 'utilisateur'}...`);
    }
  };

  const handleStartVideoCall = () => {
    if (contact?.id && onStartCall) {
      onStartCall(contact.id, 'video');
      toast.info(`Appel vidéo vers ${contact.username || 'utilisateur'}...`);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Veuillez sélectionner une image');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('L\'image ne doit pas dépasser 10 Mo');
      return;
    }

    setSelectedImage(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    resetUpload(); // Reset complet du hook d'upload
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
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
        toast.error(result.error || 'Erreur lors de l\'envoi de l\'image');
        clearImage(); // Nettoyage complet en cas d'erreur
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
          toast.error(result.error || 'Erreur lors de l\'envoi du message vocal');
          cancelRecording();
          resetUpload(); // Nettoyage complet en cas d'erreur
          return;
        }
      }
      cancelRecording();
    }

    onSendMessage(message || (audioBlob ? '🎤 Message vocal' : ''), imageUrl);
    setMessage('');
    clearImage();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  const hasConversation = contact || isGroup;
  
  if (!hasConversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="w-24 h-24 mx-auto rounded-full bg-muted/50 flex items-center justify-center">
            <Send className="w-10 h-10 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Sélectionnez une conversation</h2>
          <p className="text-muted-foreground">Choisissez un ami pour commencer à discuter</p>
        </div>
      </div>
    );
  }

  const displayName = isGroup ? groupName : (contact?.username || 'Utilisateur');
  const displayStatus = isGroup 
    ? `${(members?.length || 0) + 1} membres` 
    : (contact?.status === 'online' ? 'En ligne' : 'Hors ligne');

  return (
    <div className="flex-1 flex flex-col bg-background" data-chat-area>
      {/* Header */}
      <div className="h-16 px-6 border-b border-border flex items-center justify-between bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Avatar className="w-10 h-10">
            {isGroup ? (
              <AvatarFallback className="bg-accent/20 text-accent">
                <Users className="w-5 h-5" />
              </AvatarFallback>
            ) : (
              <>
                <AvatarImage src={contact?.avatar_url || ''} />
                <AvatarFallback className="bg-primary/20 text-primary">
                  {contact?.username?.charAt(0).toUpperCase() || '?'}
                </AvatarFallback>
              </>
            )}
          </Avatar>
          <div 
            className="max-w-[200px] cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => !isGroup && setProfileModalOpen(true)}
          >
            <p className="font-semibold text-foreground truncate">
              {(contact as any)?.display_name || displayName}
            </p>
            <div className="flex items-center gap-1">
              {!isGroup && (
                <span className={`w-2 h-2 rounded-full ${contact?.status === 'online' ? 'bg-green-500' : 'bg-gray-500'}`} />
              )}
              <span className="text-xs text-muted-foreground">
                {displayStatus}
              </span>
            </div>
            {!isGroup && (contact as any)?.bio && (
              <p className="text-xs text-muted-foreground truncate mt-0.5 italic">
                {(contact as any).bio}
              </p>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Boutons d'appel - seulement pour les chats 1-1, pas les groupes */}
          {!isGroup && contact && (
            <>
              <Button 
                variant="ghost" 
                size="icon" 
                className="text-muted-foreground hover:text-foreground hover:bg-green-500/10"
                onClick={handleStartAudioCall}
                disabled={callState !== 'idle'}
                title="Appel audio"
              >
                <Phone className="w-5 h-5" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="text-muted-foreground hover:text-foreground hover:bg-blue-500/10"
                onClick={handleStartVideoCall}
                disabled={callState !== 'idle'}
                title="Appel vidéo"
              >
                <Video className="w-5 h-5" />
              </Button>
            </>
          )}
          {/* Bouton Recherche */}
          <Button 
            variant="ghost" 
            size="icon" 
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setSearchOpen(!searchOpen)}
            title="Rechercher dans la conversation"
          >
            <Search className="w-5 h-5" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                <MoreVertical className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem 
                className="cursor-pointer"
                onClick={() => setBgDialogOpen(true)}
              >
                <span className="mr-2">🖼️</span>
                Fond de conversation
              </DropdownMenuItem>
              <DropdownMenuItem 
                className="cursor-pointer"
                onClick={() => setDiscordSettingsOpen(true)}
              >
                <span className="mr-2">🤖</span>
                Bots Discord
              </DropdownMenuItem>
              {!isGroup && contact && onRemoveFriend && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    className="text-destructive focus:text-destructive cursor-pointer"
                    onClick={() => setRemoveDialogOpen(true)}
                  >
                    <UserMinus className="w-4 h-4 mr-2" />
                    Supprimer le contact
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Dialog de confirmation suppression contact */}
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce contact ?</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer {contact?.username} de vos contacts ? 
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (contact?.id && onRemoveFriend) {
                  onRemoveFriend(contact.id);
                  toast.success(`${contact.username} supprimé de vos contacts`);
                }
                setRemoveDialogOpen(false);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog Discord Bots */}
      <AlertDialog open={discordSettingsOpen} onOpenChange={setDiscordSettingsOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>🤖 Bots Discord</AlertDialogTitle>
            <AlertDialogDescription>
              Connectez des webhooks Discord pour relayer les messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <DiscordBotSettings conversationId={contact?.id || ''} />
          <AlertDialogFooter>
            <AlertDialogCancel>Fermer</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog Fond de conversation */}
      <AlertDialog open={bgDialogOpen} onOpenChange={setBgDialogOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>🖼️ Fond de conversation</AlertDialogTitle>
            <AlertDialogDescription>
              Changez le fond de cette conversation. L'autre personne verra aussi ce fond.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">URL de l'image</label>
              <Input
                placeholder="https://exemple.com/image.jpg"
                value={bgUrl}
                onChange={(e) => setBgUrl(e.target.value)}
                className="bg-background text-foreground"
              />
            </div>
            {chatBackground && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Aperçu actuel</label>
                <div 
                  className="h-24 rounded-lg bg-cover bg-center border border-border"
                  style={{ backgroundImage: `url(${chatBackground})` }}
                />
              </div>
            )}
          </div>
          <AlertDialogFooter>
            {chatBackground && (
              <Button 
                variant="outline" 
                onClick={() => {
                  onClearChatBackground?.();
                  setBgDialogOpen(false);
                  toast.success('Fond supprimé');
                }}
              >
                Supprimer
              </Button>
            )}
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <Button 
              onClick={() => {
                if (bgUrl.trim()) {
                  onSetChatBackground?.(bgUrl.trim());
                  setBgUrl('');
                  setBgDialogOpen(false);
                  toast.success('Fond appliqué !');
                }
              }}
              disabled={!bgUrl.trim()}
            >
              Appliquer
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Barre de recherche */}
      {searchOpen && (
        <div className="px-4 py-2 border-b border-border bg-muted/30">
          <div className="max-w-3xl mx-auto flex items-center gap-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher dans les messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 h-8 text-sm bg-background text-foreground"
              autoFocus
            />
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Messages */}
      <ScrollArea 
        className="flex-1 p-6 scrollbar-thin bg-cover bg-center bg-no-repeat"
        style={chatBackground ? { backgroundImage: `url(${chatBackground})` } : {}}
      >
        <div className="space-y-4 max-w-3xl mx-auto">
          {loading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Chargement des messages...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Aucun message. Commencez la conversation !</p>
            </div>
          ) : (
            messages
              .filter(msg => !searchQuery || msg.content?.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((msg) => {
              const isOwn = msg.sender_id === currentUserId;
              
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isOwn={isOwn}
                  currentUserId={currentUserId || ''}
                  formatTime={formatTime}
                  onReply={(m) => setReplyingTo(m)}
                  onReaction={onReaction}
                  reactionCounts={getReactionCounts?.(msg.id)}
                  hasUserReacted={hasUserReacted}
                  isPinned={isMessagePinned?.(msg.id)}
                  onPin={onPinMessage}
                  onUnpin={onUnpinMessage}
                />
              );
            })
          )}
          {/* Anchor for auto-scroll */}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Image Preview */}
      {imagePreview && (
        <div className="px-4 py-2 border-t border-border bg-muted/30">
          <div className="max-w-3xl mx-auto flex items-center gap-2">
            <div className="relative">
              <img 
                src={imagePreview} 
                alt="Preview" 
                className="h-20 w-20 object-cover rounded-lg"
              />
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

      {/* Audio Preview */}
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

      {/* Recording Indicator */}
      {isRecording && (
        <div className="px-4 py-3 border-t border-border bg-destructive/10">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-destructive animate-pulse" />
              <span className="text-sm font-medium text-destructive">Enregistrement en cours...</span>
              <span className="text-sm text-muted-foreground">{formatDuration(duration)}</span>
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
              <span className="text-xs text-primary font-medium">↩️ Réponse à {replyingTo.sender?.username}:</span>
              <span className="text-xs text-muted-foreground truncate">{replyingTo.content?.slice(0, 50) || '📎 Fichier'}</span>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setReplyingTo(null)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
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
            className="text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || isRecording}
          >
            <Image className="w-5 h-5" />
          </Button>

          {/* Bouton Micro */}
          <Button 
            variant="ghost" 
            size="icon" 
            className={`shrink-0 ${isRecording ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={uploading}
          >
            {isRecording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </Button>

          {/* Bouton GIF */}
          <div className="relative">
            <Button 
              variant="ghost" 
              size="icon" 
              className="text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => setGifPickerOpen(!gifPickerOpen)}
              disabled={uploading || isRecording}
            >
              <span className="text-xs font-bold">GIF</span>
            </Button>
            <GifPicker 
              isOpen={gifPickerOpen}
              onClose={() => setGifPickerOpen(false)}
              onSelectGif={(gifUrl) => {
                onSendMessage('', gifUrl);
                setGifPickerOpen(false);
              }}
            />
          </div>
          
          <Input
            placeholder="Écrivez un message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            className="flex-1 bg-muted/50 border-border focus:border-primary text-foreground placeholder:text-muted-foreground"
            disabled={uploading || isRecording}
          />
          
          <Button 
            onClick={handleSend}
            disabled={(!message.trim() && !selectedImage && !audioBlob) || uploading || isRecording}
            className="bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground shrink-0"
          >
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}