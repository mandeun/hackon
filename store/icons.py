# 앱 아이콘 PNG — icon.svg 그림을 그대로 찍어 만든다. 손으로 그리지 않는다(색을 바꾸면 이걸 다시 돌린다).
# 실행: python3 store/icons.py        (playwright + chromium, PIL 이 있어야 한다)
#   → icon-192.png, icon-512.png       매니페스트 purpose «any» — icon.svg 그대로, 둥근 모서리 밖은 투명
#   → icon-maskable-512.png            purpose «maskable» — 먹 바탕을 끝까지 채우고, 그림은 가운데 원(반지름 40%) 안
#   → store/out/play-icon-512.png      구글 플레이 앱 아이콘 — 512×512 32비트 PNG. 모서리는 플레이가 깎으니 네모로 꽉 채운다
# 앞의 셋은 화면이 쓰는 파일이라 저장소에 올리고, 플레이 아이콘은 store/out(.gitignore)에 둔다.
import io, re, pathlib
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "store" / "out"
OUT.mkdir(parents=True, exist_ok=True)
INK = "#0B1020"

svg = (ROOT / "icon.svg").read_text(encoding="utf-8")
svg = re.sub(r"<!--[\s\S]*?-->", "", svg)
# 바탕(먹 둥근 네모)을 떼고 그림(알약·점 둘)만 남긴다. 바탕은 용도마다 다르게 깐다
art = re.sub(r'<rect width="192" height="192"[^>]*/>', "", re.search(r"<svg[^>]*>([\s\S]*)</svg>", svg).group(1)).strip()
assert "C8F53B" in art and 'width="192"' not in art, "icon.svg 모양이 바뀌었다 — 이 스크립트의 바탕 떼기를 고친다"


def compose(full_bleed, scale):
    """192 칸 위에 그린다. full_bleed 면 먹을 끝까지, 아니면 icon.svg 처럼 둥근 네모."""
    bg = (f'<rect width="192" height="192" fill="{INK}"/>' if full_bleed
          else f'<rect width="192" height="192" rx="44" fill="{INK}"/>')
    k = f"translate(96 96) scale({scale}) translate(-96 -96)"
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="100%" height="100%">{bg}<g transform="{k}">{art}</g></svg>'


# 이름, 크기, 그림, 저장할 곳
JOBS = [
    ("icon-192.png", 192, compose(False, 1), ROOT),
    ("icon-512.png", 512, compose(False, 1), ROOT),
    # 그림의 가장 먼 점(알약 모서리 + 테두리 두께)이 원본에서 중심으로부터 39.4% 다. 안전 원(40%)에 딱 붙으니
    # 0.8 로 줄여 31.5% 에 둔다 — 원·물방울·네모 어느 마스크로 깎여도 알약이 안 잘린다
    ("icon-maskable-512.png", 512, compose(True, 0.8), ROOT),
    ("play-icon-512.png", 512, compose(True, 0.9), OUT),
]

with sync_playwright() as pw:
    b = pw.chromium.launch()
    for name, size, body, where in JOBS:
        pg = b.new_page(viewport={"width": size, "height": size}, device_scale_factor=1)
        pg.set_content(f'<!doctype html><html><body style="margin:0;background:transparent;width:{size}px;height:{size}px">{body}</body></html>')
        png = pg.screenshot(omit_background=True, clip={"x": 0, "y": 0, "width": size, "height": size})
        pg.close()
        im = Image.open(io.BytesIO(png)).convert("RGBA")   # 플레이는 32비트(RGBA) PNG 를 요구한다
        assert im.size == (size, size), (name, im.size)
        f = where / name
        im.save(f, format="PNG", optimize=True)
        print(f"{f.relative_to(ROOT)}  {size}x{size}  {f.stat().st_size // 1024}KB")
    b.close()
