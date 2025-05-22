# Project: CLIP-Powered Image Search and Retrieval

## Overview

This project implements an image search and retrieval system that leverages the power of OpenAI's CLIP (Contrastive Language-Image Pre-Training) model. It allows users to search for images using natural language text queries, providing a more intuitive and human-like way to find relevant visual content.

## Features

*   **Text-based Image Search:** Utilizes the CLIP model to understand the semantic content of images and match them against natural language text queries.
*   **Thumbnail and Original Resolution Images:** Serves both thumbnail versions of images for quick preview and access to the original, higher-resolution files.
*   **Image Embedding Generation and Caching:** Generates CLIP embeddings for all images in the dataset and caches them for fast retrieval during search operations.
*   **Efficient Search with FAISS:** Employs FAISS (Facebook AI Similarity Search) for highly efficient similarity searching among the image embeddings, enabling quick retrieval even with large datasets.
*   **Sample Image Download Utility:** Includes a utility script to download a sample set of images for demonstration and testing purposes.
*   **Image Preprocessing Utility:** Provides tools to preprocess images, such as resizing, to ensure consistency and optimal performance.
*   **Sprite Atlas Generation:** Offers a utility to create a sprite atlas from image thumbnails. This is beneficial for web interfaces to display many small images efficiently by reducing the number of HTTP requests.
*   **Web Interface:** A user-friendly web interface will be available for interacting with the image search system (details to be provided in a later section).
*   **Image Generation with Stable Diffusion:** Includes a separate utility for generating novel images based on text prompts using the Stable Diffusion model.

## Backend Components

*   **`api.py`**:
    *   The core Flask application that powers the image search functionality.
    *   Integrates with the CLIP model to generate embeddings for both images and text queries.
    *   Provides several API endpoints for:
        *   Searching for images using text-based queries. This leverages a FAISS index for fast similarity searching over the image embeddings.
        *   Retrieving pre-computed image embeddings.
        *   Serving thumbnail images, typically located in the `out/` directory.
        *   Serving original, full-resolution images, sourced from a user-specified directory (`ORIGINAL_ROOT`).
    *   Implements a caching mechanism for image embeddings (e.g., in `.cache/clip_index.npz`), which significantly speeds up application startup by avoiding re-computation.
    *   **Setup & Running**:
        *   Requires Python and its dependencies, which should be listed in a `requirements.txt` file.
        *   On startup, it scans a specified image directory (defaulting to `out/`) for thumbnail images and, if configured, another directory for the original high-resolution images.
        *   It loads existing cached image embeddings or generates and caches them if they are not found.
        *   To run the application, execute the command: `python api.py`. (Note: Depending on the Flask setup, you might need to set environment variables like `FLASK_APP=api.py` and use `flask run`).

*   **`get_images.py`**:
    *   A utility script designed to download a user-specified number of random images from the `picsum.photos` service.
    *   This is particularly useful for quickly creating a sample dataset of images for development and testing purposes.
    *   By default, downloaded images are saved into an `images/` directory.

*   **`transform_images.py`**:
    *   A script responsible for preprocessing images from a source directory.
    *   Its primary function is to resize images to a configured maximum dimension (e.g., 336x336 pixels), ensuring uniformity for processing and display.
    *   The processed images (thumbnails) are saved into an output directory (defaulting to `out/`), maintaining the original folder structure from the source.
    *   This `out/` directory serves as the typical input for `api.py` (for thumbnails) and `sprite_atlas.py`.

*   **`sprite_atlas.py`**:
    *   A utility that generates a sprite atlas, which is a single image file (`atlas.png`) containing multiple smaller images, and a corresponding JSON manifest file (`atlas.json`).
    *   It processes images from a specified directory (default: `out/`), resizing them to a uniform size suitable for sprites.
    *   The generated atlas and manifest are primarily intended for frontend applications, allowing for efficient display of many small images by reducing the number of HTTP requests.

*   **`main.py`**:
    *   A standalone Python script that demonstrates image generation capabilities using the Stable Diffusion model.
    *   It takes a textual prompt as input and generates a corresponding image (e.g., saving it as `output.png`).
    *   This script and its functionality are separate from the core CLIP-based image search and retrieval system.

## Frontend Interface

The `web/` directory houses the frontend application, providing a user interface to interact with the image search API.

*   **Technology Stack**: Based on the file structure (e.g., `App.tsx`, `vite.config.ts`, `package.json`), the frontend appears to be a modern web application, likely built using React, TypeScript, and Vite.
*   **Setup and Execution**: For detailed instructions on setting up and running the frontend application, please refer to the `README.md` file located within the `web/` directory. Typically, this involves navigating to the `web/` directory and running commands like `npm install` (or `yarn install` / `pnpm install`) followed by `npm run dev` (or `yarn dev` / `pnpm dev`).

## Typical Workflow / Usage

This section outlines the general steps to get the image search system up and running.

1.  **Image Preparation**:
    *   The system primarily works with thumbnail-sized images. You need to prepare these first.
    *   **Option A: Process Local Images**
        *   If you have a directory of original, high-resolution images, use `transform_images.py` to create thumbnails.
        *   Run the script: `python transform_images.py`
        *   You may need to configure `input_root` (your source images) and `output_root` (where thumbnails are saved) inside the `transform_images.py` script. By default, thumbnails are saved to the `out/` directory.
    *   **Option B: Download Sample Images**
        *   Use `get_images.py` to download a set of sample images: `python get_images.py`
        *   These images are typically saved to an `images/` directory.
        *   **Important**: The `api.py` server expects thumbnails in a specific location (default `out/`). If the downloaded images are not already thumbnail-sized, you should run `transform_images.py` on the `images/` folder to process them into the `out/` directory. For example, you would modify `transform_images.py` to set `input_root = 'images/'` and `output_root = 'out/'`, then run `python transform_images.py`. For simplicity, ensuring your thumbnails are in the `out/` directory is recommended.

2.  **(Optional) Create Sprite Atlas**:
    *   If your frontend application is designed to use a sprite atlas for efficient image loading (e.g., to display many search results quickly), you can generate one.
    *   Run the script: `python sprite_atlas.py`
    *   This script will process images from the `out/` directory (or as configured within the script) and create `atlas.png` and its corresponding manifest `atlas.json` in the same directory.

3.  **Run the Backend API**:
    *   Start the Flask backend server: `python api.py`
    *   **Note**: On the first run with a new set of images in the `out/` directory (or the configured `IMAGE_ROOT`), the API will need to generate CLIP embeddings for all images. This can take some time depending on the number of images. These embeddings are then cached (by default in `.cache/clip_index.npz`), so subsequent startups will be much faster.

4.  **Search via API**:
    *   Once the API is running, you can perform searches by sending GET requests to its endpoints.
    *   To search for images: `curl "http://localhost:3000/search?query=your+search+term"` (Replace "your+search+term" with your actual query).
    *   Other useful endpoints include:
        *   `/images`: To get a list of all indexed images.
        *   `/image/<id>`: To retrieve details or the original image for a specific image ID.
        *   Refer to `api.py` for more details on available parameters and endpoints.

5.  **(Optional) Use the Web Interface**:
    *   If you have set up and started the frontend application located in the `web/` directory (as per its `web/README.md`), you can open it in your web browser to interact with the search system graphically.

## Installation and Dependencies

### Backend (Python)

*   **Python Version**: Python 3.x is required.
*   **Dependencies**: All Python dependencies are listed in the `requirements.txt` file at the root of the project.
*   **Installation**:
    ```bash
    pip install -r requirements.txt
    ```
*   **Notes on FAISS**: The FAISS library (for efficient similarity search) is included in `requirements.txt` and installed via pip. However, FAISS can have system-level dependencies (like a C++ compiler and BLAS libraries) on certain operating systems. If you encounter issues during its installation, please consult the official [FAISS installation guide](https://github.com/facebookresearch/faiss/blob/main/INSTALL.md) for troubleshooting and system-specific requirements.

### Frontend (Web Interface)

*   **Location**: The frontend application is located in the `web/` directory.
*   **Prerequisites**: You will typically need Node.js (which includes npm) and ideally `pnpm` (though `npm` or `yarn` can also be used).
*   **Dependencies**: Frontend dependencies are listed in `web/package.json`.
*   **Installation**:
    Navigate to the web directory and install the dependencies:
    ```bash
    cd web
    pnpm install  # or npm install, or yarn install
    ```
*   **Further Information**: For more detailed instructions on building, developing, or deploying the frontend, please refer to the `web/README.md` file and standard practices for Node.js/React/Vite projects.

## Future Improvements & Contributing

### Future Improvements (Examples)

*   More sophisticated frontend UI features (e.g., metadata display, advanced filtering).
*   Support for other embedding models beyond CLIP.
*   User authentication and personalized image galleries.

### Contributing

Contributions are welcome! Please feel free to open an issue to discuss a bug or a new feature, or submit a pull request with your improvements. For major changes, it's a good idea to open an issue first to discuss what you would like to change.
