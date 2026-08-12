#!/usr/bin/env python3
"""Budgie advisor bridge.

Lets the Budgie web app answer advisor questions through YOUR installed
Claude Code, so usage is covered by your existing Claude subscription
(Pro/Max) — no API credits. Nothing is sent anywhere except from your
browser to this script (on your own computer) to Claude.

Run it:            python3 budgie-bridge.py
Then in Budgie:    Advisor → Set up → "Use my Claude subscription" → Connect
Keep this window open while you chat; Ctrl-C to stop.

Requires Claude Code (https://claude.com/claude-code) installed and logged
in — run `claude` once in a terminal to log in if you haven't.

No third-party packages; Python 3.8+ standard library only.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PORT = int(os.environ.get("BUDGIE_BRIDGE_PORT", "8765"))
TIMEOUT_SECS = 300

# Only the Budgie app (and local dev) may use the bridge. Browsers enforce
# this via CORS + the origin check on every request.
#
# STRICT MODE (recommended — Budgie's setup screen shows the exact command):
#   BUDGIE_ORIGIN=https://your-app.vercel.app python3 budgie-bridge.py
# locks the bridge to that one origin (plus localhost for dev).
#
# Without BUDGIE_ORIGIN the bridge falls back to allowing any *.vercel.app
# origin so it works out of the box — but vercel.app is shared public
# hosting, so ANY Vercel-deployed page in your browser could then use your
# Claude subscription through the bridge. Prefer strict mode.
BUDGIE_ORIGIN = os.environ.get("BUDGIE_ORIGIN", "").rstrip("/")


def origin_allowed(origin):
    if not origin:
        return False
    host = (urlparse(origin).hostname or "").lower()
    if host in ("localhost", "127.0.0.1"):
        return True
    if BUDGIE_ORIGIN:
        return origin.rstrip("/") == BUDGIE_ORIGIN
    return host.endswith(".vercel.app")


def find_claude():
    found = shutil.which("claude")
    if found:
        return found
    home = os.path.expanduser("~")
    for c in (
        os.path.join(home, ".local", "bin", "claude"),
        "/usr/local/bin/claude",
        "/opt/homebrew/bin/claude",
    ):
        if os.path.exists(c):
            return c
    return None


CLAUDE = find_claude()
# An empty working directory so the advisor session sees no local files,
# no project config — just the prompt the app sends.
WORKDIR = tempfile.mkdtemp(prefix="budgie-bridge-")


def transcript(messages):
    """Flatten chat history into one prompt; the last user turn is the ask."""
    lines = []
    for m in messages:
        role = "User" if m.get("role") == "user" else "Advisor"
        lines.append(f"{role}: {m.get('content', '')}")
    lines.append(
        "\n(Continue the conversation as the advisor. Reply to the last user "
        "message only — no role prefix.)"
    )
    return "\n\n".join(lines)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"  # close-delimited bodies stream cleanly

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        # Chrome's Private Network Access preflight (public page → localhost)
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path != "/health":
            return self._json(404, {"error": "not found"})
        self._json(200, {"ok": bool(CLAUDE), "bridge": "budgie", "version": 1,
                         "claude": CLAUDE or "not found"})

    def do_POST(self):
        if self.path != "/advice":
            return self._json(404, {"error": "not found"})
        if not origin_allowed(self.headers.get("Origin", "")):
            return self._json(403, {"error": "origin not allowed"})
        if not CLAUDE:
            return self._json(500, {"error": "Claude Code not found — install it from claude.com/claude-code, then restart the bridge"})

        try:
            length = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(length) or b"{}")
            provider = str(req.get("provider", "claude"))
            system = str(req.get("system", ""))
            messages = req.get("messages") or []
            model = str(req.get("model", "opus"))
        except (ValueError, TypeError):
            return self._json(400, {"error": "bad request body"})
        # The protocol carries a provider so other subscription CLIs (codex,
        # gemini, ...) can be driven from this same bridge someday.
        if provider != "claude":
            return self._json(400, {"error": f"This bridge only speaks to Claude Code for now (got provider '{provider}')"})

        cmd = [
            CLAUDE, "-p", transcript(messages),
            "--system-prompt", system,
            "--exclude-dynamic-system-prompt-sections",
            "--output-format", "stream-json",
            "--include-partial-messages", "--verbose",
            "--tools", "WebSearch",
            "--allowedTools", "WebSearch",
            "--model", model,
        ]

        # Stream NDJSON back: {"text": delta}* then {"done": true} or {"error": msg}
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        def emit(obj):
            try:
                self.wfile.write((json.dumps(obj) + "\n").encode())
                self.wfile.flush()
                return True
            except (BrokenPipeError, ConnectionResetError):
                return False  # browser aborted (Stop button) — kill claude

        # stderr goes to a temp file, not a pipe: we only read stdout while
        # claude runs, and an undrained stderr pipe fills up (~64KB) and
        # deadlocks both processes — --verbose makes that a real risk.
        stderr_file = tempfile.TemporaryFile(mode="w+", errors="replace")
        proc = subprocess.Popen(
            cmd, cwd=WORKDIR, stdout=subprocess.PIPE, stderr=stderr_file,
            text=True, errors="replace",
        )
        got_result = False
        try:
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                if ev.get("type") == "stream_event":
                    delta = (ev.get("event") or {}).get("delta") or {}
                    if delta.get("type") == "text_delta" and delta.get("text"):
                        if not emit({"text": delta["text"]}):
                            proc.kill()
                            return
                elif "is_error" in ev:  # final result line
                    got_result = True
                    if ev.get("is_error"):
                        emit({"error": str(ev.get("result") or "Claude Code reported an error")})
                    else:
                        emit({"done": True})
            proc.wait(timeout=TIMEOUT_SECS)
            if not got_result:
                stderr_file.seek(0)
                err = (stderr_file.read() or "").strip()
                emit({"error": (err.splitlines()[-1] if err else "Claude Code exited without a result — is it logged in? Run `claude` once to check.")})
        except subprocess.TimeoutExpired:
            proc.kill()
            emit({"error": "Timed out waiting for Claude Code"})
        finally:
            if proc.poll() is None:
                proc.kill()
            stderr_file.close()

    def log_message(self, fmt, *args):  # quiet: one line per request, no noise
        sys.stderr.write("bridge: %s\n" % (fmt % args))


def main():
    if not CLAUDE:
        print("⚠  Claude Code not found on PATH. Install it from https://claude.com/claude-code")
        print("   and run `claude` once to log in — then restart this bridge.\n")
    else:
        print(f"✓ Using Claude Code at {CLAUDE}")
    print(f"✓ Budgie bridge listening on http://127.0.0.1:{PORT}")
    if BUDGIE_ORIGIN:
        print(f"✓ Locked to {BUDGIE_ORIGIN} (strict mode)")
    else:
        print("⚠  Accepting any *.vercel.app origin. Lock the bridge to YOUR app with:")
        print("   BUDGIE_ORIGIN=https://your-app.vercel.app python3 budgie-bridge.py")
        print("   (Budgie's Advisor setup shows this command with your exact address.)")
    print("  Leave this window open, then click Connect in Budgie's Advisor setup.")
    print("  Press Ctrl-C to stop.")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBridge stopped.")


if __name__ == "__main__":
    main()
