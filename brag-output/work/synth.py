"""Soundtrack for the brag video: 21.0 s, 120 BPM, D minor, 48 kHz stereo.

Music and sound effects are written as one piece on one beat grid counted from the
first video frame (a beat is 0.5 s); every effect uses notes from the music's key.
Scene cuts: 3, 7, 11, 15, 18 s (all on beats).
"""
import sys
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48_000
DUR = 21.0
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(7)


def hz(note: str) -> float:
    names = {'C': -9, 'C#': -8, 'Db': -8, 'D': -7, 'Eb': -6, 'E': -5, 'F': -4, 'F#': -3, 'G': -2, 'Ab': -1,
             'A': 0, 'Bb': 1, 'B': 2}
    name, octave = note[:-1], int(note[-1])
    return 440.0 * 2 ** ((names[name] + 12 * (octave - 4)) / 12)


def t_axis(n: int) -> np.ndarray:
    return np.arange(n) / SR


def lowpass(x, f, order=2):
    return sosfilt(butter(order, f, 'low', fs=SR, output='sos'), x)


def highpass(x, f, order=2):
    return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)


def bandpass(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'band', fs=SR, output='sos'), x)


def env_adsr(n, a, d, s, r, sustain_len):
    """Attack/decay/sustain level/release (seconds); total length n samples."""
    e = np.zeros(n)
    A, D, S, R = int(a * SR), int(d * SR), int(sustain_len * SR), int(r * SR)
    i = 0
    seg = min(A, n - i); e[i:i + seg] = np.linspace(0, 1, A, endpoint=False)[:seg]; i += seg
    seg = min(D, n - i); e[i:i + seg] = np.linspace(1, s, D, endpoint=False)[:seg]; i += seg
    seg = min(S, n - i); e[i:i + seg] = s; i += seg
    seg = min(R, n - i); e[i:i + seg] = np.linspace(s, 0, R, endpoint=False)[:seg]
    return e


L = np.zeros(N)
R_ = np.zeros(N)


def add(sig, start, gain=1.0, pan=0.0):
    """Mix a mono signal in at `start` seconds; pan -1 (left) .. 1 (right), equal power."""
    i = int(round(start * SR))
    if i >= N:
        return
    sig = sig[: N - i]
    gl, gr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    L[i:i + len(sig)] += sig * gain * gl
    R_[i:i + len(sig)] += sig * gain * gr


# ---------------- Harmony ----------------
# Chords change every 2 s from the reveal; the hook is a held Dm.
CHORDS = {
    'Dm': ['D3', 'F3', 'A3', 'D4'], 'Bb': ['Bb2', 'D3', 'F3', 'Bb3'],
    'F': ['F2', 'A2', 'C3', 'F3'], 'C': ['C3', 'E3', 'G3', 'C4'],
}
ROOT = {'Dm': 'D2', 'Bb': 'Bb1', 'F': 'F1', 'C': 'C2'}
PLAN = [(0, 3, 'Dm'), (3, 5, 'Dm'), (5, 7, 'Bb'), (7, 9, 'F'), (9, 11, 'C'), (11, 13, 'Dm'), (13, 15, 'Bb'),
        (15, 17, 'F'), (17, 18, 'C'), (18, 21, 'Dm')]


def pad_voice(f, length):
    t = t_axis(int(length * SR))
    sig = np.zeros_like(t)
    for detune in (-0.12, 0.0, 0.11):          # three slightly detuned voices: width without wobble
        ff = f * 2 ** (detune / 12)
        for k, amp in ((1, 1.0), (2, 0.42), (3, 0.22), (4, 0.12), (5, 0.06)):
            sig += amp * np.sin(2 * np.pi * ff * k * t + rng.uniform(0, 2 * np.pi))
    return sig / 6


for start, end, chord in PLAN:
    length = end - start + 0.6                  # overlap into the next chord, smooth handover
    hook = start == 0
    voices = sum(pad_voice(hz(n), length) for n in CHORDS[chord])
    e = env_adsr(len(voices), 0.9 if hook else 0.25, 0.4, 0.85, 0.6, length - 1.6)
    sig = lowpass(voices * e, 1400 if hook else 2400)
    g = 0.1 if hook else 0.085
    if start == 18:
        sig = lowpass(voices * env_adsr(len(voices), 0.05, 0.6, 0.7, 1.9, length - 2.6), 2600)
        g = 0.1
    add(sig, start, g, -0.25)
    add(sig, start + 0.012, g, 0.25)           # tiny delay between sides: a wider, softer pad

# ---------------- Sub bass: held in the reveal, pulsing 8ths from scene 3 ----------------
for start, end, chord in PLAN[1:]:
    f = hz(ROOT[chord]) * (2 if ROOT[chord][-1] == '1' else 1)
    if start < 7 or start >= 18:
        n = int((end - start + (0.4 if start < 18 else 0)) * SR)
        t = t_axis(n)
        sig = np.sin(2 * np.pi * f * t) * env_adsr(n, 0.04, 0.2, 0.8, 0.5, (n / SR) - 0.8)
        add(lowpass(sig, 300), start, 0.2)
    else:
        for i in range(int((end - start) / (BEAT / 2))):
            n = int(0.23 * SR)
            t = t_axis(n)
            sig = np.sin(2 * np.pi * f * t) * np.exp(-t * 9) * np.minimum(1, t * 400)
            add(sig, start + i * BEAT / 2, 0.17 if i % 2 == 0 else 0.11)

# ---------------- Drums: kick on every beat 3-18, then one last hit at 18 ----------------
def kick():
    n = int(0.42 * SR)
    t = t_axis(n)
    f = 46 + 90 * np.exp(-t * 26)
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(phase) * np.exp(-t * 7.5)
    click = lowpass(rng.standard_normal(n), 3000) * np.exp(-t * 260) * 0.25
    return body + click


K = kick()
for i in range(int(3 / BEAT), int(18 / BEAT)):
    add(K, i * BEAT, 0.34 if i * BEAT >= 7 else 0.26)
add(K, 18.0, 0.36)


def hat():
    n = int(0.06 * SR)
    t = t_axis(n)
    return highpass(rng.standard_normal(n), 7500) * np.exp(-t * 70)


H = hat()
for i in range(int(7 / (BEAT / 2)), int(18 / (BEAT / 2))):
    off = i % 2 == 1
    add(H, i * BEAT / 2, 0.05 if off else 0.022, 0.35 if off else -0.2)

# ---------------- Arpeggio: 16ths through the chord, 7-18 s ----------------
def pluck(f, length=0.32, bright=4000):
    n = int(length * SR)
    t = t_axis(n)
    sig = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sin(2 * np.pi * 3 * f * t)
    return lowpass(sig * np.exp(-t * 11) * np.minimum(1, t * 600), bright)


ARP_ORDER = [0, 1, 2, 3, 2, 1, 2, 3]
for start, end, chord in PLAN:
    if start < 7 or start >= 18:
        continue
    notes = [hz(n) * 2 for n in CHORDS[chord]]
    steps = int((end - start) / (BEAT / 4))
    for i in range(steps):
        f = notes[ARP_ORDER[i % len(ARP_ORDER)]]
        add(pluck(f), start + i * BEAT / 4, 0.045 if i % 4 == 0 else 0.03, 0.4 * np.sin(i * 0.7))

# ---------------- Effects, in key ----------------
# Riser into the reveal: filtered noise opening up + a rising D, 1.5 -> 3.0 s.
n = int(1.5 * SR)
t = t_axis(n)
noise = rng.standard_normal(n)
sweep = np.zeros(n)
for j, lo in enumerate(np.linspace(300, 5000, 12)):
    a, b = j * n // 12, (j + 1) * n // 12
    sweep[a:b] = bandpass(noise, lo, lo * 1.8)[a:b]
rise = np.sin(2 * np.pi * np.cumsum(hz('D4') * 2 ** (t / 1.5)) / SR) * 0.25
riser = (sweep * 0.5 + rise) * (t / 1.5) ** 2
add(riser, 1.5, 0.12)


# Soft impacts on the reveal and the outro: low D boom + a bell chord.
def impact(chord_notes, boom=0.45):
    n = int(2.4 * SR)
    t = t_axis(n)
    low = np.sin(2 * np.pi * hz('D2') * t) * np.exp(-t * 3.2) * boom
    bell = sum(np.sin(2 * np.pi * hz(x) * t) * np.exp(-t * (2.0 + k * 0.4)) for k, x in enumerate(chord_notes))
    return low + lowpass(bell, 5000) * 0.18


add(impact(['D5', 'F5', 'A5'], boom=0.3), 3.0, 0.4)
add(impact(['D5', 'A5', 'D6', 'F6'], boom=0.25), 18.0, 0.4)

# Frame changes (7-11 s, one per beat): a quiet tick on the chord's top note.
for i in range(8):
    t0 = 7.0 + i * BEAT
    chord = 'F' if t0 < 9 else 'C'
    add(pluck(hz(CHORDS[chord][3]) * 4, 0.18, 7000), t0, 0.05, -0.3 + 0.08 * i)

# Detector steps (11-13.5 s, one per beat): climbing D minor, like the wavelength.
for i, note in enumerate(['D5', 'F5', 'A5', 'C6', 'D6', 'F6']):
    add(pluck(hz(note), 0.6, 6000), 11.0 + i * BEAT, 0.075, -0.5 + 0.2 * i)

# Gizmo spin (15-18 s): an airy sweep panning across with the globe.
n = int(3.0 * SR)
t = t_axis(n)
air = bandpass(rng.standard_normal(n), 900, 3800) * np.sin(np.pi * t / 3.0) ** 2
seg = n // 8
for j in range(8):
    p = -0.8 + 1.6 * j / 7
    add(air[j * seg:(j + 1) * seg] * np.hanning(seg), 15.0 + j * seg / SR, 0.05, p)

# ---------------- Space: one shared reverb ----------------
ir_n = int(2.4 * SR)
ir_t = t_axis(ir_n)
ir_l = rng.standard_normal(ir_n) * np.exp(-ir_t * 2.6)
ir_r = rng.standard_normal(ir_n) * np.exp(-ir_t * 2.6)
ir_l, ir_r = lowpass(ir_l, 5000), lowpass(ir_r, 5000)
ir_l /= np.sqrt(np.sum(ir_l ** 2)); ir_r /= np.sqrt(np.sum(ir_r ** 2))
wet_l = fftconvolve(L, ir_l)[:N]
wet_r = fftconvolve(R_, ir_r)[:N]
mix_l = L + 0.28 * wet_l
mix_r = R_ + 0.28 * wet_r

# ---------------- Master: gentle glue, fades, peak at -1 dBFS ----------------
master = np.stack([mix_l, mix_r])
master = highpass(master, 28)                               # no inaudible rumble
master = np.tanh(master * 1.6) / 1.6                        # soft saturation instead of clipping
fade_in, fade_out = int(0.02 * SR), int(1.2 * SR)
master[:, :fade_in] *= np.linspace(0, 1, fade_in)
master[:, -fade_out:] *= np.linspace(1, 0, fade_out) ** 1.5
master *= 10 ** (-1 / 20) / np.max(np.abs(master))

out = sys.argv[1] if len(sys.argv) > 1 else 'audio.wav'
pcm = (master.T * 32767).astype('<i2')
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm.tobytes())
rms = np.sqrt(np.mean(master ** 2))
print(f'{out}: {DUR}s, peak -1.0 dBFS, rms {20 * np.log10(rms):.1f} dBFS')
