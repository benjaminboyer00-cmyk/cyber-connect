import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (isLogin) {
      const { error } = await signIn(email, password);
      if (error) {
        toast.error(error.message);
      } else {
        toast.success('Connexion réussie !');
        // Navigation handled by useEffect watching user state
      }
    } else {
      if (!username.trim()) {
        toast.error("Le nom d'utilisateur est requis");
        setLoading(false);
        return;
      }
      const { error } = await signUp(email, password, username);
      if (error) {
        if (error.message.includes('already registered')) {
          toast.error('Cet email est déjà utilisé');
        } else {
          toast.error(error.message);
        }
      } else {
        toast.success('Compte créé ! Vérifiez votre email pour confirmer.');
      }
    }
    setLoading(false);
  };

  return (
    <div className="dark min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* En-tête façon dossier */}
        <div className="mb-6 flex items-center justify-between border-b border-border pb-3">
          <span className="label-file text-[0.68rem] text-muted-foreground">Messagerie chiffrée</span>
          <span className="label-file text-[0.68rem] text-muted-foreground">Réf. CC-{isLogin ? 'AUTH' : 'REG'}</span>
        </div>

        <Card className="border-border bg-card shadow-none">
          <CardHeader className="space-y-3 border-b border-border">
            <div className="flex items-center gap-3">
              {/* Scellé */}
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-sm border-2 border-primary text-primary">
                <span className="font-mono-ds text-[0.72rem] font-semibold tracking-widest">CC</span>
              </div>
              <div>
                <CardTitle className="font-serif text-2xl font-bold text-foreground">
                  CyberConnect
                </CardTitle>
                <CardDescription className="label-file text-[0.66rem] text-muted-foreground">
                  {isLogin ? 'Ouverture de session' : 'Nouveau dossier'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <div className="space-y-1.5">
                  <Label htmlFor="username" className="label-file text-[0.66rem] text-muted-foreground">Nom d'utilisateur</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="votre_pseudo"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="bg-background"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email" className="label-file text-[0.66rem] text-muted-foreground">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="vous@exemple.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="label-file text-[0.66rem] text-muted-foreground">Mot de passe</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="bg-background"
                />
              </div>

              <Button
                type="submit"
                className="w-full font-mono-ds text-xs uppercase tracking-wider font-semibold"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isLogin ? (
                  'Se connecter'
                ) : (
                  "Créer le dossier"
                )}
              </Button>
            </form>

            <div className="mt-6 border-t border-border pt-4 text-center">
              <button
                type="button"
                onClick={() => setIsLogin(!isLogin)}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {isLogin ? "Pas encore de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
              </button>
            </div>
          </CardContent>
        </Card>

        <p className="mt-4 text-center label-file text-[0.6rem] text-muted-foreground/60">
          Chiffrement de bout en bout · Fernet
        </p>
      </div>
    </div>
  );
}