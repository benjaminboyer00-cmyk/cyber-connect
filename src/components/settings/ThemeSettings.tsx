import { useState } from 'react';
import { Palette, Image, RotateCcw, Check, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTheme, ACCENT_COLORS, CHAT_BACKGROUNDS } from '@/hooks/useTheme';
import { toast } from 'sonner';

export function ThemeSettings() {
  const { 
    theme, 
    accentColors, 
    chatBackgrounds, 
    setAccentColor, 
    setChatBackground, 
    setCustomBackground,
    resetTheme 
  } = useTheme();
  
  const [customUrl, setCustomUrl] = useState('');

  const handleCustomBackground = () => {
    if (customUrl.trim()) {
      setCustomBackground(customUrl.trim());
      toast.success('Fond personnalisé appliqué');
      setCustomUrl('');
    }
  };

  return (
    <div className="space-y-6">
      {/* Couleur d'accent */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-primary" />
          <Label className="font-medium">Couleur d'accent</Label>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {accentColors.map((color) => (
            <button
              key={color.value}
              onClick={() => {
                setAccentColor(color.value);
                toast.success(`Couleur: ${color.name}`);
              }}
              className={`relative w-full aspect-square rounded-lg border-2 transition-all hover:scale-105 ${
                theme.accentColor === color.value 
                  ? 'border-white ring-2 ring-offset-2 ring-offset-background' 
                  : 'border-transparent'
              }`}
              style={{ backgroundColor: color.value }}
              title={color.name}
            >
              {theme.accentColor === color.value && (
                <Check className="absolute inset-0 m-auto w-4 h-4 text-white drop-shadow-md" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Fond de chat */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Image className="w-4 h-4 text-primary" />
          <Label className="font-medium">Fond du chat</Label>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {chatBackgrounds.map((bg) => (
            <button
              key={bg.value}
              onClick={() => {
                setChatBackground(bg.value, bg.type as 'color' | 'gradient');
                toast.success(`Fond: ${bg.name}`);
              }}
              className={`relative w-full aspect-square rounded-lg border-2 transition-all hover:scale-105 ${
                theme.chatBackground === bg.value 
                  ? 'border-primary ring-2 ring-offset-2 ring-offset-background ring-primary' 
                  : 'border-border'
              }`}
              style={{ 
                background: bg.value === 'default' ? 'var(--background)' : bg.value 
              }}
              title={bg.name}
            >
              {theme.chatBackground === bg.value && (
                <Check className="absolute inset-0 m-auto w-4 h-4 text-white drop-shadow-md" />
              )}
              {bg.value === 'default' && (
                <span className="absolute inset-0 flex items-center justify-center text-[8px] text-muted-foreground">
                  Défaut
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Image personnalisée */}
        <div className="space-y-2 pt-2">
          <Label className="text-xs text-muted-foreground">Image personnalisée (URL)</Label>
          <div className="flex gap-2">
            <Input
              placeholder="https://exemple.com/image.jpg"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              className="text-xs bg-background text-foreground"
            />
            <Button variant="outline" size="sm" onClick={handleCustomBackground}>
              <Upload className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Reset */}
      <Button 
        variant="outline" 
        size="sm" 
        className="w-full"
        onClick={() => {
          resetTheme();
          toast.success('Thème réinitialisé');
        }}
      >
        <RotateCcw className="w-4 h-4 mr-2" />
        Réinitialiser le thème
      </Button>
    </div>
  );
}
