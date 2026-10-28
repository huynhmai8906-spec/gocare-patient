import { AppState } from './types';

export const GOCARE_CONFIG = {
  supabaseUrl: 'https://niptzzxfgduhcrbofthg.supabase.co',
  supabaseKey: 'sb_publishable_1BbQKqBKyHS7Qo-yglIpkg_pNW14RIV',
  customerWeb: 'https://mai-hu-nh-th-tuy-t-o684.vercel.app/',
  managementWeb: 'https://quanlyweb-bjsh.vercel.app/',
};

export const STORE_KEY = 'gocare.patient.v1';

export const DEFAULTS: AppState = {
  profile: {
    name: '',
    phone: '',
    address: '',
    familyName: '',
    familyPhone: '',
    doctorPhone: '',
    emergencyPhone: '115',
    autoDial: true,
  },
  voice: {
    on: true,
    rate: 0.85,
    voiceName: 'gocare',
  },
  size: 'l',
  link: {
    bridgeUrl: '',
    token: '',
  },
  meds: [
    { id: 'm1', name: 'Thuốc huyết áp', dose: '1 viên', times: ['07:00'], note: 'Sau ăn sáng', icon: '💊' },
    { id: 'm2', name: 'Thuốc tiểu đường', dose: '1 viên', times: ['07:30', '19:30'], note: 'Sau ăn', icon: '🔵' },
  ],
  log: {},
  snooze: {},
  zone: {
    on: false,
    home: null,
    radius: 200,
  },
  vitals: [],
  appts: [],
  pending: [],
  seenAlertId: null,
  lastCheckin: null,
  sentAlerts: [],
  onboarded: true,
};
