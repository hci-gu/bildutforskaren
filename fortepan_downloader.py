import asyncio
from pathlib import Path

import httpx


BASE_URL = "https://fortepan.download/file/fortepan-eu/download/fortepan_{image_id}.jpg"
IMAGE_OUTPUT_DIR = Path("datasets/fortepan/images")
IMAGE_IDS = range(200_000, 300_000, 666)
MAX_PARALLEL_REQUESTS = 10
REQUEST_TIMEOUT_SECONDS = 30


async def download_image(
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    image_id: int,
) -> bool:
    url = BASE_URL.format(image_id=image_id)
    output_path = IMAGE_OUTPUT_DIR / f"fortepan_{image_id}.jpg"

    if output_path.exists():
        print(f"Skipping {image_id}: already exists")
        return True

    async with semaphore:
        try:
            response = await client.get(url)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code
            if status_code == 404:
                print(f"Skipping {image_id}: image does not exist")
            else:
                print(f"Failed {image_id}: HTTP {status_code}")
            return False
        except httpx.RequestError as exc:
            print(f"Failed {image_id}: request error ({exc})")
            return False

    output_path.write_bytes(response.content)
    print(f"Downloaded {image_id} -> {output_path}")
    return True


async def download_dataset() -> None:
    IMAGE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(MAX_PARALLEL_REQUESTS)

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS, follow_redirects=True) as client:
        tasks = [
            download_image(client=client, semaphore=semaphore, image_id=image_id)
            for image_id in IMAGE_IDS
        ]
        results = await asyncio.gather(*tasks)

    downloaded_count = sum(results)
    failed_count = len(results) - downloaded_count
    print(f"Finished: {downloaded_count} downloaded or already present, {failed_count} failed.")


if __name__ == "__main__":
    asyncio.run(download_dataset())
