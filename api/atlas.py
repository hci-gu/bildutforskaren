from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
from PIL import Image

from api import config
from api.models import DatasetConfig


def ensure_atlas(cfg: DatasetConfig, image_paths: list[Path]) -> dict:
    cfg.atlas_dir.mkdir(parents=True, exist_ok=True)
    atlas_json = cfg.atlas_dir / "atlas.json"

    cell = config.ATLAS_SPRITE_SIZE + config.ATLAS_PADDING
    max_cols = max(1, config.ATLAS_MAX_SIZE // cell)
    max_per_sheet = max_cols * max_cols

    num_images = len(image_paths)
    if num_images == 0:
        atlas_json.write_text("{}\n", encoding="utf-8")
        return {}

    num_sheets = int(np.ceil(num_images / max_per_sheet))

    if atlas_json.exists():
        try:
            meta = json.loads(atlas_json.read_text(encoding="utf-8"))
        except Exception:
            logging.warning("Failed to read %s; regenerating", atlas_json)
        else:
            missing_sheets = [
                sheet_idx
                for sheet_idx in range(num_sheets)
                if not (cfg.atlas_dir / f"atlas_{sheet_idx}.png").exists()
            ]
            if not missing_sheets:
                return meta
            logging.info(
                "Atlas cache incomplete for %s; regenerating (missing %s)",
                cfg.dataset_id,
                missing_sheets,
            )

    logging.info("Generating atlas for dataset %s (%s images)", cfg.dataset_id, len(image_paths))

    master_json: dict[str, dict] = {}

    global_idx = 0
    for sheet_idx in range(num_sheets):
        start = sheet_idx * max_per_sheet
        end = min(start + max_per_sheet, num_images)
        batch = image_paths[start:end]
        if not batch:
            continue

        sheet_count = len(batch)
        atlas_cols = min(max_cols, int(np.ceil(np.sqrt(sheet_count))))
        atlas_rows = int(np.ceil(sheet_count / atlas_cols))

        atlas_w = atlas_cols * cell
        atlas_h = atlas_rows * cell
        atlas_im = Image.new("RGBA", (atlas_w, atlas_h), (0, 0, 0, 0))

        for local_idx, path in enumerate(batch):
            img = Image.open(path).convert("RGBA").resize(
                (config.ATLAS_SPRITE_SIZE, config.ATLAS_SPRITE_SIZE)
            )

            col = local_idx % atlas_cols
            row = local_idx // atlas_cols
            x = col * cell
            y = row * cell

            atlas_im.paste(img, (x, y))

            image_id = str(global_idx)
            master_json[image_id] = {
                "sheet": sheet_idx,
                "x": x,
                "y": y,
                "width": config.ATLAS_SPRITE_SIZE,
                "height": config.ATLAS_SPRITE_SIZE,
                "filename": str(path.relative_to(cfg.thumb_root)),
                "atlas": {
                    "w": atlas_w,
                    "h": atlas_h,
                },
            }
            global_idx += 1

        atlas_png = cfg.atlas_dir / f"atlas_{sheet_idx}.png"
        atlas_im.save(atlas_png)
        logging.info("Saved %s (%s sprites)", atlas_png, sheet_count)

    atlas_json.write_text(json.dumps(master_json, indent=2) + "\n", encoding="utf-8")
    logging.info("Wrote atlas meta → %s", atlas_json)
    return master_json
