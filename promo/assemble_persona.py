# 페르소나판 45초 조립 — 컷 13개를 시간표대로 자르고 잇고, 자막·이름표를 얹고, 효과음을 깐다.
# 실행: python assemble_persona.py   (ffmpeg 9 / 산출: hackon_persona/HACKON_페르소나_v1_9x16.mp4)
import subprocess, pathlib, shutil, json, sys, wave

D = pathlib.Path(r"C:\Users\tree0\AppData\Local\Temp\hackon_persona")
SFX = pathlib.Path(r"C:\Users\tree0\OneDrive\Desktop\Projects\hackon\promo\sfx")
OUT = D / "HACKON_페르소나_v1_9x16.mp4"
FPS = 30

def run(*args):
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", *map(str, args)], capture_output=True, text=True)
    if r.returncode: print(r.stderr); sys.exit(1)

# ── 시간표 — (컷, 소스, 시작초, 길이, 확대배율, 확대 중심 y비율)
CUTS = [
    (1,  "c11_ledger.webm", None, 3.0, 1.3, 0.62),   # 끝 3초 — 장부 표가 가운데
    (2,  "trans.png",       0.0, 1.5, 1.0,  0.5),
    (3,  "c03_make.webm",   0.5, 4.0, 1.0,  0.5),
    (4,  "c04_need.webm",   0.4, 3.5, 1.0,  0.5),
    (5,  "c04_need.webm",   None, 2.5, 1.7, 0.64),   # None = 끝에서 거꾸로 (마지막 2.6초가 클로즈업 대기)
    (6,  "c06_venue.webm",  0.7, 4.5, 1.0,  0.5),
    (7,  "c07_judge.webm",  1.0, 4.0, 1.0,  0.5),
    (8,  "c08_confirm.webm",0.5, 3.5, 1.0,  0.5),
    (9,  "c09_join.webm",   None, 4.0, 1.0, 0.5),    # 끝에서 4.0초 — cf-box 대기 2.6 + 클릭 + 안내
    (10, "c10_filled.webm", 0.4, 3.5, 1.6,  1.00),   # 아래쪽 «필요한 만큼 채워졌습니다»가 안전영역 위로 오게
    (11, "c11_ledger.webm", 3.4, 4.0, 1.0,  0.5),
    (12, "c12_empty.webm",  1.0, 4.0, 1.0,  0.5),
    (13, "end.png",         0.0, 3.0, 1.0,  0.5),
]

def dur(f):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)],
                                capture_output=True, text=True).stdout.strip())

segs, t0, starts = [], 0.0, {}
for n, src, ss, ln, z, cy in CUTS:
    seg = D / f"seg{n:02d}.mp4"
    f = D / src
    if src.endswith(".png"):
        fade = "fade=in:0:6,fade=out:st=%.2f:d=0.25" % (ln - 0.25)
        run("-loop", "1", "-framerate", FPS, "-i", f, "-t", ln, "-vf", f"scale=1080:1920,{fade},format=yuv420p", "-r", FPS, "-an", seg)
    else:
        if ss is None: ss = max(0.0, dur(f) - ln - 0.05)
        vf = "scale=1080:1920:flags=lanczos"
        if z > 1.0:
            # 클로즈업 — 화면의 일부를 확대. 없는 것을 그리지 않는다, 있는 것을 키운다
            # 글이 왼쪽 정렬이라 가로는 왼쪽부터(5·10컷). 세로는 cy 를 중심으로, 위아래는 화면 안으로 잠근다
            x = "0" if n in (5, 10) else f"(iw-iw/{z})/2"
            vf += f",crop=iw/{z}:ih/{z}:{x}:min(ih-ih/{z}\\,max(0\\,ih*{cy}-ih/{z}/2)),scale=1080:1920:flags=lanczos"
        vf += ",format=yuv420p"
        run("-ss", f"{ss:.2f}", "-t", f"{ln:.2f}", "-i", f, "-vf", vf, "-r", FPS, "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18", seg)
    segs.append(seg); starts[n] = t0; t0 += ln
    print(f"컷 {n:2d}  {starts[n]:5.1f}s  +{ln}s  {src}")
TOTAL = t0
(D / "list.txt").write_text("".join(f"file '{s.as_posix()}'\n" for s in segs), encoding="utf-8")
run("-f", "concat", "-safe", "0", "-i", D / "list.txt", "-c", "copy", D / "body.mp4")

# ── 자막(아래 안전영역 위: y=1080~1420) · 이름표(위 안전영역 아래: y=200)
CAPS = {1: "cap01", 3: "cap03", 4: "cap04", 6: "cap06", 7: "cap07", 8: "cap08", 9: "cap09", 11: "cap11", 12: "cap12"}
CHIPS = {3: "chip03", 6: "chip06", 7: "chip07", 9: "chip09"}
LEN = {n: ln for n, _, _, ln, _, _ in CUTS}
inputs, chain, idx = ["-i", str(D / "body.mp4")], [], 1
last = "[0:v]"
for n, name in list(CAPS.items()) + list(CHIPS.items()):
    inputs += ["-i", str(D / f"{name}.png")]
    a, b = starts[n] + 0.12, starts[n] + LEN[n] - 0.08
    # 자막은 아래(1080~1420). 단 눌리는 단추가 그 자리에 오는 컷(1·9)은 위(170)로. 이름표는 자막 바로 위, 9컷은 위 자막 아래
    y = ({1: 170, 9: 170}.get(n, 1080)) if name.startswith("cap") else ({9: 520}.get(n, 985))
    x = "(W-w)/2" if name.startswith("cap") else 60
    chain.append(f"{last}[{idx}:v]overlay={x}:{y}:enable='between(t,{a:.2f},{b:.2f})'[v{idx}]")
    last = f"[v{idx}]"; idx += 1
run(*inputs, "-filter_complex", ";".join(chain), "-map", last, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", FPS, "-an", D / "video.mp4")

# ── 소리 — 리듬 베드(작게) + 효과음(타이핑·단추·완료·전환). 목소리 없음(09-25 결정)
def wlen(f):
    with wave.open(str(f)) as w: return w.getnframes() / w.getframerate()
events = [  # (파일, 시각)
    ("whoosh", starts[2]), ("type", starts[3] + 0.3), ("button", starts[3] + 3.0),
    ("type2", starts[4] + 0.9), ("button", starts[4] + 2.6),
    ("button", starts[6] + 2.9), ("done", starts[6] + 3.4),
    ("button", starts[7] + 2.4), ("done", starts[7] + 2.9),
    ("button", starts[8] + 1.1), ("done", starts[8] + 2.2),
    ("button", starts[9] + 2.7), ("done", starts[9] + 3.2),
    ("done", starts[10] + 0.6), ("whoosh", starts[11]), ("type", starts[12] + 0.5), ("done", starts[13] + 0.3),
]
ain = ["-i", str(D / "video.mp4"), "-stream_loop", "-1", "-i", str(SFX / "bed.wav")]
parts = ["[1:a]volume=0.16,atrim=0:%.2f,afade=t=out:st=%.2f:d=1.2[bed]" % (TOTAL, TOTAL - 1.2)]
mix = ["[bed]"]
for i, (name, t) in enumerate(events):
    ain += ["-i", str(SFX / f"{name}.wav")]
    vol = {"type": 0.55, "type2": 0.55, "button": 0.7, "done": 0.8, "whoosh": 0.6}[name]
    parts.append(f"[{i + 2}:a]volume={vol},adelay={int(t * 1000)}|{int(t * 1000)}[s{i}]"); mix.append(f"[s{i}]")
parts.append("".join(mix) + f"amix=inputs={len(mix)}:normalize=0:duration=first[a]")
run(*ain, "-filter_complex", ";".join(parts), "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", OUT)
print("완성:", OUT, f"{dur(OUT):.2f}s (계획 {TOTAL:.1f}s)")
json.dump({"starts": starts, "total": TOTAL}, open(D / "timeline.json", "w"), indent=1)
