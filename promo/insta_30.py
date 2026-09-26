# 인스타 30일 운영 — 첫 게시물 3장(1080x1350) + 30일 캘린더(md). 새 색(잉크+라임). 숫자 창작 없음.
# 실행: python promo/insta_30.py → G:\내 드라이브\HACKON 홍보자산\인스타_30일\
import pathlib, base64
HERE = pathlib.Path(__file__).parent; ROOT = HERE.parent
OUT = pathlib.Path(r"G:\내 드라이브\HACKON 홍보자산\인스타_30일"); OUT.mkdir(parents=True, exist_ok=True)
LOGO = "data:image/svg+xml;base64," + base64.b64encode((ROOT / "logo.svg").read_bytes()).decode()
HERO = "data:image/jpeg;base64," + base64.b64encode((ROOT / "hero.jpg").read_bytes()).decode()
INK, LIME, MIST = "#0B1020", "#C8F53B", "#AEB6C8"
FONT = "font-family:'Pretendard','Malgun Gothic',sans-serif"
CSS = f"""<style>html,body{{margin:0;{FONT};color:#fff}}
.p{{width:1080px;height:1350px;position:relative;overflow:hidden;background:{INK}}}
.p.img{{background:{INK} url({HERO}) center/cover no-repeat}} .p.img::before{{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,16,32,.55),rgba(11,16,32,.95))}}
.w{{position:absolute;left:80px;right:80px;top:110px}}
.k{{font-size:30px;font-weight:800;color:{LIME};letter-spacing:2px}}
h1{{font-size:104px;font-weight:900;letter-spacing:-.04em;line-height:1.08;margin:24px 0 0}} h1 b{{color:{LIME}}}
.s{{margin-top:34px;font-size:36px;line-height:1.5;color:{MIST};font-weight:600}}
.u{{position:absolute;left:80px;bottom:80px;font-size:34px;font-weight:900;letter-spacing:2px}}
.lg{{position:absolute;right:80px;bottom:84px;height:44px;filter:brightness(0) invert(1)}}
.big{{position:absolute;left:80px;right:80px;bottom:220px;display:grid;grid-template-columns:1fr 1fr;gap:18px}}
.big div{{border:3px solid rgba(255,255,255,.18);border-radius:22px;padding:28px;font-size:34px;font-weight:800;line-height:1.35}} .big small{{display:block;font-size:24px;color:{MIST};font-weight:600;margin-top:8px}}
</style>"""
POSTS = [
 ("01_문제하나", f"""{CSS}<div class="p img"><div class="w"><div class="k">동네가 여는 하루짜리 해커톤</div>
  <h1>번거로운 일<br>하나,<br>동네가 <b>하루</b><br>만에 풉니다.</h1>
  <div class="s">코딩은 안 해 봤어도 됩니다.<br>혼자 와도 팀이 생깁니다. 참가비 0.</div></div>
  <div class="u">hackon.kr</div><img class="lg" src="{LOGO}"></div>"""),
 ("02_가져가는것셋", f"""{CSS}<div class="p"><div class="w"><div class="k">6시간 앉아 있다 가면 뭐가 남나</div>
  <h1>가져가는 것<br><b>셋.</b></h1></div>
  <div class="big">
   <div>후원 크레딧<small>제출한 팀에게만</small></div>
   <div>완주 기록·티어<small>프로필 주소가 곧 이력</small></div>
   <div>배포된 결과물<small>포트폴리오에 바로</small></div>
   <div>동네 사장님의 «이거면 됩니다»<small>진짜 손님</small></div>
  </div><div class="u">hackon.kr</div><img class="lg" src="{LOGO}"></div>"""),
 ("03_사장님", f"""{CSS}<div class="p"><div class="w"><div class="k">사장님께</div>
  <h1>매일 손이<br>가는 일 하나,<br><b>세 줄</b>만<br>적어 주세요.</h1>
  <div class="s">예약 문자 · 재고 세기 · 후기 답글 · 메뉴판<br>대학생들이 하루 만에 만들어 링크로 드립니다. 무료.</div></div>
  <div class="u">hackon.kr/ask</div><img class="lg" src="{LOGO}"></div>"""),
]
PLAN = """# 인스타 30일 운영안 (2026-09-29 ~ 10-28) — 계정 @hackon.kr(가칭, 실명·학교 노출 없음)

원칙: 주 3회(월·수·금) · 릴스 1 + 카드 2 · 숫자 창작 금지(이용자 0 정직) · 색은 잉크+라임만 · 첫 댓글에 hackon.kr 링크
기둥 셋: ① 대회(10/31) ② 문제 은행(사장님 문제·풀이) ③ 해커온뉴스(직무별 «오늘 세팅 하나»)

| 날짜 | 형식 | 내용 | 파일 |
|---|---|---|---|
| 09-29 월 | 카드 | 번거로운 일 하나, 동네가 하루 만에 | 01_문제하나.png |
| 10-01 수 | 릴스 | 자리 비었습니다(후원·기여자 모집) | HACKON_1031_릴스_자리비었습니다_9x16.mp4 |
| 10-03 금 | 카드 | 10/31 포스터 | HACKON_1031_포스터_1080x1350.png |
| 10-06 월 | 카드 | 가져가는 것 셋 | 02_가져가는것셋.png |
| 10-08 수 | 릴스 | 문제 올리면 동네가 푼다(15초) | HACKON_릴스_문제은행_9x16.mp4 |
| 10-10 금 | 카드 | 사장님께 — 세 줄만 | 03_사장님.png |
| 10-13 월 | 카드 | 해커온뉴스 — 마케팅 «오늘 세팅 하나» (news.md?job=마케팅 캡처) | 캡처 |
| 10-15 수 | 릴스 | 컨셉 v2(29초) | HACKON_컨셉_v2_9x16.mp4 |
| 10-17 금 | 카드 | 티어 — 완주 한 번이면 브론즈 | 프로필 캡처 |
| 10-20 월 | 카드 | 심사·장소·간식 자리, 남은 것 (앱 실제 수치만) | /give 캡처 |
| 10-22 수 | 릴스 | 큰 화면 로고 벽(협찬사 이름 크게) — 후원 확정된 곳 있으면 | tv 캡처 |
| 10-24 금 | 카드 | 신청 마감 D-4 | 포스터 변형 |
| 10-27 월 | 카드 | 내일 마감 | 포스터 변형 |
| 10-31 토 | 스토리 | 현장(사진 동의자만) | 당일 |

댓글·DM 규칙: 질문엔 한 줄 + 링크. «해커톤이 뭐예요» → «코딩 몰라도 되는 하루짜리 만들기 대회. 혼자 와도 팀 생겨요». 실명·학교는 쓰지 않는다.
해시태그 5개 고정: #해커톤 #바이브코딩 #AI #소상공인 #선릉
"""
def render():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, html in POSTS:
            pg = b.new_page(viewport={"width": 1080, "height": 1350}); pg.set_content(html); pg.wait_for_timeout(300)
            pg.screenshot(path=str(OUT / f"{name}.png")); pg.close()
        b.close()
    (OUT / "인스타_30일_운영안.md").write_text(PLAN, encoding="utf-8")
    print("인스타 →", OUT)
if __name__ == "__main__": render()
