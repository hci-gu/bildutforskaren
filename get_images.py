import os
import uuid
import requests
from PIL import Image
from io import BytesIO

def download_random_images(image_count=250, image_size=(400, 300)):
    folder_name = "images"
    os.makedirs(folder_name, exist_ok=True)

    print(f"Saving images to folder: {folder_name}")

    seen_hashes = set()
    downloaded = 0
    attempts = 0
    max_attempts = image_count * 10  # Fail-safe to prevent infinite loop

    while downloaded < image_count and attempts < max_attempts:
        url = f"https://picsum.photos/{image_size[0]}/{image_size[1]}"
        attempts += 1

        try:
            response = requests.get(url)
            if response.status_code == 200:
                image = Image.open(BytesIO(response.content)).convert("RGB")
                image_hash = hash(image.tobytes())

                if image_hash in seen_hashes:
                    print(f"Duplicate image detected, skipping.")
                    continue

                seen_hashes.add(image_hash)

                filename = f"{uuid.uuid4()}.jpg"
                path = os.path.join(folder_name, filename)
                image.save(path)
                downloaded += 1
                print(f"Downloaded image {downloaded} → {filename}")
            else:
                print(f"Failed to download image, status code: {response.status_code}")
        except Exception as e:
            print(f"Error downloading image: {e}")

    print(f"Finished: {downloaded} unique images downloaded to '{folder_name}'.")

if __name__ == "__main__":
    download_random_images()
