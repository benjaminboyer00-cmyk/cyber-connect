/**
 * Hook de Gestion des Amis avec Realtime
 * 
 * CORRECTIFS APPLIQUÉS:
 * - Abonnement postgres_changes sur la table 'friends' pour rafraîchir automatiquement
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { API_BASE_URL } from '@/config/api';
import type { Tables } from '@/integrations/supabase/types';

type Friend = Tables<'friends'>;
type Profile = Tables<'profiles'> & { display_name?: string | null; bio?: string | null };

export interface FriendWithProfile extends Friend {
  profile: Profile | null;
}

export function useFriends(userId: string | undefined) {
  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [pendingRequests, setPendingRequests] = useState<FriendWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Ref pour éviter les fetches multiples simultanés
  const isFetchingRef = useRef(false);

  const fetchFriends = useCallback(async () => {
    if (!userId) return;
    if (isFetchingRef.current) return;
    
    isFetchingRef.current = true;

    try {
      // Get all friend relationships
      const { data: friendsData, error } = await supabase
        .from('friends')
        .select('*')
        .or(`user_id.eq.${userId},friend_id.eq.${userId}`);

      if (error) {
        console.error('Error fetching friends:', error);
        setLoading(false);
        isFetchingRef.current = false;
        return;
      }

      // Get profiles for all related users
      const userIds = new Set<string>();
      friendsData?.forEach(f => {
        if (f.user_id && f.user_id !== userId) userIds.add(f.user_id);
        if (f.friend_id && f.friend_id !== userId) userIds.add(f.friend_id);
      });

      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', Array.from(userIds));

      const profileMap = new Map(profiles?.map(p => [p.id, p]));

      // Charger les infos supplémentaires (display_name, bio) depuis le backend
      let extraProfiles: Record<string, { display_name?: string; bio?: string }> = {};
      try {
        const res = await fetch(`${API_BASE_URL}/api/profiles-extra-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Array.from(userIds))
        });
        const data = await res.json();
        extraProfiles = data.profiles || {};
      } catch {
        // Ignorer l'erreur
      }

      const friendsWithProfiles: FriendWithProfile[] = (friendsData || []).map(f => {
        const otherUserId = f.user_id === userId ? f.friend_id : f.user_id;
        const baseProfile = otherUserId ? profileMap.get(otherUserId) || null : null;
        const extra = otherUserId ? extraProfiles[otherUserId] : null;
        
        return {
          ...f,
          profile: baseProfile ? {
            ...baseProfile,
            display_name: extra?.display_name || null,
            bio: extra?.bio || null
          } : null
        };
      });

      const accepted = friendsWithProfiles.filter(f => f.status === 'accepted');
      const pending = friendsWithProfiles.filter(f => f.status === 'pending' && f.friend_id === userId);

      setFriends(accepted);
      setPendingRequests(pending);
      setLoading(false);
    } finally {
      isFetchingRef.current = false;
    }
  }, [userId]);

  useEffect(() => {
    fetchFriends();
  }, [fetchFriends]);

  /**
   * Real-time subscription pour les changements sur la table friends ET profiles
   * Rafraîchit automatiquement la liste dès qu'une ligne est modifiée
   */
  useEffect(() => {
    if (!userId) return;

    console.log('[useFriends] 📡 Abonnement Realtime sur tables friends + profiles');

    const channel = supabase
      .channel('friends-realtime')
      // Écouter tous les événements (INSERT, UPDATE, DELETE) pour friend_id = userId
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'friends',
          filter: `friend_id=eq.${userId}`
        },
        (payload) => {
          console.log('[useFriends] 📨 Changement friends (friend_id):', payload.eventType);
          fetchFriends();
        }
      )
      // Écouter aussi pour user_id = userId
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'friends',
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          console.log('[useFriends] 📨 Changement friends (user_id):', payload.eventType);
          fetchFriends();
        }
      )
      // Écouter les changements de profils (pour les pastilles de présence)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles'
        },
        (payload) => {
          console.log('[useFriends] 🟢 Changement profil détecté:', payload.new);
          // Mettre à jour le statut du profil localement sans refetch complet
          setFriends(prev => prev.map(f => {
            if (f.profile?.id === (payload.new as any)?.id) {
              return { ...f, profile: { ...f.profile, ...(payload.new as any) } };
            }
            return f;
          }));
        }
      )
      .subscribe((status) => {
        console.log('[useFriends] Subscription status:', status);
      });

    return () => {
      console.log('[useFriends] 📴 Désabonnement Realtime');
      supabase.removeChannel(channel);
    };
  }, [userId, fetchFriends]);

  const searchUsers = async (query: string): Promise<Profile[]> => {
    if (!query.trim()) return [];
    
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .ilike('username', `%${query}%`)
      .neq('id', userId || '')
      .limit(10);

    if (error) {
      console.error('Error searching users:', error);
      return [];
    }
    return data || [];
  };

  const sendFriendRequest = async (friendId: string) => {
    if (!userId) return { error: new Error('Not logged in') };

    const { error } = await supabase
      .from('friends')
      .insert({
        user_id: userId,
        friend_id: friendId,
        status: 'pending'
      });

    if (!error) {
      // Le Realtime va automatiquement rafraîchir
      console.log('[useFriends] ✅ Demande d\'ami envoyée');
    }
    return { error };
  };

  const acceptFriendRequest = async (requestId: string) => {
    const { error } = await supabase
      .from('friends')
      .update({ status: 'accepted' })
      .eq('id', requestId);

    if (!error) {
      console.log('[useFriends] ✅ Demande acceptée');
    }
    return { error };
  };

  const rejectFriendRequest = async (requestId: string) => {
    const { error } = await supabase
      .from('friends')
      .delete()
      .eq('id', requestId);

    if (!error) {
      console.log('[useFriends] ✅ Demande rejetée');
    }
    return { error };
  };

  /**
   * Supprimer un ami (supprime la relation d'amitié)
   */
  const removeFriend = async (friendId: string) => {
    if (!userId) return { error: new Error('Not logged in') };

    // Supprimer dans les deux sens (user_id -> friend_id ET friend_id -> user_id)
    const { error: error1 } = await supabase
      .from('friends')
      .delete()
      .eq('user_id', userId)
      .eq('friend_id', friendId);

    const { error: error2 } = await supabase
      .from('friends')
      .delete()
      .eq('user_id', friendId)
      .eq('friend_id', userId);

    const error = error1 || error2;
    if (!error) {
      console.log('[useFriends] ✅ Ami supprimé');
    }
    return { error };
  };

  return {
    friends,
    pendingRequests,
    loading,
    searchUsers,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    removeFriend,
    refetch: fetchFriends
  };
}
