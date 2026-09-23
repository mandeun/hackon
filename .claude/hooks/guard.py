#!/usr/bin/env python3
"""PreToolUse 훅 — 이 저장소에서 AI 가 치면 안 되는 명령을 실행 전에 막는다.
오답노트와 기억에서 실제로 당한 것만 넣는다. 막을 땐 종료 코드 2 와 이유 한 줄."""
import sys, json, re
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
cmd = (d.get("tool_input") or {}).get("command", "") or ""
RULES = [
    (r"pkill\s+-f\s+['\"]?node", "pkill -f 는 e2e 가 띄운 검사 서버까지 죽인다 — 포트 PID 로 죽여라 (lsof -ti:PORT)"),
    (r"npx\s+skills\s+add", "npx skills add 는 현재 폴더(.claude/skills)에 깐다 — 저장소 안에서 돌리지 않는다, ~ 에서"),
    (r"git\s+push\s+.*(--force|-f\b)", "force push 금지 — 원격 이력을 지운다"),
    (r"fly\s+deploy(?!.*--remote-only)", "fly deploy 는 --remote-only 로 (로컬 도커 없음) 그리고 검사 초록 뒤에"),
    (r"rm\s+-rf\s+(/|~|\$HOME)(\s|$)", "홈·루트 삭제 금지"),
    (r"(cat|open|echo)\s+.*\.env\b", ".env 는 열지 않는다 — 열쇠는 fly secrets 와 드라이브 열쇠_비공개.md 에만"),
    (r"sqlite3\s+.*hackon\.db.*(DELETE|DROP|UPDATE)", "운영 DB 직접 수정 금지 — API 로, 10/31 대회(1a32b615)는 건드리지 않는다"),
]
for pat, why in RULES:
    if re.search(pat, cmd, re.I):
        print(f"[guard] 막음: {why}", file=sys.stderr); sys.exit(2)
sys.exit(0)
