# Project: CLIP-Powered Image Search and Retrieval

Bildutforskaren is an AI-assisted application for uploading, organizing, searching, and visually exploring image collections. It uses CLIP for semantic image and text search, PCA and UMAP for interactive projections, and provides tools for tagging and clustering images. Optional Florence-2, SDXL, and IP-Adapter workflows can generate detailed captions, text and image conditioning, and visual previews for images and clusters.

# Setup & Installation

## Backend

Step by step guide to prepare the backend

1. Setup backend dependencies using `uv` python package manager. For CUDA compatible machines use flag `--extra cuda` otherwise, run
``` bash
uv sync --extra cpu
```
The SciPy pin includes the macOS binary compatibility fix needed for recent
macOS versions. After pulling dependency updates, rerun the sync command above.

2. Acquire an image dataset. There are helper scripts to help download different image datasets
    - `get_images.py` downloads 250 random images from `picsum.photos`
    - `fortepan_downloader.py` downloads images from https://fortepan.hu/en/. Modify `STEP` parameter to control number downloaded images

3. Run the backend Flask application
``` bash
uv run --no-sync api.py
``` 
The API and model-worker entrypoints load environment variables from `.env` and
`api/.env`. Existing process-environment values take precedence. Image-generation
pipelines warm during startup by default; set
`BILDUTFORSKAREN_SKIP_IMAGE_GEN_WARMUP=1` to load them on first use instead.

*   **Note**: When a new ZIP file is uploaded, the API processes it as an isolated dataset under `datasets/<dataset-id>/`. It generates thumbnails, CLIP embeddings, and atlas data, which are cached per dataset so the collection can be reopened without repeating the initial processing.

## Desktop launcher (macOS)

After completing backend and frontend installation, double-click
**Bildutforskaren.app** on the Desktop. This opens directly without Terminal
or shell startup prompts. To rebuild the app after moving the repository, run
`.venv/bin/python scripts/build_desktop_app.py` and copy the resulting
`.cache/desktop-launcher/Bildutforskaren.app` to the Desktop.
`Start Bildutforskaren.command` is also available for launching from Terminal.

The launcher starts the API and web server if needed, waits for both to be
ready, and opens http://localhost:5173 in your default browser. Clicking it
again reopens the UI and reuses running servers. Initial model warmup can take
a few minutes. Servers keep
running until the computer restarts or their processes are stopped. Startup
logs are saved under `.cache/desktop-launcher/`. The launcher uses the existing
installed dependencies; it does not install or update them.
If Node.js is installed through NVM, the shortcut loads NVM's default version
when Node is absent from its PATH, without loading shell startup files.
Set that version with `nvm alias default <version>` if needed. Changes to the
shortcut or launcher scripts take effect without rebuilding the Desktop app.

## Frontend

The `web/` directory houses the frontend application, providing a user interface to interact with the image search API. Navigate to frontend directory `cd web/`. 

Install required dependencies:
``` bash
pnpm install
``` 
Frontend dependencies are listed in `web/package.json`.

Run frontend dev server:
``` bash
pnpm dev
``` 
This spins up a web server on: http://localhost:5173/

Starting from scratch, provide a `.zip` file of images to create a dataset. 

### Interface language

Use the **Svenska / English** selector at the top right of the dataset selection
page. Swedish is the default; the browser remembers your choice across pages
and refreshes. UI language changes do not rerun analysis or change tag assignments.
Semantic image search still expects English descriptions. SAO vocabulary lookup
accepts Swedish and English, using the existing bilingual vocabulary labels.
Collection metadata, custom tags, captions, prompts and filenames retain their
original text. Swedish SAO scope notes are identified as original Swedish content.

Interface messages live in `web/src/shared/i18n/messages.ts`; every key has both
Swedish and English text. Subscribe presenting components with `useLanguage()`
and translate when rendering. Keep canonical labels and IDs in analytical state
and requests. Run `pnpm test:i18n` from `web/` to check the catalogue and scan JSX
for untranslated interface literals.

- - -
## Future Improvements & Contributing

### Future Improvements (Examples)

*   Support for other embedding models beyond CLIP.
*   User authentication and personalized image galleries.

### Contributing

Contributions are welcome! Please feel free to open an issue to discuss a bug or a new feature, or submit a pull request with your improvements. For major changes, it's a good idea to open an issue first to discuss what you would like to change.
