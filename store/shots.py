# 스토어 스크린샷 — 임시 DB 로 서버를 띄워 예시 대회를 API 로 심고, 실제 화면을 찍어 캡션 띠를 붙인다.
# 그림은 진짜 화면이다. 별점·수상·남의 회사 로고는 넣지 않는다. 데이터는 전부 예시(가상 인물·가상 팀).
# 실행: python3 store/shots.py      (node 24 가 PATH 에 있어야 한다. 글꼴은 Pretendard 가 깔려 있으면 그것을 쓴다)
#   → store/out/raw/*.png           찍은 화면 그대로
#   → store/out/<기기>/NN_<이름>.png 캡션을 붙인 스토어용
#   → store/out/play_feature_1024x500.png
import sys, json, base64, pathlib, datetime, urllib.request
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import checklib   # 빈 DB 로 서버를 띄우고 끝나면 지운다 (PORT·DB 를 스스로 잡는다)
from playwright.sync_api import sync_playwright

OUT = ROOT / "store" / "out"; RAW = OUT / "raw"
RAW.mkdir(parents=True, exist_ok=True)
INK, LIME, MIST, PG = "#0B1020", "#C8F53B", "#AEB6C8", "#EEF1F4"
FONT = "'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif"

# 기기별 출력 크기. 폰 화면은 한 번 찍어 모든 폰 크기에 쓰고, 아이패드는 넓은 폭으로 따로 찍는다
DEVICES = {
    "iphone_6.9": (1320, 2868),
    "iphone_6.5": (1242, 2688),
    "ipad_13": (2064, 2752),
    "android_phone": (1080, 1920),
}

BASE = checklib.start()


def call(path, body=None, key=None, tkey=None, jkey=None, method=None):
    h = {"content-type": "application/json"}
    if key: h["x-okey"] = key
    if tkey: h["x-tkey"] = tkey
    if jkey: h["x-jkey"] = jkey
    r = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                               headers=h, method=method or ("POST" if body is not None else "GET"))
    return json.load(urllib.request.urlopen(r))


# ── 씨앗: 오늘 열리는 동네 대회 하나. 팀 여섯, 제출, 심사 둘, 질문 하나 ─────────────
today = datetime.date.today().isoformat()
ev = call("/api/events", {"title": "성수 동네 문제 풀기 해커톤", "host": "성수 메이커 모임", "starts": today, "ends": today,
                          "cap": 30, "prize": 1000000, "topic": "동네 가게가 매일 손으로 하는 일"})
EID, K, JK = ev["id"], ev["okey"], ev["jkey"]
call(f"/api/events/{EID}", {"place": "서울 성동구 성수이로 (예시 장소)", "due": today + "T17:00"}, key=K, method="PATCH")
TEAMS = [
    ("골목지도", "구멍가게 재고를 사진 한 장으로 세는 앱", "https://golmok-map.example"),
    ("빵굽는개발자", "빵집 예약을 카톡 대신 한 화면에서", "https://bread-queue.example"),
    ("세탁소알림", "옷 찾을 날짜를 문자로 알려 주는 봇", "https://laundry-bell.example"),
    ("반찬가게장부", "외상 장부를 음성으로 적는 도구", "https://banchan-book.example"),
    ("꽃집캘린더", "기념일 주문을 미리 알려 주는 달력", "https://flower-cal.example"),
    ("수선실", "수선 요청 사진에 견적을 붙이는 폼", "https://repair-room.example"),
]
SCORES = [(92, 88, 90, 85), (84, 90, 80, 86), (78, 82, 88, 74), (70, 76, 72, 80), (66, 70, 74, 68), (60, 64, 62, 70)]
tids = []
for i, (name, note, url) in enumerate(TEAMS):
    t = call(f"/api/events/{EID}/teams", {"name": name, "email": f"team{i}@example.com", "agree": True})
    tids.append(t)
    call(f"/api/teams/{t['id']}/submit", {"url": url, "note": note}, tkey=t["tkey"])
rub = [r["key"] for r in call(f"/api/events/{EID}")["rubric"]]
for judge, d in (("심사위원 A", 0), ("심사위원 B", -3)):
    for t, sc in zip(tids, SCORES):
        call(f"/api/teams/{t['id']}/score", {"judge": judge, "values": {k: v + d for k, v in zip(rub, sc)}}, jkey=JK)
call(f"/api/events/{EID}/questions", {"text": "발표 순서는 언제 정해지나요?"}, tkey=tids[1]["tkey"])
call(f"/api/events/{EID}/questions", {"text": "콘센트 자리가 넉넉한가요?"}, tkey=tids[2]["tkey"])
HOST = {"hackon.event": EID, f"hackon.okey.{EID}": K, f"hackon.jkey.{EID}": JK, "hackon.owner": ev["owner"]}


# ── 찍을 화면 다섯 ─────────────────────────────────────────────
def prep_make(pg):
    pg.click('nav button[data-t="make"]'); pg.wait_for_selector("#f-title")
    pg.fill("#f-title", "우리 동네 해커톤"); pg.wait_for_timeout(300)


def prep_host(pg):
    pg.wait_for_timeout(1200)
    # 순위표(심사 점수)가 보이게 — 접힌 묶음을 펴고 그 자리로 간다
    pg.evaluate("""() => { document.querySelectorAll('#view details').forEach(d => d.open = true);
      const t = document.querySelector('tr[data-team]'); if (!t) return;
      t.closest('table').scrollIntoView({block:'start'}); window.scrollBy(0, -90);
      /* 임시 서버에는 메일 열쇠가 없어서 «메일: 건너뜀» 이 뜬다. 운영에서는 안 보이는 줄이라 가린다 */
      for (const el of document.querySelectorAll('#view *'))
        if (el.children.length === 0 && /^메일: 건너뜀/.test(el.textContent.trim())) el.style.visibility = 'hidden'; }""")
    pg.wait_for_timeout(500)


def prep_public(pg):
    pg.wait_for_timeout(1200)


def prep_qa(pg):
    pg.wait_for_timeout(1200)
    pg.evaluate("""() => { const b = [...document.querySelectorAll('button,a')].find(x => x.textContent.trim() === '신고');
      if (!b) return; const card = b.closest('.card') || b; card.scrollIntoView({block:'start'}); window.scrollBy(0, -110); }""")
    pg.wait_for_timeout(500)


def prep_tv(pg):
    pg.wait_for_timeout(2000)


def prep_judge(pg):
    pg.wait_for_timeout(1200)
    pg.locator("#view input").first.fill("심사위원 C")
    pg.get_by_role("button", name="시작").click(); pg.wait_for_timeout(1200)


SHOTS = [  # (이름, 경로, 준비, 운영자 열쇠를 심나, 캡션 위, 캡션 아래, 가로 화면인가)
    ("make", "/app", prep_make, False, "이름 하나로", "대회를 엽니다", False),
    ("public", f"/e/{EID}", prep_public, False, "링크 하나로", "모집·신청까지", False),
    ("host", f"/app#{EID}", prep_host, True, "당일 운영은", "한 화면에서", False),
    ("tv", f"/tv/{EID}", prep_tv, False, "큰 화면은 프로젝터로,", "심사는 폰으로", True),
    ("qa", f"/e/{EID}", prep_qa, False, "묻고 답하기,", "신고·차단도 바로", False),
]


# 브라우저는 https://hackon.kr 를 연다고 믿고, 요청은 임시 서버가 받는다.
# 그래야 큰 화면 QR·공유 주소에 192.0.2.x:포트 대신 실제 주소가 찍힌다.
SITE = "https://hackon.kr"


def _proxy(route):
    r = route.fetch(url=BASE + route.request.url[len(SITE):])
    route.fulfill(response=r)


def capture(b, name, path, prep, host, wide, w, h, dpr, suffix):
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=dpr, locale="ko-KR",
                        timezone_id="Asia/Seoul", service_workers="block")
    ctx.route(SITE + "/**", _proxy)
    if host:
        ctx.add_init_script(";".join(f"localStorage.setItem({json.dumps(k)},{json.dumps(v)})" for k, v in HOST.items()))
    pg = ctx.new_page(); pg.goto(SITE + path, wait_until="domcontentloaded")
    try: pg.wait_for_selector("body[data-ready='1']", timeout=6000)
    except Exception: pass
    try: prep(pg)
    except Exception as e: print("  준비 실패:", name, e)
    f = RAW / f"{name}{suffix}.png"; pg.screenshot(path=str(f)); ctx.close()
    return f


def uri(f):
    return "data:image/png;base64," + base64.b64encode(pathlib.Path(f).read_bytes()).decode()


LOGO = "data:image/svg+xml;base64," + base64.b64encode((ROOT / "logo.svg").read_bytes()).decode()


def compose(pg, W, H, top, bottom, shot, wide, out):
    """먹 바탕 + 위 캡션 띠 + 아래 실제 화면. 크기는 W x H 그대로(배율 1)."""
    pad = round(W * 0.07); cap = round(W * (0.085 if W < H * 0.6 else 0.06))
    shot_w = W - pad * 2
    if wide:   # 가로 화면(큰 화면) 아래에 심사위원 폰 화면을 겹쳐 놓는다
        img = (f'<div class="dev wide"><img src="{uri(shot[0])}"></div>'
               f'<div class="dev j"><img src="{uri(shot[1])}"></div>')
    else:
        img = f'<div class="dev"><img src="{uri(shot)}"></div>' 
    html = f"""<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:{INK};font-family:{FONT};color:#fff}}
.c{{position:absolute;inset:0;background:radial-gradient(ellipse 90% 45% at 50% 0%,#18224A 0%,{INK} 70%)}}
.top{{position:absolute;left:{pad}px;right:{pad}px;top:{round(H * 0.045)}px}}
.top img{{height:{round(cap * 0.42)}px;filter:brightness(0) invert(1);opacity:.85}}
h1{{margin:{round(cap * 0.35)}px 0 0;font-size:{cap}px;line-height:1.18;font-weight:800;letter-spacing:-.035em}}
h1 b{{color:{LIME};font-weight:800}}
.dev{{position:absolute;left:{pad}px;right:{pad}px;top:{round(H * 0.045 + cap * 3.35)}px;bottom:-{round(W * 0.05)}px;
  border-radius:{round(W * 0.06)}px {round(W * 0.06)}px 0 0;overflow:hidden;background:{PG};
  box-shadow:0 0 0 {max(6, round(W * 0.012))}px #232B45, 0 30px 80px rgba(0,0,0,.5)}}
.dev img{{width:100%;display:block}}
.dev.wide{{bottom:auto;border-radius:{round(W * 0.02)}px;top:{round(H * 0.045 + cap * 3.6)}px}}
.dev.j{{left:{round(W * 0.2)}px;right:{round(W * 0.2)}px;top:{round(H * 0.045 + cap * 3.6 + shot_w * 9 / 16 + cap * 0.7)}px}}
</style><div class="c"></div><div class="top"><img src="{LOGO}"><h1>{top}<br><b>{bottom}</b></h1></div>{img}"""
    pg.set_viewport_size({"width": W, "height": H}); pg.set_content(html); pg.wait_for_timeout(250)
    out.parent.mkdir(parents=True, exist_ok=True); pg.screenshot(path=str(out))


def feature(pg, tv_shot, out):
    """플레이 스토어 대표 그림 1024x500. 글자는 가운데 안전 영역에 둔다."""
    html = f"""<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;width:1024px;height:500px;overflow:hidden;background:{INK};font-family:{FONT};color:#fff}}
.c{{position:absolute;inset:0;background:radial-gradient(ellipse 70% 90% at 15% 50%,#18224A 0%,{INK} 70%)}}
.l{{position:absolute;left:64px;top:96px;width:430px}}
.l img{{height:34px;filter:brightness(0) invert(1)}}
h1{{margin:26px 0 0;font-size:50px;line-height:1.16;font-weight:800;letter-spacing:-.035em}}
h1 b{{color:{LIME}}}
p{{margin:18px 0 0;font-size:21px;color:{MIST};font-weight:600}}
.s{{position:absolute;right:-40px;top:80px;width:540px;border-radius:14px;overflow:hidden;box-shadow:0 0 0 6px #232B45,0 20px 60px rgba(0,0,0,.5)}}
.s img{{width:100%;display:block}}
</style><div class="c"></div><div class="l"><img src="{LOGO}"><h1>해커톤을<br><b>하루 만에</b> 엽니다</h1>
<p>모집 · 진행표 · 심사 · 결과까지 한 곳에서</p></div><div class="s"><img src="{uri(tv_shot)}"></div>"""
    pg.set_viewport_size({"width": 1024, "height": 500}); pg.set_content(html); pg.wait_for_timeout(250)
    pg.screenshot(path=str(out))


with sync_playwright() as p:
    b = p.chromium.launch()
    raws = {}
    for name, path, prep, host, top, bottom, wide in SHOTS:
        # 폰: 430 폭 · 배율 3. 가로 화면(/tv)은 1280x720 하나로 모든 기기에 쓴다
        if wide:
            f = capture(b, name, path, prep, host, wide, 1280, 720, 2, "")
            j = capture(b, "judge", f"/j/{EID}?k={JK}", prep_judge, False, False, 430, 932, 3, "_phone")
            raws[name] = {"phone": (f, j), "tablet": (f, j)}
        else:
            raws[name] = {"phone": capture(b, name, path, prep, host, wide, 430, 932, 3, "_phone"),
                          "tablet": capture(b, name, path, prep, host, wide, 1024, 1366, 2, "_tablet")}
        print("찍음:", name)
    # 결과 보고서는 결과를 공개해야 열린다 — 위 화면을 다 찍은 뒤에 연다
    pg = b.new_page()
    for dev, (W, H) in DEVICES.items():
        kind = "tablet" if dev.startswith("ipad") else "phone"
        for i, (name, _, _, _, top, bottom, wide) in enumerate(SHOTS, 1):
            compose(pg, W, H, top, bottom, raws[name][kind], wide, OUT / dev / f"{i:02d}_{name}.png")
        print("합성:", dev, f"{W}x{H}")
    feature(pg, raws["tv"]["phone"][0], OUT / "play_feature_1024x500.png")
    print("대표 그림:", OUT / "play_feature_1024x500.png")
    b.close()

# 크기 확인 — 스토어는 픽셀이 하나만 달라도 안 받는다
from PIL import Image
bad = []
for dev, (W, H) in DEVICES.items():
    for f in sorted((OUT / dev).glob("*.png")):
        if Image.open(f).size != (W, H): bad.append((f, Image.open(f).size))
if Image.open(OUT / "play_feature_1024x500.png").size != (1024, 500): bad.append(("feature", None))
print("크기 확인:", "모두 맞음" if not bad else bad)
sys.exit(1 if bad else 0)
