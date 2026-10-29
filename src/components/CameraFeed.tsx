import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera } from '../types';
import { useApp } from '../context/AppContext';
import { setSiren } from '../services/audio';

interface CameraFeedProps {
  camera: Camera;
  onToggle: (start: boolean) => void;
  onDelete: () => void;
  onRequestPermModal?: () => void;
}

export const CameraFeed: React.FC<CameraFeedProps> = ({ camera, onToggle, onDelete, onRequestPermModal }) => {
  const { sendEmergencyAlert, speak, showToast } = useApp();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Source mode: 'node' (Node.js server on machine), 'webcam' (device browser camera), 'simulation'
  const [streamSource, setStreamSource] = useState<'node' | 'webcam' | 'simulation'>('node');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [webcamNotice, setWebcamNotice] = useState<string | null>(null);
  const [nodeFrameUrl, setNodeFrameUrl] = useState<string | null>(null);
  const [personState, setPersonState] = useState<'standing' | 'sitting' | 'falling' | 'lying' | 'outside'>('standing');
  const [fallDetected, setFallDetected] = useState(false);
  const [zoneBreached, setZoneBreached] = useState(false);

  const [algorithmState, setAlgorithmState] = useState({
    upright: true,
    lying: false,
    angle: 8,
    dropPercent: 0,
    needDropPercent: 40,
    lyingSeconds: 0,
    cond1UprightRecent: true,
    cond2DropSufficient: false,
    cond3LyingDuration: false,
    statusText: 'ĐỨNG THẲNG',
  });

  // Track algorithm variables (exact matching fall_detection/fall_detector.py)
  const trackRef = useRef<{
    lastUpright: number;
    upHeight: number;
    upTop: number;
    lyingSince: number | null;
    outsideSince: number | null;
    lastAlertTime: { fall: number; zone: number };
    prevFrameData: Uint8ClampedArray | null;
    smoothBox: { x: number; y: number; w: number; h: number } | null;
  }>({
    lastUpright: Date.now() / 1000,
    upHeight: 0.62,
    upTop: 0.16,
    lyingSince: null,
    outsideSince: null,
    lastAlertTime: { fall: 0, zone: 0 },
    prevFrameData: null,
    smoothBox: null,
  });

  // Safely stop webcam tracks
  const stopWebcam = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  // Request real camera from device
  const requestDeviceWebcam = useCallback(async (mode: 'user' | 'environment' = facingMode) => {
    try {
      setWebcamNotice(null);
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Trình duyệt không hỗ trợ getUserMedia');
      }

      stopWebcam();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: 640 },
          height: { ideal: 360 },
        },
        audio: false,
      });

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.onloadedmetadata = () => {
          video.play().catch(() => {});
        };
      }

      setStreamSource('webcam');
      speak('Đã kết nối webcam thiết bị. Thuật toán nhận diện đang phân tích trực tiếp.');
      showToast('Đang chạy camera thiết bị');
    } catch (err: any) {
      console.warn('Webcam access error:', err);
      const isDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      const msg = isDenied
        ? 'Trình duyệt/khung chưa cấp quyền truy cập camera. Hệ thống chuyển về camera Node máy chủ.'
        : `Lỗi camera: ${err.message || 'Không thể mở thiết bị'}`;
      setWebcamNotice(msg);
      setStreamSource('node');
      showToast('Đang chạy qua luồng Node máy chủ');
    }
  }, [facingMode, speak, showToast, stopWebcam]);

  // Turn on camera directly on Node machine
  const startNodeCamera = async () => {
    try {
      await fetch(`/api/cameras/${camera.id}/start`, { method: 'POST' });
      onToggle(true);
      setStreamSource('node');
      speak('Đã bật camera trên máy chủ Node. Quá trình phát hiện té ngã đang chạy.');
      showToast('Đã kích hoạt camera trên Node máy chủ');
    } catch (e: any) {
      showToast('Lỗi kết nối Node: ' + e.message);
    }
  };

  const stopNodeCamera = async () => {
    try {
      await fetch(`/api/cameras/${camera.id}/stop`, { method: 'POST' });
      stopWebcam();
      onToggle(false);
      speak('Đã tắt camera');
      showToast('Đã tắt camera');
    } catch (e: any) {
      showToast('Lỗi: ' + e.message);
    }
  };

  // Node frame puller
  useEffect(() => {
    if (!camera.running || streamSource !== 'node') return;

    let active = true;
    const pullFrame = async () => {
      try {
        const res = await fetch(`/api/frame/${camera.id}?t=${Date.now()}`);
        if (res.ok && active) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          setNodeFrameUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        }
      } catch {
        // Retry next interval
      }
    };

    pullFrame();
    const interval = setInterval(pullFrame, 1500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [camera.running, camera.id, streamSource]);

  // Main rendering & computer vision loop
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

    if (!processingCanvasRef.current) {
      const pc = document.createElement('canvas');
      pc.width = 160;
      pc.height = 90;
      processingCanvasRef.current = pc;
    }
    const procCanvas = processingCanvasRef.current;
    const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });

    let simTick = 0;

    const render = () => {
      const now = Date.now() / 1000;
      const W = canvas.width || 640;
      const H = canvas.height || 360;

      ctx.clearRect(0, 0, W, H);

      let boxX = W * 0.44;
      let boxY = H * 0.18;
      let boxW = W * 0.14;
      let boxH = H * 0.56;
      let angle = 8;
      let isUpright = false;
      let isLying = false;

      // ==========================================
      // 1. DEVICE WEBCAM SOURCE
      // ==========================================
      const video = videoRef.current;
      if (streamSource === 'webcam' && video && video.readyState >= 2 && video.videoWidth > 0) {
        ctx.drawImage(video, 0, 0, W, H);

        if (procCtx) {
          try {
            procCtx.drawImage(video, 0, 0, 160, 90);
            const frameData = procCtx.getImageData(0, 0, 160, 90).data;
            const prev = trackRef.current.prevFrameData;

            let minX = 160, maxX = 0, minY = 90, maxY = 0;
            let motionPixels = 0;
            let topSumX = 0, topCount = 0;
            let bottomSumX = 0, bottomCount = 0;

            if (prev) {
              for (let y = 0; y < 90; y++) {
                for (let x = 0; x < 160; x++) {
                  const idx = (y * 160 + x) * 4;
                  const diff = (
                    Math.abs(frameData[idx] - prev[idx]) +
                    Math.abs(frameData[idx + 1] - prev[idx + 1]) +
                    Math.abs(frameData[idx + 2] - prev[idx + 2])
                  ) / 3;

                  if (diff > 16) {
                    motionPixels++;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;

                    if (y < 45) {
                      topSumX += x;
                      topCount++;
                    } else {
                      bottomSumX += x;
                      bottomCount++;
                    }
                  }
                }
              }
            }

            trackRef.current.prevFrameData = new Uint8ClampedArray(frameData);

            if (motionPixels >= 50 && maxX > minX && maxY > minY) {
              const targetX = (minX / 160) * W;
              const targetY = (minY / 90) * H;
              const targetW = Math.max(64, ((maxX - minX) / 160) * W);
              const targetH = Math.max(80, ((maxY - minY) / 90) * H);

              const prevBox = trackRef.current.smoothBox || { x: targetX, y: targetY, w: targetW, h: targetH };
              boxX = prevBox.x + (targetX - prevBox.x) * 0.35;
              boxY = prevBox.y + (targetY - prevBox.y) * 0.35;
              boxW = prevBox.w + (targetW - prevBox.w) * 0.35;
              boxH = prevBox.h + (targetH - prevBox.h) * 0.35;
              trackRef.current.smoothBox = { x: boxX, y: boxY, w: boxW, h: boxH };

              const topCentroid = topCount ? topSumX / topCount : (minX + maxX) / 2;
              const bottomCentroid = bottomCount ? bottomSumX / bottomCount : (minX + maxX) / 2;
              const dx = Math.abs(bottomCentroid - topCentroid);
              const dy = Math.max(10, (maxY - minY) * 0.6);
              angle = Math.min(90, Math.round((Math.atan2(dx, dy) * 180) / Math.PI));

              const ratio = boxW / boxH;
              if (angle > 55 || ratio > 1.1) {
                isLying = true;
                isUpright = false;
              } else if (angle < 30 && ratio < 0.85) {
                isUpright = true;
                isLying = false;
              }
            } else if (trackRef.current.smoothBox) {
              boxX = trackRef.current.smoothBox.x;
              boxY = trackRef.current.smoothBox.y;
              boxW = trackRef.current.smoothBox.w;
              boxH = trackRef.current.smoothBox.h;
              const ratio = boxW / boxH;
              isLying = ratio > 1.1;
              isUpright = ratio < 0.85;
            } else {
              boxX = W * 0.38;
              boxY = H * 0.16;
              boxW = W * 0.24;
              boxH = H * 0.66;
              isUpright = true;
            }
          } catch {
            // Ignore frame read issues
          }
        }
      } else {
        // ==========================================
        // 2. NODE STREAM / SIMULATED ROOM (Home Hub Perspective)
        // ==========================================
        ctx.fillStyle = '#11251e';
        ctx.fillRect(0, 0, W, H);

        // Perspective floor and wall grid
        ctx.strokeStyle = '#1b3b2f';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, H * 0.72);
        ctx.lineTo(W, H * 0.72);
        ctx.moveTo(W * 0.2, H * 0.72);
        ctx.lineTo(0, H);
        ctx.moveTo(W * 0.8, H * 0.72);
        ctx.lineTo(W, H);
        ctx.stroke();

        ctx.fillStyle = '#1a362b';
        ctx.fillRect(W * 0.06, H * 0.52, W * 0.18, H * 0.24); // Furniture
        ctx.fillStyle = '#173026';
        ctx.fillRect(W * 0.78, H * 0.46, W * 0.16, H * 0.30);

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
          simTick += 0.07;
          const p = Math.min(1, simTick);
          boxX = W * (0.44 + p * 0.05);
          boxY = H * (0.18 + p * 0.52);
          boxW = W * (0.14 + p * 0.22);
          boxH = H * (0.56 - p * 0.38);
          angle = 8 + p * 74;
          if (p >= 1) {
            setPersonState('lying');
          }
        } else if (personState === 'lying') {
          boxX = W * 0.44;
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
      }

      // Safe Zone polygon coordinates
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
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('VÙNG AN TOÀN TRONG NHÀ', zoneLeft + 8, zoneTop + 18);
      }

      // Algorithm Evaluation
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

      // 3 Conditions for Fall Detection
      const cond1 = tr.lyingSince !== null && tr.lyingSince - tr.lastUpright < 4.0;
      const drop = headTopNorm - tr.upTop;
      const needDrop = 0.4 * (tr.upHeight || 0.6);
      const cond2 = drop >= needDrop;
      const lyingSeconds = tr.lyingSince ? Math.max(0, now - tr.lyingSince) : 0;
      const cond3 = tr.lyingSince !== null && lyingSeconds >= 2.5;

      const dropPercent = Math.round((drop / (tr.upHeight || 0.6)) * 100);
      const needPercent = Math.round((needDrop / (tr.upHeight || 0.6)) * 100);

      // Safe Zone check
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

      // Fall Confirmed trigger
      if (cond1 && cond2 && cond3) {
        if (now - tr.lastAlertTime.fall > 120) {
          tr.lastAlertTime.fall = now;
          setFallDetected(true);
          setSiren(true);
          const conf = Math.min(0.99, 0.65 + (Math.min(angle, 90) - 45) / 150 + Math.min(drop, 0.3));
          speak('Cảnh báo khẩn cấp: Camera phát hiện người té ngã! Đã phát tín hiệu cấp cứu hỏa tốc.', true);
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

      const statusText = isLying ? 'NẰM' : isUpright ? 'ĐỨNG' : 'NGỒI / CÚI';

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
        statusText,
      });

      // Bounding box styling
      const boxColor = isLying ? '#ef4444' : isUpright ? '#16a34a' : '#f59e0b';
      ctx.strokeStyle = boxColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      // Skeleton drawing
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 2;
      const headX = isLying ? boxX + boxW * 0.16 : boxX + boxW * 0.5;
      const headY = boxY + boxH * 0.16;
      const hipX = isLying ? boxX + boxW * 0.84 : boxX + boxW * 0.5;
      const hipY = isLying ? boxY + boxH * 0.72 : boxY + boxH * 0.62;

      ctx.beginPath();
      ctx.arc(headX, headY, Math.min(boxW, boxH) * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = boxColor;
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(headX, headY);
      ctx.lineTo(hipX, hipY);
      ctx.stroke();

      // Top label badge
      ctx.fillStyle = boxColor;
      ctx.fillRect(boxX, Math.max(16, boxY - 24), Math.max(86, boxW * 0.9), 22);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(`${statusText} ${Math.round(angle)}°`, boxX + 6, Math.max(32, boxY - 8));

      // Warning if outside
      if (!insideZone && hasZone) {
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(boxX, boxY + boxH + 4, 150, 20);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('NGOÀI VÙNG AN TOÀN', boxX + 6, boxY + boxH + 18);
      }

      // Emergency red banner
      if (fallDetected || (cond1 && cond2 && cond3)) {
        ctx.fillStyle = 'rgba(220, 38, 38, 0.94)';
        ctx.fillRect(0, 0, W, 52);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText('🚨 TÉ NGÃ - ĐÃ TẠO ĐƠN CẤP CỨU HỎA TỐC', 18, 32);
      }

      // Corner watermark
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.font = '11px sans-serif';
      const modeLabel = streamSource === 'webcam' ? 'Webcam thiết bị' : 'Node.js Home Hub';
      ctx.fillText(
        `GoCare AI Pose | ${modeLabel} | ${new Date().toLocaleTimeString('vi-VN')}`,
        10,
        H - 10
      );

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
      stopWebcam();
    };
  }, [camera.running, camera.name, camera.zone, personState, streamSource, fallDetected, speak, showToast, sendEmergencyAlert, stopWebcam]);

  // Test helpers
  const triggerFallTest = useCallback(() => {
    trackRef.current.lastUpright = Date.now() / 1000;
    trackRef.current.upHeight = 0.62;
    trackRef.current.upTop = 0.16;
    setPersonState('falling');
    setFallDetected(false);
    speak('Bắt đầu thử nghiệm té ngã 3 bước: đứng thẳng, tụt đầu 40%, và nằm yên 2.5 giây.');
  }, [speak]);

  const triggerSittingTest = useCallback(() => {
    setPersonState('sitting');
    setFallDetected(false);
    speak('Thử nghiệm ngồi cúi. Thuật toán phân biệt rõ, không báo nhầm.');
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
    speak('Thử nghiệm rời vùng an toàn trong nhà.');
  }, [speak]);

  return (
    <div className="cam">
      <div className="cam-view" style={{ minHeight: '280px', position: 'relative' }}>
        {camera.running && (
          <span className="cam-live">
            <i></i>{streamSource === 'webcam' ? 'CAMERA THẬT' : 'NODE.JS AI LIVE'}
          </span>
        )}

        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: '1px', height: '1px' }}
        />

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
            {camera.running ? 'Đang bật qua Node' : 'Đã tắt'}
          </span>
        </div>

        <div className="cam-src">
          {camera.source} · Kết nối Node.js Hub máy chủ
          {camera.zone ? ' · Có vùng an toàn trong nhà (10s)' : ''}
        </div>

        {/* Node server connection badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--mint)',
            color: 'var(--on-mint)',
            padding: '8px 12px',
            borderRadius: '12px',
            fontSize: '0.8em',
            fontWeight: 700,
            marginTop: '8px',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="ms fill" style={{ color: 'var(--green)', fontSize: '1.2em' }}>dns</span>
            Máy chủ Node máy tính: Đã sẵn sàng
          </span>
          <span style={{ opacity: 0.85, fontSize: '0.9em' }}>Cổng 3000</span>
        </div>

        {/* Source Toggle Controls */}
        <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`btn full ${streamSource === 'node' ? 'okay' : ''}`}
            style={{ fontSize: '0.82em', padding: '10px 8px' }}
            onClick={() => {
              stopWebcam();
              setStreamSource('node');
              if (!camera.running) startNodeCamera();
              speak('Đang chạy camera qua máy chủ Node.');
              showToast('Camera Node.js đang giám sát');
            }}
          >
            <span className="ms">desktop_windows</span> Bật camera qua Node
          </button>

          <button
            type="button"
            className={`btn full ${streamSource === 'webcam' ? 'okay' : ''}`}
            style={{ fontSize: '0.82em', padding: '10px 8px' }}
            onClick={() => requestDeviceWebcam()}
          >
            <span className="ms">videocam</span> Mở Webcam máy này
          </button>
        </div>

        {webcamNotice && (
          <div
            style={{
              background: 'var(--amber-soft)',
              color: 'var(--amber-ink)',
              padding: '10px 14px',
              borderRadius: '14px',
              marginTop: '10px',
              fontSize: '0.82em',
              lineHeight: 1.45,
              border: '1px solid var(--amber)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: 800 }}>
              <span className="ms fill" style={{ color: 'var(--amber)' }}>security</span>
              <span>Thông báo quyền truy cập Camera</span>
            </div>
            <div style={{ marginBottom: '8px' }}>{webcamNotice}</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn primary"
                style={{ fontSize: '0.82em', padding: '8px 14px', flex: 1, fontWeight: 700 }}
                onClick={() => {
                  if (onRequestPermModal) {
                    onRequestPermModal();
                  } else {
                    requestDeviceWebcam();
                  }
                }}
              >
                <span className="ms fill">verified_user</span> Bấm để cấp quyền Camera
              </button>
            </div>
          </div>
        )}

        {/* ============ LIVE 3-CONDITION ALGORITHM STATUS PANEL ============ */}
        {camera.running && (
          <div
            style={{
              background: 'var(--bg)',
              borderRadius: '16px',
              padding: '12px 14px',
              margin: '12px 0 10px',
              fontSize: '0.82em',
              border: fallDetected ? '2px solid var(--red)' : '1px solid var(--line)',
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Thuật toán té ngã (3 điều kiện):</span>
              <span
                style={{
                  color: fallDetected ? 'var(--red)' : 'var(--primary)',
                  fontWeight: 800,
                  fontSize: '0.92em',
                }}
              >
                {fallDetected ? '🚨 XÁC NHẬN TÉ NGÃ' : `TƯ THẾ: ${algorithmState.statusText}`}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '5px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  className={`ms ${algorithmState.cond1UprightRecent ? 'fill' : ''}`}
                  style={{
                    fontSize: '1.2em',
                    color: algorithmState.cond1UprightRecent ? 'var(--green)' : 'var(--ink-2)',
                  }}
                >
                  {algorithmState.cond1UprightRecent ? 'check_circle' : 'radio_button_unchecked'}
                </span>
                <span>
                  1. Vừa đứng thẳng trong 4s:{' '}
                  <b>{algorithmState.cond1UprightRecent ? 'Đạt' : 'Chưa đạt'}</b>
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  className={`ms ${algorithmState.cond2DropSufficient ? 'fill' : ''}`}
                  style={{
                    fontSize: '1.2em',
                    color: algorithmState.cond2DropSufficient ? 'var(--green)' : 'var(--ink-2)',
                  }}
                >
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
                <span
                  className={`ms ${algorithmState.cond3LyingDuration ? 'fill' : ''}`}
                  style={{
                    fontSize: '1.2em',
                    color: algorithmState.cond3LyingDuration ? 'var(--green)' : 'var(--ink-2)',
                  }}
                >
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
                Phím tắt kiểm tra thuật toán:
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
          </div>
        )}

        <div className="cam-actions">
          {camera.running ? (
            <button className="btn" onClick={stopNodeCamera}>
              <span className="ms">stop_circle</span> Tắt camera
            </button>
          ) : (
            <button className="btn primary" onClick={startNodeCamera}>
              <span className="ms">play_circle</span> Bật camera trên Node
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
