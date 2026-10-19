"""Add vocabulary display metadata at the HTTP boundary, after analysis/cache use."""
from __future__ import annotations

from flask import Blueprint, Response, current_app, request

from api import sao_terms

_vocabulary_source = None
_by_id: dict[str, dict] = {}
_by_label: dict[str, dict | None] = {}

_CLUSTER_LABELS = dict(zip(
    ("portraits", "people indoors", "people outdoors", "groups of people", "children",
     "buildings", "city streets", "interiors", "landscapes", "nature scenes",
     "water views", "vehicles", "objects", "documents", "artworks", "text and signs",
     "black and white photos", "color photos", "close-up details", "wide scenes"),
    ("porträtt", "människor inomhus", "människor utomhus", "grupper av människor", "barn",
     "byggnader", "stadsgator", "interiörer", "landskap", "naturmotiv",
     "vattenvyer", "fordon", "föremål", "dokument", "konstverk", "text och skyltar",
     "svartvita fotografier", "färgfotografier", "närbilder", "översiktsbilder"),
    strict=True,
))

_REASON_CODES = {
    "Projection points were not supplied": "missing_projection",
    "Too few images to fit a stable concept axis": "too_few_images",
    "The projection or concept scores have insufficient variation": "insufficient_variation",
    "The image cloud has no full-dimensional boundary": "degenerate_boundary",
}


def vocabulary_indexes() -> tuple[dict[str, dict], dict[str, dict | None]]:
    global _vocabulary_source, _by_id, _by_label
    terms, _ = sao_terms.get_terms()
    if terms is not _vocabulary_source:
        by_id = {}
        by_label: dict[str, dict | None] = {}
        for term in terms:
            by_id[str(term["id"])] = term
            for label in {term["label"], term.get("embedding_label", "")}:
                if not label:
                    continue
                key = sao_terms.normalize_label(label)
                if key in by_label and by_label[key] is not term:
                    by_label[key] = None
                else:
                    by_label[key] = term
        _vocabulary_source, _by_id, _by_label = terms, by_id, by_label
    return _by_id, _by_label


def add_display_labels(value: object, by_id: dict[str, dict], by_label: dict[str, dict | None]) -> object:
    """Return a presentation copy; never change canonical labels or cached objects."""
    if isinstance(value, list):
        if not value or isinstance(value[0], (str, int, float, bool)):
            return value
        return [add_display_labels(item, by_id, by_label) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: add_display_labels(item, by_id, by_label) for key, item in value.items()}
    if isinstance(value.get("reason"), str) and value["reason"] in _REASON_CODES:
        result["reason_code"] = _REASON_CODES[value["reason"]]
    label = value.get("label")
    if isinstance(label, str):
        term = by_id.get(str(value.get("concept_id", "")))
        if term is None and isinstance(value.get("id"), str):
            candidate = by_id.get(value["id"])
            if candidate and candidate["label"] == label:
                term = candidate
        if term is None:
            term = by_label.get(sao_terms.normalize_label(label))
        if term and term.get("embedding_label"):
            result["labels"] = {"sv": term["label"], "en": term["embedding_label"]}
        elif "centroid_position" in value and label in _CLUSTER_LABELS:
            result["labels"] = {"sv": _CLUSTER_LABELS[label], "en": label}
        elif sao_terms.normalize_label(label) in by_label:
            # A label shared by several concepts cannot identify a stored tag.
            result["labels"] = None
    return result


def register_display_labels(blueprint: Blueprint, endpoints: set[str] | None = None) -> None:
    @blueprint.after_request
    def present_response(response: Response) -> Response:
        if response.is_json and response.status_code >= 400:
            payload = response.get_json()
            if isinstance(payload, dict) and "error" in payload:
                payload.setdefault("error_code", {
                    400: "invalid_request", 404: "not_found", 409: "conflict",
                }.get(response.status_code, "request_failed"))
                response.set_data(current_app.json.dumps(payload))
            return response
        if response.is_json and response.status_code < 400:
            if endpoints is not None and (request.endpoint or "").rsplit(".", 1)[-1] not in endpoints:
                return response
            try:
                by_id, by_label = vocabulary_indexes()
            except (FileNotFoundError, ValueError):
                # Dataset administration and custom tags work without a vocabulary.
                by_id, by_label = {}, {}
            response.set_data(current_app.json.dumps(
                add_display_labels(response.get_json(), by_id, by_label)
            ))
        return response
