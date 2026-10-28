"""GoCare — giọng đọc tiếng Việt chạy ngay trên máy (Piper TTS, giọng nữ vi_VN-vais1000).

Bridge chạy file này một lần, giữ giọng trong bộ nhớ, rồi gửi từng câu qua stdin:
  {"id": "...", "text": "...", "out": "đường/dẫn.wav", "speed": 0.85}
và nhận lại qua stdout:
  {"id": "...", "ok": true}  hoặc  {"id": "...", "ok": false, "error": "..."}
"""
import json
import sys
import wave

from piper import PiperVoice

try:
    from piper import SynthesisConfig
except ImportError:  # piper-tts cũ
    SynthesisConfig = None

model = sys.argv[1]
voice = PiperVoice.load(model)
print(json.dumps({"ready": True}), flush=True)

for line in sys.stdin:
    try:
        req = json.loads(line)
    except json.JSONDecodeError:
        continue
    try:
        speed = float(req.get("speed") or 0.85)
        # length_scale > 1 = đọc chậm hơn; thêm chút biến thiên để giọng mềm, tự nhiên
        length_scale = max(0.7, min(1.6, 1.0 / speed))
        with wave.open(req["out"], "wb") as wf:
            if SynthesisConfig is not None:
                cfg = SynthesisConfig(length_scale=length_scale, noise_scale=0.6, noise_w_scale=0.8, volume=0.95)
                voice.synthesize_wav(req["text"], wf, syn_config=cfg)
            else:
                voice.synthesize(req["text"], wf, length_scale=length_scale)
        print(json.dumps({"id": req.get("id"), "ok": True}), flush=True)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"id": req.get("id"), "ok": False, "error": str(e)}), flush=True)
