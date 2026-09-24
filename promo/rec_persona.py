# HACK:ON 페르소나판 45초 — GLM 채택 대본(BAB 13컷) 그대로, 실제 화면만 녹화.
# 컷마다 새 컨텍스트(= 컷마다 webm 하나) → 나중에 순서대로 잇는다. 상태는 서버(임시 DB)에 쌓인다.
# 이름·약속은 전부 «(예시)» 를 데이터에 굽는다 — 실제 이용자처럼 보이면 거짓이다.
import pathlib, json, urllib.request, datetime, shutil, sys, time
sys.path.insert(0, r"C:\Users\tree0\OneDrive\Desktop\Projects\hackon")
import checklib
from playwright.sync_api import sync_playwright

BASE = checklib.start()
OUT = pathlib.Path(r"C:\Users\tree0\AppData\Local\Temp\hackon_persona")
if OUT.exists(): shutil.rmtree(OUT)
OUT.mkdir(parents=True)
W, H = 540, 960

def call(path, body=None, key=None, tkey=None, method=None):
    h = {"content-type": "application/json"}
    if key: h["x-okey"] = key
    if tkey: h["x-tkey"] = tkey
    r = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                               headers=h, method=method or ("POST" if body is not None else "GET"))
    return json.load(urllib.request.urlopen(r))

state = {"ev": "", "okey": ""}
clips = []   # (이름, 파일)

def scene(name, seed_ls=None):
    """컷 하나를 찍는 문맥 관리자. seed_ls: 열기 전에 넣을 localStorage."""
    class S:
        def __enter__(self):
            self.p = sync_playwright().start()
            self.b = self.p.chromium.launch()
            self.ctx = self.b.new_context(viewport={"width": W, "height": H}, device_scale_factor=2,
                                          record_video_dir=str(OUT), record_video_size={"width": W, "height": H},
                                          locale="ko-KR")
            if seed_ls:
                js = ";".join(f"localStorage.setItem({json.dumps(k)},{json.dumps(v)})" for k, v in seed_ls.items())
                self.ctx.add_init_script(js)
            self.pg = self.ctx.new_page()
            return self.pg
        def __exit__(self, *a):
            path = self.pg.video.path()
            self.ctx.close(); self.b.close(); self.p.stop()
            dst = OUT / f"{name}.webm"
            shutil.move(path, dst); clips.append((name, dst)); print("컷:", name, dst.name)
    return S()

def ready(pg, path):
    pg.goto(f"{BASE}{path}", wait_until="domcontentloaded")
    pg.wait_for_selector("body[data-ready='1']", timeout=10000)

def scroll_to(pg, sel, up=140):
    pg.locator(sel).first.scroll_into_view_if_needed(timeout=8000)
    pg.mouse.wheel(0, -up); pg.wait_for_timeout(250)

d3 = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()

# ── 컷 3 · 선언 — 정하늘(동아리 회장·예시): 대회 이름을 오늘 준다 (4.0초)
with scene("c03_make") as pg:
    ready(pg, "/app"); pg.evaluate("() => localStorage.clear()")
    pg.click('nav button[data-t="make"]'); pg.wait_for_selector("#f-title"); pg.wait_for_timeout(500)
    pg.click("#f-title"); pg.type("#f-title", "우리 동아리 만들기 대회 (예시)", delay=95)
    pg.wait_for_timeout(500); pg.click("#f-save"); pg.wait_for_timeout(1500)
    state["ev"] = pg.evaluate("() => localStorage.getItem('hackon.event')")
    state["okey"] = pg.evaluate("(ev) => localStorage.getItem('hackon.okey.' + ev)", state["ev"])
ev, K = state["ev"], state["okey"]
print("대회:", ev)
call(f"/api/events/{ev}", {"host": "정하늘 (예시)", "starts": d3, "ends": d3, "cap": 20}, key=K, method="PATCH")
HOST_LS = {"hackon.event": ev, f"hackon.okey.{ev}": K}

# ── 컷 4·5 · 큐 — 자리를 먼저 적어 둔다 → «아직 맡겠다는 사람이 없습니다» (3.5 + 2.5초)
with scene("c04_need", HOST_LS) as pg:
    ready(pg, f"/app#{ev}"); pg.wait_for_timeout(600)
    pg.evaluate("() => document.querySelectorAll('#view details').forEach(d => d.open = true)")
    scroll_to(pg, "#n-kind", 90); pg.wait_for_timeout(400)
    pg.select_option("#n-kind", "venue"); pg.dispatch_event("#n-kind", "change"); pg.wait_for_timeout(500)
    pg.click("#n-label"); pg.type("#n-label", "20명이 6시간 쓸 장소", delay=70)
    pg.wait_for_timeout(400); pg.click("#n-add"); pg.wait_for_timeout(1800)
    # 컷 5 — 방금 올린 자리 카드의 «아직 맡겠다는 사람이 없습니다»
    pg.evaluate("() => document.querySelectorAll('#view details').forEach(d => d.open = true)")
    scroll_to(pg, "text=아직 맡겠다는 사람이 없습니다", 260); pg.wait_for_timeout(2600)
# 심사 자리는 화면 밖에서 (컷 7 에 쓴다)
call(f"/api/events/{ev}/needs", {"kind": "judge", "label": "오후에 한 시간, 점수만", "qty": 1}, key=K)
needs = call(f"/api/events/{ev}/needs")
venue = next(n for n in needs if n["kind"] == "venue"); judge = next(n for n in needs if n["kind"] == "judge")

# ── 컷 6 · 집기 — 박서윤(동네 카페·예시): 카페 자리를 사흘 전 준다 (4.5초)
def give(name_, need_id, who, contact):
    with scene(name_) as pg:
        ready(pg, f"/e/{ev}"); pg.wait_for_timeout(500)
        scroll_to(pg, f"[data-give-need='{need_id}']", 200); pg.wait_for_timeout(500)
        pg.click(f"[data-give-need='{need_id}']"); pg.wait_for_selector("#g-name"); pg.wait_for_timeout(500)
        pg.click("#g-name"); pg.type("#g-name", who, delay=80)
        pg.click("#g-contact"); pg.type("#g-contact", contact, delay=45)
        pg.wait_for_timeout(300); pg.click("#g-send"); pg.wait_for_timeout(1700)
give("c06_venue", venue["id"], "박서윤 (예시)", "cafe@example.com")
# ── 컷 7 · 집기 — 이도현(직장인 개발자·예시): 당일 심사 한 시간 (4.0초)
give("c07_judge", judge["id"], "이도현 (예시)", "dev@example.com")

# ── 컷 8 · 확정 — 주최자: «확인 대기» → «확인» (3.5초)
with scene("c08_confirm", HOST_LS) as pg:
    ready(pg, f"/app#{ev}"); pg.wait_for_timeout(600)
    pg.evaluate("() => document.querySelectorAll('#view details').forEach(d => d.open = true)")
    scroll_to(pg, "[data-pledge-status][data-status='ok']", 160); pg.wait_for_timeout(700)
    pg.locator("[data-pledge-status][data-status='ok']").first.click(); pg.wait_for_timeout(1300)
    pg.evaluate("() => document.querySelectorAll('#view details').forEach(d => d.open = true)")
    if pg.locator("[data-pledge-status][data-status='ok']").count():
        pg.locator("[data-pledge-status][data-status='ok']").first.click(); pg.wait_for_timeout(1300)

# ── 컷 9 · 확인 — 오유진(코딩 1학년·예시): 참가 신청 → «3일 뒤 대회입니다. 오시나요?» → «올 거예요» (4.5초)
with scene("c09_join") as pg:
    ready(pg, f"/e/{ev}"); pg.wait_for_timeout(400)
    scroll_to(pg, "#t-name", 120); pg.click("#t-name"); pg.type("#t-name", "오유진 (예시)", delay=70)
    pg.fill("#t-email", "yu@example.com"); pg.check("#t-agree"); pg.wait_for_timeout(300)
    pg.click("#t-join"); pg.wait_for_timeout(900)
    pg.reload(wait_until="domcontentloaded"); pg.wait_for_selector("#cf-yes", timeout=10000)
    scroll_to(pg, "#cf-box", 60); pg.wait_for_timeout(2600)
    pg.click("#cf-yes"); pg.wait_for_timeout(650)   # «온다고 알렸습니다» 안내까지만. 그 뒤 새로고침은 안 쓴다

# 장부를 네 이름으로 채운다 — 간식·멘토는 화면 밖에서 (예시 표기 동일)
for kind, label, who, org in [("snack", "20명분 간식", "김민준 (예시)", "동네 빵집 (예시)"), ("mentor", "중간에 한 번 둘러봐 주실 분", "최수아 (예시)", "AI 스타트업 (예시)")]:
    n = call(f"/api/events/{ev}/needs", {"kind": kind, "label": label, "qty": 1}, key=K)
    p = call(f"/api/needs/{n['id']}/pledge", {"name": who, "org": org, "contact": "x@example.com"})
    call(f"/api/pledges/{p['id']}/status", {"status": "ok"}, key=K)
# ── 컷 10 · 후 — «필요한 만큼 채워졌습니다» (3.5초)
with scene("c10_filled") as pg:
    ready(pg, f"/e/{ev}"); pg.wait_for_timeout(500)
    scroll_to(pg, "text=필요한 만큼 채워졌습니다", 300); pg.wait_for_timeout(3200)

# ── 컷 1·11 · 장부 — «공개 장부» 네 이름 (3 + 4초: 앞 3초는 정지, 뒤 4초는 천천히 스크롤)
with scene("c11_ledger") as pg:
    ready(pg, f"/e/{ev}"); pg.wait_for_timeout(500)
    scroll_to(pg, "text=공개 장부", 40); pg.wait_for_timeout(3400)
    for _ in range(9): pg.mouse.wheel(0, 26); pg.wait_for_timeout(440)
    pg.wait_for_timeout(700)

# ── 컷 12 · 다리 — 빈 «대회 이름» 칸, 커서만 (4초)
with scene("c12_empty") as pg:
    ready(pg, "/app"); pg.evaluate("() => localStorage.clear()")
    pg.click('nav button[data-t="make"]'); pg.wait_for_selector("#f-title"); pg.wait_for_timeout(300)
    pg.click("#f-title"); pg.wait_for_timeout(4200)

json.dump({"ev": ev, "clips": [[n, str(f)] for n, f in clips]}, open(OUT / "clips.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("끝:", len(clips), "컷")
