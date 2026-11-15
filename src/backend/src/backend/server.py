import math
import threading
import time
import urllib.error
import warnings
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from urllib.parse import urlparse

import numpy as np
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.time import Time
from astropy.utils.data import conf, download_file
from astropy.wcs import WCS, FITSFixedWarning
from astroquery.ipac.irsa import Irsa
from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from reproject import reproject_interp
from scipy import ndimage
from scipy.interpolate import RegularGridInterpolator

# Reading SPHEREx files can exceed astropy's default timeout.
conf.remote_timeout = 120

SPHEREX_COLLECTIONS = ["spherex_dr1", "spherex_qr3"]
ALLOWED_IMAGE_HOSTS = {"irsa.ipac.caltech.edu"}
IMAGE_EXTENSIONS = {"IMAGE", "VARIANCE", "ZODI", "FLAGS"}
HEADER_KEYWORDS = ["EXTNAME", "BUNIT", "DETECTOR", "OBSID", "DATE", "PSF_FWHM"]
SPHEREX_PIXEL_SCALE_ARCSEC = 6.15

# SPHEREx FLAGS bit numbers (from the MSKNnnnn keywords in the FLAGS header).
FLAG_BITS = {
    name: 1 << bit
    for name, bit in {
        "TRANSIENT": 0, "OVERFLOW": 1, "SUR_ERROR": 2, "NONFUNC": 6, "DICHROIC": 7,
        "MISSING_DATA": 9, "HOT": 10, "COLD": 11, "FULLSAMPLE": 12, "PHANMISS": 14,
        "NONLINEAR": 15, "PERSIST": 17, "OUTLIER": 19, "CROSSTALK": 20, "SOURCE": 21,
        "GHOST": 22, "GHOST_FPA": 23, "GHOST_EXT": 24, "STREAK": 25, "BLOOM": 26,
        "SNOWBALL": 27, "HALO": 28,
    }.items()
}
# Pixels with any of these set are unreliable and would show up as fake
# changes in a difference image. SOURCE and STREAK are deliberately not here:
# they mark real objects (a streak could be a fast-moving one).
DIFF_BAD_FLAGS = sum(
    FLAG_BITS[n]
    for n in ("TRANSIENT", "OVERFLOW", "SUR_ERROR", "NONFUNC", "MISSING_DATA",
              "HOT", "COLD", "PERSIST", "OUTLIER", "SNOWBALL")
)

app = FastAPI(title="Planet X & SPHEREx API")

# Allow the Vite dev server to call the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
    # Let the browser read the image-shape headers on binary responses.
    expose_headers=[
        "X-Width", "X-Height", "X-Dtype", "X-Bin", "X-Mjd", "X-Aligned",
        "X-Mode", "X-Scale", "X-Sigma", "X-Ref-Mjd",
    ],
)


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


def _mjd_to_iso(mjd: float) -> str:
    return Time(mjd, format="mjd", scale="utc").to_datetime(timezone=timezone.utc).isoformat()


def _datetime_to_mjd(value: datetime) -> float:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return float(Time(value).utc.mjd)


@lru_cache(maxsize=64)
def _query_images(ra: float, dec: float, radius_arcsec: float) -> tuple[dict, ...]:
    """All SPHEREx images covering a position, sorted by time.

    Cached so paging and re-filtering from the frontend doesn't hit IRSA again.
    """
    coord = SkyCoord(ra, dec, unit="deg")
    max_retries = 5
    for attempt in range(max_retries):
        try:
            results = Irsa.query_sia(
                pos=(coord, radius_arcsec * u.arcsec),
                collection=SPHEREX_COLLECTIONS,
            )
            break
        except Exception as exc:
            # IRSA's SIA service intermittently returns 502/503.
            if attempt == max_retries - 1:
                raise HTTPException(status_code=502, detail=f"IRSA query failed: {exc}")
            time.sleep(3 * (attempt + 1))

    images = []
    for row in results:
        band = str(row["energy_bandpassname"])  # e.g. "SPHEREx-D3"
        t_min, t_max = float(row["t_min"]), float(row["t_max"])
        images.append(
            {
                "access_url": str(row["access_url"]),
                "obs_id": str(row["obs_id"]),
                "collection": str(row["obs_collection"]),
                "band": band,
                "detector": int(band.rsplit("D", 1)[-1]),
                # Range covered by the whole detector. The wavelength at your
                # target depends on where it lands on the detector.
                "wavelength_min_um": float(row["em_min"]) * 1e6,
                "wavelength_max_um": float(row["em_max"]) * 1e6,
                "mjd_start": t_min,
                "mjd_mid": (t_min + t_max) / 2,
                "time_start": _mjd_to_iso(t_min),
                "time_end": _mjd_to_iso(t_max),
                "exposure_s": float(row["t_exptime"]),
                # Internal (stripped from responses): image center and footprint.
                "_center": (float(row["s_ra"]), float(row["s_dec"])),
                "_s_region": str(row["s_region"]),
            }
        )
    images.sort(key=lambda im: (im["mjd_start"], im["detector"]))
    return tuple(images)


# --- Wavelength at the target, estimated without downloading each image ---
#
# SPHEREx's filters vary across each detector, so the wavelength seen at a sky
# position depends on where it lands. Each image's footprint (s_region) tells
# us that position, and the detector's WCS-WAVE table (the same for every
# image from a detector) maps position -> wavelength. Checked against the
# exact per-image value: within ~0.006 um, vs ~0.017 um filter bandwidth.

SPHEREX_DETECTOR_PIXELS = 2040
_wave_tables: dict[tuple[str, str], RegularGridInterpolator | None] = {}
_wave_table_locks: dict[tuple[str, str], threading.Lock] = {}
_wave_table_locks_guard = threading.Lock()


def _wave_table(image: dict) -> RegularGridInterpolator | None:
    """The detector's pixel -> wavelength table, fetched once per detector and release."""
    key = (image["collection"], image["band"])
    with _wave_table_locks_guard:
        lock = _wave_table_locks.setdefault(key, threading.Lock())
    with lock:  # one download per key, but different keys download in parallel
        if key in _wave_tables:
            return _wave_tables[key]
        try:
            # A tiny cutout at the image center still includes the WCS-WAVE table.
            center_ra, center_dec = image["_center"]
            path = _fetch_fits(_cutout_url(image["access_url"], center_ra, center_dec, 30))
            with fits.open(path, memmap=False) as hdulist:
                table = hdulist["WCS-WAVE"].data  # type: ignore[union-attr]
                xs = np.asarray(table["X"][0], dtype=float)
                ys = np.asarray(table["Y"][0], dtype=float)
                values = np.asarray(table["VALUES"][0], dtype=float)  # [y, x, (wavelength, bandwidth)]
            _wave_tables[key] = RegularGridInterpolator(
                (ys, xs), values[..., 0], bounds_error=False, fill_value=None
            )
        except Exception:
            _wave_tables[key] = None  # don't retry on every request
        return _wave_tables[key]


def _detector_position(s_region: str, ra: float, dec: float) -> tuple[float, float] | None:
    """1-based detector pixel (x, y) of ra/dec, from the image's footprint polygon.

    s_region corners are in detector order (1,1), (N,1), (N,N), (1,N). Project
    them onto a plane tangent at the target and invert the bilinear map.
    """
    try:
        corners = np.array(s_region.split()[2:], dtype=float).reshape(-1, 2)[:4]
    except ValueError:
        return None
    ra0, dec0 = np.radians(ra), np.radians(dec)
    cra, cdec = np.radians(corners[:, 0]), np.radians(corners[:, 1])
    cos_c = np.sin(dec0) * np.sin(cdec) + np.cos(dec0) * np.cos(cdec) * np.cos(cra - ra0)
    xi = np.cos(cdec) * np.sin(cra - ra0) / cos_c
    eta = (np.cos(dec0) * np.sin(cdec) - np.sin(dec0) * np.cos(cdec) * np.cos(cra - ra0)) / cos_c
    p00, p10, p11, p01 = np.column_stack([xi, eta])

    # Newton's method for (s, t) with bilinear(s, t) == target (the origin).
    st = np.array([0.5, 0.5])
    for _ in range(20):
        s, t = st
        f = (1 - s) * (1 - t) * p00 + s * (1 - t) * p10 + s * t * p11 + (1 - s) * t * p01
        jac = np.column_stack(
            [(1 - t) * (p10 - p00) + t * (p11 - p01), (1 - s) * (p01 - p00) + s * (p11 - p10)]
        )
        try:
            step = np.linalg.solve(jac, f)
        except np.linalg.LinAlgError:
            return None
        st = st - step
        if np.abs(step).max() < 1e-9:
            break
    n = SPHEREX_DETECTOR_PIXELS
    return 1 + st[0] * (n - 1), 1 + st[1] * (n - 1)


def _estimate_wavelength(image: dict, ra: float, dec: float) -> float | None:
    table = _wave_table(image)
    pos = _detector_position(image["_s_region"], ra, dec)
    if table is None or pos is None:
        return None
    x, y = pos
    return round(float(table([y, x])[0]), 4)


def _group_epochs(images: list[dict], gap_days: float) -> list[dict]:
    """Split time-sorted images into epochs wherever there's a gap > gap_days.

    Sets an "epoch" index on each image and returns a summary per epoch.
    """
    epochs: list[dict] = []
    prev_end = None
    for im in images:
        if prev_end is None or im["mjd_start"] - prev_end > gap_days:
            epochs.append({"index": len(epochs), "mjd_start": im["mjd_start"], "images": []})
        epochs[-1]["images"].append(im)
        im["epoch"] = epochs[-1]["index"]
        prev_end = im["mjd_start"]

    summaries = []
    for ep in epochs:
        ims = ep["images"]
        mjd_end = max(im["mjd_start"] for im in ims)
        detectors: dict[int, int] = {}
        for im in ims:
            detectors[im["detector"]] = detectors.get(im["detector"], 0) + 1
        summaries.append(
            {
                "index": ep["index"],
                "time_start": _mjd_to_iso(ep["mjd_start"]),
                "time_end": _mjd_to_iso(mjd_end),
                "mjd_start": ep["mjd_start"],
                "mjd_end": mjd_end,
                "image_count": len(ims),
                "images_per_detector": dict(sorted(detectors.items())),
            }
        )
    return summaries


# Plain `def` (not `async def`) so FastAPI runs the blocking IRSA call
# in a worker thread instead of stalling the event loop.
@app.get("/api/spherex/images")
def search_spherex_images(
    ra: float = Query(..., ge=0, lt=360, description="Right ascension in degrees"),
    dec: float = Query(..., ge=-90, le=90, description="Declination in degrees"),
    radius_arcsec: float = Query(1.0, gt=0, le=3600),
    detector: list[int] | None = Query(None, description="Only these detectors, 1-6 (repeatable)"),
    epoch: list[int] | None = Query(None, description="Only these epoch indexes (repeatable)"),
    start: datetime | None = Query(None, description="Only images starting at/after this time (ISO 8601, UTC)"),
    end: datetime | None = Query(None, description="Only images starting at/before this time (ISO 8601, UTC)"),
    epoch_gap_days: float = Query(
        30, gt=0, description="Gap that starts a new epoch. 30 = survey seasons; ~0.5 = individual visits"
    ),
    with_wavelength: bool = Query(
        True,
        description=(
            "Add wavelength_um: the estimated wavelength at ra/dec (±0.006 um). The first "
            "search per detector downloads a small lookup table, so it's slower once."
        ),
    ),
    wavelength_um: float | None = Query(
        None, gt=0, description="Only images that see ra/dec near this wavelength (needs with_wavelength)"
    ),
    wavelength_tol_um: float = Query(0.01, gt=0, description="Tolerance for wavelength_um"),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, gt=0, le=1000),
):
    """SPHEREx images covering a position, oldest first, grouped into epochs.

    `epochs` summarises every match (ignoring filters) so the frontend can
    offer a timeline; `images` is the filtered, paginated list.

    To pick a pair for /diff: take an image, then search again with its
    `detector` and `wavelength_um` to find frames from other epochs that saw
    this spot at the same wavelength. Differencing frames at different
    wavelengths leaves residuals at most stars, because stars differ in color.
    """
    if wavelength_um is not None and not with_wavelength:
        raise HTTPException(status_code=422, detail="wavelength_um filter needs with_wavelength=true")
    if detector and any(d not in range(1, 7) for d in detector):
        raise HTTPException(status_code=422, detail="detector must be between 1 and 6")

    # Copy the cached rows so adding "epoch" doesn't mutate the cache.
    images = [dict(im) for im in _query_images(round(ra, 7), round(dec, 7), radius_arcsec)]
    epochs = _group_epochs(images, epoch_gap_days)

    if detector:
        images = [im for im in images if im["detector"] in detector]
    if epoch:
        images = [im for im in images if im["epoch"] in epoch]
    if start:
        start_mjd = _datetime_to_mjd(start)
        images = [im for im in images if im["mjd_start"] >= start_mjd]
    if end:
        end_mjd = _datetime_to_mjd(end)
        images = [im for im in images if im["mjd_start"] <= end_mjd]
    if with_wavelength:
        # Fetch any missing per-detector tables in parallel (only slow the first time).
        first_per_key = {(im["collection"], im["band"]): im for im in images}
        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(_wave_table, first_per_key.values()))
        for im in images:
            im["wavelength_um"] = _estimate_wavelength(im, ra, dec)
    if wavelength_um is not None:
        images = [
            im for im in images
            if im["wavelength_um"] is not None and abs(im["wavelength_um"] - wavelength_um) <= wavelength_tol_um
        ]
        # Closest wavelength first, so images[0] is the best reference.
        images.sort(key=lambda im: abs(im["wavelength_um"] - wavelength_um))

    page = [{k: v for k, v in im.items() if not k.startswith("_")} for im in images[offset : offset + limit]]
    return {
        "total": len(images),
        "offset": offset,
        "limit": limit,
        "epochs": epochs,
        "images": page,
    }


# ---------------------------------------------------------------------------
# Cutouts
# ---------------------------------------------------------------------------


@dataclass
class CutoutParams:
    """Which image to cut from, and where. Shared by the image endpoints."""

    url: str = Query(..., description="access_url from /api/spherex/images")
    ra: float = Query(..., ge=0, lt=360, description="Cutout center RA in degrees")
    dec: float = Query(..., ge=-90, le=90, description="Cutout center Dec in degrees")
    size_arcsec: float = Query(
        300, gt=0, le=3600, description="Cutout width in arcsec (SPHEREx pixels are ~6.15\")"
    )
    extension: str = Query("IMAGE", description="IMAGE, VARIANCE, ZODI or FLAGS")
    align: bool = Query(
        True,
        description=(
            "Resample onto a north-up grid centered on ra/dec, so cutouts from "
            "different images line up pixel-for-pixel (needed for blinking or "
            "differencing). false = the detector's native pixels."
        ),
    )


@dataclass
class Cutout:
    data: np.ndarray  # the requested extension
    planes: dict[str, np.ndarray]  # every extension that was loaded, same grid as `data`
    header: fits.Header
    wcs: WCS  # WCS of `data` (the aligned grid when align=true)
    mjd_mid: float | None
    date_mid: str | None
    exposure_s: float | None
    wavelength_um: float | None
    bandwidth_um: float | None


def _cutout_url(url: str, ra: float, dec: float, size_arcsec: float) -> str:
    """Build an IRSA cutout URL for a SPHEREx image.

    Only IRSA URLs are accepted, so the endpoint can't be used to make the
    server fetch arbitrary URLs.
    """
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_IMAGE_HOSTS:
        raise HTTPException(status_code=400, detail="url must be an https IRSA URL")
    base = parsed._replace(query="", fragment="").geturl()
    # IRSA's cutout service: center in degrees, size with an explicit unit.
    # The cutout keeps every extension (IMAGE, FLAGS, VARIANCE, ZODI, PSF, WCS-WAVE).
    return f"{base}?center={ra},{dec}&size={size_arcsec:g}arcsec"


def _fetch_fits(url: str) -> str:
    """Download a FITS file (cached on disk by astropy) and return its local path."""
    # IRSA's cutout service intermittently returns 503, so retry quickly.
    max_retries = 5
    for attempt in range(max_retries):
        try:
            return download_file(url, cache=True, timeout=120)
        except urllib.error.HTTPError as exc:
            if exc.code == 422:
                raise HTTPException(status_code=422, detail="Cutout center is outside this image")
            if attempt == max_retries - 1:
                raise HTTPException(status_code=502, detail=f"IRSA cutout failed: {exc}")
        except Exception as exc:
            if attempt == max_retries - 1:
                raise HTTPException(status_code=502, detail=f"Failed to download FITS: {exc}")
        time.sleep(attempt + 1)
    raise AssertionError("unreachable")


def _aligned_wcs(ra: float, dec: float, size_arcsec: float) -> tuple[WCS, int]:
    """North-up TAN grid at SPHEREx pixel scale, with ra/dec at the center pixel."""
    n = max(1, math.ceil(size_arcsec / SPHEREX_PIXEL_SCALE_ARCSEC))
    if n % 2 == 0:
        n += 1  # odd size => the target sits exactly on the middle pixel
    scale_deg = SPHEREX_PIXEL_SCALE_ARCSEC / 3600
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
    w.wcs.cdelt = [-scale_deg, scale_deg]  # RA increases to the left (east)
    w.wcs.radesys = "ICRS"
    return w, n


def _load_cutout(p: CutoutParams, extra_extensions: tuple[str, ...] = ()) -> Cutout:
    extension = p.extension.upper()
    if extension not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"extension must be one of {sorted(IMAGE_EXTENSIONS)}")
    wanted = dict.fromkeys((extension, *extra_extensions))  # ordered, de-duplicated

    # When aligning, the north-up square is rotated relative to the detector,
    # so fetch a bigger cutout to cover its corners.
    fetch_size = min(p.size_arcsec * 1.5, 5400) if p.align else p.size_arcsec
    path = _fetch_fits(_cutout_url(p.url, p.ra, p.dec, fetch_size))

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FITSFixedWarning)
        with fits.open(path, memmap=False) as hdulist:
            planes = {name: np.asarray(hdulist[name].data) for name in wanted}  # type: ignore[union-attr]
            header = hdulist[extension].header.copy()  # type: ignore[union-attr]
            # The IMAGE header carries the time and wavelength keywords for all planes.
            image_header = hdulist["IMAGE"].header  # type: ignore[union-attr]
            native_wcs = WCS(image_header).celestial

            # Wavelength at the target, from the WCS-WAVE lookup table.
            wavelength_um = bandwidth_um = None
            try:
                spec_wcs = WCS(image_header, fobj=hdulist, key="W")
                x, y = native_wcs.world_to_pixel(SkyCoord(p.ra, p.dec, unit="deg"))
                wave, width = spec_wcs.pixel_to_world(float(x), float(y))
                wavelength_um = float(wave.to_value(u.um))
                bandwidth_um = float(width.to_value(u.um))
            except Exception:
                pass

    mjd = image_header.get("MJD-AVG")
    cutout = Cutout(
        data=planes[extension],
        planes=planes,
        header=header,
        wcs=native_wcs,
        mjd_mid=float(mjd) if mjd is not None else None,
        date_mid=_mjd_to_iso(float(mjd)) if mjd is not None else None,
        exposure_s=_json_safe(image_header.get("XPOSURE")),
        wavelength_um=wavelength_um,
        bandwidth_um=bandwidth_um,
    )

    if p.align:
        target_wcs, n = _aligned_wcs(p.ra, p.dec, p.size_arcsec)
        for name, plane in planes.items():
            if name == "FLAGS":
                # Bitmask: take the nearest pixel's bits instead of blending.
                # Pixels off the detector get MISSING_DATA.
                aligned, footprint = reproject_interp(
                    (plane.astype(np.float64), native_wcs), target_wcs,
                    shape_out=(n, n), order="nearest-neighbor",
                )
                flags = np.nan_to_num(aligned, nan=0).astype(np.int64)
                flags[footprint == 0] |= FLAG_BITS["MISSING_DATA"]
                planes[name] = flags
            else:
                aligned, footprint = reproject_interp(
                    (plane, native_wcs), target_wcs, shape_out=(n, n), order="bilinear"
                )
                aligned[footprint == 0] = np.nan
                planes[name] = aligned
        cutout.data = planes[extension]
        cutout.wcs = target_wcs
    return cutout


def _bin_image(data: np.ndarray, factor: int) -> np.ndarray:
    """Downsample by averaging factor x factor blocks (NaN-aware)."""
    if factor == 1:
        return data
    h, w = (data.shape[0] // factor) * factor, (data.shape[1] // factor) * factor
    blocks = data[:h, :w].reshape(h // factor, factor, w // factor, factor)
    with np.errstate(all="ignore"):
        return np.nanmean(blocks, axis=(1, 3))


def _json_safe(value):
    if isinstance(value, (bool, int, str)) or value is None:
        return value
    if isinstance(value, float):
        return value if np.isfinite(value) else None
    return str(value)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/spherex/image/meta")
def get_image_meta(p: CutoutParams = Depends()):
    """Cutout size, WCS, observation time, wavelength at the target and pixel stats."""
    c = _load_cutout(p)
    finite = c.data[np.isfinite(c.data)].astype(np.float64)
    if finite.size:
        pct = np.percentile(finite, [0.5, 1, 5, 50, 95, 99, 99.5])
        stats = {
            "min": float(finite.min()),
            "max": float(finite.max()),
            "percentiles": dict(zip(["0.5", "1", "5", "50", "95", "99", "99.5"], map(float, pct))),
        }
    else:
        stats = None

    # Celestial WCS as FITS keywords, so the frontend can map pixel <-> RA/Dec.
    wcs_header = c.wcs.to_header(relax=True)

    return {
        "width": int(c.data.shape[1]),
        "height": int(c.data.shape[0]),
        "extension": p.extension.upper(),
        "aligned": p.align,
        "pixel_scale_arcsec": SPHEREX_PIXEL_SCALE_ARCSEC,
        "observation": {
            "date_mid": c.date_mid,
            "mjd_mid": c.mjd_mid,
            "exposure_s": c.exposure_s,
        },
        "wavelength_um": c.wavelength_um,
        "bandwidth_um": c.bandwidth_um,
        "header": {k: _json_safe(c.header.get(k)) for k in HEADER_KEYWORDS},
        "wcs": {k: _json_safe(v) for k, v in wcs_header.items()},
        "stats": stats,
    }


@app.get("/api/spherex/image/data")
def get_image_data(
    p: CutoutParams = Depends(),
    bin: int = Query(1, ge=1, le=16, description="Downsample factor (2 = half size)"),
):
    """Cutout pixels as little-endian float32, row-major, row 0 = bottom (south when aligned).

    Read in the browser with `new Float32Array(await res.arrayBuffer())`.
    Width/height come back in the X-Width / X-Height headers. NaN = no data
    (including any part of the cutout that falls off the edge of the detector).
    """
    c = _load_cutout(p)
    pixels = _bin_image(c.data.astype(np.float32), bin).astype("<f4", copy=False)
    headers = {
        "X-Width": str(pixels.shape[1]),
        "X-Height": str(pixels.shape[0]),
        "X-Dtype": "float32",
        "X-Bin": str(bin),
        "X-Aligned": "true" if p.align else "false",
        "Cache-Control": "public, max-age=86400",
    }
    if c.mjd_mid is not None:
        headers["X-Mjd"] = repr(c.mjd_mid)
    return Response(
        content=np.ascontiguousarray(pixels).tobytes(),
        media_type="application/octet-stream",
        headers=headers,
    )


# ---------------------------------------------------------------------------
# Difference imaging
# ---------------------------------------------------------------------------


@dataclass
class DiffParams:
    """Two images of the same spot to subtract. Shared by the diff endpoints."""

    url: str = Query(..., description="Image to test, usually the later one (access_url)")
    ref_url: str = Query(..., description="Reference image to subtract, usually the earlier one (access_url)")
    ra: float = Query(..., ge=0, lt=360, description="Cutout center RA in degrees")
    dec: float = Query(..., ge=-90, le=90, description="Cutout center Dec in degrees")
    size_arcsec: float = Query(300, gt=0, le=3600, description="Cutout width in arcsec")
    mask_flags: bool = Query(
        True, description="Blank pixels flagged as cosmic rays, hot/cold, saturated, persistence, etc."
    )


@dataclass
class DiffResult:
    diff: np.ndarray  # url - scale * ref, background-subtracted, MJy/sr
    snr: np.ndarray  # diff / expected noise from the VARIANCE planes
    sci_snr: np.ndarray  # significance of each pixel above the sky in the image
    ref_snr: np.ndarray  # same, in the reference
    interior: np.ndarray  # bool: usable pixel that isn't on the edge of the usable area
    wcs: WCS
    sci: Cutout
    ref: Cutout
    scale: float
    sci_background: float
    ref_background: float
    flux_sigma: float  # robust std of diff
    snr_sigma: float  # robust std of snr (~1 means VARIANCE describes the noise well)
    valid_fraction: float


def _robust_std(values: np.ndarray) -> float:
    med = np.median(values)
    return float(1.4826 * np.median(np.abs(values - med)))


@lru_cache(maxsize=16)
def _compute_diff(
    url: str, ref_url: str, ra: float, dec: float, size_arcsec: float, mask_flags: bool
) -> DiffResult:
    """Align two images, match their brightness, and subtract.

    Cached because the frontend usually asks for both /diff/meta and /diff/data.
    Callers must not modify the returned arrays.
    """
    planes = ("VARIANCE", "FLAGS")
    sci = _load_cutout(
        CutoutParams(url=url, ra=ra, dec=dec, size_arcsec=size_arcsec, extension="IMAGE", align=True), planes
    )
    ref = _load_cutout(
        CutoutParams(url=ref_url, ra=ra, dec=dec, size_arcsec=size_arcsec, extension="IMAGE", align=True), planes
    )

    a = sci.planes["IMAGE"].astype(np.float64)
    b = ref.planes["IMAGE"].astype(np.float64)
    va = sci.planes["VARIANCE"].astype(np.float64)
    vb = ref.planes["VARIANCE"].astype(np.float64)

    covered = np.isfinite(a) & np.isfinite(b) & np.isfinite(va) & np.isfinite(vb) & (va > 0) & (vb > 0)
    valid = covered.copy()
    if mask_flags:
        bad = (sci.planes["FLAGS"] | ref.planes["FLAGS"]) & DIFF_BAD_FLAGS
        valid &= bad == 0
    if valid.sum() < 25:
        raise HTTPException(status_code=422, detail="The two images have too few usable overlapping pixels")

    # Remove the sky background (mostly zodiacal light, which changes with season).
    sci_bg, ref_bg = float(np.median(a[valid])), float(np.median(b[valid]))
    a0, b0 = a - sci_bg, b - ref_bg

    # The two frames usually see the target at different wavelengths, so stars
    # have different brightness. Scale the reference to match, using pixels
    # that are clearly bright in both frames.
    noise_a, noise_b = float(np.sqrt(np.median(va[valid]))), float(np.sqrt(np.median(vb[valid])))
    bright_both = valid & (a0 > 10 * noise_a) & (b0 > 10 * noise_b)
    scale = float(np.median(a0[bright_both] / b0[bright_both])) if bright_both.sum() >= 5 else 1.0

    diff = a0 - scale * b0
    snr = diff / np.sqrt(va + scale**2 * vb)
    diff[~valid] = np.nan
    snr[~valid] = np.nan

    return DiffResult(
        diff=diff,
        snr=snr,
        sci_snr=np.where(valid, a0 / np.sqrt(va), np.nan),
        ref_snr=np.where(valid, b0 / np.sqrt(vb), np.nan),
        # The outer ring of the area both images cover is where resampling
        # artefacts live, so candidates there are dropped. (Flag-masked pixels
        # don't count as edges: a real source often has a flagged pixel in it.)
        interior=ndimage.binary_erosion(covered, iterations=1) & valid,
        wcs=sci.wcs,
        sci=sci,
        ref=ref,
        scale=scale,
        sci_background=sci_bg,
        ref_background=ref_bg,
        flux_sigma=_robust_std(diff[valid]),
        snr_sigma=_robust_std(snr[valid]),
        valid_fraction=float(valid.mean()),
    )


def _get_diff(p: DiffParams) -> DiffResult:
    return _compute_diff(p.url, p.ref_url, round(p.ra, 7), round(p.dec, 7), p.size_arcsec, p.mask_flags)


SOURCE_SNR = 5.0  # a pixel this far above the sky counts as "something is there"


def _find_candidates(r: DiffResult, threshold: float, min_pixels: int, max_candidates: int) -> list[dict]:
    """Groups of pixels that got significantly brighter or fainter.

    Each candidate says whether a source is visible there in the image and/or
    the reference:
    - only in the image      -> something appeared (e.g. where a mover is now)
    - only in the reference  -> something disappeared (where a mover was)
    - in both                -> a star that varied, or (more often) one that
                                didn't subtract cleanly; listed last
    A moving object shows up as an "appeared" and a "disappeared" candidate
    close together.
    """
    snr = np.nan_to_num(r.snr, nan=0.0)
    sci_snr = np.nan_to_num(r.sci_snr, nan=0.0)
    ref_snr = np.nan_to_num(r.ref_snr, nan=0.0)
    found = []
    for sign, change in ((1, "brighter"), (-1, "fainter")):
        # 8-connected, so pixels touching only at a corner still group together.
        labels, count = ndimage.label((sign * snr > threshold) & r.interior, structure=np.ones((3, 3)))
        for index in range(1, count + 1):
            ys, xs = np.nonzero(labels == index)
            if len(xs) < min_pixels:
                continue  # single hot pixels are almost always noise or cosmic rays
            weights = np.abs(snr[ys, xs])
            x, y = float(np.average(xs, weights=weights)), float(np.average(ys, weights=weights))
            sky = r.wcs.pixel_to_world(x, y)
            peak = int(np.argmax(weights))
            in_image = bool((sci_snr[ys, xs] > SOURCE_SNR).any())
            in_reference = bool((ref_snr[ys, xs] > SOURCE_SNR).any())
            if in_image and in_reference:
                kind = "changed_star"
            elif in_image:
                kind = "appeared"
            elif in_reference:
                kind = "disappeared"
            else:
                kind = "faint"
            found.append(
                {
                    "kind": kind,
                    "change": change,
                    "x": round(x, 2),  # pixel coords in the diff image, row 0 = bottom
                    "y": round(y, 2),
                    "ra": float(sky.ra.deg),
                    "dec": float(sky.dec.deg),
                    "peak_snr": float(snr[ys[peak], xs[peak]]),
                    "peak_flux": float(r.diff[ys[peak], xs[peak]]),
                    "pixels": int(len(xs)),
                    "in_image": in_image,
                    "in_reference": in_reference,
                }
            )
    # Most interesting first: appeared/disappeared, then faint, then star residuals.
    rank = {"appeared": 0, "disappeared": 0, "faint": 1, "changed_star": 2}
    found.sort(key=lambda c: (rank[c["kind"]], -abs(c["peak_snr"])))
    return found[:max_candidates]


def _observation(c: Cutout, url: str) -> dict:
    return {
        "access_url": url,
        "date_mid": c.date_mid,
        "mjd_mid": c.mjd_mid,
        "wavelength_um": c.wavelength_um,
        "bandwidth_um": c.bandwidth_um,
    }


@app.get("/api/spherex/diff/meta")
def get_diff_meta(
    p: DiffParams = Depends(),
    threshold: float = Query(5.0, gt=0, description="Signal-to-noise needed to report a candidate"),
    min_pixels: int = Query(2, ge=1, description="Ignore candidates smaller than this many pixels"),
    max_candidates: int = Query(50, gt=0, le=500),
):
    """How the subtraction was done, plus a list of places that changed."""
    r = _get_diff(p)
    dt_days = (
        r.sci.mjd_mid - r.ref.mjd_mid if r.sci.mjd_mid is not None and r.ref.mjd_mid is not None else None
    )
    wave_a, wave_b = r.sci.wavelength_um, r.ref.wavelength_um
    return {
        "width": int(r.diff.shape[1]),
        "height": int(r.diff.shape[0]),
        "pixel_scale_arcsec": SPHEREX_PIXEL_SCALE_ARCSEC,
        "image": _observation(r.sci, p.url),
        "reference": _observation(r.ref, p.ref_url),
        "dt_days": dt_days,
        "wavelength_difference_um": abs(wave_a - wave_b) if wave_a is not None and wave_b is not None else None,
        "scale": r.scale,
        "backgrounds": {"image": r.sci_background, "reference": r.ref_background},
        "flux_sigma": r.flux_sigma,
        "snr_sigma": r.snr_sigma,
        "valid_fraction": r.valid_fraction,
        "wcs": {k: _json_safe(v) for k, v in r.wcs.to_header(relax=True).items()},
        "threshold": threshold,
        "candidates": _find_candidates(r, threshold, min_pixels, max_candidates),
    }


@app.get("/api/spherex/diff/data")
def get_diff_data(
    p: DiffParams = Depends(),
    mode: str = Query("snr", pattern="^(snr|flux)$", description="snr = significance map, flux = MJy/sr"),
    bin: int = Query(1, ge=1, le=16),
):
    """Difference image as little-endian float32, same layout as /image/data.

    Positive = brighter in `url` than in `ref_url`. Display symmetrically
    around 0, e.g. from -5 to +5 for mode=snr. NaN = masked or no data.
    """
    r = _get_diff(p)
    values = r.snr if mode == "snr" else r.diff
    pixels = _bin_image(values.astype(np.float32), bin)
    if mode == "snr" and bin > 1:
        pixels = pixels * bin  # averaging bin*bin pixels lowers the noise by a factor of bin
    pixels = pixels.astype("<f4", copy=False)
    headers = {
        "X-Width": str(pixels.shape[1]),
        "X-Height": str(pixels.shape[0]),
        "X-Dtype": "float32",
        "X-Bin": str(bin),
        "X-Mode": mode,
        "X-Scale": repr(r.scale),
        "X-Sigma": repr(r.snr_sigma if mode == "snr" else r.flux_sigma),
        "Cache-Control": "public, max-age=86400",
    }
    if r.sci.mjd_mid is not None:
        headers["X-Mjd"] = repr(r.sci.mjd_mid)
    if r.ref.mjd_mid is not None:
        headers["X-Ref-Mjd"] = repr(r.ref.mjd_mid)
    return Response(
        content=np.ascontiguousarray(pixels).tobytes(),
        media_type="application/octet-stream",
        headers=headers,
    )
