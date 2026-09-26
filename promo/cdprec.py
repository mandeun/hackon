# 선명한 녹화 — Playwright 기본 녹화는 CSS 픽셀(540x960)로만 찍어 1080 으로 키우면 뭉개진다.
# 크롬 스크린캐스트(CDP)를 기기 픽셀 2배로 받아 프레임을 그대로 쌓고, 시각 그대로 mp4 로 만든다.
# 쓰는 법: from cdprec import Rec; with Rec(out_dir, "c03", seed_ls={...}) as pg: ...  → out_dir/c03.mp4 (1080x1920, 30fps)
import base64, json, pathlib, shutil, subprocess, time
from playwright.sync_api import sync_playwright

W, H = 540, 960

class Rec:
    def __init__(self, out, name, seed_ls=None, jpeg=92, html=None):
        self.out, self.name, self.seed, self.q, self.html = pathlib.Path(out), name, seed_ls, jpeg, html
        self.frames = []
    def __enter__(self):
        self.p = sync_playwright().start()
        self.b = self.p.chromium.launch(args=["--force-device-scale-factor=2"])
        self.ctx = self.b.new_context(viewport={"width": W, "height": H}, device_scale_factor=2, locale="ko-KR")
        if self.seed:
            js = ";".join(f"localStorage.setItem({json.dumps(k)},{json.dumps(v)})" for k, v in self.seed.items())
            self.ctx.add_init_script(js)
        self.pg = self.ctx.new_page()
        self.cdp = self.ctx.new_cdp_session(self.pg)
        def on_frame(ev):
            self.frames.append((ev["metadata"]["timestamp"], ev["data"]))
            try: self.cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]})
            except Exception: pass
        self.cdp.on("Page.screencastFrame", on_frame)
        self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": self.q, "maxWidth": W * 2, "maxHeight": H * 2, "everyNthFrame": 1})
        self.t0 = time.time()
        if self.html: self.pg.set_content(self.html)
        return self.pg
    def __exit__(self, *a):
        self.t1 = time.time()   # 화면이 안 바뀌면 프레임이 안 온다 — 마지막 프레임을 실제 끝 시각까지 늘린다
        try: self.cdp.send("Page.stopScreencast")
        except Exception: pass
        self.ctx.close(); self.b.close(); self.p.stop()
        d = self.out / f"_{self.name}"; shutil.rmtree(d, ignore_errors=True); d.mkdir(parents=True)
        fr = self.frames
        if not fr: print("프레임 없음:", self.name); return
        lines = []
        for i, (t, data) in enumerate(fr):
            (d / f"{i:05d}.jpg").write_bytes(base64.b64decode(data))
            dur = (fr[i + 1][0] - t) if i + 1 < len(fr) else max(0.1, self.t1 - t)
            lines.append(f"file '{i:05d}.jpg'\nduration {max(dur, 0.01):.4f}")
        lines.append(f"file '{len(fr) - 1:05d}.jpg'")
        (d / "list.txt").write_text("\n".join(lines), encoding="utf-8")
        mp4 = self.out / f"{self.name}.mp4"
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(d / "list.txt"),
                            "-vf", "fps=30,scale=1080:1920:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-crf", "17", "-preset", "fast", str(mp4)],
                           capture_output=True, text=True)
        if r.returncode: print(r.stderr)
        span = self.t1 - fr[0][0]
        print(f"컷 {self.name}: {len(fr)}프레임 {span:.2f}s → {mp4.name}")
