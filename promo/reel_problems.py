# 릴스 «문제 올리면 동네가 푼다» — 15초 · 9:16 · 글자 애니메이션 + 배경음 · 사실만(이용자 0)
# 실행: python promo/reel_problems.py → G:\내 드라이브\HACKON 홍보자산\HACKON_릴스_문제은행_9x16.mp4
import sys, pathlib, base64, subprocess
HERE = pathlib.Path(__file__).parent; sys.path.insert(0, str(HERE))
OUT = pathlib.Path(r"G:\내 드라이브\HACKON 홍보자산")
INK, LIME, MIST = "#0B1020", "#C8F53B", "#AEB6C8"
FONT = "font-family:'Pretendard','Malgun Gothic',sans-serif"
REEL = f"""<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;background:{INK};color:#fff;{FONT};width:540px;height:960px;overflow:hidden}}
.w{{position:absolute;inset:0;padding:130px 44px 0;display:flex;flex-direction:column}}
.k{{font-size:22px;font-weight:700;color:{LIME};letter-spacing:2px;opacity:0;animation:up .35s .2s forwards}}
h1{{font-size:52px;font-weight:900;line-height:1.16;margin:12px 0 0;opacity:0;animation:up .4s .5s forwards}} h1 b{{color:{LIME}}}
.line{{margin-top:22px;font-size:26px;font-weight:800;opacity:0;animation:up .35s forwards;display:flex;align-items:center;gap:12px}}
.line i{{flex:none;width:34px;height:34px;border-radius:50%;background:{LIME};color:{INK};font-style:normal;font-size:18px;font-weight:900;display:grid;place-items:center}}
.line small{{display:block;font-size:18px;color:{MIST};font-weight:600}}
.cta{{margin-top:36px;align-self:flex-start;background:{LIME};color:{INK};font-size:28px;font-weight:900;padding:16px 26px;border-radius:12px;opacity:0;animation:pop .35s 10.6s forwards}}
.u{{margin-top:22px;font-size:24px;font-weight:800;letter-spacing:2px;opacity:0;animation:up .3s 11s forwards}}
.ex{{margin-top:6px;font-size:14px;color:{MIST};opacity:0;animation:up .3s 11.2s forwards}}
@keyframes up{{to{{opacity:1;transform:translateY(0)}}from{{transform:translateY(14px)}}}}
@keyframes pop{{to{{opacity:1;transform:scale(1)}}from{{transform:scale(.6)}}}}
</style><div class="w">
<div class="k">사장님 · 세 줄</div>
<h1>매일 손이 가는 일,<br><b>동네가</b> 풉니다.</h1>
<div class="line" style="animation-delay:2.2s"><i>1</i><div>세 줄만 적는다<small>«예약 문자를 하나하나 보냅니다»</small></div></div>
<div class="line" style="animation-delay:4.4s"><i>2</i><div>동네가 하루 만에 만든다<small>대회에서, 또는 문제 은행에서 혼자</small></div></div>
<div class="line" style="animation-delay:6.6s"><i>3</i><div>«이거면 됩니다» 한 번<small>링크로 받고, 마음에 들면 쓴다. 무료</small></div></div>
<div class="line" style="animation-delay:8.8s"><i>+</i><div>만든 사람에겐 기록이 남는다<small>완주 · 티어 · 기여</small></div></div>
<div class="cta">hackon.kr/ask</div>
<div class="u">hackon.kr</div><div class="ex">앱은 돈을 만지지 않습니다 · 결과물 권리는 만든 사람에게</div>
</div>"""
def reel():
    from cdprec import Rec
    D = pathlib.Path(r"C:\Users\tree0\AppData\Local\Temp\hackon_reel2"); D.mkdir(exist_ok=True)
    with Rec(D, "reel_problems", html=REEL) as pg: pg.wait_for_timeout(15000)
    subprocess.run([sys.executable, str(HERE / "bgm.py"), "16", "96"], check=True, capture_output=True)
    sfx = HERE / "sfx"
    ev = [("whoosh", 0.4), ("done", 2.4), ("done", 4.6), ("done", 6.8), ("done", 9.0), ("button", 10.6)]
    ain = ["-i", str(D / "reel_problems.mp4"), "-i", str(sfx / "bgm.wav")]; parts = ["[1:a]volume=0.5,atrim=0:15[bed]"]; mix = ["[bed]"]
    for i, (n, t) in enumerate(ev):
        ain += ["-i", str(sfx / f"{n}.wav")]; parts.append(f"[{i + 2}:a]volume=0.7,adelay={int(t * 1000)}|{int(t * 1000)}[s{i}]"); mix.append(f"[s{i}]")
    parts.append("".join(mix) + f"amix=inputs={len(mix)}:normalize=0:duration=first,volume=0.8,alimiter=limit=0.85[a]")
    out = OUT / "HACKON_릴스_문제은행_9x16.mp4"
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", *ain, "-filter_complex", ";".join(parts), "-map", "0:v", "-map", "[a]", "-t", "15", "-c:v", "libx264", "-crf", "18", "-c:a", "aac", "-b:a", "160k", str(out)], capture_output=True, text=True)
    print(r.stderr or f"릴스: {out}")
if __name__ == "__main__": reel()
