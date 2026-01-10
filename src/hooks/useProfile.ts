import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { API_BASE_URL } from '@/config/api';
import type { Tables } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'> & { display_name?: string | null; bio?: string | null };

// Styles d'avatars DiceBear disponibles
export const AVATAR_STYLES = [
  'adventurer',
  'adventurer-neutral', 
  'avataaars',
  'big-ears',
  'big-smile',
  'bottts',
  'croodles',
  'fun-emoji',
  'icons',
  'identicon',
  'initials',
  'lorelei',
  'micah',
  'miniavs',
  'notionists',
  'open-peeps',
  'personas',
  'pixel-art',
  'shapes',
  'thumbs'
] as const;

export type AvatarStyle = typeof AVATAR_STYLES[number];

/**
 * Génère une URL d'avatar via DiceBear API
 * @param seed - Identifiant unique (username, id, etc.)
 * @param style - Style d'avatar DiceBear
 * @param size - Taille en pixels (défaut 128)
 */
export function generateAvatarUrl(seed: string, style: AvatarStyle = 'avataaars', size: number = 128): string {
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}&size=${size}`;
}

export function useProfile(userId: string | undefined) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const fetchProfile = async () => {
      // Charger le profil Supabase (inclut display_name et bio si colonnes ajoutées)
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (!error && data) {
        setProfile(data as Profile);
      }
      setLoading(false);
    };

    fetchProfile();
  }, [userId]);

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!userId) return { error: new Error('No user') };
    
    // Mettre à jour directement dans Supabase
    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId);

    if (error) {
      console.error('Erreur update profil:', error);
      return { error };
    }

    setProfile(prev => prev ? { ...prev, ...updates } : null);
    return { error: null };
  };

  /**
   * Met à jour l'avatar avec un style DiceBear
   */
  const updateAvatarStyle = async (style: AvatarStyle) => {
    if (!profile?.username) return { error: new Error('No username') };
    
    const avatarUrl = generateAvatarUrl(profile.username, style);
    return updateProfile({ avatar_url: avatarUrl });
  };

  /**
   * Génère un avatar aléatoire
   */
  const generateRandomAvatar = async () => {
    const randomStyle = AVATAR_STYLES[Math.floor(Math.random() * AVATAR_STYLES.length)];
    const randomSeed = `${profile?.username || userId}-${Date.now()}`;
    const avatarUrl = generateAvatarUrl(randomSeed, randomStyle);
    return updateProfile({ avatar_url: avatarUrl });
  };

  return { 
    profile, 
    loading, 
    updateProfile, 
    updateAvatarStyle,
    generateRandomAvatar,
    avatarStyles: AVATAR_STYLES
  };
}