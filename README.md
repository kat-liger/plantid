# Plant ID Practice

A small static website for drilling plant identification: photos of each
plant's parts on the left, two inputs on the right (botanical name and common
name). A green check appears when a name is right, **Show Name** reveals it,
and **Previous / Next** step through the list.

## Use it

Open `index.html` in a browser, or use the hosted copy at
https://kat-liger.github.io/plantid/. No server or build step needed.

- Pick a plant list from the dropdown at the top. The newest list is shown
  by default; "All lists" combines them.
- Names are checked as you type. Capitalization, quotes, accents and the `×`
  in hybrid names don't matter (`nepeta x faassenii walkers low` is fine).
- `Heuchera`, `Heuchera sp.` and `Heuchera species` are all accepted for
  "sp." entries. Common synonyms are accepted too (see `plants.json`).
- For cultivars, typing just the species shows an "add the cultivar" hint.
- **Enter** moves to the next field, or to the next plant once both are right.
  Arrow keys move between plants when no input is focused.
- Click a photo to enlarge it.
- To open a specific plant, add its id from `plants.json` to the URL, e.g.
  `index.html#scabiosa-columbaria`.
- The fields are empty every time you arrive at a plant, and nothing you type
  is saved. The "learned" count tracks plants you named correctly in the
  current session; **Reset** clears it, and reloading the page clears it too.

## Edit the plant lists

`plants.json` is the source of truth. Each entry has the names, accepted
alternates, a `list` name (the dropdown groups plants by it), an optional
`family` (shown once the name is known), and the Wikimedia Commons search
terms used to find photos. An entry with `"skip": true` is kept in the file
but hidden from the quiz (used for the "skip this week" plants). List names
follow the class handouts: "Lists 1–2", "List 3", "List 4". After editing,
regenerate `data.js`:

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
