/**
 * Hook pour gérer les appels avec historique et notifications Realtime
 * 
 * FONCTIONNALITÉS:
 * - Historique des appels
 * - Notifications push même déconnecté
 * - Statut "en appel" visible par les amis
 * - Appels manqués
 * - Durée des appels
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SERVER_CONFIG } from '@/config/server';

export interface Call {
  id: string;
  caller_id: string;
  receiver_id: string;
  status: 'calling' | 'accepted' | 'rejected' | 'ended' | 'missed';
  call_type: 'audio' | 'video';
  started_at: string;
  ended_at?: string;
  duration_seconds?: number;
  created_at?: string;
  updated_at?: string;
}

export const useCalls = (userId: string | undefined) => {
  const [calls, setCalls] = useState<Call[]>([]);
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [loading, setLoading] = useState(true);
  
  /**
   * Récupérer l'historique des appels
   */
  const fetchCallHistory = useCallback(async () => {
    if (!userId) return;
    
    try {
      setLoading(true);
      
      // Récupérer depuis Supabase directement
      const { data, error } = await supabase
        .from('calls')
        .select('*')
        .or(`caller_id.eq.${userId},receiver_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) {
        console.error('Erreur récupération historique appels:', error);
        // Fallback: essayer via l'API si disponible
        try {
          const response = await fetch(
            `${SERVER_CONFIG.BASE_URL}/api/calls/history/${userId}`,
            {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(5000),
            }
          );
          
          if (response.ok) {
            const result = await response.json();
            setCalls(result.calls || []);
            
            // Trouver un appel actif (calling ou accepted)
            const currentCall = (result.calls || []).find(
              (call: Call) => call.status === 'calling' || call.status === 'accepted'
            );
            setActiveCall(currentCall || null);
          }
        } catch (apiError) {
          console.error('Erreur API historique appels:', apiError);
        }
        return;
      }
      
      setCalls(data || []);
      
      // Trouver un appel actif (calling ou accepted)
      const currentCall = (data || []).find(
        (call: Call) => call.status === 'calling' || call.status === 'accepted'
      );
      setActiveCall(currentCall || null);
      
    } catch (error) {
      console.error('Erreur récupération historique appels:', error);
    } finally {
      setLoading(false);
    }
  }, [userId]);
  
  /**
   * Créer un nouvel appel
   */
  const createCall = useCallback(async (
    receiverId: string, 
    callType: 'audio' | 'video' = 'audio'
  ): Promise<string | null> => {
    if (!userId) return null;
    
    try {
      // Créer dans Supabase directement
      const { data, error } = await supabase
        .from('calls')
        .insert({
          caller_id: userId,
          receiver_id: receiverId,
          call_type: callType,
          status: 'calling',
          started_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (error) {
        console.error('Erreur création appel Supabase:', error);
        // Fallback: essayer via l'API
        try {
          const response = await fetch(
            `${SERVER_CONFIG.BASE_URL}/api/calls/create`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                caller_id: userId,
                receiver_id: receiverId,
                call_type: callType
              }),
              signal: AbortSignal.timeout(5000),
            }
          );
          
          if (response.ok) {
            const result = await response.json();
            console.log('✅ Appel créé via API:', result.call_id);
            return result.call_id;
          }
        } catch (apiError) {
          console.error('Erreur création appel API:', apiError);
        }
        return null;
      }
      
      console.log('✅ Appel créé:', data.id);
      setActiveCall(data);
      await fetchCallHistory();
      return data.id;
      
    } catch (error) {
      console.error('❌ Erreur création appel:', error);
      return null;
    }
  }, [userId, fetchCallHistory]);
  
  /**
   * Mettre à jour le statut d'un appel
   */
  const updateCallStatus = useCallback(async (
    callId: string, 
    status: Call['status']
  ) => {
    try {
      const updateData: Partial<Call> = {
        status,
        updated_at: new Date().toISOString()
      };
      
      // Si l'appel se termine, calculer la durée
      if (status === 'ended' || status === 'rejected' || status === 'missed') {
        updateData.ended_at = new Date().toISOString();
        
        // Récupérer l'appel pour calculer la durée
        const call = calls.find(c => c.id === callId);
        if (call && call.started_at) {
          const start = new Date(call.started_at).getTime();
          const end = new Date().getTime();
          updateData.duration_seconds = Math.floor((end - start) / 1000);
        }
      }
      
      // Mettre à jour dans Supabase
      const { error } = await supabase
        .from('calls')
        .update(updateData)
        .eq('id', callId);
      
      if (error) {
        console.error('Erreur mise à jour appel Supabase:', error);
        // Fallback: essayer via l'API
        try {
          await fetch(
            `${SERVER_CONFIG.BASE_URL}/api/calls/update`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                call_id: callId,
                status: status,
                ended_at: updateData.ended_at,
                duration_seconds: updateData.duration_seconds
              }),
              signal: AbortSignal.timeout(5000),
            }
          );
        } catch (apiError) {
          console.error('Erreur mise à jour appel API:', apiError);
        }
        return;
      }
      
      console.log(`✅ Appel ${callId} mis à jour: ${status}`);
      
      // Mettre à jour le state local
      setCalls(prev => prev.map(call => 
        call.id === callId ? { ...call, ...updateData } : call
      ));
      
      // Si l'appel se termine, retirer de activeCall
      if (status === 'ended' || status === 'rejected' || status === 'missed') {
        if (activeCall?.id === callId) {
          setActiveCall(null);
        }
      }
      
      // Rafraîchir l'historique
      await fetchCallHistory();
      
    } catch (error) {
      console.error('❌ Erreur mise à jour appel:', error);
    }
  }, [calls, activeCall, fetchCallHistory]);
  
  /**
   * S'abonner aux nouvelles notifications d'appel
   */
  useEffect(() => {
    if (!userId || !supabase) return;
    
    console.log(`📞 Abonnement aux appels pour ${userId}`);
    
    // S'abonner aux nouveaux appels entrants
    const subscription = supabase
      .channel(`calls:${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'calls',
        filter: `receiver_id=eq.${userId}`
      }, (payload) => {
        const newCall = payload.new as Call;
        console.log('📞 NOUVEL APPEL REÇU:', newCall);
        
        if (newCall.status === 'calling') {
          // Notification d'appel entrant
          setActiveCall(newCall);
          
          // Émettre un event pour le UI
          const event = new CustomEvent('incoming-call', { 
            detail: newCall 
          });
          window.dispatchEvent(event);
        }
        
        // Ajouter à l'historique
        setCalls(prev => {
          // Vérifier si l'appel existe déjà
          if (prev.some(c => c.id === newCall.id)) {
            return prev;
          }
          return [newCall, ...prev];
        });
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'calls',
        filter: `caller_id=eq.${userId},receiver_id=eq.${userId}`
      }, (payload) => {
        // Mise à jour de tes appels (entrants ou sortants)
        console.log('📞 APPEL MIS À JOUR:', payload.new);
        
        const updatedCall = payload.new as Call;
        
        // Mettre à jour dans le state
        setCalls(prev => prev.map(call => 
          call.id === updatedCall.id ? updatedCall : call
        ));
        
        // Si c'est l'appel actif, le mettre à jour
        if (activeCall?.id === updatedCall.id) {
          setActiveCall(updatedCall);
          
          // Si l'appel se termine, retirer de activeCall
          if (updatedCall.status === 'ended' || updatedCall.status === 'rejected' || updatedCall.status === 'missed') {
            setActiveCall(null);
          }
        }
        
        // Rafraîchir l'historique si nécessaire
        fetchCallHistory();
      })
      .subscribe((status) => {
        console.log(`[Calls] Subscription status: ${status}`);
        if (status === 'SUBSCRIBED') {
          console.log(`[Calls] ✅ Abonnement actif pour ${userId}`);
        }
      });
    
    // Charger l'historique initial
    fetchCallHistory();
    
    return () => {
      console.log('🧹 Nettoyage subscription appels');
      supabase.removeChannel(subscription);
    };
  }, [userId, fetchCallHistory]);
  
  return {
    calls,
    activeCall,
    loading,
    createCall,
    updateCallStatus,
    fetchCallHistory,
    setActiveCall
  };
};
