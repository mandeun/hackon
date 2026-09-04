"""HACK:ON 완주 테스트 — 서버는 이 스크립트가 알아서 띄운다 (빈 DB, 임시 포트).

    uv run --with playwright python check-e2e.py

대회를 여는 순간부터 협찬사에게 숫자를 넘길 때까지를 **브라우저로** 한 번에 지나간다.
`node server.js --test` 는 함수만 본다. 여기서는 화면이 실제로 서버에 저장하는지를 본다.

마지막에 file:// 데모 모드가 안 깨졌는지도 본다 — 캡처와 발표가 그걸로 돈다.
"""
import json
import os
from datetime import datetime, timedelta
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")   # 윈도우 콘솔이 cp949 라 한글이 깨진다

from playwright.sync_api import sync_playwright

import checklib

BASE = checklib.start()
HTML = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hack-on.html")
errs = []
step = 0


def A(cond, msg):
    if not cond:
        raise AssertionError(msg)


def ok(msg):
    global step
    step += 1
    print(f"ok {step:2d}  {msg}")


def api(path, key=None):
    req = urllib.request.Request(BASE + path)
    if key:
        req.add_header("x-okey", key)
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def code_of(path, key=None):
    """GET 을 해 보고 상태 코드만 돌려준다. 막혔는지 확인할 때 쓴다."""
    req = urllib.request.Request(BASE + path)
    if key:
        req.add_header("x-okey", key)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def post(path, payload, key=None):
    h = {"content-type": "application/json"}
    if key:
        h["x-okey"] = key
    req = urllib.request.Request(
        BASE + path, method="POST", data=json.dumps(payload).encode(), headers=h)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, None


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 460, "height": 900})

    def on_console(m):
        # 400·409 는 이 검사가 일부러 낸다 (중복 팀·정원·배점). 브라우저가 네트워크 응답을
        # 콘솔 error 로 찍을 뿐 우리 코드가 터진 게 아니다. 진짜 예외는 pageerror 로 온다.
        if m.type == "error" and not m.text.startswith("Failed to load resource"):
            errs.append("console:" + m.text)

    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", on_console)

    def visit(path="/app"):
        pg.goto("about:blank")
        pg.goto(BASE + path)
        pg.wait_for_selector("body[data-ready='1']", timeout=8000)

    # ── 0. 첫 화면 — 플랫폼 소개와 열린 대회 목록 ──────────
    pg.goto(BASE + "/")
    # 목록이 비면 grid 가 높이 0 이라 '보인다' 가 안 된다. 개수 표시가 채워지길 기다린다.
    pg.wait_for_function("document.getElementById('count').textContent !== ''", timeout=10000)
    htxt = pg.inner_text("body")
    for must in ["대회 찾기", "열린 대회", "대회 열기", "협찬"]:
        A(must in htxt, f"첫 화면에 '{must}' 메뉴가 없다")
    A(pg.query_selector("#q") is not None, "검색 칸이 없다")
    A(len(pg.query_selector_all("[data-filter]")) == 4, "필터가 4개가 아니다")
    A(pg.query_selector("#sort") is not None, "정렬이 없다")
    A("아직 열린 대회가 없습니다" in htxt, f"빈 목록 안내가 없다: {htxt[:200]}")
    A(pg.get_attribute("a.btn.sm", "href") == "/app", "대회 열기가 앱으로 안 간다")
    ok("첫 화면 — 메뉴·검색·필터·정렬·빈 목록 안내")

    # ── 1. 화면이 서버에 붙었는가 ───────────────────────────
    visit()
    A(pg.evaluate("LIVE") is True, "서버 모드로 안 붙었다")
    A("아직 열린 대회가 없습니다" in pg.content(), "빈 DB 인데 대회가 있다")
    ok("빈 서버에 붙어서 '대회 없음' 을 보여 준다")

    # ── 2. 개인이 5분 안에 대회를 연다 (기획안 1번 기능) ────
    pg.click('nav button[data-t="make"]')
    pg.wait_for_selector("#f-title")
    A(pg.query_selector("#f-host") is None and pg.query_selector("#f-prize") is None,
      "대회 열기 화면이 이름 말고 다른 것을 묻는다")
    pg.fill("#f-title", "우리 동네 문제 해결 해커톤")
    # 심사위원 수 계산 — MLH 가이드 공식대로 나오는가
    pg.fill("#pl-t", "175")
    pg.fill("#pl-m", "120")
    pg.click("#pl-go")
    pg.wait_for_timeout(600)
    plout = pg.inner_text("#pl-out")
    A("18명" in plout, f"MLH 예시(175팀 2시간 = 18명)와 다르다: {plout}")
    pg.fill("#pl-t", "60"); pg.fill("#pl-m", "60")
    pg.click("#pl-go"); pg.wait_for_timeout(600)
    A("너무 많이" in pg.inner_text("#pl-out"), "한 사람이 과하게 보는데 경고가 없다")
    ok("심사위원 수 계산 — 175팀 2시간이면 18명, 과부하면 경고")

    pg.click("#f-save")
    pg.wait_for_timeout(900)
    evs = api("/api/events")
    A(len(evs) == 1, f"대회가 1개여야 하는데 {len(evs)}")
    ev = evs[0]["id"]
    OK = pg.evaluate("localStorage.getItem('hackon.okey.' + cur)")
    A(OK and len(OK) == 10, f"운영자 열쇠가 저장되지 않았다: {OK}")
    A(evs[0]["title"] == "우리 동네 문제 해결 해커톤", f"화면이 보낸 값이 안 들어갔다: {evs[0]}")
    ok("대회 이름 하나로 개설 — 나머지는 안 묻는다")

    # 만든 뒤에 나머지를 채운다
    due = (datetime.now() + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M")
    pg.wait_for_selector("#e-save")
    pg.fill("#e-starts", "2026-10-11")
    pg.fill("#e-ends", "2026-10-12")
    pg.fill("#e-prize", "3000000")
    pg.fill("#e-topic", "생활 불편")
    pg.fill("#e-due", due)
    pg.click("#e-save")
    pg.wait_for_timeout(900)
    ee = api(f"/api/events/{ev}")
    A(ee["prize"] == 3000000 and ee["due"] == due and ee["topic"] == "생활 불편",
      f"나중에 채운 것이 안 들어갔다: {ee}")
    A(pg.evaluate("cur") == ev, "만든 뒤 그 대회로 안 옮겨 갔다")
    A(len(api(f"/api/events/{ev}")["rubric"]) == 4, "심사 기본값이 안 깔렸다")
    ok(f"대회 개설 — {ev} · 심사 기준 기본값 4항목")

    # ── 3. 참가 신청이 서버에 저장되는가 ────────────────────
    pg.wait_for_selector("#t-name")
    A(pg.query_selector("#t-contact") is None and pg.query_selector("#t-found") is None,
      "신청 화면이 처음부터 연락처와 유입 경로를 묻는다")
    pg.fill("#t-name", "하나팀")

    # 동의를 안 하면 신청이 안 된다. 화면이 먼저 막고 서버도 막는다.
    pg.click("#t-join")
    pg.wait_for_timeout(500)
    A(len(api("/api/events/" + ev + "/board")["rows"]) == 0, "동의 없이 신청이 됐다")
    A(post(f"/api/events/{ev}/teams", {"name": "서버우회팀"})[0] == 400,
      "서버가 동의 없는 신청을 받았다")
    ok("개인정보 동의 없이는 신청 불가 (화면·서버 둘 다)")

    # 실패 안내가 뜨면서 화면이 다시 그려져 칸이 비워진다. 다시 채운다.
    pg.wait_for_selector("#t-name")
    pg.fill("#t-name", "하나팀")
    pg.check("#t-agree")
    pg.click("#t-join")
    pg.wait_for_timeout(1000)

    # 신청하고 나면 두 번째 칸이 뜬다. 여기서 진짜 정보를 받는다.
    pg.wait_for_selector("#m-save", timeout=8000)
    pg.fill("#m-contact", "one@example.com")
    pg.select_option("#m-role", "만들기")
    pg.select_option("#m-found", "캠퍼스픽")
    pg.fill("#m-note", "골목 보행 불편을 풀고 싶습니다")
    pg.check("#m-photo")
    pg.click("#m-save")
    pg.wait_for_timeout(900)
    A(post(f"/api/events/{ev}/teams", {"name": "가나다팀", "agree": True})[0] == 201, "둘째 팀이 안 들어갔다")
    rows = api(f"/api/events/{ev}/board", OK)["rows"]
    A(len(rows) == 2, f"참가팀이 2여야 하는데 {len(rows)}")
    A(all(r["score"] == 0 and not r["done"] for r in rows), "심사 전인데 점수가 있다")
    one = [r for r in rows if r["name"] == "하나팀"][0]
    A(one["role"] == "만들기" and one["found"] == "캠퍼스픽",
      f"신청 칸이 안 저장됐다: {one}")
    A(one["agreed"] and one["photo"] == 1, f"동의 기록이 안 남았다: {one}")
    ok("문간에 발 담그기 — 이름·동의로 신청하고 나머지는 그다음 칸에서 받는다")
    ok("참가 신청 저장 — 2팀 · 역할과 유입 경로까지")

    A(post(f"/api/events/{ev}/teams", {"name": "하나팀", "agree": True})[0] == 409,
      "같은 팀 이름이 두 번 들어갔다")
    ok("같은 팀 이름 차단 (409)")

    # ── 4. 참가팀이 제출하고, 심사위원이 점수를 넣는가 ──────
    visit(f"/app#{ev}")
    pg.click("tr[data-team]")
    pg.wait_for_selector("#s-url")
    pg.fill("#s-url", "https://example.com/walk")
    pg.fill("#s-note", "보행 장벽을 미리 알려 주는 지도")
    pg.click("#s-save")
    pg.wait_for_timeout(700)
    pg.wait_for_selector("#j-name")
    pg.fill("#j-name", "심사1")
    pg.evaluate("""document.querySelectorAll('.j-v').forEach((i,n)=>{ i.value = [95,90,85,80][n] })""")
    pg.click("#j-save")
    pg.wait_for_timeout(700)

    rows = api(f"/api/events/{ev}/board", OK)["rows"]
    top = rows[0]
    A(top["done"] and top["url"] == "https://example.com/walk", f"제출이 안 붙었다: {top}")
    A(top["judges"] == 1, f"심사위원 수가 1이어야 하는데 {top['judges']}")
    # 95*.30 + 90*.30 + 85*.25 + 80*.15 = 88.75 → 88.8
    A(abs(top["score"] - 88.8) < 0.05, f"가중 평균이 틀렸다: {top['score']}")
    A(rows[1]["score"] == 0, "심사 안 한 팀이 점수를 받았다")
    ok(f"제출 · 심사 저장 — 1등 {top['name']} {top['score']}점 (가중 평균)")

    # 순위 화면이 상태와 심사 진행을 보여주는가 — 심사 중에 제일 자주 나오는 질문이다
    visit(f"/app#{ev}")
    txt = pg.inner_text("#view")
    A("모집중" in txt, f"대회 상태 배지가 없다: {txt[:80]}")
    A("심사 진행" in txt and "심사위원 1명" in txt, "심사 진행 현황이 안 보인다")
    A("전원이 다 본 팀 1/2팀" in txt, f"다 본 팀 수가 틀렸다: {txt}")
    pg.click("tr[data-team]")
    pg.wait_for_selector("#s-url")
    tt = pg.inner_text("#view")
    A("본 사람 심사1" in tt, f"누가 봤는지 안 나온다: {tt[:120]}")
    ok("상태 배지 · 심사 진행 현황 (전원이 다 본 팀 1/2)")

    # ── 심사평과 성적표 — 불만 1위가 "왜 떨어졌는지 모른다" 였다 ──
    jc3 = b.new_context()
    jp3 = jc3.new_page()
    jp3.goto(f"{BASE}/j/{ev}")
    jp3.wait_for_selector("body[data-ready='1']", timeout=8000)
    jp3.fill("#jn", "심사1"); jp3.click("#jn-go"); jp3.wait_for_timeout(700)
    tid = str(top["id"])
    jp3.fill(f".jg-{tid}", "문제를 잘 골랐습니다")
    jp3.fill(f".jn2-{tid}", "실제로 쓰는 사람을 한 명만 만나 보세요")
    jp3.click(f'[data-jsave="{tid}"]')
    jp3.wait_for_timeout(800)
    jc3.close()

    # 공개하기 전에는 팀도 못 본다
    cd = api(f"/api/teams/{tid}/card")
    A(cd["opened"] is False, f"공개 전인데 성적표가 열렸다: {cd}")
    A(post(f"/api/events/{ev}/open", {"open": True}, OK)[0] == 200, "결과 공개 실패")
    cd = api(f"/api/teams/{tid}/card")
    A(cd["opened"] is True and len(cd["items"]) == 4, f"성적표가 안 열렸다: {cd}")
    A(cd["reviews"] and "문제를" in cd["reviews"][0]["good"], f"심사평이 없다: {cd['reviews']}")
    A("judge" not in cd["reviews"][0], "심사평에 심사위원 이름이 붙었다")
    # 어디서 깎였는지 보이는가 — 항목별 점수와 그 항목 배점
    A(all("got" in i and "weight" in i for i in cd["items"]), "항목별 분해가 없다")
    ok(f"성적표 — {len(cd['items'])}개 항목 분해 + 심사평 {len(cd['reviews'])}건 (이름 없이)")

    # 팀 화면에서 실제로 보이는가
    visit(f"/app#{ev}")
    pg.click("tr[data-team]")
    pg.wait_for_timeout(800)
    ctxt = pg.inner_text("#view")
    A("내 점수" in ctxt and "심사평" in ctxt and "문제를 잘 골랐습니다" in ctxt,
      f"팀 화면에 성적표가 안 보인다: {ctxt[:200]}")
    ok("팀이 자기 점수 분해와 심사평을 본다")
    post(f"/api/events/{ev}/open", {"open": False}, OK)

    # ── 심사 눈높이 — 운영자만 본다 ─────────────────────────
    # 짜게 주는 심사위원을 하나 더 넣어 차이를 만든다
    A(post(f"/api/teams/{top['id']}/score",
           {"judge": "짠심사", "values": {"idea": 55, "make": 55, "use": 55, "tell": 55}})[0] == 200,
      "둘째 심사위원이 못 넣었다")
    sp = api(f"/api/events/{ev}/spread", OK)
    A(sp["gap"] >= 15 and sp["warn"], f"차이가 큰데 경고가 없다: {sp}")
    A(sp["top"] == "심사1" and sp["bottom"] == "짠심사", f"후한/짠 사람이 틀렸다: {sp}")
    visit(f"/app#{ev}")
    stxt = pg.inner_text("#view")
    A("심사 눈높이" in stxt and "차이가 큽니다" in stxt, f"경고가 화면에 없다: {stxt[:200]}")
    ok(f"심사 눈높이 — 차이 {sp['gap']}점, 캘리브레이션 권고")

    # 심사위원에게는 안 새야 한다. 서로 눈치를 보게 된다.
    jc2 = b.new_context()
    jp2 = jc2.new_page()
    jp2.goto(f"{BASE}/j/{ev}")
    jp2.wait_for_selector("body[data-ready='1']", timeout=8000)
    jp2.fill("#jn", "최심사"); jp2.click("#jn-go"); jp2.wait_for_timeout(700)
    j2 = jp2.inner_text("#view")
    for leak in ["심사 눈높이", "짠심사", "심사1"]:
        A(leak not in j2, f"심사 화면에 '{leak}' 가 샜다")
    jc2.close()
    ok("심사 눈높이가 심사위원에게는 안 보인다")

    # 로고를 누르면 처음으로 — 어디서 헤매도 여기로 돌아온다
    visit(f"/app#{ev}")
    pg.click('nav button[data-t="spon"]')
    pg.wait_for_timeout(500)
    pg.click("#b-home")
    pg.wait_for_timeout(600)
    A(pg.evaluate("tab") == "home", f"로고를 눌렀는데 처음으로 안 간다: {pg.evaluate('tab')}")
    A("열린 대회" in pg.inner_text("#view"), "처음 화면이 아니다")
    ok("로고를 누르면 처음 화면으로")

    # ── 같이 할 사람 찾기 — 혼자 온 사람이 돌아가지 않게 ────
    # 혼자 온 사람 하나와 사람 찾는 팀 하나를 만든다
    _, so = post(f"/api/events/{ev}/teams", {"name": "혼자온사람", "agree": True})
    A(post(f"/api/teams/{so['id']}/more",
           {"solo": True, "role": "기획", "note": "골목 지도를 만들고 싶습니다"})[0] == 200,
      "혼자 온 사람 정보가 안 들어갔다")
    A(post(f"/api/teams/{top['id']}/more", {"want": "화면 만드는 분 한 분", "size": 2})[0] == 200,
      "찾는 사람이 안 들어갔다")
    cw = api(f"/api/events/{ev}/crew")
    A(len(cw["solo"]) == 1 and cw["solo"][0]["name"] == "혼자온사람", f"혼자 온 사람이 안 잡힌다: {cw}")
    A(len(cw["looking"]) == 1 and cw["looking"][0]["size"] == 2, f"사람 찾는 팀이 안 잡힌다: {cw}")
    A("contact" not in json.dumps(cw), "팀 짜기 자료에 연락처가 실렸다")
    ok(f"같이 할 사람 — 혼자 {len(cw['solo'])}명 · 찾는 팀 {len(cw['looking'])}팀 (연락처 안 실림)")

    # 공개 페이지에서 보이는가
    cctx = b.new_context()
    cp = cctx.new_page()
    cp.goto(f"{BASE}/e/{ev}")
    cp.wait_for_selector("body[data-ready='1']", timeout=8000)
    ctxt = cp.inner_text("#view")
    A("같이 할 사람 찾기" in ctxt and "혼자온사람" in ctxt and "화면 만드는 분" in ctxt,
      f"공개 페이지에 팀 짜기가 없다: {ctxt[:200]}")
    A("one@example.com" not in ctxt, "공개 페이지에 연락처가 샜다")
    cctx.close()
    ok("공개 페이지에서 같이 할 사람이 보인다")

    # ── 현장 화면 — 벽에 걸어 두는 것 ───────────────────────
    tctx = b.new_context(viewport={"width": 1280, "height": 720})
    tp = tctx.new_page()
    tp.on("pageerror", lambda e: errs.append("현장:" + str(e)))
    tp.goto(f"{BASE}/tv/{ev}")
    tp.wait_for_selector("body[data-ready='1']", timeout=8000)
    ttxt = tp.inner_text("#view")
    A("우리 동네 문제 해결 해커톤" in ttxt, f"제목이 없다: {ttxt[:100]}")
    A("지금" in ttxt and "제출" in ttxt, f"지금 순서와 제출 현황이 없다: {ttxt[:200]}")
    A("/e/" + ev in ttxt.replace(" ", ""), f"접속 주소가 없다: {ttxt}")
    A(tp.evaluate("document.body.classList.contains('tv')"), "큰 화면 모드가 아니다")
    A(tp.evaluate("document.querySelector('nav').style.display") == "none", "현장 화면에 탭이 보인다")
    # 벽에 거는 화면이라 개인정보가 실리면 안 된다
    for leak in ["one@example.com", "연락처", "협찬", "심사 눈높이"]:
        A(leak not in ttxt, f"현장 화면에 '{leak}' 가 샜다")
    tvd = api(f"/api/events/{ev}/tv")
    A(tvd["teams"] >= 2 and "waiting" in tvd, f"현장 자료가 부실하다: {tvd}")
    A("contact" not in json.dumps(tvd), "현장 자료에 연락처가 실렸다")
    ok(f"현장 화면 /tv/<대회id> — 제출 {tvd['done']}/{tvd['teams']}팀 · 개인정보 안 샘")

    # 진행 순서 — 기본값이 깔리고 고칠 수 있다
    A(len(tvd["plan"]) == 9, f"기본 진행표가 안 깔렸다: {len(tvd['plan'])}")
    visit(f"/app#{ev}")
    if not pg.is_visible("#e-plan"):
        pg.click("summary:has-text('고치기')")
        pg.wait_for_timeout(300)
    plan_text = chr(10).join(["09:00 모여요", "13:00 만들기", "18:00 발표"])
    pg.fill("#e-plan", plan_text)
    pg.click("#e-save")
    pg.wait_for_timeout(900)
    pl = api(f"/api/events/{ev}")["plan"]
    A(len(pl) == 3 and pl[0]["at"] == "09:00" and pl[0]["what"] == "모여요",
      f"진행 순서가 안 고쳐졌다: {pl}")
    tctx.close()
    ok("진행 순서 — 기본 9줄이 깔리고 운영자가 고친다")

    # ── 등록 데스크 — 당일 아침에 쓰는 화면 ─────────────────
    visit(f"/app#{ev}")
    A("등록 데스크" in pg.inner_text("#view"), "등록 데스크가 없다")
    # 지금 안 쓰는 것은 접혀 있다. 당일 아침에 펼친다.
    def openFold(name):
        pg.click(f"summary:has-text('{name}')")
        pg.wait_for_timeout(300)
    openFold("등록 데스크")
    pg.click("[data-came]")
    pg.wait_for_timeout(700)
    o1 = api(f"/api/events/{ev}/outcomes", OK)
    A(o1["came"] == 1, f"체크인이 안 됐다: {o1['came']}")
    openFold("등록 데스크")
    pg.click("[data-came]")           # 잘못 눌렀을 때 되돌린다
    pg.wait_for_timeout(700)
    A(api(f"/api/events/{ev}/outcomes", OK)["came"] == 0, "체크인 취소가 안 된다")
    openFold("등록 데스크")
    pg.click("[data-came]")
    pg.wait_for_timeout(700)
    ok("등록 데스크 체크인 — 눌렀다 다시 누르면 취소")

    # ── 마감 — 남은 시간이 뜨고, 지나면 서버가 막는가 ──────
    visit(f"/app#{ev}")
    txt = pg.inner_text("#view")
    A("제출 마감까지" in txt, f"남은 시간이 안 보인다: {txt[:100]}")
    ok("마감까지 남은 시간이 뜬다")

    # 공유 주소 — localhost 로 나가면 참가자 폰에서 안 열린다
    share = pg.inner_text(".share")
    net = api("/api/health")["net"]
    if net:
        A("localhost" not in share and "127.0.0.1" not in share,
          f"공유 주소가 랜 주소가 아니다: {share}")
        A(net[0] in share, f"공유 주소에 랜 주소가 없다: {share} / {net}")
        ok(f"공유 주소가 랜 주소로 나간다 — {share.strip()}")
    else:
        ok("랜 주소가 없는 환경이라 공유 주소 검사는 건너뜀")

    # 마감이 지난 대회를 따로 만들어 서버가 막는지 본다.
    # 화면만 잠그면 주소를 아는 사람은 그냥 낸다. 그래서 서버를 때려서 확인한다.
    gone = (datetime.now() - timedelta(minutes=1)).strftime('%Y-%m-%dT%H:%M')
    _, late = post('/api/events', {'title': '마감지난대회', 'due': gone})
    _, lt = post(f"/api/events/{late['id']}/teams", {'name': '늦은팀', 'agree': True})
    A(post(f"/api/teams/{lt['id']}/submit", {'url': 'https://example.com/late'})[0] == 409,
      '마감이 지났는데 제출이 됐다')
    ok('마감 뒤 제출 차단 (409)')

    # 인터넷이 터졌을 때 진행자가 미룬다. 미룬 뒤에는 다시 받아야 한다.
    LK = late['okey']
    code, r = post(f"/api/events/{late['id']}/extend", {'minutes': 60}, LK)
    A(code == 200, f'연장 실패 {code}')
    A(post(f"/api/teams/{lt['id']}/submit", {'url': 'https://example.com/late'})[0] == 200,
      '미뤘는데도 제출이 막힌다')
    ok(f"마감 60분 연장 → 다시 제출됨 (새 마감 {r['due']})")

    # 심사위원 이름이 같으면 덮어쓴다. 두 번 눌러도 사람 수가 안 늘어야 한다.
    # 절대값을 박아 두지 않는다 — 앞 단계에서 심사위원이 늘면 그때 깨진다.
    was = [r for r in api(f"/api/events/{ev}/board", OK)["rows"] if r["id"] == top["id"]][0]["judges"]
    A(post(f"/api/teams/{top['id']}/score",
           {"judge": "심사1", "values": {"idea": 95, "make": 90, "use": 85, "tell": 80}})[0] == 200,
      "같은 심사위원이 다시 못 넣는다")
    now = [r for r in api(f"/api/events/{ev}/board", OK)["rows"] if r["id"] == top["id"]][0]["judges"]
    A(now == was, f"같은 사람이 두 명으로 셌다: {was} → {now}")
    ok("같은 심사위원 재저장 → 덮어쓰기 (중복 안 됨)")

    A(post(f"/api/teams/{top['id']}/score", {"judge": "심사2", "values": {"nope": 10}})[0] == 400,
      "없는 심사 항목이 들어갔다")
    A(post(f"/api/teams/{top['id']}/score", {"judge": "심사2", "values": {"idea": 120}})[0] == 400,
      "100 넘는 점수가 들어갔다")
    A(post("/api/events", {"title": "배점깨진대회",
                           "rubric": [{"key": "a", "label": "가", "weight": 50}]})[0] == 400,
      "배점 합 100 이 아닌데 대회가 만들어졌다")
    ok("심사 항목·점수 범위·배점 합 차단 (400)")

    # ── 심사위원 전용 링크 — 점수만 넣고 순위는 못 본다 ─────
    jctx = b.new_context(viewport={"width": 460, "height": 1100})
    jp = jctx.new_page()
    jp.on("pageerror", lambda e: errs.append("심사:" + str(e)))
    jp.goto(f"{BASE}/j/{ev}")
    jp.wait_for_selector("body[data-ready='1']", timeout=8000)
    A(jp.evaluate("document.querySelector('nav').style.display") == "none", "심사 화면에 아래 탭이 보인다")
    jp.fill("#jn", "박심사")
    jp.click("#jn-go")
    jp.wait_for_timeout(700)
    jtxt = jp.inner_text("#view")
    # 팀 수를 박아 두지 않는다. 앞 단계에서 팀이 늘면 바뀐다.
    nteams = len(api(f"/api/events/{ev}/judge")["teams"])
    A(f"아직 안 본 팀 {nteams}팀" in jtxt, f"남은 팀 수가 틀렸다(={nteams}): {jtxt[:120]}")

    # 새면 안 되는 것들. 화면에서 감추는 게 아니라 서버가 안 준다.
    for leak in ["완주율", "협찬", "면접 연결", "명단 내려받기", "88.8"]:
        A(leak not in jtxt, f"심사 화면에 '{leak}' 가 샜다")
    for bad_id in ["#b-csv", "#p-add", "#o-add", "#h-add", "#b-ext", "#b-report", "#t-join"]:
        A(jp.query_selector(bad_id) is None, f"심사 화면에 {bad_id} 가 있다")
    ok("심사 링크 /j/<대회id> — 순위·협찬·성과가 안 샌다")

    # 점수를 넣으면 저장되고, 남은 팀이 줄어든다
    first = jp.query_selector("[data-jsave]").get_attribute("data-jsave")
    jp.evaluate("(id) => document.querySelectorAll('.jv-' + id).forEach((i, n) => { i.value = [60,65,70,75][n] })", first)
    jp.click(f'[data-jsave="{first}"]')
    jp.wait_for_timeout(800)
    jv = api(f"/api/events/{ev}/judge?judge=" + urllib.parse.quote("박심사"))
    A(jv["left"] == nteams - 1, f"남은 팀이 안 줄었다: {jv['left']} (팀 {nteams})")
    scored = [t for t in jv["teams"] if str(t["id"]) == first][0]
    A(scored["mine"]["idea"] == 60, f"내 점수가 안 저장됐다: {scored['mine']}")
    ok(f"심사 링크에서 점수 저장 — 남은 팀 {jv['left']}팀")
    jctx.close()

    # ── 운영자 열쇠 — 개발자 스물네 명에게 공개 링크를 뿌린다 ──
    # 열쇠 없이 되면 안 되는 것들
    A(code_of(f"/api/events/{ev}/spread") == 403, "열쇠 없이 심사 눈높이가 보인다")
    guest = api(f"/api/events/{ev}/board")
    A(all("contact" not in r for r in guest["rows"]), "열쇠 없이 연락처가 나온다")
    A(all("came" not in r for r in guest["rows"]), "열쇠 없이 체크인 정보가 나온다")
    go = api(f"/api/events/{ev}/outcomes")
    A("found" not in go and "list" not in go, "열쇠 없이 유입 경로·성과 명단이 나온다")
    for path, body_ in [(f"/api/events/{ev}/sponsors", {"name": "몰래"}),
                        (f"/api/events/{ev}/outcomes", {"kind": "면접"}),
                        (f"/api/events/{ev}/support", {"name": "몰래"}),
                        (f"/api/events/{ev}/open", {"open": True}),
                        (f"/api/events/{ev}/extend", {"minutes": 30})]:
        A(post(path, body_)[0] == 403, f"열쇠 없이 {path} 가 됐다")
    A(post(f"/api/teams/{top['id']}/checkin", {})[0] == 403, "열쇠 없이 체크인이 됐다")

    # 대회 삭제 — 이게 제일 위험하다
    dreq = urllib.request.Request(f"{BASE}/api/events/{ev}", method="DELETE")
    try:
        urllib.request.urlopen(dreq)
        A(False, "열쇠 없이 대회가 지워졌다")
    except urllib.error.HTTPError as e:
        A(e.code == 403, f"403 이어야 하는데 {e.code}")
    A(len(api("/api/events")) >= 1, "대회가 사라졌다")

    # 틀린 열쇠도 막힌다
    A(code_of(f"/api/events/{ev}/spread", "0000000000") == 403, "틀린 열쇠가 통과했다")
    A(code_of(f"/api/events/{ev}/spread", OK) == 200, "맞는 열쇠가 막혔다")
    ok("운영자 열쇠 — 삭제·연락처·성과·체크인이 전부 막힌다 (403)")

    # 참가자가 해야 하는 일은 열쇠 없이도 된다
    A(code_of(f"/api/events/{ev}/judge") == 200, "심사 화면이 막혔다")
    A(code_of(f"/api/events/{ev}") == 200, "대회 정보가 막혔다")
    ok("신청·제출·심사·공개 페이지는 열쇠 없이 그대로 열린다")

    # 통째로 내려받기 — 노트북이 죽으면 이걸로 살린다. 열쇠가 있어야 한다.
    A(code_of(f"/api/events/{ev}/dump") == 403, "열쇠 없이 백업이 받아졌다")
    dp = api(f"/api/events/{ev}/dump", OK)
    A(dp["teams"] and dp["scores"] and "okey" not in dp["event"],
      f"백업 내용이 부실하다: {list(dp)}")
    ok(f"통째로 내려받기 — 팀 {len(dp['teams'])} · 점수 {len(dp['scores'])}건, 열쇠는 안 담김")

    # ── 5. 정원은 서버가 막는가 ─────────────────────────────
    code, small = post("/api/events", {"title": "정원1", "cap": 1, "starts": "2026-11-01"})
    A(code == 201, "정원 대회 생성 실패")
    A(post(f"/api/events/{small['id']}/teams", {"name": "첫팀", "agree": True})[0] == 201,
      "첫 팀이 못 들어갔다")
    A(post(f"/api/events/{small['id']}/teams", {"name": "둘째팀", "agree": True})[0] == 409,
      "정원 찬 대회에 들어가졌다")
    ok("정원 초과 차단 (409)")

    # ── 6. 협찬사에게 줄 숫자가 쌓이는가 (이 서비스의 차별점) ──
    visit(f"/app#{ev}")
    pg.click('nav button[data-t="spon"]')

    # 협찬사 등록 — 서버에는 있었는데 화면이 없어서 공개 페이지가 영영 비어 있던 자리다
    pg.wait_for_selector("#p-name")
    pg.fill("#p-name", "오픈에이아이")
    pg.select_option("#p-kind", "크레딧")
    pg.fill("#p-amt", "2000000")
    pg.click("#p-add")
    pg.wait_for_timeout(700)
    sp = api(f"/api/events/{ev}")["sponsors"]
    A(len(sp) == 1 and sp[0]["name"] == "오픈에이아이" and sp[0]["kind"] == "크레딧",
      f"협찬사가 안 들어갔다: {sp}")
    ok(f"협찬사 등록 — {sp[0]['name']} ({sp[0]['kind']})")

    pg.wait_for_selector("#o-add")
    pg.select_option("#o-kind", "면접")
    pg.fill("#o-who", "어느회사")
    pg.click("#o-add")
    pg.wait_for_timeout(700)
    o = api(f"/api/events/{ev}/outcomes", OK)
    # 숫자를 박아 두지 않는다. 앞 단계에서 팀이 늘면 완주율이 바뀐다.
    want = round(o["finished"] / o["teams"] * 1000) / 10
    A(o["finishRate"] == want, f"완주율 계산이 틀렸다: {o['finishRate']} != {want}")
    A(o["interview"] == 1, f"면접 연결이 1 이어야 하는데 {o['interview']}")
    A(f"{o['finishRate']}%" in pg.content() and "완주율" in pg.content(), "화면에 숫자가 안 나온다")
    ok(f"성과 기록 — 완주율 {o['finishRate']}% · 면접 {o['interview']}건")

    # ── 사후 지원 — 이게 '보장' 이다. 기록만 하는 표로는 약속이 안 된다 ──
    pg.click("summary:has-text('사후 지원')")
    pg.wait_for_timeout(300)
    pg.fill("#h-name", "박실무")
    pg.fill("#h-org", "어느회사")
    pg.fill("#h-can", "도입 검토를 같이 봐 줍니다")
    pg.click("#h-add")
    pg.wait_for_timeout(800)
    if not pg.is_visible("#a-add"):
        pg.click("summary:has-text('사후 지원')")
        pg.wait_for_timeout(300)
    pg.wait_for_selector("#a-add")
    pg.click("#a-add")
    pg.wait_for_timeout(800)
    sup = api(f"/api/events/{ev}/support", OK)
    A(sup["promised"] == 1, f"배정이 안 됐다: {sup}")
    # 기한을 안 주면 대회 끝나고 14일. 대회가 10/12 에 끝나니 10/26 이어야 한다.
    A(sup["rows"][0]["due"] == "2026-10-26", f"기본 기한이 틀렸다: {sup['rows'][0]['due']}")
    A(sup["done"] == 0 and sup["late"] == 0, f"처음부터 지킴/늦음이 있다: {sup}")
    ok(f"사후 지원 배정 — {sup['rows'][0]['team_name']} ← {sup['rows'][0]['helper_name']} "
       f"({sup['rows'][0]['due']}까지)")

    # 했음을 누르면 지킨 것으로 넘어간다
    if not pg.is_visible("[data-done]"):
        pg.click("summary:has-text('사후 지원')")
        pg.wait_for_timeout(300)
    pg.click("[data-done]")
    pg.wait_for_timeout(800)
    sup = api(f"/api/events/{ev}/support", OK)
    A(sup["done"] == 1, f"완료 표시가 안 됐다: {sup}")
    ok("사후 지원 완료 표시 — 약속 1건 중 1건 지킴")

    # 유입 경로 집계 — 2회차 홍보비를 어디에 쓸지 정하는 근거다
    sp_txt = pg.inner_text("#view")
    A("어디서 왔나" in sp_txt and "캠퍼스픽" in sp_txt, f"유입 경로가 안 보인다: {sp_txt[:150]}")
    # '안 적음' 이 섞여도 실제 경로가 잡히면 된다
    got = {f["k"]: f["c"] for f in o["found"]}
    A(got.get("캠퍼스픽") == 1, f"집계가 틀렸다: {o['found']}")
    ok(f"유입 경로 집계 — 캠퍼스픽 {got['캠퍼스픽']}팀 (안 적은 팀 {got.get('안 적음', 0)})")

    # ── 7. 공개 링크는 로그인 없이 열리고, 아무것도 못 고치는가 ──
    ctx = b.new_context(viewport={"width": 460, "height": 1100})   # 처음 온 사람을 흉내 낸다
    pub = ctx.new_page()
    pub.on("pageerror", lambda e: errs.append("공개:" + str(e)))
    pub.goto(f"{BASE}/e/{ev}")
    pub.wait_for_selector("body[data-ready='1']", timeout=8000)
    A(pub.evaluate("document.querySelector('nav').style.display") == "none", "공개 화면에 아래 탭이 보인다")
    # 공개 화면에는 참가 신청 칸만 있어야 한다. 제출·심사·협찬·성과는 손댈 수 없다.
    for bad_id in ["#s-save", "#j-save", "#p-add", "#o-add", "#b-ext", "#f-save"]:
        A(pub.query_selector(bad_id) is None, f"공개 화면에 {bad_id} 가 있다")
    ids = [el.get_attribute("id") for el in
           pub.query_selector_all("#view input, #view textarea, #view select, #view button")]
    A(all(i and i.startswith("t-") for i in ids), f"공개 화면에 신청 말고 다른 칸이 있다: {ids}")
    txt = pub.inner_text("#view")
    for must in ["우리 동네 문제 해결 해커톤", "하나팀", "완주율", "심사 기준",
                 "함께한 곳", "오픈에이아이",
                 "끝난 뒤에도 봐 드립니다", "박실무",
                 "만든 것은 팀의 것입니다", "생성형 AI", "행동강령"]:
        A(must in txt, f"공개 화면에 '{must}' 가 없다")
    A("example.com/walk" in txt, "제출작 링크가 공개 화면에 없다")
    ok("공개 링크 — 규칙(결과물 권리·AI 허용·행동강령)이 함께 보인다")

    # 모집 글에 이 주소를 쓴다. 여기서 바로 신청이 돼야 한다.
    before = len(api(f"/api/events/{ev}/board", OK)["rows"])
    pub.fill("#t-name", "공개링크팀")
    pub.check("#t-agree")
    pub.click("#t-join")
    pub.wait_for_timeout(1000)
    after = api(f"/api/events/{ev}/board", OK)["rows"]
    A(len(after) == before + 1, f"공개 링크에서 신청이 안 됐다: {before} → {len(after)}")
    # 공개 링크에서도 두 번째 칸이 뜬다
    pub.wait_for_selector("#m-save", timeout=8000)
    pub.select_option("#m-found", "위비티")
    pub.click("#m-save")
    pub.wait_for_timeout(900)
    A([r for r in api(f"/api/events/{ev}/board", OK)["rows"]
       if r["name"] == "공개링크팀"][0]["found"] == "위비티", "두 번째 칸이 저장되지 않았다")
    ok("공개 링크에서 바로 참가 신청 — 모집 글에 이 주소를 쓴다")

    # ── 결과 보고서 — 협찬사에게 보내는 물건. 링크 하나가 곧 보고서다 ──
    # 운영자 브라우저에서 연다. 열쇠가 거기 있어서 전체가 나온다.
    rp = pg
    rp.goto(f"{BASE}/e/{ev}/report")
    rp.wait_for_selector("body[data-ready='1']", timeout=8000)
    rtxt = rp.inner_text("#view")
    must = {
        "결과 보고서": "제목",
        "하나. 무엇을 했나": "개요",
        "어디서 왔나": "유입 경로",
        "협찬해 주신 곳": "협찬사",
        "오픈에이아이": "협찬사 이름",
        "돌려드리는 숫자": "성과 네 숫자",
        "끝난 뒤에 한 일": "사후 지원",
        "박실무": "봐 준 사람 이름",
        "결과물": "제출작",
        "example.com/walk": "제출 링크",
        "다음 회차": "마무리",
    }
    for k, why in must.items():
        A(k in rtxt, f"보고서에 {why} 가 없다 ({k})")
    # 빈칸이 있으면 안 보내느니만 못하다. 숫자를 박아 두지 말고 서버 값과 대조한다.
    o2 = api(f"/api/events/{ev}/outcomes", OK)
    A(f"{o2['finishRate']}%" in rtxt,
      f"완주율이 서버 값과 다르다 (서버 {o2['finishRate']}%)")
    A(f"{o2['finished']}/{o2['teams']}" in rtxt, "완주 건수가 안 채워졌다")
    A("약속 1건 중 1건" in rtxt, "사후 지원 이행이 안 채워졌다")
    A(rp.query_selector("nav") is None or
      rp.evaluate("document.querySelector('nav').style.display") == "none", "보고서에 아래 탭이 보인다")

    # 손님에게도 깨지지 않고 열려야 한다. 심사 눈높이 같은 운영자 것만 빠진다.
    gp = ctx.new_page()
    gp.on("pageerror", lambda e: errs.append("보고서손님:" + str(e)))
    gp.goto(f"{BASE}/e/{ev}/report")
    gp.wait_for_selector("body[data-ready='1']", timeout=8000)
    gtxt = gp.inner_text("#view")
    A("결과 보고서" in gtxt and "돌려드리는 숫자" in gtxt, f"손님 보고서가 깨졌다: {gtxt[:150]}")
    A("어디서 왔나" not in gtxt, "손님에게 유입 경로가 샜다")
    ctx.close()
    ok("결과 보고서 /e/<대회id>/report — 11개 항목이 실제 데이터로 채워짐")

    # ── 8. file:// 데모 모드가 안 깨졌는가 (캡처·발표가 이걸로 돈다) ──
    pg.goto("about:blank")
    pg.goto("file:///" + HTML.replace("\\", "/"))
    pg.wait_for_selector("body[data-ready='1']", timeout=8000)
    A(pg.evaluate("LIVE") is False, "file:// 인데 서버 모드로 붙었다")
    A(pg.evaluate("document.querySelectorAll('.card').length") > 0, "데모 목록이 비었다")
    A("데모" in pg.inner_text("#mode"), "데모 표시가 안 뜬다")
    ok("file:// 데모 모드 정상 (캡처가 안 깨진다)")

    b.close()

# ── 9. 윈도우 프로그램이 켤 준비가 되어 있는가 ──────────
# 창을 실제로 띄우지는 않는다. --check 는 브라우저·포트·화면 파일만 확인하고 끝난다.
r = subprocess.run(['node', 'desktop.js', '--check'],
                   cwd=os.path.dirname(os.path.abspath(__file__)),
                   capture_output=True, text=True, encoding='utf-8')
A(r.returncode == 0, 'desktop.js --check 실패: ' + (r.stderr or ''))
A('못 찾음' not in r.stdout, '앱 창을 띄울 브라우저가 없다: ' + r.stdout)
A('화면 파일  있음' in r.stdout, '화면 파일을 못 찾는다: ' + r.stdout)
ok('윈도우 프로그램 준비됨 (앱 창 브라우저 · 포트 · 화면 파일)')

A(not errs, "JS 에러: " + "; ".join(errs))
print(f"\n완주 테스트 통과 — {step}단계, JS 에러 없음")
