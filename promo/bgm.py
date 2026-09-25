# 배경음 — 표준 라이브러리만으로 30초짜리 로파이 비트를 굽는다. 저작권 문제 0, 재현 가능.
# 구성: 코드 진행 4마디(Am7 – F – C – G) 루프 · 소프트 킥/스네어/햇 · 사이드체인 느낌의 볼륨 덕킹 · 끝 2초 페이드.
# 실행: python promo/bgm.py [초] [bpm]  → promo/sfx/bgm.wav
import math, random, struct, sys, wave, pathlib

SR = 44100
SEC = float(sys.argv[1]) if len(sys.argv) > 1 else 30.0
BPM = float(sys.argv[2]) if len(sys.argv) > 2 else 92.0
OUT = pathlib.Path(__file__).parent / "sfx" / "bgm.wav"
random.seed(7)

def note(n): return 440.0 * 2 ** ((n - 69) / 12)   # MIDI → Hz
CHORDS = [[57, 60, 64, 67], [53, 57, 60, 65], [48, 52, 55, 60], [55, 59, 62, 67]]   # Am7 F C G (낮게)
BEAT = 60 / BPM; BAR = BEAT * 4
N = int(SEC * SR)
L = [0.0] * N; R = [0.0] * N

def add(buf, t0, dur, f, amp, shape="sine", pan=0.0, env=(0.01, 0.3)):
    s0 = int(t0 * SR); n = int(dur * SR)
    a, d = env
    for i in range(n):
        t = i / SR
        if t < a: e = t / a
        else: e = math.exp(-(t - a) / d)
        ph = 2 * math.pi * f * t
        if shape == "sine": v = math.sin(ph)
        elif shape == "tri": v = 2 / math.pi * math.asin(math.sin(ph))
        elif shape == "saw": v = 2 * ((f * t) % 1) - 1
        else: v = 1 if math.sin(ph) > 0 else -1
        v *= amp * e
        j = s0 + i
        if j >= N: break
        L[j] += v * (1 - max(0, pan)); R[j] += v * (1 - max(0, -pan))

def kick(t0):
    s0 = int(t0 * SR)
    for i in range(int(0.22 * SR)):
        t = i / SR; f = 55 + 90 * math.exp(-t * 28)
        v = math.sin(2 * math.pi * f * t) * math.exp(-t * 9) * 0.9
        j = s0 + i
        if j < N: L[j] += v; R[j] += v

def snare(t0):
    s0 = int(t0 * SR)
    for i in range(int(0.16 * SR)):
        t = i / SR
        v = (random.uniform(-1, 1) * 0.6 + math.sin(2 * math.pi * 190 * t) * 0.4) * math.exp(-t * 18) * 0.45
        j = s0 + i
        if j < N: L[j] += v; R[j] += v

def hat(t0, open_=False):
    s0 = int(t0 * SR); n = int((0.12 if open_ else 0.04) * SR)
    for i in range(n):
        t = i / SR
        v = random.uniform(-1, 1) * math.exp(-t * (18 if open_ else 60)) * 0.16
        j = s0 + i
        if j < N: L[j] += v * 0.8; R[j] += v

# ── 패드(코드) + 베이스 + 멜로디 — 마디마다
bar = 0; t = 0.0
mel = [76, 79, 81, 79, 76, 72, 74, 76]   # E5 G5 A5 G5 E5 C5 D5 E5 — 펜타토닉, 어디에 얹어도 어울린다
mi = 0
while t < SEC:
    ch = CHORDS[bar % 4]
    for k, n in enumerate(ch):                                   # 패드: 트라이앵글 + 살짝 디튠
        f = note(n); pan = (k - 1.5) * 0.25
        for det in (-0.4, 0.4):
            add(L, t, BAR, f * 2 ** (det / 1200), 0.06, "tri", pan, (0.35, 2.2))
    add(L, t, BEAT * 1.9, note(ch[0] - 12), 0.22, "sine", 0, (0.01, 0.9))   # 베이스 1·3박
    add(L, t + BEAT * 2, BEAT * 1.9, note(ch[0] - 12), 0.2, "sine", 0, (0.01, 0.9))
    for b in range(4):                                            # 드럼 — 부드럽게
        tb = t + b * BEAT
        if b in (0, 2): kick(tb)
        if b in (1, 3): snare(tb)
        hat(tb); hat(tb + BEAT / 2, open_=(b == 3))
    if bar >= 2:                                                  # 멜로디는 3마디째부터 (앞 두 마디는 자막 자리)
        for s in range(8):
            if random.random() < 0.8:
                add(L, t + s * BEAT / 2, BEAT / 2 * 0.9, note(mel[mi % 8]), 0.09, "sine", 0.2, (0.01, 0.25))
            mi += 1
    bar += 1; t += BAR

# ── 정리: 부드러운 클리핑 + 페이드 인/아웃 + 16bit
def soft(v): return math.tanh(v * 1.4) * 0.9
fade_in = int(0.4 * SR); fade_out = int(2.0 * SR)
with wave.open(str(OUT), "w") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    frames = bytearray()
    for i in range(N):
        g = 1.0
        if i < fade_in: g = i / fade_in
        if i > N - fade_out: g = (N - i) / fade_out
        l = int(max(-1, min(1, soft(L[i]) * g)) * 32767); r = int(max(-1, min(1, soft(R[i]) * g)) * 32767)
        frames += struct.pack("<hh", l, r)
    w.writeframes(bytes(frames))
print(OUT, f"{SEC:.0f}s {BPM:.0f}bpm")
