#!/usr/bin/env python3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import mimetypes


class SpaHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory=None, **kwargs):
        self._root = Path(directory or ".").resolve()
        super().__init__(*args, directory=str(self._root), **kwargs)

    def do_GET(self):
        if self.path.startswith("/api/"):
            self.send_error(404, "No API in static SPA server")
            return

        requested = self.path.split("?", 1)[0].split("#", 1)[0]
        relative = requested.lstrip("/")
        file_path = (self._root / relative).resolve()

        # Sirve archivo real si existe dentro de la carpeta.
        if str(file_path).startswith(str(self._root)) and file_path.exists() and file_path.is_file():
            return super().do_GET()

        # Fallback SPA: cualquier ruta devuelve index.html
        index_path = self._root / "index.html"
        if not index_path.exists():
            self.send_error(500, "index.html not found")
            return

        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type("index.html")[0] or "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(index_path.read_bytes())


def main():
    parser = argparse.ArgumentParser(description="Simple local SPA server with fallback to index.html")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5500)
    parser.add_argument("--dir", default=".")
    args = parser.parse_args()

    with ThreadingHTTPServer((args.host, args.port), lambda *a, **k: SpaHandler(*a, directory=args.dir, **k)) as httpd:
        print(f"SPA server running on http://{args.host}:{args.port}")
        print("Press Ctrl+C to stop.")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
