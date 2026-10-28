import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { getInitials, calculateAdherence } from '../utils/helpers';
import { loadVoices } from '../services/voice';

export const SettingsScreen: React.FC = () => {
  const {
    state,
    session,
    updateProfile,
    updateVoice,
    updateSize,
    updateLink,
    signOut,
    setAuthView,
    syncStatus,
    wakeLockActive,
    toggleWakeLock,
    speak,
    showToast,
  } = useApp();

  const [profileForm, setProfileForm] = useState(state.profile);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [bridgeUrl, setBridgeUrl] = useState(state.link.bridgeUrl || '');
  const [testingLink, setTestingLink] = useState(false);
  const [linkMsg, setLinkMsg] = useState('');

  useEffect(() => {
    setProfileForm(state.profile);
  }, [state.profile]);

  useEffect(() => {
    setVoices(loadVoices(state.voice.voiceName));
  }, [state.voice.voiceName]);

  const name = state.profile.name || session?.user.name || 'GoCare';
  const phone = state.profile.phone || session?.user.phone || '';
  const avatarChar = getInitials(name);

  // 7-day adherence score
  const pct = calculateAdherence(state.meds, state.log);
  const circumference = 2 * Math.PI * 40;
  const word =
    pct === null
      ? 'Bắt đầu nào'
      : pct >= 90
      ? 'Rất tốt'
      : pct >= 70
      ? 'Tốt'
      : pct >= 50
      ? 'Cần cố gắng'
      : 'Cần chú ý';

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile(profileForm);
    speak('Đã lưu thông tin cá nhân');
    showToast('Đã lưu thông tin cá nhân');
  };

  const handleTestVoice = () => {
    speak(
      `Chào bạn, đây là giọng đọc tiếng Việt của GoCare. Chúc bạn một ngày nhiều sức khỏe và an lành!`,
      true
    );
  };

  const handleTestBridge = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestingLink(true);
    setLinkMsg('Đang kiểm tra kết nối…');
    updateLink({ bridgeUrl: bridgeUrl.trim() });

    try {
      const base = bridgeUrl.trim() ? bridgeUrl.trim().replace(/\/+$/, '') : location.origin;
      const res = await fetch(`${base}/api/tts/status`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        setLinkMsg('✅ Kết nối máy chủ GoCare thành công');
        speak('Kết nối máy chủ thành công');
      } else {
        setLinkMsg('⚠️ Máy chủ phản hồi với mã lỗi ' + res.status);
      }
    } catch {
      setLinkMsg('ℹ️ Đang hoạt động ở chế độ trực tiếp đám mây GoCare (Vercel & Supabase)');
      speak('Đã lưu địa chỉ kết nối');
    } finally {
      setTestingLink(false);
    }
  };

  const requestNotifPermission = async () => {
    if (!('Notification' in window)) {
      showToast('Trình duyệt không hỗ trợ thông báo');
      return;
    }
    const res = await Notification.requestPermission();
    if (res === 'granted') {
      speak('Đã bật quyền thông báo');
      showToast('Đã cho phép thông báo');
    } else {
      showToast('Chưa cấp quyền thông báo');
    }
  };

  return (
    <section className="screen active" id="screen-settings">
      {/* ============ PROFILE HEADER ============ */}
      <div className="profile-head">
        <span className="avatar big">{avatarChar}</span>
        <div className="acc-info">
          <b>{name}</b>
          <span className="muted">{phone || 'Bệnh nhân GoCare'}</span>
        </div>
      </div>

      {/* ============ 7-DAY ADHERENCE CARD ============ */}
      <div
        className="green-card score"
        onClick={() => {
          speak(
            pct === null
              ? 'Chưa có dữ liệu uống thuốc'
              : `Uống thuốc đúng giờ ${pct} phần trăm trong 7 ngày qua. ${word}.`
          );
        }}
      >
        <div>
          <span className="gc-label">Uống thuốc đúng giờ (7 ngày)</span>
          <div className="gc-big">
            {word} <span className="ms">north_east</span>
          </div>
          <small>
            {pct === null
              ? 'Thêm thuốc để GoCare theo dõi giúp bạn.'
              : pct >= 70
              ? 'Bạn đang làm rất tốt, cứ giữ vậy nhé!'
              : 'Bật thông báo để không quên uống thuốc nhé.'}
          </small>
        </div>
        <span className="ring">
          <svg viewBox="0 0 96 96">
            <circle className="track" cx="48" cy="48" r="40" />
            <circle
              className="fill"
              cx="48"
              cy="48"
              r="40"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - (pct || 0) / 100)}
            />
          </svg>
          <b>{pct === null ? '—' : `${pct}%`}</b>
        </span>
      </div>

      <p className="muted small sync-line" style={{ marginBottom: '14px' }}>
        <span className={`tag ${syncStatus === 'ok' ? 'ok' : 'warn'}`}>
          <span className="ms fill">{syncStatus === 'ok' ? 'cloud_done' : 'sync'}</span>
          {syncStatus === 'ok' ? ' Đã lưu trên máy chủ GoCare' : ' Đang đồng bộ…'}
        </span>
      </p>

      {/* ============ MENU ACCORDIONS ============ */}
      <div className="menu card">
        {/* Personal & Family Information */}
        <details className="menu-item">
          <summary>
            <span className="mi-ico">
              <span className="ms">person</span>
            </span>
            Thông tin cá nhân & người thân
            <span className="ms chev">chevron_right</span>
          </summary>
          <form className="menu-body" onSubmit={handleProfileSubmit} autoComplete="off">
            <label className="field">
              <span>Tên gọi (ví dụ: Bà Mai)</span>
              <input
                value={profileForm.name}
                onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Số điện thoại bệnh nhân</span>
              <input
                type="tel"
                value={profileForm.phone}
                onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Địa chỉ nhà</span>
              <input
                value={profileForm.address}
                onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Tên người thân</span>
              <input
                value={profileForm.familyName}
                onChange={(e) => setProfileForm({ ...profileForm, familyName: e.target.value })}
                placeholder="Con gái Lan"
              />
            </label>
            <label className="field">
              <span>Số người thân</span>
              <input
                type="tel"
                value={profileForm.familyPhone}
                onChange={(e) => setProfileForm({ ...profileForm, familyPhone: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Số bác sĩ / điều dưỡng</span>
              <input
                type="tel"
                value={profileForm.doctorPhone}
                onChange={(e) => setProfileForm({ ...profileForm, doctorPhone: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Số cấp cứu</span>
              <input
                type="tel"
                value={profileForm.emergencyPhone}
                onChange={(e) => setProfileForm({ ...profileForm, emergencyPhone: e.target.value })}
                placeholder="115"
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={profileForm.autoDial}
                onChange={(e) => setProfileForm({ ...profileForm, autoDial: e.target.checked })}
              />
              {' '}Tự gọi điện cấp cứu sau khi báo bệnh viện
            </label>
            <button className="btn big primary full" type="submit">
              <span className="ms">save</span> Lưu thông tin
            </button>
          </form>
        </details>

        {/* Voice & Font Size */}
        <details className="menu-item">
          <summary>
            <span className="mi-ico">
              <span className="ms">record_voice_over</span>
            </span>
            Giọng đọc & cỡ chữ
            <span className="ms chev">chevron_right</span>
          </summary>
          <div className="menu-body">
            <label className="field">
              <span>Giọng đọc</span>
              <select
                value={state.voice.voiceName}
                onChange={(e) => updateVoice({ voiceName: e.target.value })}
              >
                <option value="gocare">GoCare — giọng nữ tự nhiên (khuyên dùng)</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    Giọng máy: {v.name.replace(/Microsoft |\(Natural\)| - Vietnamese \(Vietnam\)/g, '').trim()}
                  </option>
                ))}
              </select>
            </label>

            <p className="label">Tốc độ đọc</p>
            <div className="seg">
              {[
                { r: 0.75, l: 'Chậm' },
                { r: 0.85, l: 'Vừa' },
                { r: 1.0, l: 'Nhanh' },
              ].map(({ r, l }) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={state.voice.rate === r}
                  onClick={() => updateVoice({ rate: r })}
                >
                  {l}
                </button>
              ))}
            </div>

            <p className="label">Cỡ chữ</p>
            <div className="seg">
              <button
                type="button"
                aria-pressed={state.size === 'l'}
                onClick={() => updateSize('l')}
              >
                Lớn
              </button>
              <button
                type="button"
                aria-pressed={state.size === 'xl'}
                onClick={() => updateSize('xl')}
              >
                Rất lớn
              </button>
            </div>

            <button className="btn full" style={{ marginTop: '10px' }} onClick={handleTestVoice}>
              <span className="ms">play_circle</span> Nghe thử giọng đọc
            </button>
          </div>
        </details>

        {/* Hospital Connection / Bridge */}
        <details className="menu-item">
          <summary>
            <span className="mi-ico">
              <span className="ms">local_hospital</span>
            </span>
            Kết nối bệnh viện
            <span className="ms chev">chevron_right</span>
          </summary>
          <form className="menu-body" onSubmit={handleTestBridge} autoComplete="off">
            <p className="muted">
              Hệ thống GoCare kết nối trực tiếp Supabase và Web Quản Lý Bệnh Viện.
            </p>
            <label className="field">
              <span>Địa chỉ máy chủ GoCare Home Hub (nâng cao)</span>
              <input
                value={bridgeUrl}
                onChange={(e) => setBridgeUrl(e.target.value)}
                placeholder="Ví dụ: https://homehub.local hoặc cloudflare tunnel"
              />
            </label>
            <button className="btn full" type="submit" disabled={testingLink}>
              <span className="ms">sync</span> {testingLink ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
            </button>
            {linkMsg && <p className="muted small" style={{ marginTop: '6px' }}>{linkMsg}</p>}
          </form>
        </details>

        {/* Notifications & Screen Wake Lock */}
        <details className="menu-item">
          <summary>
            <span className="mi-ico">
              <span className="ms">notifications</span>
            </span>
            Thông báo & màn hình
            <span className="ms chev">chevron_right</span>
          </summary>
          <div className="menu-body">
            <button className="btn full" onClick={requestNotifPermission}>
              <span className="ms">notifications_active</span> Cho phép thông báo nhắc thuốc
            </button>
            <button
              className={`btn full ${wakeLockActive ? 'okay' : ''}`}
              style={{ marginTop: '10px' }}
              onClick={toggleWakeLock}
            >
              <span className="ms">{wakeLockActive ? 'brightness_high' : 'wb_sunny'}</span>
              {wakeLockActive ? ' Màn hình đang giữ sáng' : ' Giữ màn hình luôn sáng'}
            </button>
          </div>
        </details>

        {/* External Help Link */}
        <a
          className="menu-item link"
          href="https://quanlyweb-bjsh.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => speak('Mở trang Bệnh viện GoCare')}
        >
          <span className="mi-ico">
            <span className="ms">help</span>
          </span>
          Trợ giúp & Bệnh viện GoCare
          <span className="ms chev">chevron_right</span>
        </a>
      </div>

      {/* ============ AUTH / LOGOUT BUTTON ============ */}
      {session ? (
        <button
          className="btn big full logout"
          onClick={() => {
            if (confirm('Đăng xuất khỏi GoCare trên máy này?')) {
              signOut();
            }
          }}
        >
          <span className="ms">logout</span> Đăng xuất
        </button>
      ) : (
        <button
          className="btn big primary full"
          style={{ marginTop: '16px' }}
          onClick={() => setAuthView('login')}
        >
          <span className="ms">login</span> Đăng nhập tài khoản GoCare
        </button>
      )}
    </section>
  );
};
