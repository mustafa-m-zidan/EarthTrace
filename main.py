"""EarthTrace MVP — FastAPI + NASA POWER monthly data + transparent trend analysis.

The first validated adapter uses NASA POWER's Monthly Point API. POWER documents
its monthly meteorological parameters as derived from NASA GMAO MERRA-2. The app
only enables point extraction in this build; it does not claim polygon means,
spatial heatmaps, or CUAHSI station values that it has not retrieved.
"""
from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import math
import os
import sqlite3
import statistics
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional
from urllib.parse import urlencode

import httpx
import numpy as np
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field, field_validator
from scipy.stats import norm, t as student_t, theilslopes

BASE_DIR = Path(__file__).resolve().parent
IS_SERVERLESS = bool(os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME"))
# On Vercel/serverless the project folder is read-only; only /tmp is writable.
DATA_DIR = Path("/tmp/earthtrace") if IS_SERVERLESS else BASE_DIR / "data"
DB_PATH = DATA_DIR / "earthtrace.sqlite3"
NASA_POWER_BASE = "https://power.larc.nasa.gov/api/temporal/monthly/point"
NASA_POWER_DOCS = "https://power.larc.nasa.gov/docs/services/api/temporal/monthly/"
OPENALEX_WORKS = "https://api.openalex.org/works"
APP_VERSION = "1.0.0"

DATASET_ID = "nasa_power_merra2_monthly"
DATASET = {
    "id": DATASET_ID,
    "short_name": "NASA POWER / MERRA-2 monthly point series",
    "title": "NASA POWER Monthly Meteorological Data",
    "provider": "NASA POWER",
    "source_family": "NASA GMAO MERRA-2 assimilation model",
    "collection_version": "POWER API current service (version returned in source metadata where available)",
    "source_url": NASA_POWER_DOCS,
    "description": (
        "Analysis-ready monthly meteorological values. NASA documents these "
        "meteorological parameters as derived from the GMAO MERRA-2 assimilation model."
    ),
    "spatial_mode": "point",
    "supported_temporal_resolutions": ["monthly"],
    "source_cadence": "monthly",
    "coverage_start": "1981-01",
    "coverage_end": "As published by NASA POWER; checked by the live request",
    "quality_note": (
        "The point API returns a gridded model/reanalysis-derived estimate. "
        "The current adapter screens missing/fill values and reports temporal coverage; "
        "it does not claim pixel-level QA flags."
    ),
}

VARIABLES: dict[str, dict[str, Any]] = {
    "T2M": {
        "id": "T2M", "name": "Near-surface air temperature", "short_name": "T2M",
        "unit": "°C", "community": "SB", "family": "temperature",
        "simple": "The monthly average air temperature at approximately 2 metres above the surface.",
        "why": "Temperature is a core indicator of atmospheric conditions and long-term climate variability.",
        "method": "NASA POWER meteorological data derived from the GMAO MERRA-2 assimilation model.",
        "increase": "A positive trend indicates that the estimated monthly mean temperature has risen over the selected period.",
        "caveat": "This is a gridded model/reanalysis-derived estimate, not a thermometer reading at the exact selected coordinate.",
        "technical": "POWER monthly T2M parameter. The source product defines the temporal statistic and unit; EarthTrace preserves the returned parameter values and metadata.",
        "precision": 2,
    },
    "PRECTOTCORR": {
        "id": "PRECTOTCORR", "name": "Corrected precipitation rate", "short_name": "PRECTOTCORR",
        "unit": "mm/day", "community": "AG", "family": "water",
        "simple": "The monthly mean rate of precipitation after the source product's correction processing.",
        "why": "Precipitation is an important part of the water cycle and can help investigate changes in rainfall availability.",
        "method": "NASA POWER meteorological data derived from NASA GMAO MERRA-2; the corrected precipitation parameter is supplied by POWER.",
        "increase": "A positive trend means the returned average daily precipitation rate increased over the chosen period; it does not by itself establish flood or drought risk.",
        "caveat": "The unit is a rate (mm/day), not a monthly accumulated depth. Do not sum these monthly mean rates as if each were an accumulation.",
        "technical": "POWER monthly PRECTOTCORR parameter. EarthTrace treats values as the provider-defined monthly statistic in mm/day and does not convert them to monthly totals.",
        "precision": 3,
    },
    "RH2M": {
        "id": "RH2M", "name": "Relative humidity at 2 metres", "short_name": "RH2M",
        "unit": "%", "community": "SB", "family": "atmosphere",
        "simple": "The amount of water vapour in the air relative to the maximum it could hold at that temperature, expressed as a percentage.",
        "why": "Humidity affects how the atmosphere feels, cloud processes, evaporation and ecosystem water stress.",
        "method": "NASA POWER meteorological data derived from the GMAO MERRA-2 assimilation model.",
        "increase": "A positive trend indicates higher monthly mean relative humidity in the returned data, not necessarily more rainfall.",
        "caveat": "Relative humidity depends on both water vapour and temperature. It should not be interpreted as precipitation or soil moisture.",
        "technical": "POWER monthly RH2M parameter. Unit and returned metadata are retained from the NASA POWER response.",
        "precision": 2,
    },
    "WS10M": {
        "id": "WS10M", "name": "Wind speed at 10 metres", "short_name": "WS10M",
        "unit": "m/s", "community": "RE", "family": "atmosphere",
        "simple": "The monthly average wind speed estimated at 10 metres above the surface.",
        "why": "Wind is part of the coupled atmosphere and influences energy exchange, dust movement and surface conditions.",
        "method": "NASA POWER meteorological data derived from the GMAO MERRA-2 assimilation model.",
        "increase": "A positive trend means the estimated monthly average 10-metre wind speed increased during the selected interval.",
        "caveat": "Local terrain, buildings and vegetation can make conditions at a specific site differ from the grid-cell estimate.",
        "technical": "POWER monthly WS10M parameter; values retain the API's returned unit and temporal statistic.",
        "precision": 2,
    },
    "TS": {
        "id": "TS", "name": "Earth skin temperature", "short_name": "TS",
        "unit": "°C", "community": "AG", "family": "temperature",
        "simple": "The temperature of the very top of the land or ocean surface, a little different from the air temperature above it.",
        "why": "Surface temperature drives evaporation, snow and ice melt, and the heat the ground sends back to the atmosphere.",
        "method": "NASA POWER meteorological data derived from the GMAO MERRA-2 assimilation model.",
        "increase": "A positive trend means the modelled surface skin temperature has risen over the selected period.",
        "caveat": "Skin temperature is a model estimate for a grid cell and can differ from satellite land-surface temperature products.",
        "technical": "POWER monthly TS parameter, retained with the provider's unit and temporal statistic.",
        "precision": 2,
    },
    "GWETTOP": {
        "id": "GWETTOP", "name": "Surface soil wetness", "short_name": "GWETTOP",
        "unit": "fraction", "community": "AG", "family": "water",
        "simple": "How wet the top few centimetres of soil are, from 0 (completely dry) to 1 (completely saturated).",
        "why": "Topsoil moisture responds quickly to rain and heat, so it is an early signal of drying or wetting land.",
        "method": "NASA POWER land-surface parameter derived from the GMAO MERRA-2 assimilation model.",
        "increase": "A positive trend means the modelled topsoil has become wetter over the selected period.",
        "caveat": "This is a dimensionless model wetness index, not a volumetric soil-moisture measurement from a probe or radiometer.",
        "technical": "POWER monthly GWETTOP parameter (surface soil wetness, fraction 0–1).",
        "precision": 3,
    },
    "GWETROOT": {
        "id": "GWETROOT", "name": "Root-zone soil wetness", "short_name": "GWETROOT",
        "unit": "fraction", "community": "AG", "family": "water",
        "simple": "How wet the soil is down to plant-root depth, from 0 (dry) to 1 (saturated).",
        "why": "Root-zone moisture is the water plants can actually reach, so it links rainfall to drought and crop stress.",
        "method": "NASA POWER land-surface parameter derived from the GMAO MERRA-2 assimilation model.",
        "increase": "A positive trend means the modelled root zone has become wetter over the selected period.",
        "caveat": "This is a dimensionless model wetness index; it changes more slowly than topsoil wetness.",
        "technical": "POWER monthly GWETROOT parameter (root-zone soil wetness, fraction 0–1).",
        "precision": 3,
    },
    "EVLAND": {
        "id": "EVLAND", "name": "Evaporation from land", "short_name": "EVLAND",
        "unit": "mm/day", "community": "AG", "family": "water",
        "simple": "How much water leaves the land surface as vapour each day, as a depth of water.",
        "why": "Evaporation is the other half of the water cycle next to rainfall; together they decide whether land gets wetter or drier.",
        "method": "NASA POWER land-surface parameter derived from the GMAO MERRA-2 assimilation model.",
        "increase": "A positive trend means the modelled land evaporation rate has increased over the selected period.",
        "caveat": "The unit is a daily rate, not a monthly total. Evaporation is a model product and is not measured directly at the point.",
        "technical": "POWER monthly EVLAND parameter; EarthTrace keeps the provider-defined statistic and unit.",
        "precision": 3,
    },
    "ALLSKY_SFC_SW_DWN": {
        "id": "ALLSKY_SFC_SW_DWN", "name": "Sunlight reaching the surface", "short_name": "ALLSKY_SFC_SW_DWN",
        "unit": "kWh/m²/day", "community": "RE", "family": "atmosphere",
        "simple": "The amount of solar energy that arrives on a flat patch of ground each day, after clouds and air have taken their share.",
        "why": "Surface sunlight powers evaporation, plant growth and solar energy, and it changes with cloud cover and air quality.",
        "method": "NASA POWER solar-flux data derived from satellite cloud and radiation products together with MERRA-2.",
        "increase": "A positive trend means more solar energy reaches the surface on average (for example from fewer clouds).",
        "caveat": "This is an all-sky satellite/model estimate for a grid cell, not a pyranometer reading at the site.",
        "technical": "POWER monthly ALLSKY_SFC_SW_DWN parameter (all-sky surface shortwave downward irradiance).",
        "precision": 3,
    },
    "CLOUD_AMT": {
        "id": "CLOUD_AMT", "name": "Cloud cover", "short_name": "CLOUD_AMT",
        "unit": "%", "community": "SB", "family": "atmosphere",
        "simple": "The share of the sky covered by cloud, as a percentage.",
        "why": "Clouds control how much sunlight reaches the ground and how much heat is trapped, so cloud changes feed back on climate.",
        "method": "NASA POWER cloud data derived from satellite cloud retrievals processed for the POWER project.",
        "increase": "A positive trend means the average cloud fraction has increased over the selected period.",
        "caveat": "Cloud amount depends on the retrieval method and can shift when satellites or algorithms change; interpret long trends cautiously.",
        "technical": "POWER monthly CLOUD_AMT parameter (cloud amount, %).",
        "precision": 2,
    },
    "PS": {
        "id": "PS", "name": "Surface air pressure", "short_name": "PS",
        "unit": "kPa", "community": "SB", "family": "atmosphere",
        "simple": "The weight of the air pressing down on the surface, measured in kilopascals.",
        "why": "Pressure patterns steer weather systems, and slow shifts in them can indicate changes in circulation.",
        "method": "NASA POWER meteorological data derived from the GMAO MERRA-2 assimilation model.",
        "increase": "A positive trend means the average surface pressure has increased; changes are usually small.",
        "caveat": "Surface pressure depends on elevation of the grid cell, so compare trends rather than absolute values between places.",
        "technical": "POWER monthly PS parameter (surface pressure, kPa).",
        "precision": 3,
    },
}

app = FastAPI(title="EarthTrace API", version=APP_VERSION, description="NASA-data-driven Earth-system trend investigation MVP")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("EARTH_TRACE_FRONTEND_ORIGIN", "http://127.0.0.1:8000"), "http://localhost:8000"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


# ---------------------------------------------------------------------------
# STORAGE — SQLite is generated at runtime; no extra schema source file.
# ---------------------------------------------------------------------------

def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS jobs (
            job_id TEXT PRIMARY KEY, status TEXT NOT NULL, stage TEXT NOT NULL,
            progress INTEGER, message TEXT, request_json TEXT NOT NULL,
            result_id TEXT, result_json TEXT, error TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS investigations (
            investigation_id TEXT PRIMARY KEY, title TEXT NOT NULL,
            payload_json TEXT NOT NULL, created_at TEXT NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS source_cache (
            cache_key TEXT PRIMARY KEY, response_json TEXT NOT NULL,
            retrieved_at TEXT NOT NULL
        )""")
        conn.commit()


@contextmanager
def db_connection():
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=20)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def update_job(job_id: str, **fields: Any) -> None:
    allowed = {"status", "stage", "progress", "message", "result_id", "result_json", "error"}
    items = [(key, json.dumps(value, ensure_ascii=False) if key in {"result_json"} and value is not None else value)
             for key, value in fields.items() if key in allowed]
    if not items:
        return
    items.append(("updated_at", utc_now()))
    statement = ", ".join(f"{key} = ?" for key, _ in items)
    with db_connection() as conn:
        conn.execute(f"UPDATE jobs SET {statement} WHERE job_id = ?", [v for _, v in items] + [job_id])


def get_job(job_id: str) -> Optional[dict[str, Any]]:
    with db_connection() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
    if not row:
        return None
    out = dict(row)
    out["request"] = json.loads(out.pop("request_json"))
    out["result"] = json.loads(out.pop("result_json")) if out.get("result_json") else None
    return out


def store_completed_result(result: dict[str, Any], request_payload: dict[str, Any], message: str) -> None:
    """Persist non-job-run analyses so their evidence can also be exported/extended."""
    job_id = str(uuid.uuid4())
    timestamp = utc_now()
    with db_connection() as conn:
        conn.execute(
            "INSERT INTO jobs (job_id,status,stage,progress,message,request_json,result_id,result_json,error,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (job_id, "completed", "completed", 100, message,
             json.dumps(request_payload, ensure_ascii=False), result["result_id"],
             json.dumps(result, ensure_ascii=False), None, timestamp, timestamp),
        )


# ---------------------------------------------------------------------------
# REQUEST SCHEMAS AND CATALOGUE
# ---------------------------------------------------------------------------
class PointRegion(BaseModel):
    type: Literal["Point"] = "Point"
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    name: str = Field(default="Selected point", max_length=100)


class AnalysisRequest(BaseModel):
    dataset_id: str = DATASET_ID
    variable_id: str
    region: PointRegion
    start_date: date
    end_date: date
    temporal_frequency: Literal["monthly"] = "monthly"
    seasonality: Literal["monthly_anomalies", "original_values"] = "monthly_anomalies"
    significance_level: float = Field(default=0.05, gt=0.0, lt=0.2)
    force_refresh: bool = False

    @field_validator("variable_id")
    @classmethod
    def variable_supported(cls, value: str) -> str:
        if value not in VARIABLES:
            raise ValueError("Variable is not in the tested EarthTrace catalogue.")
        return value

    @field_validator("dataset_id")
    @classmethod
    def dataset_supported(cls, value: str) -> str:
        if value != DATASET_ID:
            raise ValueError("Dataset is not enabled in this MVP.")
        return value

    @field_validator("end_date")
    @classmethod
    def date_range_valid(cls, end: date, info):
        start = info.data.get("start_date")
        if start and end <= start:
            raise ValueError("End date must be after start date.")
        return end


class CompareRequest(BaseModel):
    settings: AnalysisRequest
    region_b: PointRegion


class ExtendRequest(BaseModel):
    result_id: str
    start_year: Optional[int] = Field(default=None, ge=1981, le=2100)
    end_year: Optional[int] = Field(default=None, ge=1981, le=2100)


class GuideRequest(BaseModel):
    theme: str = "known"
    place: str = "any"
    question: str = "trend"


class DiscoveryRequest(BaseModel):
    theme: str = "temperature"
    region_context: str = Field(default="any region", max_length=180)
    region: Optional[PointRegion] = None


class SaveInvestigationRequest(BaseModel):
    title: str = Field(min_length=2, max_length=100)
    payload: dict[str, Any]


def catalog_variables() -> list[dict[str, Any]]:
    return [{k: v for k, v in var.items() if k not in {"community"}} | {
        "dataset_id": DATASET_ID,
        "supported_temporal_resolutions": ["monthly"],
        "source_url": NASA_POWER_DOCS,
    } for var in VARIABLES.values()]


# ---------------------------------------------------------------------------
# NASA POWER ADAPTER — monthly point requests only.
# ---------------------------------------------------------------------------
async def fetch_power_point(
    variable_id: str,
    region: PointRegion,
    start_year: int,
    end_year: int,
    force_refresh: bool = False,
) -> dict[str, Any]:
    variable = VARIABLES[variable_id]
    params = {
        "parameters": variable_id,
        "community": variable["community"],
        "longitude": f"{region.lon:.5f}",
        "latitude": f"{region.lat:.5f}",
        "start": str(start_year),
        "end": str(end_year),
        "format": "JSON",
    }
    request_url = f"{NASA_POWER_BASE}?{urlencode(params)}"
    cache_identity = {
        "provider": "NASA_POWER_MONTHLY_POINT",
        "adapter_version": APP_VERSION,
        "variable": variable_id,
        "community": variable["community"],
        "latitude": params["latitude"],
        "longitude": params["longitude"],
        "start": start_year,
        "end": end_year,
    }
    cache_key = hashlib.sha256(json.dumps(cache_identity, sort_keys=True).encode("utf-8")).hexdigest()
    cached_payload: Optional[dict[str, Any]] = None
    cached_at: Optional[str] = None
    if not force_refresh:
        with db_connection() as conn:
            cached = conn.execute("SELECT response_json, retrieved_at FROM source_cache WHERE cache_key = ?", (cache_key,)).fetchone()
        if cached:
            try:
                cached_time = datetime.fromisoformat(cached["retrieved_at"])
                if (datetime.now(timezone.utc) - cached_time).total_seconds() <= 86400:
                    cached_payload = json.loads(cached["response_json"])
                    cached_at = cached["retrieved_at"]
            except (ValueError, TypeError, json.JSONDecodeError):
                cached_payload = None
    cache_status = "cached_nasa_response" if cached_payload is not None else "fresh_nasa_response"
    if cached_payload is None:
        headers = {"User-Agent": f"EarthTrace/{APP_VERSION} (NASA POWER public API client)"}
        timeout = httpx.Timeout(60.0, connect=15.0)
        # POWER only serves a parameter through the communities that include it. Try the expected community first,
        # then the others, so one catalogue assumption cannot make a variable unusable. Only the same parameter is fetched.
        communities = [variable["community"], *[c for c in ("AG", "SB", "RE") if c != variable["community"]]]
        last_detail: Any = None
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers) as client:
            for community in communities:
                params["community"] = community
                response = await client.get(NASA_POWER_BASE, params=params)
                if response.status_code == 422:
                    try:
                        last_detail = response.json()
                    except Exception:
                        last_detail = response.text[:500]
                    continue
                if response.status_code == 429:
                    raise RuntimeError("NASA POWER is rate-limiting requests. Wait before retrying; EarthTrace did not substitute other data.")
                response.raise_for_status()
                cached_payload = response.json()
                request_url = f"{NASA_POWER_BASE}?{urlencode(params)}"
                break
        if cached_payload is None:
            raise RuntimeError(f"NASA POWER rejected this request (422): {last_detail}")
        cached_at = utc_now()
        with db_connection() as conn:
            conn.execute(
                "INSERT INTO source_cache (cache_key,response_json,retrieved_at) VALUES (?,?,?) "
                "ON CONFLICT(cache_key) DO UPDATE SET response_json=excluded.response_json,retrieved_at=excluded.retrieved_at",
                (cache_key, json.dumps(cached_payload, ensure_ascii=False), cached_at),
            )
    try:
        parameter_data = cached_payload["properties"]["parameter"][variable_id]
    except (KeyError, TypeError):
        errors = cached_payload.get("messages") or cached_payload.get("header", {}).get("messages") or []
        raise RuntimeError(f"NASA POWER returned a response without the requested parameter series. {errors}")

    dates: list[str] = []
    values: list[float] = []
    for key, raw_value in sorted(parameter_data.items()):
        if not (len(key) == 6 and key.isdigit()):
            continue
        month_date = f"{key[:4]}-{key[4:]}-01"
        year, month = int(key[:4]), int(key[4:])
        if year < start_year or year > end_year or not 1 <= month <= 12:
            continue
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(value) or value <= -900:
            continue
        dates.append(month_date)
        values.append(value)

    if not dates:
        errors = cached_payload.get("messages") or cached_payload.get("header", {}).get("messages") or []
        raise RuntimeError(f"NASA POWER returned no valid observations. {errors}")

    header = cached_payload.get("header", {})
    source_meta = cached_payload.get("parameters", {}).get(variable_id, {}) if isinstance(cached_payload.get("parameters"), dict) else {}
    return {
        "dates": dates,
        "values": values,
        "header": header,
        "parameter_metadata": source_meta,
        "request_url": request_url,
        "retrieved_at": cached_at,
        "cache_status": cache_status,
        "source_product": "NASA POWER monthly meteorological parameter; MERRA-2-derived",
        "source_note": "POWER documents meteorological parameters as derived from NASA GMAO MERRA-2.",
    }


# ---------------------------------------------------------------------------
# SCIENTIFIC PIPELINE — coverage, monthly anomaly, OLS-HAC, seasonal MK, Sen.
# ---------------------------------------------------------------------------
def decimal_year(iso_date: str) -> float:
    d = date.fromisoformat(iso_date)
    return d.year + (d.month - 1) / 12.0


def monthly_anomalies(dates: list[str], values: list[float]) -> list[float]:
    month_values: dict[int, list[float]] = {m: [] for m in range(1, 13)}
    for stamp, value in zip(dates, values):
        month_values[int(stamp[5:7])].append(value)
    climatology = {m: float(np.mean(vals)) for m, vals in month_values.items() if vals}
    return [value - climatology[int(stamp[5:7])] for stamp, value in zip(dates, values)]


def calendar_month_index(stamp: str) -> int:
    d = date.fromisoformat(stamp)
    return d.year * 12 + d.month - 1


def newey_west_regression(x_values: list[float], y_values: list[float], dates: list[str]) -> dict[str, Any]:
    x = np.asarray(x_values, dtype=float)
    y = np.asarray(y_values, dtype=float)
    n = len(y)
    if n < 3 or len(dates) != n:
        raise ValueError("Regression requires at least three observations with matching monthly timestamps.")
    x_center = x - x.mean()
    design = np.column_stack([np.ones(n), x_center])
    xtx_inv = np.linalg.inv(design.T @ design)
    beta = xtx_inv @ design.T @ y
    residuals = y - design @ beta
    # Calendar-aware Newey–West HAC: a missing month remains a real time gap,
    # rather than making the next retained row look like an adjacent month.
    lag_window = min(12, max(1, int(math.floor(4 * (n / 100) ** (2 / 9)))), max(1, n // 4))
    month_indices = [calendar_month_index(stamp) for stamp in dates]
    month_to_row = {month: index for index, month in enumerate(month_indices)}
    meat = np.zeros((2, 2), dtype=float)
    for i in range(n):
        xi = design[i:i+1].T
        meat += (residuals[i] ** 2) * (xi @ xi.T)
    for lag in range(1, lag_window + 1):
        weight = 1.0 - lag / (lag_window + 1.0)
        cross = np.zeros((2, 2), dtype=float)
        for i, month in enumerate(month_indices):
            previous = month_to_row.get(month - lag)
            if previous is not None:
                cross += residuals[i] * residuals[previous] * np.outer(design[i], design[previous])
        meat += weight * (cross + cross.T)
    covariance = xtx_inv @ meat @ xtx_inv
    covariance *= n / max(1, n - 2)
    se_slope = math.sqrt(max(0.0, float(covariance[1, 1])))
    slope = float(beta[1])
    df = max(1, n - 2)
    if se_slope > 0:
        t_stat = slope / se_slope
        p_value = float(2 * student_t.sf(abs(t_stat), df))
        critical = float(student_t.ppf(0.975, df))
        ci = [slope - critical * se_slope, slope + critical * se_slope]
    else:
        t_stat = 0.0 if slope == 0 else math.copysign(float("inf"), slope)
        p_value = 1.0 if slope == 0 else 0.0
        ci = [slope, slope]
    fitted = (design @ beta).tolist()
    adjacent_pairs = [(residuals[i], residuals[i-1]) for i in range(1, n) if month_indices[i] - month_indices[i-1] == 1]
    if len(adjacent_pairs) >= 3:
        left, right = np.asarray(adjacent_pairs).T
        lag1 = float(np.corrcoef(left, right)[0, 1]) if np.std(left) > 0 and np.std(right) > 0 else 0.0
    else:
        lag1 = 0.0
    return {
        "slope_per_year": slope,
        "slope_per_decade": slope * 10,
        "standard_error_hac": se_slope,
        "confidence_interval_95": ci,
        "p_value": p_value,
        "t_statistic": float(t_stat),
        "fitted_values": fitted,
        "hac_lags": lag_window,
        "residual_lag1_autocorrelation": lag1,
        "n": n,
        "hac_time_basis": "calendar months; missing months remain gaps",
    }


def seasonal_mann_kendall(dates: list[str], values: list[float]) -> dict[str, Any]:
    grouped: dict[int, list[float]] = {m: [] for m in range(1, 13)}
    for stamp, value in zip(dates, values):
        grouped[int(stamp[5:7])].append(float(value))
    total_s = 0
    total_var = 0.0
    total_pairs = 0
    for vals in grouped.values():
        n = len(vals)
        if n < 2:
            continue
        s = 0
        for i in range(n - 1):
            for j in range(i + 1, n):
                s += 1 if vals[j] > vals[i] else (-1 if vals[j] < vals[i] else 0)
        counts: dict[float, int] = {}
        for v in vals:
            counts[v] = counts.get(v, 0) + 1
        tie_term = sum(c * (c - 1) * (2 * c + 5) for c in counts.values() if c > 1)
        var = (n * (n - 1) * (2 * n + 5) - tie_term) / 18.0
        total_s += s
        total_var += var
        total_pairs += n * (n - 1) / 2
    if total_var <= 0 or total_pairs <= 0:
        return {"tau": 0.0, "z": 0.0, "p_value": 1.0, "method_variant": "seasonal Mann–Kendall (calendar-month strata)", "available": False}
    if total_s > 0:
        z = (total_s - 1) / math.sqrt(total_var)
    elif total_s < 0:
        z = (total_s + 1) / math.sqrt(total_var)
    else:
        z = 0.0
    p = float(2 * norm.sf(abs(z)))
    return {
        "tau": float(total_s / total_pairs),
        "z": float(z),
        "p_value": p,
        "method_variant": "seasonal Mann–Kendall (same calendar month compared across years)",
        "available": True,
    }


def make_analysis_result(request: AnalysisRequest, data: dict[str, Any]) -> dict[str, Any]:
    selected = [(stamp, float(value)) for stamp, value in zip(data["dates"], data["values"])
                if request.start_date <= date.fromisoformat(stamp) <= request.end_date]
    dates = [stamp for stamp, _ in selected]
    raw_values = [value for _, value in selected]
    if not dates:
        raise RuntimeError("The NASA POWER response contains no values inside the exact requested date interval.")
    start_month = request.start_date.year * 12 + request.start_date.month
    end_month = request.end_date.year * 12 + request.end_date.month
    expected = max(0, end_month - start_month + 1)
    valid_count = len(raw_values)
    coverage = (100.0 * valid_count / expected) if expected else 0.0
    x_values = [decimal_year(d) for d in dates]
    anomalies = monthly_anomalies(dates, raw_values)
    analysis_values = anomalies if request.seasonality == "monthly_anomalies" else raw_values
    if len(raw_values) < 24:
        quality_classification = "insufficient_for_primary_trend"
    elif coverage < 70:
        quality_classification = "low_temporal_coverage"
    elif len(raw_values) < 120:
        quality_classification = "exploratory_under_10_year_target"
    elif coverage < 90:
        quality_classification = "usable_with_coverage_warning"
    else:
        quality_classification = "meets_default_temporal_target"

    if len(raw_values) < 3:
        raise RuntimeError("The selected point has too few valid monthly values to build a trend result.")
    ols = newey_west_regression(x_values, analysis_values, dates)
    mk = seasonal_mann_kendall(dates, analysis_values)
    try:
        sen = theilslopes(np.asarray(analysis_values, dtype=float), np.asarray(x_values, dtype=float), alpha=0.95)
        sen_result = {
            "slope_per_year": float(sen.slope),
            "slope_per_decade": float(sen.slope * 10),
            "confidence_interval_95": [float(sen.low_slope), float(sen.high_slope)],
        }
    except Exception:
        sen_result = {"slope_per_year": None, "slope_per_decade": None, "confidence_interval_95": None}

    p_value = ols["p_value"]
    slope = ols["slope_per_year"]
    alpha = request.significance_level
    if quality_classification in {"insufficient_for_primary_trend", "low_temporal_coverage"}:
        classification = "insufficient_data"
    elif quality_classification == "exploratory_under_10_year_target":
        classification = "exploratory_result"
    elif p_value < alpha and slope > 0:
        classification = "significant_increasing_trend"
    elif p_value < alpha and slope < 0:
        classification = "significant_decreasing_trend"
    elif abs(slope) > 1e-12:
        classification = "trend_detected_not_statistically_significant"
    else:
        classification = "no_clear_trend_detected"

    variable = VARIABLES[request.variable_id]
    source_unit = variable["unit"]
    anomaly_label = "calendar-month anomaly" if request.seasonality == "monthly_anomalies" else "original monthly value"
    if classification == "significant_increasing_trend":
        phrase = "a statistically significant increasing trend"
    elif classification == "significant_decreasing_trend":
        phrase = "a statistically significant decreasing trend"
    elif classification == "trend_detected_not_statistically_significant":
        phrase = "an estimated trend that is not statistically significant"
    elif classification == "no_clear_trend_detected":
        phrase = "no clear trend under the selected method"
    elif classification == "exploratory_result":
        phrase = "an exploratory trend estimate from a record shorter than the 10-year preferred target"
    else:
        phrase = "an exploratory estimate with insufficient evidence for a primary trend conclusion"
    ci = ols["confidence_interval_95"]
    interpretation = (
        f"At {request.region.name}, {variable['name'].lower()} showed {phrase} of "
        f"{slope:.5g} {source_unit}/year ({slope * 10:.5g} {source_unit}/decade) "
        f"during {dates[0][:7]} to {dates[-1][:7]}. The 95% HAC confidence interval was "
        f"[{ci[0]:.5g}, {ci[1]:.5g}] {source_unit}/year; the OLS-HAC p-value was "
        f"{p_value:.4g}. {coverage:.1f}% of the requested monthly timestamps were retained. "
        "This describes the returned data trend and does not establish its cause."
    )
    if len(raw_values) < 120:
        interpretation += " The record is shorter than the 10-year preferred target and should be treated as exploratory."
    if abs(ols["residual_lag1_autocorrelation"]) >= 0.3:
        interpretation += " Residual lag-1 autocorrelation is noticeable; the uncertainty estimate should be interpreted cautiously."

    return {
        "result_id": str(uuid.uuid4()),
        "status": "completed",
        "dataset": {
            "id": DATASET_ID,
            "short_name": DATASET["short_name"],
            "title": DATASET["title"],
            "provider": "NASA",
            "source_family": DATASET["source_family"],
            "collection_version": data.get("header", {}).get("api_version", "NASA POWER API response; version not stated in header"),
            "source_url": NASA_POWER_DOCS,
            "request_url": data["request_url"],
            "source_product": data["source_product"],
            "retrieved_at": data.get("retrieved_at", utc_now()),
            "cache_status": data.get("cache_status", "not_reported"),
        },
        "variable": {
            "id": request.variable_id,
            "name": variable["name"],
            "unit": source_unit,
            "source_parameter": variable["short_name"],
            "metadata": data.get("parameter_metadata", {}),
        },
        "region": {
            "name": request.region.name,
            "geometry_type": "Point",
            "latitude": request.region.lat,
            "longitude": request.region.lon,
            "note": "Point estimate; not a regional area average.",
        },
        "period": {
            "requested_start": request.start_date.isoformat(),
            "requested_end": request.end_date.isoformat(),
            "actual_first_observation": dates[0],
            "actual_last_observation": dates[-1],
            "frequency": "monthly",
        },
        "quality": {
            "expected_observations": expected,
            "valid_observations": valid_count,
            "temporal_coverage_percent": round(coverage, 2),
            "quality_classification": quality_classification,
            "quality_filters": ["Provider missing/fill values removed", "Non-finite values removed"],
            "quality_limitations": [
                "The point API does not provide pixel-level quality flags in this EarthTrace adapter.",
                "The selected coordinate is represented by the NASA POWER source grid; it is not an in-situ station measurement.",
            ],
            "missing_month_count": max(0, expected - valid_count),
        },
        "trend": {
            "method": "Ordinary least squares with Newey–West/HAC covariance",
            "series_used": anomaly_label,
            "slope_per_year": ols["slope_per_year"],
            "slope_per_decade": ols["slope_per_decade"],
            "standard_error_hac": ols["standard_error_hac"],
            "confidence_interval_95": ols["confidence_interval_95"],
            "p_value": ols["p_value"],
            "significance_level": alpha,
            "classification": classification,
            "hac_lags": ols["hac_lags"],
            "hac_time_basis": ols["hac_time_basis"],
            "residual_lag1_autocorrelation": ols["residual_lag1_autocorrelation"],
            "fitted_values": ols["fitted_values"],
        },
        "mann_kendall": mk,
        "theil_sen": sen_result,
        "series": [{"date": d, "value": v, "anomaly": a} for d, v, a in zip(dates, raw_values, anomalies)],
        "method_notes": [
            "The trend regression is applied to calendar-month anomalies by default; each calendar month's mean over the selected period is subtracted.",
            "OLS uncertainty uses a calendar-aware Newey–West HAC covariance estimate; missing months remain gaps in the lag structure.",
            "Seasonal Mann–Kendall compares like calendar months across years. Its variance is not serial-correlation adjusted in this MVP; interpret it alongside the HAC regression and residual diagnostic.",
            "Theil–Sen is a robust slope estimate; its interval is reported separately.",
            "The anomaly baseline is the selected analysis period, not a fixed 30-year climate normal.",
            "No causal attribution or future prediction is made.",
        ],
        "interpretation": interpretation,
        "created_at": utc_now(),
        "source_state": "cached_nasa_response" if data.get("cache_status") == "cached_nasa_response" else "live_from_nasa",
    }



# ---------------------------------------------------------------------------
# GLOBAL SCAN — the same analysis at a fixed set of places that sample Earth's biomes.
# The point is the contrast between regions, not a global average.
# ---------------------------------------------------------------------------
SCAN_POINTS: list[dict[str, Any]] = [
    {"id": "svalbard", "name": "Svalbard", "biome": "High Arctic", "lat": 78.22, "lon": 15.63},
    {"id": "greenland", "name": "Greenland ice sheet", "biome": "Ice sheet", "lat": 72.0, "lon": -40.0},
    {"id": "reykjavik", "name": "Reykjavík", "biome": "Subarctic coast", "lat": 64.15, "lon": -21.94},
    {"id": "yakutsk", "name": "Yakutsk", "biome": "Boreal / permafrost", "lat": 62.03, "lon": 129.73},
    {"id": "moscow", "name": "Moscow", "biome": "Temperate continental", "lat": 55.75, "lon": 37.62},
    {"id": "london", "name": "London", "biome": "Temperate maritime", "lat": 51.51, "lon": -0.13},
    {"id": "athens", "name": "Athens", "biome": "Mediterranean", "lat": 37.98, "lon": 23.73},
    {"id": "california", "name": "Central California", "biome": "Mediterranean farmland", "lat": 36.78, "lon": -119.42},
    {"id": "tokyo", "name": "Tokyo", "biome": "Humid subtropical city", "lat": 35.68, "lon": 139.65},
    {"id": "tibet", "name": "Tibetan Plateau", "biome": "High plateau", "lat": 31.0, "lon": 91.1},
    {"id": "cairo", "name": "Cairo", "biome": "Desert river valley", "lat": 30.04, "lon": 31.24},
    {"id": "sahara", "name": "Tamanrasset (Sahara)", "biome": "Hot desert", "lat": 22.79, "lon": 5.52},
    {"id": "delhi", "name": "Delhi", "biome": "Monsoon plain", "lat": 28.61, "lon": 77.21},
    {"id": "dhaka", "name": "Dhaka", "biome": "Monsoon delta", "lat": 23.81, "lon": 90.41},
    {"id": "honolulu", "name": "Honolulu", "biome": "Tropical ocean island", "lat": 21.31, "lon": -157.86},
    {"id": "singapore", "name": "Singapore", "biome": "Equatorial city", "lat": 1.35, "lon": 103.82},
    {"id": "congo", "name": "Congo basin", "biome": "Tropical rainforest", "lat": 0.5, "lon": 23.5},
    {"id": "nairobi", "name": "Nairobi", "biome": "Highland savanna", "lat": -1.29, "lon": 36.82},
    {"id": "manaus", "name": "Manaus (Amazon)", "biome": "Tropical rainforest", "lat": -3.12, "lon": -60.02},
    {"id": "brasilia", "name": "Brasília", "biome": "Cerrado savanna", "lat": -15.8, "lon": -47.89},
    {"id": "atacama", "name": "Atacama Desert", "biome": "Coastal desert", "lat": -23.9, "lon": -69.2},
    {"id": "alice", "name": "Alice Springs", "biome": "Australian outback", "lat": -23.7, "lon": 133.88},
    {"id": "capetown", "name": "Cape Town", "biome": "Southern Mediterranean", "lat": -33.92, "lon": 18.42},
    {"id": "mcmurdo", "name": "McMurdo Sound", "biome": "Antarctic coast", "lat": -77.85, "lon": 166.67},
]
SCAN_LOOKUP = {point["id"]: point for point in SCAN_POINTS}


class ScanBatchRequest(BaseModel):
    variable_id: str
    start_year: int = Field(ge=1981, le=2100)
    end_year: int = Field(ge=1981, le=2100)
    point_ids: list[str] = Field(min_length=1, max_length=8)
    seasonality: Literal["monthly_anomalies", "original_values"] = "monthly_anomalies"
    significance_level: float = Field(default=0.05, gt=0.0, lt=0.2)

    @field_validator("variable_id")
    @classmethod
    def scan_variable_supported(cls, value: str) -> str:
        if value not in VARIABLES:
            raise ValueError("Variable is not in the EarthTrace catalogue.")
        return value

    @field_validator("end_year")
    @classmethod
    def scan_years_valid(cls, end: int, info):
        start = info.data.get("start_year")
        if start is not None and end <= start:
            raise ValueError("End year must be after start year.")
        return end


async def scan_one_point(request: ScanBatchRequest, point: dict[str, Any], gate: asyncio.Semaphore) -> dict[str, Any]:
    base = {"id": point["id"], "name": point["name"], "biome": point["biome"], "lat": point["lat"], "lon": point["lon"]}
    async with gate:
        try:
            payload = AnalysisRequest(
                variable_id=request.variable_id,
                region=PointRegion(lat=point["lat"], lon=point["lon"], name=point["name"]),
                start_date=date(request.start_year, 1, 1),
                end_date=date(request.end_year, 12, 1),
                seasonality=request.seasonality,
                significance_level=request.significance_level,
            ).model_dump(mode="json")
            result = await execute_analysis(payload)
        except Exception as exc:  # one place failing must not hide the others
            return {**base, "ok": False, "error": str(exc)[:300]}
    trend = result["trend"]
    return {
        **base,
        "ok": True,
        "slope_per_year": trend["slope_per_year"],
        "slope_per_decade": trend["slope_per_decade"],
        "confidence_interval_95": trend["confidence_interval_95"],
        "p_value": trend["p_value"],
        "classification": trend["classification"],
        "significant": trend["classification"] in {"significant_increasing_trend", "significant_decreasing_trend"},
        "coverage": result["quality"]["temporal_coverage_percent"],
        "valid_observations": result["quality"]["valid_observations"],
        "unit": result["variable"]["unit"],
    }

# ---------------------------------------------------------------------------
# JOB RUNNER
# ---------------------------------------------------------------------------
async def execute_analysis(request_payload: dict[str, Any], job_id: Optional[str] = None) -> dict[str, Any]:
    request = AnalysisRequest(**request_payload)
    if job_id:
        update_job(job_id, status="retrieving", stage="retrieving", progress=None, message="Retrieving the selected monthly series from NASA POWER.")
    start_year, end_year = request.start_date.year, request.end_date.year
    if start_year < 1981:
        raise RuntimeError("NASA POWER's documented MERRA-2 meteorological coverage begins in 1981; choose 1981 or later.")
    if end_year > datetime.now(timezone.utc).year - 1:
        raise RuntimeError("The current NASA POWER monthly meteorological record is documented through the previous year. Choose a period ending no later than the latest published year shown by NASA.")
    data = await fetch_power_point(request.variable_id, request.region, start_year, end_year, force_refresh=request.force_refresh)
    if job_id:
        update_job(job_id, status="quality_control", stage="quality", progress=None, message="Checking timestamps, missing values and temporal coverage.")
    await asyncio.sleep(0)
    if job_id:
        update_job(job_id, status="analyzing", stage="analyzing", progress=None, message="Estimating trend and testing statistical evidence.")
    result = make_analysis_result(request, data)
    return result


async def run_analysis_job(job_id: str, request_payload: dict[str, Any]) -> None:
    try:
        result = await execute_analysis(request_payload, job_id)
        update_job(job_id, status="completed", stage="completed", progress=100, message="NASA data were retrieved and the trend analysis is complete.", result_id=result["result_id"], result_json=result)
    except Exception as exc:
        update_job(job_id, status="failed", stage="failed", progress=None, message="The request did not produce a result.", error=str(exc))


# ---------------------------------------------------------------------------
# API ROUTES
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup_event() -> None:
    init_db()


@app.get("/", include_in_schema=False)
async def homepage():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/style.css", include_in_schema=False)
async def stylesheet():
    return FileResponse(BASE_DIR / "style.css", media_type="text/css")


@app.get("/script.js", include_in_schema=False)
async def javascript():
    return FileResponse(BASE_DIR / "script.js", media_type="text/javascript")


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "application": "EarthTrace",
        "version": APP_VERSION,
        "data_adapter": "NASA POWER monthly point API",
        "data_adapter_live_check": "not_checked_until_analysis_request",
        "ai_mode": "ai" if os.getenv("AI_API_BASE_URL") and os.getenv("AI_API_KEY") else "rules_and_openalex",
        "database": "sqlite",
        "source_cache": "SQLite cache with a 24-hour freshness window and explicit bypass",
        "features": {"point_analysis": True, "comparison": True, "csv_export": True, "refresh_from_nasa": True, "polygon_analysis": False, "cuahsi_direct_series": False},
    }


@app.get("/api/catalog/datasets")
async def list_datasets():
    return {"datasets": [DATASET], "count": 1, "catalogue_state": "curated_supported_adapter"}


@app.get("/api/catalog/datasets/{dataset_id}")
async def get_dataset(dataset_id: str):
    if dataset_id != DATASET_ID:
        raise HTTPException(404, "Dataset is not enabled in this MVP.")
    return DATASET


@app.get("/api/catalog/datasets/{dataset_id}/variables")
async def get_dataset_variables(dataset_id: str):
    if dataset_id != DATASET_ID:
        raise HTTPException(404, "Dataset is not enabled in this MVP.")
    return {"dataset_id": dataset_id, "variables": catalog_variables()}


@app.get("/api/catalog/variables")
async def search_variables(q: Optional[str] = Query(default=None, max_length=100)):
    items = catalog_variables()
    if q:
        needle = q.lower()
        items = [item for item in items if needle in " ".join(str(item.get(k, "")) for k in ("name", "id", "simple", "family")).lower()]
    return {"variables": items, "count": len(items)}


@app.post("/api/guide/recommendations")
async def guide_recommendations(request: GuideRequest):
    ranked = []
    for variable in VARIABLES.values():
        score = 0
        if request.theme in {"temperature", "water", "atmosphere"} and variable["family"] == request.theme:
            score += 5
        if request.theme == "known":
            score += 1
        if request.place == "dryland" and variable["family"] in {"temperature", "water"}:
            score += 1
        if request.place == "tropical" and variable["family"] in {"water", "atmosphere"}:
            score += 1
        if request.question == "seasonality":
            score += 1
        if request.question == "compare":
            score += 1
        ranked.append((score, variable))
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    return {
        "mode": "catalogue_matching",
        "note": "Recommendations are limited to the current tested NASA POWER monthly point catalogue. They are not evidence of a trend.",
        "recommendations": [{
            "variable_id": item["id"], "name": item["name"], "unit": item["unit"],
            "why": f"Matches the selected theme and can be requested as a monthly NASA POWER point series. {item['caveat']}",
            "dataset_id": DATASET_ID, "source_url": NASA_POWER_DOCS,
        } for _, item in ranked[:3]],
    }


# ---------------------------------------------------------------------------
# DISCOVERY — OpenAlex source records + optional server-side OpenAI-compatible LLM.
# ---------------------------------------------------------------------------
def flatten_inverted_abstract(index: Optional[dict[str, list[int]]]) -> str:
    if not index:
        return ""
    words: list[tuple[int, str]] = []
    for word, positions in index.items():
        for pos in positions:
            words.append((pos, word))
    words.sort(key=lambda item: item[0])
    return " ".join(word for _, word in words)


async def fetch_openalex_records(search_query: str) -> list[dict[str, Any]]:
    params = {"search": search_query, "per-page": 5, "select": "id,doi,title,publication_year,authorships,abstract_inverted_index,primary_location,cited_by_count"}
    async with httpx.AsyncClient(timeout=22.0, follow_redirects=True) as client:
        response = await client.get(OPENALEX_WORKS, params=params, headers={"User-Agent": "EarthTrace/1.0 (research discovery)"})
        response.raise_for_status()
        payload = response.json()
    records = []
    for work in payload.get("results", []):
        title = work.get("title")
        if not title:
            continue
        authors = [a.get("author", {}).get("display_name") for a in work.get("authorships", [])[:3]]
        records.append({
            "id": work.get("id"),
            "title": title,
            "year": work.get("publication_year"),
            "authors": [a for a in authors if a],
            "abstract": flatten_inverted_abstract(work.get("abstract_inverted_index"))[:1200],
            "doi": work.get("doi"),
            "url": work.get("doi") or work.get("id"),
            "cited_by_count": work.get("cited_by_count"),
        })
    return records


@app.post("/api/discovery/opportunities")
async def discovery_opportunities(request: DiscoveryRequest):
    theme_terms = {
        "temperature": "land surface air temperature climate trend",
        "water": "precipitation rainfall hydrological variability",
        "atmosphere": "relative humidity atmospheric variability",
    }
    theme = request.theme if request.theme in theme_terms else "temperature"
    region_context = request.region_context.strip() or "any region"
    search_query = f"{theme_terms[theme]} {region_context}"
    records: list[dict[str, Any]] = []
    literature_state = "OpenAlex records retrieved"
    try:
        records = await fetch_openalex_records(search_query)
    except Exception as exc:
        literature_state = f"OpenAlex unavailable for this request ({type(exc).__name__}); no paper claims are displayed."

    matches = [v for v in VARIABLES.values() if (theme == "temperature" and v["family"] == "temperature") or (theme == "water" and v["family"] == "water") or (theme == "atmosphere" and v["family"] == "atmosphere")]
    if not matches:
        matches = list(VARIABLES.values())[:2]
    ideas = []
    for variable in matches[:2]:
        ideas.append({
            "question": f"Has {variable['name'].lower()} changed over time near {region_context}?",
            "why_interesting": variable["why"],
            "candidate_variable": variable["id"],
            "unit": variable["unit"],
            "dataset": DATASET["title"],
            "coverage": "NASA POWER meteorological record documented from 1981; exact returned dates are checked during the live request.",
            "status": "Research idea — not a finding",
        })
    mode = "rules_based"
    ai_summary = None
    base_url = os.getenv("AI_API_BASE_URL")
    api_key = os.getenv("AI_API_KEY")
    model = os.getenv("AI_MODEL")
    if base_url and api_key and model and records:
        try:
            prompt = {
                "model": model,
                "messages": [
                    {"role": "system", "content": "Suggest at most two research questions. Use only the supplied EarthTrace catalogue and retrieved OpenAlex records. Label all suggestions research ideas, never findings. Do not invent citations or causal explanations."},
                    {"role": "user", "content": json.dumps({"region_context": region_context, "theme": theme, "catalogue": [{"id": v["id"], "name": v["name"], "unit": v["unit"], "why": v["why"]} for v in matches], "records": records}, ensure_ascii=False)},
                ],
                "temperature": 0.2,
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                ai_response = await client.post(base_url.rstrip("/") + "/chat/completions", json=prompt, headers={"Authorization": f"Bearer {api_key}"})
                ai_response.raise_for_status()
                ai_summary = ai_response.json().get("choices", [{}])[0].get("message", {}).get("content")
                mode = "ai_assisted"
        except Exception as exc:
            literature_state += f"; configured AI provider unavailable ({type(exc).__name__}), using catalogue matching."
    return {
        "mode": mode,
        "label": "AI-assisted discovery" if mode == "ai_assisted" else "Rules-based discovery — no AI provider configured or available",
        "literature_state": literature_state,
        "ideas": ideas,
        "ai_summary": ai_summary,
        "evidence_records": records,
        "safeguard": "These are research ideas, not findings. A NASA data retrieval and statistical analysis are required to test them.",
        "catalogue_source": NASA_POWER_DOCS,
    }


# ---------------------------------------------------------------------------
# GUIDED LIVE INVESTIGATIONS — templates, explicitly not pre-computed results.
# ---------------------------------------------------------------------------
GUIDED_STUDIES = {
    "aswan-temp": {
        "id": "aswan-temp", "title": "Heat over the drylands", "variable_id": "T2M", "region": {"type": "Point", "lat": 24.0889, "lon": 32.8998, "name": "Aswan, Egypt"},
        "start_date": "2001-01-01", "end_date": "2025-12-01",
        "steps": [
            {"title": "Start with a question", "body": "How has near-surface air temperature changed around Aswan over the selected monthly record?"},
            {"title": "Choose the signal", "body": "T2M is the NASA POWER monthly near-surface air-temperature parameter. It is derived from the MERRA-2 assimilation model, not a local thermometer."},
            {"title": "Set the point and period", "body": "This walkthrough uses a point near Aswan and a 2001–2025 requested interval. The actual dates returned by NASA will be shown in the evidence record."},
            {"title": "Retrieve and quality-check", "body": "EarthTrace requests the monthly point series, screens provider missing values, and reports how many expected months were retained."},
            {"title": "Test the trend", "body": "The analysis reports OLS with HAC uncertainty, seasonal Mann–Kendall, Theil–Sen slope, and a cautious interpretation."},
        ],
    },
    "manaus-rain": {
        "id": "manaus-rain", "title": "Following the rainfall signal", "variable_id": "PRECTOTCORR", "region": {"type": "Point", "lat": -3.1190, "lon": -60.0217, "name": "Manaus, Brazil"},
        "start_date": "2001-01-01", "end_date": "2025-12-01",
        "steps": [
            {"title": "Start with a water question", "body": "Has the monthly mean corrected precipitation rate changed near Manaus over the selected record?"},
            {"title": "Understand the units", "body": "PRECTOTCORR is a rate in mm/day. It is not a monthly accumulated total, so EarthTrace does not sum these monthly values."},
            {"title": "Set the location", "body": "The selected coordinate represents the NASA POWER grid point. It is not a catchment average or a rain-gauge observation."},
            {"title": "Retrieve and quality-check", "body": "EarthTrace retrieves the actual provider response, removes missing values, and reports the real coverage and retrieval timestamp."},
            {"title": "Test the trend", "body": "Compare the slope, 95% uncertainty interval, and seasonal Mann–Kendall test. A non-significant result still displays its estimated direction."},
        ],
    },
}


@app.get("/api/guided-investigations")
async def guided_investigation_list():
    return {"investigations": [{"id": item["id"], "title": item["title"], "variable_id": item["variable_id"], "region": item["region"], "type": "live_run_template", "verified_saved_result": False} for item in GUIDED_STUDIES.values()]}


@app.get("/api/guided-investigations/{study_id}")
async def guided_investigation(study_id: str):
    if study_id not in GUIDED_STUDIES:
        raise HTTPException(404, "Guided investigation not found.")
    item = GUIDED_STUDIES[study_id]
    return {**item, "type": "live_run_template", "verified_saved_result": False, "disclosure": "This is a guided live-run recipe. No precomputed scientific result is claimed."}


# ---------------------------------------------------------------------------
# ANALYSIS JOBS, RESULTS, COMPARISON, LONGER PERIOD, EXPORTS
# ---------------------------------------------------------------------------
@app.post("/api/analysis/jobs")
async def create_analysis_job(request: AnalysisRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    timestamp = utc_now()
    with db_connection() as conn:
        conn.execute(
            "INSERT INTO jobs (job_id,status,stage,progress,message,request_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (job_id, "queued", "queued", None, "Request queued for NASA retrieval.", request.model_dump_json(), timestamp, timestamp),
        )
    if IS_SERVERLESS:
        # Serverless: finish the work before responding, and return the result inline
        # (later requests may land on a different instance that has no /tmp database).
        await run_analysis_job(job_id, request.model_dump(mode="json"))
        job = get_job(job_id) or {}
        return {"job_id": job_id, "status": job.get("status"), "message": job.get("message"),
                "error": job.get("error"), "result_id": job.get("result_id"), "result": job.get("result")}
    background_tasks.add_task(run_analysis_job, job_id, request.model_dump(mode="json"))
    return {"job_id": job_id, "status": "queued", "message": "The request was queued; the result will appear when NASA retrieval and analysis finish."}


@app.get("/api/analysis/jobs/{job_id}")
async def analysis_job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Analysis job not found.")
    return {key: job.get(key) for key in ("job_id", "status", "stage", "progress", "message", "result_id", "error", "created_at", "updated_at")}


@app.get("/api/analysis/results/{result_id}")
async def get_analysis_result(result_id: str):
    with db_connection() as conn:
        row = conn.execute("SELECT result_json FROM jobs WHERE result_id = ? AND status = 'completed'", (result_id,)).fetchone()
    if not row or not row["result_json"]:
        raise HTTPException(404, "Saved result not found. It may not have completed successfully.")
    return json.loads(row["result_json"])


@app.post("/api/analysis/compare")
async def compare_regions(request: CompareRequest):
    settings = request.settings
    if settings.region.lat == request.region_b.lat and settings.region.lon == request.region_b.lon:
        raise HTTPException(400, "Choose two different point coordinates to compare.")
    first_request = settings.model_dump(mode="json")
    second_request = settings.model_copy(update={"region": request.region_b}).model_dump(mode="json")
    try:
        first, second = await asyncio.gather(
            execute_analysis(first_request),
            execute_analysis(second_request),
        )
    except Exception as exc:
        raise HTTPException(502, f"Comparison could not be completed from NASA POWER: {exc}")
    store_completed_result(first, first_request, "Completed as Region A in a two-point comparison.")
    store_completed_result(second, second_request, "Completed as Region B in a two-point comparison.")
    a, b = first["trend"], second["trend"]
    difference = a["slope_per_year"] - b["slope_per_year"]
    combined_se = math.sqrt(a["standard_error_hac"] ** 2 + b["standard_error_hac"] ** 2)
    if combined_se > 0:
        z = difference / combined_se
        p_diff = float(2 * norm.sf(abs(z)))
        ci_diff = [difference - 1.96 * combined_se, difference + 1.96 * combined_se]
    else:
        z, p_diff, ci_diff = 0.0, 1.0, [difference, difference]
    return {
        "region_a": first,
        "region_b": second,
        "slope_difference_test": {
            "description": "Independent-slope Wald comparison using the two HAC standard errors; interpret cautiously because spatial dependence is not modelled.",
            "difference_per_year": difference,
            "confidence_interval_95": ci_diff,
            "z_statistic": z,
            "p_value": p_diff,
            "statistically_different_at_0_05": p_diff < 0.05,
        },
        "interpretation": "A direct difference-in-slopes test is provided. The difference is not inferred merely from comparing the two individual p-values.",
        "created_at": utc_now(),
    }


@app.get("/api/catalog/scan-points")
async def scan_points():
    return {"points": SCAN_POINTS, "note": "Sample places chosen to span Earth's biomes; they are not a global average."}


@app.post("/api/analysis/scan-batch")
async def scan_batch(request: ScanBatchRequest):
    unknown = [pid for pid in request.point_ids if pid not in SCAN_LOOKUP]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown scan point(s): {', '.join(unknown)}")
    gate = asyncio.Semaphore(3)  # polite to NASA POWER, which rate-limits bursts
    results = await asyncio.gather(*(scan_one_point(request, SCAN_LOOKUP[pid], gate) for pid in request.point_ids))
    return {"variable_id": request.variable_id, "start_year": request.start_year, "end_year": request.end_year, "results": list(results)}


@app.post("/api/analysis/extend")
async def extend_analysis(request: ExtendRequest):
    original = None
    with db_connection() as conn:
        row = conn.execute("SELECT request_json, result_json FROM jobs WHERE result_id = ? AND status='completed'", (request.result_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Original analysis result was not found.")
    original_request = json.loads(row["request_json"])
    original_result = json.loads(row["result_json"])
    start_year = request.start_year if request.start_year is not None else 1981
    end_year = request.end_year if request.end_year is not None else datetime.now(timezone.utc).year - 1
    if end_year <= start_year:
        raise HTTPException(400, "Extended end year must be after the start year.")
    original_request["start_date"] = f"{start_year}-01-01"
    original_request["end_date"] = f"{end_year}-12-01"
    try:
        extended = await execute_analysis(original_request)
    except Exception as exc:
        raise HTTPException(502, f"The extended NASA request failed: {exc}")
    store_completed_result(extended, original_request, "Completed as an extended-period follow-up analysis.")
    a, b = original_result["trend"], extended["trend"]
    return {
        "original": original_result,
        "extended": extended,
        "comparison": {
            "original_slope_per_year": a["slope_per_year"],
            "extended_slope_per_year": b["slope_per_year"],
            "original_p_value": a["p_value"],
            "extended_p_value": b["p_value"],
            "original_period": original_result["period"],
            "extended_period": extended["period"],
            "note": "The longer period may change the estimate and evidence. It does not guarantee significance; the original result is preserved.",
        },
    }


@app.get("/api/analysis/results/{result_id}/export.csv")
async def export_csv(result_id: str):
    result = await get_analysis_result(result_id)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["date", "value", "anomaly", "unit", "variable_id", "region", "latitude", "longitude"])
    region = result["region"]
    for row in result["series"]:
        writer.writerow([row["date"], row["value"], row["anomaly"], result["variable"]["unit"], result["variable"]["id"], region["name"], region["latitude"], region["longitude"]])
    filename = f"earthtrace-{result_id[:8]}.csv"
    return Response(output.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/api/analysis/results/{result_id}/export.json")
async def export_json(result_id: str):
    result = await get_analysis_result(result_id)
    return Response(json.dumps(result, ensure_ascii=False, indent=2), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="earthtrace-{result_id[:8]}.json"'})


# ---------------------------------------------------------------------------
# SAVED INVESTIGATIONS — local SQLite; no user accounts.
# ---------------------------------------------------------------------------
@app.post("/api/investigations")
async def save_investigation(request: SaveInvestigationRequest):
    investigation_id = str(uuid.uuid4())
    created = utc_now()
    with db_connection() as conn:
        conn.execute("INSERT INTO investigations (investigation_id,title,payload_json,created_at) VALUES (?,?,?,?)", (investigation_id, request.title, json.dumps(request.payload, ensure_ascii=False), created))
    return {"investigation_id": investigation_id, "title": request.title, "created_at": created}


@app.get("/api/investigations")
async def list_investigations():
    with db_connection() as conn:
        rows = conn.execute("SELECT investigation_id,title,created_at FROM investigations ORDER BY created_at DESC LIMIT 50").fetchall()
    return {"investigations": [dict(row) for row in rows]}


@app.get("/api/investigations/{investigation_id}")
async def get_investigation(investigation_id: str):
    with db_connection() as conn:
        row = conn.execute("SELECT * FROM investigations WHERE investigation_id=?", (investigation_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Saved investigation not found.")
    return {"investigation_id": row["investigation_id"], "title": row["title"], "payload": json.loads(row["payload_json"]), "created_at": row["created_at"]}


# ---------------------------------------------------------------------------
# CUAHSI COMPANION — external discovery links only in this MVP.
# ---------------------------------------------------------------------------
@app.post("/api/cuahsi/search")
async def cuahsi_search(payload: dict[str, Any]):
    region = payload.get("region") or {}
    lat = region.get("lat")
    lon = region.get("lon")
    return {
        "provider": "CUAHSI HydroClient",
        "direct_series_search_enabled": False,
        "message": "Direct HIS Central SOAP discovery and WaterOneFlow series retrieval have not been validated in this build. Use HydroClient for live station discovery.",
        "selected_point": {"latitude": lat, "longitude": lon},
        "links": [
            {"title": "CUAHSI HydroClient", "url": "https://data.cuahsi.org/"},
            {"title": "CUAHSI Data Series Viewer", "url": "https://apps.hydroshare.org/apps/timeseries-viewer/"},
            {"title": "HIS Central Web Services", "url": "https://hiscentral.cuahsi.org/webservices/hiscentral.asmx"},
        ],
        "scientific_separation": "CUAHSI field/station observations must remain separate from NASA POWER gridded model-derived values.",
    }


@app.get("/api/team")
async def team_cards():
    return {"members": [], "message": "Team members must provide and approve their own names, roles, photos and public contact details."}


# ---------------------------------------------------------------------------
# Error handling and local developer health.
# ---------------------------------------------------------------------------
@app.get("/api")
async def api_index():
    return {"name": "EarthTrace API", "version": APP_VERSION, "docs": "/docs", "health": "/api/health"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
