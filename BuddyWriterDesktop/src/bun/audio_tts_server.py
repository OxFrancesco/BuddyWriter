#!/usr/bin/env python3
"""Local text-to-speech server using mlx-audio."""
import inspect
import json
import os
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import soundfile as sf
from mlx_audio.tts import load


MODEL = os.environ.get("TTS_MODEL", "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit")
PORT = int(os.environ.get("TTS_PORT", "8766"))
DEFAULT_VOICE = os.environ.get("TTS_DEFAULT_VOICE", "Chelsie")
DEFAULT_LANGUAGE = os.environ.get("TTS_DEFAULT_LANGUAGE", "English")

print(f"Loading TTS model {MODEL}...", flush=True)
MODEL_INSTANCE = load(MODEL)
print("TTS model ready.", flush=True)


def build_generate_kwargs(body):
    kwargs = {
        "voice": body.get("voice") or DEFAULT_VOICE,
        "language": body.get("language") or DEFAULT_LANGUAGE,
        "lang_code": body.get("langCode"),
    }
    signature = inspect.signature(MODEL_INSTANCE.generate)
    return {
        key: value
        for key, value in kwargs.items()
        if value is not None and key in signature.parameters
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path == "/health":
            self._json_response(200, {"status": "ok", "model": MODEL})
        else:
            self._json_response(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/speak":
            self._json_response(404, {"error": "not found"})
            return

        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            chunks = []
            sample_rate = None
            for result in MODEL_INSTANCE.generate(body["text"], **build_generate_kwargs(body)):
                chunks.append(np.array(result.audio))
                sample_rate = sample_rate or result.sample_rate

            if not chunks or sample_rate is None:
                raise ValueError("No audio generated")

            audio = np.concatenate(chunks)
            output_dir = tempfile.mkdtemp(prefix="buddywriter_tts_")
            output_path = os.path.join(output_dir, "speech.wav")
            sf.write(output_path, audio, sample_rate)
            self._json_response(200, {"audioPath": output_path, "sampleRate": sample_rate})
        except Exception as exc:
            self._json_response(500, {"error": str(exc)})

    def _json_response(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"TTS server listening on http://127.0.0.1:{PORT}", flush=True)
    server.serve_forever()
