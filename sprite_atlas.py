#!/usr/bin/env python3
"""
Generate one or more sprite-atlas PNGs + a master JSON map.

Examples
--------
# 4 equally-sized sheets called atlas_0.png … atlas_3.png
python make_atlases.py --sheets 4

# default (=1 sheet, identical to your old behaviour)
python make_atlases.py
"""
from pathlib import Path
from PIL import Image
import json
import argparse
from math import ceil, sqrt

# ---------- Config ----------
IMAGE_ROOT   = Path("out")          # folder that holds all source images
OUTPUT_BASENAME = "atlas"          # atlas_0.png, atlas_1.png, ...
SPRITE_SIZE = 64                    # resize every image to this size
PADDING     = 1                     # pixels between sprites
IMAGE_TYPES = {".jpg", ".jpeg", ".png"}
NUM_SHEETS  = 8

# ---------- Gather images ----------
image_paths = sorted(
    [p for p in IMAGE_ROOT.rglob("*") if p.suffix.lower() in IMAGE_TYPES]
)
num_images = len(image_paths)
if num_images == 0:
    raise SystemExit(f"No images found in {IMAGE_ROOT!s}")

# how many sprites we try to fit into each sheet
IMAGES_PER_SHEET = ceil(num_images / NUM_SHEETS)

master_json = {}           # merged -> image-id → dict with 'sheet', 'x', ...
global_idx  = 0            # running index across all sheets

for sheet_idx in range(NUM_SHEETS):
    # slice the images that go into this atlas
    start = sheet_idx * IMAGES_PER_SHEET
    end   = min(start + IMAGES_PER_SHEET, num_images)
    batch = image_paths[start:end]
    if not batch:          # might happen if num_images < NUM_SHEETS
        continue

    sheet_count = len(batch)
    atlas_cols  = ceil(sqrt(sheet_count))
    atlas_rows  = ceil(sheet_count / atlas_cols)

    atlas_w = atlas_cols * (SPRITE_SIZE + PADDING)
    atlas_h = atlas_rows * (SPRITE_SIZE + PADDING)
    atlas_im = Image.new("RGBA", (atlas_w, atlas_h), (0, 0, 0, 0))

    # --- fill current sheet ---
    for local_idx, path in enumerate(batch):
        img = Image.open(path).convert("RGBA").resize((SPRITE_SIZE, SPRITE_SIZE))

        col = local_idx % atlas_cols
        row = local_idx // atlas_cols
        x = col * (SPRITE_SIZE + PADDING)
        y = row * (SPRITE_SIZE + PADDING)

        atlas_im.paste(img, (x, y))

        image_id = str(global_idx)              # or use path.stem
        master_json[image_id] = {
            "sheet"   : sheet_idx,              # which atlas file
            "x"       : x,
            "y"       : y,
            "width"   : SPRITE_SIZE,
            "height"  : SPRITE_SIZE,
            "filename": str(path.relative_to(IMAGE_ROOT))
        }
        global_idx += 1

    # save this sheet
    atlas_png  = f"{OUTPUT_BASENAME}_{sheet_idx}.png"
    atlas_im.save(atlas_png)
    print(f"✅  Saved {atlas_png} with {sheet_count} sprites")

# ---------- write master map ----------
json_name = f"{OUTPUT_BASENAME}.json"
with open(json_name, "w") as fp:
    json.dump(master_json, fp, indent=2)
print(f"🎉  Wrote master JSON → {json_name} (maps {num_images} images across {NUM_SHEETS} atlases)")
