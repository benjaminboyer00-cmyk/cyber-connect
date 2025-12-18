import { MessageSquare } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { FriendWithProfile } from '@/hooks/useFriends';

interface NewChatModalProps {
  open: boolean;
  onClose: () => void;
  friends: FriendWithProfile[];
  onSelectFriend: (friendId: string) => void;
}

export function NewChatModal({ open, onClose, friends, onSelectFriend }: NewChatModalProps) {
  const handleSelect = (friendId: string | null) => {
    if (!friendId) return;
    onSelectFriend(friendId);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Nouvelle conversation</DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="max-h-80">
          <div className="space-y-2">
            {friends.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Vous n'avez pas encore d'amis.<br />
                Recherchez des utilisateurs pour les ajouter !
              </p>
            ) : (
              friends.map((friend) => {
                const friendUserId = friend.profile?.id;
                
                return (
                  <button
                    key={friend.id}
                    onClick={() => handleSelect(friendUserId || null)}
                    className="w-full flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Avatar className="w-10 h-10">
                          <AvatarImage src={friend.profile?.avatar_url || ''} />
                          <AvatarFallback className="bg-primary/20 text-primary">
                            {friend.profile?.username?.charAt(0).toUpperCase() || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <span 
                          className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-card ${
                            friend.profile?.status === 'online' ? 'bg-green-500' : 'bg-gray-500'
                          }`}
                        />
                      </div>
                      <div className="text-left">
                        <p className="font-medium text-foreground">{friend.profile?.username}</p>
                        <p className="text-xs text-muted-foreground">
                          {friend.profile?.status === 'online' ? 'En ligne' : 'Hors ligne'}
                        </p>
                      </div>
                    </div>
                    
                    <MessageSquare className="w-5 h-5 text-primary" />
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}