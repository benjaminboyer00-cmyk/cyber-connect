import { useState, useEffect } from 'react';
import { User, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';

interface ProfileSettingsProps {
  profile: {
    id: string;
    username: string | null;
    avatar_url: string | null;
    bio?: string | null;
    display_name?: string | null;
  } | null;
  onUpdateProfile: (updates: { username?: string; bio?: string; display_name?: string }) => Promise<{ error: Error | null }>;
}

export function ProfileSettings({ profile, onUpdateProfile }: ProfileSettingsProps) {
  const [displayName, setDisplayName] = useState(profile?.display_name || profile?.username || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.display_name || profile?.username || '');
    setBio(profile?.bio || '');
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await onUpdateProfile({
        display_name: displayName.trim(),
        bio: bio.trim(),
      });
      
      if (error) {
        toast.error('Erreur lors de la sauvegarde');
      } else {
        toast.success('Profil mis à jour !');
      }
    } catch (err) {
      toast.error('Erreur inattendue');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Avatar preview */}
      <div className="flex items-center gap-4">
        <Avatar className="w-16 h-16 border-2 border-primary">
          <AvatarImage src={profile?.avatar_url || ''} />
          <AvatarFallback className="text-lg bg-primary/20 text-primary">
            {(displayName || profile?.username || 'U').charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="font-semibold">{displayName || profile?.username}</p>
          <p className="text-sm text-muted-foreground">@{profile?.username}</p>
        </div>
      </div>

      {/* Display Name */}
      <div className="space-y-2">
        <Label htmlFor="display-name">Nom d'affichage</Label>
        <Input
          id="display-name"
          placeholder="Votre nom"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={50}
          className="bg-background text-foreground"
        />
        <p className="text-xs text-muted-foreground">
          Ce nom sera visible par vos contacts
        </p>
      </div>

      {/* Bio */}
      <div className="space-y-2">
        <Label htmlFor="bio">Bio</Label>
        <Textarea
          id="bio"
          placeholder="Parlez de vous..."
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={200}
          rows={3}
          className="bg-background text-foreground resize-none"
        />
        <p className="text-xs text-muted-foreground text-right">
          {bio.length}/200
        </p>
      </div>

      {/* Save button */}
      <Button 
        onClick={handleSave} 
        disabled={saving}
        className="w-full"
      >
        {saving ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Save className="w-4 h-4 mr-2" />
        )}
        Enregistrer
      </Button>
    </div>
  );
}
