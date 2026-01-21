from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path

import pandas as pd


def extract_year(date_str: str) -> str | None:
    if not date_str or not isinstance(date_str, str):
        return None

    date_str = date_str.strip().lower()

    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y"):
        try:
            dt = datetime.strptime(date_str, fmt)
            return str(dt.year)
        except ValueError:
            pass

    m = re.search(r"\b(18|19|20)\d{2}\b", date_str)
    if m:
        return m.group(0)

    m = re.search(r"\b(18|19|20)\d{2}[-–](18|19|20)\d{2}\b", date_str)
    if m:
        return m.group(1)

    m = re.match(r"^(18|19|20)\d{6}$", date_str)
    if m:
        return date_str[:4]

    m = re.match(r"^(18|19|20)\d{2}\.0$", date_str)
    if m:
        return date_str.split(".")[0]

    m = re.search(r"(18|19|20)\d{2}", date_str)
    if m:
        return m.group(0)

    return None


_SERIES_CODE_RE = re.compile(r"\b(K\s*\d\s*[A-Z]{1,2})\b")
_FILENAME_RE = re.compile(r"^(K[123][A-Z]{1,2})_(\d{1,8})$", re.IGNORECASE)


def _normalise_sheet_code(sheet_name: str) -> str | None:
    if not sheet_name:
        return None

    m = _SERIES_CODE_RE.search(sheet_name)
    if not m:
        return None

    code = re.sub(r"\s+", "", m.group(1)).upper()
    if not re.fullmatch(r"K\d[A-Z]{1,2}", code):
        return None

    return code


def _detect_header_row(xlsx_path: Path, sheet: str) -> int | None:
    try:
        head = pd.read_excel(xlsx_path, sheet_name=sheet, header=None, nrows=30)
    except Exception:
        logging.exception("Failed to read header rows from %s (%s)", xlsx_path, sheet)
        return None

    for i in range(int(head.shape[0])):
        for j in range(int(head.shape[1])):
            val = head.iat[i, j]
            if isinstance(val, str) and val.strip() == "Nr":
                return i

    return None


def _pick_description(row: pd.Series) -> str | None:
    for key in (
        "Beskrivning",
        "Beskrivning, fotografen",
        "Beskrivning, Lena Carlsson",
        "Beskrivning, RA",
    ):
        if key in row:
            val = row[key]
            if isinstance(val, str) and val.strip():
                return val.strip()
    return None


def _extract_keywords(row: pd.Series, columns: list[str]) -> list[str]:
    start_idx = None
    for i, c in enumerate(columns):
        if c.strip() == "Sv Ämnesord":
            start_idx = i
            break

    if start_idx is None and len(columns) > 12:
        start_idx = 12

    if start_idx is None:
        return []

    keywords: list[str] = []
    for c in columns[start_idx:]:
        if c not in row:
            continue
        val = row[c]
        if isinstance(val, str) and val.strip():
            keywords.append(val.strip())

    # Keep stable order, remove duplicates
    seen = set()
    out: list[str] = []
    for kw in keywords:
        if kw in seen:
            continue
        seen.add(kw)
        out.append(kw)
    return out


def _photographer_id(series_code: str) -> str:
    series_code = (series_code or "").upper()
    if series_code.startswith("K1"):
        return "2"
    if series_code.startswith("K2"):
        return "3"
    if series_code.startswith("K3"):
        return "4"
    return ""


@dataclass(frozen=True)
class LegacyXlsxMetadataIndex:
    by_series: dict[str, dict[int, dict]]

    def for_filename(self, filename: str) -> dict:
        stem = Path(filename).stem
        m = _FILENAME_RE.match(stem)
        if not m:
            return {}

        series = m.group(1).upper()
        raw_digits = m.group(2)
        digits = raw_digits.lstrip("0") or "0"
        if not digits.isdigit():
            return {}
        nr = int(digits)

        base = {"photographer": _photographer_id(series)}
        row_meta = self.by_series.get(series, {}).get(nr)
        if not row_meta:
            return base if base["photographer"] else {}

        merged = dict(base)
        merged.update(row_meta)
        return merged


@lru_cache(maxsize=8)
def _build_index_cached(xlsx_path_str: str, mtime_ns: int, size: int) -> LegacyXlsxMetadataIndex:
    xlsx_path = Path(xlsx_path_str)

    by_series: dict[str, dict[int, dict]] = {}

    try:
        xl = pd.ExcelFile(xlsx_path)
    except Exception:
        logging.exception("Failed to open metadata workbook %s", xlsx_path)
        return LegacyXlsxMetadataIndex(by_series={})

    for sheet in xl.sheet_names:
        series_code = _normalise_sheet_code(sheet)
        if not series_code:
            continue

        header_row = _detect_header_row(xlsx_path, sheet)
        if header_row is None:
            continue

        try:
            df = pd.read_excel(xlsx_path, sheet_name=sheet, header=header_row)
        except Exception:
            logging.exception("Failed to read metadata sheet %s from %s", sheet, xlsx_path)
            continue

        df = df.fillna("")
        cols = [str(c).strip() for c in df.columns]
        df.columns = cols

        nr_col = next((c for c in cols if c.strip().lower() == "nr"), None)
        if not nr_col:
            continue

        df[nr_col] = pd.to_numeric(df[nr_col], errors="coerce")
        df = df[df[nr_col].notna()]

        mapping: dict[int, dict] = {}
        for _, row in df.iterrows():
            try:
                nr = int(row[nr_col])
            except Exception:
                continue

            date_val = row.get("Datering") if "Datering" in row else None
            date_str = str(date_val).strip() if date_val not in (None, "") else ""
            year = extract_year(date_str) if date_str else None

            description = _pick_description(row)
            keywords = _extract_keywords(row, cols)

            meta: dict = {}
            if keywords:
                meta["keywords"] = keywords
            if date_str:
                meta["date"] = date_str
            if year:
                meta["year"] = year
            if description:
                meta["description"] = description

            mapping[nr] = meta

        if mapping:
            by_series[series_code] = mapping

    logging.info(
        "Loaded legacy metadata.xlsx (%s series, %s bytes)",
        len(by_series),
        size,
    )
    return LegacyXlsxMetadataIndex(by_series=by_series)


def load_legacy_xlsx_index(xlsx_path: Path) -> LegacyXlsxMetadataIndex:
    st = xlsx_path.stat()
    return _build_index_cached(str(xlsx_path), int(st.st_mtime_ns), int(st.st_size))
