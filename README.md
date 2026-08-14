# Project: CLIP-Powered Image Search and Retrieval

Bildutforskaren is an AI-assisted application for uploading, organizing, searching, and visually exploring image collections. It uses CLIP for semantic image and text search, PCA and UMAP for interactive projections, and provides tools for tagging and clustering images. Optional Florence-2, SDXL, and IP-Adapter workflows can generate detailed captions, text and image conditioning, and visual previews for images and clusters.

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
*   **Note**: When a new ZIP file is uploaded, the API processes it as an isolated dataset under `datasets/<dataset-id>/`. It generates thumbnails, CLIP embeddings, and atlas data, which are cached per dataset so the collection can be reopened without repeating the initial processing.

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

- - -
## Future Improvements & Contributing

### Future Improvements (Examples)

*   Support for other embedding models beyond CLIP.
*   User authentication and personalized image galleries.

### Contributing

Contributions are welcome! Please feel free to open an issue to discuss a bug or a new feature, or submit a pull request with your improvements. For major changes, it's a good idea to open an issue first to discuss what you would like to change.
