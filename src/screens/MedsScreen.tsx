import React from 'react';
import { useApp } from '../context/AppContext';
import { WEEKDAYS, getTodayDoses, medColor } from '../utils/helpers';

export const MedsScreen: React.FC = () => {
  const {
    state,
    setActiveTab,
    markDoseTaken,
    setEditingMed,
    speak,
  } = useApp();

  const doses = getTodayDoses(state.meds, state.log);
  const doneCount = doses.filter((d) => d.status === 'taken').length;
  const totalCount = doses.length;
  const progressPercent = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const weekdayName = WEEKDAYS[new Date().getDay()];

  return (
    <section className="screen active" id="screen-meds">
      <div className="page-head">
        <button
          className="back"
          onClick={() => {
            speak('Quay lại trang chủ');
            setActiveTab('home');
          }}
          aria-label="Quay lại"
        >
          <span className="ms">arrow_back</span>
        </button>
        <h1>Thuốc của tôi</h1>
        <button
          className="back"
          onClick={() => {
            speak('Thêm thuốc mới');
            setEditingMed('new');
          }}
          aria-label="Thêm thuốc"
        >
          <span className="ms">add</span>
        </button>
      </div>

      {/* ============ PROGRESS GREEN CARD ============ */}
      <div
        className="green-card"
        onClick={() => {
          speak(`Hôm nay đã uống ${doneCount} trên ${totalCount} lần thuốc`);
        }}
      >
        <div className="gc-top">
          <span className="gc-label">Thuốc hôm nay</span>
          <span className="gc-pill">{weekdayName}</span>
        </div>
        <div className="gc-big">
          {totalCount ? `${doneCount}/${totalCount} lần` : 'Chưa có thuốc'}
        </div>
        <div className="bar">
          <i style={{ width: `${progressPercent}%` }}></i>
        </div>
        <div className="gc-foot">
          <span>
            {progressPercent === 100 && totalCount > 0
              ? 'Tuyệt vời, đã uống đủ!'
              : `${doneCount} đã uống`}
          </span>
          <span>{totalCount - doneCount} còn lại</span>
        </div>
      </div>

      {/* ============ TODAY SCHEDULE ============ */}
      <div className="sec-head">
        <h2>Lịch hôm nay</h2>
      </div>
      <div className="dose-list">
        {doses.length === 0 ? (
          <p className="empty">Không có lịch uống thuốc hôm nay</p>
        ) : (
          doses.map((d) => (
            <div key={d.key} className={`dose ${d.status}`}>
              <span className="d-time">{d.time}</span>
              <span>
                <span className="d-name">
                  {d.med.icon} {d.med.name}
                </span>
                <br />
                <span className="d-dose">
                  {d.med.dose} · {d.med.note}
                </span>
              </span>

              {d.status === 'taken' ? (
                <span className="tag ok">
                  <span className="ms fill">check_circle</span> Đã uống
                </span>
              ) : (
                <button
                  className={`btn ${d.status === 'upcoming' ? '' : 'okay'}`}
                  onClick={() => markDoseTaken(d.key)}
                >
                  <span className="ms">check</span>
                  {d.status === 'missed' ? ' Quên — uống bù' : ' Đã uống'}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* ============ MEDICATION LIST ============ */}
      <div className="sec-head">
        <h2>Danh sách thuốc</h2>
      </div>
      <div className="list card">
        {state.meds.length === 0 ? (
          <p className="empty">Chưa có thuốc nào trong danh sách</p>
        ) : (
          state.meds.map((m) => (
            <button
              key={m.id}
              className="li"
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none' }}
              onClick={() => {
                speak(`Sửa thuốc ${m.name}`);
                setEditingMed(m);
              }}
            >
              <div className={`li-ico ${medColor(m)}`}>
                <span>{m.icon}</span>
              </div>
              <div className="li-body">
                <div className="li-title">{m.name}</div>
                <div className="li-sub">
                  {m.dose} · {m.note}
                </div>
              </div>
              <div className="li-end">
                <div className="li-val">{m.times.join(' · ')}</div>
                <div className="li-sub">{m.times.length} lần/ngày</div>
              </div>
            </button>
          ))
        )}
      </div>

      <button
        className="btn big primary full"
        onClick={() => {
          speak('Thêm thuốc mới');
          setEditingMed('new');
        }}
      >
        <span className="ms">add_circle</span> Thêm thuốc mới
      </button>

      <div className="tip">
        <span className="ms">tips_and_updates</span>
        <span>
          <b>Mẹo nhỏ</b>
          <br />
          Để hộp thuốc cạnh ly nước buổi sáng giúp không quên uống.
        </span>
      </div>
    </section>
  );
};
