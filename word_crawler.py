import csv
import time
import requests
from urllib.parse import urljoin

BASE = "https://id.kb.se"

START_URL = (
    "https://id.kb.se/find.jsonld"
    "?q=*"
    "&_limit=200"
    "&_sort=_sortKeyByLang.sv"
    "&inScheme.@id=https://id.kb.se/term/sao"
)

SLEEP = 0.25


def fetch(url: str):
    print(f"\n[INFO] GET {url}")
    r = requests.get(url, headers={"Accept": "application/ld+json"}, timeout=60)
    print(f"[INFO] Status {r.status_code}")

    if r.status_code != 200:
        print("[ERROR] Response (first 1000 chars):")
        print(r.text[:1000])
        r.raise_for_status()

    return r.json()


def extract_terms(data):
    items = data.get("items", [])
    print(f"[DEBUG] items count: {len(items)}")

    results = []

    for item in items:
        uri = item.get("@id")

        # ---- controlNumber ----
        control_number = None
        meta = item.get("meta")
        if isinstance(meta, dict):
            control_number = meta.get("controlNumber")

        # ---- prefLabel (sv) ----
        label = item.get("prefLabel")
        if isinstance(label, dict):
            label = label.get("sv")

        # ---- scopeNote ----
        scope_note = item.get("scopeNote")
        if isinstance(scope_note, list):
            scope_note = " | ".join(scope_note)
        elif not isinstance(scope_note, str):
            scope_note = ""

        if not uri:
            print("[DEBUG] Skipping item without @id")
            continue

        if not label:
            print(f"[DEBUG] Skipping {uri} (no sv prefLabel)")
            continue

        results.append((
            control_number,
            label,
            scope_note
        ))

    return results


def main():
    url = START_URL
    seen = set()
    all_terms = []

    print("=== Hämtar Svenska ämnesord (SAO) ===")

    while url:
        data = fetch(url)
        terms = extract_terms(data)

        for control_number, label, scope_note in terms:
            key = (control_number, label)
            if key not in seen:
                seen.add(key)
                all_terms.append((control_number, label, scope_note))

        print(f"[INFO] Totalt insamlade termer: {len(all_terms)}")

        next_page = data.get("next", {}).get("@id")
        if next_page:
            url = urljoin(BASE, next_page)
            time.sleep(SLEEP)
        else:
            url = None

    print(f"\n=== KLAR ===")
    print(f"Totalt antal SAO-termer: {len(all_terms)}")

    if not all_terms:
        print("[ERROR] Inga termer hämtades")
        return

    with open("sao_terms.csv", "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "controlNumber",
            "prefLabel",
            "scopeNote"
        ])
        writer.writerows(all_terms)

    print("Sparade sao_terms.csv")


if __name__ == "__main__":
    main()
