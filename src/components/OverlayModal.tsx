import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Medication } from '../types';
import { spokenHM, uid } from '../utils/helpers';

const PILL_ICONS = ['💊', '🔵', '🟡', '🟢', '🔴', '⚪', '🟠', '🟣', '💉', '🧴', '🍵', '🩹'];
const NOTES = ['Sau ăn', 'Trước ăn', 'Trong bữa ăn', 'Trước khi ngủ', 'Bất kỳ lúc nào'];

export const OverlayModal: React.FC = () => {
  const {
    sosCountdown,
    cancelSOSCountdown,
    sendEmergencyAlert,
    activeReminder,
    markDoseTaken,
    snoozeDose,
    editingMed,
    setEditingMed,
    addOrUpdateMed,
    deleteMed,
    addingAppt,
    setAddingAppt,
    addAppointment,
    addingCam,
    setAddingCam,
    addCamera,
    speak,
    showToast,
  } = useApp();

  // Medication form state
  const [medForm, setMedForm] = useState<Medication>(() => {
    if (editingMed && editingMed !== 'new') return { ...editingMed };
    return {
      id: uid(),
      name: '',
      dose: '1 viên',
      times: ['08:00'],
      note: 'Sau ăn',
      icon: '💊',
    };
  });
  const [customTime, setCustomTime] = useState('');

  // Appointment form state
  const [apptTitle, setApptTitle] = useState('');
  const [apptAt, setApptAt] = useState(() => {
    const tomorrow = new Date(Date.now() + 86400000);
    return `${tomorrow.toISOString().slice(0, 10)}T08:00`;
  });
  const [apptPlace, setApptPlace] = useState('');

  // Camera form state
  const [camName, setCamName] = useState('Phòng khách');
  const [camKind, setCamKind] = useState<'webcam' | 'ip'>('webcam');
  const [camIndex, setCamIndex] = useState('0');
  const [camUrl, setCamUrl] = useState('');
  const [camZone, setCamZone] = useState(false);

  // Handle immediate SOS trigger
  const handleImmediateSOS = () => {
    speak('Đang gửi tín hiệu cấp cứu tới bệnh viện ngay lập tức', true);
    sendEmergencyAlert({ type: 'sos', note: 'Bệnh nhân bấm GỌI NGAY trong đếm ngược SOS' });
    cancelSOSCountdown();
  };

  return (
    <>
      {/* ================= SOS OVERLAY ================= */}
      {sosCountdown !== null && (
        <div className="overlay">
          <div className="overlay-box">
            <div className="ov-title">Sắp gọi cấp cứu</div>
            <div className="ov-count" style={{ ['--p' as any]: 1 }}>
              <span>{sosCountdown}</span>
            </div>
            <p className="ov-text">Bệnh viện sẽ được báo khi đếm về 0</p>
            <button className="btn danger" onClick={handleImmediateSOS}>
              <span className="ms fill">e911_emergency</span> GỌI NGAY
            </button>
            <button className="btn" onClick={cancelSOSCountdown}>
              <span className="ms">close</span> Hủy — tôi bấm nhầm
            </button>
          </div>
        </div>
      )}

      {/* ================= MEDICATION REMINDER OVERLAY ================= */}
      {activeReminder && (
        <div className="overlay">
          <div className="overlay-box remind">
            <div className="ov-ico">
              <span className="ms fill">medication</span>
            </div>
            <div className="ov-title">Đến giờ uống thuốc</div>
            <p className="ov-big">
              {activeReminder.med.icon} {activeReminder.med.name}
            </p>
            <p className="ov-text">
              {activeReminder.med.dose} · {activeReminder.med.note} · {activeReminder.time}
            </p>
            <button className="btn okay" onClick={() => markDoseTaken(activeReminder.key)}>
              <span className="ms fill">check_circle</span> ĐÃ UỐNG
            </button>
            <button className="btn" onClick={() => snoozeDose(activeReminder.key)}>
              <span className="ms">snooze</span> Nhắc lại sau 10 phút
            </button>
          </div>
        </div>
      )}

      {/* ================= ADD / EDIT MEDICATION SHEET ================= */}
      {editingMed && (
        <dialog className="sheet" open style={{ display: 'block', position: 'fixed', inset: 'auto auto 0 0', width: '100%', margin: '0 auto', left: 0, right: 0 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!medForm.name.trim()) {
                speak('Bạn nhập tên thuốc nhé');
                return;
              }
              if (!medForm.times.length) {
                speak('Bạn chọn ít nhất một giờ uống nhé');
                return;
              }
              addOrUpdateMed(medForm);
              speak(`Đã lưu ${medForm.name}, uống lúc ${medForm.times.map(spokenHM).join(', ')}`);
              showToast(`Đã lưu thuốc ${medForm.name}`);
              setEditingMed(null);
            }}
          >
            <h2>{editingMed === 'new' ? 'Thêm thuốc mới' : 'Sửa thuốc'}</h2>

            <label className="field">
              <span>Tên thuốc</span>
              <input
                required
                value={medForm.name}
                onChange={(e) => setMedForm({ ...medForm, name: e.target.value })}
                placeholder="Ví dụ: Amlodipin 5mg"
              />
            </label>

            <label className="field">
              <span>Liều mỗi lần</span>
              <input
                value={medForm.dose}
                onChange={(e) => setMedForm({ ...medForm, dose: e.target.value })}
                placeholder="1 viên"
              />
            </label>

            <p className="label">Giờ uống</p>
            <div className="chips">
              {medForm.times.map((t) => (
                <button
                  type="button"
                  key={t}
                  className="chip"
                  onClick={() => {
                    const next = medForm.times.filter((x) => x !== t);
                    setMedForm({ ...medForm, times: next });
                    speak(`Xóa giờ ${spokenHM(t)}`);
                  }}
                >
                  {t} <span className="ms">close</span>
                </button>
              ))}
            </div>

            <div className="seg">
              {['07:00', '12:00', '17:00', '20:00'].map((time) => {
                const label = time === '07:00' ? 'Sáng 7h' : time === '12:00' ? 'Trưa 12h' : time === '17:00' ? 'Chiều 5h' : 'Tối 8h';
                return (
                  <button
                    type="button"
                    key={time}
                    onClick={() => {
                      if (!medForm.times.includes(time)) {
                        const updated = [...medForm.times, time].sort();
                        setMedForm({ ...medForm, times: updated });
                        speak(`Thêm giờ ${spokenHM(time)}`);
                      }
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="row" style={{ marginTop: '10px', alignItems: 'end', display: 'flex', gap: '8px' }}>
              <label className="field" style={{ flex: 1 }}>
                <span>Giờ khác</span>
                <input
                  type="time"
                  value={customTime}
                  onChange={(e) => setCustomTime(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn"
                style={{ marginBottom: '14px', height: '54px' }}
                onClick={() => {
                  if (customTime && !medForm.times.includes(customTime)) {
                    const updated = [...medForm.times, customTime].sort();
                    setMedForm({ ...medForm, times: updated });
                    speak(`Thêm giờ ${spokenHM(customTime)}`);
                    setCustomTime('');
                  }
                }}
              >
                <span className="ms">add</span> Thêm
              </button>
            </div>

            <label className="field">
              <span>Cách uống</span>
              <select
                value={medForm.note}
                onChange={(e) => setMedForm({ ...medForm, note: e.target.value })}
              >
                {NOTES.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>

            <p className="label">Hình viên thuốc</p>
            <div className="pick">
              {PILL_ICONS.map((i) => (
                <button
                  type="button"
                  key={i}
                  aria-pressed={medForm.icon === i}
                  onClick={() => setMedForm({ ...medForm, icon: i })}
                >
                  {i}
                </button>
              ))}
            </div>

            <button className="btn big primary full" type="submit">
              <span className="ms">save</span> Lưu thuốc
            </button>

            {editingMed !== 'new' && (
              <button
                className="btn danger full"
                type="button"
                onClick={() => {
                  if (confirm(`Xóa thuốc "${medForm.name}"?`)) {
                    deleteMed(medForm.id);
                    speak('Đã xóa thuốc');
                    setEditingMed(null);
                  }
                }}
              >
                <span className="ms">delete</span> Xóa thuốc này
              </button>
            )}

            <button className="btn full" type="button" onClick={() => setEditingMed(null)}>
              Đóng
            </button>
          </form>
        </dialog>
      )}

      {/* ================= ADD APPOINTMENT SHEET ================= */}
      {addingAppt && (
        <dialog className="sheet" open style={{ display: 'block', position: 'fixed', inset: 'auto auto 0 0', width: '100%', margin: '0 auto', left: 0, right: 0 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!apptTitle.trim()) {
                speak('Bạn nhập nội dung khám nhé');
                return;
              }
              addAppointment({
                title: apptTitle.trim(),
                at: apptAt,
                place: apptPlace.trim() || 'Bệnh viện GoCare',
              });
              speak(`Đã lưu lịch hẹn ${apptTitle}. App sẽ nhắc bạn trước một ngày.`);
              showToast(`Đã lưu lịch hẹn: ${apptTitle}`);
              setAddingAppt(false);
              setApptTitle('');
            }}
          >
            <h2>Thêm lịch hẹn khám</h2>
            <label className="field">
              <span>Khám gì?</span>
              <input
                required
                value={apptTitle}
                onChange={(e) => setApptTitle(e.target.value)}
                placeholder="Tái khám tim mạch"
              />
            </label>
            <label className="field">
              <span>Ngày giờ</span>
              <input
                type="datetime-local"
                required
                value={apptAt}
                onChange={(e) => setApptAt(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Nơi khám</span>
              <input
                value={apptPlace}
                onChange={(e) => setApptPlace(e.target.value)}
                placeholder="Bệnh viện GoCare"
              />
            </label>
            <button className="btn big primary full" type="submit">
              <span className="ms">save</span> Lưu lịch hẹn
            </button>
            <button className="btn full" type="button" onClick={() => setAddingAppt(false)}>
              Đóng
            </button>
          </form>
        </dialog>
      )}

      {/* ================= ADD CAMERA SHEET ================= */}
      {addingCam && (
        <dialog className="sheet" open style={{ display: 'block', position: 'fixed', inset: 'auto auto 0 0', width: '100%', margin: '0 auto', left: 0, right: 0 }}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const source = camKind === 'webcam' ? `Webcam ${camIndex}` : camUrl;
              if (camKind === 'ip' && !camUrl.trim()) {
                speak('Bạn nhập link camera nhé');
                return;
              }
              await addCamera({
                name: camName,
                source,
                zone: camZone,
              });
              setAddingCam(false);
            }}
          >
            <h2>Cài camera mới</h2>
            <label className="field">
              <span>Tên camera (đặt ở đâu?)</span>
              <input
                value={camName}
                onChange={(e) => setCamName(e.target.value)}
                placeholder="Phòng khách"
              />
            </label>

            <p className="label">Loại camera</p>
            <div className="choice">
              <button
                type="button"
                aria-pressed={camKind === 'webcam'}
                onClick={() => setCamKind('webcam')}
              >
                <span className="ms">desktop_windows</span>Webcam máy tính
              </button>
              <button
                type="button"
                aria-pressed={camKind === 'ip'}
                onClick={() => setCamKind('ip')}
              >
                <span className="ms">nest_cam_wired_stand</span>Camera IP / Wi-Fi
              </button>
            </div>

            {camKind === 'webcam' ? (
              <>
                <p className="label">Webcam số mấy?</p>
                <div className="seg">
                  {['0', '1', '2'].map((i) => (
                    <button
                      type="button"
                      key={i}
                      aria-pressed={camIndex === i}
                      onClick={() => setCamIndex(i)}
                    >
                      {i === '0' ? 'Webcam chính' : 'Số ' + i}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <label className="field">
                  <span>Link RTSP của camera</span>
                  <input
                    value={camUrl}
                    onChange={(e) => setCamUrl(e.target.value)}
                    placeholder="rtsp://user:matkhau@192.168.1.20:554/stream1"
                  />
                </label>
                <p className="muted small">
                  Xem trong app của camera (Imou, Ezviz, TP-Link Tapo…) → mục RTSP / ONVIF.
                </p>
              </>
            )}

            <label className="check" style={{ marginTop: '14px' }}>
              <input
                type="checkbox"
                checked={camZone}
                onChange={(e) => setCamZone(e.target.checked)}
              />
              {' '}Báo động khi bệnh nhân rời khỏi khu vực giữa khung hình
            </label>

            <button className="btn big primary full" type="submit">
              <span className="ms fill">videocam</span> Lưu & bật camera
            </button>
            <button className="btn full" type="button" onClick={() => setAddingCam(false)}>
              Đóng
            </button>
          </form>
        </dialog>
      )}
    </>
  );
};
