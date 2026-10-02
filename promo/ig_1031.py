# 10/31 선릉 데모데이 — 인스타 포스터(1080x1350) + 스토리(1080x1920)
# 사실만: 2026-10-31(토) 13:00 시작 · 약 2시간 · 선릉역 인근(장소 확정 후 안내) · 참가비 무료 · 개인 또는 팀 · 동아리 루키 위주
#   미리 MVP 를 만들어 오고, 1분 이내 유튜브 데모 + 슬라이드를 낸다. 당일은 이그나이트 2분(제목 5초 + 슬라이드 8장 × 15초 자동 넘김)
#   ElevenLabs: 참가자 전원 Creator 1개월(후원사 이메일 제공 동의 시) · 종합 우승 Pro 3개월 · ElevenLabs 활용상 Scale 3개월
#   Claude·Codex 로만 만든 것도 환영 · 10월 중 사전 교육 세션
# 적지 않는 것: 장소 이름(미정), 신청 마감일(미정), 정원(미정). 정해지면 여기에 더한다.
# 톤: 10/29 는 이태원 참사 기일이다. 핼러윈·인파·파티 그림을 쓰지 않는다.
# 예전 «자리 비었습니다» 릴스(13–19시·20명 개인전)는 형식이 바뀌어 뺐다 — 필요하면 git 이력에 있다.
# 실행: python3 promo/ig_1031.py [poster|story|all]   → $HACKON_OUT (기본 promo/out/, gitignore)
import os, sys, base64, pathlib
HERE = pathlib.Path(__file__).parent
OUT = pathlib.Path(os.environ.get("HACKON_OUT") or HERE / "out"); OUT.mkdir(parents=True, exist_ok=True)
LOGO = (HERE.parent / "logo.svg").read_text(encoding="utf-8")
URI = "data:image/svg+xml;base64," + base64.b64encode(LOGO.encode()).decode()
INK, LIME, MIST = "#0B1020", "#C8F53B", "#AEB6C8"
FONT = "font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif"

# 이그나이트 시간 띠 — 제목 5초 한 칸 + 슬라이드 15초 여덟 칸. 길이 비율이 곧 시간 비율이다
IGNITE = '<div class="ig"><i class="t"></i>' + '<i></i>' * 8 + '</div>'


def page(W, H, story):
    top = 250 if story else 64          # 스토리는 위아래 250px 를 앱 UI 가 가린다
    return f"""<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;background:{INK};color:#fff;{FONT}}}
.p{{width:{W}px;height:{H}px;position:relative;overflow:hidden;background:radial-gradient(ellipse 85% 50% at 50% 22%,#152046 0%,{INK} 70%)}}
.grid{{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:72px 72px}}
.w{{position:absolute;left:72px;right:72px;top:{top}px;display:flex;flex-direction:column}}
.top{{display:flex;align-items:center;gap:18px}}
.top img{{height:42px;filter:brightness(0) invert(1)}}
.top span{{font-size:22px;font-weight:700;color:{MIST};letter-spacing:2px}}
.date{{margin-top:{60 if story else 52}px;font-size:34px;font-weight:800;color:{LIME};letter-spacing:.5px}}
h1{{margin:18px 0 0;font-size:{104 if story else 92}px;line-height:1.1;font-weight:900;letter-spacing:-3px}}
h1 b{{color:{LIME}}}
.sub{{margin-top:26px;font-size:30px;font-weight:600;color:{MIST};line-height:1.5}}
.sub b{{color:#fff}}
.ig{{margin-top:30px;display:flex;gap:6px;height:22px}}
.ig i{{flex:15;border:2.5px solid {LIME};border-radius:5px}}
.ig i.t{{flex:5;background:{LIME}}}
.igl{{margin-top:10px;display:flex;justify-content:space-between;font-size:19px;color:{MIST};font-weight:600}}
.facts{{margin-top:{44 if story else 34}px;display:grid;grid-template-columns:1fr 1fr;gap:14px}}
.f{{border:2px solid rgba(255,255,255,.14);border-radius:18px;padding:18px 24px}}
.f small{{display:block;font-size:19px;color:{MIST};font-weight:600;margin-bottom:4px}}
.f div{{font-size:{31 if story else 29}px;font-weight:800;line-height:1.3}}
.f div em{{font-style:normal;font-size:20px;color:{MIST};font-weight:600;display:block}}
.spon{{margin-top:{40 if story else 26}px;font-size:{23 if story else 21}px;color:{MIST};line-height:1.6}}
.spon b{{color:#fff}}
.note{{margin-top:{18 if story else 10}px;font-size:{23 if story else 21}px;color:{MIST};line-height:1.6}}
.foot{{position:absolute;left:72px;right:72px;bottom:{260 if story else 64}px;display:flex;align-items:center;justify-content:space-between}}
.u{{font-size:30px;font-weight:800;letter-spacing:2px}}
.cta{{background:{LIME};color:{INK};font-size:32px;font-weight:900;padding:20px 36px;border-radius:16px}}
</style><div class="p"><div class="grid"></div><div class="w">
<div class="top"><img src="{URI}"><span>데모데이 · 선릉</span></div>
<div class="date">2026. 10. 31 (토) 13:00 · 약 2시간</div>
<h1>미리 만들어 오고,<br><b>2분</b>만 말합니다.</h1>
<div class="sub">이그나이트 발표 — <b>제목 5초 + 슬라이드 8장 × 15초.</b><br>슬라이드는 저절로 넘어갑니다.</div>
{IGNITE}<div class="igl"><span>제목 5초</span><span>8장 × 15초 = 2분</span></div>
<div class="facts">
 <div class="f"><small>어디</small><div>선릉역 인근<em>장소 확정 후 안내</em></div></div>
 <div class="f"><small>누구</small><div>개인 또는 팀<em>동아리 루키 환영</em></div></div>
 <div class="f"><small>참가비</small><div>무료</div></div>
 <div class="f"><small>미리 낼 것</small><div>1분 이내 데모<em>유튜브 영상 링크 + 슬라이드</em></div></div>
</div>
<div class="spon"><b>ElevenLabs 후원</b> — 참가자 전원 Creator 1개월(후원사 이메일 제공 동의 시)<br>종합 우승 Pro 3개월 · ElevenLabs 활용상 Scale 3개월</div>
<div class="note">Claude·Codex 로만 만든 것도 환영합니다. 10월 중 사전 교육 세션이 있습니다.</div>
</div><div class="foot"><div class="u">hackon.kr</div><div class="cta">신청은 hackon.kr</div></div></div>"""


def shot(name, W, H, story):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={"width": W, "height": H})
        pg.set_content(page(W, H, story)); pg.wait_for_timeout(400)
        # 넘친 글자가 바닥 단추를 덮으면 안 된다 — 본문 끝이 바닥 줄보다 위인지 본다
        gap = pg.evaluate("document.querySelector('.foot').getBoundingClientRect().top - document.querySelector('.w').getBoundingClientRect().bottom")
        f = OUT / name; pg.screenshot(path=str(f)); b.close()
    print(f"{f}  (본문과 바닥 사이 {gap:.0f}px)")
    if gap < 16: sys.exit("글자가 바닥 줄에 닿는다 — 문구를 줄인다")


if __name__ == "__main__":
    w = sys.argv[1] if len(sys.argv) > 1 else "all"
    if w in ("poster", "all"): shot("HACKON_1031_데모데이_포스터_1080x1350.png", 1080, 1350, False)
    if w in ("story", "all"): shot("HACKON_1031_데모데이_스토리_1080x1920.png", 1080, 1920, True)
