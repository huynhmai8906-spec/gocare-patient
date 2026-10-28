"""GoCare — Camera chống té ngã & vùng an toàn trong nhà (Ultralytics YOLOv8).

Hai cách phát hiện té ngã, có thể dùng cùng lúc:
  1. Tư thế (mặc định, chạy ngay): YOLOv8-pose lấy khung xương người, nhận ra
     người đang đứng/ngồi mà đổ xuống tư thế nằm và nằm yên vài giây.
  2. Model té ngã riêng (--fall-weights): như repo alijawad07/fall_detection_yolov8,
     một model YOLOv8 huấn luyện trên bộ dữ liệu té ngã Roboflow có lớp "Fall".

Khi xác nhận té ngã → gửi ảnh + thông tin tới GoCare Bridge → bridge tạo đơn cấp cứu
HỎA TỐC trên Web Quản Lý GoCare ngay lập tức.

Vùng an toàn trong nhà (--zone): đa giác trên khung hình camera; người rời khỏi
vùng quá --zone-seconds giây → báo động.

Ví dụ:
  python fall_detector.py --source 0 --bridge http://localhost:8787 --token MA_KET_NOI --patient "Bà Mai" --show
  python fall_detector.py --source rtsp://user:pass@192.168.1.20:554/stream1 --zone "0.05,0.1;0.95,0.1;0.95,0.95;0.05,0.95"
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import threading
import time
import urllib.request
from collections import deque
from dataclasses import dataclass, field

import cv2
import numpy as np
from ultralytics import YOLO

# Chỉ số khớp theo chuẩn COCO-pose
L_SHOULDER, R_SHOULDER, L_HIP, R_HIP = 5, 6, 11, 12


def parse_args():
    p = argparse.ArgumentParser(description="GoCare camera chống té ngã (YOLOv8)")
    p.add_argument("--source", default="0", help="0 = webcam; hoặc link RTSP/HTTP của camera IP; hoặc file video")
    p.add_argument("--bridge", default="http://localhost:8787", help="Địa chỉ GoCare Bridge")
    p.add_argument("--token", default="", help="Mã kết nối (API_TOKEN trong bridge/.env)")
    p.add_argument("--patient", default="", help="Tên bệnh nhân hiển thị trên đơn cấp cứu")
    p.add_argument("--phone", default="", help="SĐT bệnh nhân / người thân")
    p.add_argument("--address", default="", help="Địa chỉ nhà để xe cấp cứu tới")
    p.add_argument("--camera-id", default="camera-phong-khach", help="Tên camera (vd: camera-phong-ngu)")
    p.add_argument("--pose-model", default="yolov8n-pose.pt", help="Model tư thế Ultralytics (tự tải lần đầu)")
    p.add_argument("--fall-weights", default="", help="(Tuỳ chọn) model té ngã riêng có lớp 'Fall'")
    p.add_argument("--fall-conf", type=float, default=0.5, help="Ngưỡng tin cậy cho model té ngã riêng")
    p.add_argument("--confirm-seconds", type=float, default=2.5, help="Phải nằm yên bao lâu mới xác nhận té ngã")
    p.add_argument("--cooldown", type=float, default=120, help="Không gửi lặp cùng loại cảnh báo trong N giây")
    p.add_argument("--zone", default="", help="Vùng an toàn: 'x1,y1;x2,y2;...' theo tỉ lệ 0..1 của khung hình")
    p.add_argument("--zone-seconds", type=float, default=10, help="Rời vùng an toàn bao lâu thì báo động")
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--device", default=None, help="cpu, 0 (GPU)…")
    p.add_argument("--show", action="store_true", help="Hiện cửa sổ xem camera (bấm q để thoát)")
    p.add_argument("--save-video", default="", help="(Tuỳ chọn) lưu video có khung nhận diện ra file .mp4")
    p.add_argument("--debug", action="store_true", help="In trạng thái tư thế từng người mỗi khung hình")
    p.add_argument("--frame-every", type=float, default=0,
                   help="Gửi khung hình trực tiếp (có khung nhận diện) về bridge mỗi N giây để xem trong app; 0 = tắt")
    return p.parse_args()


# ---------------------------------------------------------------- Gửi tới bridge

class Bridge:
    """Gửi cảnh báo trong luồng nền; mất mạng thì giữ lại và gửi lại."""

    def __init__(self, base: str, token: str, camera_id: str, info: dict):
        self.base = base.rstrip("/")
        self.token = token
        self.camera_id = camera_id
        self.info = info
        self.queue: deque[dict] = deque(maxlen=50)
        self.lock = threading.Lock()
        self.live_jpeg: bytes | None = None  # khung hình trực tiếp mới nhất chờ gửi
        threading.Thread(target=self._loop, daemon=True).start()
        threading.Thread(target=self._live_loop, daemon=True).start()

    def _post(self, path: str, body: dict, timeout=10):
        req = urllib.request.Request(
            self.base + path,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", **({"x-api-key": self.token} if self.token else {})},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8") or "{}")

    def emergency(self, kind: str, note: str, confidence: float, frame: np.ndarray | None):
        body = {
            "type": kind, "source": "camera", "camera": self.camera_id, "note": f"[{self.camera_id}] {note}",
            "confidence": round(float(confidence), 3), **self.info,
        }
        if frame is not None:
            small = cv2.resize(frame, (min(960, frame.shape[1]), int(frame.shape[0] * min(960, frame.shape[1]) / frame.shape[1])))
            ok, jpg = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if ok:
                body["snapshot"] = base64.b64encode(jpg.tobytes()).decode("ascii")
        with self.lock:
            self.queue.append(body)

    def live(self, frame: np.ndarray):
        """Lưu khung hình mới nhất (thu nhỏ) để luồng nền gửi cho app xem trực tiếp."""
        w = min(640, frame.shape[1])
        small = cv2.resize(frame, (w, int(frame.shape[0] * w / frame.shape[1])))
        ok, jpg = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 65])
        if ok:
            self.live_jpeg = jpg.tobytes()

    def _live_loop(self):
        # Luồng riêng để khung hình trực tiếp không làm chậm việc gửi cảnh báo cấp cứu
        while True:
            jpeg, self.live_jpeg = self.live_jpeg, None
            if jpeg:
                try:
                    self._post("/api/frame", {"camera": self.camera_id, "jpeg": base64.b64encode(jpeg).decode("ascii")}, timeout=5)
                except Exception:  # noqa: BLE001 — bridge tắt: bỏ qua khung này
                    pass
            time.sleep(0.2)

    def _loop(self):
        last_beat = 0.0
        while True:
            with self.lock:
                item = self.queue[0] if self.queue else None
            if item:
                try:
                    res = self._post("/api/emergency", item)
                    a = res.get("alert", {})
                    print(f"[BRIDGE] Đã gửi {item['type']}: synced={a.get('synced')} id={a.get('id', '')[:8]}")
                    with self.lock:
                        self.queue.popleft()
                    continue
                except Exception as e:  # noqa: BLE001 — mất mạng / bridge tắt: thử lại
                    print(f"[BRIDGE] Chưa gửi được ({e}); thử lại sau 5 giây")
                    time.sleep(5)
                    continue
            if time.time() - last_beat > 30:
                try:
                    self._post("/api/heartbeat", {"camera": self.camera_id, "status": "watching",
                                                  "patientName": self.info.get("patientName", "")}, timeout=5)
                except Exception:  # noqa: BLE001
                    pass
                last_beat = time.time()
            time.sleep(0.5)


# ---------------------------------------------------------------- Nhận diện tư thế

@dataclass
class Track:
    history: deque = field(default_factory=lambda: deque(maxlen=90))  # (t, hip_y_norm, upright)
    lying_since: float | None = None
    last_upright: float = 0.0
    up_height: float = 0.0  # chiều cao người (tỉ lệ khung hình) lúc đứng thẳng gần nhất
    up_top: float | None = None  # mép trên khung người (đỉnh đầu, tỉ lệ khung hình) lúc đứng thẳng gần nhất
    outside_since: float | None = None
    last_seen: float = 0.0


def posture(kpts: np.ndarray, conf: np.ndarray, box: np.ndarray):
    """Trả về (đứng_thẳng, nằm, góc thân, tâm hông). kpts: (17,2), conf: (17,)."""
    x1, y1, x2, y2 = box
    w, h = max(x2 - x1, 1), max(y2 - y1, 1)
    ratio = w / h

    # Người nằm dưới sàn thường bị nhận khớp với độ tin cậy thấp → dùng ngưỡng thấp
    def mid(a, b, th=0.3):
        if conf[a] > th and conf[b] > th:
            return (kpts[a] + kpts[b]) / 2
        if conf[a] > th:
            return kpts[a]
        if conf[b] > th:
            return kpts[b]
        return None

    sh, hip = mid(L_SHOULDER, R_SHOULDER), mid(L_HIP, R_HIP)
    angle = None  # 0° = thân thẳng đứng, 90° = nằm ngang
    if sh is not None and hip is not None:
        dx, dy = hip[0] - sh[0], hip[1] - sh[1]
        angle = math.degrees(math.atan2(abs(dx), abs(dy) + 1e-6))
    else:
        # Không thấy rõ vai/hông: lấy trục dài nhất của cả khung xương (PCA)
        pts = kpts[conf > 0.2]
        if len(pts) >= 5:
            _, vecs = np.linalg.eigh(np.cov((pts - pts.mean(0)).T))
            vx, vy = vecs[:, -1]
            angle = math.degrees(math.atan2(abs(vx), abs(vy) + 1e-6))

    if angle is not None:
        lying = angle > 60 or (angle > 45 and ratio > 1.0)
        upright = angle < 30 and ratio < 0.9
    else:
        lying = ratio > 1.15
        upright = ratio < 0.7
    center = hip if hip is not None else np.array([(x1 + x2) / 2, y2])
    return upright, lying, angle, center


def point_in_zone(pt, zone_px) -> bool:
    if zone_px is None:
        return True
    return cv2.pointPolygonTest(zone_px, (float(pt[0]), float(pt[1])), False) >= 0


def parse_zone(text: str):
    if not text:
        return None
    pts = [tuple(map(float, p.split(","))) for p in text.split(";") if p.strip()]
    if len(pts) < 3:
        raise SystemExit("--zone cần ít nhất 3 điểm, ví dụ '0.1,0.1;0.9,0.1;0.9,0.9;0.1,0.9'")
    return np.array(pts, dtype=np.float32)


# ---------------------------------------------------------------- Chương trình chính

def main():
    args = parse_args()
    source = int(args.source) if args.source.isdigit() else args.source

    print("Đang tải model tư thế:", args.pose_model)
    pose_model = YOLO(args.pose_model)
    fall_model = None
    fall_classes: list[int] = []
    if args.fall_weights:
        print("Đang tải model té ngã riêng:", args.fall_weights)
        fall_model = YOLO(args.fall_weights)
        fall_classes = [i for i, n in fall_model.names.items() if "fall" in str(n).lower() and "not" not in str(n).lower()]
        print("Lớp té ngã:", [fall_model.names[i] for i in fall_classes])

    bridge = Bridge(args.bridge, args.token, args.camera_id,
                    {"patientName": args.patient, "phone": args.phone, "address": args.address})

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise SystemExit(f"Không mở được camera/nguồn video: {args.source}")
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1280
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 720
    zone_norm = parse_zone(args.zone)
    zone_px = (zone_norm * np.array([W, H], dtype=np.float32)).astype(np.int32) if zone_norm is not None else None

    writer = None
    if args.save_video:
        fps = cap.get(cv2.CAP_PROP_FPS) or 15
        writer = cv2.VideoWriter(args.save_video, cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))

    tracks: dict[int, Track] = {}
    draw = args.show or args.save_video or args.frame_every > 0
    last_live = 0.0
    last_sent = {"fall": 0.0, "zone": 0.0}
    fall_model_hits: deque = deque(maxlen=30)
    banner_until, banner_text = 0.0, ""
    print(f"Bắt đầu canh chừng [{args.camera_id}] {W}x{H}. Bấm Ctrl+C (hoặc q trên cửa sổ) để dừng.")

    while True:
        ok, frame = cap.read()
        if not ok:
            if isinstance(source, str) and not source.startswith(("rtsp", "http")):
                break  # hết file video
            print("Mất tín hiệu camera, thử kết nối lại…")
            time.sleep(2)
            cap.release()
            cap = cv2.VideoCapture(source)
            continue

        now = time.time()
        H, W = frame.shape[:2]
        if zone_norm is not None:
            zone_px = (zone_norm * np.array([W, H], dtype=np.float32)).astype(np.int32)

        res = pose_model.track(frame, persist=True, imgsz=args.imgsz, device=args.device,
                               classes=[0], conf=0.4, verbose=False)[0]
        alerts: list[tuple[str, str, float]] = []

        if res.boxes is not None and len(res.boxes) and res.keypoints is not None:
            boxes = res.boxes.xyxy.cpu().numpy()
            ids = res.boxes.id.int().cpu().tolist() if res.boxes.id is not None else list(range(len(boxes)))
            kxy = res.keypoints.xy.cpu().numpy()
            kcf = res.keypoints.conf.cpu().numpy() if res.keypoints.conf is not None else np.ones(kxy.shape[:2])

            for tid, box, kp, kc in zip(ids, boxes, kxy, kcf):
                if tid not in tracks:
                    # Lúc ngã, bộ theo dõi hay đổi ID → ID mới kế thừa lịch sử của track vừa thấy gần nhất
                    prev = max((t for t in tracks.values() if now - t.last_seen < 2.0), key=lambda t: t.last_seen, default=None)
                    tracks[tid] = Track(history=deque(prev.history, maxlen=90), last_upright=prev.last_upright,
                                        up_height=prev.up_height, up_top=prev.up_top) if prev else Track()
                tr = tracks[tid]
                tr.last_seen = now
                upright, lying, angle, center = posture(kp, kc, box)
                hip_norm = float(center[1]) / H
                tr.history.append((now, hip_norm, upright))
                if upright:
                    tr.last_upright = now
                    tr.up_height = float(box[3] - box[1]) / H
                    tr.up_top = float(box[1]) / H

                # Té ngã = vừa đứng cách đây <4 giây, ĐỈNH ĐẦU TỤT XUỐNG ≥40% chiều cao người so với lúc đứng,
                # rồi nằm yên ≥ confirm-seconds. Người ngồi cúi về phía trước chỉ hạ đầu một ít → không báo nhầm.
                if lying:
                    tr.lying_since = tr.lying_since or now
                else:
                    tr.lying_since = None
                drop = float(box[1]) / H - tr.up_top if tr.up_top is not None else 0.0
                need_drop = 0.4 * tr.up_height if tr.up_height else 0.2
                fell_from_upright = (tr.lying_since is not None and tr.lying_since - tr.last_upright < 4.0
                                     and drop >= need_drop)
                if args.debug:
                    print(f"#{tid} up={upright} lying={lying} angle={angle} lying_for="
                          f"{(now - tr.lying_since) if tr.lying_since else 0:.1f}s since_upright={now - tr.last_upright:.1f}s "
                          f"drop={drop:.2f}/{need_drop:.2f} fell={fell_from_upright}")
                if (tr.lying_since and fell_from_upright and now - tr.lying_since >= args.confirm_seconds):
                    conf = min(0.99, 0.6 + (min(angle or 60, 90) - 45) / 150 + min(drop, 0.3))
                    pose_txt = f"thân nghiêng {angle:.0f}°" if angle is not None else "nằm ngang dưới sàn"
                    alerts.append(("fall", f"Phát hiện té ngã ({pose_txt}, nằm yên {now - tr.lying_since:.1f}s)", conf))

                # Vùng an toàn trong nhà
                inside = point_in_zone(center, zone_px)
                if zone_px is not None:
                    tr.outside_since = None if inside else (tr.outside_since or now)
                    if tr.outside_since and now - tr.outside_since >= args.zone_seconds:
                        alerts.append(("zone", f"Rời vùng an toàn trong nhà {now - tr.outside_since:.0f}s", 0.9))

                if draw:
                    x1, y1, x2, y2 = map(int, box)
                    color = (0, 0, 255) if lying else (0, 200, 0) if upright else (0, 200, 255)
                    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3)
                    label = "NAM" if lying else "DUNG" if upright else "NGOI/CUI"
                    cv2.putText(frame, f"#{tid} {label}" + (f" {angle:.0f}deg" if angle is not None else ""), (x1, max(20, y1 - 8)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
                    if not inside:
                        cv2.putText(frame, "NGOAI VUNG AN TOAN", (x1, y2 + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)

        # Model té ngã riêng (tuỳ chọn): cần ≥60% số khung gần nhất có "Fall"
        if fall_model is not None:
            fr = fall_model(frame, imgsz=args.imgsz, device=args.device, conf=args.fall_conf, verbose=False)[0]
            hit = 0.0
            for b in fr.boxes:
                if int(b.cls) in fall_classes:
                    hit = max(hit, float(b.conf))
                    if draw:
                        x1, y1, x2, y2 = map(int, b.xyxy[0])
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 3)
                        cv2.putText(frame, f"Fall {hit:.2f}", (x1, y2 + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            fall_model_hits.append((now, hit))
            window = [h for t, h in fall_model_hits if now - t <= args.confirm_seconds]
            if len(window) >= 5 and sum(1 for h in window if h > 0) / len(window) >= 0.6:
                alerts.append(("fall", "Model té ngã YOLOv8 nhận diện 'Fall'", max(window)))

        # Gửi cảnh báo (mỗi loại tối đa 1 lần / cooldown)
        for kind, note, conf in alerts:
            if now - last_sent[kind] < args.cooldown:
                continue
            last_sent[kind] = now
            print(f"[CẢNH BÁO] {kind}: {note} (tin cậy {conf:.0%}) → tạo đơn cấp cứu")
            bridge.emergency(kind, note, conf, frame.copy())
            banner_until, banner_text = now + 8, ("TE NGA - DA BAO CAP CUU" if kind == "fall" else "ROI VUNG AN TOAN - DA BAO")

        # Dọn track đã mất
        for tid in [t for t, tr in tracks.items() if now - tr.last_seen > 10]:
            del tracks[tid]

        if draw:
            if zone_px is not None:
                cv2.polylines(frame, [zone_px], True, (255, 200, 0), 2)
            if now < banner_until and int(now * 3) % 2 == 0:
                overlay = frame.copy()
                cv2.rectangle(overlay, (0, 0), (W, 70), (0, 0, 220), -1)
                frame = cv2.addWeighted(overlay, 0.75, frame, 0.25, 0)
                cv2.putText(frame, banner_text, (20, 48), cv2.FONT_HERSHEY_SIMPLEX, 1.3, (255, 255, 255), 3)
            cv2.putText(frame, f"GoCare | {args.camera_id}", (10, H - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            if args.frame_every > 0 and now - last_live >= args.frame_every:
                last_live = now
                bridge.live(frame)
            if writer:
                writer.write(frame)
            if args.show:
                cv2.imshow("GoCare - Camera chong te nga", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

    cap.release()
    if writer:
        writer.release()
    cv2.destroyAllWindows()
    time.sleep(1)  # cho luồng gửi kịp đẩy cảnh báo cuối


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Đã dừng.")
