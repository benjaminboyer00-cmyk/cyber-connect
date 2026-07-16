import { useState, useRef, useEffect } from 'react';
import { Send, X, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { MessageBubble } from './MessageBubble';
import { ChatHeader } from './ChatHeader';
import { MessageComposer } from './MessageComposer';
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
  onSendMessage: (content: string, imageUrl?: string, replyToId?: string) => void;
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
  // Navigation mobile (retour vers la liste)
  onBack?: () => void;
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
  onStartCall,
  onRemoveFriend,
  onReaction,
  getReactionCounts,
  hasUserReacted,
  isMessagePinned,
  onPinMessage,
  onUnpinMessage,
  chatBackground,
  onSetChatBackground,
  onClearChatBackground,
  onBack,
}: ChatAreaProps) {
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [replyingTo, setReplyingTo] = useState<MessageWithSender | null>(null);
  const [discordSettingsOpen, setDiscordSettingsOpen] = useState(false);
  const [bgDialogOpen, setBgDialogOpen] = useState(false);
  const [bgUrl, setBgUrl] = useState('');
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll vers le dernier message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleStartAudioCall = () => {
    if (contact?.id && onStartCall) {
      onStartCall(contact.id, 'audio');
      toast.info(`Appel audio vers ${contact.username || 'utilisateur'}…`);
    }
  };

  const handleStartVideoCall = () => {
    if (contact?.id && onStartCall) {
      onStartCall(contact.id, 'video');
      toast.info(`Appel vidéo vers ${contact.username || 'utilisateur'}…`);
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
        <div className="text-center space-y-4 px-6">
          <div className="w-20 h-20 mx-auto rounded-sm border border-border flex items-center justify-center">
            <Send className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="font-serif text-xl font-semibold text-foreground">Aucun dossier ouvert</h2>
          <p className="text-muted-foreground">Sélectionnez une conversation pour commencer</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background min-w-0" data-chat-area>
      <ChatHeader
        contact={contact}
        isGroup={isGroup}
        groupName={groupName}
        members={members}
        callState={callState}
        onBack={onBack}
        onStartAudioCall={handleStartAudioCall}
        onStartVideoCall={handleStartVideoCall}
        onToggleSearch={() => setSearchOpen((v) => !v)}
        onOpenBackground={() => setBgDialogOpen(true)}
        onOpenDiscord={() => setDiscordSettingsOpen(true)}
        canRemoveContact={!isGroup && !!contact && !!onRemoveFriend}
        onRemoveContact={() => setRemoveDialogOpen(true)}
        onOpenProfile={() => setProfileModalOpen(true)}
      />

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
            <AlertDialogTitle>Bots Discord</AlertDialogTitle>
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
            <AlertDialogTitle>Fond de conversation</AlertDialogTitle>
            <AlertDialogDescription>
              Changez le fond de cette conversation. L'autre personne verra aussi ce fond.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="label-file text-[0.66rem] text-muted-foreground">URL de l'image</label>
              <Input
                placeholder="https://exemple.com/image.jpg"
                value={bgUrl}
                onChange={(e) => setBgUrl(e.target.value)}
                className="bg-background"
              />
            </div>
            {chatBackground && (
              <div className="space-y-2">
                <label className="label-file text-[0.66rem] text-muted-foreground">Aperçu actuel</label>
                <div
                  className="h-24 rounded-sm bg-cover bg-center border border-border"
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
              placeholder="Rechercher dans les messages…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 h-8 text-sm bg-background"
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
        className="flex-1 p-3 sm:p-6 scrollbar-thin bg-cover bg-center bg-no-repeat"
        style={chatBackground ? { backgroundImage: `url(${chatBackground})` } : {}}
      >
        <div className="space-y-4 max-w-3xl mx-auto">
          {loading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Chargement des messages…</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Aucun message. Commencez la conversation !</p>
            </div>
          ) : (
            messages
              .filter((msg) => !searchQuery || msg.content?.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isOwn={msg.sender_id === currentUserId}
                  currentUserId={currentUserId || ''}
                  formatTime={formatTime}
                  onReply={(m) => setReplyingTo(m)}
                  onReaction={onReaction}
                  reactionCounts={getReactionCounts?.(msg.id)}
                  hasUserReacted={hasUserReacted}
                  isPinned={isMessagePinned?.(msg.id)}
                  onPin={onPinMessage}
                  onUnpin={onUnpinMessage}
                  allMessages={messages}
                />
              ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <MessageComposer
        currentUserId={currentUserId}
        onSendMessage={onSendMessage}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
      />
    </div>
  );
}
