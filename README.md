# Project: CLIP-Powered Image Search and Retrieval

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
*   **Note**: On the first run with a new set of images in the `out/` directory (or the configured `IMAGE_ROOT`), the API will need to generate CLIP embeddings for all images. This can take some time depending on the number of images. These embeddings are then cached (by default in `.cache/clip_index.npz`), so subsequent startups will be much faster.

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

## API Endpoints
-   Once the API is running, you can perform searches by sending GET requests to its endpoints.
-   To search for images: `curl "http://localhost:3000/search?query=your+search+term"` (Replace "your+search+term" with your actual query).
-   Other useful endpoints include:
    -   `/images`: To get a list of all indexed images.
    -   `/image/<id>`: To retrieve details or the original image for a specific image ID.
    -   Refer to `api.py` for more details on available parameters and endpoints.


- - -
## Future Improvements & Contributing

### Future Improvements (Examples)

*   More sophisticated frontend UI features (e.g., metadata display, advanced filtering).
*   Support for other embedding models beyond CLIP.
*   User authentication and personalized image galleries.
*   Image generation (from average embeddings)
*   Create spaceword from unsupervised clustering algorithm (cluster embeddings -> use average class embedding vector -> inverse-map to text)
*   Query optimization (len(word) == 1: "photo of " + word)
*   Image caption prefix data exploration
*   Generate image description (big button "Describe this!"")
* Return to Center of Mass button near minimap

### Contributing

Contributions are welcome! Please feel free to open an issue to discuss a bug or a new feature, or submit a pull request with your improvements. For major changes, it's a good idea to open an issue first to discuss what you would like to change.
