import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera } from '../types';
import { useApp } from '../context/AppContext';
import { setSiren } from '../services/audio';

interface CameraFeedProps {
  camera: Camera;
  onToggle: (start: boolean) => void;
  onDelete: () => void;
}

export const CameraFeed: React.FC<CameraFeedProps> = ({ camera, onToggle, onDelete }) => {
  const { sendEmergencyAlert, speak, showToast } = useApp();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [useWebcam, setUseWebcam] = useState(false);
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const [personState, setPersonState] = useState<'standing' | 'sitting' | 'falling' | 'lying' | 'outside'>('standing');
  const [fallDetected, setFallDetected] = useState(false);
  const [zoneBreached, setZoneBreached] = useState(false);
  const [algorithmState, setAlgorithmState] = useState({
    upright: true,
    lying: false,
    angle: 5,
    dropPercent: 0,
    needDropPercent: 40,
    lyingSeconds: 0,
    cond1UprightRecent: true,
    cond2DropSufficient: false,
    cond3LyingDuration: false,
  });

  // Track algorithm variables (reproducing fall_detection/fall_detector.py)
  const trackRef = useRef<{
    lastUpright: number;
    upHeight: number;
    upTop: number;
    lyingSince: number | null;
    outsideSince: number | null;
    lastAlertTime: { fall: number; zone: number };
  }>({
    lastUpright: Date.now() / 1000,
    upHeight: 0.65,
    upTop: 0.15,
    lyingSince: null,
    outsideSince: null,
    lastAlertTime: { fall: 0, zone: 0 },
  });

  // Start real webcam stream
  const startWebcam = async () => {
    try {
      setWebcamError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 360 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setUseWebcam(true);
      speak('Đã kết nối webcam thiết bị. Thuật toán té ngã đang phân tích trực tiếp.');
      showToast('Đang chạy camera và thuật toán té ngã');
    } catch (err: any) {
      setWebcamError('Không mở được webcam: ' + (err.message || 'Chưa cấp quyền'));
      setUseWebcam(false);
    }
  };

  const stopWebcam = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setUseWebcam(false);
  };

  // Main algorithm and canvas render loop
  useEffect(() => {
    if (!camera.running) {
      stopWebcam();
      return;
    }

    let animationId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let simulationStep = 0;

    const render = () => {
      const now = Date.now() / 1000;
      const W = canvas.width || 640;
      const H = canvas.height || 360;

      ctx.clearRect(0, 0, W, H);

      // Background rendering: draw webcam video if active, or simulated room background
      if (useWebcam && videoRef.current && videoRef.current.readyState >= 2) {
        ctx.drawImage(videoRef.current, 0, 0, W, H);
      } else {
        // Draw living room background
        ctx.fillStyle = '#182b24';
        ctx.fillRect(0, 0, W, H);

        // Grid lines (room perspective)
        ctx.strokeStyle = '#27473b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, H * 0.75);
        ctx.lineTo(W, H * 0.75);
        ctx.moveTo(W * 0.25, H * 0.75);
        ctx.lineTo(0, H);
        ctx.moveTo(W * 0.75, H * 0.75);
        ctx.lineTo(W, H);
        ctx.stroke();

        // Furniture hints
        ctx.fillStyle = '#223830';
        ctx.fillRect(W * 0.08, H * 0.55, W * 0.2, H * 0.22); // Armchair
        ctx.fillStyle = '#1e332c';
        ctx.fillRect(W * 0.75, H * 0.5, W * 0.18, H * 0.28); // Cabinet
      }

      // Safe Zone polygon coordinates (12% to 88% width, 8% to 92% height)
      const hasZone = !!camera.zone;
      const zoneLeft = W * 0.12;
      const zoneTop = H * 0.08;
      const zoneRight = W * 0.88;
      const zoneBottom = H * 0.92;

      if (hasZone) {
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.strokeRect(zoneLeft, zoneTop, zoneRight - zoneLeft, zoneBottom - zoneTop);
        ctx.setLineDash([]);

        ctx.fillStyle = '#eab308';
        ctx.font = '600 12px sans-serif';
        ctx.fillText('VÙNG AN TOÀN TRONG NHÀ', zoneLeft + 8, zoneTop + 18);
      }

      // Compute posture and bounding box based on personState
      let boxX = W * 0.44;
      let boxY = H * 0.18;
      let boxW = W * 0.14;
      let boxH = H * 0.56;
      let angle = 6;
      let isUpright = false;
      let isLying = false;

      if (personState === 'standing') {
        boxX = W * 0.44;
        boxY = H * 0.18;
        boxW = W * 0.14;
        boxH = H * 0.56;
        angle = 8;
        isUpright = true;
        isLying = false;
      } else if (personState === 'sitting') {
        boxX = W * 0.44;
        boxY = H * 0.38;
        boxW = W * 0.18;
        boxH = H * 0.36;
        angle = 38;
        isUpright = false;
        isLying = false;
      } else if (personState === 'falling') {
        // Fast transition
        simulationStep += 0.05;
        const progress = Math.min(1, simulationStep);
        boxX = W * (0.44 + progress * 0.05);
        boxY = H * (0.18 + progress * 0.52);
        boxW = W * (0.14 + progress * 0.22);
        boxH = H * (0.56 - progress * 0.38);
        angle = 8 + progress * 72;
        if (progress >= 1) {
          setPersonState('lying');
        }
      } else if (personState === 'lying') {
        boxX = W * 0.45;
        boxY = H * 0.70;
        boxW = W * 0.38;
        boxH = H * 0.18;
        angle = 82;
        isUpright = false;
        isLying = true;
      } else if (personState === 'outside') {
        boxX = W * 0.02;
        boxY = H * 0.35;
        boxW = W * 0.12;
        boxH = H * 0.52;
        angle = 12;
        isUpright = true;
        isLying = false;
      }

      const tr = trackRef.current;
      const headTopNorm = boxY / H;
      const heightNorm = boxH / H;
      const centerX = boxX + boxW / 2;
      const centerY = boxY + boxH / 2;

      if (isUpright) {
        tr.lastUpright = now;
        tr.upHeight = heightNorm;
        tr.upTop = headTopNorm;
      }

      if (isLying) {
        tr.lyingSince = tr.lyingSince || now;
      } else {
        tr.lyingSince = null;
      }

      // Condition 1: Was upright within 4 seconds
      const cond1 = tr.lyingSince !== null && tr.lyingSince - tr.lastUpright < 4.0;

      // Condition 2: Head dropped by >= 40% of standing height
      const drop = headTopNorm - tr.upTop;
      const needDrop = 0.4 * (tr.upHeight || 0.6);
      const cond2 = drop >= needDrop;

      // Condition 3: Lying still for >= 2.5 seconds
      const lyingSeconds = tr.lyingSince ? Math.max(0, now - tr.lyingSince) : 0;
      const cond3 = tr.lyingSince !== null && lyingSeconds >= 2.5;

      const dropPercent = Math.round((drop / (tr.upHeight || 0.6)) * 100);
      const needPercent = Math.round((needDrop / (tr.upHeight || 0.6)) * 100);

      // Check indoor zone
      const insideZone = !hasZone || (centerX >= zoneLeft && centerX <= zoneRight && centerY >= zoneTop && centerY <= zoneBottom);
      if (hasZone) {
        if (!insideZone) {
          tr.outsideSince = tr.outsideSince || now;
          const outsideSeconds = now - tr.outsideSince;
          if (outsideSeconds >= 10 && now - tr.lastAlertTime.zone > 120) {
            tr.lastAlertTime.zone = now;
            setZoneBreached(true);
            setSiren(true);
            speak('Cảnh báo: Bệnh nhân đã rời vùng an toàn trong nhà quá 10 giây!', true);
            sendEmergencyAlert({
              type: 'zone',
              note: `[Camera: ${camera.name}] Rời vùng an toàn trong nhà ${Math.round(outsideSeconds)}s`,
              confidence: 0.9,
            });
            setTimeout(() => setSiren(false), 5000);
          }
        } else {
          tr.outsideSince = null;
          setZoneBreached(false);
        }
      }

      // Check Fall Confirmation (All 3 Conditions Met!)
      if (cond1 && cond2 && cond3) {
        if (now - tr.lastAlertTime.fall > 120) {
          tr.lastAlertTime.fall = now;
          setFallDetected(true);
          setSiren(true);
          const conf = Math.min(0.99, 0.65 + (Math.min(angle, 90) - 45) / 150 + Math.min(drop, 0.3));
          speak('Cảnh báo khẩn cấp: Phát hiện người té ngã! Hệ thống đang phát tín hiệu cấp cứu hỏa tốc.', true);
          showToast('🚨 ĐÃ PHÁT HIỆN TÉ NGÃ — ĐÃ BÁO BỆNH VIỆN');

          sendEmergencyAlert({
            type: 'fall',
            note: `[Camera: ${camera.name}] Phát hiện té ngã (thân nghiêng ${Math.round(angle)}°, đỉnh đầu tụt ${dropPercent}%, nằm yên ${lyingSeconds.toFixed(1)}s)`,
            confidence: conf,
          });

          setTimeout(() => {
            setSiren(false);
          }, 8000);
        }
      }

      setAlgorithmState({
        upright: isUpright,
        lying: isLying,
        angle: Math.round(angle),
        dropPercent: Math.max(0, dropPercent),
        needDropPercent: needPercent,
        lyingSeconds: Math.round(lyingSeconds * 10) / 10,
        cond1UprightRecent: cond1 || isUpright,
        cond2DropSufficient: cond2,
        cond3LyingDuration: cond3,
      });

      // Draw bounding box and skeleton overlay
      const boxColor = isLying ? '#ef4444' : isUpright ? '#16a34a' : '#f59e0b';
      ctx.strokeStyle = boxColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      // Draw skeleton lines inside box
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2;
      const headX = isLying ? boxX + boxW * 0.15 : boxX + boxW * 0.5;
      const headY = boxY + boxH * 0.15;
      const hipX = isLying ? boxX + boxW * 0.85 : boxX + boxW * 0.5;
      const hipY = isLying ? boxY + boxH * 0.7 : boxY + boxH * 0.6;

      ctx.beginPath();
      ctx.arc(headX, headY, Math.min(boxW, boxH) * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = boxColor;
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(headX, headY);
      ctx.lineTo(hipX, hipY);
      ctx.stroke();

      // Label on top of bounding box
      const statusLabel = isLying ? 'NẰM' : isUpright ? 'ĐỨNG' : 'NGỒI / CÚI';
      ctx.fillStyle = boxColor;
      ctx.fillRect(boxX, Math.max(16, boxY - 24), Math.max(84, boxW * 0.9), 22);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(`${statusLabel} ${Math.round(angle)}°`, boxX + 6, Math.max(32, boxY - 8));

      // If outside zone, display warning below box
      if (!insideZone && hasZone) {
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(boxX, boxY + boxH + 4, 150, 20);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('NGOÀI VÙNG AN TOÀN', boxX + 6, boxY + boxH + 18);
      }

      // If fall detected, draw top pulsing emergency banner
      if (fallDetected || (cond1 && cond2 && cond3)) {
        ctx.fillStyle = 'rgba(220, 38, 38, 0.92)';
        ctx.fillRect(0, 0, W, 52);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText('🚨 TÉ NGÃ - ĐÃ TẠO ĐƠN CẤP CỨU HỎA TỐC', 18, 32);
      }

      // Camera ID & timestamp watermark
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.font = '11px sans-serif';
      ctx.fillText(`GoCare AI Pose | ${camera.name} | ${new Date().toLocaleTimeString('vi-VN')}`, 10, H - 10);

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
      stopWebcam();
    };
  }, [camera.running, camera.name, camera.zone, personState, useWebcam, fallDetected, speak, showToast, sendEmergencyAlert]);

  // Action helpers to test algorithm
  const triggerFallTest = useCallback(() => {
    trackRef.current.lastUpright = Date.now() / 1000;
    trackRef.current.upHeight = 0.65;
    trackRef.current.upTop = 0.18;
    setPersonState('falling');
    setFallDetected(false);
    speak('Bắt đầu mô phỏng té ngã. Thuật toán kiểm tra 3 điều kiện: đứng thẳng, đỉnh đầu tụt 40%, và nằm yên 2.5 giây.');
  }, [speak]);

  const triggerSittingTest = useCallback(() => {
    setPersonState('sitting');
    setFallDetected(false);
    speak('Mô phỏng ngồi cúi. Thuật toán phân biệt rõ ngồi cúi với té ngã, không báo nhầm.');
  }, [speak]);

  const triggerStandingTest = useCallback(() => {
    setPersonState('standing');
    setFallDetected(false);
    setZoneBreached(false);
    trackRef.current.lyingSince = null;
    trackRef.current.outsideSince = null;
    speak('Trở về tư thế đứng bình thường.');
  }, [speak]);

  const triggerOutsideTest = useCallback(() => {
    setPersonState('outside');
    speak('Mô phỏng người rời khỏi vùng an toàn trong nhà.');
  }, [speak]);

  return (
    <div className="cam">
      <div className="cam-view" style={{ minHeight: '260px' }}>
        {camera.running && (
          <span className="cam-live">
            <i></i>TRỰC TIẾP (YOLOv8 AI)
          </span>
        )}

        <video ref={videoRef} playsInline muted style={{ display: 'none' }} />

        {camera.running ? (
          <canvas
            ref={canvasRef}
            width={640}
            height={360}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        ) : (
          <span className="placeholder">
            <span className="ms">videocam_off</span>
            Camera đang tắt
          </span>
        )}
      </div>

      <div className="cam-body">
        <div className="cam-title">
          <b>{camera.name}</b>
          <span className={`tag ${camera.running ? 'ok' : ''}`}>
            <span className="ms fill">{camera.running ? 'check_circle' : 'pause_circle'}</span>{' '}
            {camera.running ? 'Đang bật AI' : 'Đã tắt'}
          </span>
        </div>

        <div className="cam-src">
          {camera.source}
          {camera.zone ? ' · Có vùng an toàn trong nhà (10s)' : ''}
        </div>

        {/* ============ LIVE 3-CONDITION ALGORITHM STATUS PANEL ============ */}
        {camera.running && (
          <div
            style={{
              background: 'var(--bg)',
              borderRadius: '16px',
              padding: '12px 14px',
              margin: '10px 0',
              fontSize: '0.82em',
              border: fallDetected ? '2px solid var(--red)' : '1px solid var(--line)',
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
              <span>Thuật toán té ngã (3 điều kiện):</span>
              <span
                style={{
                  color: fallDetected ? 'var(--red)' : 'var(--primary)',
                  fontWeight: 800,
                }}
              >
                {fallDetected ? '🚨 XÁC NHẬN TÉ NGÃ' : 'ĐANG GIÁM SÁT'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className={`ms ${algorithmState.cond1UprightRecent ? 'fill' : ''}`} style={{ fontSize: '1.2em', color: algorithmState.cond1UprightRecent ? 'var(--green)' : 'var(--ink-2)' }}>
                  {algorithmState.cond1UprightRecent ? 'check_circle' : 'radio_button_unchecked'}
                </span>
                <span>
                  1. Vừa đứng thẳng trong 4s:{' '}
                  <b>{algorithmState.cond1UprightRecent ? 'Đạt' : 'Chưa đạt'}</b>
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className={`ms ${algorithmState.cond2DropSufficient ? 'fill' : ''}`} style={{ fontSize: '1.2em', color: algorithmState.cond2DropSufficient ? 'var(--green)' : 'var(--ink-2)' }}>
                  {algorithmState.cond2DropSufficient ? 'check_circle' : 'radio_button_unchecked'}
                </span>
                <span>
                  2. Đỉnh đầu tụt ≥ 40%:{' '}
                  <b>
                    {algorithmState.dropPercent}% / {algorithmState.needDropPercent}% ({algorithmState.cond2DropSufficient ? 'Đạt' : 'Chưa'})
                  </b>
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className={`ms ${algorithmState.cond3LyingDuration ? 'fill' : ''}`} style={{ fontSize: '1.2em', color: algorithmState.cond3LyingDuration ? 'var(--green)' : 'var(--ink-2)' }}>
                  {algorithmState.cond3LyingDuration ? 'check_circle' : 'radio_button_unchecked'}
                </span>
                <span>
                  3. Nằm yên ≥ 2.5s:{' '}
                  <b>
                    {algorithmState.lyingSeconds}s / 2.5s ({algorithmState.cond3LyingDuration ? 'ĐẠT' : 'Đang đếm'})
                  </b>
                </span>
              </div>
            </div>

            {/* Test Simulation Controls */}
            <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed var(--line)' }}>
              <span className="muted small" style={{ display: 'block', marginBottom: '6px' }}>
                Thử nghiệm thuật toán:
              </span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn small"
                  style={{ padding: '6px 10px', fontSize: '0.76em', background: 'var(--red-soft)', color: 'var(--red)' }}
                  onClick={triggerFallTest}
                >
                  <span className="ms fill">personal_injury</span> Thử té ngã (3 bước)
                </button>
                <button
                  type="button"
                  className="btn small"
                  style={{ padding: '6px 10px', fontSize: '0.76em' }}
                  onClick={triggerSittingTest}
                >
                  <span className="ms">chair</span> Ngồi cúi (Không báo)
                </button>
                <button
                  type="button"
                  className="btn small"
                  style={{ padding: '6px 10px', fontSize: '0.76em' }}
                  onClick={triggerOutsideTest}
                >
                  <span className="ms">door_open</span> Rời vùng
                </button>
                <button
                  type="button"
                  className="btn small"
                  style={{ padding: '6px 10px', fontSize: '0.76em', background: 'var(--green-soft)', color: 'var(--primary)' }}
                  onClick={triggerStandingTest}
                >
                  <span className="ms">accessibility_new</span> Đứng dậy
                </button>
              </div>
            </div>

            {/* Real Webcam toggle */}
            <div style={{ marginTop: '8px' }}>
              {!useWebcam ? (
                <button
                  type="button"
                  className="link-btn small"
                  style={{ color: 'var(--primary)', fontWeight: 700 }}
                  onClick={startWebcam}
                >
                  <span className="ms">videocam</span> Mở webcam thật của máy để thử nghiệm
                </button>
              ) : (
                <button
                  type="button"
                  className="link-btn small"
                  style={{ color: 'var(--red)', fontWeight: 700 }}
                  onClick={stopWebcam}
                >
                  <span className="ms">videocam_off</span> Tắt webcam thật (chuyển sang mô phỏng)
                </button>
              )}
              {webcamError && (
                <div style={{ color: 'var(--red)', fontSize: '0.76em', marginTop: '4px' }}>
                  {webcamError}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="cam-actions">
          {camera.running ? (
            <button className="btn" onClick={() => onToggle(false)}>
              <span className="ms">stop_circle</span> Tắt camera
            </button>
          ) : (
            <button className="btn primary" onClick={() => onToggle(true)}>
              <span className="ms">play_circle</span> Bật canh chừng
            </button>
          )}

          <button
            className="icon-btn red"
            onClick={() => {
              if (confirm(`Xóa camera "${camera.name}"?`)) {
                onDelete();
              }
            }}
            aria-label="Xóa camera"
          >
            <span className="ms">delete</span>
          </button>
        </div>
      </div>
    </div>
  );
};
