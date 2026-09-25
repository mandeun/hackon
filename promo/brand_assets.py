# 새 색 브랜드 자산 — OG 이미지(1200×630, 링크 미리보기) + 가게 붙임용 A4 «문제 접수» 포스터(QR → hackon.kr/ask)
# 실행: python promo/brand_assets.py   → og.png(프로젝트 루트) · G:\내 드라이브\HACKON 홍보자산\
import pathlib, base64, subprocess, sys
HERE = pathlib.Path(__file__).parent; ROOT = HERE.parent
OUT = pathlib.Path(r"G:\내 드라이브\HACKON 홍보자산")
LOGO = "data:image/svg+xml;base64," + base64.b64encode((ROOT / "logo.svg").read_bytes()).decode()
HERO = "data:image/jpeg;base64," + base64.b64encode((ROOT / "hero.jpg").read_bytes()).decode()
INK, LIME, MIST = "#0B1020", "#C8F53B", "#AEB6C8"
FONT = "font-family:'Pretendard','Malgun Gothic',sans-serif"

OG = f"""<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;width:1200px;height:630px;overflow:hidden;{FONT};color:#fff}}
.p{{position:relative;width:1200px;height:630px;background:{INK} url({HERO}) center/cover no-repeat}}
.p::before{{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(11,16,32,.95),rgba(11,16,32,.75) 60%,rgba(11,16,32,.3))}}
.w{{position:absolute;left:80px;top:90px;right:80px}}
.w img{{height:56px;filter:brightness(0) invert(1)}}
h1{{font-size:78px;font-weight:900;letter-spacing:-.04em;line-height:1.12;margin:40px 0 0}} h1 b{{color:{LIME}}}
.s{{margin-top:26px;font-size:28px;color:{MIST};font-weight:600}}
.u{{position:absolute;left:80px;bottom:60px;font-size:30px;font-weight:800;letter-spacing:2px}}
.dot{{position:absolute;right:80px;bottom:60px;width:26px;height:26px;border-radius:50%;background:{LIME};box-shadow:0 0 0 10px rgba(200,245,59,.22)}}
</style><div class="p"><div class="w"><img src="{LOGO}"><h1>번거로운 일 하나,<br>동네가 <b>하루 만에</b> 풉니다.</h1>
<div class="s">누구나 여는 하루짜리 해커톤 · 코딩은 안 해 봤어도 됩니다</div></div><div class="u">hackon.kr</div><div class="dot"></div></div>"""

POSTER = f"""<!doctype html><meta charset="utf-8"><style>
@page{{size:A4;margin:0}} html,body{{margin:0;{FONT};color:{INK};background:#fff}}
.p{{width:794px;height:1123px;position:relative;overflow:hidden;padding:64px 60px;box-sizing:border-box;background:#fff}}
.top{{display:flex;align-items:center;gap:14px}} .top img{{height:34px}} .top span{{font-size:15px;color:#5B6470;font-weight:700;letter-spacing:1px}}
h1{{font-size:54px;font-weight:900;letter-spacing:-.04em;line-height:1.14;margin:54px 0 0}} h1 b{{background:{LIME};padding:0 8px;border-radius:8px}}
.s{{margin-top:22px;font-size:21px;line-height:1.55;color:#3A4150}}
.ex{{margin-top:26px;display:grid;grid-template-columns:1fr 1fr;gap:12px}}
.ex div{{border:2px solid #E3E6EA;border-radius:16px;padding:14px 16px;font-size:17px;font-weight:700;color:#0B1020}} .ex div small{{display:block;font-weight:500;color:#5B6470;font-size:14px;margin-top:4px}}
.how{{margin-top:30px;display:flex;align-items:center;gap:28px;background:{INK};color:#fff;border-radius:22px;padding:26px 28px}}
.how img{{width:190px;height:190px;border-radius:14px;background:#fff;padding:10px;box-sizing:border-box}}
.how .t{{font-size:22px;font-weight:800;line-height:1.4}} .how .t b{{color:{LIME}}} .how .t small{{display:block;font-size:15px;color:{MIST};font-weight:500;margin-top:10px;line-height:1.5}}
.f{{position:absolute;left:60px;right:60px;bottom:56px;font-size:14px;color:#5B6470;line-height:1.6;border-top:1px solid #E3E6EA;padding-top:14px}}
.u{{position:absolute;right:60px;bottom:56px;font-size:20px;font-weight:900;letter-spacing:2px;color:{INK};background:#fff;padding-left:12px}}
</style><div class="p">
<div class="top"><img src="{LOGO}"><span>동네가 여는 하루짜리 해커톤</span></div>
<h1>가게에서 매일<br>손이 가는 일 하나,<br><b>대학생들이 하루 만에</b><br>만들어 드립니다.</h1>
<div class="s">돈은 안 받습니다. 사장님은 «뭐가 제일 번거로운지» 세 줄만 적으시면 됩니다.<br>만든 결과는 링크로 받고, 마음에 드는 것만 쓰시면 됩니다.</div>
<div class="ex">
 <div>예약 문자를 하나하나 보낸다<small>→ 예약자에게 문자가 저절로 가게</small></div>
 <div>재고를 매일 손으로 센다<small>→ 재고가 표로 자동으로 나오게</small></div>
 <div>네이버 후기를 일일이 답한다<small>→ 후기별 답글 초안이 나오게</small></div>
 <div>메뉴판 사진을 매번 새로 만든다<small>→ 가격만 바꾸면 메뉴판이 나오게</small></div>
</div>
<div class="how"><img id="qr" src=""><div class="t">휴대폰으로 찍고<br><b>3분</b>만 적어 주세요.<small>hackon.kr/ask · 이름·연락처는 만드는 팀에게만 갑니다. 결과가 나오면 «이거면 됩니다»만 눌러 주시면 끝.</small></div></div>
<div class="f">HACK:ON 은 동네 사람들이 여는 하루짜리 만들기 대회입니다. 앱은 돈을 만지지 않고, 결과물의 권리는 만든 사람에게 있습니다. 문의 hi@mandeun.com</div>
<div class="u">hackon.kr</div></div>"""

def render():
    from playwright.sync_api import sync_playwright
    qr = (ROOT / "qr.js").read_text(encoding="utf-8")
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1200, "height": 630}); pg.set_content(OG); pg.wait_for_timeout(400)
        pg.screenshot(path=str(ROOT / "og.png")); pg.screenshot(path=str(OUT / "HACKON_OG_1200x630.png"))
        pg = b.new_page(viewport={"width": 794, "height": 1123}, device_scale_factor=2); pg.set_content(POSTER)
        pg.add_script_tag(content=qr); pg.wait_for_timeout(200)
        pg.evaluate("""() => { const q = (window.qrcode || window.QR || null); const el = document.getElementById('qr');
          try { const o = qrcode(0, 'M'); o.addData('https://hackon.kr/ask'); o.make(); el.src = o.createDataURL(8, 0); } catch (e) { el.alt = 'QR'; el.style.display='none'; } }""")
        pg.wait_for_timeout(300)
        pg.screenshot(path=str(OUT / "HACKON_가게포스터_A4_문제접수.png"))
        pg.pdf(path=str(OUT / "HACKON_가게포스터_A4_문제접수.pdf"), format="A4", print_background=True)
        b.close()
    print("og.png + 포스터 →", OUT)

if __name__ == "__main__": render()
