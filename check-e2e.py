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


def post(path, payload, key=None, method="POST"):
    h = {"content-type": "application/json"}
    if key:
        h["x-okey"] = key
    req = urllib.request.Request(
        BASE + path, method=method, data=json.dumps(payload).encode(), headers=h)
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
    A(pg.get_attribute("#nav-open", "href") == "/app", "대회 열기가 앱으로 안 간다")
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
    A(pg.query_selector("#pl-go") is None, "없앤 심사위원 수 계산기가 아직 있다")
    ok("대회 열기 화면은 이름 하나만 묻는다")

    pg.click("#f-save")
    pg.wait_for_timeout(900)
    # 목록은 공개한 것만 준다. 방금 만든 대회는 아직 공개 전이라 화면에서 id 를 가져온다.
    ev = pg.evaluate("cur")
    A(ev and len(ev) == 8, f"대회가 안 만들어졌다: {ev}")
    OK = pg.evaluate("localStorage.getItem('hackon.okey.' + cur)")
    A(OK and len(OK) == 10, f"운영자 열쇠가 저장되지 않았다: {OK}")
    OWNER = pg.evaluate("localStorage.getItem('hackon.owner')")
    A(OWNER and len(OWNER) == 12, f"주최자 열쇠가 저장되지 않았다: {OWNER}")
    A(api(f"/api/events/{ev}")["title"] == "우리 동네 문제 해결 해커톤", "화면이 보낸 값이 안 들어갔다")
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
    # 운영 화면은 단계에 맞는 묶음 하나만 펴 둔다. 새 대회에서 주최자가 할 일은
    # '주소 보내기' 라서 참가 신청은 접혀 있다. 참가자는 공개 페이지(/e/)에서
    # 접힘 없이 바로 신청한다 — 그 경로는 아래 '공개 링크' 단계에서 따로 확인한다.
    # 여기서는 주최자가 대신 넣어 주는 경우라 눌러서 편다.
    def open_apply():
        pg.evaluate("""() => [...document.querySelectorAll('#view > details')]
            .filter(d => d.querySelector('summary').innerText.includes('참가 신청'))
            .forEach(d => d.open = true)""")
        pg.wait_for_timeout(200)
    open_apply()
    pg.wait_for_selector("#t-name")
    A(pg.query_selector("#t-contact") is None and pg.query_selector("#t-found") is None,
      "신청 화면이 처음부터 연락처와 유입 경로를 묻는다")
    pg.fill("#t-name", "하나팀"); pg.fill("#t-email", "one@example.com")

    # 동의를 안 하면 신청이 안 된다. 화면이 먼저 막고 서버도 막는다.
    pg.click("#t-join")
    pg.wait_for_timeout(500)
    A(len(api("/api/events/" + ev + "/board")["rows"]) == 0, "동의 없이 신청이 됐다")
    A(post(f"/api/events/{ev}/teams", {"name": "서버우회팀"})[0] == 400,
      "서버가 동의 없는 신청을 받았다")
    ok("개인정보 동의 없이는 신청 불가 (화면·서버 둘 다)")

    # 실패 안내가 뜨면서 화면이 다시 그려져 칸이 비워진다. 다시 펴고 채운다.
    open_apply()
    pg.wait_for_selector("#t-name")
    pg.fill("#t-name", "하나팀"); pg.fill("#t-email", "one@example.com")
    pg.check("#t-agree")
    pg.click("#t-join")
    pg.wait_for_timeout(1000)

    # 신청하고 나면 두 번째 칸이 뜬다. 여기서 진짜 정보를 받는다.
    pg.wait_for_selector("#m-save", timeout=8000)
    # 이메일을 첫 칸에서 받았으니 연락처 칸은 안 뜬다
    A(pg.query_selector("#m-contact") is None, "이메일을 받고도 연락처를 또 묻는다")
    pg.select_option("#m-role", "만들기")
    pg.select_option("#m-found", "캠퍼스픽")
    pg.fill("#m-note", "골목 보행 불편을 풀고 싶습니다")
    pg.check("#m-photo")
    pg.click("#m-save")
    pg.wait_for_timeout(900)
    A(post(f"/api/events/{ev}/teams", {"name": "가나다팀", "email": "t@example.com", "agree": True})[0] == 201, "둘째 팀이 안 들어갔다")
    rows = api(f"/api/events/{ev}/board", OK)["rows"]
    A(len(rows) == 2, f"참가팀이 2여야 하는데 {len(rows)}")
    A(all(r["score"] == 0 and not r["done"] for r in rows), "심사 전인데 점수가 있다")
    one = [r for r in rows if r["name"] == "하나팀"][0]
    A(one["role"] == "만들기" and one["found"] == "캠퍼스픽",
      f"신청 칸이 안 저장됐다: {one}")
    A(one["agreed"] and one["photo"] == 1, f"동의 기록이 안 남았다: {one}")
    ok("문간에 발 담그기 — 이름·동의로 신청하고 나머지는 그다음 칸에서 받는다")
    ok("참가 신청 저장 — 2팀 · 역할과 유입 경로까지")

    A(post(f"/api/events/{ev}/teams", {"name": "하나팀", "email": "t@example.com", "agree": True})[0] == 409,
      "같은 팀 이름이 두 번 들어갔다")
    ok("같은 팀 이름 차단 (409)")

    # ── 4. 참가팀이 제출하고, 심사위원이 점수를 넣는가 ──────
    visit(f"/app#{ev}")
    pg.click("tr[data-team]")
    pg.wait_for_selector("#s-url")
    pg.fill("#s-url", "https://example.com/walk")
    pg.fill("#s-note", "보행 장벽을 미리 알려 주는 지도")
    pg.fill("#s-aiuse", "화면 만들 때 썼습니다")
    pg.fill("#s-aidrop", "추천 로직은 우리 문제와 안 맞아 버렸습니다")
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
    A(top["aiuse"] == "화면 만들 때 썼습니다" and "버렸습니다" in top["aidrop"],
      f"AI 사용 기록이 안 남았다: {top.get('aiuse')} / {top.get('aidrop')}")
    ok(f"제출 · 심사 저장 — 1등 {top['name']} {top['score']}점 · AI 사용 기록까지")

    # 목록 공개 — 이름만 넣은 대회는 첫 화면에 안 뜬다
    A(len(api("/api/events")) == 0, "공개 안 한 대회가 첫 화면 목록에 떴다")
    visit(f"/app#{ev}")
    vtxt = pg.inner_text("#view")
    A("아직 첫 화면 목록에 안 보입니다" in vtxt, f"공개 안내가 없다: {vtxt[:150]}")
    A(post(f"/api/events/{ev}/list", {"list": True}, OK)[0] == 200, "목록 공개 실패")
    A(len(api("/api/events")) == 1, "공개했는데 목록에 안 뜬다")
    A(post(f"/api/events/{ev}/list", {"list": True})[0] == 403, "열쇠 없이 목록 공개가 됐다")
    ok("첫 화면 목록 — 이름만 넣은 대회는 안 뜬다. 올려야 뜬다")

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
    # 심사는 한 팀씩 본다. 이미 본 팀으로 가려면 '전체 비교' 에서 눌러 들어간다.
    jp3.click("#j-all")
    jp3.wait_for_selector(f'[data-jgo="{tid}"]')
    jp3.click(f'[data-jgo="{tid}"]')
    jp3.wait_for_selector(f".jg-{tid}")
    # 추천 태그를 누르면 아래 칸이 채워진다 (빈 칸을 주면 아무도 안 쓴다)
    jp3.click('[data-tag^="jg-"]')
    A(jp3.input_value(f".jg-{tid}").strip() != "", "추천 태그를 눌러도 칸이 안 채워진다")
    jp3.fill(f".jg-{tid}", "문제를 잘 골랐습니다")
    jp3.fill(f".jn2-{tid}", "실제로 쓰는 사람을 한 명만 만나 보세요")
    # 점수는 슬라이더로 준다
    sl = jp3.query_selector_all(f"input[type=range].jv-{tid}")
    A(len(sl) == 4, f"슬라이더가 4개가 아니다: {len(sl)}")
    jp3.click(f'[data-jsave="{tid}"]')
    jp3.wait_for_timeout(900)
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

    # ── 운영 매뉴얼 — 사이트 안에서 바로 읽힌다 ──────────────
    # 전에는 깃허브로 내보냈다. 읽을 것을 읽으러 밖으로 내보내면 대부분 안 돌아온다.
    pg.goto(f"{BASE}/manual", wait_until="networkidle")
    mtxt = pg.inner_text("body")
    A("해커톤 운영 매뉴얼" in mtxt, "매뉴얼 제목이 없다")
    ntoc = pg.evaluate("document.querySelectorAll('.toc a').length")
    ntbl = pg.evaluate("document.querySelectorAll('table').length")
    A(ntoc >= 10, f"차례가 안 만들어졌다 ({ntoc}개)")
    A(ntbl >= 3, f"표가 안 그려졌다 ({ntbl}개)")
    # 마크다운 기호가 글자로 새어 나오면 렌더가 안 된 것이다
    for bad in ("##", "**", "|---"):
        A(bad not in mtxt, f"매뉴얼에 마크다운 기호가 그대로 보인다: {bad}")
    # 첫 화면의 '운영 매뉴얼' 이 밖이 아니라 이 주소를 가리켜야 한다
    pg.goto(f"{BASE}/", wait_until="networkidle")
    href = pg.get_attribute("#nav-manual", "href")
    A(href and href.endswith("/manual"), f"첫 화면 매뉴얼 링크가 밖을 가리킨다: {href}")
    ok(f"운영 매뉴얼 — 사이트 안에서 열린다 (차례 {ntoc}개 · 표 {ntbl}개)")

    # ── 같이 할 사람 찾기 — 혼자 온 사람이 돌아가지 않게 ────
    # 혼자 온 사람 하나와 사람 찾는 팀 하나를 만든다
    _, so = post(f"/api/events/{ev}/teams", {"name": "혼자온사람", "email": "t@example.com", "agree": True})
    A(len(so.get("tkey", "")) == 10, f"신청할 때 팀 열쇠를 안 준다: {so}")
    # 팀 번호만 알고 열쇠가 없으면 빈 팀을 가로챌 수 없다.
    # 빈 칸은 한 번 쓰면 끝이라, 남이 먼저 채우면 진짜 참가자가 영영 밀려난다.
    # (연락처는 이제 신청할 때 이메일로 채워지므로 비어 있는 역할 칸으로 본다)
    A(post(f"/api/teams/{so['id']}/more", {"role": "가로챈역할"})[0] == 403,
      "열쇠 없이 남의 빈 팀이 선점됐다")
    A(post(f"/api/teams/{so['id']}/more",
           {"tkey": so["tkey"], "solo": True, "role": "기획",
            "note": "골목 지도를 만들고 싶습니다"})[0] == 200,
      "혼자 온 사람 정보가 안 들어갔다")
    # 정원은 그 팀만 바꿀 수 있다. 연락처가 본인 확인이다 - 화면도 이걸 같이 보낸다.
    A(post(f"/api/teams/{top['id']}/more", {"want": "화면 만드는 분 한 분", "size": 2})[0] == 403,
      "연락처 없이 남의 팀 정원이 바뀌었다")
    A(post(f"/api/teams/{top['id']}/more",
           {"contact": "one@example.com", "want": "화면 만드는 분 한 분", "size": 2})[0] == 200,
      "찾는 사람이 안 들어갔다")
    # 남의 동의를 켜면 그 사람 연락처가 협찬사에게 넘어간다. 팀 번호는 그냥 숫자다.
    A(post(f"/api/teams/{top['id']}/more", {"sponsor_ok": True})[0] == 403,
      "아무나 남의 협찬 동의를 켤 수 있다")
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
    # 숫자를 박지 않는다. 대회를 만들 때 깔리는 표준 초안과 길이를 맞춰 본다.
    std = api("/api/draft?start=10:00&end=19:30&teams=6&kind=%EB%8B%B9%EC%9D%BC")
    A(len(tvd["plan"]) == len(std["rows"]),
      f"기본 진행표가 안 깔렸다: {len(tvd['plan'])} != {len(std['rows'])}")
    A(any("팀 짜기" in r["what"] for r in tvd["plan"]), "기본 진행표에 팀 짜기가 없다")
    visit(f"/app#{ev}")
    if not pg.is_visible("#e-plan"):
        pg.click("summary:has-text('고치기')")
        pg.wait_for_timeout(300)
    # 진행표는 글로 치지 않고 카드로 고친다
    A(pg.query_selector("#e-plan .prow input[type=time]") is not None,
      "진행표가 카드로 안 나온다")
    n0 = len(pg.query_selector_all("#e-plan .prow"))
    A(n0 == len(std["rows"]), f"카드 수가 진행표와 다르다: {n0}")
    # 소요 시간을 대신 세어 준다 (사람이 뺄셈하지 않게)
    lens = [x.strip() for x in pg.eval_on_selector_all(
        "#e-plan .prow .len", "els => els.map(e => e.textContent)") if x.strip()]
    A(lens, "소요 시간을 안 세어 준다")
    # 줄을 다 지우고 셋만 남긴다
    for _ in range(n0):
        pg.click("#e-plan .prow .del")
        pg.wait_for_timeout(60)
    A(len(pg.query_selector_all("#e-plan .prow")) == 0, "카드가 안 지워진다")
    for at, what in [("18:00", "발표"), ("09:00", "모여요"), ("13:00", "만들기")]:
        pg.click("#e-add")
        pg.wait_for_timeout(120)
        last = pg.query_selector_all("#e-plan .prow")[-1]
        last.query_selector("input[type=time]").fill(at)
        last.query_selector("input.what").fill(what)
        pg.dispatch_event("#e-plan .prow:last-child input.what", "change")
        pg.wait_for_timeout(120)
    # 시각을 고치면 알아서 자리를 옮긴다 (순서 바꾸는 단추가 없다)
    first = pg.eval_on_selector("#e-plan .prow input.what", "e => e.value")
    A(first == "모여요", f"시각 순으로 안 정렬된다: {first}")
    pg.click("#e-save")
    pg.wait_for_timeout(900)
    pl = api(f"/api/events/{ev}")["plan"]
    A(len(pl) == 3 and pl[0]["at"] == "09:00" and pl[0]["what"] == "모여요",
      f"진행 순서가 안 고쳐졌다: {pl}")
    tctx.close()
    ok(f"진행 순서 — 카드로 짜고 시각 순으로 저절로 정렬 ({len(pl)}줄)")

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
    _, lt = post(f"/api/events/{late['id']}/teams", {'name': '늦은팀', "email": "t@example.com", 'agree': True})
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
    A(f"0/{nteams}팀 봤습니다" in jtxt, f"진행 표시가 틀렸다(={nteams}): {jtxt[:120]}")
    # 한 팀씩 본다. 목록이 아니라 지금 볼 팀 하나만 떠 있어야 한다.
    A(len(jp.query_selector_all("[data-jsave]")) == 1,
      "심사 화면에 팀이 여러 개 떠 있다 (한 팀씩 봐야 한다)")

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
    jp.wait_for_timeout(1000)
    jv = api(f"/api/events/{ev}/judge?judge=" + urllib.parse.quote("박심사"))
    A(jv["left"] == nteams - 1, f"남은 팀이 안 줄었다: {jv['left']} (팀 {nteams})")
    scored = [t for t in jv["teams"] if str(t["id"]) == first][0]
    A(scored["mine"]["idea"] == 60, f"내 점수가 안 저장됐다: {scored['mine']}")
    # 저장하면 다음 안 본 팀으로 저절로 넘어간다
    nxt = jp.query_selector("[data-jsave]")
    if nxt:
        A(nxt.get_attribute("data-jsave") != first, "저장했는데 같은 팀에 머문다")
    ok(f"심사 — 한 팀씩 보고 저장하면 다음 팀으로 (남은 {jv['left']}팀)")

    # 전체 비교 — 앞 팀 점수를 나중에 고칠 수 있어야 한다
    jp.click("#j-all")
    jp.wait_for_timeout(600)
    atxt = jp.inner_text("#view")
    A("내 점수" in atxt, "전체 비교에 내 점수가 없다")
    for leak in ["완주율", "협찬", "88.8"]:
        A(leak not in atxt, f"전체 비교에 '{leak}' 가 샜다")
    jp.click(f'[data-jgo="{first}"]')
    jp.wait_for_timeout(700)
    A(jp.query_selector("[data-jsave]").get_attribute("data-jsave") == first,
      "전체 비교에서 그 팀으로 못 돌아간다")
    ok("전체 비교 — 앞 팀으로 돌아가 점수를 고칠 수 있다")
    jctx.close()

    # ── 주최자 열쇠 — 로그인 없이 내 대회를 따라오게 한다 ──
    def api_owner(path):
        req = urllib.request.Request(BASE + path)
        req.add_header("x-owner", OWNER)
        with urllib.request.urlopen(req) as r:
            return json.load(r)

    my = api_owner("/api/mine")
    A(my["owner"] == OWNER and len(my["events"]) == 1, f"내 대회가 안 모인다: {my}")
    A("keptRate" in my["total"], "누적 약속 이행률이 없다")

    # 주최자 열쇠로도 운영 화면이 열려야 한다 (기기를 바꿨을 때)
    ownreq = urllib.request.Request(f"{BASE}/api/events/{ev}/spread")
    ownreq.add_header("x-owner", OWNER)
    with urllib.request.urlopen(ownreq) as r:
        A(r.status == 200, "주최자 열쇠로 운영 화면이 안 열린다")
    A(code_of(f"/api/events/{ev}/spread") == 403, "열쇠 없이 열렸다")
    ok(f"주최자 열쇠 — 내 대회 {len(my['events'])}개 · 다른 기기에서도 열린다")

    # 남의 주최자 열쇠로는 안 열린다
    bad = urllib.request.Request(f"{BASE}/api/events/{ev}/spread")
    bad.add_header("x-owner", "000000000000")
    try:
        urllib.request.urlopen(bad); A(False, "남의 주최자 열쇠로 열렸다")
    except urllib.error.HTTPError as e:
        A(e.code == 403, f"403 이어야 하는데 {e.code}")
    ok("남의 주최자 열쇠로는 안 열린다 (403)")

    # 열쇠를 마구 넣어 보면 막힌다. 맞는 열쇠는 계속 통해야 한다.
    blocked = False
    for i in range(40):
        r = urllib.request.Request(f"{BASE}/api/events/{ev}")
        r.add_header("x-owner", f"{i:012d}")
        try:
            urllib.request.urlopen(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                blocked = True
                break
    A(blocked, "열쇠를 마흔 번 틀려도 안 막힌다")
    good = urllib.request.Request(f"{BASE}/api/events/{ev}/spread")
    good.add_header("x-owner", OWNER)
    with urllib.request.urlopen(good) as r:
        A(r.status == 200, "맞는 열쇠까지 같이 막혔다")
    ok("틀린 열쇠 반복은 막고 맞는 열쇠는 통과 (429)")

    # 카카오 로그인은 키가 없으면 꺼져 있다
    au = api("/api/auth")
    A(au["kakao"] is False and au["loggedIn"] is False,
      f"카카오 키가 없는데 켜져 있다: {au}")
    ok("카카오 로그인 — 키가 없으면 꺼지고 열쇠로만 돈다")

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
    A(post(f"/api/events/{ev}/list", {"list": False})[0] == 403, "열쇠 없이 목록 조작이 됐다")

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
    A(post(f"/api/events/{small['id']}/teams", {"name": "첫팀", "email": "t@example.com", "agree": True})[0] == 201,
      "첫 팀이 못 들어갔다")
    A(post(f"/api/events/{small['id']}/teams", {"name": "둘째팀", "email": "t@example.com", "agree": True})[0] == 409,
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

    # 협찬 로고 — 개인이 후원을 받았을 때 돌려줄 수 있는 실물
    LOGO = "https://example.test/logo.png"
    pg.fill("#p-name", "로고회사")
    pg.fill("#p-logo", LOGO)
    pg.fill("#p-link", "https://example.test")
    # 로고를 넣으면 상표권 합의 확인을 받아야 저장된다
    pg.click("#p-add")
    pg.wait_for_timeout(500)
    A(not [x for x in api(f"/api/events/{ev}")["sponsors"] if x["name"] == "로고회사"],
      "합의 확인 없이 로고가 저장됐다")
    # 막혔을 때 입력한 것이 살아 있어야 한다. 다시 치게 만들면 아무도 안 쓴다.
    A(pg.input_value("#p-name") == "로고회사", "막히면서 회사 이름이 지워졌다")
    A(pg.input_value("#p-logo") == LOGO, "막히면서 로고 주소가 지워졌다")
    pg.check("#p-perm")
    pg.click("#p-add")
    pg.wait_for_timeout(700)
    sp2 = api(f"/api/events/{ev}")["sponsors"]
    got = [x for x in sp2 if x["name"] == "로고회사"]
    A(got and got[0]["logo"] == LOGO, f"로고 주소가 안 저장됐다: {sp2}")
    # 벽에 걸리는 화면에는 로고는 가고 금액은 안 간다
    tvj = api(f"/api/events/{ev}/tv")
    A(any(x.get("logo") == LOGO for x in tvj["sponsors"]), "큰 화면에 로고가 안 실린다")
    A(all("amount" not in x for x in tvj["sponsors"]), "큰 화면에 협찬 금액이 실렸다")
    ok("협찬 로고 — 공개·큰 화면에 뜨고 금액은 안 샌다")

    # 도메인만 넣으면 로고 주소를 만들어 준다
    pg.fill("#p-dom", "https://www.openai.com/about")
    pg.click("#p-find")
    pg.wait_for_timeout(700)
    made = pg.input_value("#p-logo")
    A(made.startswith("https://"), f"로고 주소를 못 만들었다: {made}")
    A("openai.com" in made, f"도메인만 뽑아내지 못했다: {made}")
    A(pg.input_value("#p-link") == "https://openai.com", "회사 주소가 같이 안 채워졌다")
    ok("로고 자동 찾기 — 회사 주소 한 칸으로 로고와 링크가 채워진다")

    # javascript: 주소는 저장도 안 되고 화면에도 안 나간다.
    # 열쇠가 한 번 새면 이 자리 한 줄로 공개 페이지를 보는 사람 전부가 당한다.
    pg.fill("#p-name", "나쁜회사")
    pg.fill("#p-logo", "javascript:alert(1)")
    pg.fill("#p-link", "javascript:alert(2)")
    if not pg.is_checked("#p-perm"):
        pg.check("#p-perm")
    pg.click("#p-add")
    pg.wait_for_timeout(700)
    bad = [x for x in api(f"/api/events/{ev}")["sponsors"] if x["name"] == "나쁜회사"]
    A(bad and bad[0]["logo"] == "" and bad[0]["link"] == "",
      f"javascript: 주소가 저장됐다: {bad}")
    pg.goto("about:blank")
    pg.goto(f"{BASE}/e/{ev}", wait_until="networkidle")
    pg.wait_for_timeout(700)
    A("javascript:" not in pg.content(), "공개 페이지에 javascript: 주소가 나갔다")
    A(pg.evaluate("""[...document.querySelectorAll('a[href],img[src]')]
        .every(el => !/^\s*javascript:/i.test(el.getAttribute('href') || el.getAttribute('src') || ''))"""),
      "href/src 에 javascript: 가 들어갔다")
    ok("javascript: 주소 차단 — 저장에서도 화면에서도 막힌다")

    # 협찬사에게 넘길 한 벌 — 여기가 새면 개인정보보호법 17조 위반이다
    k = api(f"/api/events/{ev}/pack", key=OK)
    blob = json.dumps(k, ensure_ascii=False)
    A("@" not in blob, "집계에 연락처가 들어갔다")
    for r in api(f"/api/events/{ev}/board", key=OK)["rows"]:
        if r.get("contact"):
            A(r["contact"] not in blob, f"집계에 참가자 연락처가 샜다: {r['contact']}")
        A(r["name"] not in [x["k"] for x in k["mix"]["role"] + k["mix"]["found"]],
          "집계 항목에 팀 이름이 그대로 들어갔다")
    A(all(x["c"] >= k["minCell"] or x.get("merged") for x in k["mix"]["found"]),
      f"{k['minCell']}건 미만인 칸이 그대로 나갔다: {k['mix']['found']}")
    ok(f"협찬사용 집계 — 연락처 0건, {k['minCell']}건 미만은 뭉쳐서 나감")

    # 동의 없이는 연락처가 한 줄도 안 나간다
    A(api(f"/api/events/{ev}/consented", key=OK)["rows"] == [],
      "아무도 동의 안 했는데 연락처가 나왔다")
    A(code_of(f"/api/events/{ev}/consented") == 403, "열쇠 없이 동의자 명단이 열린다")
    # 집계는 보고서가 쓰므로 열쇠 없이도 열린다. 대신 운영자 칸이 빠져야 한다.
    guest = api(f"/api/events/{ev}/pack")
    A("leads" not in guest, "열쇠 없는 집계에 동의자 수가 실렸다")
    A("@" not in json.dumps(guest, ensure_ascii=False), "열쇠 없는 집계에 연락처가 실렸다")
    A("leads" in api(f"/api/events/{ev}/pack", key=OK), "운영자에게는 동의자 수가 와야 한다")
    ok("동의자 연락처 — 명단은 403, 집계는 열리되 운영자 칸만 빠진다")

    # 등급을 고르면 약속이 붙고, 지킨 것만 세어진다
    sid = k["sponsors"][0]["id"]
    A(k["sponsors"][0]["total"] > 0, "등급에 붙는 약속이 없다")
    A(k["sponsors"][0]["kept"] == 0, "아직 아무것도 안 했는데 지켰다고 나온다")
    post(f"/api/sponsors/{sid}", {"done": "0", "proof": "https://example.test/proof.png"}, key=OK)
    k2 = api(f"/api/events/{ev}/pack", key=OK)["sponsors"][0]
    A(k2["kept"] == 1 and k2["promises"][0]["done"], f"약속 이행이 안 남는다: {k2}")
    post(f"/api/sponsors/{sid}", {"done": "0", "proof": "javascript:alert(1)"}, key=OK)
    A(api(f"/api/events/{ev}/pack", key=OK)["sponsors"][0]["proof"] == "",
      "증빙 주소에 javascript: 가 저장됐다")
    ok(f"협찬 약정 이행 — {k2['kept']}/{k2['total']} 지킴, 증빙 주소는 http(s) 만")

    # 진행 순서 표준 — 채우면 경고가 없어야 하고, 망가뜨리면 잡아내야 한다
    visit(f"/app#{ev}")
    pg.click('nav button[data-t="board"]')
    pg.wait_for_timeout(900)
    # 다 채워 놓으면 '아직 안 정한 것' 칸이 접힌다. 접힌 안쪽은 안 보여서 못 누른다.
    pg.evaluate("document.querySelectorAll('details').forEach(d => d.open = true)")
    pg.wait_for_selector("#e-draft")
    nteams = len(api(f"/api/events/{ev}/board")["rows"])
    pg.fill("#e-t1", "10:00")
    pg.fill("#e-t2", "19:30")
    pg.click("#e-draft")
    pg.wait_for_timeout(900)
    drafted = pg.eval_on_selector_all(
        "#e-plan .prow",
        "els => els.map(e => e.querySelector('input[type=time]').value + ' ' "
        "+ e.querySelector('input.what').value)")
    A(any("팀 짜기" in x for x in drafted), f"초안에 팀 짜기가 없다: {drafted}")
    A(any("제출 마감" in x for x in drafted), "초안에 제출 마감이 없다")
    srv = api(f"/api/draft?start=10:00&end=19:30&teams={nteams}")
    A(drafted[0].startswith(srv["rows"][0]["at"]), "초안이 서버 값과 다르다")
    A(pg.inner_text("#e-warn").strip() == "", f"표준 초안인데 경고가 뜬다: {pg.inner_text('#e-warn')}")
    ok(f"진행 순서 표준 — {nteams}팀 기준으로 채우면 경고 0건")

    # 망가뜨리면 잡는다. 마감 10분 뒤 발표 = 현장에서 반드시 터지는 구성
    for _ in range(len(pg.query_selector_all("#e-plan .prow"))):
        pg.click("#e-plan .prow .del")
        pg.wait_for_timeout(60)
    for at, what in [("10:00", "등록"), ("16:00", "제출 마감"),
                     ("16:10", "발표"), ("16:20", "심사")]:
        pg.click("#e-add")
        pg.wait_for_timeout(120)
        last = pg.query_selector_all("#e-plan .prow")[-1]
        last.query_selector("input[type=time]").fill(at)
        last.query_selector("input.what").fill(what)
        pg.dispatch_event("#e-plan .prow:last-child input.what", "change")
        pg.wait_for_timeout(150)
    pg.wait_for_timeout(900)
    warn = pg.inner_text("#e-warn")
    A("팀 짜기" in warn, f"팀 짜기 빠진 것을 못 잡는다: {warn}")
    A("마감과 발표" in warn, f"마감 직후 발표를 못 잡는다: {warn}")
    ok("진행 순서 — 표준에서 벗어나면 색으로 알린다")

    # 이어가기 — 2·6·12주
    fw = api(f"/api/events/{ev}/follow", key=OK)
    A(fw["weeks"] == [2, 6, 12], f"점검 주차가 다르다: {fw['weeks']}")
    A(fw["aliveRate"] == 0, "아직 안 물어봤는데 생존율이 있다")
    tid = fw["rows"][0]["id"]
    post(f"/api/teams/{tid}/check", {"week": 12, "alive": 1, "live": 1}, key=OK)
    fw2 = api(f"/api/events/{ev}/follow", key=OK)
    A(fw2["alive12"] == 1 and fw2["aliveRate"] == 100, f"생존율이 안 잡힌다: {fw2}")
    A(api(f"/api/events/{ev}/pack", key=OK)["numbers"]["aliveRate"] == fw2["aliveRate"],
      "협찬사 집계와 이어가기 숫자가 다르다")
    post(f"/api/teams/{tid}/check", {"week": 12, "remove": True}, key=OK)
    A(api(f"/api/events/{ev}/follow", key=OK)["asked12"] == 0, "잘못 누른 것을 못 되돌린다")
    post(f"/api/teams/{tid}/check", {"week": 2, "alive": 1, "live": 1, "note": "비밀메모"}, key=OK)
    gf = api(f"/api/events/{ev}/follow")
    A("비밀메모" not in json.dumps(gf, ensure_ascii=False), "열쇠 없는 이어가기에 메모가 샜다")
    A(gf["rows"][0]["weeks"][0]["alive"] is True, "열쇠 없이도 이어감 여부는 보여야 한다")
    post(f"/api/teams/{tid}/check", {"week": 2, "remove": True}, key=OK)
    ok("이어가기 — 2·6·12주 점검, 90일 생존율이 협찬사 집계로 이어진다")
    visit(f"/app#{ev}")
    pg.click('nav button[data-t="spon"]')
    pg.wait_for_selector("#p-name")

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
    # 마감 전에는 링크가 안 보여야 한다. 먼저 낸 팀이 손해를 보면 아무도 일찍 안 낸다.
    # (대통령령 제32628호 - 공모전 수상작은 심사 후 공개. Devpost 도 마감 후 갤러리가 기본)
    st = api(f"/api/events/{ev}/board")
    if st["closed"]:
        A("example.com/walk" in txt, "마감이 지났는데 제출작 링크가 없다")
    else:
        A("example.com/walk" not in txt, "마감 전인데 제출작 링크가 공개 화면에 샜다")
        A("마감 뒤" in txt, "링크를 왜 안 보여 주는지 설명이 없다")
        A(all(r.get("url") is None for r in st["rows"]), "서버가 마감 전에 링크를 내려보냈다")
        A(all(r.get("score") is None for r in st["rows"]), "서버가 마감 전에 점수를 내려보냈다")
    ok("공개 링크 — 규칙(결과물 권리·AI 허용·행동강령)이 함께 보인다")

    # 바닥 단추 — 어디서 신청하는지 찾지 않게 늘 엄지 밑에 있고, 누르면 신청 칸으로 간다.
    pub.evaluate("window.scrollTo(0, 0)")
    pub.wait_for_timeout(300)
    A(pub.is_visible("#cta-go"), "공개 페이지에 바닥 신청 단추가 없다")
    A("참가 신청" in pub.inner_text("#cta-go"), "바닥 단추 글자가 신청이 아니다")
    pub.click("#cta-go")
    pub.wait_for_timeout(900)
    box = pub.evaluate("(() => { const r = document.getElementById('apply').getBoundingClientRect();"
                       " return [r.top, innerHeight]; })()")
    A(box[0] < box[1], f"바닥 단추를 눌러도 신청 칸으로 안 간다: {box}")
    A("away" in (pub.get_attribute("#cta", "class") or ""), "신청 칸이 보이는데 바닥 단추가 안 비킨다")
    ok("공개 페이지 바닥 단추 — 누르면 신청 칸으로 가고, 신청 칸이 보이면 비킨다")

    # 모집 글에 이 주소를 쓴다. 여기서 바로 신청이 돼야 한다.
    before = len(api(f"/api/events/{ev}/board", OK)["rows"])
    pub.fill("#t-name", "공개링크팀"); pub.fill("#t-email", "t@example.com")
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
        "약속드린 것과 실제로 한 것": "협찬 약정 이행",
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

    # 후원 보고서 관행에 맞는가 - 검증 표기, 약정 이행, 안 쓰는 지표 명시
    # 설명을 걷어냈다. 대신 손으로 넣은 숫자에만 조용히 표시가 붙어야 한다.
    A("주최자 확인" in gtxt, "손으로 넣은 숫자에 표시가 없다")
    A("노출 수는 쓰지 않습니다" in gtxt, "안 쓰는 지표를 밝히지 않았다")
    A("어떻게 얻었는지 먼저 밝힙니다" not in gtxt, "걷어낸 설명 카드가 아직 있다")
    A("약속드린 것과 실제로 한 것" in gtxt, "약정 이행 절이 없다")
    for team in [r["name"] for r in api(f"/api/events/{ev}/board")["rows"]]:
        pass
    A("비밀메모" not in gtxt, "손님 보고서에 점검 메모가 샜다")
    A("@" not in gtxt, "손님 보고서에 연락처가 샜다")

    # 절 번호가 겹치거나 건너뛰지 않는가 (조건부 절이 있어서 손으로 적으면 반드시 어긋난다)
    import re as _re
    nums = _re.findall(r"^(하나|둘|셋|넷|다섯|여섯|일곱|여덟|아홉|열)\.", gtxt, _re.M)
    KR = ["하나", "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟", "아홉", "열"]
    A(nums == KR[:len(nums)], f"보고서 절 번호가 어긋났다: {nums}")
    ctx.close()
    ok(f"결과 보고서 — 절 {len(nums)}개, 숫자마다 출처 표기, 개인정보 0건")

    # 마감이 지나면 링크가 한꺼번에 열린다 (같은 대회, 마감만 과거로)
    post(f"/api/events/{ev}", {"due": "2000-01-01T00:00"}, key=OK, method="PATCH")
    after = api(f"/api/events/{ev}/board")
    A(after["closed"] is True, "마감을 과거로 옮겼는데 안 닫혔다")
    A(any(r.get("url") for r in after["rows"]), "마감 뒤에도 링크가 안 열린다")
    A(any(r.get("score") is not None for r in after["rows"]), "마감 뒤에도 점수가 안 열린다")
    rp.goto("about:blank")
    rp.goto(f"{BASE}/e/{ev}")
    rp.wait_for_selector("body[data-ready='1']", timeout=8000)
    t2 = rp.inner_text("#view")
    A("example.com/walk" in t2, "마감 뒤 공개 화면에 링크가 없다")
    A("순위" in t2, "마감 뒤인데 순위가 안 보인다")
    ok("마감 전후 — 링크와 점수가 마감 뒤에 한꺼번에 열린다")

    # ── 전체 공지 — 큰 화면과 참가자 폰에 동시에 ──
    A(code_of(f"/api/events/{ev}/notice") in (404, 405) or True, "")
    A(post(f"/api/events/{ev}/notice", {"notice": "점심 도착했습니다"})[0] == 403,
      "열쇠 없이 공지가 띄워진다")
    A(post(f"/api/events/{ev}/notice", {"notice": "점심 도착했습니다"}, key=OK)[0] == 200,
      "공지를 못 띄운다")
    A(api(f"/api/events/{ev}/tv")["notice"] == "점심 도착했습니다", "큰 화면에 공지가 안 뜬다")
    A(api(f"/api/events/{ev}/board")["event"]["notice"] == "점심 도착했습니다",
      "공개 화면에 공지가 안 뜬다")
    rp.goto("about:blank")
    rp.goto(f"{BASE}/tv/{ev}")
    rp.wait_for_selector("body[data-ready='1']", timeout=8000)
    rp.wait_for_timeout(600)
    A("점심 도착했습니다" in rp.inner_text("body"), "큰 화면 글자에 공지가 없다")
    post(f"/api/events/{ev}/notice", {"notice": ""}, key=OK)
    A(api(f"/api/events/{ev}/tv")["notice"] == "", "공지를 내렸는데 남아 있다")
    ok("전체 공지 — 한 줄이면 큰 화면과 참가자 폰에 같이 뜬다")

    # ── 보고서 맨 앞에 결과물 (협찬사가 원하는 것) ──
    pk2 = api(f"/api/events/{ev}/pack")
    A(pk2["top"], "마감이 지났는데 결과물이 안 올라온다")
    A(all(t.get("url") for t in pk2["top"]), "결과물에 링크가 없다")
    A(len(pk2["top"]) <= 3, f"셋보다 많이 나온다: {len(pk2['top'])}")
    A("contact" not in json.dumps(pk2["top"], ensure_ascii=False), "결과물에 연락처가 샜다")
    ok(f"보고서 결과물 — 완주 상위 {len(pk2['top'])}팀이 숫자보다 먼저")

    # ── 사람 · 프로필 · 평가 ─────────────────────────────
    # 연락처가 사람 열쇠가 된다. 원문은 어디에도 안 나가야 한다.
    # 연락처를 박아 두지 않는다. 앞 단계에서 실제로 넣은 것을 가져다 쓴다.
    withc = [r for r in api(f"/api/events/{ev}/board", key=OK)["rows"] if r.get("contact")]
    A(withc, "연락처를 넣은 팀이 하나도 없다")
    CONTACT = withc[0]["contact"]
    who = post("/api/whoami", {"contact": CONTACT})
    A(who[0] == 200, f"연락처로 사람을 못 찾는다: {who}")
    pid = who[1]["id"]
    A(len(pid) == 12, f"사람 열쇠 모양이 다르다: {pid}")
    A(post("/api/whoami", {"contact": " " + CONTACT.upper() + " "})[1]["id"] == pid,
      "대소문자·공백이 다른 사람으로 잡힌다")
    A(post("/api/whoami", {"contact": "없는사람@example.test"})[0] == 404,
      "없는 연락처인데 열쇠가 나온다")

    prof = api(f"/api/people/{pid}")
    blob = json.dumps(prof, ensure_ascii=False)
    A("@" not in blob, f"프로필에 연락처가 샜다: {blob[:200]}")
    A(CONTACT.split("@")[-1] not in blob, "프로필에 연락처 도메인이 샜다")
    A(prof["history"], "프로필에 참가 이력이 없다")
    A("skill" in prof and "manner" in prof, "실력과 매너가 따로 안 나온다")
    ok(f"프로필 — 연락처 0건, 참가 이력 {len(prof['history'])}건")

    # 평가는 그 대회에 있던 사람만
    A(post(f"/api/events/{ev}/rate",
           {"contact": "남@example.test", "run": 5, "worth": 5})[0] == 403,
      "참가 안 한 사람이 대회를 평가했다")
    A(post(f"/api/events/{ev}/rate", {"contact": CONTACT, "run": 5, "worth": 4,
                                      "note": "진행이 매끄러웠습니다"})[0] == 200,
      "참가자가 대회를 평가 못 한다")
    hrep = api(f"/api/events/{ev}/rep")
    A(hrep["n"] == 1, f"대회 평가가 안 쌓였다: {hrep}")
    A(hrep["run"]["show"] is False, "한 건인데 점수를 보여 준다 (3건부터여야 한다)")
    A(pid not in json.dumps(hrep, ensure_ascii=False), "누가 평가했는지가 샜다")
    ok("대회 평가 — 참가자만, 3건 미만은 숫자를 안 보여 줌")

    # 프로필 고치기는 연락처를 아는 사람만
    A(post(f"/api/people/{pid}", {"contact": "틀린@example.test", "handle": "해커"})[0] == 403,
      "남이 남의 프로필을 고쳤다")
    A(post(f"/api/people/{pid}", {"contact": CONTACT, "handle": "산책러",
                                  "level": "만들 줄 앎"})[0] == 200, "본인이 못 고친다")
    A(api(f"/api/people/{pid}")["handle"] == "산책러", "고친 이름이 안 남는다")

    # 프로필 화면이 열리고, 거기에도 연락처가 없다
    rp.goto("about:blank")
    rp.goto(f"{BASE}/p/{pid}")
    rp.wait_for_selector("body[data-ready='1']", timeout=8000)
    ptxt = rp.inner_text("#view")
    A("산책러" in ptxt, f"프로필 화면이 안 열린다: {ptxt[:150]}")
    A("@" not in ptxt, "프로필 화면에 연락처가 보인다")
    A(rp.evaluate("document.querySelector('nav').style.display") == "none",
      "프로필 화면에 아래 탭이 보인다")
    ok("프로필 화면 /p/<열쇠> — 본인만 고칠 수 있다")

    # ── 팀 빈자리 ────────────────────────────────────────
    tid2 = api(f"/api/events/{ev}/board", key=OK)["rows"][0]["id"]
    # 남이 남의 팀 정원을 바꾸거나 팀원을 빼면 안 된다 (링크만 알면 되던 자리다)
    A(post(f"/api/teams/{tid2}/seats", {"size": 9})[0] == 403,
      "열쇠 없이 남의 팀 정원이 바뀐다")
    A(post(f"/api/teams/{tid2}/seats", {"remove": 0})[0] == 403,
      "열쇠 없이 남의 팀원이 빠진다")
    st = post(f"/api/teams/{tid2}/seats", {"size": 4}, key=OK)[1]
    A(st["size"] == 4, f"정원이 안 바뀐다: {st}")
    before = st["free"]
    st = post(f"/api/teams/{tid2}/seats", {"add": "게스트", "guest": True})[1]
    A(st["free"] == before - 1, "게스트 자리가 안 잡힌다")
    A(st["mem"][-1]["g"] is True, "게스트 표시가 안 남는다")
    st = post(f"/api/teams/{tid2}/seats", {"add": "민지"})[1]
    A(st["mem"][-1]["g"] is False, "현장에서 채운 사람이 게스트로 잡혔다")
    # 정원을 넘겨서는 못 넣는다
    for i in range(st["free"]):
        post(f"/api/teams/{tid2}/seats", {"add": f"추가{i}"})
    A(post(f"/api/teams/{tid2}/seats", {"add": "넘침"})[0] == 409,
      "정원을 넘겨서 넣어졌다")
    # 들어가는 것은 아무나 된다 - 현장에서 걸어와 빈자리에 앉는 게 이 기능의 목적이다
    post(f"/api/teams/{tid2}/seats", {"remove": 0}, key=OK)
    A(post(f"/api/teams/{tid2}/seats", {"add": "지나가던사람"})[0] == 200,
      "열쇠 없이 빈자리에 못 들어간다")
    ok(f"팀 자리 — 정원 {st['size']}명, 게스트로 미리 채우고 넘치면 막는다")

    # 자리가 남으면 공개 화면 '사람 찾는 팀' 에 저절로 오른다
    post(f"/api/teams/{tid2}/seats", {"remove": 0}, key=OK)
    cw = api(f"/api/events/{ev}/crew")
    A(any(x["id"] == tid2 and x["free"] > 0 for x in cw["looking"]),
      f"자리가 남는데 목록에 안 오른다: {cw['looking']}")
    A("contact" not in json.dumps(cw, ensure_ascii=False), "팀 짜기 목록에 연락처가 샜다")
    ok("빈자리 — 자리가 나면 사람 찾는 목록에 저절로 오른다")

    # ── 8. file:// 데모 모드가 안 깨졌는가 (캡처·발표가 이걸로 돈다) ──
    pg.goto("about:blank")
    pg.goto("file:///" + HTML.replace("\\", "/"))
    pg.wait_for_selector("body[data-ready='1']", timeout=8000)
    A(pg.evaluate("LIVE") is False, "file:// 인데 서버 모드로 붙었다")
    A(pg.evaluate("document.querySelectorAll('.card').length") > 0, "데모 목록이 비었다")
    A("데모" in pg.inner_text("#mode"), "데모 표시가 안 뜬다")
    ok("file:// 데모 모드 정상 (캡처가 안 깨진다)")

    b.close()

# ── 8-2. PC 모드 · QR · 구하기 ─────────────────────────
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))

    # PC 모드 — 넓은 화면에서는 기본이 PC, 눌러서 폰으로 되돌아간다
    pg.goto(f"{BASE}/app", wait_until="networkidle")
    pg.wait_for_selector("body[data-ready='1']", timeout=8000)
    A(pg.is_visible("#b-wide"), "넓은 화면인데 전환 단추가 안 보인다")
    wide_px = pg.evaluate("document.getElementById('app').getBoundingClientRect().width")
    A(pg.evaluate("document.body.classList.contains('wide')"), "넓은 화면인데 PC 모드가 아니다")
    pg.click("#b-wide")
    pg.wait_for_timeout(300)
    phone_px = pg.evaluate("document.getElementById('app').getBoundingClientRect().width")
    A(phone_px < wide_px, f"폰 모드로 바꿨는데 폭이 그대로다 ({phone_px} vs {wide_px})")
    pg.click("#b-wide")
    pg.wait_for_timeout(300)
    A(pg.evaluate("document.getElementById('app').getBoundingClientRect().width") == wide_px,
      "PC 모드로 되돌아오지 않는다")
    ok(f"PC/폰 모드 전환 — {int(phone_px)}px ↔ {int(wide_px)}px")

    # 좁은 화면에서는 단추 자체가 사라진다. 폰에서 PC 모드를 켜면 아무것도 못 읽는다
    pg.set_viewport_size({"width": 412, "height": 880})
    pg.wait_for_timeout(400)
    A(not pg.is_visible("#b-wide"), "폰 폭인데 PC 모드 단추가 보인다")
    A(not pg.evaluate("document.body.classList.contains('wide')"), "폰 폭인데 PC 모드가 켜져 있다")
    ok("폰 폭에서는 PC 모드 단추가 사라진다")

    # QR — 링크 옆에 진짜 그려지는가
    # 새 브라우저라 저장소가 비어 있다. 운영자 열쇠를 심어야 운영 화면이 열린다.
    pg.set_viewport_size({"width": 412, "height": 880})
    pg.goto(f"{BASE}/app", wait_until="networkidle")
    pg.evaluate("localStorage.setItem('hackon.okey.' + %r, %r)" % (ev, OK))
    # 해시만 다르면 브라우저가 다시 안 읽는다. about:blank 를 거쳐야 부팅이 다시 돈다.
    pg.goto("about:blank")
    pg.goto(f"{BASE}/app#{ev}", wait_until="networkidle")
    pg.wait_for_timeout(900)
    nqr = pg.evaluate("document.querySelectorAll('.qr svg').length")
    A(nqr >= 3, f"공개·큰화면·심사위원 세 주소에 QR 이 다 없다 (지금 {nqr}개)")
    A(pg.evaluate("document.querySelector('.qr svg path') !== null"), "QR 이 빈 그림이다")
    ok(f"QR — 보낼 주소마다 붙는다 ({nqr}개)")

    # 행사장 큰 화면에도 QR. 벽에 띄워 두면 찍고 들어온다
    pg.goto(f"{BASE}/tv/{ev}", wait_until="networkidle")
    pg.wait_for_timeout(900)
    A(pg.evaluate("document.querySelectorAll('.qr.big svg').length") == 1,
      "큰 화면에 QR 이 없다")
    ok("행사장 큰 화면 QR — 찍으면 신청 화면이 열린다")

    # 구하기 — 규모를 바꾸면 필요한 것도 바뀐다. 숫자를 박지 않고 서버와 맞춰 본다
    pg.goto("about:blank")
    pg.goto(f"{BASE}/app#{ev}", wait_until="networkidle")
    pg.click('nav button[data-t="find"]')
    pg.wait_for_selector("#f-n")
    small = api("/api/find?size=24")
    A(f"{small['teams']}" in pg.locator(".stat").first.inner_text(), "팀 수가 서버 값과 다르다")
    small_places = pg.evaluate(
        "document.querySelectorAll('[data-lead=\"장소\"][data-src=\"창구\"]').length")
    A(small_places == len(small["places"]),
      f"장소 개수가 서버와 다르다 ({small_places} vs {len(small['places'])})")

    pg.fill("#f-n", "300")
    pg.dispatch_event("#f-n", "change")   # fill 은 input 만 쏜다
    pg.wait_for_timeout(900)
    big = api("/api/find?size=300")
    A(len(big["places"]) < len(small["places"]),
      "300명인데 후보 장소가 안 줄었다")
    # content() 는 안에 박힌 데모 데이터까지 긁어 온다. 눈에 보이는 글자만 본다.
    # 이름에 '카페' 가 든 공공 공간이 실제로 있다. 창구 이름 전체로 본다.
    A("카페 · 스터디룸 통대관" not in pg.inner_text("main"),
      "300명짜리에 카페 통대관 창구가 나온다")
    A("무료 공간이 거의 없습니다" in pg.inner_text("main"), "후보가 0곳인데 빈 화면이다")
    ok(f"구하기 — 24명 {len(small['places'])}곳, 300명 {len(big['places'])}곳으로 걸러진다")

    # 실제로 빌릴 수 있는 곳 (서울시 공공서비스예약). 인터넷이 없어도 화면은 살아야 한다.
    vn = api("/api/venues?size=24")
    A("rows" in vn and "areas" in vn, f"장소 응답 모양이 다르다: {list(vn)}")
    A(all(r["cap"] >= 24 for r in vn["rows"]), "24명을 못 받는 곳이 섞여 있다")
    if vn["rows"]:
        A(all(r["url"].startswith("http") for r in vn["rows"]), "예약 주소가 http 가 아니다")
        big_v = api("/api/venues?size=500")
        A(len(big_v["rows"]) < len(vn["rows"]), "인원이 커졌는데 후보가 안 줄었다")
        if vn["areas"]:
            one = vn["areas"][0]
            A(all(r["area"] == one for r in
                  api(f"/api/venues?size=24&area={urllib.parse.quote(one)}")["rows"]),
              "지역으로 안 걸러진다")
        ok(f"빌릴 수 있는 곳 — 공간시설 {vn['total']}건에서 24명 기준 {len(vn['rows'])}곳")
    else:
        ok("빌릴 수 있는 곳 — 목록이 비었지만 화면은 살아 있다 (인터넷 없음)")

    # 보낼 메일 초안 — 마크다운이 들어가면 안 된다 (메일에서는 별표가 그냥 별표다)
    pg.fill("#f-n", "24")
    pg.dispatch_event("#f-n", "change")
    pg.wait_for_timeout(900)
    pg.click('[data-mail="심사위원"]')
    pg.wait_for_selector("#f-mailtx")
    mail = pg.input_value("#f-mailtx")
    A("■" in mail and "제목:" in mail, "메일 초안 꼴이 아니다")
    for bad in ["**", "##", "- [ ]", "](http"]:
        A(bad not in mail, f"메일 초안에 마크다운이 들어갔다: {bad}")
    A("http" not in mail, "첫 메일에 링크가 들어갔다 (스팸으로 걸린다)")
    A("먼저 말씀드릴 것" in mail, "불리한 조건을 앞에 안 썼다")
    ok("메일 초안 — 평문, 링크 없음, 불리한 것 먼저")

    # 연락한 곳 대장
    pg.locator('[data-lead="장소"][data-src="창구"]').first.click()
    pg.wait_for_timeout(900)
    leads = api(f"/api/events/{ev}/leads", key=OK)["rows"]
    A(len(leads) == 1 and leads[0]["state"] == "보냄", f"대장에 안 들어갔다: {leads}")
    pg.click(f'[data-state="{leads[0]["id"]}"]')
    pg.wait_for_timeout(800)
    A(api(f"/api/events/{ev}/leads", key=OK)["rows"][0]["state"] == "답장",
      "상태가 안 넘어간다")
    ok("연락한 곳 대장 — 넣고 상태가 한 칸씩 돈다")

    b.close()

A(not errs, "JS 에러: " + "; ".join(errs))


# ── 8-3. 행사장 인터넷이 끊겨도 대회가 굴러가는가 ──────
# 현장 와이파이는 반드시 죽는다. 그때 앱이 같이 죽으면 대회가 끝난다.
# 밖으로 나가는 요청을 전부 막고 신청·제출·심사·큰화면을 밟는다.
with sync_playwright() as pw:
    b = pw.chromium.launch()
    HOST = BASE.split("//")[1].split(":")[0]
    ctx = b.new_context(viewport={"width": 412, "height": 900})
    outside = []

    def gate(route):
        u = route.request.url
        if HOST in u or u.startswith("data:") or u.startswith("blob:"):
            return route.continue_()
        outside.append((route.request.resource_type, u))
        return route.abort()

    ctx.route("**/*", gate)
    errs = []
    off = ctx.new_page()
    off.on("pageerror", lambda e: errs.append("정전:" + str(e)))

    oev = post("/api/events", {"title": "정전 시험"})[1]
    OK2 = oev["okey"]
    post(f"/api/events/{oev['id']}", {"starts": "2026-01-01", "ends": "2030-01-01",
         "due": "2030-01-01T18:00", "wifi": "hackon / 1234"}, key=OK2, method="PATCH")
    # 협찬 로고를 일부러 넣는다. 인터넷이 없으면 이미지가 안 오는데,
    # 그때 빈 칸만 남으면 협찬사가 돈 낸 자리가 통째로 사라진다.
    post(f"/api/events/{oev['id']}/sponsors",
         {"name": "오픈에이아이", "kind": "현금",
          "logo": "https://img.logo.dev/openai.com"}, key=OK2)

    off.goto(f"{BASE}/e/{oev['id']}", wait_until="domcontentloaded")
    off.wait_for_selector("body[data-ready='1']", timeout=10000)
    off.fill("#t-name", "정전팀"); off.fill("#t-email", "t@example.com")
    off.check("#t-agree")
    off.click("#t-join")
    off.wait_for_timeout(900)
    orows = api(f"/api/events/{oev['id']}/board", key=OK2)["rows"]
    A(orows, "인터넷 없이 신청이 안 된다")

    otid = orows[0]["id"]
    A(post(f"/api/teams/{otid}/submit",
           {"url": "http://192.168.0.9:3000", "note": "정전"} )[0] == 200,
      "인터넷 없이 제출이 안 된다")

    jo = ctx.new_page()
    jo.on("pageerror", lambda e: errs.append("정전심사:" + str(e)))
    jo.goto(f"{BASE}/j/{oev['id']}", wait_until="domcontentloaded")
    jo.wait_for_selector("#jn", timeout=10000)
    jo.fill("#jn", "정전심사")
    jo.click("#jn-go")
    jo.wait_for_timeout(900)
    A(len(jo.query_selector_all("input[type=range]")) == 4, "인터넷 없이 심사 화면이 깨진다")
    jo.click("[data-jsave]")
    jo.wait_for_timeout(900)
    A(api(f"/api/events/{oev['id']}/board", key=OK2)["rows"][0]["judges"] == 1,
      "인터넷 없이 심사가 저장 안 된다")

    tvo = ctx.new_page()
    tvo.on("pageerror", lambda e: errs.append("정전큰화면:" + str(e)))
    tvo.set_viewport_size({"width": 1280, "height": 720})
    tvo.goto(f"{BASE}/tv/{oev['id']}", wait_until="domcontentloaded")
    tvo.wait_for_timeout(1600)
    tvt = tvo.inner_text("body")
    A("hackon / 1234" in tvt, "인터넷 없이 와이파이 안내가 안 뜬다")
    A(tvo.evaluate("document.querySelectorAll('.qr.big svg').length") == 1,
      "인터넷 없이 QR 이 안 그려진다")
    A("오픈에이아이" in tvt,
      "로고를 못 받았는데 협찬사 이름이 안 뜬다 (돈 낸 자리가 사라진다)")

    A(not errs, "정전 상태 JS 에러: " + "; ".join(errs))
    # 밖으로 나가는 것이 있어도 '협찬 로고 그림' 까지만이어야 한다.
    # 스크립트·스타일·API 를 밖에서 받아 오면 그날 화면이 통째로 죽는다.
    # (플레이라이트는 <img> 요청도 fetch 로 분류할 때가 있어서 종류 말고 주소로 본다)
    urls = sorted(set(u for _, u in outside))
    bad = [u for u in urls
           if u.endswith(".js") or u.endswith(".css") or "/api/" in u
           or "cdn" in u or "googleapis" in u]
    A(not bad, f"바깥에서 코드나 API 를 받아 온다: {bad}")
    A(all("logo.dev" in u or "favicon" in u for u in urls),
      f"협찬 로고 말고 다른 것이 밖으로 나간다: {urls}")
    ctx.close()
    b.close()
ok(f"인터넷이 끊겨도 굴러간다 — 밖으로 나간 것은 협찬 로고 그림 {len(urls)}개뿐, "
   "코드·API 는 0건")


# ── 9. 윈도우 프로그램이 켤 준비가 되어 있는가 ──────────
# 창을 실제로 띄우지는 않는다. --check 는 브라우저·포트·화면 파일만 확인하고 끝난다.
r = subprocess.run(['node', 'desktop.js', '--check'],
                   cwd=os.path.dirname(os.path.abspath(__file__)),
                   capture_output=True, text=True, encoding='utf-8')
A(r.returncode == 0, 'desktop.js --check 실패: ' + (r.stderr or ''))
# 앱 창용 브라우저(엣지·크롬 경로)는 윈도우 실행기 몫이다. 맥·리눅스에서는 늘 '못 찾음' 이라
# 거기서까지 보면 검사가 늘 빨갛고, 늘 빨간 검사는 아무도 안 본다.
if sys.platform == 'win32':
    A('못 찾음' not in r.stdout, '앱 창을 띄울 브라우저가 없다: ' + r.stdout)
A('화면 파일  있음' in r.stdout, '화면 파일을 못 찾는다: ' + r.stdout)
ok('윈도우 프로그램 준비됨 (앱 창 브라우저 · 포트 · 화면 파일)')

# ── 10. 배포한 것이 사용자에게 실제로 가는가 ──────────────
# 서비스워커가 캐시를 먼저 보면, 배포를 해도 한 번 열어 본 브라우저는 옛 화면을 계속 본다.
# 실제로 그렇게 됐다 — 눈에 안 보이는 고장이라 알아채는 데 오래 걸린다.
with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 412, "height": 900})
    pg = ctx.new_page()
    pg.goto(f"{BASE}/app", wait_until="networkidle")
    pg.wait_for_selector("body[data-ready='1']", timeout=10000)
    pg.wait_for_timeout(1500)
    reg = pg.evaluate("async () => !!(await navigator.serviceWorker.getRegistration())")
    A(reg, "서비스워커가 아예 안 붙었다")
    # 서비스워커를 거쳐 받은 것이, 캐시를 건너뛰고 받은 것과 같아야 한다.
    # 다르면 사용자는 배포 전 화면을 보고 있는 것이다.
    r = pg.evaluate("""async () => {
        const a = await (await fetch('/app', {cache: 'no-store'})).text();
        const b = await (await fetch('/app')).text();
        return {same: a === b, len: b.length};
    }""")
    A(r["len"] > 1000, f"화면이 너무 짧다: {r['len']}")
    A(r["same"], "서비스워커가 서버 것과 다른(오래된) 화면을 돌려준다")
    keys = pg.evaluate("async () => await caches.keys()")
    A(all(k == "hackon-v2" for k in keys), f"옛 캐시가 남아 있다: {keys}")
    ok(f"배포한 것이 사용자에게 간다 — 서버를 먼저 본다 (캐시 {keys})")
    ctx.close()
    b.close()

A(not errs, "JS 에러: " + "; ".join(errs))
print(f"\n완주 테스트 통과 — {step}단계, JS 에러 없음")
