import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { getSupabase } from '../services/supabase';

const AUTH_ERRORS: [RegExp, string][] = [
  [/Invalid login credentials/i, 'Email hoặc mật khẩu chưa đúng'],
  [/Email not confirmed/i, 'Email chưa được xác nhận. Bạn mở hộp thư và bấm vào đường link GoCare gửi nhé'],
  [/User already registered|already been registered/i, 'Email này đã có tài khoản, bạn đăng nhập nhé'],
  [/Password should be at least|password.*(short|characters)/i, 'Mật khẩu cần ít nhất 6 ký tự'],
  [/rate limit|too many/i, 'Thử quá nhiều lần, bạn đợi vài phút rồi thử lại nhé'],
  [/Failed to fetch|NetworkError|network/i, 'Không có mạng, bạn kiểm tra kết nối nhé'],
];

function getAuthErrorMessage(e: any): string {
  const match = AUTH_ERRORS.find(([re]) => re.test(e?.message || ''));
  return match ? match[1] : (e?.message || 'Có lỗi, bạn thử lại nhé');
}

export const AuthScreen: React.FC = () => {
  const { authView, setAuthView, setOnboardingStep, speak, showToast } = useApp();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!authView) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);
    const sb = getSupabase();
    if (!sb) {
      setErrorMsg('Không thể kết nối dịch vụ xác thực');
      setLoading(false);
      return;
    }

    try {
      const { error } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      speak('Đăng nhập thành công');
      showToast('Đăng nhập thành công');
      setAuthView(null);
    } catch (err: any) {
      const msg = getAuthErrorMessage(err);
      setErrorMsg(msg);
      speak(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (password !== passwordConfirm) {
      const msg = 'Hai mật khẩu chưa giống nhau';
      setErrorMsg(msg);
      speak(msg);
      return;
    }

    setLoading(true);
    const sb = getSupabase();
    if (!sb) {
      setErrorMsg('Không thể kết nối dịch vụ xác thực');
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await sb.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: name.trim(),
            phone: phone.trim(),
          },
        },
      });
      if (error) throw error;

      if (data.session) {
        speak('Tạo tài khoản thành công');
        showToast('Tạo tài khoản thành công');
        setAuthView(null);
        setOnboardingStep(0);
      } else {
        const msg = 'Đã gửi email xác nhận. Bạn kiểm tra hòm thư nhé.';
        setErrorMsg(msg);
        speak(msg);
      }
    } catch (err: any) {
      const msg = getAuthErrorMessage(err);
      setErrorMsg(msg);
      speak(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);
    const sb = getSupabase();
    if (!sb) return;

    try {
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: location.origin,
      });
      if (error) throw error;
      const msg = 'Đã gửi hướng dẫn vào email của bạn.';
      setErrorMsg(msg);
      speak(msg);
    } catch (err: any) {
      const msg = getAuthErrorMessage(err);
      setErrorMsg(msg);
      speak(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="auth" id="authView">
      <div className="auth-inner">
        {/* ============ LOGIN ============ */}
        {authView === 'login' && (
          <>
            <div className="auth-top">
              <button
                className="auth-back"
                onClick={() => setAuthView(null)}
                aria-label="Quay lại"
              >
                <span className="ms">arrow_back</span>
              </button>
              <div className="auth-title">
                <h1>Đăng nhập</h1>
                <p>Dùng tài khoản GoCare đã có</p>
              </div>
            </div>

            <form className="auth-card" onSubmit={handleLogin}>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="mai@gmail.com"
                />
              </label>

              <label className="field">
                <span>Mật khẩu</span>
                <span className="pw">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="pw-eye"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label="Hiện mật khẩu"
                  >
                    <span className="ms">{showPassword ? 'visibility_off' : 'visibility'}</span>
                  </button>
                </span>
              </label>

              {errorMsg && <p className="form-error">{errorMsg}</p>}

              <button className="btn big primary full" type="submit" disabled={loading}>
                <span className="ms">login</span>
                {loading ? ' Đang đăng nhập…' : ' Đăng nhập'}
              </button>

              <p className="auth-foot">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setErrorMsg('');
                    setAuthView('forgot');
                  }}
                >
                  Quên mật khẩu?
                </button>
                {' · '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setErrorMsg('');
                    setAuthView('register');
                  }}
                >
                  Tạo tài khoản mới
                </button>
              </p>
            </form>
          </>
        )}

        {/* ============ REGISTER ============ */}
        {authView === 'register' && (
          <>
            <div className="auth-top">
              <button
                className="auth-back"
                onClick={() => setAuthView('login')}
                aria-label="Quay lại"
              >
                <span className="ms">arrow_back</span>
              </button>
              <div className="auth-title">
                <h1>Tạo tài khoản</h1>
                <p>Chỉ cần 1 phút để bắt đầu</p>
              </div>
            </div>

            <form className="auth-card" onSubmit={handleRegister}>
              <label className="field">
                <span>Tên của bạn</span>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Bà Mai"
                />
              </label>

              <label className="field">
                <span>Số điện thoại</span>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0912 345 678"
                />
              </label>

              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="mai@gmail.com"
                />
              </label>

              <label className="field">
                <span>Mật khẩu (ít nhất 6 ký tự)</span>
                <span className="pw">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="pw-eye"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label="Hiện mật khẩu"
                  >
                    <span className="ms">{showPassword ? 'visibility_off' : 'visibility'}</span>
                  </button>
                </span>
              </label>

              <label className="field">
                <span>Nhập lại mật khẩu</span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                />
              </label>

              {errorMsg && <p className="form-error">{errorMsg}</p>}

              <button className="btn big primary full" type="submit" disabled={loading}>
                <span className="ms">how_to_reg</span>
                {loading ? ' Đang tạo tài khoản…' : ' Tiếp tục'}
              </button>

              <p className="auth-foot">
                Đã có tài khoản?{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setErrorMsg('');
                    setAuthView('login');
                  }}
                >
                  Đăng nhập
                </button>
              </p>
            </form>
          </>
        )}

        {/* ============ FORGOT PASSWORD ============ */}
        {authView === 'forgot' && (
          <>
            <div className="auth-top">
              <button
                className="auth-back"
                onClick={() => setAuthView('login')}
                aria-label="Quay lại"
              >
                <span className="ms">arrow_back</span>
              </button>
              <div className="auth-title">
                <h1>Quên mật khẩu</h1>
                <p>Nhập email để nhận link đổi mật khẩu</p>
              </div>
            </div>

            <form className="auth-card" onSubmit={handleForgot}>
              <label className="field">
                <span>Email đã đăng ký</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="mai@gmail.com"
                />
              </label>

              {errorMsg && <p className="form-error">{errorMsg}</p>}

              <button className="btn big primary full" type="submit" disabled={loading}>
                <span className="ms">mail</span>
                {loading ? ' Đang gửi…' : ' Gửi link đặt lại mật khẩu'}
              </button>

              <p className="auth-foot">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setAuthView('login')}
                >
                  Quay lại đăng nhập
                </button>
              </p>
            </form>
          </>
        )}
      </div>
    </section>
  );
};
