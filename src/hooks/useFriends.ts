import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Friend = Tables<'friends'>;
type Profile = Tables<'profiles'>;

export interface FriendWithProfile extends Friend {
  profile: Profile | null;
}

export function useFriends(userId: string | undefined) {
  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [pendingRequests, setPendingRequests] = useState<FriendWithProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFriends = useCallback(async () => {
    if (!userId) return;

    // Get all friend relationships
    const { data: friendsData, error } = await supabase
      .from('friends')
      .select('*')
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`);

    if (error) {
      console.error('Error fetching friends:', error);
      setLoading(false);
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

    const friendsWithProfiles: FriendWithProfile[] = (friendsData || []).map(f => {
      const otherUserId = f.user_id === userId ? f.friend_id : f.user_id;
      return {
        ...f,
        profile: otherUserId ? profileMap.get(otherUserId) || null : null
      };
    });

    const accepted = friendsWithProfiles.filter(f => f.status === 'accepted');
    const pending = friendsWithProfiles.filter(f => f.status === 'pending' && f.friend_id === userId);

    setFriends(accepted);
    setPendingRequests(pending);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchFriends();
  }, [fetchFriends]);

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
      fetchFriends();
    }
    return { error };
  };

  const acceptFriendRequest = async (requestId: string) => {
    const { error } = await supabase
      .from('friends')
      .update({ status: 'accepted' })
      .eq('id', requestId);

    if (!error) {
      fetchFriends();
    }
    return { error };
  };

  const rejectFriendRequest = async (requestId: string) => {
    const { error } = await supabase
      .from('friends')
      .delete()
      .eq('id', requestId);

    if (!error) {
      fetchFriends();
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
    refetch: fetchFriends
  };
}