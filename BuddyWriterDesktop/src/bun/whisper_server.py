#!/usr/bin/env python3
"""Local Whisper transcription server using mlx-whisper (Apple Silicon)."""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import mlx_whisper

MODEL = os.environ.get("WHISPER_MODEL", "mlx-community/whisper-turbo")
PORT = int(os.environ.get("WHISPER_PORT", "8765"))

print(f"Loading whisper model {MODEL}...", flush=True)
mlx_whisper.transcribe(
    np.zeros(16000, dtype=np.float32),
    path_or_hf_repo=MODEL,
    verbose=False,
)
print("Whisper model ready.", flush=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path == "/health":
            self._json_response(200, {"status": "ok"})
        else:
            self._json_response(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/transcribe":
            self._json_response(404, {"error": "not found"})
            return

        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            result = mlx_whisper.transcribe(
                body["audio_path"],
                path_or_hf_repo=MODEL,
                language=body.get("language"),
                word_timestamps=False,
                verbose=False,
            )
            self._json_response(200, {
                "text": result["text"].strip(),
                "language": result["language"],
            })
        except Exception as e:
            self._json_response(500, {"error": str(e)})

    def _json_response(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Whisper server listening on http://127.0.0.1:{PORT}", flush=True)
    server.serve_forever()
