from __future__ import annotations

import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import zipfile

from api import datasets
from api.models import DatasetConfig


class DatasetUploadTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        self.cfg = DatasetConfig("test", root / "thumb", root / "original", root / "cache", root / "atlas")
        self.cfg.original_root.mkdir()
        self.cfg.cache_dir.mkdir()
        patcher = patch("api.datasets.get_dataset_config", return_value=self.cfg)
        patcher.start()
        self.addCleanup(patcher.stop)

    def extract(self, entries: list[tuple[str, bytes]]) -> int:
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            for name, content in entries:
                info = zipfile.ZipInfo(name)
                # Retain foreign ZIP separators instead of Windows writer normalization.
                info.filename = name
                archive.writestr(info, content)
        stream.seek(0)
        return datasets.extract_zip_to_originals("test", stream)

    def test_invalid_characters_are_replaced_and_reserved_names_prefixed(self):
        entries = [("folder/photo<>:\"|?*\x01.jpg", b"invalid"), ("CON.jpg", b"device"),
                   ("COM¹.png", b"port"), ("K1A_123.jpg", b"metadata"), ("räksmörgås.jpg", b"unicode")]
        self.assertEqual(self.extract(entries), len(entries))
        root = self.cfg.original_root
        self.assertEqual((root / ("photo" + "_" * 8 + ".jpg")).read_bytes(), b"invalid")
        self.assertEqual((root / "_CON.jpg").read_bytes(), b"device")
        self.assertEqual((root / "_COM¹.png").read_bytes(), b"port")
        self.assertEqual((root / "K1A_123.jpg").read_bytes(), b"metadata")
        self.assertEqual((root / "räksmörgås.jpg").read_bytes(), b"unicode")

    def test_collisions_preserve_every_image_and_record_original_paths(self):
        entries = [("one/photo?.jpg", b"one"), ("two/photo*.jpg", b"two"),
                   ("PHOTO_.jpg", b"three"), ("nested\\photo_.jpg", b"four")]
        self.assertEqual(self.extract(entries), 4)
        paths = list(self.cfg.original_root.iterdir())
        self.assertEqual(len({p.name.casefold() for p in paths}), 4)
        self.assertEqual({p.read_bytes() for p in paths}, {b"one", b"two", b"three", b"four"})
        mapping = json.loads((self.cfg.cache_dir / "upload_filenames.json").read_text(encoding="utf-8"))
        self.assertEqual(set(mapping.values()), {name for name, _ in entries})
        self.assertFalse((self.cfg.cache_dir / "upload.zip").exists())

    def test_long_unicode_names_and_deep_folders_are_shortened(self):
        self.assertEqual(self.extract([("folder/" * 100 + "😀" * 140 + ".jpg", b"image")]), 1)
        path, = self.cfg.original_root.iterdir()
        self.assertEqual(path.read_bytes(), b"image")
        self.assertEqual(path.suffix, ".jpg")
        self.assertLess(len(str(path.resolve()).encode("utf-16-le")) // 2, 240)
        self.assertLessEqual(len(path.name.encode("utf-8")), 200)

    def test_unsafe_paths_and_metadata_are_skipped(self):
        names = ["../escape.jpg", "nested/../escape.jpg", "..\\escape.jpg",
                 "C:/escape.jpg", "C:escape.jpg", "/escape.jpg", "\\\\host\\share\\escape.jpg",
                 "__MACOSX/photo.jpg", "folder/._photo.jpg", "notes.txt"]
        self.assertEqual(self.extract([(name, b"bad") for name in names] + [("ok.jpg", b"good")]), 1)
        self.assertEqual([p.name for p in self.cfg.original_root.iterdir()], ["ok.jpg"])

    def test_existing_file_is_not_overwritten(self):
        (self.cfg.original_root / "photo.jpg").write_bytes(b"existing")
        self.assertEqual(self.extract([("photo.jpg", b"new")]), 1)
        self.assertEqual((self.cfg.original_root / "photo.jpg").read_bytes(), b"existing")
        self.assertEqual((self.cfg.original_root / "photo_2.jpg").read_bytes(), b"new")


if __name__ == "__main__":
    unittest.main()
