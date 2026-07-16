import { Phone, Video, MoreVertical, Users, Search, ArrowLeft, Bot, ImageIcon, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Tables } from '@/integrations/supabase/types';
import type { CallState } from '@/hooks/useWebRTC';

type Profile = Tables<'profiles'>;

interface ChatHeaderProps {
  contact: Profile | null;
  isGroup?: boolean;
  groupName?: string;
  members?: Profile[];
  callState?: CallState;
  onBack?: () => void;
  onStartAudioCall: () => void;
  onStartVideoCall: () => void;
  onToggleSearch: () => void;
  onOpenBackground: () => void;
  onOpenDiscord: () => void;
  canRemoveContact: boolean;
  onRemoveContact: () => void;
  onOpenProfile: () => void;
}

/** En-tête de la conversation (avatar, statut, appels, recherche, menu). */
export function ChatHeader({
  contact,
  isGroup,
  groupName,
  members,
  callState = 'idle',
  onBack,
  onStartAudioCall,
  onStartVideoCall,
  onToggleSearch,
  onOpenBackground,
  onOpenDiscord,
  canRemoveContact,
  onRemoveContact,
  onOpenProfile,
}: ChatHeaderProps) {
  const displayName = isGroup ? groupName : (contact?.username || 'Utilisateur');
  const displayStatus = isGroup
    ? `${(members?.length || 0) + 1} membres`
    : (contact?.status === 'online' ? 'En ligne' : 'Hors ligne');

  return (
    <div className="h-16 px-3 sm:px-6 border-b border-border flex items-center justify-between bg-card">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden shrink-0 -ml-1 text-muted-foreground hover:text-foreground"
            onClick={onBack}
            title="Retour"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
        )}
        <Avatar className="w-10 h-10 shrink-0">
          {isGroup ? (
            <AvatarFallback className="bg-accent text-accent-foreground">
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
          onClick={() => !isGroup && onOpenProfile()}
        >
          <p className="font-semibold text-foreground truncate">
            {(contact as any)?.display_name || displayName}
          </p>
          <div className="flex items-center gap-1.5">
            {!isGroup && (
              <span className={`w-1.5 h-1.5 rounded-full ${contact?.status === 'online' ? 'status-online' : 'status-offline'}`} />
            )}
            <span className="label-file text-[0.62rem] text-muted-foreground">{displayStatus}</span>
          </div>
          {!isGroup && (contact as any)?.bio && (
            <p className="text-xs text-muted-foreground truncate mt-0.5 italic">
              {(contact as any).bio}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        {!isGroup && contact && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground hover:bg-green-500/10"
              onClick={onStartAudioCall}
              disabled={callState !== 'idle'}
              title="Appel audio"
            >
              <Phone className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground hover:bg-blue-500/10"
              onClick={onStartVideoCall}
              disabled={callState !== 'idle'}
              title="Appel vidéo"
            >
              <Video className="w-5 h-5" />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          onClick={onToggleSearch}
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
            <DropdownMenuItem className="cursor-pointer" onClick={onOpenBackground}>
              <ImageIcon className="w-4 h-4 mr-2" />
              Fond de conversation
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer" onClick={onOpenDiscord}>
              <Bot className="w-4 h-4 mr-2" />
              Bots Discord
            </DropdownMenuItem>
            {canRemoveContact && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive cursor-pointer"
                  onClick={onRemoveContact}
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
  );
}
