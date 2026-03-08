#!/usr/bin/env python3
"""Local speech-to-text server using mlx-audio."""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

from mlx_audio.stt import load


MODEL = os.environ.get("STT_MODEL", "mlx-community/Qwen3-ASR-0.6B-4bit")
PORT = int(os.environ.get("STT_PORT", "8765"))

print(f"Loading STT model {MODEL}...", flush=True)
MODEL_INSTANCE = load(MODEL)
print("STT model ready.", flush=True)


def extract_text(result):
    if hasattr(result, "text"):
        return result.text.strip()
    if isinstance(result, dict):
        return str(result.get("text", "")).strip()
    return str(result).strip()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path == "/health":
            self._json_response(200, {"status": "ok", "model": MODEL})
        else:
            self._json_response(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/transcribe":
            self._json_response(404, {"error": "not found"})
            return

        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            kwargs = {}
            if body.get("language"):
                kwargs["language"] = body["language"]
            result = MODEL_INSTANCE.generate(body["audio_path"], **kwargs)
            self._json_response(200, {"text": extract_text(result)})
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
    print(f"STT server listening on http://127.0.0.1:{PORT}", flush=True)
    server.serve_forever()
