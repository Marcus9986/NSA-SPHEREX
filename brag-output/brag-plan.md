# Brag plan: Planet X and SPHEREx

## Answers

- **What is it?** A web app for exploring NASA SPHEREx's infrared sky images: pick any spot in the sky and see every image SPHEREx has taken of it, over time and across its detectors.
- **Who is it for?** Planet X hunters, NASA Space Apps 2026 judges, and anyone curious about SPHEREx data. It lets them find, play back, compare and inspect real frames without touching FITS files.
- **What sets it apart?** It's the real archive, live from IRSA. Frames play like a video, it sweeps 0.75 → 5 µm across six detectors, and there's a 3D sky gizmo with Earth's coastlines under the sky.
- **Most impressive claim:** every image of one spot, from April to November 2025, plays back like a movie (8 visits, real dates).
- **Visual hook:** a real SPHEREx star field filling the screen, with the challenge's own question over it: "Is there a Planet X?"
- **Real UI shown:** the full app (captured live at 2×), the viewport playing 8 real frames, the detector sweep D1 → D6 (0.754 → 4.416 µm, real values from the app), and the gizmo spinning (90 real captures).
- **Tone:** polished, leaning cinematic. NASA-serious, with a playful last line.
- **Share caption:** "Is there a Planet X? We built a way to look: every SPHEREx infrared image of any spot in the sky, playable over time and wavelength."

## Angle

The challenge asks a big question; the app is the telescope you'd use to answer it. Open on the question over real data, reveal the tool, show three things it does with real frames, and end on "Go find Planet X."

Cut: the Difference view. In the captured field nothing moved, so its output is grey noise, and showing it as "what moved lights up" would be dishonest.

## Visual identity (from the code)

- Background: the app's viewport backdrop, `#10182a → #0a101e → #05080f` radial with a faint 22 px dot grid.
- Colours: Brand blue `#2563eb`, brand red `#f43f5e`, accent blue `#60a5fa`, amber `#fbbf24` (gizmo Dec arc), text `#f8fafc`, muted `#94a3b8`.
- Type: `system-ui / Segoe UI` for headlines; `Consolas` mono for readouts. Eyebrows uppercase with 0.08 em tracking, like the app's section titles.
- No private data: the UI shows only public sky coordinates and archive IDs.

## Music

120 BPM (a beat is 0.5 s, 15 frames). D minor: Dm – B♭ – F – C pad, a sub bass on the roots, soft kick from the reveal, 8th-note hats and a D-minor arpeggio from highlight 1. Sound effects are in key: soft plucks on each frame change, a rising D-minor note per detector, an airy filtered-noise sweep for the gizmo, a riser into the reveal, and the final chord ringing out. Every cut lands on a beat.

## Storyboard (21.0 s, 630 frames at 30 fps)

| # | Time | Beats | Scene | On-screen text (read time) |
|---|---|---|---|---|
| 1 Hook | 0.0–3.0 | 0–6 | Real SPHEREx star field (frame 1, 30′) filling the screen with a slow push-in and vignette. The text fades up. Riser starts at 2.0 s. | "Is there a Planet X?" (5 words, settled 0.9 → 2.8 s) |
| 2 Reveal | 3.0–7.0 | 6–14 | Impact. The full live app (2× capture) settles from a tilted, scaled entrance, then a text band rises at the bottom. | Eyebrow "2026 NASA Space Apps Challenge"; title "Planet X and SPHEREx"; line "Any spot in the sky. Every SPHEREx image of it." (9 words, settled 3.9 → 6.8 s) |
| 3 Time | 7.0–11.0 | 14–22 | The real viewport (with gizmo and mode buttons) on the right, stepping through the 8 real frames, one per beat. Real date readout counts April → November 2025. | "Play every visit like a movie." (6 words, settled 7.6 → 10.8 s) plus a mono date readout |
| 4 Wavelength | 11.0–15.0 | 22–30 | Same card, stepping D1 → D6 one per beat, holding on D6, where the nebula glows. The mono readout climbs 0.754 → 4.416 µm with D-labels. | "See it in every infrared color." (6 words, settled 11.6 → 14.8 s) |
| 5 Gizmo | 15.0–18.0 | 30–36 | The real gizmo spinning a full 360° (90 captured frames, 1:1), big and centred-right. | "Always know where you're looking." (5 words, settled 15.6 → 17.8 s) |
| 6 Outro | 18.0–21.0 | 36–42 | NASA logo, title, eyebrow; punchline last; final chord rings out. | "Planet X and SPHEREx" + "Go find Planet X." (4 words, settled 19.0 → 21.0 s) |

Transitions: never a plain crossfade between two busy layouts. The old scene scales and fades out over ~6 frames, then the new one comes in (staggered), or the cut dips through the background. Card-to-card cuts (3 → 4) keep the card and swap only the content and text.
