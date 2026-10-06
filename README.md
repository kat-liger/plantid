# Plant ID Practice

A small static website for drilling plant identification: photos of each
plant's parts on the left, two inputs on the right (botanical name and common
name). A green check appears when a name is right, **Show Name** reveals it,
and **Previous / Next** step through the list.

## Use it

Open `index.html` in a browser. No server or build step needed.

- Names are checked as you type. Capitalization, quotes, accents and the `×`
  in hybrid names don't matter (`nepeta x faassenii walkers low` is fine).
- `Heuchera`, `Heuchera sp.` and `Heuchera species` are all accepted for
  "sp." entries. Common synonyms are accepted too (see `plants.json`).
- For cultivars, typing just the species shows an "add the cultivar" hint.
- **Enter** moves to the next field, or to the next plant once both are right.
  Arrow keys move between plants when no input is focused.
- Click a photo to enlarge it. Progress is saved in the browser; **Reset** clears it.

## Edit the plant list

`plants.json` is the source of truth. Each entry has the names, accepted
alternates, and the Wikimedia Commons search terms used to find photos.
After editing it, regenerate `data.js`:

```sh
python3 scripts/fetch_images.py              # fetch missing plants only
python3 scripts/fetch_images.py --only acer-palmatum --force   # refetch one
python3 scripts/fetch_images.py --dry-run    # preview picks, no downloads
python3 scripts/fetch_images.py --optimise   # re-encode images as small JPEGs
```

Commons' search API throttles anonymous clients hard (HTTP 429), so a full
run takes a while; the script waits and retries automatically. Downloaded
photos are resized to 1000 px and re-encoded as JPEG to keep the repo small.

To pin a specific Commons photo for a plant part, add it under
`search.files` in `plants.json`:

```json
"files": [{"part": "Flowers", "title": "Acer palmatum flowers 001.JPG"}]
```

## Photo credits

All photos come from [Wikimedia Commons](https://commons.wikimedia.org) and
are used under their individual licenses. The author, license and a link to
the source page are shown under every photo and stored in
`images/manifest.json`.
