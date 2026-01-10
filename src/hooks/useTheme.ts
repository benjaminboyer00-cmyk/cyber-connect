import { useState, useEffect, useCallback } from 'react';

// Couleurs d'accent disponibles
export const ACCENT_COLORS = [
  { name: 'Violet', value: '#8B5CF6', hsl: '258 89% 66%' },
  { name: 'Bleu', value: '#3B82F6', hsl: '217 91% 60%' },
  { name: 'Cyan', value: '#06B6D4', hsl: '188 94% 43%' },
  { name: 'Vert', value: '#10B981', hsl: '160 84% 39%' },
  { name: 'Jaune', value: '#F59E0B', hsl: '38 92% 50%' },
  { name: 'Orange', value: '#F97316', hsl: '25 95% 53%' },
  { name: 'Rose', value: '#EC4899', hsl: '330 81% 60%' },
  { name: 'Rouge', value: '#EF4444', hsl: '0 84% 60%' },
] as const;

// Fonds de chat prédéfinis
export const CHAT_BACKGROUNDS = [
  { name: 'Par défaut', value: 'default', type: 'color' },
  { name: 'Sombre', value: '#0a0a0a', type: 'color' },
  { name: 'Bleu nuit', value: '#0f172a', type: 'color' },
  { name: 'Violet sombre', value: '#1e1b4b', type: 'color' },
  { name: 'Vert sombre', value: '#052e16', type: 'color' },
  { name: 'Dégradé violet', value: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)', type: 'gradient' },
  { name: 'Dégradé bleu', value: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)', type: 'gradient' },
  { name: 'Dégradé sombre', value: 'linear-gradient(180deg, #0a0a0a 0%, #1a1a2e 100%)', type: 'gradient' },
] as const;

interface ThemeSettings {
  accentColor: string;
  accentHsl: string;
  chatBackground: string;
  chatBackgroundType: 'color' | 'gradient' | 'image';
  customBackgroundUrl?: string;
}

const STORAGE_KEY = 'cyber-connect-theme';

const defaultTheme: ThemeSettings = {
  accentColor: ACCENT_COLORS[0].value,
  accentHsl: ACCENT_COLORS[0].hsl,
  chatBackground: 'default',
  chatBackgroundType: 'color',
};

function getStoredTheme(): ThemeSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...defaultTheme, ...JSON.parse(stored) } : defaultTheme;
  } catch {
    return defaultTheme;
  }
}

function saveTheme(theme: ThemeSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
}

function applyTheme(theme: ThemeSettings) {
  // Trouver l'élément avec la classe .dark (ou le body)
  const darkElement = document.querySelector('.dark') || document.documentElement;
  
  // Appliquer la couleur d'accent (format HSL pour Tailwind)
  (darkElement as HTMLElement).style.setProperty('--primary', theme.accentHsl);
  (darkElement as HTMLElement).style.setProperty('--accent', theme.accentHsl);
  (darkElement as HTMLElement).style.setProperty('--ring', theme.accentHsl);
  (darkElement as HTMLElement).style.setProperty('--sidebar-primary', theme.accentHsl);
  (darkElement as HTMLElement).style.setProperty('--sidebar-ring', theme.accentHsl);
  
  // Appliquer le fond de chat
  if (theme.chatBackground === 'default') {
    (darkElement as HTMLElement).style.removeProperty('--chat-bg');
  } else if (theme.chatBackgroundType === 'image' && theme.customBackgroundUrl) {
    (darkElement as HTMLElement).style.setProperty('--chat-bg', `url(${theme.customBackgroundUrl})`);
  } else {
    (darkElement as HTMLElement).style.setProperty('--chat-bg', theme.chatBackground);
  }
  
  console.log('🎨 Thème appliqué:', theme.accentHsl, 'sur', darkElement.tagName);
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeSettings>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    // Appliquer le thème au chargement
    const storedTheme = getStoredTheme();
    setTheme(storedTheme);
    applyTheme(storedTheme);
  }, []);

  const setAccentColor = useCallback((colorValue: string) => {
    const color = ACCENT_COLORS.find(c => c.value === colorValue);
    if (color) {
      const newTheme = { ...theme, accentColor: color.value, accentHsl: color.hsl };
      setTheme(newTheme);
      saveTheme(newTheme);
    }
  }, [theme]);

  const setChatBackground = useCallback((background: string, type: 'color' | 'gradient' | 'image' = 'color') => {
    const newTheme = { ...theme, chatBackground: background, chatBackgroundType: type };
    setTheme(newTheme);
    saveTheme(newTheme);
  }, [theme]);

  const setCustomBackground = useCallback((url: string) => {
    const newTheme = { 
      ...theme, 
      chatBackground: 'custom', 
      chatBackgroundType: 'image' as const, 
      customBackgroundUrl: url 
    };
    setTheme(newTheme);
    saveTheme(newTheme);
  }, [theme]);

  const resetTheme = useCallback(() => {
    setTheme(defaultTheme);
    saveTheme(defaultTheme);
    applyTheme(defaultTheme);
  }, []);

  return {
    theme,
    accentColors: ACCENT_COLORS,
    chatBackgrounds: CHAT_BACKGROUNDS,
    setAccentColor,
    setChatBackground,
    setCustomBackground,
    resetTheme,
  };
}
