import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  AppState,
  TabScreen,
  UserSession,
  Medication,
  VitalRecord,
  Appointment,
  Camera,
  EmergencyAlert,
  TodayDose,
} from '../types';
import { DEFAULTS, STORE_KEY } from '../config';
import {
  getSupabase,
  toSession,
  pullDataFromCloud,
  pushDataToCloud,
  syncPatientProfile as syncProfileToCloud,
} from '../services/supabase';
import { say as speakText, checkTtsStatus, subscribeSpeaking, stopSpeaking } from '../services/voice';
import { playChime, playBeep, setSiren, vibrate } from '../services/audio';
import {
  getTodayDoses,
  todayKey,
  haversineDistance,
  classifyVitals,
  vitalSummaryText,
  triggerConfettiBurst,
} from '../utils/helpers';

interface AppContextType {
  state: AppState;
  session: UserSession | null;
  activeTab: TabScreen;
  setActiveTab: (tab: TabScreen) => void;
  speak: (text: string, force?: boolean) => void;
  isSpeaking: boolean;
  toggleVoice: () => void;
  showToast: (msg: string) => void;
  toastMsg: string | null;
  updateProfile: (profile: Partial<AppState['profile']>) => void;
  updateVoice: (voice: Partial<AppState['voice']>) => void;
  updateSize: (size: 'l' | 'xl') => void;
  updateLink: (link: Partial<AppState['link']>) => void;
  addOrUpdateMed: (med: Medication) => void;
  deleteMed: (id: string) => void;
  markDoseTaken: (key: string) => void;
  snoozeDose: (key: string) => void;
  recordVital: (vital: Omit<VitalRecord, 'level'>) => { level: string; issues: string[] };
  addAppointment: (appt: Omit<Appointment, 'id'>) => void;
  deleteAppointment: (id: string) => void;
  sendEmergencyAlert: (payload: { type: string; note?: string; [key: string]: any }) => Promise<{ ok: boolean; error?: string }>;
  startSOSCountdown: () => void;
  cancelSOSCountdown: () => void;
  sosCountdown: number | null;
  setHomeLocation: () => Promise<boolean>;
  toggleSafetyZone: () => Promise<void>;
  updateZoneRadius: (r: number) => void;
  zoneStatus: { dist: number | null; acc: number | null; outside: boolean; error: string | null; alarm: boolean };
  testZoneAlarm: () => void;
  activeReminder: TodayDose | null;
  dismissReminder: () => void;
  syncStatus: 'ok' | 'offline' | 'syncing';
  signOut: () => Promise<void>;
  authView: 'login' | 'register' | 'forgot' | 'reset' | null;
  setAuthView: (view: 'login' | 'register' | 'forgot' | 'reset' | null) => void;
  onboardingStep: number | null;
  setOnboardingStep: (step: number | null) => void;
  cameras: Camera[];
  refreshCameras: () => Promise<void>;
  addCamera: (cam: { name: string; source: string; zone?: boolean }) => Promise<void>;
  toggleCamera: (id: string, start: boolean) => Promise<void>;
  deleteCamera: (id: string) => Promise<void>;
  wakeLockActive: boolean;
  toggleWakeLock: () => Promise<void>;
  editingMed: Medication | null | 'new';
  setEditingMed: (m: Medication | null | 'new') => void;
  addingAppt: boolean;
  setAddingAppt: (b: boolean) => void;
  addingCam: boolean;
  setAddingCam: (b: boolean) => void;
}

const AppContext = createContext<AppContextType | null>(null);

function loadLocalState(userId?: string): AppState {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const key = userId ? `${STORE_KEY}.${userId}` : STORE_KEY;
    const raw = localStorage.getItem(key) || localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULTS,
      ...parsed,
      profile: { ...DEFAULTS.profile, ...parsed.profile },
      voice: { ...DEFAULTS.voice, ...parsed.voice },
      link: { ...DEFAULTS.link, ...parsed.link },
      zone: { ...DEFAULTS.zone, ...parsed.zone },
    };
  } catch {
    return DEFAULTS;
  }
}

function saveLocalState(state: AppState, userId?: string) {
  if (typeof window === 'undefined') return;
  try {
    const key = userId ? `${STORE_KEY}.${userId}` : STORE_KEY;
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<UserSession | null>(null);
  const [state, setState] = useState<AppState>(() => loadLocalState());
  const [activeTab, setActiveTab] = useState<TabScreen>('home');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'ok' | 'offline' | 'syncing'>('ok');
  const [authView, setAuthView] = useState<'login' | 'register' | 'forgot' | 'reset' | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);

  // Sheets & Overlays
  const [sosCountdown, setSosCountdown] = useState<number | null>(null);
  const [activeReminder, setActiveReminder] = useState<TodayDose | null>(null);
  const [editingMed, setEditingMed] = useState<Medication | null | 'new'>(null);
  const [addingAppt, setAddingAppt] = useState(false);
  const [addingCam, setAddingCam] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  // Safety Zone GPS state
  const [zoneStatus, setZoneStatus] = useState<{
    dist: number | null;
    acc: number | null;
    outside: boolean;
    error: string | null;
    alarm: boolean;
  }>({
    dist: null,
    acc: null,
    outside: false,
    error: null,
    alarm: false,
  });

  // Cameras
  const [cameras, setCameras] = useState<Camera[]>([
    { id: 'cam-demo', name: 'Phòng khách', source: 'Webcam chính', running: true, zone: 'Khu vực an toàn' }
  ]);

  const wakeLockRef = useRef<any>(null);
  const syncTimerRef = useRef<any>(null);
  const sosIntervalRef = useRef<any>(null);
  const watchIdRef = useRef<number | null>(null);

  // Subscribe to voice speaking state
  useEffect(() => {
    return subscribeSpeaking(setIsSpeaking);
  }, []);

  // Update root font size attribute
  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (state.size === 'xl') {
        document.documentElement.setAttribute('data-size', 'xl');
      } else {
        document.documentElement.removeAttribute('data-size');
      }
    }
  }, [state.size]);

  // Speech helper
  const speak = useCallback(
    (text: string, force = false) => {
      speakText(text, state.voice, state.link.bridgeUrl, { force });
    },
    [state.voice, state.link.bridgeUrl]
  );

  const toggleVoice = useCallback(() => {
    setState(prev => {
      const next = !prev.voice.on;
      const updated = { ...prev, voice: { ...prev.voice, on: next } };
      saveLocalState(updated, session?.user.id);
      if (next) {
        speakText('Đã bật giọng đọc', updated.voice, updated.link.bridgeUrl, { force: true });
      } else {
        stopSpeaking();
      }
      return updated;
    });
  }, [session?.user.id]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    if (toastMsg) {
      const t = setTimeout(() => setToastMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toastMsg]);

  // Save and Cloud sync debounce
  const triggerSaveAndSync = useCallback((newState: AppState) => {
    saveLocalState(newState, session?.user.id);
    if (!session) return;

    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(async () => {
      setSyncStatus('syncing');
      const ok = await pushDataToCloud(session, newState);
      setSyncStatus(ok ? 'ok' : 'offline');
    }, 1500);
  }, [session]);

  // Supabase boot & session restore
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;

    checkTtsStatus(state.link.bridgeUrl);

    sb.auth.getSession().then(({ data }) => {
      if (data?.session) {
        const sess = toSession(data.session);
        setSession(sess);
        const local = loadLocalState(sess?.user.id);
        setState(local);
        if (local.onboarded === false) {
          setOnboardingStep(0);
        }
        // Pull latest from Supabase
        pullDataFromCloud(data.session.user).then(serverData => {
          if (serverData) {
            setState(prev => {
              const merged = { ...prev, ...serverData };
              saveLocalState(merged, sess?.user.id);
              return merged;
            });
          }
        });
      }
    });

    const { data: authListener } = sb.auth.onAuthStateChange(async (event, newSession) => {
      if (event === 'SIGNED_IN' && newSession) {
        const s = toSession(newSession);
        setSession(s);
        const serverData = await pullDataFromCloud(newSession.user);
        const loaded = serverData ? { ...DEFAULTS, ...serverData } : loadLocalState(s?.user.id);
        if (s?.user.name) loaded.profile.name = loaded.profile.name || s.user.name;
        if (s?.user.phone) loaded.profile.phone = loaded.profile.phone || s.user.phone;
        setState(loaded);
        saveLocalState(loaded, s?.user.id);
        setAuthView(null);
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        const guestState = loadLocalState();
        setState(guestState);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Medication reminder checker
  useEffect(() => {
    const checkReminders = () => {
      const now = Date.now();
      const todayDoses = getTodayDoses(state.meds, state.log);

      for (const d of todayDoses) {
        if (d.status === 'due') {
          if ((state.snooze[d.key] || 0) > now) continue;
          if (!activeReminder && sosCountdown === null) {
            setActiveReminder(d);
            playChime();
            vibrate([300, 200, 300]);
            speak(
              `Đến giờ uống thuốc rồi ạ. ${d.med.name}, ${d.med.dose}, ${d.med.note}. Uống xong, bạn bấm nút Đã uống nhé.`,
              true
            );
            return;
          }
        }
      }

      // Check upcoming appointments (d1: 24h before, h1: 1h before)
      for (const a of state.appts) {
        const at = new Date(a.at).getTime();
        if (!a.d1 && now >= at - 86400000 && now < at) {
          a.d1 = true;
          triggerSaveAndSync(state);
          speak(`Lịch hẹn khám ngày mai: ${a.title}`, true);
          showToast(`Lịch hẹn khám ngày mai: ${a.title}`);
          return;
        }
        if (!a.h1 && now >= at - 3600000 && now < at) {
          a.h1 = true;
          triggerSaveAndSync(state);
          speak(`Một giờ nữa bạn có lịch hẹn khám: ${a.title}`, true);
          showToast(`Một giờ nữa: ${a.title}`);
          return;
        }
      }
    };

    const interval = setInterval(checkReminders, 20000);
    return () => clearInterval(interval);
  }, [state, activeReminder, sosCountdown, speak, showToast, triggerSaveAndSync]);

  // Profile update
  const updateProfile = useCallback((profile: Partial<AppState['profile']>) => {
    setState(prev => {
      const updated = { ...prev, profile: { ...prev.profile, ...profile } };
      triggerSaveAndSync(updated);
      if (session) {
        syncProfileToCloud(session, updated);
      }
      return updated;
    });
  }, [session, triggerSaveAndSync]);

  // Voice update
  const updateVoice = useCallback((voice: Partial<AppState['voice']>) => {
    setState(prev => {
      const updated = { ...prev, voice: { ...prev.voice, ...voice } };
      triggerSaveAndSync(updated);
      return updated;
    });
  }, [triggerSaveAndSync]);

  // Size update
  const updateSize = useCallback((size: 'l' | 'xl') => {
    setState(prev => {
      const updated = { ...prev, size };
      triggerSaveAndSync(updated);
      return updated;
    });
  }, [triggerSaveAndSync]);

  // Link update
  const updateLink = useCallback((link: Partial<AppState['link']>) => {
    setState(prev => {
      const updated = { ...prev, link: { ...prev.link, ...link } };
      triggerSaveAndSync(updated);
      return updated;
    });
  }, [triggerSaveAndSync]);

  // Meds CRUD
  const addOrUpdateMed = useCallback((med: Medication) => {
    setState(prev => {
      const idx = prev.meds.findIndex(m => m.id === med.id);
      let updatedMeds: Medication[];
      if (idx >= 0) {
        updatedMeds = [...prev.meds];
        updatedMeds[idx] = med;
      } else {
        updatedMeds = [...prev.meds, med];
      }
      const updated = { ...prev, meds: updatedMeds };
      triggerSaveAndSync(updated);
      return updated;
    });
  }, [triggerSaveAndSync]);

  const deleteMed = useCallback((id: string) => {
    setState(prev => {
      const updatedMeds = prev.meds.filter(m => m.id !== id);
      const updated = { ...prev, meds: updatedMeds };
      triggerSaveAndSync(updated);
      return updated;
    });
  }, [triggerSaveAndSync]);

  const markDoseTaken = useCallback((key: string) => {
    const tKey = todayKey();
    const nowIso = new Date().toISOString();
    setState(prev => {
      const dayLog = { ...(prev.log[tKey] || {}) };
      dayLog[key] = { status: 'taken', at: nowIso };
      const updated = {
        ...prev,
        log: { ...prev.log, [tKey]: dayLog },
        snooze: { ...prev.snooze, [key]: 0 },
      };
      triggerSaveAndSync(updated);
      return updated;
    });
    if (activeReminder?.key === key) {
      setActiveReminder(null);
    }
    triggerConfettiBurst();
    playBeep();
    speak('Đã ghi nhận uống thuốc');
    showToast('Đã uống thuốc');
  }, [activeReminder, speak, showToast, triggerSaveAndSync]);

  const snoozeDose = useCallback((key: string) => {
    setState(prev => {
      const updated = {
        ...prev,
        snooze: { ...prev.snooze, [key]: Date.now() + 10 * 60000 },
      };
      triggerSaveAndSync(updated);
      return updated;
    });
    setActiveReminder(null);
    speak('Dạ, 10 phút nữa sẽ nhắc lại ạ.');
  }, [speak, triggerSaveAndSync]);

  // Vitals
  const recordVital = useCallback((vital: Omit<VitalRecord, 'level'>) => {
    const c = classifyVitals(vital);
    const newRecord: VitalRecord = { ...vital, level: c.level };
    setState(prev => {
      const updated = { ...prev, vitals: [newRecord, ...prev.vitals].slice(0, 60) };
      triggerSaveAndSync(updated);
      return updated;
    });
    return c;
  }, [triggerSaveAndSync]);

  // Appointments
  const addAppointment = useCallback((appt: Omit<Appointment, 'id'>) => {
    const newAppt: Appointment = { ...appt, id: Math.random().toString(36).slice(2, 9) };
    setState(prev => {
      const updated = { ...prev, appts: [...prev.appts, newAppt] };
      triggerSaveAndSync(updated);
      return updated;
    });
  }, [triggerSaveAndSync]);

  const deleteAppointment = useCallback((id: string) => {
    setState(prev => {
      const updated = { ...prev, appts: prev.appts.filter(a => a.id !== id) };
      triggerSaveAndSync(updated);
      return updated;
    });
  }, [triggerSaveAndSync]);

  // Emergency Alert sender
  const sendEmergencyAlert = useCallback(async (payload: { type: string; note?: string; [key: string]: any }) => {
    const p = state.profile;
    const body = {
      patientName: p.name,
      phone: p.phone,
      familyPhone: p.familyPhone,
      address: p.address,
      source: 'app',
      ...payload,
      clientTime: new Date().toISOString(),
    };

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.token) {
        headers['Authorization'] = `Bearer ${session.token}`;
      }

      const res = await fetch('/api/emergency', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (data?.alert) {
        const alertRecord: EmergencyAlert = {
          type: payload.type,
          title: data.alert.title || 'Cấp cứu',
          createdAt: new Date().toISOString(),
          synced: data.alert.synced ?? true,
          error: data.alert.error,
          supabaseId: data.alert.supabaseId,
        };
        setState(prev => {
          const updated = {
            ...prev,
            sentAlerts: [alertRecord, ...(prev.sentAlerts || [])].slice(0, 30),
          };
          triggerSaveAndSync(updated);
          return updated;
        });
        return { ok: true };
      }
      return { ok: false, error: data?.error || 'Không gửi được' };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }, [state.profile, session?.token, triggerSaveAndSync]);

  // SOS Countdown
  const startSOSCountdown = useCallback(() => {
    if (sosCountdown !== null) return;
    setSosCountdown(5);
    speak('Sẽ gọi cấp cứu sau 5 giây. Nếu bấm nhầm, bạn bấm nút Hủy nhé.', true);
    vibrate([200, 100, 200]);

    let count = 5;
    sosIntervalRef.current = setInterval(() => {
      count -= 1;
      setSosCountdown(count);
      if (count > 0) {
        playBeep();
      } else {
        clearInterval(sosIntervalRef.current);
        sosIntervalRef.current = null;
        setSosCountdown(null);

        // Trigger real emergency
        setSiren(true);
        speak('Đang gửi tín hiệu cấp cứu tới bệnh viện và gọi 115', true);
        sendEmergencyAlert({ type: 'sos', note: 'Bệnh nhân bấm nút Gọi Cấp Cứu trên app' }).then(res => {
          if (res.ok) {
            showToast('Đã phát tín hiệu cấp cứu tới bệnh viện!');
          }
        });

        // Trigger phone call if autoDial is enabled
        if (state.profile.autoDial) {
          const phone = state.profile.emergencyPhone || '115';
          window.location.href = `tel:${phone}`;
        }
      }
    }, 1000);
  }, [sosCountdown, speak, sendEmergencyAlert, state.profile.autoDial, state.profile.emergencyPhone, showToast]);

  const cancelSOSCountdown = useCallback(() => {
    if (sosIntervalRef.current) {
      clearInterval(sosIntervalRef.current);
      sosIntervalRef.current = null;
    }
    setSosCountdown(null);
    setSiren(false);
    speak('Đã hủy gọi cấp cứu');
    showToast('Đã hủy cấp cứu');
  }, [speak, showToast]);

  // Safety Zone GPS
  const setHomeLocation = useCallback(async () => {
    speak('Đang lấy vị trí hiện tại');
    return new Promise<boolean>((resolve) => {
      if (!navigator.geolocation) {
        showToast('Máy không hỗ trợ định vị');
        resolve(false);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => {
          const home = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setState(prev => {
            const updated = { ...prev, zone: { ...prev.zone, home } };
            triggerSaveAndSync(updated);
            return updated;
          });
          speak('Đã lưu vị trí nhà');
          showToast('Đã lưu vị trí nhà');
          resolve(true);
        },
        () => {
          speak('Không lấy được vị trí GPS');
          showToast('Không lấy được vị trí — hãy bật GPS');
          resolve(false);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }, [speak, showToast, triggerSaveAndSync]);

  const toggleSafetyZone = useCallback(async () => {
    if (state.zone.on) {
      // Turn off
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setSiren(false);
      setZoneStatus(prev => ({ ...prev, outside: false, alarm: false }));
      setState(prev => {
        const updated = { ...prev, zone: { ...prev.zone, on: false } };
        triggerSaveAndSync(updated);
        return updated;
      });
      speak('Đã tắt canh vùng an toàn');
    } else {
      // Turn on
      let home = state.zone.home;
      if (!home) {
        const ok = await setHomeLocation();
        if (!ok) return;
        home = state.zone.home;
      }
      setState(prev => {
        const updated = { ...prev, zone: { ...prev.zone, on: true } };
        triggerSaveAndSync(updated);
        return updated;
      });
      speak('Đã bật canh vùng an toàn GPS');

      if (navigator.geolocation) {
        watchIdRef.current = navigator.geolocation.watchPosition(
          pos => {
            if (!state.zone.home) return;
            const dist = haversineDistance(state.zone.home, {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            });
            const acc = Math.round(pos.coords.accuracy);
            const isOutside = dist > state.zone.radius;

            setZoneStatus({
              dist,
              acc,
              outside: isOutside,
              error: null,
              alarm: isOutside,
            });

            if (isOutside) {
              setSiren(true);
              speak('Cảnh báo: Bạn đang ở ngoài vùng an toàn đã cài đặt.', true);
              sendEmergencyAlert({
                type: 'geofence',
                distance: dist,
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                note: `Khoảng cách ${Math.round(dist)}m so với nhà (vượt bán kính ${state.zone.radius}m)`,
              });
            } else {
              setSiren(false);
            }
          },
          err => {
            setZoneStatus(prev => ({
              ...prev,
              error: err.code === 1 ? 'Chưa cho phép dùng vị trí' : 'Không bắt được GPS',
            }));
          },
          { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 }
        );
      }
    }
  }, [state.zone, setHomeLocation, speak, sendEmergencyAlert, triggerSaveAndSync]);

  const updateZoneRadius = useCallback((r: number) => {
    setState(prev => {
      const updated = { ...prev, zone: { ...prev.zone, radius: r } };
      triggerSaveAndSync(updated);
      return updated;
    });
    speak(`Bán kính an toàn ${r >= 1000 ? '1 ki-lô-mét' : r + ' mét'}`);
  }, [speak, triggerSaveAndSync]);

  const testZoneAlarm = useCallback(() => {
    setZoneStatus(prev => ({ ...prev, alarm: true, outside: true }));
    setSiren(true);
    speak('Thử nghiệm báo động ra khỏi vùng an toàn. Còi và giọng đọc đang vang lên.', true);
    showToast('Đang thử còi báo động');
    setTimeout(() => {
      setSiren(false);
      setZoneStatus(prev => ({ ...prev, alarm: false, outside: false }));
    }, 6000);
  }, [speak, showToast]);

  // Cameras
  const refreshCameras = useCallback(async () => {
    try {
      const base = state.link.bridgeUrl ? state.link.bridgeUrl.replace(/\/+$/, '') : location.origin;
      const res = await fetch(`${base}/api/cameras`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setCameras(data);
      }
    } catch {
      // Fallback to local cameras state
    }
  }, [state.link.bridgeUrl]);

  const addCamera = useCallback(async (cam: { name: string; source: string; zone?: boolean }) => {
    const newCam: Camera = {
      id: 'cam-' + Math.random().toString(36).slice(2, 8),
      name: cam.name || 'Camera',
      source: cam.source,
      running: true,
      zone: cam.zone ? 'Có vùng an toàn trong nhà' : undefined,
    };
    setCameras(prev => [...prev, newCam]);
    speak(`Đã cài ${newCam.name}`);
    showToast(`Đã cài ${newCam.name}`);
  }, [speak, showToast]);

  const toggleCamera = useCallback(async (id: string, start: boolean) => {
    setCameras(prev =>
      prev.map(c => (c.id === id ? { ...c, running: start } : c))
    );
    speak(start ? 'Đang bật camera' : 'Đã tắt camera');
    showToast(start ? 'Đã bật camera' : 'Đã tắt camera');
  }, [speak, showToast]);

  const deleteCamera = useCallback(async (id: string) => {
    setCameras(prev => prev.filter(c => c.id !== id));
    speak('Đã xóa camera');
    showToast('Đã xóa camera');
  }, [speak, showToast]);

  // Wake Lock
  const toggleWakeLock = useCallback(async () => {
    if (wakeLockActive && wakeLockRef.current) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
      setWakeLockActive(false);
      speak('Đã tắt giữ màn hình sáng');
      showToast('Đã tắt giữ màn hình sáng');
    } else if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        setWakeLockActive(true);
        speak('Màn hình sẽ luôn sáng');
        showToast('Màn hình luôn sáng');
      } catch {
        showToast('Không thể bật giữ màn hình');
      }
    } else {
      showToast('Thiết bị không hỗ trợ Wake Lock');
    }
  }, [wakeLockActive, speak, showToast]);

  // Sign out
  const signOut = useCallback(async () => {
    const sb = getSupabase();
    try {
      await sb?.auth.signOut();
    } catch {
      // Ignore signOut error
    }
    setSession(null);
    setState(DEFAULTS);
    setAuthView('login');
    speak('Đã đăng xuất. Hẹn gặp lại bạn nhé.');
  }, [speak]);

  return (
    <AppContext.Provider
      value={{
        state,
        session,
        activeTab,
        setActiveTab,
        speak,
        isSpeaking,
        toggleVoice,
        showToast,
        toastMsg,
        updateProfile,
        updateVoice,
        updateSize,
        updateLink,
        addOrUpdateMed,
        deleteMed,
        markDoseTaken,
        snoozeDose,
        recordVital,
        addAppointment,
        deleteAppointment,
        sendEmergencyAlert,
        startSOSCountdown,
        cancelSOSCountdown,
        sosCountdown,
        setHomeLocation,
        toggleSafetyZone,
        updateZoneRadius,
        zoneStatus,
        testZoneAlarm,
        activeReminder,
        dismissReminder: () => setActiveReminder(null),
        syncStatus,
        signOut,
        authView,
        setAuthView,
        onboardingStep,
        setOnboardingStep,
        cameras,
        refreshCameras,
        addCamera,
        toggleCamera,
        deleteCamera,
        wakeLockActive,
        toggleWakeLock,
        editingMed,
        setEditingMed,
        addingAppt,
        setAddingAppt,
        addingCam,
        setAddingCam,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}
