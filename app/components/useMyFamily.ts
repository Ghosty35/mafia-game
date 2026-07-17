'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export type FamilyMember = {
  player_id?: string; // present once migration 074 is live
  username: string | null;
  role: string;
  level?: number;
  joined_at?: string;
  donated?: number;
};

export type MyFamilyData = {
  family: {
    id: string;
    name: string;
    tag: string;
    description?: string | null;
    created_at?: string;
    respect: number;
    territory: number;
    wars_won?: number;
    member_count: number;
    bank: number;
    power?: number;
  } | null;
  my_role: string | null;
  my_donated?: number;
  members: FamilyMember[];
  territories?: string[]; // city names, from 074
};

const LEADER_ROLES = ['boss', 'underboss'];
const TREASURY_ROLES = ['boss', 'underboss', 'accountant'];
const MANAGER_ROLES = ['boss', 'underboss', 'manager'];

// One fetch shared by all /families/* pages: current family + my role.
export function useMyFamily() {
  const [data, setData] = useState<MyFamilyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data: res, error: err } = await supabase.rpc('get_my_family');
    if (err) {
      setError(err.message);
      setData({ family: null, my_role: null, members: [] });
    } else {
      setError(null);
      setData(res || { family: null, my_role: null, members: [] });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const role = data?.my_role ?? '';
  return {
    data,
    loading,
    error,
    reload,
    inFamily: !!data?.family,
    isLeader: LEADER_ROLES.includes(role),
    canManageTreasury: TREASURY_ROLES.includes(role),
    canManageMembers: MANAGER_ROLES.includes(role),
  };
}
