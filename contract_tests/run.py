"""Run the billing contract tests against the Python and/or Node implementation, each on its own temp database.

    python -m contract_tests.run python
    python -m contract_tests.run node
    python -m contract_tests.run both        # the default: proves the two are interchangeable
"""
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time

import requests

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
NODE_DIR = os.path.join(ROOT, "services", "billing")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def commands(impl: str, port: int):
    """(seed command, server command, working directory) for an implementation."""
    if impl == "python":
        return (
            [sys.executable, "-m", "mock_api.seed"],
            [sys.executable, "-m", "uvicorn", "mock_api.main:app", "--port", str(port)],
            ROOT,
        )
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        raise SystemExit("npm not found: install Node.js 22.13+ to test the Node implementation")
    return ([npm, "run", "seed"], [npm, "run", "serve"], NODE_DIR)


def stop(proc: subprocess.Popen) -> None:
    """Stop a server and everything it spawned (npm starts node, which starts tsx, ...)."""
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    else:
        proc.terminate()
    proc.wait(timeout=15)


def run_one(impl: str) -> int:
    port = free_port()
    db_dir = tempfile.mkdtemp(prefix=f"contract-{impl}-")
    env = {
        **os.environ,
        "BILLING_DB_PATH": os.path.join(db_dir, "billing.db"),
        "PORT": str(port),
        "PYTHONPATH": ROOT,
        # The Node service has two listeners: BILLING_PORT is the internal billing API under test; PORT is the public web
        # server, which is not part of this contract. Give it its own free port so it cannot collide with anything.
        "BILLING_PORT": str(port),
    }
    if impl == "node":
        env["PORT"] = str(free_port())
    seed_cmd, server_cmd, cwd = commands(impl, port)
    print(f"\n=== {impl} implementation on port {port} ===", flush=True)
    try:
        subprocess.run(seed_cmd, cwd=cwd, env=env, check=True, capture_output=True, text=True)
        server = subprocess.Popen(server_cmd, cwd=cwd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(150):  # up to ~30 s: the Node service compiles TypeScript on first start
                try:
                    if requests.get(f"http://127.0.0.1:{port}/subscribers", timeout=1).ok:
                        break
                except requests.RequestException:
                    time.sleep(0.2)
            else:
                print(f"{impl}: the service did not start within 30 s")
                return 1
            result = subprocess.run(
                [sys.executable, "-m", "pytest", "contract_tests", "-q", "-p", "no:cacheprovider"],
                cwd=ROOT, env={**env, "CONTRACT_BASE_URL": f"http://127.0.0.1:{port}"},
            )
            return result.returncode
        finally:
            stop(server)
    finally:
        shutil.rmtree(db_dir, ignore_errors=True)


def main(argv=None) -> int:
    choice = (argv or sys.argv[1:] or ["both"])[0]
    if choice not in {"python", "node", "both"}:
        print(__doc__)
        return 2
    codes = {impl: run_one(impl) for impl in (["python", "node"] if choice == "both" else [choice])}
    print("\n" + ", ".join(f"{impl}: {'PASS' if code == 0 else 'FAIL'}" for impl, code in codes.items()))
    return 1 if any(codes.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
