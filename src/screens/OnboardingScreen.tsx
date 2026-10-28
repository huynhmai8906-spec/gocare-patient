import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { triggerConfettiBurst } from '../utils/helpers';
import { playChime } from '../services/audio';

export const OnboardingScreen: React.FC = () => {
  const {
    onboardingStep,
    setOnboardingStep,
    state,
    updateProfile,
    setHomeLocation,
    speak,
    showToast,
  } = useApp();

  const [address, setAddress] = useState(state.profile.address || '');
  const [familyName, setFamilyName] = useState(state.profile.familyName || '');
  const [familyPhone, setFamilyPhone] = useState(state.profile.familyPhone || '');
  const [notifGranted, setNotifGranted] = useState(
    typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
  );
  const [locGranted, setLocGranted] = useState(false);

  if (onboardingStep === null) return null;

  const handleStep0 = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile({ address: address.trim() });
    speak('Bước hai: số điện thoại người thân, để gọi khi có chuyện khẩn cấp.');
    setOnboardingStep(1);
  };

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile({ familyName: familyName.trim(), familyPhone: familyPhone.trim() });
    speak('Bước cuối: cho phép thông báo và vị trí, rồi bấm Bắt đầu dùng GoCare.');
    setOnboardingStep(2);
  };

  const handleRequestNotif = async () => {
    if ('Notification' in window) {
      const res = await Notification.requestPermission();
      if (res === 'granted') {
        setNotifGranted(true);
        speak('Đã cho phép thông báo');
      }
    }
  };

  const handleRequestLoc = async () => {
    const ok = await setHomeLocation();
    if (ok) {
      setLocGranted(true);
      speak('Đã lưu vị trí nhà');
    }
  };

  const handleFinish = () => {
    triggerConfettiBurst();
    playChime();
    speak(`Chào mừng ${state.profile.name || 'bạn'} đến với GoCare. Chúc bạn mỗi ngày an tâm.`);
    showToast('Hoàn tất cài đặt! Chúc bạn an tâm mỗi ngày.');
    setOnboardingStep(null);
  };

  return (
    <section className="auth" id="authView">
      <div className="auth-inner">
        {/* Step indicator bar */}
        <div className="steps" style={{ marginBottom: '16px' }}>
          {[0, 1, 2].map((i) => (
            <i
              key={i}
              className={i < onboardingStep ? 'done' : i === onboardingStep ? 'cur' : ''}
            ></i>
          ))}
        </div>

        {/* ============ STEP 0: ADDRESS ============ */}
        {onboardingStep === 0 && (
          <>
            <div className="auth-top">
              <div className="auth-title">
                <h1>Chào {state.profile.name || 'bạn'}! 👋</h1>
                <p>Mình cùng cài đặt nhanh 3 bước nhé</p>
              </div>
            </div>

            <form className="auth-card" onSubmit={handleStep0}>
              <h2>Nhà bạn ở đâu?</h2>
              <p className="muted">Để xe cấp cứu tìm đến nhanh nhất.</p>

              <label className="field">
                <span>Địa chỉ nhà</span>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Số nhà, đường, phường, quận"
                  required
                />
              </label>

              <button className="btn big primary full" type="submit">
                Tiếp tục <span className="ms">arrow_forward</span>
              </button>

              <p className="auth-foot">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setOnboardingStep(1)}
                >
                  Để sau
                </button>
              </p>
            </form>
          </>
        )}

        {/* ============ STEP 1: EMERGENCY CONTACT ============ */}
        {onboardingStep === 1 && (
          <>
            <div className="auth-top">
              <button
                className="auth-back"
                onClick={() => setOnboardingStep(0)}
                aria-label="Quay lại"
              >
                <span className="ms">arrow_back</span>
              </button>
              <div className="auth-title">
                <h1>Người thân</h1>
                <p>Ai sẽ được gọi khi có chuyện khẩn cấp?</p>
              </div>
            </div>

            <form className="auth-card" onSubmit={handleStep1}>
              <h2>Liên hệ khẩn cấp</h2>
              <p className="muted">Có thể đổi sau trong Hồ sơ.</p>

              <label className="field">
                <span>Tên người thân</span>
                <input
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  placeholder="Con gái Lan"
                />
              </label>

              <label className="field">
                <span>Số điện thoại người thân</span>
                <input
                  type="tel"
                  inputMode="tel"
                  value={familyPhone}
                  onChange={(e) => setFamilyPhone(e.target.value)}
                  placeholder="0912 345 678"
                />
              </label>

              <button className="btn big primary full" type="submit">
                Tiếp tục <span className="ms">arrow_forward</span>
              </button>

              <p className="auth-foot">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setOnboardingStep(2)}
                >
                  Để sau
                </button>
              </p>
            </form>
          </>
        )}

        {/* ============ STEP 2: PERMISSIONS ============ */}
        {onboardingStep === 2 && (
          <>
            <div className="auth-top">
              <button
                className="auth-back"
                onClick={() => setOnboardingStep(1)}
                aria-label="Quay lại"
              >
                <span className="ms">arrow_back</span>
              </button>
              <div className="auth-title">
                <h1>Sắp xong rồi</h1>
                <p>Cho phép để GoCare nhắc và bảo vệ bạn</p>
              </div>
            </div>

            <div className="auth-card">
              <h2>Quyền ứng dụng</h2>

              <div className="perm">
                <span className="f-ico c-green">
                  <span className="ms fill">notifications_active</span>
                </span>
                <span className="perm-body">
                  <b>Thông báo</b>
                  <br />
                  <span className="muted">Nhắc giờ uống thuốc đúng bữa</span>
                </span>
                <button
                  className={`btn ${notifGranted ? 'okay' : 'tonal'}`}
                  onClick={handleRequestNotif}
                >
                  {notifGranted ? 'Đã bật' : 'Cho phép'}
                </button>
              </div>

              <div className="perm">
                <span className="f-ico c-blue">
                  <span className="ms fill">my_location</span>
                </span>
                <span className="perm-body">
                  <b>Vị trí</b>
                  <br />
                  <span className="muted">Gửi vị trí khi gọi cấp cứu</span>
                </span>
                <button
                  className={`btn ${locGranted ? 'okay' : 'tonal'}`}
                  onClick={handleRequestLoc}
                >
                  {locGranted ? 'Đã bật' : 'Cho phép'}
                </button>
              </div>

              <button
                className="btn big primary full"
                style={{ marginTop: '16px' }}
                onClick={handleFinish}
              >
                <span className="ms fill">check_circle</span> Bắt đầu dùng GoCare
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
};
