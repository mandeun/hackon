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

sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # 윈도우 콘솔이 cp949 라 한글이 깨진다

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


def api(path):
    with urllib.request.urlopen(BASE + path) as r:
        return json.load(r)


def post(path, payload):
    req = urllib.request.Request(
        BASE + path, method="POST", data=json.dumps(payload).encode(),
        headers={"content-type": "application/json"})
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

    def visit(path="/"):
        pg.goto("about:blank")
        pg.goto(BASE + path)
        pg.wait_for_selector("body[data-ready='1']", timeout=8000)

    # ── 1. 화면이 서버에 붙었는가 ───────────────────────────
    visit()
    A(pg.evaluate("LIVE") is True, "서버 모드로 안 붙었다")
    A("아직 열린 대회가 없습니다" in pg.content(), "빈 DB 인데 대회가 있다")
    ok("빈 서버에 붙어서 '대회 없음' 을 보여 준다")

    # ── 2. 개인이 5분 안에 대회를 연다 (기획안 1번 기능) ────
    pg.click('nav button[data-t="make"]')
    pg.wait_for_selector("#f-title")
    pg.fill("#f-title", "우리 동네 문제 해결 해커톤")
    pg.fill("#f-host", "유재원")
    pg.fill("#f-topic", "생활 불편")
    pg.fill("#f-starts", "2026-10-11")
    pg.fill("#f-ends", "2026-10-12")
    pg.fill("#f-prize", "3000000")
    due = (datetime.now() + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M")
    pg.fill("#f-due", due)
    pg.click("#f-save")
    pg.wait_for_timeout(700)
    evs = api("/api/events")
    A(len(evs) == 1, f"대회가 1개여야 하는데 {len(evs)}")
    ev = evs[0]["id"]
    A(evs[0]["title"] == "우리 동네 문제 해결 해커톤", f"화면이 보낸 값이 안 들어갔다: {evs[0]}")
    A(pg.evaluate("cur") == ev, "만든 뒤 그 대회로 안 옮겨 갔다")
    A(len(api(f"/api/events/{ev}")["rubric"]) == 4, "심사 기본값이 안 깔렸다")
    ok(f"대회 개설 — {ev} · 심사 기준 기본값 4항목")

    # ── 3. 참가 신청이 서버에 저장되는가 ────────────────────
    pg.wait_for_selector("#t-name")
    pg.fill("#t-name", "하나팀")
    pg.fill("#t-contact", "one@example.com")
    pg.select_option("#t-role", "만들기")
    pg.select_option("#t-found", "캠퍼스픽")
    pg.fill("#t-note", "골목 보행 불편을 풀고 싶습니다")
    pg.click("#t-join")
    pg.wait_for_timeout(700)
    A(post(f"/api/events/{ev}/teams", {"name": "가나다팀"})[0] == 201, "둘째 팀이 안 들어갔다")
    rows = api(f"/api/events/{ev}/board")["rows"]
    A(len(rows) == 2, f"참가팀이 2여야 하는데 {len(rows)}")
    A(all(r["score"] == 0 and not r["done"] for r in rows), "심사 전인데 점수가 있다")
    one = [r for r in rows if r["name"] == "하나팀"][0]
    A(one["role"] == "만들기" and one["found"] == "캠퍼스픽",
      f"신청 칸이 안 저장됐다: {one}")
    ok("참가 신청 저장 — 2팀 · 역할과 유입 경로까지")

    A(post(f"/api/events/{ev}/teams", {"name": "하나팀"})[0] == 409, "같은 팀 이름이 두 번 들어갔다")
    ok("같은 팀 이름 차단 (409)")

    # ── 4. 참가팀이 제출하고, 심사위원이 점수를 넣는가 ──────
    visit(f"/#{ev}")
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

    rows = api(f"/api/events/{ev}/board")["rows"]
    top = rows[0]
    A(top["done"] and top["url"] == "https://example.com/walk", f"제출이 안 붙었다: {top}")
    A(top["judges"] == 1, f"심사위원 수가 1이어야 하는데 {top['judges']}")
    # 95*.30 + 90*.30 + 85*.25 + 80*.15 = 88.75 → 88.8
    A(abs(top["score"] - 88.8) < 0.05, f"가중 평균이 틀렸다: {top['score']}")
    A(rows[1]["score"] == 0, "심사 안 한 팀이 점수를 받았다")
    ok(f"제출 · 심사 저장 — 1등 {top['name']} {top['score']}점 (가중 평균)")

    # 순위 화면이 상태와 심사 진행을 보여주는가 — 심사 중에 제일 자주 나오는 질문이다
    visit(f"/#{ev}")
    txt = pg.inner_text("#view")
    A("모집중" in txt, f"대회 상태 배지가 없다: {txt[:80]}")
    A("심사 진행" in txt and "심사위원 1명" in txt, "심사 진행 현황이 안 보인다")
    A("전원이 다 본 팀 1/2팀" in txt, f"다 본 팀 수가 틀렸다: {txt}")
    pg.click("tr[data-team]")
    pg.wait_for_selector("#s-url")
    tt = pg.inner_text("#view")
    A("본 사람 심사1" in tt, f"누가 봤는지 안 나온다: {tt[:120]}")
    ok("상태 배지 · 심사 진행 현황 (전원이 다 본 팀 1/2)")

    # ── 마감 — 남은 시간이 뜨고, 지나면 서버가 막는가 ──────
    visit(f"/#{ev}")
    txt = pg.inner_text("#view")
    A("제출 마감까지" in txt, f"남은 시간이 안 보인다: {txt[:100]}")
    ok("마감까지 남은 시간이 뜬다")

    # 마감이 지난 대회를 따로 만들어 서버가 막는지 본다.
    # 화면만 잠그면 주소를 아는 사람은 그냥 낸다. 그래서 서버를 때려서 확인한다.
    gone = (datetime.now() - timedelta(minutes=1)).strftime('%Y-%m-%dT%H:%M')
    _, late = post('/api/events', {'title': '마감지난대회', 'due': gone})
    _, lt = post(f"/api/events/{late['id']}/teams", {'name': '늦은팀'})
    A(post(f"/api/teams/{lt['id']}/submit", {'url': 'https://example.com/late'})[0] == 409,
      '마감이 지났는데 제출이 됐다')
    ok('마감 뒤 제출 차단 (409)')

    # 인터넷이 터졌을 때 진행자가 미룬다. 미룬 뒤에는 다시 받아야 한다.
    code, r = post(f"/api/events/{late['id']}/extend", {'minutes': 60})
    A(code == 200, f'연장 실패 {code}')
    A(post(f"/api/teams/{lt['id']}/submit", {'url': 'https://example.com/late'})[0] == 200,
      '미뤘는데도 제출이 막힌다')
    ok(f"마감 60분 연장 → 다시 제출됨 (새 마감 {r['due']})")

    # 심사위원 이름이 같으면 덮어쓴다. 두 번 눌러도 평균이 안 흔들려야 한다.
    A(post(f"/api/teams/{top['id']}/score",
           {"judge": "심사1", "values": {"idea": 95, "make": 90, "use": 85, "tell": 80}})[0] == 200,
      "같은 심사위원이 다시 못 넣는다")
    A(api(f"/api/events/{ev}/board")["rows"][0]["judges"] == 1, "같은 사람이 두 명으로 셌다")
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
    A("아직 안 본 팀 2팀" in jtxt, f"남은 팀 수가 틀렸다: {jtxt[:120]}")

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
    A(jv["left"] == 1, f"남은 팀이 안 줄었다: {jv['left']}")
    scored = [t for t in jv["teams"] if str(t["id"]) == first][0]
    A(scored["mine"]["idea"] == 60, f"내 점수가 안 저장됐다: {scored['mine']}")
    ok(f"심사 링크에서 점수 저장 — 남은 팀 {jv['left']}팀")
    jctx.close()

    # ── 5. 정원은 서버가 막는가 ─────────────────────────────
    code, small = post("/api/events", {"title": "정원1", "cap": 1, "starts": "2026-11-01"})
    A(code == 201, "정원 대회 생성 실패")
    A(post(f"/api/events/{small['id']}/teams", {"name": "첫팀"})[0] == 201, "첫 팀이 못 들어갔다")
    A(post(f"/api/events/{small['id']}/teams", {"name": "둘째팀"})[0] == 409, "정원 찬 대회에 들어가졌다")
    ok("정원 초과 차단 (409)")

    # ── 6. 협찬사에게 줄 숫자가 쌓이는가 (이 서비스의 차별점) ──
    visit(f"/#{ev}")
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
    o = api(f"/api/events/{ev}/outcomes")
    A(o["finishRate"] == 50.0, f"완주율이 50 이어야 하는데 {o['finishRate']}")
    A(o["interview"] == 1, f"면접 연결이 1 이어야 하는데 {o['interview']}")
    A("50%" in pg.content() and "완주율" in pg.content(), "화면에 숫자가 안 나온다")
    ok(f"성과 기록 — 완주율 {o['finishRate']}% · 면접 {o['interview']}건")

    # ── 사후 지원 — 이게 '보장' 이다. 기록만 하는 표로는 약속이 안 된다 ──
    pg.fill("#h-name", "박실무")
    pg.fill("#h-org", "어느회사")
    pg.fill("#h-can", "도입 검토를 같이 봐 줍니다")
    pg.click("#h-add")
    pg.wait_for_timeout(800)
    pg.wait_for_selector("#a-add")
    pg.click("#a-add")
    pg.wait_for_timeout(800)
    sup = api(f"/api/events/{ev}/support")
    A(sup["promised"] == 1, f"배정이 안 됐다: {sup}")
    # 기한을 안 주면 대회 끝나고 14일. 대회가 10/12 에 끝나니 10/26 이어야 한다.
    A(sup["rows"][0]["due"] == "2026-10-26", f"기본 기한이 틀렸다: {sup['rows'][0]['due']}")
    A(sup["done"] == 0 and sup["late"] == 0, f"처음부터 지킴/늦음이 있다: {sup}")
    ok(f"사후 지원 배정 — {sup['rows'][0]['team_name']} ← {sup['rows'][0]['helper_name']} "
       f"({sup['rows'][0]['due']}까지)")

    # 했음을 누르면 지킨 것으로 넘어간다
    pg.click("[data-done]")
    pg.wait_for_timeout(800)
    sup = api(f"/api/events/{ev}/support")
    A(sup["done"] == 1, f"완료 표시가 안 됐다: {sup}")
    ok("사후 지원 완료 표시 — 약속 1건 중 1건 지킴")

    # 유입 경로 집계 — 2회차 홍보비를 어디에 쓸지 정하는 근거다
    sp_txt = pg.inner_text("#view")
    A("어디서 왔나" in sp_txt and "캠퍼스픽" in sp_txt, f"유입 경로가 안 보인다: {sp_txt[:150]}")
    A(o["found"][0]["k"] == "캠퍼스픽", f"집계가 틀렸다: {o['found']}")
    ok("유입 경로 집계 — 캠퍼스픽 1팀")

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
                 "끝난 뒤에도 봐 드립니다", "박실무"]:
        A(must in txt, f"공개 화면에 '{must}' 가 없다")
    A("example.com/walk" in txt, "제출작 링크가 공개 화면에 없다")
    ok("공개 링크 /e/<대회id> — 로그인 없이 열리고 신청 칸만 있다")

    # 모집 글에 이 주소를 쓴다. 여기서 바로 신청이 돼야 한다.
    before = len(api(f"/api/events/{ev}/board")["rows"])
    pub.fill("#t-name", "공개링크팀")
    pub.select_option("#t-found", "위비티")
    pub.click("#t-join")
    pub.wait_for_timeout(800)
    after = api(f"/api/events/{ev}/board")["rows"]
    A(len(after) == before + 1, f"공개 링크에서 신청이 안 됐다: {before} → {len(after)}")
    A([r for r in after if r["name"] == "공개링크팀"][0]["found"] == "위비티", "유입 경로가 안 붙었다")
    ok("공개 링크에서 바로 참가 신청 — 모집 글에 이 주소를 쓴다")

    # ── 결과 보고서 — 협찬사에게 보내는 물건. 링크 하나가 곧 보고서다 ──
    rp = ctx.new_page()
    rp.on("pageerror", lambda e: errs.append("보고서:" + str(e)))
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
    o2 = api(f"/api/events/{ev}/outcomes")
    A(f"{o2['finishRate']}%" in rtxt,
      f"완주율이 서버 값과 다르다 (서버 {o2['finishRate']}%)")
    A(f"{o2['finished']}/{o2['teams']}" in rtxt, "완주 건수가 안 채워졌다")
    A("약속 1건 중 1건" in rtxt, "사후 지원 이행이 안 채워졌다")
    A(rp.query_selector("nav") is None or
      rp.evaluate("document.querySelector('nav').style.display") == "none", "보고서에 아래 탭이 보인다")
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
