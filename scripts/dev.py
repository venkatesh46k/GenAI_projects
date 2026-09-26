"""Start the whole console locally with one command, on the ports the docs and the browser QA agent expect.

    python scripts/dev.py                 # billing API :8000, console :8080, AI service :8100
    python scripts/dev.py --build         # build the React console first (needed once, and after front-end changes)
    python scripts/dev.py --reseed        # start from fresh demo data (data/billing.db)

Open http://127.0.0.1:8080. Press Ctrl+C to stop everything. Settings (ACTIVE_PROVIDER and the API keys) come from .env.
The Node server lists the built front-end files when it starts, so restart this script after a front-end build.
"""
import argparse
import os
import secrets
import shutil
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BILLING = os.path.join(ROOT, "services", "billing")
WEB = os.path.join(ROOT, "web")
NPM = shutil.which("npm") or shutil.which("npm.cmd")


def run(command: list[str], cwd: str) -> None:
    if subprocess.call(command, cwd=cwd) != 0:
        sys.exit(f"failed: {' '.join(command)}")


def wait_for(url: str, what: str, seconds: int = 120) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except Exception:
            time.sleep(1)
    print(f"{what} did not come up at {url}")
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--build", action="store_true", help="build the React console first")
    parser.add_argument("--reseed", action="store_true", help="reset the demo database")
    parser.add_argument("--port", type=int, default=8080, help="console port (default 8080)")
    parser.add_argument("--billing-port", type=int, default=8000, help="internal billing API port (default 8000)")
    parser.add_argument("--ai-port", type=int, default=8100, help="AI service port (default 8100)")
    args = parser.parse_args()

    if not NPM:
        sys.exit("npm not found: install Node.js 22.13 or newer")
    if not os.path.isdir(os.path.join(BILLING, "node_modules")):
        run([NPM, "ci"], BILLING)
    if args.build or not os.path.isfile(os.path.join(WEB, "dist", "index.html")):
        if not os.path.isdir(os.path.join(WEB, "node_modules")):
            run([NPM, "ci"], WEB)
        run([NPM, "run", "build"], WEB)
    if args.reseed or not os.path.isfile(os.path.join(ROOT, "data", "billing.db")):
        run([NPM, "run", "seed"], BILLING)

    token = os.getenv("AI_SERVICE_TOKEN") or secrets.token_hex(16)
    env = {
        **os.environ,
        "AI_SERVICE_TOKEN": token,
        "BILLING_PORT": str(args.billing_port),
        "BILLING_API_URL": f"http://127.0.0.1:{args.billing_port}",
        "PORT": str(args.port),
        "AI_SERVICE_URL": f"http://127.0.0.1:{args.ai_port}",
        "RECHARGE_UI_URL": f"http://localhost:{args.port}",  # where browser tests sign in
        "PYTHONPATH": ROOT,
    }
    for port in (args.port, args.billing_port, args.ai_port):
        if _in_use(port):
            sys.exit(f"port {port} is already in use: stop what is running there, or pick another with --port/--billing-port/--ai-port")

    processes = [
        subprocess.Popen([NPM, "run", "serve"], cwd=BILLING, env=env),
        subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "ai_service.main:app", "--port", str(args.ai_port), "--log-level", "warning"],
            cwd=ROOT,
            env=env,
        ),
    ]

    def stop(*_):
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()

    signal.signal(signal.SIGINT, lambda *a: (stop(), sys.exit(0)))
    if wait_for(f"http://127.0.0.1:{args.port}/api/health", "the console", 60):
        print(f"\nConsole:  http://127.0.0.1:{args.port}   (the Copilot needs a minute or two to load its models)", flush=True)
        print("Stop with Ctrl+C.\n", flush=True)
    try:
        while all(process.poll() is None for process in processes):
            time.sleep(1)
        print("A service stopped, shutting the rest down.")
        return 1
    finally:
        stop()


def _in_use(port: int) -> bool:
    import socket

    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


if __name__ == "__main__":
    sys.exit(main())
