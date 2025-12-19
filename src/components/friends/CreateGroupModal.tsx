import { useState } from 'react';
import { Users, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import type { FriendWithProfile } from '@/hooks/useFriends';

interface CreateGroupModalProps {
  open: boolean;
  onClose: () => void;
  friends: FriendWithProfile[];
  onCreateGroup: (memberIds: string[], name: string) => Promise<string | null>;
}

export function CreateGroupModal({ open, onClose, friends, onCreateGroup }: CreateGroupModalProps) {
  const [groupName, setGroupName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const toggleFriend = (friendId: string) => {
    setSelectedFriends(prev => {
      const next = new Set(prev);
      if (next.has(friendId)) {
        next.delete(friendId);
      } else {
        if (next.size >= 49) {
          toast.error('Maximum 50 membres par groupe');
          return prev;
        }
        next.add(friendId);
      }
      return next;
    });
  };

  const handleCreate = async () => {
    if (!groupName.trim()) {
      toast.error('Veuillez entrer un nom de groupe');
      return;
    }
    if (selectedFriends.size === 0) {
      toast.error('Sélectionnez au moins un ami');
      return;
    }

    setCreating(true);
    const result = await onCreateGroup(Array.from(selectedFriends), groupName.trim());
    setCreating(false);

    if (result) {
      toast.success('Groupe créé !');
      setGroupName('');
      setSelectedFriends(new Set());
      onClose();
    } else {
      toast.error('Erreur lors de la création du groupe');
    }
  };

  const handleClose = () => {
    setGroupName('');
    setSelectedFriends(new Set());
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Users className="w-5 h-5" />
            Créer un groupe
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div>
            <Input
              placeholder="Nom du groupe..."
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="bg-muted/50 border-border"
            />
          </div>

          <div>
            <p className="text-sm text-muted-foreground mb-2">
              Sélectionner les membres ({selectedFriends.size}/50)
            </p>
            <ScrollArea className="max-h-60">
              <div className="space-y-2">
                {friends.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">
                    Ajoutez des amis pour créer un groupe
                  </p>
                ) : (
                  friends.map((friend) => {
                    const friendId = friend.profile?.id;
                    if (!friendId) return null;
                    
                    const isSelected = selectedFriends.has(friendId);
                    
                    return (
                      <button
                        key={friend.id}
                        onClick={() => toggleFriend(friendId)}
                        className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors ${
                          isSelected 
                            ? 'bg-primary/20 border border-primary/50' 
                            : 'bg-muted/30 hover:bg-muted/50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar className="w-10 h-10">
                            <AvatarImage src={friend.profile?.avatar_url || ''} />
                            <AvatarFallback className="bg-primary/20 text-primary">
                              {friend.profile?.username?.charAt(0).toUpperCase() || '?'}
                            </AvatarFallback>
                          </Avatar>
                          <p className="font-medium text-foreground">{friend.profile?.username}</p>
                        </div>
                        
                        {isSelected && (
                          <Check className="w-5 h-5 text-primary" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>

          <Button
            onClick={handleCreate}
            disabled={creating || !groupName.trim() || selectedFriends.size === 0}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {creating ? 'Création...' : 'Créer le groupe'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
