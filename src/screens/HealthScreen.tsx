import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { vitalSummaryText } from '../utils/helpers';
import { VitalRecord } from '../types';

interface MetricDef {
  label: string;
  unit: string;
  get: (v: VitalRecord) => number | null;
  show: (v: VitalRecord) => string;
}

const METRICS: Record<'bp' | 'pulse' | 'sugar', MetricDef> = {
  bp: {
    label: 'Huyết áp',
    unit: 'mmHg',
    get: (v) => v.sys,
    show: (v) => `${v.sys}/${v.dia}`,
  },
  pulse: {
    label: 'Nhịp tim',
    unit: 'lần/phút',
    get: (v) => v.pulse,
    show: (v) => `${v.pulse}`,
  },
  sugar: {
    label: 'Đường huyết',
    unit: 'mmol/L',
    get: (v) => v.sugar,
    show: (v) => `${v.sugar}`,
  },
};

export const HealthScreen: React.FC = () => {
  const {
    state,
    setActiveTab,
    recordVital,
    deleteAppointment,
    setAddingAppt,
    sendEmergencyAlert,
    speak,
    showToast,
  } = useApp();

  const [metricKey, setMetricKey] = useState<'bp' | 'pulse' | 'sugar'>('bp');
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [pulse, setPulse] = useState('');
  const [sugar, setSugar] = useState('');
  const [lastResult, setLastResult] = useState<{
    level: string;
    msg: string;
    v: VitalRecord;
  } | null>(null);

  const m = METRICS[metricKey];
  const pts = state.vitals.filter((v) => m.get(v) != null).slice(0, 7).reverse();
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];

  const vals = pts.map((v) => m.get(v) as number);
  const top = vals.length ? Math.max(...vals, 1) * 1.08 : 100;
  const floor = vals.length ? Math.min(...vals, top) * 0.7 : 0;
  const pct = (v: VitalRecord) => {
    const val = m.get(v);
    if (val == null) return 8;
    return Math.max(8, ((val - floor) / (top - floor || 1)) * 100);
  };
  const diff = last && prev && m.get(last) != null && m.get(prev) != null
    ? (m.get(last) as number) - (m.get(prev) as number)
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const s = sys ? Number(sys) : null;
    const d = dia ? Number(dia) : null;
    const p = pulse ? Number(pulse) : null;
    const su = sugar ? Number(sugar) : null;

    if (!s && !p && !su) {
      speak('Bạn nhập ít nhất một chỉ số nhé');
      return;
    }

    const newVital: Omit<VitalRecord, 'level'> = {
      at: new Date().toISOString(),
      sys: s,
      dia: d,
      pulse: p,
      sugar: su,
    };

    const res = recordVital(newVital);
    const summary = vitalSummaryText({ ...newVital, level: res.level as any });
    const msg =
      res.level === 'ok'
        ? 'Các chỉ số đều bình thường. Rất tốt!'
        : res.issues.join('. ');

    setLastResult({
      level: res.level,
      msg,
      v: { ...newVital, level: res.level as any },
    });

    speak(`${summary}. ${msg}${res.level === 'bad' ? '. Bạn bấm nút Báo bệnh viện ngay nhé.' : ''}`);
    showToast('Đã lưu chỉ số sức khỏe');

    setSys('');
    setDia('');
    setPulse('');
    setSugar('');
  };

  const handleReportHospital = async () => {
    if (!lastResult) return;
    const res = await sendEmergencyAlert({
      type: 'health',
      note: `${vitalSummaryText(lastResult.v)} — ${lastResult.msg}`,
    });
    if (res.ok) {
      speak('Đã báo bệnh viện. Bạn ngồi nghỉ nhé, bác sĩ sẽ liên hệ.');
      showToast('Đã báo bệnh viện');
    } else {
      speak('Chưa gửi được, bạn gọi điện cho bác sĩ nhé.');
      showToast('Chưa gửi được tin báo');
    }
  };

  const upcomingAppts = state.appts
    .filter((a) => new Date(a.at).getTime() > Date.now() - 3600000)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <section className="screen active" id="screen-health">
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
        <h1>Sức khỏe</h1>
        <span></span>
      </div>

      {/* ============ CHART CARD ============ */}
      <div className="card chart-card">
        <div className="seg">
          {(['bp', 'pulse', 'sugar'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={k === metricKey}
              onClick={() => {
                setMetricKey(k);
                speak(METRICS[k].label);
              }}
            >
              {METRICS[k].label}
            </button>
          ))}
        </div>

        <div className="ch-label">{m.label} gần nhất</div>
        <div className="ch-big">
          {last ? (
            <>
              {m.show(last)} <small>{m.unit}</small>
            </>
          ) : (
            '—'
          )}
        </div>

        {diff !== null ? (
          <span className={`ch-trend ${diff > 0 ? 't-amber' : 't-green'}`}>
            <span className="ms">
              {diff > 0 ? 'arrow_upward' : diff < 0 ? 'arrow_downward' : 'remove'}
            </span>{' '}
            {Math.abs(Math.round(diff * 10) / 10)} so với lần trước
          </span>
        ) : (
          <span className="muted">Ghi chỉ số bên dưới để xem biểu đồ</span>
        )}

        <div className="bars">
          {[0.25, 0.5, 0.75].map((f, i) => (
            <span
              key={i}
              className="gl"
              style={{ bottom: `calc(26px + ${f} * (100% - 26px))` }}
            ></span>
          ))}

          {pts.length === 0 ? (
            <span className="empty" style={{ gridColumn: '1 / -1', alignSelf: 'center' }}>
              Chưa có dữ liệu
            </span>
          ) : (
            pts.map((v, i) => {
              const isLast = i === pts.length - 1;
              const date = new Date(v.at);
              return (
                <span
                  key={i}
                  className={`b ${v.level !== 'ok' ? v.level : ''} ${isLast ? 'last' : ''}`}
                >
                  {isLast && (
                    <em style={{ bottom: `calc(${pct(v) * 0.82}% + 8px)` }}>
                      {m.show(v)}
                    </em>
                  )}
                  <i style={{ height: `${pct(v) * 0.82}%` }}></i>
                  <span>
                    {date.getDate()}/{date.getMonth() + 1}
                  </span>
                </span>
              );
            })
          )}
        </div>
      </div>

      {/* ============ VITAL RESULT CARD ============ */}
      {lastResult && (
        <div
          className="card"
          style={{
            borderLeft: `6px solid ${
              lastResult.level === 'ok'
                ? 'var(--green)'
                : lastResult.level === 'warn'
                ? 'var(--amber)'
                : 'var(--red)'
            }`,
          }}
        >
          <h2>
            <span className="ms fill">
              {lastResult.level === 'ok'
                ? 'check_circle'
                : lastResult.level === 'warn'
                ? 'warning'
                : 'emergency'}
            </span>{' '}
            {lastResult.level === 'ok'
              ? 'Bình thường'
              : lastResult.level === 'warn'
              ? 'Cần chú ý'
              : 'Nguy hiểm'}
          </h2>
          <p>{lastResult.msg}</p>
          {lastResult.level === 'bad' && (
            <button
              className="btn danger big full"
              style={{ marginTop: '10px' }}
              onClick={handleReportHospital}
            >
              <span className="ms fill">local_hospital</span> Báo bệnh viện ngay
            </button>
          )}
          {lastResult.level === 'warn' && (
            <p className="muted">Nghỉ ngơi 10 phút rồi đo lại. Nếu vẫn cao, hãy gọi bác sĩ.</p>
          )}
        </div>
      )}

      {/* ============ RECORD VITALS FORM ============ */}
      <form className="card" onSubmit={handleSubmit} autoComplete="off">
        <h2>Ghi chỉ số hôm nay</h2>
        <div className="vital-grid">
          <label className="field">
            <span>Huyết áp trên</span>
            <input
              type="number"
              inputMode="numeric"
              min="50"
              max="260"
              placeholder="120"
              value={sys}
              onChange={(e) => setSys(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Huyết áp dưới</span>
            <input
              type="number"
              inputMode="numeric"
              min="30"
              max="160"
              placeholder="80"
              value={dia}
              onChange={(e) => setDia(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Nhịp tim</span>
            <input
              type="number"
              inputMode="numeric"
              min="20"
              max="250"
              placeholder="75"
              value={pulse}
              onChange={(e) => setPulse(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Đường huyết</span>
            <input
              type="number"
              step="0.1"
              inputMode="decimal"
              min="1"
              max="40"
              placeholder="6.0"
              value={sugar}
              onChange={(e) => setSugar(e.target.value)}
            />
          </label>
        </div>
        <button className="btn big primary full" type="submit">
          <span className="ms">save</span> Lưu chỉ số
        </button>
      </form>

      {/* ============ MEASUREMENT HISTORY ============ */}
      <div className="sec-head">
        <h2>Lần đo gần đây</h2>
      </div>
      <div className="list card">
        {state.vitals.length === 0 ? (
          <p className="empty">Chưa có lần đo nào</p>
        ) : (
          state.vitals.slice(0, 8).map((v, i) => {
            const summary = vitalSummaryText(v);
            const date = new Date(v.at);
            return (
              <div
                key={i}
                className="li"
                onClick={() => speak(summary)}
              >
                <div
                  className={`li-ico ${
                    v.level === 'ok' ? 'c-green' : v.level === 'warn' ? 'c-amber' : 'c-red'
                  }`}
                >
                  <span className="ms fill">
                    {v.level === 'ok' ? 'favorite' : v.level === 'warn' ? 'warning' : 'emergency'}
                  </span>
                </div>
                <div className="li-body">
                  <div className="li-title">{summary}</div>
                  <div className="li-sub">
                    {date.toLocaleString('vi-VN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      day: '2-digit',
                      month: '2-digit',
                    })}
                  </div>
                </div>
                <div className="li-end">
                  <span className={`tag ${v.level}`}>
                    {v.level === 'ok' ? 'Tốt' : v.level === 'warn' ? 'Chú ý' : 'Nguy hiểm'}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ============ APPOINTMENTS ============ */}
      <div className="sec-head">
        <h2>Lịch hẹn khám</h2>
        <button className="see-all" onClick={() => setAddingAppt(true)}>
          <span className="ms">add</span> Thêm
        </button>
      </div>
      <div className="list card">
        {upcomingAppts.length === 0 ? (
          <p className="empty">Chưa có lịch hẹn</p>
        ) : (
          upcomingAppts.map((a) => {
            const date = new Date(a.at);
            return (
              <div key={a.id} className="li">
                <div className="li-ico c-blue">
                  <span className="ms fill">event</span>
                </div>
                <div className="li-body">
                  <div className="li-title">{a.title}</div>
                  <div className="li-sub">
                    {date.toLocaleString('vi-VN', {
                      weekday: 'long',
                      hour: '2-digit',
                      minute: '2-digit',
                      day: '2-digit',
                      month: '2-digit',
                    })}
                    {a.place ? ` · ${a.place}` : ''}
                  </div>
                </div>
                <div className="li-end">
                  <button
                    className="icon-btn red"
                    onClick={() => {
                      deleteAppointment(a.id);
                      speak(`Đã xóa lịch hẹn ${a.title}`);
                    }}
                    aria-label="Xóa"
                  >
                    <span className="ms">delete</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
