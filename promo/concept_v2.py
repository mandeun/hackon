# 컨셉 영상 v2 «전부 없어도 됩니다» — 28.5초 · 9컷 · 9:16 · 목소리 없음 · 실제 화면(기기 픽셀 2배, cdprec) + 글자 애니메이션
# 구조: 센트비 「A 말고 B」 대조 + ABCD(첫 2.5초 질문으로 잡고 · 5초부터 로고 · 실제 화면으로 공감 · 마지막 단추 지시)
# 실행: python promo/concept_v2.py [record|caps|assemble|all]
import sys, json, pathlib, shutil, subprocess, datetime, urllib.request, base64, wave
HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE.parent))
from cdprec import Rec
D = pathlib.Path(r"C:\Users\tree0\AppData\Local\Temp\hackon_concept"); D.mkdir(exist_ok=True)
SFX = HERE / "sfx"
LOGO = (HERE.parent / "logo.svg").read_text(encoding="utf-8")
LOGO_URI = "data:image/svg+xml;base64," + base64.b64encode(LOGO.encode()).decode()
FONT = "font-family:'Pretendard','Malgun Gothic',sans-serif"

def run(*a):
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", *map(str, a)], capture_output=True, text=True)
    if r.returncode: print(r.stderr); sys.exit(1)
def dur(f):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)], capture_output=True, text=True).stdout.strip())

# ─────────────────────────── 1. 녹화 ───────────────────────────
INTRO = f"""<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;background:#0B1020;color:#fff;{FONT};width:540px;height:960px;overflow:hidden}}
.w{{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 48px}}
h1{{font-size:44px;font-weight:900;margin:0 0 26px;opacity:0;animation:up .45s .15s forwards}}
.li{{font-size:34px;font-weight:700;color:#DDE3F5;padding:7px 0;position:relative;opacity:0;animation:up .3s forwards}}
.li::before{{content:'✗';color:#FF7A7A;margin-right:12px;opacity:0;animation:pop .2s forwards;animation-delay:inherit}}
.li i{{position:absolute;left:0;top:50%;height:5px;width:0;background:#FF7A7A;border-radius:3px}}
.big{{font-size:56px;font-weight:900;line-height:1.2;margin-top:34px;opacity:0;transform:scale(.9);animation:pop .35s 3.55s forwards}}
.big b{{color:#7FA0FF}}
@keyframes up{{to{{opacity:1;transform:translateY(0)}}from{{transform:translateY(14px)}}}}
@keyframes pop{{to{{opacity:1;transform:scale(1)}}}}
@keyframes strike{{to{{width:100%}}}}
</style><div class="w"><h1>해커톤, 열려면?</h1>
{''.join(f'<div class="li" style="animation-delay:{0.6+i*0.32:.2f}s">{t}<i style="animation:strike .22s {2.6+i*0.13:.2f}s forwards"></i></div>' for i,t in enumerate(['장소','심사위원','상금','간식','참가자 20명']))}
<div class="big">전부 <b>없어도</b><br>됩니다.</div></div>"""

CONTRAST = f"""<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;background:#0B1020;color:#fff;{FONT};width:540px;height:960px;overflow:hidden}}
.w{{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:26px;padding:0 40px;text-align:center}}
.a{{font-size:40px;font-weight:800;color:#8A93A8;position:relative;opacity:0;animation:up .3s .1s forwards}}
.a i{{position:absolute;left:0;top:52%;height:6px;width:0;background:#FF7A7A;border-radius:3px;animation:strike .25s .8s forwards}}
.m{{font-size:26px;color:#AEB6C8;opacity:0;animation:up .3s 1.05s forwards}}
.b{{font-size:54px;font-weight:900;color:#fff;line-height:1.2;opacity:0;transform:scale(.9);animation:pop .35s 1.25s forwards}}
.b b{{color:#7FA0FF}}
@keyframes up{{to{{opacity:1;transform:translateY(0)}}from{{transform:translateY(14px)}}}}
@keyframes pop{{to{{opacity:1;transform:scale(1)}}}}
@keyframes strike{{to{{width:100%}}}}
</style><div class="w"><div class="a">다 구해 놓고 연다<i></i></div><div class="m">말고</div><div class="b"><b>먼저</b> 열고,<br>빈자리는 채운다.</div></div>"""

END = f"""<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;background:#0B1020;color:#fff;{FONT};width:540px;height:960px;overflow:hidden}}
.w{{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding-top:190px;text-align:center}}
img{{width:280px;filter:brightness(0) invert(1);opacity:0;transform:scale(.85);animation:pop .4s .1s forwards}}
.u{{font-size:60px;font-weight:900;letter-spacing:2px;margin-top:22px;opacity:0;animation:up .35s .35s forwards}}
.h{{font-size:27px;font-weight:700;color:#AEB6C8;margin-top:14px;line-height:1.4;opacity:0;animation:up .35s .55s forwards}}
.btn{{margin-top:26px;background:#2350F5;border-radius:12px;padding:16px 30px;font-size:28px;font-weight:900;opacity:0;animation:up .35s .8s forwards}}
.ex{{position:absolute;left:0;right:0;bottom:290px;font-size:17px;color:#AEB6C8}}
@keyframes up{{to{{opacity:1;transform:translateY(0)}}from{{transform:translateY(14px)}}}}
@keyframes pop{{to{{opacity:1;transform:scale(1)}}}}
</style><div class="w"><img src="{LOGO_URI}"><div class="u">hackon.kr</div><div class="h">번거로운 일 하나,<br>동네가 하루 만에 풉니다.</div>
<div class="btn">1단계 · 대회 만들기</div></div><div class="ex">화면 속 이름·약속은 예시입니다 · 이용자 0명에서 정직하게</div>"""

def record():
    import checklib
    BASE = checklib.start()
    def call(path, body=None, key=None, tkey=None, method=None):
        h = {"content-type": "application/json"}
        if key: h["x-okey"] = key
        if tkey: h["x-tkey"] = tkey
        r = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method or ("POST" if body is not None else "GET"))
        return json.load(urllib.request.urlopen(r))
    def ready(pg, path):
        pg.goto(f"{BASE}{path}", wait_until="domcontentloaded"); pg.wait_for_selector("body[data-ready='1']", timeout=10000)
    def to(pg, sel, up=140):
        pg.locator(sel).first.scroll_into_view_if_needed(timeout=8000); pg.mouse.wheel(0, -up); pg.wait_for_timeout(250)
    today = datetime.date.today()
    d10 = (today + datetime.timedelta(days=10)).isoformat(); y1 = (today - datetime.timedelta(days=1)).isoformat()

    # 글자 애니메이션 셋 (HTML 을 그대로 찍는다)
    with Rec(D, "c01_intro", html=INTRO) as pg: pg.wait_for_timeout(5400)
    with Rec(D, "c07_contrast", html=CONTRAST) as pg: pg.wait_for_timeout(2900)
    with Rec(D, "c09_end", html=END) as pg: pg.wait_for_timeout(3400)

    # 컷 3 — 열기: 유형 칩 «우리 가게» → 이름이 채워짐 → 만들기
    st = {}
    with Rec(D, "c03_make") as pg:
        ready(pg, "/app"); pg.evaluate("() => localStorage.clear()")
        pg.click('nav button[data-t="make"]'); pg.wait_for_selector("[data-tpl]"); pg.wait_for_timeout(700)
        pg.click("[data-tpl='3']"); pg.wait_for_timeout(900)
        to(pg, "#f-title", 120); pg.click("#f-title"); pg.keyboard.press("End"); pg.type("#f-title", " (예시)", delay=90); pg.wait_for_timeout(500)
        pg.click("#f-save"); pg.wait_for_timeout(1700)
        st["ev"] = pg.evaluate("() => localStorage.getItem('hackon.event')")
        st["okey"] = pg.evaluate("(ev) => localStorage.getItem('hackon.okey.' + ev)", st["ev"])
    ev, K = st["ev"], st["okey"]
    call(f"/api/events/{ev}", {"host": "박서윤 카페 (예시)", "starts": d10, "ends": d10}, key=K, method="PATCH")
    for kind, label in [("venue", "20명이 6시간 쓸 장소"), ("judge", "오후에 한 시간, 점수만"), ("snack", "20명분 간식")]:
        call(f"/api/events/{ev}/needs", {"kind": kind, "label": label, "qty": 1}, key=K)
    HOST = {"hackon.event": ev, f"hackon.okey.{ev}": K}

    # 컷 4 — 빈자리 셋 → 공개 페이지 «이 자리 맡기» → 보냈습니다
    with Rec(D, "c04_seats", HOST) as pg:
        ready(pg, f"/app#{ev}"); pg.wait_for_timeout(500)
        pg.evaluate("() => document.querySelectorAll('#view details').forEach(d => d.open = true)")
        to(pg, "text=아직 맡겠다는 사람이 없습니다", 300); pg.wait_for_timeout(1400)
        ready(pg, f"/e/{ev}"); pg.wait_for_timeout(400)
        to(pg, "[data-give-need]", 220); pg.wait_for_timeout(600)
        pg.locator("[data-give-need]").first.click(); pg.wait_for_selector("#g-name"); pg.wait_for_timeout(400)
        pg.click("#g-name"); pg.type("#g-name", "김민준 (예시)", delay=70); pg.fill("#g-contact", "kim@example.com"); pg.wait_for_timeout(250)
        pg.click("#g-send"); pg.wait_for_timeout(1400)

    # 컷 5a — /ask 첫 칸 타이핑 → 다음 · 5b — 첫 화면 «풀어 달라는 문제»
    with Rec(D, "c05a_ask") as pg:
        ready(pg, "/ask"); pg.wait_for_timeout(500)
        pg.click("[data-ask-kind='requester']"); pg.wait_for_selector("#ask-q"); pg.wait_for_timeout(500)
        pg.click("#ask-q"); pg.type("#ask-q", "회비 낸 사람 세기가 번거로워요", delay=75); pg.wait_for_timeout(500)
        pg.click("#ask-next"); pg.wait_for_timeout(900)
    # 나머지 칸은 화면 밖에서 — 올린 결과가 첫 화면에 뜨게
    rq = call("/api/requests", {"kind": "requester", "name": "총무 최 (예시)", "pain": "회비 낸 사람 세기가 번거로워요", "now": "수첩에 적어요", "done": "이름 누르면 냈다로 바뀌면", "contact": "choi@example.com"})
    with Rec(D, "c05b_home") as pg:
        pg.goto(f"{BASE}/", wait_until="domcontentloaded"); pg.wait_for_selector("#asks:not([hidden])", timeout=8000); pg.wait_for_timeout(300)
        pg.evaluate("document.querySelector('#asks').scrollIntoView({block:'start'})"); pg.mouse.wheel(0, -90); pg.wait_for_timeout(1800)

    # 컷 6 — 받는 화면: 끝난 대회의 결과물 + «이거면 됩니다»
    evB = call("/api/events", {"title": "동아리 회비 자동화 대회 (예시)", "host": "정하늘 (예시)", "starts": y1, "ends": y1})
    KB = evB["okey"]
    rqB = call("/api/requests", {"kind": "requester", "name": "총무 최 (예시)", "pain": "회비 낸 사람 세기가 번거로워요", "done": "이름 누르면 냈다로 바뀌면", "contact": "choi@example.com", "event": evB["id"]})
    call(f"/api/events/{evB['id']}", {"due": "2099-01-01T00:00"}, key=KB, method="PATCH")
    tB = call(f"/api/events/{evB['id']}/teams", {"name": "만든팀 (예시)", "email": "m@example.com", "agree": True, "share": True})
    call(f"/api/teams/{tB['id']}/submit", {"url": "https://hackon.kr/", "note": "이름을 누르면 «냈음»으로 바뀌는 회비표", "request": rqB["id"], "sale": "무료로 드려요"}, tkey=tB["tkey"])
    call(f"/api/events/{evB['id']}", {"due": f"{y1}T18:00"}, key=KB, method="PATCH")
    with Rec(D, "c06_recv") as pg:
        ready(pg, f"/r/{rqB['id']}?k={rqB['rkey']}"); pg.wait_for_timeout(600)
        to(pg, "[data-verdict][data-ok='1']", 330); pg.wait_for_timeout(1300)
        pg.locator("[data-verdict][data-ok='1']").first.click(); pg.wait_for_timeout(1500)

    # 컷 8 — 참가 신청 칸 둘 (이름·이메일)
    with Rec(D, "c08_apply") as pg:
        ready(pg, f"/e/{ev}"); pg.wait_for_timeout(400)
        pg.evaluate("document.querySelector('#t-name').scrollIntoView({block:'start'})"); pg.mouse.wheel(0, -150); pg.wait_for_timeout(500)
        pg.click("#t-name"); pg.type("#t-name", "오유진 (예시)", delay=80); pg.wait_for_timeout(1400)
    json.dump(st, open(D / "state.json", "w"))

# ─────────────────────────── 2. 자막·로고 ───────────────────────────
CAPS = [("cap03", "<b class='on'>이름 하나</b>면 열립니다", 60), ("cap04", "빈자리는 <b class='on'>동네</b>가 채웁니다", 58),
        ("cap05", "<b class='on'>번거로운 일</b> 하나 올리면", 58), ("cap06", "끝나면 <b class='on'>이렇게</b> 받습니다", 58),
        ("cap08", "코딩은 <b class='on'>안 해 봤어도</b> 됩니다", 56)]
CAP = """<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}
 .w{width:1080px;height:340px;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse 72%% 62%% at 50%% 50%%,rgba(12,15,23,.88) 0%%,rgba(12,15,23,.6) 55%%,rgba(12,15,23,0) 100%%)}
 .t{%s;font-weight:800;font-size:%dpx;letter-spacing:3px;color:rgb(250,248,244);text-shadow:0 6px 18px rgba(0,0,0,.6);text-align:center;line-height:1.34;padding:0 58px}
 .t b{font-weight:900} .t b.on{color:#7FA0FF}
 .bar{position:absolute;left:50%%;transform:translateX(-50%%);top:74px;width:54px;height:5px;border-radius:3px;background:#2350F5}
</style><div class="w"><div class="bar"></div><div class="t">%s</div></div>"""
BUG = f"""<!doctype html><meta charset="utf-8"><style>html,body{{margin:0;background:transparent}}
 .b{{display:inline-flex;align-items:center;gap:10px;padding:10px 18px;border-radius:999px;background:rgba(12,15,23,.78)}}
 img{{height:34px;filter:brightness(0) invert(1)}}</style><div class="b"><img src="{LOGO_URI}"></div>"""
def caps():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1080, "height": 340})
        for n, h, s in CAPS:
            pg.set_content(CAP % (FONT, s, h)); pg.wait_for_timeout(120); pg.screenshot(path=str(D / f"{n}.png"), omit_background=True)
        pg2 = b.new_page(viewport={"width": 400, "height": 80}); pg2.set_content(BUG); pg2.wait_for_timeout(120)
        pg2.locator(".b").screenshot(path=str(D / "bug.png"), omit_background=True); b.close()
    print("자막·로고 구움")

# ─────────────────────────── 3. 조립 ───────────────────────────
CUTS = [  # (컷, 파일, 시작초(None=끝에서), 길이)
    (1, "c01_intro.mp4", 0.15, 5.0), (3, "c03_make.mp4", 0.7, 4.0), (4, "c04_seats.mp4", 1.7, 4.5),
    (5, "c05a_ask.mp4", 0.6, 2.5), (55, "c05b_home.mp4", None, 1.5), (6, "c06_recv.mp4", 0.5, 3.5),
    (7, "c07_contrast.mp4", 0.05, 2.5), (8, "c08_apply.mp4", 0.6, 2.5), (9, "c09_end.mp4", 0.05, 3.0),
]
CAPMAP = {3: "cap03", 4: "cap04", 5: "cap05", 6: "cap06", 8: "cap08"}
def assemble():
    segs, t0, starts, lens = [], 0.0, {}, {}
    for n, f, ss, ln in CUTS:
        src = D / f; seg = D / f"seg{n:02d}.mp4"
        if ss is None: ss = max(0.0, dur(src) - ln - 0.05)
        run("-ss", f"{ss:.2f}", "-t", f"{ln:.2f}", "-i", src, "-vf", "scale=1080:1920,format=yuv420p", "-r", 30, "-an", "-c:v", "libx264", "-crf", "18", seg)
        segs.append(seg); starts[n] = t0; lens[n] = ln; t0 += ln
    TOTAL = t0
    (D / "list.txt").write_text("".join(f"file '{s.as_posix()}'\n" for s in segs), encoding="utf-8")
    run("-f", "concat", "-safe", "0", "-i", D / "list.txt", "-c", "copy", D / "body.mp4")
    inputs, chain, idx, last = ["-i", str(D / "body.mp4")], [], 1, "[0:v]"
    for n, name in CAPMAP.items():
        inputs += ["-i", str(D / f"{name}.png")]; a, b = starts[n] + 0.1, starts[n] + lens[n] - 0.06
        y = 170 if n == 6 else 1080   # 6컷은 «이거면 됩니다» 단추가 아래에 있어 자막을 위로
        chain.append(f"{last}[{idx}:v]overlay=(W-w)/2:{y}:enable='between(t,{a:.2f},{b:.2f})'[v{idx}]"); last = f"[v{idx}]"; idx += 1
    # 로고 버그는 안 얹는다 — 실제 화면마다 앱 머리글에 HACK:ON 이 이미 있다(B 는 그걸로 충분, 얹으면 제목을 가린다)
    run(*inputs, "-filter_complex", ";".join(chain), "-map", last, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", 30, "-an", D / "video.mp4")
    # 소리 — 배경음(bgm.py, 길이 맞춤) + 효과음
    subprocess.run([sys.executable, str(HERE / "bgm.py"), f"{TOTAL + 0.5:.1f}", "92"], check=True, capture_output=True)
    ev = [("type", starts[1] + 0.6), ("whoosh", starts[1] + 2.6), ("done", starts[1] + 3.55),
          ("button", starts[3] + 1.2), ("type", starts[3] + 1.9), ("button", starts[3] + 3.1),
          ("button", starts[4] + 2.5), ("done", starts[4] + 3.1),
          ("type", starts[5] + 0.4), ("done", starts[55] + 0.3),
          ("button", starts[6] + 2.0), ("done", starts[6] + 2.6),
          ("whoosh", starts[7] + 0.8), ("done", starts[7] + 1.3),
          ("type", starts[8] + 0.8), ("done", starts[9] + 0.4)]
    ain = ["-i", str(D / "video.mp4"), "-i", str(SFX / "bgm.wav")]
    parts = ["[1:a]volume=0.55,atrim=0:%.2f[bed]" % TOTAL]; mix = ["[bed]"]
    for i, (name, t) in enumerate(ev):
        ain += ["-i", str(SFX / f"{name}.wav")]
        vol = {"type": 0.5, "button": 0.65, "done": 0.75, "whoosh": 0.6}[name]
        parts.append(f"[{i + 2}:a]volume={vol},adelay={int(t * 1000)}|{int(t * 1000)}[s{i}]"); mix.append(f"[s{i}]")
    parts.append("".join(mix) + f"amix=inputs={len(mix)}:normalize=0:duration=first,volume=0.8,alimiter=limit=0.85[a]")
    OUT = D / "HACKON_컨셉_v2_9x16.mp4"
    run(*ain, "-filter_complex", ";".join(parts), "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", OUT)
    json.dump({"starts": starts, "total": TOTAL}, open(D / "timeline.json", "w"), indent=1)
    print("완성:", OUT, f"{dur(OUT):.2f}s")

if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("record", "all"): record()
    if what in ("caps", "all"): caps()
    if what in ("assemble", "all"): assemble()
