# 페르소나판 자막·이름표·전환·엔드카드 PNG. 문장은 GLM 채택안 그대로(4~5자/초), 디자인은 v4 자막과 같은 결.
import pathlib, base64
from playwright.sync_api import sync_playwright

OUT = pathlib.Path(r"C:\Users\tree0\AppData\Local\Temp\hackon_persona")
LOGO = pathlib.Path(r"C:\Users\tree0\OneDrive\Desktop\Projects\hackon\logo.svg").read_text(encoding="utf-8")
LOGO_URI = "data:image/svg+xml;base64," + base64.b64encode(LOGO.encode()).decode()

CAPS = [   # (이름, 문장, 크기)  on = 핵심 단어 파랑
    ("cap01", "이 해커톤, <b class='on'>장부가 다 찼습니다</b>", 60),
    ("cap03", "나는 대회 이름을 <b class='on'>오늘</b> 줍니다", 60),
    ("cap04", "필요한 자리를 <b class='on'>먼저</b> 적어 둡니다", 58),
    ("cap06", "나는 카페 자리를 <b class='on'>사흘 전</b> 줍니다", 58),
    ("cap07", "나는 당일 심사 <b class='on'>한 시간</b>을 줍니다", 58),
    ("cap08", "확인되면 <b class='on'>공개 장부</b>에 이름이 오릅니다", 54),
    ("cap09", "나는 올 거라고 <b class='on'>사흘 전</b> 말합니다", 58),
    ("cap11", "<b class='on'>네 사람의 한 줄</b>로 대회 한 개", 60),
    ("cap12", "다음 한 줄은 <b class='on'>당신</b> 차례입니다", 60),
]
CHIPS = [  # 화자 이름표 — 같은 자리(왼쪽 위)에 고정. «예시»를 이름표에도 박는다
    ("chip03", "정하늘", "동아리 회장"),
    ("chip06", "박서윤", "동네 카페 사장"),
    ("chip07", "이도현", "직장인 개발자"),
    ("chip09", "오유진", "코딩 비경험 1학년"),
]

CAP = """<!doctype html><meta charset="utf-8"><style>
 html,body{margin:0;background:transparent}
 .w{width:1080px;height:340px;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(ellipse 72%% 62%% at 50%% 50%%, rgba(12,15,23,.88) 0%%, rgba(12,15,23,.60) 55%%, rgba(12,15,23,0) 100%%)}
 .t{font-family:'Pretendard','Malgun Gothic',sans-serif;font-weight:800;font-size:%dpx;letter-spacing:3px;color:rgb(250,248,244);
    text-shadow:0 6px 18px rgba(0,0,0,.6);text-align:center;line-height:1.34;padding:0 58px;white-space:pre-line}
 .t b{font-weight:900} .t b.on{color:#7FA0FF}
 .bar{position:absolute;left:50%%;transform:translateX(-50%%);top:74px;width:54px;height:5px;border-radius:3px;background:#2350F5}
</style><div class="w"><div class="bar"></div><div class="t">%s</div></div>"""

CHIP = """<!doctype html><meta charset="utf-8"><style>
 html,body{margin:0;background:transparent}
 .c{display:inline-flex;align-items:center;gap:14px;padding:14px 26px 14px 18px;border-radius:999px;background:rgba(12,15,23,.86);
    font-family:'Pretendard','Malgun Gothic',sans-serif;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.35)}
 .dot{width:18px;height:18px;border-radius:50%%;background:#2350F5}
 .n{font-weight:900;font-size:34px;letter-spacing:1px} .r{font-weight:600;font-size:26px;color:#AEB6C8}
 .ex{font-weight:800;font-size:22px;color:#0B1020;background:#FFD666;border-radius:8px;padding:2px 10px;margin-left:4px}
</style><div class="c"><span class="dot"></span><span class="n">%s</span><span class="r">%s</span><span class="ex">예시</span></div>"""

TRANS = """<!doctype html><meta charset="utf-8"><style>
 html,body{margin:0;background:#0B1020;width:1080px;height:1920px;overflow:hidden}
 .w{width:1080px;height:1920px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px}
 img{width:640px;height:auto} .t{font-family:'Pretendard','Malgun Gothic',sans-serif;font-weight:900;font-size:92px;color:#fff;letter-spacing:6px}
</style><div class="w"><img src="%s"><div class="t">HACK:ON</div></div>"""

END = """<!doctype html><meta charset="utf-8"><style>
 html,body{margin:0;background:#0B1020;width:1080px;height:1920px;overflow:hidden}
 .w{width:1080px;height:1920px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding-top:380px;box-sizing:border-box;gap:34px;
    font-family:'Pretendard','Malgun Gothic',sans-serif;color:#fff;text-align:center}
 img{width:560px;height:auto;margin-bottom:40px}
 .u{font-weight:900;font-size:120px;letter-spacing:4px}
 .a{font-weight:700;font-size:54px;color:#AEB6C8}
 .b{margin-top:26px;background:#2350F5;border-radius:22px;padding:34px 64px;font-weight:900;font-size:58px}
 .ex{position:absolute;left:0;right:0;bottom:600px;font-weight:600;font-size:34px;color:#AEB6C8}
</style><div class="w"><img src="%s"><div class="u">hackon.kr</div><div class="a">이름 하나 적으면, 대회가 열립니다</div>
<div class="b">1단계 · 대회 만들기</div></div><div class="ex">화면 속 인물·약속은 예시입니다 · 이용자 0명에서 정직하게</div>"""

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1080, "height": 340}, device_scale_factor=1)
    for name, html_, size in CAPS:
        pg.set_content(CAP % (size, html_)); pg.wait_for_timeout(150)
        pg.screenshot(path=str(OUT / f"{name}.png"), omit_background=True); print("자막:", name)
    pg2 = b.new_page(viewport={"width": 700, "height": 90}, device_scale_factor=1)
    for name, who, role in CHIPS:
        pg2.set_content(CHIP % (who, role)); pg2.wait_for_timeout(150)
        pg2.locator(".c").screenshot(path=str(OUT / f"{name}.png"), omit_background=True); print("이름표:", name)
    pg3 = b.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
    pg3.set_content(TRANS % LOGO_URI); pg3.wait_for_timeout(300); pg3.screenshot(path=str(OUT / "trans.png"))
    pg3.set_content(END % LOGO_URI); pg3.wait_for_timeout(300); pg3.screenshot(path=str(OUT / "end.png"))
    print("전환·엔드카드 구움")
    b.close()
