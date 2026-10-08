# Project: Semantic Image Search and Retrieval

Bildutforskaren is an AI-assisted application for uploading, organizing, searching, and visually exploring image collections. Each dataset uses CLIP or EmbeddingGemma 2 for semantic image and text search, PCA and UMAP for interactive projections, and tools for tagging and clustering images. Optional Florence-2, SDXL, and IP-Adapter workflows generate detailed captions, text and image conditioning, and visual previews for images and clusters.

# Setup & Installation

## Backend

Step by step guide to prepare the backend

1. Setup backend dependencies using `uv` python package manager. For CUDA compatible machines use flag `--extra cuda` otherwise, run
``` bash
uv sync --extra cpu
```

2. Acquire an image dataset. There are helper scripts to help download different image datasets
    - `get_images.py` downloads 250 random images from `picsum.photos`
    - `fortepan_downloader.py` downloads images from https://fortepan.hu/en/. Modify `STEP` parameter to control number downloaded images

3. Run the backend Flask application
``` bash
uv run --no-sync api.py
``` 
The API listens on `0.0.0.0:3000`. Set `BILDUTFORSKAREN_API_KEY` in the
process environment or an ignored `.env` file before starting it. The server
refuses to start without a key. Every API request must include
`X-API-Key: <your-key>`; an absent or incorrect key returns HTTP 401. Browser
CORS preflight (`OPTIONS`) requests are allowed without a key because they do
not access route data. For example:

```bash
curl -H "X-API-Key: $BILDUTFORSKAREN_API_KEY" http://localhost:3000/datasets
```

Keep the key out of source control and use HTTPS when accessing the API over a
network. For the OpenShift deployment, create a Secret named
`bildutforskaren-api` with an `api-key` entry before applying `deploy/api.yaml`.

The API and model-worker entrypoints load environment variables from `.env` and
`api/.env`. Existing process-environment values take precedence. Image-generation
pipelines warm during startup by default; set
`BILDUTFORSKAREN_SKIP_IMAGE_GEN_WARMUP=1` to load them on first use instead.

*   **Note**: When a new ZIP file is uploaded, the API processes it as an isolated dataset under `datasets/<dataset-id>/`. It generates thumbnails, embeddings, and atlas data, which are cached per dataset so the collection can be reopened without repeating the initial processing.

### Embedding model selection

Select **CLIP ViT-L/14** (`openai/clip-vit-large-patch14`, the default) or
**EmbeddingGemma 2** (`google/embeddinggemma-2`) when creating a dataset. For a
ready dataset, use **Embeddingmodell → Byt modell** in dataset settings. The API
also accepts `embedding_model` in `POST /datasets` and
`POST /datasets/<dataset-id>/embedding-model`.

Both models index the same RGB thumbnails (maximum 336 × 336), returning
normalized 768-dimensional float32 vectors. EmbeddingGemma runs inside the API
with its vision encoder enabled and `audio_config=None`; it uses BF16 on
supported CUDA GPUs and float32 otherwise, never FP16. Models download on first
use. The inference service retains one embedding model at a time to limit memory
use; alternating queries between datasets using different models reloads weights.

A model switch prepares the target index and SAO vectors in the background,
then activates it after successful preparation. The previous model remains
active if preparation fails. Conflicting background jobs are rejected during a
switch. Restarting the API resumes unfinished switches.

Image vectors, PCA transforms, UMAP layouts, vector exports, and cluster previews
are stored under `datasets/<dataset-id>/cache/embeddings/<fingerprint>/`.
SAO vectors and layouts are stored under `.cache/embeddings/<fingerprint>/`.
Fingerprints include the pinned model revision, dimension, preprocessing,
normalization, and text policy. Switching back reuses valid caches. Legacy CLIP
indexes are read and migrated without changing image IDs or manual tags.

The SAO vocabulary and English embedding prompts remain fixed; only their
vectors differ between models. Text is initially encoded without task prefixes.
`GET /terms/sao/umap?embedding_model=google/embeddinggemma-2` selects a model for
the SAO layout; omitted selectors retain CLIP behavior. Similarity thresholds
remain unchanged and raw similarity values should be evaluated separately for
each model, rather than interpreted as comparable confidence probabilities.

EmbeddingGemma vectors support retrieval and analysis. They are separate from
Florence captions, SDXL text conditioning, and IP-Adapter image conditioning.
Existing captions and generation conditioning are reused across model switches;
cluster previews must be baked for each embedding model.

The shared runtime now requires Transformers 5.19+, Sentence Transformers 6.1+,
Diffusers 0.38+, and Compel 2.4+. Run `uv sync --extra cpu` (or `--extra cuda`)
after updating. Florence uses the [official native Transformers conversion](https://huggingface.co/florence-community/Florence-2-large)
of Microsoft's Florence-2-large checkpoint, pinned to its tested revision.

Run backend regressions with `uv run --no-sync python -m unittest discover -s tests`.
Set `BILDUTFORSKAREN_SKIP_SAO_WARMUP=1` and
`BILDUTFORSKAREN_SKIP_IMAGE_GEN_WARMUP=1` when running regressions to avoid
loading production model weights during test discovery.
Run frontend regressions with `pnpm test:canvas` and verify the production build
with `pnpm build` from `web/`.

## Frontend

The `web/` directory houses the frontend application, providing a user interface to interact with the image search API. Navigate to frontend directory `cd web/`. 

Install required dependencies:
``` bash
pnpm install
``` 
Frontend dependencies are listed in `web/package.json`.

For a local frontend talking to an API that requires a key, create an ignored
`web/.env` file:

```dotenv
VITE_API_URL=/api
BILDUTFORSKAREN_API_TARGET=http://<api-host>:3000
BILDUTFORSKAREN_API_KEY=<your-key>
```

The Vite development server proxies `/api` requests to the backend and adds
the key on the server side. This also covers images and atlas sheets, which
browser image elements cannot load with custom headers. Keep the Vite dev
server bound to localhost while using this proxy.

Run frontend dev server:
``` bash
pnpm dev
``` 
This spins up a web server on: http://localhost:5173/

Starting from scratch, provide a `.zip` file of images to create a dataset. 

- - -
## Future Improvements & Contributing

### Future Improvements (Examples)

*   Additional embedding providers and model-specific retrieval calibration.
*   User authentication and personalized image galleries.

### Contributing

Contributions are welcome! Please feel free to open an issue to discuss a bug or a new feature, or submit a pull request with your improvements. For major changes, it's a good idea to open an issue first to discuss what you would like to change.
