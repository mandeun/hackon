"""검사용 임시 서버 — 개발용 DB 를 건드리지 않는다. (라켓온 checklib.py 를 그대로 옮겼다)

검사가 `data/hackon.db` 위에서 돌면 실행할 때마다 대회·팀이 쌓여서, 몇 번째 실행이냐에
따라 결과가 달라진다. 초록불이 코드가 아니라 DB 상태를 말하게 된다.

그래서 검사는 **자기 서버를 빈 DB 로 띄우고 끝나면 지운다.** 쓰는 쪽은 한 줄이면 된다:

    import checklib
    BASE = checklib.start()

`HACKON.bat` 으로 켜 둔 서버가 있어도 그쪽은 쓰지 않는다. 포트도 따로 잡는다.
"""
import atexit
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))


def _free_port():
    """빈 포트를 커널한테 받아 온다. 8788 을 쓰면 켜 둔 서버와 부딪친다."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start(timeout=30):
    """빈 DB 로 서버를 띄우고 base URL 을 돌려준다. 끝나면 알아서 정리한다."""
    port = _free_port()
    tmp = tempfile.mkdtemp(prefix="hackon-check-")
    env = {**os.environ, "PORT": str(port), "DB": os.path.join(tmp, "check.db")}
    log = open(os.path.join(tmp, "server.log"), "w+", encoding="utf-8")
    proc = subprocess.Popen([shutil.which("node") or "node", "server.js"],
                            cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"

    def cleanup():
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        log.close()
        shutil.rmtree(tmp, ignore_errors=True)

    atexit.register(cleanup)

    # 뜰 때까지 기다린다. 죽었으면 서버 로그를 그대로 보여 준다 — 안 그러면
    # "연결 거부"만 보이고 진짜 이유(포트 충돌·문법 오류)가 묻힌다.
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            log.seek(0)
            sys.exit(f"검사용 서버가 뜨자마자 죽었다 (종료 코드 {proc.returncode}):\n{log.read()}")
        try:
            with urllib.request.urlopen(base + "/api/health", timeout=1):
                return base
        except (urllib.error.URLError, ConnectionError, OSError):
            time.sleep(0.2)
    cleanup()
    sys.exit(f"검사용 서버가 {timeout}초 안에 안 떴다")
