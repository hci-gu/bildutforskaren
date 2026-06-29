import argparse
import os
from PIL import Image

# Configuration
input_root = '/Volumes/T7/Riksarkivet'
output_root = 'out'
max_size = (336, 336)  # Resize to fit within this (width, height)

def resize_image(input_path, output_path, max_size):
    with Image.open(input_path) as img:
        img.thumbnail(max_size)
        img.save(output_path, optimize=True)

def process_folder(input_root, output_root, max_size):
    for root, dirs, files in os.walk(input_root):
        # Create the same folder structure in the output directory
        relative_path = os.path.relpath(root, input_root)
        output_dir = os.path.join(output_root, relative_path)
        os.makedirs(output_dir, exist_ok=True)

        for file in files:
            if file.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff', '.webp')):
                input_path = os.path.join(root, file)
                output_path = os.path.join(output_dir, file)

                try:
                    resize_image(input_path, output_path, max_size)
                    print(f"Resized: {input_path} → {output_path}")
                except Exception as e:
                    print(f"Error processing {input_path}: {e}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Resize images into a mirrored output folder.')
    parser.add_argument('input_root', nargs='?', default=input_root, help='Root folder containing source images.')
    parser.add_argument('output_root', nargs='?', default=output_root, help='Root folder for resized images.')
    args = parser.parse_args()

    process_folder(args.input_root, args.output_root, max_size)
