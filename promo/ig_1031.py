# 10/31 선릉 대회 — 인스타 포스터(1080x1350) + «자리 비었습니다» 릴스(9:16, 15초, 글자 애니메이션 + 배경음)
# 사실만: 2026-10-31(토) 13:00~19:00 · 선릉역 근처(장소 확정 전) · 개인전 · 정원 20 · 참가비 0 · 신청 마감 10/28 · ElevenLabs 후원 확정(9/16 메일)
# 실행: python promo/ig_1031.py [poster|reel|all]   → G:\내 드라이브\HACKON 홍보자산\
import sys, pathlib, base64, subprocess, json
HERE = pathlib.Path(__file__).parent; sys.path.insert(0, str(HERE))
OUT = pathlib.Path(r"G:\내 드라이브\HACKON 홍보자산"); OUT.mkdir(exist_ok=True)
LOGO = (HERE.parent / "logo.svg").read_text(encoding="utf-8")
URI = "data:image/svg+xml;base64," + base64.b64encode(LOGO.encode()).decode()
INK, LIME, MIST = "#0B1020", "#C8F53B", "#AEB6C8"
FONT = "font-family:'Pretendard','Malgun Gothic',sans-serif"

POSTER = f"""<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;background:{INK};color:#fff;{FONT}}}
.p{{width:1080px;height:1350px;position:relative;overflow:hidden;background:radial-gradient(ellipse 80% 55% at 50% 30%,#152046 0%,{INK} 70%)}}
.grid{{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:72px 72px}}
.top{{position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:18px}}
.top img{{height:44px;filter:brightness(0) invert(1)}}
.top span{{font-size:22px;font-weight:700;color:{MIST};letter-spacing:2px}}
.date{{position:absolute;left:72px;top:190px;font-size:34px;font-weight:800;color:{LIME};letter-spacing:1px}}
h1{{position:absolute;left:72px;top:250px;margin:0;font-size:96px;line-height:1.12;font-weight:900;letter-spacing:-2px}}
h1 b{{color:{LIME}}}
.sub{{position:absolute;left:72px;top:600px;font-size:34px;font-weight:600;color:{MIST};line-height:1.5}}
.facts{{position:absolute;left:72px;right:72px;top:790px;display:grid;grid-template-columns:1fr 1fr;gap:16px}}
.f{{border:2px solid rgba(255,255,255,.14);border-radius:18px;padding:22px 26px}}
.f small{{display:block;font-size:20px;color:{MIST};font-weight:600;margin-bottom:6px}}
.f div{{font-size:36px;font-weight:800}}
.spon{{position:absolute;left:72px;top:1090px;font-size:24px;color:{MIST}}}
.spon b{{color:#fff}}
.cta{{position:absolute;right:72px;bottom:72px;background:{LIME};color:{INK};font-size:34px;font-weight:900;padding:22px 40px;border-radius:16px}}
.u{{position:absolute;left:72px;bottom:84px;font-size:30px;font-weight:800;letter-spacing:2px}}
</style><div class="p"><div class="grid"></div>
<div class="top"><img src="{URI}"><span>1회차 · 선릉</span></div>
<div class="date">2026. 10. 31 (토) 13:00 – 19:00</div>
<h1>번거로운 일 하나,<br><b>하루 만에</b><br>만들어 옵니다.</h1>
<div class="sub">혼자 와서 6시간. 코딩은 안 해 봤어도 됩니다.<br>AI로 만들고, 그 자리에서 배포까지.</div>
<div class="facts">
 <div class="f"><small>어디</small><div>선릉역 근처</div></div>
 <div class="f"><small>누구</small><div>개인전 · 20명</div></div>
 <div class="f"><small>참가비</small><div>0원</div></div>
 <div class="f"><small>신청 마감</small><div>10월 28일</div></div>
</div>
<div class="spon"><b>ElevenLabs 후원</b> — 참가자 전원 Creator 1개월 · 우승 Pro 3개월</div>
<div class="u">hackon.kr</div><div class="cta">신청은 hackon.kr</div></div>"""

REEL = f"""<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;background:{INK};color:#fff;{FONT};width:540px;height:960px;overflow:hidden}}
.w{{position:absolute;inset:0;padding:0 44px;display:flex;flex-direction:column;justify-content:center}}
.k{{font-size:22px;font-weight:700;color:{LIME};letter-spacing:2px;opacity:0;animation:up .35s .1s forwards}}
h1{{font-size:54px;font-weight:900;line-height:1.18;margin:10px 0 0;opacity:0;animation:up .4s .35s forwards}}
h1 b{{color:{LIME}}}
.seat{{margin-top:26px;display:flex;align-items:center;gap:14px;font-size:30px;font-weight:800;opacity:0;animation:up .3s forwards}}
.seat i{{width:22px;height:22px;border-radius:50%;border:3px solid {LIME};display:inline-block;position:relative}}
.seat i::after{{content:'';position:absolute;inset:4px;border-radius:50%;background:{LIME};opacity:0;animation:pop .25s forwards;animation-delay:inherit}}
.seat small{{font-size:20px;color:{MIST};font-weight:600}}
.fx{{margin-top:34px;font-size:24px;color:{MIST};font-weight:600;line-height:1.5;opacity:0;animation:up .35s 6.2s forwards}}
.cta{{margin-top:28px;align-self:flex-start;background:{LIME};color:{INK};font-size:28px;font-weight:900;padding:16px 26px;border-radius:12px;opacity:0;animation:pop .35s 8.6s forwards}}
.u{{position:absolute;left:44px;bottom:250px;font-size:26px;font-weight:800;letter-spacing:2px;opacity:0;animation:up .3s 9s forwards}}
.ex{{position:absolute;left:44px;right:44px;bottom:206px;font-size:15px;color:{MIST};opacity:0;animation:up .3s 9.2s forwards}}
@keyframes up{{to{{opacity:1;transform:translateY(0)}}from{{transform:translateY(14px)}}}}
@keyframes pop{{to{{opacity:1;transform:scale(1)}}from{{transform:scale(.6)}}}}
</style><div class="w">
<div class="k">10.31 (토) · 선릉 · 20명</div>
<h1>이 대회, <b>자리</b>가<br>비었습니다.</h1>
<div class="seat" style="animation-delay:1.6s"><i style="animation-delay:2.2s"></i>장소 <small>6시간 · 20명</small></div>
<div class="seat" style="animation-delay:2.4s"><i style="animation-delay:3.0s"></i>심사 <small>오후 한 시간</small></div>
<div class="seat" style="animation-delay:3.2s"><i style="animation-delay:3.8s"></i>간식 <small>20명분</small></div>
<div class="seat" style="animation-delay:4.0s"><i style="animation-delay:4.6s"></i>크레딧 <small>ElevenLabs 는 켜졌습니다</small></div>
<div class="fx">맡아 주시면 이름이 대회 페이지·행사장 큰 화면·결과 보고서에 남습니다.<br>돈은 앱이 안 만집니다 — 주최자와 직접.</div>
<div class="cta">hackon.kr → 이 자리 맡기</div>
<div class="u">hackon.kr</div><div class="ex">2026-10-31 13:00–19:00 · 선릉역 근처 · 개인전 · 참가비 0 · 신청 마감 10/28</div>
</div>"""

def poster():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1080, "height": 1350}); pg.set_content(POSTER); pg.wait_for_timeout(400)
        pg.screenshot(path=str(OUT / "HACKON_1031_포스터_1080x1350.png")); b.close()
    print("포스터:", OUT / "HACKON_1031_포스터_1080x1350.png")

def reel():
    from cdprec import Rec
    D = pathlib.Path(r"C:\Users\tree0\AppData\Local\Temp\hackon_reel"); D.mkdir(exist_ok=True)
    with Rec(D, "reel_seats", html=REEL) as pg: pg.wait_for_timeout(13500)
    subprocess.run([sys.executable, str(HERE / "bgm.py"), "14", "96"], check=True, capture_output=True)
    sfx = HERE / "sfx"
    ev = [("whoosh", 0.3), ("done", 2.2), ("done", 3.0), ("done", 3.8), ("done", 4.6), ("button", 8.6)]
    ain = ["-i", str(D / "reel_seats.mp4"), "-i", str(sfx / "bgm.wav")]; parts = ["[1:a]volume=0.5,atrim=0:13.5[bed]"]; mix = ["[bed]"]
    for i, (n, t) in enumerate(ev):
        ain += ["-i", str(sfx / f"{n}.wav")]; parts.append(f"[{i + 2}:a]volume=0.7,adelay={int(t * 1000)}|{int(t * 1000)}[s{i}]"); mix.append(f"[s{i}]")
    parts.append("".join(mix) + f"amix=inputs={len(mix)}:normalize=0:duration=first,volume=0.8,alimiter=limit=0.85[a]")
    out = OUT / "HACKON_1031_릴스_자리비었습니다_9x16.mp4"
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", *ain, "-filter_complex", ";".join(parts), "-map", "0:v", "-map", "[a]", "-t", "13.5", "-c:v", "libx264", "-crf", "18", "-c:a", "aac", "-b:a", "160k", str(out)], capture_output=True, text=True)
    print(r.stderr or f"릴스: {out}")

if __name__ == "__main__":
    w = sys.argv[1] if len(sys.argv) > 1 else "all"
    if w in ("poster", "all"): poster()
    if w in ("reel", "all"): reel()
