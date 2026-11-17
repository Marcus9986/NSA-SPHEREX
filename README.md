# Planet X and SPHEREx

A web app for exploring NASA's SPHEREx infrared sky survey, built for the
[2026 NASA Space Apps Challenge: Planet X and SPHEREx](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/?tab=details).

Pick any spot in the sky and see every image SPHEREx has taken of it. You can play the images back over
time, sweep across SPHEREx's infrared wavelengths (0.75–5 µm), subtract one night from another to look for
anything that moved, and compare against older surveys. The images are the real archive data, fetched live
from NASA/IPAC's IRSA.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript 7, built with Vite 8 |
| Rendering | WebGL2 (custom shaders for display and image processing) |
| Styling | Plain CSS, one stylesheet per component |
| Backend | Python 3.11 + FastAPI |
| Astronomy | astropy, astroquery, reproject, NumPy, SciPy |
| Data sources | NASA/IPAC IRSA (SPHEREx, 2MASS, AllWISE), NASA SkyView (DSS2), IMCCE SkyBoT, CDS Sesame |

Full package list and what each one is for: [Dependencies](#dependencies).

## Contents

- [Quick start](#quick-start)
- [Requirements](#requirements)
- [Setup](#setup)
- [Running](#running)
- [Configuration](#configuration)
- [Features](#features)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Dependencies](#dependencies)
- [Troubleshooting](#troubleshooting)

## Quick start

```bash
# 1. Backend (Python, terminal 1)
cd src/backend
uv sync
uv run fastapi dev src/backend/server.py     # http://localhost:8000

# 2. Frontend (Node, terminal 2, from the repo root)
npm install
npm run dev                                  # http://localhost:5173
```

Open http://localhost:5173. The first search at a new sky position takes about 20 seconds, because that's
how long IRSA's search service takes to answer. After that it's cached.

## Requirements

| Tool | Version | Used for |
|---|---|---|
| [Node.js](https://nodejs.org/) | 20.19+ or 22.12+ (required by Vite 8) | The frontend |
| [uv](https://docs.astral.sh/uv/) | any recent | Python environment and dependencies for the backend |
| Python | 3.11 (pinned in `src/backend/.python-version`; uv installs it for you) | The backend |
| A browser with WebGL2 | Any current Chrome, Edge, Firefox or Safari | Drawing the images |

You also need an internet connection: every image comes from NASA/IPAC and other public archives at the moment you view it.

## Setup

### Backend

```bash
cd src/backend
uv sync
```

`uv sync` creates `src/backend/.venv` with the right Python version and installs everything in
`pyproject.toml`. If you'd rather not use uv, any Python 3.11+ virtual environment works:

```bash
cd src/backend
python -m venv .venv
.venv/Scripts/activate        # Windows; on macOS/Linux: source .venv/bin/activate
pip install -e .
```

### Frontend

From the repository root:

```bash
npm install
```

## Running

Run both at the same time, in two terminals.

| | Command | Where | URL |
|---|---|---|---|
| Backend | `uv run fastapi dev src/backend/server.py` | `src/backend/` | http://localhost:8000 (API docs at `/docs`) |
| Frontend | `npm run dev` | repo root | http://localhost:5173 |

`fastapi dev` restarts the backend automatically when you edit `server.py`. Searches survive the restart
(see [Caching](#caching)).

Other frontend scripts:

| Script | What it does |
|---|---|
| `npm run build` | Type-checks (`tsc -b`) and builds a production bundle into `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm run lint` | Lints with oxlint |

## Configuration

| Setting | Where | Default | What it does |
|---|---|---|---|
| `VITE_API_URL` | `.env` in the repo root | `http://127.0.0.1:8000` | Where the frontend finds the backend |
| `SPHEREX_CACHE_MAX_GB` | environment, when starting the backend | `2` | Size limit of the backend's image cache on disk |
| CORS origins | `allow_origins` in `src/backend/src/backend/server.py` | `localhost:5173`, `127.0.0.1:5173` | Add your frontend's address here if you serve it from somewhere else |

## Features

### Pick a target

- **Coordinates:** type a position in the **Target** panel as hours/degrees, minutes and seconds. You can
  also paste a whole coordinate (`20 18 46.4`, `20h18m46s` or `304.69`) into any box.
- **Object search:** search by name in the header (`M31`, `Vega`, `NGC 7000`…). Well-known objects
  autocomplete instantly; any other name is looked up through CDS Sesame.
- **Field of view:** drag or scroll the FOV box to zoom (hold Shift for bigger steps), click it to type a
  value, or pick a preset (1′, 5′, 15′, 30′, 1°). The range is 30″ to 1°.
- **Sky gizmo:** the globe in the top-right corner shows where the target is on the sky, with Earth's
  coastlines drawn under the point each place is overhead of right now. Hover to enlarge it, drag to rotate
  it, click a point to go there, and double-click to reset the view.

### Play images back over time

- The **playback bar** lists every SPHEREx image of the target in time order. Click or drag on the timeline,
  use the step buttons, or press play. Playback speed is adjustable.
- Set a **loop range** with the handles on the timeline (or `[` and `]`).
- Frames ahead of the playhead are **preloaded** in the background, so playback doesn't stall.
- The **`</>` export button** gives embed code for the current view and a link to download the current
  frame as a FITS file straight from IRSA (see [Share or embed a view](#share-or-embed-a-view)).

### Sweep across wavelengths

SPHEREx has six detectors (D1–D6), and each covers one slice of 0.75–5 µm. Because each detector's
filter varies across its surface, every image sees your target at its own precise wavelength.

- **Match Wavelength** keeps playback to images taken at about the same wavelength, within a tolerance
  you choose (±0.01 to ±0.1 µm). That way you compare like with like over time.
- Drag or scroll the **wavelength box** to step to the next wavelength any image was taken at (Shift jumps
  to a new set of images), or click it to type one. A typed value snaps to the nearest real wavelength.
- Pick a **detector** to jump to its range, or **All** to see every image.

### Look for things that moved

- **Difference** view: subtracts a reference frame from the current one after aligning the two and
  matching their brightness. It then shows the result as a significance map: grey means no change, white
  means brighter now, black means fainter. A moving object shows up as a black and white pair. Pixels that
  either frame flags as unreliable (cosmic rays, hot pixels, saturation and so on) are blanked first, so
  they don't masquerade as changes.
- **Known bodies** overlay: marks the asteroids, comets and planets predicted to be in the field at the
  frame's exact time (IMCCE SkyBoT), so you can rule out known objects.

### Compare with other telescopes

The view-mode buttons swap in the same patch of sky from older surveys, aligned to the same north-up grid:

| Survey | Wavelength |
|---|---|
| DSS2 Red | 0.65 µm (optical) |
| 2MASS K | 2.2 µm |
| WISE W1 / W2 | 3.4 / 4.6 µm |

### Process the image

The **Image Post Processing** tool stacks adjustments on the viewport image. They run on the GPU and
apply live during playback:

Levels, brightness and contrast, stretch curves (asinh, log, square root, square), background removal,
smoothing, sharpening, hot-pixel removal, edge detection, bright-pixel highlighting, invert, and colour
maps (Inferno, Magma, Viridis, Plasma, Heat, Ice). Presets give you a starting point: *Reveal faint
objects*, *False colour* and *Spot bright sources*.

### Measure

The **Measure** tool gives the angular distance and position angle between two points. Drag across the
image, or type two object names to measure between them. The line follows the great circle and stays put
as you pan and zoom. Ends that are off screen show as arrows at the edge.

### Inspect every bit of metadata

The left sidebar shows everything known about the current frame:

- **Position, observation and wavelength:** observation ID, detector, start, end and mid times, exposure,
  and the exact wavelength and bandwidth at the target.
- **Pixel statistics:** min, max and percentiles in MJy/sr.
- **Quality flags:** each of SPHEREx's per-pixel quality flags, with how many pixels in the cutout have it
  set, described in SPHEREx's own words from the file.
- **Archive record:** every field the archive search returned.
- **FITS headers:** every keyword of every extension in the file (about 800), searchable.
- **WCS** and a direct link to the source image.

The floating buttons jump to the next or previous section when it's well off screen.

### Share or embed a view

The **`</>` export button** at the right of the playback bar gives you ready-made `<iframe>` code for the
current view (with a Copy button) and a link to download the current frame as FITS. The embed shows only
the image, with no app controls, and plays through the timeline on its own. Embedding on other sites needs
the app hosted publicly, and the host must not forbid framing (no `X-Frame-Options: DENY` or restrictive
`frame-ancestors`).

The page URL always describes what's on screen, so you can also copy it to share the exact view:

```
http://localhost:5173/?ra=304.6935&dec=42.4437&fov=300&wavelength=0.7447&frame=2025W18_1B_0074_2
```

| Parameter | Meaning |
|---|---|
| `ra`, `dec` | Position, in degrees or sexagesimal (`20h18m46s`, `+42 26 37`) |
| `fov` | Field of view in arcseconds |
| `wavelength` | µm; snapped to the nearest wavelength an image was taken at, and picks the detector covering it |
| `frame` | Observation ID of the frame to show (the starting frame, with `autoplay`) |
| `embed=1` | Show only the viewport and its image: no header, sidebars, playback bar or overlays |
| `autoplay=1` | Start playing the timeline straight away (looping at 1 frame per second) |

### Keyboard shortcuts

With the timeline focused (click it, or Tab to it):

| Key | Action |
|---|---|
| `←` / `→` | Previous / next frame |
| `Space` | Play / pause |
| `[` / `]` | Set the loop start / end at the current frame |

In the wavelength or FOV box: `↑` / `↓` step (with `Shift` for bigger steps), and `Enter` confirms.

## How it works

```
Browser (React + WebGL2)  ──►  FastAPI backend  ──►  IRSA (SPHEREx search + cutouts, 2MASS, AllWISE)
                                                ──►  SkyView (DSS2)
                                                ──►  IMCCE SkyBoT (known solar-system bodies)
                                                ──►  CDS Sesame (object names)
```

1. **Search.** The backend asks IRSA for every SPHEREx image covering the position (collections
   `spherex_dr1` and `spherex_qr3`). It works out each image's wavelength at the target from the image's
   footprint and its detector's wavelength map, without downloading the images themselves.
2. **Cutouts.** For each frame, the backend downloads a small cutout around the target from IRSA. It then
   resamples it onto a north-up grid centred on the target, so every frame lines up pixel for pixel, and
   sends the raw 32-bit pixel values to the browser.
3. **Display.** The browser stretches the pixels for display and draws them with WebGL2. The image-processing
   layers are GPU shaders on top.

The full API is documented in [src/backend/README.md](src/backend/README.md), and interactively at
http://localhost:8000/docs while the backend is running.

### Caching

| What | Where | How long |
|---|---|---|
| Search results | Backend memory, plus a JSON file per position in your system temp folder (`spherex-search-cache/`) | 1 day; survives backend restarts |
| Cutout files | astropy's download cache on disk | Least recently used are deleted above `SPHEREX_CACHE_MAX_GB` |
| Frames | Browser memory | The session, within a memory budget |
| Pixel data | Browser HTTP cache | 1 day |

## Project structure

```
src/
├── App.tsx, main.tsx          app shell; view state, synced with the URL (urlState.ts)
├── api/spherex.ts             all backend calls, frame cache and background preloading
├── hooks/
│   ├── useFrames.ts           search, frame list, wavelength matching, playback, preloading
│   └── useScrub.ts            drag / scroll-to-change behaviour (wavelength and FOV boxes)
├── components/                Viewport, SkyGizmo, PlaybackPanel, Sidebar, TargetForm, LayerStack,
│                              MeasureOverlay, BodyOverlay, ObjectSearch, Header…
├── layouts/DefaultLayout.tsx  the three-panel layout
├── renderer/                  WebGL2 renderer and shaders
├── processing.ts              image-processing layer definitions and presets
├── sky.ts                     coordinate maths (projections, separations, great circles)
├── data/                      object catalogue for search; Natural Earth coastlines for the gizmo
└── backend/                   FastAPI backend (Python package `backend`)
    ├── pyproject.toml, uv.lock
    ├── README.md              API reference
    └── src/backend/server.py  every endpoint
```

## Dependencies

**Frontend** (`package.json`)

| Package | Purpose |
|---|---|
| `react`, `react-dom` 19 | UI |
| `react-resizable-panels` | The resizable panel layout |
| `vite` 8, `@vitejs/plugin-react` | Dev server and bundler |
| `typescript` 7 | Type checking |
| `oxlint` | Linting |

There's no UI framework or CSS library: styles are plain CSS next to each component, and image rendering
uses WebGL2 directly.

**Backend** (`src/backend/pyproject.toml`)

| Package | Purpose |
|---|---|
| `fastapi[standard]` | The HTTP API and its dev server |
| `astroquery` | IRSA image search, SkyView, SkyBoT |
| `astropy` | FITS files, WCS, coordinates, time, download cache |
| `reproject` | Aligning cutouts onto a common north-up grid |
| `numpy`, `scipy` | Image maths: differencing, statistics, interpolation |

**External services** (no accounts or API keys needed)

| Service | Provides |
|---|---|
| [IRSA](https://irsa.ipac.caltech.edu/) (NASA/IPAC) | SPHEREx images and search, 2MASS, AllWISE |
| [SkyView](https://skyview.gsfc.nasa.gov/) (NASA GSFC) | DSS2 images |
| [SkyBoT](https://ssp.imcce.fr/webservices/skybot/) (IMCCE) | Known solar-system bodies in the field |
| [Sesame](https://cds.unistra.fr/cgi-bin/Sesame) (CDS) | Object name lookup |

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The first search at a position takes ~20 s | That's IRSA's search service. It's cached afterwards, including across backend restarts. |
| "IRSA query failed: 502" or "Server busy" | IRSA is overloaded or briefly down. The backend already retries several times; wait a minute and reload. |
| Nothing loads at all, or CORS errors in the console | The backend isn't running, or the frontend's address isn't in `allow_origins`. Check that http://localhost:8000/api/health returns `{"status":"ok"}`. |
| A new frame takes a few seconds | Each new cutout is a ~4 MB download from IRSA. Frames you've seen, and frames preloaded ahead of the playhead, show instantly. |
| The Difference view is mostly grey speckle | That's normal when nothing moved: the speckle is noise. Look for black and white pairs, and check them against the Known bodies overlay. |

## Use of Super Intelligence (SI) tools

As the NASA Space Apps Challenge rules require, here is where and how we used SI tools.

| What | SI tool | How it was used | Where it's marked |
|------|---------|-----------------|-------------------|
| Code | Claude Code (Anthropic) | Helped write and refactor parts of the frontend (`src/`) and backend (`src/backend/`), plus the deployment config (`vercel.json`). The team designed the app, reviewed the changes and tested them. | This section; `description` in `package.json` and `src/backend/pyproject.toml` |
| Demo video (`brag-output/brag.mp4`, `brag.jpg`) | Claude Code (Anthropic) | Generated the video: storyboard, motion graphics, edit and render. The app footage in it is a real screen capture of our app. | Visible "SI-generated video" watermark on every frame; `comment` tag in the video file |
| Music and sound effects (`brag-output/work/audio.wav`) | Claude Code (Anthropic) | Wrote `brag-output/work/synth.py`, which synthesizes the soundtrack. No samples or recordings were used. | This section; `comment` tag in the audio file and the video file |
| Video text (`brag-output/share-copy.txt`, `brag-plan.md`) | Claude Code (Anthropic) | Drafted the share caption and the video plan. | This section |

The science data is not SI-generated. Every image the app shows is real archive data from IRSA, SkyView and the other sources listed below.

## Credits

- SPHEREx data: NASA / Caltech-IPAC, via IRSA ([image use policy](https://spherex.caltech.edu/page/image-use-policy)).
- Coastlines: [Natural Earth](https://www.naturalearthdata.com/) (public domain).
- Solar-system positions: IMCCE SkyBoT. Name resolution: CDS Sesame.

## License

Code: [MIT](LICENSE). SPHEREx and other survey data keep their own terms (see Credits).
