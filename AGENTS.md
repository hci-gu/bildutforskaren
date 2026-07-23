# Repository Guidelines

## Project Structure & Module Organization

The backend entry point is `api.py`, which creates the Flask application from `api/app_factory.py`. Backend responsibilities are divided by module: `routes_*.py` defines HTTP endpoints, `datasets.py` and `dataset_db.py` manage dataset state, `indexing.py` and `clip_service.py` build and query embeddings, and `clustering.py` and `atlas.py` prepare visualization data. Configuration and shared runtime state belong in `api/config.py`, `api/context.py`, and `api/runtime.py`; avoid adding business logic to the entry point.

Root utilities such as `get_images.py`, `fortepan_downloader.py`, and `transform_images.py` prepare source images. Model experiments and workers live in `sd.py` and `model_worker.py`. Files under `datasets/` and `.cache/` are runtime data, not source code.

The React frontend lives in `web/`. Domain code is grouped under `web/src/features/` (`canvas`, `datasets`, `images`, and `streetview`), global state under `web/src/store/`, reusable UI and API helpers under `web/src/shared/`, and assets under `web/src/assets/`. Static files belong in `web/public/`. Deployment manifests are in `deploy/`; container configuration is in `web/Dockerfile` and `web/nginx.conf`. Keep generated data, virtual environments, and build output untracked.

## Build, Test, and Development Commands

- `uv sync --extra cpu` installs backend dependencies; use `--extra cuda` on supported GPU hosts.
- `uv run --no-sync api.py` starts the Flask API on port 3000.
- `cd web; pnpm install` installs frontend dependencies.
- `cd web; pnpm dev` starts Vite on port 5173.
- `cd web; pnpm build` type-checks and builds the frontend.
- `cd web; pnpm lint` runs ESLint.

## Coding Style & Naming Conventions

Use four spaces in Python, type hints for public interfaces, `snake_case` for functions and modules, and `PascalCase` for classes. TypeScript uses two spaces, single quotes, no semicolons, `PascalCase.tsx` components, and `camelCase` hooks. Keep feature-specific code in `web/src/features/<feature>/`; move only reusable code into `shared/`.

## Testing Guidelines

No automated test suite or coverage threshold is checked in. Run `python -m py_compile <changed-files>` for backend syntax and `pnpm lint` plus `pnpm build` for frontend changes. Place Python tests in `tests/` and frontend tests beside source files as `*.test.tsx`. Add regression coverage for defects.

## Commit & Pull Request Guidelines

History uses short summaries such as `fixed f-string bug`. Keep commits focused and describe the observable change. Pull requests should explain the problem and solution, list verification, link issues, and note model or deployment impacts. Include screenshots for UI changes and update `README.md` when setup changes.

## Security & Data Handling

Do not commit downloaded images, datasets, caches, credentials, or `.htpasswd` files. Document required environment variables without adding secrets.
