"""API entrypoint.

This repository keeps `api.py` as the entrypoint module (and gunicorn target
`api:app`). At the same time we split implementation across multiple files
under the `api/` directory.

To avoid the import-name collision between a top-level `api.py` module and a
top-level `api/` package, we treat this module as a *package-like* module by
setting `__path__` so that `import api.<submodule>` works.
"""

from __future__ import annotations

import os
from pathlib import Path

# Avoid OpenMP duplicate-runtime crashes (faiss/sklearn).
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

# Allow importing `api.*` modules from the `api/` directory.
__path__ = [str(Path(__file__).with_name("api"))]

from api.app_factory import create_app  # noqa: E402

app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000, debug=False)
