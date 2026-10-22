#!/usr/bin/env python3
"""Render Peak Flip's sounds and music to WAV files in roblox/assets/sounds.

The web game makes its sounds with a tiny synthesizer (Sfx and Music in game.js); this renders the
same notes, envelopes and filters offline so the Roblox version sounds like the original, with no
stock Roblox sounds. Upload them with tools/upload_assets.py (it uploads sounds too).

    python3 roblox/tools/make_sounds.py
"""
import math, random, struct, wave
from pathlib import Path

RATE = 32000
OUT = Path(__file__).resolve().parent.parent / "assets" / "sounds"
random.seed(7)


def buf(seconds):
    return [0.0] * int(seconds * RATE)


def midi(n):
    return 440 * 2 ** ((n - 69) / 12)


def osc(kind, phase):
    p = phase % 1.0
    if kind == "sine":
        return math.sin(2 * math.pi * p)
    # the web game turns square/sawtooth into rounder triangles
    return 4 * abs(p - 0.5) - 1


def tone(out, start, f, dur, kind="sine", vol=0.25, f2=None, attack=0.008):
    """A note with a quick attack and an exponential fade, like WebAudio's ramps."""
    vol = min(vol, 0.14) if kind != "music" else vol
    i0, n = int(start * RATE), int((dur + 0.02) * RATE)
    phase = 0.0
    for k in range(n):
        i = i0 + k
        if i >= len(out):
            break
        t = k / RATE
        freq = f * (f2 / f) ** min(t / dur, 1.0) if f2 else f
        phase += freq / RATE
        env = (t / attack) if t < attack else max(0.0, 0.001 ** ((t - attack) / max(dur - attack, 1e-3)))
        out[i] += osc(kind if kind != "music" else "sine", phase) * vol * env


def lowpass(x, cutoff):
    a = 1 - math.exp(-2 * math.pi * cutoff / RATE)
    y, s = [], 0.0
    for v in x:
        s += a * (v - s)
        y.append(s)
    return y


def bandpass(x, f, q=0.7):
    # RBJ biquad band-pass
    w = 2 * math.pi * f / RATE
    alpha = math.sin(w) / (2 * q)
    b0, b2, a0, a1, a2 = alpha, -alpha, 1 + alpha, -2 * math.cos(w), 1 - alpha
    y, x1, x2, y1, y2 = [], 0.0, 0.0, 0.0, 0.0
    for v in x:
        o = (b0 * v + b2 * x2 - a1 * y1 - a2 * y2) / a0
        x2, x1, y2, y1 = x1, v, y1, o
        y.append(o)
    return y


def noise(out, start, dur, vol, freq, kind="lowpass"):
    """A muffled whoosh: filtered noise with an exponential fade (as Sfx.noise)."""
    n = int((dur + 0.02) * RATE)
    raw = [random.uniform(-1, 1) for _ in range(n)]
    f = bandpass(raw, min(freq, 1600)) if kind != "lowpass" else lowpass(raw, min(freq, 1100))
    i0 = int(start * RATE)
    for k, v in enumerate(f):
        if i0 + k < len(out):
            out[i0 + k] += v * vol * 0.35 * 0.001 ** (k / RATE / dur) * (2.5 if kind != "lowpass" else 1.6)


def write(name, samples, gain=1.0, fx=True):
    if fx:
        samples = lowpass(samples, 3500)  # the effects channel rounds off the harsh top
    peak = max(1e-6, max(abs(v) for v in samples))
    scale = min(gain / peak, 6.0) * 0.9
    OUT.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, v * scale)) * 32767)) for v in samples))
    print(f"  {name}.wav  {len(samples) / RATE:.2f}s")


def sfx():
    s = buf(0.25); tone(s, 0, 988, 0.07, "square", 0.08); tone(s, 0.06, 1480, 0.12, "square", 0.08); write("coin", s, 0.7)
    s = buf(0.3); noise(s, 0, 0.18, 0.7, 700); write("land", s, 0.8)
    s = buf(0.2); noise(s, 0, 0.1, 0.25, 1800, "band"); write("ollie", s, 0.55)
    s = buf(0.5)
    for i, f in enumerate([523, 659, 784]):
        tone(s, i * 0.07, f, 0.14, "triangle", 0.13)
    write("trick", s, 0.7)
    s = buf(0.5)
    for i, f in enumerate([784, 988, 1175, 1568]):
        tone(s, i * 0.06, f, 0.16, "triangle", 0.13)
    write("perfect", s, 0.75)
    # a thud and a falling tone: no explosion
    s = buf(0.8); noise(s, 0, 0.6, 0.9, 450); tone(s, 0, 160, 0.4, "sawtooth", 0.18, 40); write("crash", s, 0.85)
    s = buf(0.15); tone(s, 0, 660, 0.1, "sine", 0.1, 990); write("near", s, 0.5)
    s = buf(0.1); tone(s, 0, 1200, 0.045, "sine", 0.1); tone(s, 0, 600, 0.04, "triangle", 0.05); write("click", s, 0.45)
    s = buf(0.8)
    for i, f in enumerate([523, 659, 784, 1047, 1319]):
        tone(s, i * 0.07, f, 0.22, "triangle", 0.13)
    write("reward", s, 0.75)
    s = buf(0.25); tone(s, 0, 880, 0.16, "triangle", 0.14); write("beep", s, 0.6)


def music():
    """Music.start/play from game.js: 100 bpm, four chords, bass, arpeggio, soft kick, and a tune
    on every other pass. Rendered twice over so the echo tail wraps into a seamless loop."""
    step = 60 / 100 / 4
    chords = [[62, 66, 69], [61, 64, 69], [59, 62, 66], [59, 62, 67]]
    bass = [38, 33, 35, 31]
    tune = [74, None, 76, 78, None, 76, 74, None, 76, None, 73, None, 69, None, None, None,
            71, None, 74, 76, None, 74, 71, None, 74, None, 78, 76, 74, None, None, None]
    steps = 128
    loop = steps * step
    bus = buf(loop * 2 + 2)

    def note(f, t, dur, kind, vol, attack=0.005):
        i0, n = int(t * RATE), int((dur + 0.05) * RATE)
        phase = 0.0
        for k in range(n):
            if i0 + k >= len(bus):
                break
            tt = k / RATE
            phase += f / RATE
            env = vol * (tt / attack) if tt < attack else vol * 0.0001 ** ((tt - attack) / max(dur - attack, 1e-3)) / 1
            bus[i0 + k] += osc(kind, phase) * env

    for i in range(steps * 2):
        t = i * step
        s, bar, second = i % 16, (i >> 4) % 4, (i >> 6) % 2 == 1
        chord = chords[bar]
        if s == 0:
            for n in chord:
                note(midi(n), t, step * 16, "sine", 0.035, 0.5)
                note(midi(n) * 1.004, t, step * 16, "triangle", 0.02, 0.6)
        if s in (0, 6, 8, 14):
            note(midi(bass[bar] + (7 if s == 14 else 0)), t, step * 3, "triangle", 0.16, 0.01)
        if s % 2 == 0:
            note(midi(chord[[0, 1, 2, 1, 0, 2, 1, 2][s // 2]] + 12), t, step * 2.5, "triangle", 0.035)
        if s in (0, 8):  # soft kick: a quick sine drop
            i0, phase = int(t * RATE), 0.0
            for k in range(int(0.25 * RATE)):
                tt = k / RATE
                phase += 130 * (45 / 130) ** min(tt / 0.18, 1) / RATE
                bus[i0 + k] += math.sin(2 * math.pi * phase) * 0.22 * 0.0001 ** (tt / 0.22)
        m = tune[(i >> 1) % 32]
        if second and s % 2 == 0 and m:
            note(midi(m), t, step * 3.5, "sine", 0.07, 0.02)

    dry = lowpass(bus, 3200)
    # echo: a delay of three sixteenths feeding back at 0.3
    d = int(step * 3 * RATE)
    echo = [0.0] * len(bus)
    for i in range(len(bus)):
        echo[i] = (bus[i - d] if i >= d else 0) + (echo[i - d] * 0.3 if i >= d else 0)
    mix = [dry[i] * 0.5 + echo[i] * 0.22 for i in range(len(bus))]
    a, b = int(loop * RATE), int(loop * 2 * RATE)
    write("music", mix[a:b], 0.8, fx=False)


if __name__ == "__main__":
    print(f"Writing to {OUT}")
    sfx()
    music()
