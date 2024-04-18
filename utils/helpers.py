import os

def load_image_paths(images_directory):
    image_data = []
    for root, _, files in os.walk(images_directory):
        for file in files:
            if file.lower().endswith(('.png', '.jpg', '.jpeg')):
                full_path = os.path.join(root, file)
                comic_id = os.path.splitext(file)[0]
                series_name = os.path.basename(root)  # Assuming the immediate parent directory is the series name
                image_data.append({
                    'path': full_path,
                    'comic_id': comic_id,
                    'series': series_name
                })
    return image_data
