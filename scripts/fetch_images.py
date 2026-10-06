#!/usr/bin/env python3
"""Fetch freely licensed plant photos from Wikimedia Commons.

Reads plants.json, searches Commons for each plant part (leaves, flowers,
bark, ...), downloads a resized copy into images/<plant-id>/, and writes
images/manifest.json plus data.js (plants + images in one file so the site
works when index.html is opened straight from disk).

Usage:
    python3 scripts/fetch_images.py              # fetch anything missing
    python3 scripts/fetch_images.py --only id1,id2 --force
    python3 scripts/fetch_images.py --dry-run    # show picks, download nothing
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote

import requests

try:
    from PIL import Image
except ImportError:  # optimisation is optional
    Image = None

ROOT = Path(__file__).resolve().parent.parent
PLANTS_FILE = ROOT / "plants.json"
IMAGES_DIR = ROOT / "images"
MANIFEST_FILE = IMAGES_DIR / "manifest.json"
DATA_JS = ROOT / "data.js"

API = "https://commons.wikimedia.org/w/api.php"
HEADERS = {"User-Agent": "plantid-study-site/1.0 (personal plant ID flashcards; python-requests)"}
THUMB_WIDTH = 1000
MIN_WIDTH = 500
MIN_IMAGES = 4
DELAY = 1.0  # seconds between API calls

BAD_TITLE_WORDS = [
    "herbarium", "illustration", "illustr", " map", "map ", "distribution", "drawing",
    "specimen", "tafel", "plate", "sketch", "painting", "label", "sign", "packet",
    "bonsai", "microscop", "pollen", "diagram", "chart", "scan", "stamp", "coin",
    "logo", "stained", "cross section", "cross-section", "seedling tray", "nursery tag",
    "book", "page", "poster", "wood sample", "lumber", "timber", "furniture", "jar",
    "oil", "tea", "food", "dish", "recipe", "extract", "cosmetic",
]

session = requests.Session()
session.headers.update(HEADERS)


def strip_html(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    return re.sub(r"\s+", " ", s).strip()


def title_ok(title):
    t = title.lower()
    return not any(w in t for w in BAD_TITLE_WORDS)


def api_get(params):
    """GET with retry/backoff; Commons rate-limits anonymous bursts."""
    for attempt in range(6):
        r = session.get(API, params=params, timeout=30)
        if r.status_code == 429 or r.status_code >= 500:
            wait = int(r.headers.get("Retry-After") or 5 * (attempt + 1))
            print(f"    rate limited ({r.status_code}), waiting {wait}s")
            time.sleep(wait)
            continue
        r.raise_for_status()
        time.sleep(DELAY)
        return r.json()
    r.raise_for_status()
    return {}


def search(query, limit=20):
    """Cheap search: urls and sizes only. License metadata is fetched later
    for the one file we pick (extmetadata for every hit is what gets throttled)."""
    params = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrsearch": query,
        "gsrnamespace": 6,
        "gsrlimit": limit,
        "prop": "imageinfo",
        "iiprop": "url|mime|size",
    }
    try:
        pages = api_get(params).get("query", {}).get("pages", {})
    except requests.HTTPError as e:
        print(f"    search failed, skipping: {e}")
        return []
    # Keep Commons' relevance order.
    return sorted(pages.values(), key=lambda p: p.get("index", 0))


def file_info(title):
    params = {
        "action": "query",
        "format": "json",
        "titles": title if title.startswith("File:") else "File:" + title,
        "prop": "imageinfo",
        "iiprop": "url|user|extmetadata|mime|size",
        "iiextmetadatafilter": "Artist|Attribution|LicenseShortName|LicenseUrl|Credit",
    }
    pages = list(api_get(params).get("query", {}).get("pages", {}).values())
    return pages[0] if pages and "imageinfo" in pages[0] else None


def acceptable(page, used):
    if page.get("pageid") in used:
        return False
    info = (page.get("imageinfo") or [None])[0]
    if not info:
        return False
    if info.get("mime") not in ("image/jpeg", "image/png"):
        return False
    w, h = info.get("width", 0), info.get("height", 0)
    if w < MIN_WIDTH or h < MIN_WIDTH:
        return False
    ratio = max(w, h) / max(1, min(w, h))
    if ratio > 2.6:
        return False
    return title_ok(page["title"])


def entry_from_page(page, part):
    if "extmetadata" not in (page.get("imageinfo") or [{}])[0]:
        full = file_info(page["title"])
        if full:
            page = full
    info = page["imageinfo"][0]
    meta = info.get("extmetadata", {})
    return {
        "part": part,
        "title": page["title"].replace("File:", "", 1),
        "pageUrl": info.get("descriptionurl"),
        # Resized copy via Special:Redirect; rendering thumbnails for every
        # search hit through iiurlwidth trips Commons' rate limit.
        "thumbUrl": "https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/"
        + quote(page["title"].replace("File:", "", 1)) + f"&width={THUMB_WIDTH}",
        "author": strip_html(meta.get("Artist", {}).get("value", ""))
        or strip_html(meta.get("Attribution", {}).get("value", ""))
        or info.get("user")
        or "Unknown",
        "license": strip_html(meta.get("LicenseShortName", {}).get("value", "")) or "See source",
        "licenseUrl": strip_html(meta.get("LicenseUrl", {}).get("value", "")),
    }


def score(page, idx, name, suffix):
    """Higher is better. Title mentions are far more reliable than description hits."""
    t = page["title"].lower()
    words = name.lower().replace("'", "").replace("×", "").split()
    genus = words[0]
    sc = 0.0
    if genus in t:
        sc += 10
    if len(words) > 1 and all(w in t for w in words[1:]):
        sc += 5
    stem = suffix.lower().rstrip("s")
    if stem in t:
        sc += 3
    info = (page.get("imageinfo") or [{}])[0]
    if info.get("width", 0) >= 1200:
        sc += 1
    return sc - idx * 0.05


def best_match(results, used, name, suffix):
    ranked = sorted(
        ((score(p, i, name, suffix), p) for i, p in enumerate(results) if acceptable(p, used)),
        key=lambda x: -x[0],
    )
    if not ranked:
        return None
    sc, page = ranked[0]
    return page if sc >= 10 else None  # require the genus in the title


def pick_images(plant, log):
    names = plant["search"]["names"]
    parts = plant["search"]["parts"]
    picks, used = [], set()

    # Hand-picked Commons files take priority.
    for fixed in plant["search"].get("files", []):
        page = file_info(fixed["title"])
        if page and "imageinfo" in page:
            used.add(page.get("pageid"))
            picks.append(entry_from_page(page, fixed["part"]))
            log(f"  [{fixed['part']}] pinned {page['title']}")
        else:
            log(f"  [{fixed['part']}] pinned file not found: {fixed['title']}")

    pinned_parts = {p["part"] for p in picks}
    for part, suffix in parts.items():
        if part in pinned_parts:
            continue
        found = None
        for name in names:
            found = best_match(search(f'"{name}" {suffix} filetype:bitmap'), used, name, suffix)
            if found:
                break
        if found:
            used.add(found["pageid"])
            picks.append(entry_from_page(found, part))
            log(f"  [{part}] {found['title']}")
        else:
            log(f"  [{part}] nothing found")

    # Top up with general results if we are short.
    if len(picks) < MIN_IMAGES:
        for name in names:
            results = search(f'"{name}" filetype:bitmap', limit=40)
            while len(picks) < MIN_IMAGES:
                page = best_match(results, used, name, "")
                if not page:
                    break
                used.add(page["pageid"])
                picks.append(entry_from_page(page, "Plant"))
                log(f"  [Plant] {page['title']}")
            if len(picks) >= MIN_IMAGES:
                break
    return picks


def download(url, dest):
    r = session.get(url, timeout=60)
    r.raise_for_status()
    dest.write_bytes(r.content)
    optimise(dest)


def optimise(path, max_px=THUMB_WIDTH, quality=82):
    """Re-encode as a bounded-size JPEG so the repo stays small."""
    if Image is None:
        return
    try:
        with Image.open(path) as im:
            im = im.convert("RGB")
            im.thumbnail((max_px, max_px))
            im.save(path, "JPEG", quality=quality, optimize=True, progressive=True)
    except Exception as e:  # noqa: BLE001
        print(f"  could not optimise {path.name}: {e}")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def write_data_js(plants, manifest):
    payload = {"plants": plants, "images": manifest}
    DATA_JS.write_text(
        "// Generated by scripts/fetch_images.py from plants.json and images/manifest.json.\n"
        "// Do not edit by hand.\n"
        "window.PLANT_DATA = " + json.dumps(payload, indent=1, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated plant ids to (re)fetch")
    ap.add_argument("--force", action="store_true", help="refetch even if images exist")
    ap.add_argument("--dry-run", action="store_true", help="search only, download nothing")
    ap.add_argument("--optimise", action="store_true", help="re-encode already downloaded images and exit")
    args = ap.parse_args()

    if args.optimise:
        files = sorted(IMAGES_DIR.glob("*/*"))
        for f in files:
            optimise(f)
        print(f"optimised {len(files)} images")
        return

    plants = json.loads(PLANTS_FILE.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8")) if MANIFEST_FILE.exists() else {}
    only = set(args.only.split(",")) if args.only else None

    for plant in plants:
        pid = plant["id"]
        if only and pid not in only:
            continue
        have = manifest.get(pid, [])
        if have and not args.force and all((IMAGES_DIR / e["file"]).exists() for e in have):
            print(f"{pid}: {len(have)} images already present, skipping")
            continue
        print(f"{pid}: {plant['botanical']}")
        picks = pick_images(plant, lambda m: print(m))
        if args.dry_run:
            continue
        plant_dir = IMAGES_DIR / pid
        plant_dir.mkdir(parents=True, exist_ok=True)
        for old in plant_dir.glob("*"):
            old.unlink()
        entries = []
        for i, pick in enumerate(picks, 1):
            ext = ".jpg"  # everything is re-encoded as JPEG by optimise()
            fname = f"{i:02d}-{slug(pick['part'])}{ext}"
            try:
                download(pick["thumbUrl"], plant_dir / fname)
            except Exception as e:  # noqa: BLE001
                print(f"  download failed for {pick['title']}: {e}")
                continue
            pick = dict(pick)
            pick.pop("thumbUrl", None)
            pick["file"] = f"{pid}/{fname}"
            entries.append(pick)
            time.sleep(0.3)
        manifest[pid] = entries
        MANIFEST_FILE.write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8")

    if not args.dry_run:
        write_data_js(plants, manifest)
        total = sum(len(v) for v in manifest.values())
        print(f"\nWrote {MANIFEST_FILE.relative_to(ROOT)} and {DATA_JS.name}: {total} images for {len(manifest)} plants")


if __name__ == "__main__":
    sys.exit(main())
