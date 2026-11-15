# SPHEREx Backend

FastAPI server that finds SPHEREx images at a sky position, serves cutouts as
raw pixel data for the React frontend to render, and makes difference images
for spotting objects that change or move between observations.

Image data comes from [IRSA](https://irsa.ipac.caltech.edu) (NASA/IPAC Infrared Science Archive).

## Running it

Requires [uv](https://docs.astral.sh/uv/). From `src/backend`:

```bash
uv sync                                     # first time: install dependencies
uv run fastapi dev src/backend/server.py    # start on http://localhost:8000
```

- Interactive API docs: <http://localhost:8000/docs>
- CORS allows the Vite dev server (`http://localhost:5173`).
- On Windows the auto-reloader sometimes misses edits. If a change doesn't
  seem to apply, stop the server (Ctrl+C) and start it again.

## Typical flow

```
1. /api/spherex/images      → which images exist here, and when (epochs)?
2. /api/spherex/image/meta  → details + display range for one image
   /api/spherex/image/data  → that image's pixels → draw on a canvas
3. /api/spherex/images      → again, filtered to a matching wavelength in another epoch
4. /api/spherex/diff/meta   → what changed between the two (candidate list)
   /api/spherex/diff/data   → the difference image → draw with a red/blue color scale
```

All endpoints are `GET`. Examples below use these helpers:

```ts
const API = "http://localhost:8000/api/spherex";

// Builds a query string; arrays become repeated params (detector=1&detector=4)
const qs = (o: Record<string, any>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o))
    if (v != null) (Array.isArray(v) ? v : [v]).forEach(x => p.append(k, String(x)));
  return p.toString();
};

async function getJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json()).detail);
  return res.json();
}

async function fetchFloatImage(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json()).detail);
  return {
    width: Number(res.headers.get("X-Width")),
    height: Number(res.headers.get("X-Height")),
    mjd: Number(res.headers.get("X-Mjd")),
    pixels: new Float32Array(await res.arrayBuffer()),
  };
}
```

---

## `GET /api/health`

Returns `{"status":"ok"}`. Use it to show whether the backend is running.

---

## `GET /api/spherex/images` (search)

Finds every SPHEREx image that contains a sky position.

| Param | Default | Description |
|---|---|---|
| `ra`, `dec` | required | Target position in degrees |
| `radius_arcsec` | 1 | Search radius. Keep it small: you want images *containing* the point |
| `detector` | all | 1–6, repeatable. Each detector covers a wavelength range: D1 ≈ 0.75–1.1 µm, up to D6 ≈ 5 µm |
| `epoch` | all | Epoch index, repeatable |
| `start`, `end` | – | ISO dates, e.g. `2025-10-01` |
| `epoch_gap_days` | 30 | 30 = survey seasons; 0.5 = individual visits |
| `with_wavelength` | true | Adds `wavelength_um` for each image |
| `wavelength_um`, `wavelength_tol_um` | –, 0.01 | Only images that saw the target near this wavelength, closest first |
| `offset`, `limit` | 0, 100 | Paging (max 1000) |

**Response:**

```jsonc
{
  "total": 443, "offset": 0, "limit": 100,
  "epochs": [   // every match, ignoring filters
    { "index": 0, "time_start": "2025-04-29T…", "time_end": "2025-06-22T…",
      "mjd_start": 60794.02, "mjd_end": 60848.77,
      "image_count": 183, "images_per_detector": { "1": 41, "2": 18 } }
  ],
  "images": [   // filtered + paged, oldest first (closest wavelength first if wavelength_um is set)
    { "access_url": "https://irsa…fits", "obs_id": "2025W18_1B_0074_2",
      "collection": "spherex_dr1", "detector": 1, "band": "SPHEREx-D1", "epoch": 0,
      "wavelength_um": 0.7538,                                  // estimated at the target, ±0.006
      "wavelength_min_um": 0.7455, "wavelength_max_um": 1.1167, // whole detector
      "time_start": "2025-04-29T00:24:27Z", "time_end": "…",
      "mjd_start": 60794.017, "mjd_mid": 60794.018, "exposure_s": 113.6 }
  ]
}
```

**What you can build with it:**

- **Timeline** from `epochs`: one block per season, sized by `image_count`.
- **Detector or wavelength picker**, using `images_per_detector`.
- **Frame list** for a given epoch and detector.
- **Picking a comparison frame**: search again with the chosen image's
  `detector` and `wavelength_um` and a different `epoch`. Use `images[0]` as the reference.

```ts
const search = await getJson(`${API}/images?${qs({ ra, dec, detector: 1 })}`);
const image = search.images.find((i: any) => i.epoch === 2);

const matches = await getJson(`${API}/images?${qs({
  ra, dec, detector: image.detector, epoch: 0, wavelength_um: image.wavelength_um,
})}`);
const reference = matches.images[0]; // closest wavelength
```

> The first search after a server restart can take about 20 s, because it
> reads per-detector wavelength tables. Later searches take about 2 s and
> repeats are cached. Show a loading state.

---

## `GET /api/spherex/image/meta` (details for one cutout)

| Param | Default | Description |
|---|---|---|
| `url` | required | `access_url` from the search |
| `ra`, `dec` | required | Cutout center |
| `size_arcsec` | 300 | Cutout width. Pixels are 6.15″, so 300 gives 49 px and 600 gives 99 px. Max 3600 |
| `extension` | `IMAGE` | `IMAGE` (brightness), `VARIANCE` (noise²), `ZODI` (zodiacal-light model), `FLAGS` (quality bits) |
| `align` | true | Resample onto a north-up grid centered on the target, so frames line up pixel for pixel |

**Response:**

```jsonc
{
  "width": 99, "height": 99, "extension": "IMAGE", "aligned": true, "pixel_scale_arcsec": 6.15,
  "observation": { "date_mid": "2025-04-29T00:25:25Z", "mjd_mid": 60794.0177, "exposure_s": 113.6 },
  "wavelength_um": 0.7515, "bandwidth_um": 0.0175,   // exact, at the target
  "header": { "BUNIT": "MJy / sr", "DETECTOR": 1, "OBSID": "…", "PSF_FWHM": 7.53 },
  "wcs": { "CRPIX1": 50, "CRVAL1": 304.69 },         // pixel ↔ RA/Dec
  "stats": { "min": -310, "max": 2895,
             "percentiles": { "0.5": 0.28, "1": 0.29, "5": 0.32, "50": 0.53, "95": 2.3, "99": 8.8, "99.5": 17.2 } }
}
```

**What you can build with it:**

- **Display range:** use `percentiles["1"]` to `percentiles["99.5"]`, not min/max.
  A few pixels are extreme outliers.
- **Info panel:** date, wavelength, exposure, units.
- **Cursor readout:** convert the mouse position to RA/Dec (see [Pixel ↔ RA/Dec](#pixel--radec)).

---

## `GET /api/spherex/image/data` (pixels for one cutout)

It takes the same params as `/image/meta`, plus `bin` (1–16), which averages
blocks of pixels to make a smaller image.

The response is binary little-endian float32, row-major. Headers: `X-Width`,
`X-Height`, `X-Mjd` (mid-exposure time) and `X-Aligned`. Things to know:

- **Row 0 is the bottom row (south)**, so flip it when drawing to a canvas.
- **`NaN` means no data.** Draw those pixels transparent.

```ts
// Grayscale with an asinh stretch (shows faint and bright objects together)
function drawImage(canvas: HTMLCanvasElement,
                   img: { width: number; height: number; pixels: Float32Array },
                   lo: number, hi: number) {
  const { width: w, height: h, pixels } = img;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const out = ctx.createImageData(w, h);
  const a = 10, norm = Math.asinh(a);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = pixels[y * w + x];
      const i = ((h - 1 - y) * w + x) * 4;          // flip vertically
      if (Number.isNaN(v)) { out.data[i + 3] = 0; continue; }
      const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
      const g = 255 * Math.asinh(a * t) / norm;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = g;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

// Usage
const params = { url: image.access_url, ra, dec, size_arcsec: 600 };
const meta = await getJson(`${API}/image/meta?${qs(params)}`);
const img = await fetchFloatImage(`${API}/image/data?${qs(params)}`);
drawImage(canvas, img, meta.stats.percentiles["1"], meta.stats.percentiles["99.5"]);
```

Scale the canvas up with CSS and `image-rendering: pixelated` so the pixels stay sharp.

**What you can build with it:**

- **Image viewer:** zoom, pan, and stretch controls (linear, log, asinh).
- **Blink comparator:** load two or more aligned frames from different epochs
  and switch between them every ~500 ms. Because `align=true`, stars stay fixed
  and anything that moves jumps.
- **Time-lapse:** all frames of one detector at a matching wavelength, played in date order.
- **Light curve:** read the center pixel (the target) from each frame and plot
  brightness against `X-Mjd`.
- **Spectrum:** frames from a single visit cover different wavelengths. Plot
  brightness at the center against `wavelength_um` (from `/image/meta`).
- **Quality overlay:** fetch with `extension=FLAGS` and color-code bad pixels.

---

## `GET /api/spherex/diff/meta` (what changed)

Aligns two frames, matches their brightness, subtracts the reference, and
finds significant changes.

| Param | Default | Description |
|---|---|---|
| `url` | required | Newer frame (`access_url`) |
| `ref_url` | required | Older (reference) frame |
| `ra`, `dec` | required | Cutout center |
| `size_arcsec` | 300 | Cutout width |
| `mask_flags` | true | Blank cosmic rays, saturated, hot/cold, persistence and other bad pixels |
| `threshold` | 5 | Signal-to-noise needed to report a candidate |
| `min_pixels` | 2 | Ignore smaller blobs |
| `max_candidates` | 50 | Max 500 |

**Response:**

```jsonc
{
  "width": 99, "height": 99, "pixel_scale_arcsec": 6.15,
  "image":     { "access_url": "…", "date_mid": "2026-05-22…", "mjd_mid": 61182.87, "wavelength_um": 0.8922, "bandwidth_um": 0.017 },
  "reference": { "access_url": "…", "date_mid": "2025-05-31…", "mjd_mid": 60826.29, "wavelength_um": 0.8908, "bandwidth_um": 0.017 },
  "dt_days": 356.6,
  "wavelength_difference_um": 0.0014,  // warn the user if > ~0.01
  "scale": 0.96,                       // brightness match factor applied to the reference
  "backgrounds": { "image": 0.41, "reference": 0.34 },
  "flux_sigma": 0.031,                 // noise of the difference, MJy/sr
  "snr_sigma": 0.98,                   // ≈1 means the subtraction is clean
  "valid_fraction": 0.98,
  "wcs": { },
  "threshold": 5,
  "candidates": [
    { "kind": "disappeared", "change": "fainter", "x": 9.67, "y": 51.67,
      "ra": 304.80, "dec": 42.44, "peak_snr": -48.8, "peak_flux": -1.2, "pixels": 2,
      "in_image": false, "in_reference": true }
  ]
}
```

What each `kind` means:

| `kind` | Meaning | Suggested display |
|---|---|---|
| `appeared` | Source in the newer frame only | Highlight |
| `disappeared` | Source in the reference only | Highlight |
| `faint` | Significant change, no clear source in either frame | Show, lower priority |
| `changed_star` | Source in both frames: usually a star that didn't subtract cleanly, sometimes a variable star | Hidden by default |

Candidates are sorted with `appeared` and `disappeared` first, then by strength.

**What you can build with it:**

- **Candidate markers** on the frames and the difference image. Draw at
  `(x, height - 1 - y)` on a canvas that is already flipped.
- **Candidate list:** click a candidate to zoom there and blink the two frames.
- **Mover check:** pair `disappeared` and `appeared` candidates that are close
  together. Their pixel separation × 6.15″ ÷ `dt_days` gives a rate of motion in ″/day.
- **Quality badge:** warn when `wavelength_difference_um` is above ~0.01 or
  `snr_sigma` is well above 1.

---

## `GET /api/spherex/diff/data` (the difference image)

It takes the same params as `/diff/meta` (without the candidate settings), plus:

| Param | Default | Description |
|---|---|---|
| `mode` | `snr` | `snr` = significance (noise ≈ 1); `flux` = MJy/sr |
| `bin` | 1 | Downsample factor |

The data comes back in the same binary layout as `/image/data`. Headers:
`X-Width`, `X-Height`, `X-Mode`, `X-Scale`, `X-Sigma`, `X-Mjd`, `X-Ref-Mjd`.

Positive values mean brighter in the newer frame. Use a color scale centered on zero:

```ts
function drawDiff(canvas: HTMLCanvasElement,
                  img: { width: number; height: number; pixels: Float32Array },
                  limit = 5) {
  const { width: w, height: h, pixels } = img;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const out = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = pixels[y * w + x], i = ((h - 1 - y) * w + x) * 4;
    if (Number.isNaN(v)) { out.data[i + 3] = 0; continue; }
    const t = Math.max(-1, Math.min(1, v / limit));        // -1..1
    out.data[i]     = t > 0 ? 255 : 255 * (1 + t);         // red = brighter now
    out.data[i + 1] = 255 * (1 - Math.abs(t));
    out.data[i + 2] = t < 0 ? 255 : 255 * (1 - t);         // blue = fainter now
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
}

// Usage
const diffParams = { url: image.access_url, ref_url: reference.access_url, ra, dec, size_arcsec: 600 };
const diffMeta = await getJson(`${API}/diff/meta?${qs(diffParams)}`);
const diff = await fetchFloatImage(`${API}/diff/data?${qs(diffParams)}`);
drawDiff(diffCanvas, diff, 5);
```

**What you can build with it:**

- **Difference panel** next to the two frames: newer frame, reference, difference.
- **Sensitivity slider** that changes `limit`. ±5 is a good default for `mode=snr`.
- **Flux mode** (`mode=flux`) to show how much brighter or fainter something got in physical units.

---

## Pixel ↔ RA/Dec

With `align=true`, the target is at the center pixel, north is up, east is
left, and each pixel is 6.15″. For cutouts up to about 1° across, this is accurate enough:

```ts
function pixelToSky(x: number, y: number, w: number, h: number, ra0: number, dec0: number) {
  const s = 6.15 / 3600, cx = (w - 1) / 2, cy = (h - 1) / 2;
  const dec = dec0 + (y - cy) * s;
  const ra = ra0 - (x - cx) * s / Math.cos(dec0 * Math.PI / 180);
  return { ra, dec };
}
// y is the data row (0 = bottom). From a canvas click: y = h - 1 - canvasY
```

For exact conversion, use the `wcs` object from either `/meta` endpoint.

---

## Practical notes

- **Load a few at a time.** Each new cutout downloads about 4 MB from IRSA,
  which takes a few seconds. Repeat requests come from the server's cache and
  are fast. Limit parallel cutout requests to about 4 and show spinners.
- **Use the same `ra`, `dec` and `size_arcsec`** for every frame you compare, or they won't line up.
- **Compare frames at matching wavelengths.** SPHEREx's filter changes across
  each detector, so two frames can see the same spot at different wavelengths.
  Stars differ in color, so mismatched frames leave residuals at most stars.
- **Errors** return JSON `{ "detail": "…" }`:

  | Status | Meaning |
  |---|---|
  | `400` | Bad URL (must be an IRSA URL) or extension |
  | `422` | Position outside the image, not enough overlap for a difference, or invalid params |
  | `502` | IRSA is unavailable (already retried by the server). Let the user retry |

- **Candidates need confirming.** The candidate list ranks what's worth a look;
  it doesn't confirm a detection. Confirm candidates by blinking the frames
  and checking more than one epoch.
