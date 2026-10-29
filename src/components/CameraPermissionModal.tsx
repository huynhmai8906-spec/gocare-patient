import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { playChime } from '../services/audio';

interface CameraPermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPermissionGranted?: () => void;
}

export const CameraPermissionModal: React.FC<CameraPermissionModalProps> = ({
  isOpen,
  onClose,
  onPermissionGranted,
}) => {
  const { speak, showToast } = useApp();
  const [permissionState, setPermissionState] = useState<'prompt' | 'granted' | 'denied' | 'checking'>('checking');
  const [isRequesting, setIsRequesting] = useState(false);
  const [streamActive, setStreamActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  // Check initial permission status if supported
  const checkStatus = async () => {
    try {
      if ('permissions' in navigator && (navigator.permissions as any).query) {
        const status = await (navigator.permissions as any).query({ name: 'camera' });
        setPermissionState(status.state);
        status.onchange = () => {
          setPermissionState(status.state);
        };
      } else {
        setPermissionState('prompt');
      }
    } catch {
      setPermissionState('prompt');
    }
  };

  useEffect(() => {
    if (isOpen) {
      checkStatus();
    } else {
      // Clean up stream if open
      if (previewVideoRef.current && previewVideoRef.current.srcObject) {
        const stream = previewVideoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        previewVideoRef.current.srcObject = null;
      }
      setStreamActive(false);
    }
  }, [isOpen]);

  const requestPermission = async () => {
    setIsRequesting(true);
    setErrorMessage(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Trình duyệt không hỗ trợ kết nối Camera (API getUserMedia).');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 360 } },
        audio: false,
      });

      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
        previewVideoRef.current.play().catch(() => {});
      }

      setPermissionState('granted');
      setStreamActive(true);
      playChime();
      speak('Đã cấp quyền camera thành công. Hệ thống đã có thể giám sát an toàn.');
      showToast('Đã cấp quyền Camera thành công!');

      if (onPermissionGranted) {
        onPermissionGranted();
      }
    } catch (err: any) {
      console.warn('Camera permission request error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setPermissionState('denied');
        setErrorMessage('Quyền truy cập Camera đã bị từ chối hoặc bị chặn bởi cài đặt trình duyệt.');
      } else {
        setErrorMessage(err.message || 'Không thể mở Camera.');
      }
    } finally {
      setIsRequesting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="overlay" style={{ zIndex: 110 }}>
      <div className="overlay-box" style={{ maxWidth: '540px', textAlign: 'left' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="ms fill" style={{ color: 'var(--primary)', fontSize: '1.8em' }}>
              videocam
            </span>
            <h2 style={{ margin: 0, fontSize: '1.2em', fontWeight: 800 }}>Cấp quyền Camera</h2>
          </div>
          <button
            type="button"
            className="back"
            style={{ width: '40px', height: '40px' }}
            onClick={onClose}
            aria-label="Đóng"
          >
            <span className="ms">close</span>
          </button>
        </div>

        {/* Current status pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background:
              permissionState === 'granted'
                ? 'var(--green-soft)'
                : permissionState === 'denied'
                ? 'var(--red-soft)'
                : 'var(--mint)',
            color:
              permissionState === 'granted'
                ? 'var(--green)'
                : permissionState === 'denied'
                ? 'var(--red)'
                : 'var(--on-mint)',
            padding: '10px 14px',
            borderRadius: '14px',
            marginBottom: '16px',
            fontSize: '0.85em',
            fontWeight: 700,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="ms fill">
              {permissionState === 'granted'
                ? 'check_circle'
                : permissionState === 'denied'
                ? 'cancel'
                : 'info'}
            </span>
            Trạng thái hiện tại:
          </span>
          <span>
            {permissionState === 'granted'
              ? 'ĐÃ CẤP QUYỀN (CHO PHÉP)'
              : permissionState === 'denied'
              ? 'BỊ TỪ CHỐI / CHẶN'
              : 'CHỜ BẠN CẤP QUYỀN'}
          </span>
        </div>

        {/* Explanation */}
        <p style={{ fontSize: '0.86em', color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 16px' }}>
          App GoCare cần quyền Camera để <b>giám sát té ngã tự động</b> và bảo vệ người cao tuổi khi ở nhà một mình.
          Hình ảnh chỉ được xử lý nhận diện AI trực tiếp và không gửi ra ngoài nếu không có sự cố té ngã.
        </p>

        {/* Live preview if active */}
        {streamActive && (
          <div
            style={{
              position: 'relative',
              borderRadius: '16px',
              overflow: 'hidden',
              aspectRatio: '16/9',
              background: '#000',
              marginBottom: '16px',
            }}
          >
            <video
              ref={previewVideoRef}
              playsInline
              muted
              autoPlay
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <span
              style={{
                position: 'absolute',
                top: '10px',
                left: '10px',
                background: 'rgba(22, 163, 74, 0.85)',
                color: '#fff',
                padding: '4px 10px',
                borderRadius: '20px',
                fontSize: '0.75em',
                fontWeight: 700,
              }}
            >
              ✓ Camera hoạt động tốt
            </span>
          </div>
        )}

        {/* Main Action Button */}
        {permissionState !== 'granted' && (
          <button
            type="button"
            className="btn big primary full"
            style={{ fontWeight: 800, fontSize: '1em', marginBottom: '14px' }}
            disabled={isRequesting}
            onClick={requestPermission}
          >
            <span className="ms fill">verified_user</span>
            {isRequesting ? ' Đang mở hộp thoại cấp quyền…' : ' BẤM ĐỂ CẤP QUYỀN CAMERA NGAY'}
          </button>
        )}

        {/* Error / Denial guide */}
        {errorMessage && (
          <div
            style={{
              background: 'var(--red-soft)',
              color: 'var(--red)',
              padding: '12px 14px',
              borderRadius: '14px',
              fontSize: '0.82em',
              lineHeight: 1.45,
              marginBottom: '16px',
            }}
          >
            <b>Chú ý:</b> {errorMessage}
          </div>
        )}

        {/* Step by step manual guide */}
        {permissionState === 'denied' && (
          <div
            style={{
              background: 'var(--bg)',
              borderRadius: '16px',
              padding: '14px',
              fontSize: '0.82em',
              lineHeight: 1.5,
              border: '1px solid var(--line)',
              marginBottom: '14px',
            }}
          >
            <b style={{ color: 'var(--ink)', display: 'block', marginBottom: '8px' }}>
              Hướng dẫn mở lại quyền Camera đã bị chặn:
            </b>
            <div style={{ marginBottom: '8px' }}>
              <b>Trên Google Chrome / Cốc Cốc / Edge máy tính:</b>
              <br />
              1. Nhấn vào biểu tượng <b>Khóa 🔒</b> hoặc <b>Cài đặt trang web</b> ở bên trái thanh nhập địa chỉ web (URL).
              <br />
              2. Ở mục <b>Máy ảnh / Camera</b>, chuyển từ <i>Chặn (Block)</i> sang <b>Cho phép (Allow)</b>.
              <br />
              3. Tải lại trang (F5) để có hiệu lực.
            </div>
            <div>
              <b>Trên điện thoại (Safari / Chrome Mobile):</b>
              <br />
              - Vào <b>Cài đặt (Settings)</b> của máy → chọn <b>Safari</b> hoặc <b>Chrome</b> → <b>Camera</b> → chọn <b>Cho phép</b>.
            </div>
          </div>
        )}

        {/* Close Button */}
        <button
          type="button"
          className="btn full"
          onClick={onClose}
          style={{ fontWeight: 700 }}
        >
          {permissionState === 'granted' ? 'Đã xong — Đóng lại' : 'Đóng'}
        </button>
      </div>
    </div>
  );
};
