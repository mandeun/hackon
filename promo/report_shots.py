# 보고용 화면 캡처 — «뭘 만들었는지» 를 캡처 + 한 줄로. 임시 서버에 상태를 심고 각 화면을 460px 폰 폭으로 찍는다.
# 실행: python promo/report_shots.py <제목> "<id>|<경로 또는 동작>|<한 줄>" ...  → C:\Temp\hackon_report\<id>.png + report.html (Artifact 로 올린다)
import sys, json, base64, pathlib, datetime, urllib.request, html
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
import checklib
from playwright.sync_api import sync_playwright

OUT = pathlib.Path(r"C:\Users\tree0\AppData\Local\Temp\hackon_report"); OUT.mkdir(exist_ok=True)
BASE = checklib.start()
def call(path, body=None, key=None, tkey=None, method=None):
    h = {"content-type": "application/json"}
    if key: h["x-okey"] = key
    if tkey: h["x-tkey"] = tkey
    r = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method or ("POST" if body is not None else "GET"))
    return json.load(urllib.request.urlopen(r))

# ── 씨앗: 대회 하나 + 자리 셋 + 참가 둘 + 의뢰 하나 + 협찬 하나
d10 = (datetime.date.today() + datetime.timedelta(days=10)).isoformat()
ev = call("/api/events", {"title": "우리 가게 문제 풀기 대회 (예시)", "host": "박서윤 카페 (예시)", "starts": d10, "ends": d10, "cap": 10, "topic": "가게에서 매일 손으로 하는 일"})
K = ev["okey"]
for kind, label in [("venue", "20명이 6시간 쓸 장소"), ("judge", "오후에 한 시간, 점수만"), ("snack", "20명분 간식")]:
    n = call(f"/api/events/{ev['id']}/needs", {"kind": kind, "label": label, "qty": 1}, key=K)
    if kind == "judge": call(f"/api/needs/{n['id']}/pledge", {"name": "이도현 (예시)", "contact": "dev@example.com", "coi": True})
call(f"/api/events/{ev['id']}/teams", {"name": "오유진 (예시)", "email": "yu@example.com", "agree": True})
t2 = call(f"/api/events/{ev['id']}/teams", {"name": "김민준 (예시)", "email": "min@example.com", "agree": True})
call(f"/api/teams/{t2['id']}/more", {"solo": True, "link": "https://github.com/torvalds", "role": "만들기"}, tkey=t2["tkey"])
call("/api/requests", {"kind": "requester", "name": "총무 최 (예시)", "pain": "회비 낸 사람 세기가 번거로워요", "contact": "c@example.com"})
call(f"/api/events/{ev['id']}/sponsors", {"name": "동네 빵집 (예시)", "kind": "현물", "amount": 0, "domain": "openai.com"}, key=K)
HOST = {"hackon.event": ev["id"], f"hackon.okey.{ev['id']}": K}

SHOTS = [  # (파일, 경로, 준비 동작, 한 줄)
    ("home", "/", None, "첫 화면 — «번거로운 일 하나, 동네가 하루 만에 풉니다.» · «참가할 대회 보기»는 누르면 내려간다"),
    ("make", "/app", "make", "열기 탭 — 유형 칩을 누르면 이름·정원·시간이 채워진다(«우리 가게»를 눌러 둔 상태)"),
    ("host", f"/app#{ev['id']}", "host", "운영 화면 — 위에 절 탭(기본·공지·주제·예산·자리·주소·신청·등록·끝난 뒤·후원). 열쇠는 접혀 있고 «카카오 로그인이 곧 열쇠»"),
    ("needs", f"/app#{ev['id']}", "needs", "필요한 자리 — 심사 맡은 분 옆에 «이해관계 없음 확인» 배지"),
    ("spon", f"/app#{ev['id']}", "spon", "후원 보고 탭 — 협찬사는 홈페이지 주소 하나(+틀리면 파일). 로고·갈 곳은 접힘"),
    ("give", f"/e/{ev['id']}", "give", "공개 페이지 «이 자리 맡기»(심사) — «이해관계가 없습니다» 본인 확인 한 줄"),
    ("crew", f"/e/{ev['id']}", "crew", "같이 할 사람 — 링크가 깃허브면 공개 저장소·별·대표 저장소가 자동으로(입력 0), 없으면 «처음이에요»"),
    ("keycard", f"/app#{ev['id']}", "keycard", "열쇠 없는 기기에서 운영 화면 — «카카오로 로그인» 이 먼저, 열쇠 직접 넣기는 접힘"),
]
def prep(pg, what):
    if what == "make":
        pg.click('nav button[data-t="make"]'); pg.wait_for_selector("[data-tpl]"); pg.click("[data-tpl='3']"); pg.wait_for_timeout(300)
    elif what == "host":
        pg.wait_for_selector("#host-tabs"); pg.wait_for_timeout(300)
    elif what == "needs":
        pg.wait_for_selector("#host-tabs"); pg.evaluate("document.querySelectorAll('#view details').forEach(d => d.open = true)")
        pg.evaluate("document.querySelector('#sec-needs').scrollIntoView({block:'start'})"); pg.wait_for_timeout(300)
    elif what == "spon":
        pg.click('nav button[data-t="spon"]'); pg.wait_for_selector("#p-dom"); pg.evaluate("document.querySelector('#p-name').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300)
    elif what == "give":
        pg.wait_for_timeout(400); btns = pg.locator("[data-give-kind='judge']"); btns.first.scroll_into_view_if_needed(); btns.first.click(); pg.wait_for_selector("#g-coi"); pg.wait_for_timeout(300)
    elif what == "crew":
        pg.wait_for_timeout(1200); pg.evaluate("(document.querySelector('[data-gh]') || document.body).scrollIntoView({block:'center'})"); pg.wait_for_timeout(600)
    elif what == "keycard":
        pg.wait_for_selector("#ok-in", timeout=8000); pg.wait_for_timeout(300)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--force-device-scale-factor=2"])
    for name, path, what, line in SHOTS:
        ctx = b.new_context(viewport={"width": 460, "height": 860}, device_scale_factor=2, locale="ko-KR")
        if what not in (None, "give", "crew", "keycard", "make"):
            ctx.add_init_script(";".join(f"localStorage.setItem({json.dumps(k)},{json.dumps(v)})" for k, v in HOST.items()))
        pg = ctx.new_page(); pg.goto(BASE + path, wait_until="domcontentloaded")
        try: pg.wait_for_selector("body[data-ready='1']", timeout=8000)
        except Exception: pass
        try: prep(pg, what)
        except Exception as e: print("준비 실패:", name, e)
        pg.screenshot(path=str(OUT / f"{name}.png")); ctx.close(); print("캡처:", name)
    b.close()

# ── 보고 페이지: 캡처 + 한 줄. 사진은 data: 로 박아 파일 하나로. 토큰은 안 쓴다 — 스크립트가 만든다
title = sys.argv[1] if len(sys.argv) > 1 else "HACK:ON 이번에 만든 것"
cards = "".join(f'<figure><img src="data:image/png;base64,{base64.b64encode((OUT / f"{n}.png").read_bytes()).decode()}" alt=""><figcaption><b>{i + 1}.</b> {html.escape(l)}</figcaption></figure>' for i, (n, _, _, l) in enumerate(SHOTS))
page = f"""<title>{html.escape(title)}</title>
<style>:root{{color-scheme:light}} body{{background:#F4F5F7;margin:0;padding:24px 16px 60px;font-family:'Pretendard','Malgun Gothic',sans-serif;color:#1A1E1D}}
h1{{font-size:22px;margin:0 0 6px}} .sub{{color:#828986;font-size:13px;margin:0 0 18px}}
.g{{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px}}
figure{{margin:0;background:#fff;border:1px solid #E3E6EA;border-radius:14px;overflow:hidden}}
figure img{{width:100%;display:block;aspect-ratio:460/860;object-fit:cover;object-position:top}}
figcaption{{padding:10px 12px 12px;font-size:14px;line-height:1.5}} figcaption b{{color:#2350F5}}
@media (prefers-color-scheme:dark){{:root:not([data-theme=light]) body{{background:#111;color:#eee}} :root:not([data-theme=light]) figure{{background:#1b1b1b;border-color:#333}}}}
</style><h1>{html.escape(title)}</h1><p class="sub">{datetime.date.today().isoformat()} · hackon.kr · 임시 서버에 «(예시)» 데이터를 심어 찍은 화면 · 실제 이용자 데이터 아님</p><div class="g">{cards}</div>"""
(OUT / "report.html").write_text(page, encoding="utf-8")
print("보고 페이지:", OUT / "report.html", f"{(OUT / 'report.html').stat().st_size // 1024}KB")
