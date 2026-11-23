import csv
import io
import math
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import transform_bounds, reproject
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

load_dotenv()

FIRMS_MAP_KEY = os.getenv("FIRMS_MAP_KEY", "").strip()
RASTER_ROOT = Path(os.getenv("RASTER_ROOT", "./data/rasters")).resolve()
KALBAR_BBOX = os.getenv("KALBAR_BBOX", "108.5,-3.2,114.3,2.2")
FIRMS_DEFAULT_SOURCE = os.getenv("FIRMS_DEFAULT_SOURCE", "VIIRS_SNPP_NRT")
FIRMS_CACHE_TTL = int(os.getenv("FIRMS_CACHE_TTL_SECONDS", "900"))

# Matches all layer keys defined in gis.html
SUPPORTED_LAYERS = {
    "sebaran_gambut",
    "tutupan_lahan",
    "ndmi",
    "ndvi",
    "nbr",
    "permukiman",
    "jaringan_jalan",
    "temperatur",
    "badan_air",
    "slope",
    "elevasi",
    "bahaya_karhutla",
    "hotspot",
    "safety_map",
}

# 4-class hazard colors from gis.html legend & classification modal
HAZARD_COLORS: Dict[int, Tuple[int, int, int, int]] = {
    1: (22, 163, 74, 210),   # Skor 1 - Rendah (#16a34a)
    2: (234, 179, 8, 210),   # Skor 2 - Sedang (#eab308)
    3: (249, 115, 22, 210),  # Skor 3 - Tinggi (#f97316)
    4: (220, 38, 38, 220),   # Skor 4 - Sangat Tinggi (#dc2626)
}

app = FastAPI(
    title="West Kalimantan Karhutla WebGIS Backend",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict to your frontend origin in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple in-memory caches
_firms_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_dataset_cache: Dict[str, Any] = {}


def _tile_bounds_3857(z: int, x: int, y: int) -> Tuple[float, float, float, float]:
    """Return Web Mercator (EPSG:3857) bounds (left, bottom, right, top) for XYZ tile."""
    origin_shift = 20037508.342789244
    initial_resolution = (2 * origin_shift) / 256.0
    res = initial_resolution / (2 ** z)
    left = x * 256.0 * res - origin_shift
    right = (x + 1) * 256.0 * res - origin_shift
    top = origin_shift - y * 256.0 * res
    bottom = origin_shift - (y + 1) * 256.0 * res
    return left, bottom, right, top


def _resolve_raster_path(layer_key: str, year: Optional[str] = None) -> Optional[Path]:
    """Find matching .tif file in RASTER_ROOT/<layer_key>/."""
    layer_dir = RASTER_ROOT / layer_key
    if not layer_dir.exists() or not layer_dir.is_dir():
        return None

    tif_files = sorted(
        list(layer_dir.glob("*.tif")) + list(layer_dir.glob("*.tiff"))
    )
    if not tif_files:
        return None

    if year:
        year_str = str(year).strip()
        for f in tif_files:
            if f"_{year_str}" in f.stem or f.stem.endswith(year_str):
                return f

    return tif_files[-1]


def _colorize_band(data: np.ndarray, nodata: Optional[float], layer_key: str) -> Image.Image:
    """Convert a 2D raster array into an RGBA PIL image."""
    h, w = data.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    valid = np.ones((h, w), dtype=bool)
    if nodata is not None:
        if np.isnan(nodata):
            valid &= ~np.isnan(data)
        else:
            valid &= data != nodata
    valid &= np.isfinite(data)

    if not np.any(valid):
        return Image.fromarray(rgba, mode="RGBA")

    if layer_key in {"bahaya_karhutla", "safety_map"}:
        # Support discrete scores 1..4 or continuous index 1.0..4.0
        rounded = np.rint(data).astype(np.int32)
        for score, (r, g, b, a) in HAZARD_COLORS.items():
            mask = valid & (rounded == score)
            rgba[mask] = [r, g, b, a]
    else:
        # Normalize valid values to 0..1 for a warm thermal/intensity ramp
        vals = data[valid].astype(np.float64)
        vmin, vmax = np.percentile(vals, 2), np.percentile(vals, 98)
        if vmax <= vmin:
            vmax = vmin + 1.0
        norm = np.clip((data - vmin) / (vmax - vmin), 0.0, 1.0)

        # Low -> amber/yellow, Mid -> orange, High -> crimson
        rgba[valid, 0] = np.clip(220 + 35 * norm[valid], 0, 255).astype(np.uint8)
        rgba[valid, 1] = np.clip(220 * (1.0 - 0.75 * norm[valid]), 0, 255).astype(np.uint8)
        rgba[valid, 2] = np.clip(60 * (1.0 - norm[valid]), 0, 255).astype(np.uint8)
        rgba[valid, 3] = 200

    return Image.fromarray(rgba, mode="RGBA")


def _render_tile_png(tif_path: Path, layer_key: str, z: int, x: int, y: int) -> bytes:
    """Render a 256x256 PNG tile from a GeoTIFF."""
    dst_left, dst_bottom, dst_right, dst_top = _tile_bounds_3857(z, x, y)
    dst_transform = from_bounds(dst_left, dst_bottom, dst_right, dst_top, 256, 256)
    dst_crs = "EPSG:3857"

    with rasterio.open(tif_path) as src:
        if not src.crs:
            raise HTTPException(status_code=500, detail=f"Raster {tif_path.name} missing CRS.")

        # Quick bounds check in EPSG:3857
        r_left, r_bottom, r_right, r_top = transform_bounds(
            src.crs, dst_crs, *src.bounds, densify_pts=21
        )
        if (
            dst_right < r_left
            or dst_left > r_right
            or dst_top < r_bottom
            or dst_bottom > r_top
        ):
            empty = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
            buf = io.BytesIO()
            empty.save(buf, format="PNG")
            return buf.getvalue()

        nodata = src.nodata if src.nodata is not None else -9999.0
        dst_arr = np.full((256, 256), nodata, dtype=np.float32)

        reproject(
            source=rasterio.band(src, 1),
            destination=dst_arr,
            src_transform=src.transform,
            src_crs=src.crs,
            src_nodata=src.nodata,
            dst_transform=dst_transform,
            dst_crs=dst_crs,
            dst_nodata=nodata,
            resampling=Resampling.nearest
            if layer_key in {"bahaya_karhutla", "safety_map", "sebaran_gambut", "tutupan_lahan"}
            else Resampling.bilinear,
        )

    img = _colorize_band(dst_arr, nodata, layer_key)
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    return out.getvalue()


@app.get("/api/health")
def health_check() -> Dict[str, Any]:
    available_layers = {}
    for key in sorted(SUPPORTED_LAYERS):
        layer_dir = RASTER_ROOT / key
        files = sorted([p.name for p in layer_dir.glob("*.tif")]) if layer_dir.exists() else []
        available_layers[key] = files
    return {
        "status": "ok",
        "raster_root": str(RASTER_ROOT),
        "firms_configured": bool(FIRMS_MAP_KEY),
        "layers": available_layers,
    }


@app.get("/api/layers/{layer_key}/metadata")
def layer_metadata(layer_key: str, year: Optional[str] = None) -> Dict[str, Any]:
    if layer_key not in SUPPORTED_LAYERS:
        raise HTTPException(status_code=404, detail=f"Unknown layer '{layer_key}'.")

    tif_path = _resolve_raster_path(layer_key, year)
    if not tif_path:
        raise HTTPException(
            status_code=404,
            detail=f"No GeoTIFF found for layer '{layer_key}' (year={year}).",
        )

    with rasterio.open(tif_path) as src:
        wgs84_bounds = (
            transform_bounds(src.crs, "EPSG:4326", *src.bounds, densify_pts=21)
            if src.crs
            else list(src.bounds)
        )
        return {
            "layer": layer_key,
            "file": tif_path.name,
            "crs": str(src.crs),
            "width": src.width,
            "height": src.height,
            "count": src.count,
            "bounds_4326": {
                "west": wgs84_bounds[0],
                "south": wgs84_bounds[1],
                "east": wgs84_bounds[2],
                "north": wgs84_bounds[3],
            },
            "tile_url_template": (
                f"/api/tiles/{layer_key}/{{z}}/{{x}}/{{y}}.png"
                + (f"?year={year}" if year else "")
            ),
        }


@app.get("/api/tiles/{layer_key}/{z}/{x}/{y}.png")
def get_raster_tile(
    layer_key: str,
    z: int,
    x: int,
    y: int,
    year: Optional[str] = Query(default=None),
) -> Response:
    if layer_key not in SUPPORTED_LAYERS:
        raise HTTPException(status_code=404, detail=f"Unknown layer '{layer_key}'.")
    if z < 0 or z > 22:
        raise HTTPException(status_code=400, detail="Zoom level out of range.")

    tif_path = _resolve_raster_path(layer_key, year)
    if not tif_path:
        raise HTTPException(
            status_code=404,
            detail=f"Raster file not found for layer '{layer_key}' (year={year}).",
        )

    png_bytes = _render_tile_png(tif_path, layer_key, z, x, y)
    return Response(content=png_bytes, media_type="image/png")


@app.get("/api/firms/hotspots")
async def get_firms_hotspots(
    source: str = Query(default=FIRMS_DEFAULT_SOURCE),
    bbox: str = Query(default=KALBAR_BBOX),
    day_range: int = Query(default=2, ge=1, le=10),
    date: Optional[str] = Query(default=None, description="Optional YYYY-MM-DD"),
    min_frp: Optional[float] = Query(default=None, ge=0.0),
) -> Dict[str, Any]:
    """Fetch active fire points from NASA FIRMS Area API and return GeoJSON."""
    if not FIRMS_MAP_KEY:
        raise HTTPException(
            status_code=503,
            detail="FIRMS_MAP_KEY is not configured in .env.",
        )

    cache_key = f"{source}|{bbox}|{day_range}|{date or 'latest'}"
    now = time.time()
    cached = _firms_cache.get(cache_key)
    if cached and (now - cached[0]) < FIRMS_CACHE_TTL:
        geojson_data = cached[1]
    else:
        base_url = (
            f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
            f"{FIRMS_MAP_KEY}/{source}/{bbox}/{day_range}"
        )
        url = f"{base_url}/{date}" if date else base_url

        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.get(url)

        if resp.status_code != 200:
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"NASA FIRMS API error: {resp.text[:200]}",
            )

        reader = csv.DictReader(io.StringIO(resp.text))
        features: List[Dict[str, Any]] = []

        for row in reader:
            try:
                lat = float(row["latitude"])
                lon = float(row["longitude"])
            except (KeyError, TypeError, ValueError):
                continue

            frp_val: Optional[float] = None
            if row.get("frp"):
                try:
                    frp_val = float(row["frp"])
                except ValueError:
                    frp_val = None

            props = {k: v for k, v in row.items() if k not in {"latitude", "longitude"}}
            if frp_val is not None:
                props["frp_num"] = frp_val

            features.append(
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [lon, lat],
                    },
                    "properties": props,
                }
            )

        geojson_data = {
            "type": "FeatureCollection",
            "features": features,
            "metadata": {
                "source": source,
                "bbox": bbox,
                "day_range": day_range,
                "date": date,
            },
        }
        _firms_cache[cache_key] = (now, geojson_data)

    if min_frp is not None:
        filtered = [
            f
            for f in geojson_data["features"]
            if (f["properties"].get("frp_num") or 0.0) >= min_frp
        ]
        return {**geojson_data, "features": filtered}

    return geojson_data