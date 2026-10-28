import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  WEEKDAYS,
  pad,
  spokenTime,
  spokenDate,
  spokenHM,
  getTodayDoses,
  getNextDose,
  getGreeting,
  medColor,
} from '../utils/helpers';
import { playBeep } from '../services/audio';

export const HomeScreen: React.FC = () => {
  const {
    state,
    setActiveTab,
    speak,
    startSOSCountdown,
    markDoseTaken,
    showToast,
    cameras,
    zoneStatus,
    syncStatus,
  } = useApp();

  const [timeStr, setTimeStr] = useState(() => {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [dateStr, setDateStr] = useState(() => {
    const d = new Date();
    return `${WEEKDAYS[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}`;
  });
  const [greeting, setGreeting] = useState(() => getGreeting());

  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      setTimeStr(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
      setDateStr(`${WEEKDAYS[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}`);
      setGreeting(getGreeting());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const doses = getTodayDoses(state.meds, state.log);
  const next = getNextDose(state.meds, state.log);

  const handleClockClick = () => {
    const now = new Date();
    speak(`Bây giờ là ${spokenTime(now)}, ${spokenDate(now)}`);
  };

  const handleOkClick = () => {
    playBeep();
    speak('Tôi vẫn khỏe. Đã ghi nhận.');
    showToast('Đã ghi nhận: Bạn vẫn khỏe và an tâm');
  };

  const runningCamCount = cameras.filter((c) => c.running).length;
  const p = state.profile;

  return (
    <section className="screen active" id="screen-home">
      {/* ============ HERO CLOCK CARD ============ */}
      <button className="hero-card" onClick={handleClockClick}>
        <span className="hc-label">
          <span>{dateStr}</span> <span className="ms">schedule</span>
        </span>
        <span className="hc-big">
          {timeStr.split(':')[0]}
          <span className="colon">:</span>
          {timeStr.split(':')[1]}
        </span>
        <span className="hc-sub">
          <span className="dot"></span> Chúc bạn một ngày an lành
        </span>
        <span className="hc-chip" aria-hidden="true">
          <span className="ms fill">{greeting.icon}</span>
          <b>GoCare</b>
          <small>An tâm mỗi ngày</small>
        </span>
      </button>

      {/* ============ 4 ACTIONS ============ */}
      <div className="actions">
        <button
          className="action"
          onClick={() => {
            speak('Mở trang thuốc');
            setActiveTab('meds');
          }}
        >
          <span className="act-ico">
            <span className="ms">medication</span>
          </span>
          Thuốc
        </button>

        <button
          className="action"
          onClick={() => {
            speak('Mở camera an toàn');
            setActiveTab('safety');
          }}
        >
          <span className="act-ico">
            <span className="ms">videocam</span>
          </span>
          Camera
        </button>

        <button
          className="action"
          onClick={() => {
            speak('Mở theo dõi sức khỏe');
            setActiveTab('health');
          }}
        >
          <span className="act-ico">
            <span className="ms">monitor_heart</span>
          </span>
          Sức khỏe
        </button>

        <button className="action" onClick={handleOkClick}>
          <span className="act-ico">
            <span className="ms">sentiment_satisfied</span>
          </span>
          Tôi khỏe
        </button>
      </div>

      {/* ============ SOS EMERGENCY BUTTON ============ */}
      <button className="sos" onClick={startSOSCountdown}>
        <span className="sos-ring" aria-hidden="true">
          <span className="ms fill">e911_emergency</span>
        </span>
        <span className="sos-body">
          <span className="sos-text">Gọi Cấp Cứu</span>
          <span className="sos-sub">Chạm 1 lần — bệnh viện nhận ngay</span>
        </span>
        <span className="ms sos-arrow" aria-hidden="true">
          arrow_forward
        </span>
      </button>

      {/* ============ NEXT MEDICATION CARD ============ */}
      {next && (
        <div className={`card next-med ${next.status === 'due' ? 'due' : ''}`}>
          <div
            className="nm-top"
            onClick={() => {
              speak(`Thuốc kế tiếp là ${next.med.name}, ${next.med.dose}, lúc ${spokenHM(next.time)}`);
            }}
          >
            <div className="nm-pill">
              <span className="ms fill">medication</span>
            </div>
            <div className="nm-body">
              <div className="nm-label">
                {next.status === 'due' ? 'ĐẾN GIỜ UỐNG' : 'THUỐC TIẾP THEO'}
              </div>
              <div className="nm-name">{next.med.icon} {next.med.name}</div>
              <div className="nm-meta">
                <b>{next.time}</b> · {next.med.dose} · {next.med.note}
              </div>
            </div>
          </div>
          {next.status === 'due' ? (
            <button className="btn okay big full" onClick={() => markDoseTaken(next.key)}>
              <span className="ms fill">check_circle</span> ĐÃ UỐNG NGAY
            </button>
          ) : (
            <button className="btn full" onClick={() => markDoseTaken(next.key)}>
              <span className="ms">check</span> Uống trước giờ
            </button>
          )}
        </div>
      )}

      {/* ============ TODAY'S MEDICATION DOSES ============ */}
      <div className="sec-head">
        <h2>Thuốc hôm nay</h2>
        <button className="see-all" onClick={() => setActiveTab('meds')}>
          Xem tất cả <span className="ms">arrow_forward</span>
        </button>
      </div>

      <div className="list card">
        {doses.length === 0 ? (
          <p className="empty">Hôm nay không có lịch uống thuốc</p>
        ) : (
          doses.slice(0, 4).map((d) => (
            <div
              key={d.key}
              className="li"
              onClick={() => {
                speak(`${d.med.name}, ${d.med.dose}, ${d.time}. ${d.status === 'taken' ? 'Đã uống' : 'Chưa uống'}`);
              }}
            >
              <div className={`li-ico ${medColor(d.med)}`}>
                <span>{d.med.icon}</span>
              </div>
              <div className="li-body">
                <div className="li-title">{d.med.name}</div>
                <div className="li-sub">
                  {d.med.dose} · {d.med.note}
                </div>
              </div>
              <div className="li-end">
                <div className="li-val">{d.time}</div>
                {d.status === 'taken' ? (
                  <span className="tag ok">
                    <span className="ms fill">check_circle</span> Đã uống
                  </span>
                ) : (
                  <button
                    className="btn okay small"
                    style={{ padding: '6px 12px', fontSize: '0.78em' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      markDoseTaken(d.key);
                    }}
                  >
                    <span className="ms">check</span> Đã uống
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ============ STATUS ROW ============ */}
      <div className="sec-head">
        <h2>Tình trạng</h2>
      </div>
      <div className="status-row">
        <button className="status" onClick={() => setActiveTab('safety')}>
          <span className={`st-ico ${runningCamCount > 0 ? 'c-green' : 'c-amber'}`}>
            <span className="ms">{runningCamCount > 0 ? 'videocam' : 'videocam_off'}</span>
          </span>
          <b>Camera</b>
          <span>{runningCamCount > 0 ? `${runningCamCount} đang bật` : 'Chưa bật'}</span>
        </button>

        <button className="status" onClick={() => setActiveTab('safety')}>
          <span className={`st-ico ${state.zone.on ? 'c-green' : 'c-amber'}`}>
            <span className="ms">{state.zone.on ? 'shield' : 'location_off'}</span>
          </span>
          <b>Vùng an toàn</b>
          <span>
            {state.zone.on
              ? zoneStatus.outside
                ? 'ĐANG RA NGOÀI'
                : 'Đang ở nhà'
              : 'Chưa bật GPS'}
          </span>
        </button>

        <button className="status" onClick={() => setActiveTab('settings')}>
          <span className={`st-ico ${syncStatus === 'ok' ? 'c-green' : 'c-amber'}`}>
            <span className="ms">{syncStatus === 'ok' ? 'cloud_done' : 'sync'}</span>
          </span>
          <b>Bệnh viện</b>
          <span>{syncStatus === 'ok' ? 'Đã kết nối' : 'Đang đồng bộ'}</span>
        </button>
      </div>

      {/* ============ QUICK CALLS ============ */}
      <div className="sec-head">
        <h2>Gọi nhanh</h2>
      </div>
      <div className="list card">
        <a
          className="li"
          href={`tel:${p.emergencyPhone || '115'}`}
          onClick={() => speak(`Gọi cấp cứu ${p.emergencyPhone || '115'}`)}
        >
          <div className="li-ico c-red">
            <span className="ms fill">emergency</span>
          </div>
          <div className="li-body">
            <div className="li-title">Gọi Cấp Cứu ({p.emergencyPhone || '115'})</div>
            <div className="li-sub">Đường dây nóng cấp cứu y tế</div>
          </div>
          <div className="li-end">
            <span className="ms">call</span>
          </div>
        </a>

        {p.familyPhone && (
          <a
            className="li"
            href={`tel:${p.familyPhone}`}
            onClick={() => speak(`Gọi người thân ${p.familyName || ''}`)}
          >
            <div className="li-ico c-green">
              <span className="ms fill">family_restroom</span>
            </div>
            <div className="li-body">
              <div className="li-title">Gọi {p.familyName || 'Người thân'}</div>
              <div className="li-sub">{p.familyPhone}</div>
            </div>
            <div className="li-end">
              <span className="ms">call</span>
            </div>
          </a>
        )}

        {p.doctorPhone && (
          <a
            className="li"
            href={`tel:${p.doctorPhone}`}
            onClick={() => speak('Gọi bác sĩ điều dưỡng')}
          >
            <div className="li-ico c-blue">
              <span className="ms fill">medical_services</span>
            </div>
            <div className="li-body">
              <div className="li-title">Bác sĩ / Điều dưỡng</div>
              <div className="li-sub">{p.doctorPhone}</div>
            </div>
            <div className="li-end">
              <span className="ms">call</span>
            </div>
          </a>
        )}
      </div>

      {/* ============ PROMO CARETAKER BANNER ============ */}
      <a
        className="promo"
        href="https://mai-hu-nh-th-tuy-t-o684.vercel.app/"
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => speak('Mở trang đặt điều dưỡng tại nhà')}
      >
        <span className="promo-ico">
          <span className="ms">home_health</span>
        </span>
        <span>
          <b>Đặt điều dưỡng tại nhà</b>
          <small>Điều dưỡng GoCare có chứng chỉ, đến tận nhà 24/7</small>
        </span>
        <span className="ms">chevron_right</span>
      </a>
    </section>
  );
};
