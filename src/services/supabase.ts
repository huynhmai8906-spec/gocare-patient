import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { GOCARE_CONFIG } from '../config';
import { AppState, UserSession } from '../types';

let sbInstance: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!sbInstance && typeof window !== 'undefined') {
    try {
      sbInstance = createClient(GOCARE_CONFIG.supabaseUrl, GOCARE_CONFIG.supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'gocare-patient-auth',
        },
      });
    } catch (e) {
      console.warn('Could not initialize Supabase:', e);
    }
  }
  return sbInstance;
}

export function toSession(s: any): UserSession | null {
  if (!s || !s.user) return null;
  const m = s.user.user_metadata || {};
  return {
    token: s.access_token,
    user: {
      id: s.user.id,
      email: s.user.email,
      name: m.full_name || m.name || (s.user.email || '').split('@')[0] || 'Bệnh nhân',
      phone: m.phone || '',
    },
  };
}

let hasDataTable = true;

export async function pushDataToCloud(session: UserSession, state: AppState): Promise<boolean> {
  const sb = getSupabase();
  if (!session || !sb) return false;

  const { pending, link, ...data } = state;

  try {
    if (hasDataTable) {
      const { error } = await sb.from('patient_app_data').upsert({
        user_id: session.user.id,
        data,
        updated_at: new Date().toISOString(),
      });
      if (error && /patient_app_data|does not exist|PGRST205|42P01/i.test(`${error.code} ${error.message}`)) {
        hasDataTable = false;
      } else if (error) {
        throw error;
      }
    }

    if (!hasDataTable) {
      const slim = {
        ...data,
        vitals: data.vitals.slice(0, 20),
        log: Object.fromEntries(Object.entries(data.log).slice(-7)),
      };
      const { error } = await sb.auth.updateUser({
        data: { gocare_app: slim },
      });
      if (error) throw error;
    }
    return true;
  } catch (err) {
    console.warn('Cloud sync failed:', err);
    return false;
  }
}

export async function pullDataFromCloud(user: { id: string; user_metadata?: any }): Promise<Partial<AppState> | null> {
  const sb = getSupabase();
  if (!sb || !user?.id) return null;

  try {
    const { data, error } = await sb
      .from('patient_app_data')
      .select('data')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error && /patient_app_data|does not exist|PGRST205|42P01/i.test(`${error.code} ${error.message}`)) {
      hasDataTable = false;
    }
    return data?.data || user.user_metadata?.gocare_app || null;
  } catch {
    return user.user_metadata?.gocare_app || null;
  }
}

export async function syncPatientProfile(session: UserSession, state: AppState): Promise<void> {
  const sb = getSupabase();
  if (!session || !sb) return;

  const p = state.profile;
  const row = {
    user_id: session.user.id,
    full_name: p.name || session.user.name,
    emergency_phone: p.familyPhone || p.phone || null,
    guardian_name: p.familyName || null,
    service_need: `App Bệnh Nhân GoCare${p.address ? ' · ' + p.address : ''}`,
  };

  try {
    const { data } = await sb.from('patient_profiles').select('id').eq('user_id', session.user.id).maybeSingle();
    if (data?.id) {
      await sb.from('patient_profiles').update(row).eq('id', data.id);
    } else {
      await sb.from('patient_profiles').insert(row);
    }
  } catch {
    // Non-blocking sync
  }
}
