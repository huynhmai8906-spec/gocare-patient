export interface Profile {
  name: string;
  phone: string;
  address: string;
  familyName: string;
  familyPhone: string;
  doctorPhone: string;
  emergencyPhone: string;
  autoDial: boolean;
}

export interface VoiceSettings {
  on: boolean;
  rate: number;
  voiceName: string;
}

export interface LinkSettings {
  bridgeUrl: string;
  token: string;
}

export interface Medication {
  id: string;
  name: string;
  dose: string;
  times: string[];
  note: string;
  icon: string;
}

export type DoseStatus = 'taken' | 'due' | 'missed' | 'upcoming';

export interface TodayDose {
  key: string;
  med: Medication;
  time: string;
  status: DoseStatus;
  dueAt: Date;
}

export interface SafetyZone {
  on: boolean;
  home: { lat: number; lng: number } | null;
  radius: number;
}

export interface VitalRecord {
  at: string;
  sys: number | null;
  dia: number | null;
  pulse: number | null;
  sugar: number | null;
  level?: 'ok' | 'warn' | 'bad';
}

export interface Appointment {
  id: string;
  title: string;
  at: string;
  place: string;
  d1?: boolean;
  h1?: boolean;
}

export interface EmergencyAlert {
  type: string;
  title: string;
  createdAt: string;
  synced: boolean;
  error?: string | null;
  snapshotUrl?: string;
  supabaseId?: string | number | null;
}

export interface Camera {
  id: string;
  name: string;
  source: string;
  running: boolean;
  zone?: string;
  error?: string;
}

export interface UserSession {
  token: string;
  user: {
    id: string;
    email?: string;
    name: string;
    phone: string;
  };
}

export interface AppState {
  profile: Profile;
  voice: VoiceSettings;
  size: 'l' | 'xl';
  link: LinkSettings;
  meds: Medication[];
  log: Record<string, Record<string, { status: 'taken'; at: string }>>;
  snooze: Record<string, number>;
  zone: SafetyZone;
  vitals: VitalRecord[];
  appts: Appointment[];
  pending: any[];
  seenAlertId: string | null;
  lastCheckin: string | null;
  sentAlerts?: EmergencyAlert[];
  onboarded?: boolean;
}

export type TabScreen = 'home' | 'meds' | 'safety' | 'health' | 'settings';
