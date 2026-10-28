import React from 'react';
import { useApp } from '../context/AppContext';
import { hm } from '../utils/helpers';
import { CameraFeed } from '../components/CameraFeed';

export const SafetyScreen: React.FC = () => {
  const {
    state,
    setActiveTab,
    cameras,
    toggleCamera,
    deleteCamera,
    setAddingCam,
    zoneStatus,
    toggleSafetyZone,
    setHomeLocation,
    updateZoneRadius,
    testZoneAlarm,
    speak,
  } = useApp();

  const ALERT_META: Record<string, [string, string]> = {
    sos: ['e911_emergency', 'Bấm nút SOS'],
    fall: ['personal_injury', 'Té ngã (camera)'],
    geofence: ['wrong_location', 'Ra khỏi vùng GPS'],
    zone: ['door_open', 'Rời vùng trong nhà'],
    health: ['monitor_heart', 'Chỉ số nguy hiểm'],
  };

  return (
    <section className="screen active" id="screen-safety">
      <div className="page-head">
        <button
          className="back"
          onClick={() => {
            speak('Quay lại');
            setActiveTab('home');
          }}
          aria-label="Quay lại"
        >
          <span className="ms">arrow_back</span>
        </button>
        <h1>An toàn</h1>
        <span></span>
      </div>

      {/* ============ INDOOR CAMERAS ============ */}
      <div className="sec-head">
        <h2>Camera trong nhà</h2>
      </div>

      <div className="cam-list">
        {cameras.length === 0 ? (
          <p className="empty">
            Chưa cài camera nào. Bấm “Cài camera mới” để dùng webcam máy tính hoặc camera IP trong nhà.
          </p>
        ) : (
          cameras.map((cam) => (
            <CameraFeed
              key={cam.id}
              camera={cam}
              onToggle={(start) => toggleCamera(cam.id, start)}
              onDelete={() => deleteCamera(cam.id)}
            />
          ))
        )}
      </div>

      <button
        className="btn big primary full"
        onClick={() => {
          speak('Cài camera mới');
          setAddingCam(true);
        }}
      >
        <span className="ms">add_a_photo</span> Cài camera mới
      </button>

      <div className="tip" style={{ marginTop: '12px' }}>
        <span className="ms">health_and_safety</span>
        <span>
          <b>Thuật toán phát hiện té ngã (YOLOv8 Pose)</b>
          <br />
          Xác nhận té ngã khi đủ 3 điều kiện:
          <br />
          1. Người vừa đứng thẳng trong 4 giây trước đó.
          <br />
          2. Đỉnh đầu tụt ≥ 40% chiều cao người rồi chuyển sang nằm.
          <br />
          3. Người nằm bất động ít nhất 2,5 giây.
          <br />
          <i>(Ngồi cúi hoặc nằm lên giường từ từ sẽ không bị báo nhầm).</i>
        </span>
      </div>

      {/* ============ OUTDOOR SAFETY ZONE (GPS GEOFENCE) ============ */}
      <div className="sec-head">
        <h2>Vùng an toàn khi ra ngoài</h2>
      </div>

      <div className="card">
        <div className="zone-state">
          {!state.zone.on ? (
            'Chưa bật canh vùng an toàn'
          ) : zoneStatus.error ? (
            <span style={{ color: 'var(--red)' }}>Lỗi: {zoneStatus.error}</span>
          ) : zoneStatus.outside ? (
            <b style={{ color: 'var(--red)' }}>⚠️ BẠN ĐANG Ở NGOÀI VÙNG AN TOÀN</b>
          ) : (
            <b>BẠN ĐANG Ở TRONG VÙNG AN TOÀN</b>
          )}
          {state.zone.on && zoneStatus.dist !== null && (
            <div>
              Cách nhà {Math.round(zoneStatus.dist)} m
              {zoneStatus.acc ? ` (sai số ±${zoneStatus.acc} m)` : ''} · giới hạn{' '}
              {state.zone.radius >= 1000 ? `${state.zone.radius / 1000} km` : `${state.zone.radius} m`}
            </div>
          )}
        </div>

        <button
          className={`btn big full ${state.zone.on ? 'danger' : 'primary'}`}
          onClick={toggleSafetyZone}
        >
          <span className="ms">
            {state.zone.on ? 'stop_circle' : 'play_circle'}
          </span>
          {state.zone.on ? ' Tắt canh vùng an toàn' : ' Bật canh vùng an toàn'}
        </button>

        <button
          className="btn full"
          style={{ marginTop: '10px' }}
          onClick={setHomeLocation}
        >
          <span className="ms">home_pin</span> Đặt chỗ đang đứng làm NHÀ
        </button>

        <p className="label">Bán kính an toàn</p>
        <div className="seg">
          {[100, 200, 500, 1000].map((r) => (
            <button
              key={r}
              aria-pressed={state.zone.radius === r}
              onClick={() => updateZoneRadius(r)}
            >
              {r >= 1000 ? '1 km' : `${r} m`}
            </button>
          ))}
        </div>

        <button
          className="btn ghost full"
          style={{ marginTop: '10px' }}
          onClick={testZoneAlarm}
        >
          <span className="ms">notifications_active</span> Thử báo động
        </button>
      </div>

      {/* ============ RECENT ALERTS ============ */}
      <div className="sec-head">
        <h2>Cảnh báo gần đây</h2>
      </div>

      <div className="list card">
        {!state.sentAlerts || state.sentAlerts.length === 0 ? (
          <p className="empty">Chưa có cảnh báo nào</p>
        ) : (
          state.sentAlerts.slice(0, 8).map((a, i) => {
            const [icon, label] = ALERT_META[a.type] || ['warning', a.type];
            const d = new Date(a.createdAt);
            const isRed = a.type === 'fall' || a.type === 'sos';
            return (
              <div key={i} className="li">
                <div className={`li-ico ${isRed ? 'c-red' : 'c-amber'}`}>
                  <span className="ms fill">{icon}</span>
                </div>
                <div className="li-body">
                  <div className="li-title">{label}</div>
                  <div className="li-sub">
                    {a.synced
                      ? 'Đã tạo đơn trên web bệnh viện'
                      : a.error
                      ? `Lỗi: ${a.error}`
                      : 'Đã ghi nhận trên máy chủ'}
                  </div>
                </div>
                <div className="li-end">
                  <div className="li-val">{hm(d)}</div>
                  <div className="li-sub">{`${d.getDate()}/${d.getMonth() + 1}`}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
