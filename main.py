from feature_extraction.extract import load_model, extract_features
from indexing.index import create_index, save_index, load_index
from search.search import search_comic
from utils.helpers import load_image_paths
from concurrent.futures import ThreadPoolExecutor
from tensorflow.keras.preprocessing import image
from tensorflow.keras.applications.resnet50 import preprocess_input
import numpy as np

def extract_features_in_parallel(img_paths, model, batch_size=32):
    # Load and preprocess all images first
    imgs = [preprocess_input(np.expand_dims(image.img_to_array(image.load_img(img_path, target_size=(224, 224))), axis=0)) for img_path in img_paths]
    
    # Concatenate all preprocessed images into one large batch
    batch = np.vstack(imgs)
    
    # Predict in batches
    features = []
    for i in range(0, len(batch), batch_size):
        batch_features = model.predict(batch[i:i+batch_size])
        features.extend(batch_features)
    
    return np.array(features)

# Load the model just once
model = load_model()

# Load image paths
db_img_paths = load_image_paths('data/db_comic')

# Extract features in parallel
img_paths = [img_data['path'] for img_data in db_img_paths]
db_features = extract_features_in_parallel(img_paths, model)

# Create index
index = create_index(db_features)

# Optional: save index to disk
save_index(index, 'data/faiss_index.index')

# Now, db_features and index can be reused or saved and loaded from disk as needed

# To search for a comic in the main application
def find_matches_for_query(query_path, top_k=3):
    query_features = extract_features(query_path, model)
    closest_matches, scores = search_comic(query_features, index, db_img_paths, top_k=top_k)
    return closest_matches, scores

if __name__ == "__main__":
    query_path = 'test1.jpg'
    matches, scores = find_matches_for_query(query_path, top_k=3)
    for i, (match, score) in enumerate(zip(matches, scores), 1):
        print(f"Top {i} match: {match} with a score of {score}")
