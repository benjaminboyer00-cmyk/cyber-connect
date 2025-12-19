import { useState } from 'react';
import { LogOut, Search, UserPlus, MessageSquarePlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Tables } from '@/integrations/supabase/types';
import type { ConversationWithDetails } from '@/hooks/useConversations';
import type { FriendWithProfile } from '@/hooks/useFriends';

type Profile = Tables<'profiles'>;

interface SidebarProps {
  profile: Profile | null;
  conversations: ConversationWithDetails[];
  pendingRequests: FriendWithProfile[];
  selectedConversation: string | null;
  onSelectConversation: (id: string) => void;
  onSignOut: () => void;
  onSearchUsers: () => void;
  onNewChat: () => void;
  onViewRequests: () => void;
  onCreateGroup: () => void;
}

export function Sidebar({
  profile,
  conversations,
  pendingRequests,
  selectedConversation,
  onSelectConversation,
  onSignOut,
  onSearchUsers,
  onNewChat,
  onViewRequests,
  onCreateGroup
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredConversations = conversations.filter(conv => {
    const name = conv.is_group ? conv.name : conv.members[0]?.username;
    return (name || 'Conversation').toLowerCase().includes(searchQuery.toLowerCase());
  });

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 86400000) {
      return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  };

  return (
    <div className="w-80 h-full bg-sidebar border-r border-sidebar-border flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Avatar className="w-10 h-10 border-2 border-primary/50">
              <AvatarImage src={profile?.avatar_url || ''} />
              <AvatarFallback className="bg-primary/20 text-primary">
                {profile?.username?.charAt(0).toUpperCase() || '?'}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold text-sidebar-foreground">{profile?.username || 'Utilisateur'}</p>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs text-muted-foreground">En ligne</span>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onSignOut} className="text-muted-foreground hover:text-destructive">
            <LogOut className="w-5 h-5" />
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un utilisateur..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={onSearchUsers}
            className="pl-10 bg-sidebar-accent border-sidebar-border"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="p-2 flex gap-2 border-b border-sidebar-border">
        <Button 
          variant="outline" 
          size="sm" 
          className="flex-1 gap-1 border-sidebar-border hover:bg-sidebar-accent text-xs"
          onClick={onNewChat}
        >
          <MessageSquarePlus className="w-4 h-4" />
          Chat
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="flex-1 gap-1 border-sidebar-border hover:bg-sidebar-accent text-xs"
          onClick={onCreateGroup}
        >
          <UserPlus className="w-4 h-4" />
          Groupe
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="relative gap-1 border-sidebar-border hover:bg-sidebar-accent text-xs"
          onClick={onViewRequests}
        >
          <Users className="w-4 h-4" />
          {pendingRequests.length > 0 && (
            <Badge variant="destructive" className="absolute -top-2 -right-2 w-5 h-5 p-0 flex items-center justify-center text-xs">
              {pendingRequests.length}
            </Badge>
          )}
        </Button>
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-hidden">
        <div className="px-4 py-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Conversations
          </h3>
        </div>
        <ScrollArea className="h-[calc(100%-2rem)] scrollbar-thin">
          <div className="px-2 space-y-1">
            {filteredConversations.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Aucune conversation
              </p>
            ) : (
              filteredConversations.map((conv) => {
                const member = conv.members[0];
                const isSelected = selectedConversation === conv.id;
                const displayName = conv.is_group ? conv.name : member?.username;
                const displayAvatar = conv.is_group ? null : member?.avatar_url;
                const displayInitial = conv.is_group 
                  ? conv.name?.charAt(0).toUpperCase() 
                  : member?.username?.charAt(0).toUpperCase();
                
                return (
                  <button
                    key={conv.id}
                    onClick={() => onSelectConversation(conv.id)}
                    className={`w-full p-3 rounded-lg flex items-center gap-3 transition-all ${
                      isSelected 
                        ? 'bg-sidebar-accent border border-primary/30' 
                        : 'hover:bg-sidebar-accent/50'
                    }`}
                  >
                    <div className="relative">
                      <Avatar className="w-12 h-12">
                        <AvatarImage src={displayAvatar || ''} />
                        <AvatarFallback className={conv.is_group ? 'bg-accent/20 text-accent' : 'bg-muted text-muted-foreground'}>
                          {conv.is_group ? <Users className="w-5 h-5" /> : displayInitial || '?'}
                        </AvatarFallback>
                      </Avatar>
                      {!conv.is_group && (
                        <span 
                          className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-sidebar ${
                            member?.status === 'online' ? 'bg-green-500' : 'bg-gray-500'
                          }`}
                        />
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-sidebar-foreground truncate">
                          {displayName || 'Utilisateur'}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {formatTime(conv.lastMessage?.created_at || null)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground truncate">
                          {conv.lastMessage?.content || 'Aucun message'}
                        </p>
                        {conv.unreadCount > 0 && (
                          <Badge variant="default" className="bg-primary text-primary-foreground h-5 min-w-5 flex items-center justify-center">
                            {conv.unreadCount}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}