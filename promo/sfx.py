# 홍보영상 효과음 — 표준 라이브러리만. 음원이 없어서 직접 만든다.
# 만드는 것: 타이핑 딸깍(글자마다) · 단추 클릭 · 화면 전환 휙 · 낮은 리듬 베드 · 결말 직전 1초 정적
# 쓰는 법: python promo/sfx.py  →  promo/sfx/*.wav
import math, random, struct, wave, pathlib

OUT = pathlib.Path(__file__).parent / "sfx"
OUT.mkdir(exist_ok=True)
SR = 48000
random.seed(7)


def save(name, samples, gain=0.9):
    peak = max(1e-9, max(abs(s) for s in samples))
    with wave.open(str(OUT / name), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        frames = bytearray()
        for s in samples:
            v = int(max(-1, min(1, s / peak * gain)) * 32767)
            frames += struct.pack("<hh", v, v)
        w.writeframes(bytes(frames))
    print("  ", name, f"{len(samples)/SR:.2f}s")


def env(i, n, a=0.002, d=0.08):
    """짧은 어택, 지수 감쇠. 딸깍·클릭 계열은 전부 이 모양이다."""
    t = i / SR
    if t < a:
        return t / a
    return math.exp(-(t - a) / d)


def click(dur=0.06, f=2400, noise=0.5, decay=0.018):
    n = int(SR * dur)
    return [(math.sin(2 * math.pi * f * i / SR) * (1 - noise) + (random.random() * 2 - 1) * noise)
            * env(i, n, 0.0008, decay) for i in range(n)]


def whoosh(dur=0.45):
    """화면 전환 — 잡음을 저역에서 고역으로 쓸어 올린다. 필터 없이 이동평균 창을 줄여 흉내낸다."""
    n = int(SR * dur)
    raw = [random.random() * 2 - 1 for _ in range(n)]
    out = []
    acc, win = 0.0, 40
    q = []
    for i in range(n):
        p = i / n
        win = max(1, int(40 * (1 - p) + 1))          # 창이 줄면 고역이 산다
        q.append(raw[i]); acc += raw[i]
        if len(q) > win:
            acc -= q.pop(0)
        amp = math.sin(math.pi * p) ** 1.5           # 가운데가 제일 크다
        out.append(acc / max(1, len(q)) * amp * 3)
    return out


def bed(dur=44.0, bpm=96):
    """낮은 리듬 베드 — 킥 같은 저역 펄스 + 아주 옅은 5도 패드. 대사를 절대 가리지 않게 작다."""
    n = int(SR * dur)
    beat = 60 / bpm
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        ph = (t % beat) / beat
        kick = math.sin(2 * math.pi * 55 * t) * math.exp(-ph * 14) * (1 if ph < 0.35 else 0)
        pad = (math.sin(2 * math.pi * 110 * t) + 0.6 * math.sin(2 * math.pi * 165 * t)) * 0.08
        out[i] = kick * 0.55 + pad
    # 결말 직전 1초 정적을 위한 페이드는 조립 단계에서 시점에 맞춰 건다
    return out


print("효과음 굽는 중")
save("type.wav", click(0.05, 2600, 0.55, 0.014), 0.8)      # 글자 한 개
save("type2.wav", click(0.05, 2200, 0.6, 0.016), 0.8)      # 번갈아 써서 기계음 티를 뺀다
save("button.wav", click(0.12, 900, 0.25, 0.05), 0.9)      # 단추
save("done.wav", [a + b for a, b in zip(click(0.18, 1320, 0.1, 0.07), click(0.18, 1980, 0.1, 0.09))], 0.9)  # 완료(두 음)
save("whoosh.wav", whoosh(0.45), 0.7)
save("bed.wav", bed(44.0), 0.5)
print("완료 →", OUT)
