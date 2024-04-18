from tensorflow.keras.applications import ResNet50
from tensorflow.keras.preprocessing import image as keras_image
from tensorflow.keras.applications.resnet50 import preprocess_input
from tensorflow.keras.models import load_model as keras_load_model  # To avoid naming conflict
import numpy as np
import cv2

# Path to the saved model
saved_model_path = 'data/model.keras'

# Function to load and prepare the model
def load_model(use_local_model=False):
    if use_local_model:
        print("Local model being used.")
        return keras_load_model(saved_model_path)
    else:
        return ResNet50(weights='imagenet', include_top=False, input_shape=(224, 224, 3), pooling='max')

# Function to extract features from a single image or path
def extract_features(img, model):
    if isinstance(img, str):  # if img is a path
        img = keras_image.load_img(img, target_size=(224, 224))
        img_array = keras_image.img_to_array(img)
    elif isinstance(img, np.ndarray):  # if img is an array
        img_array = cv2.resize(img, (224, 224))
    
    img_array = np.expand_dims(img_array, axis=0)
    img_array = preprocess_input(img_array)
    features = model.predict(img_array)
    return features.flatten()

# Function to extract features in parallel from multiple image paths
def extract_features_in_parallel(img_paths, model, batch_size=8):
    def process_batch(paths):
        imgs = [preprocess_input(np.expand_dims(keras_image.img_to_array(keras_image.load_img(p, target_size=(224, 224))), axis=0)) for p in paths]
        batch = np.vstack(imgs)
        return model.predict(batch)

    # Process images in batches
    features = []
    for i in range(0, len(img_paths), batch_size):
        batch_paths = img_paths[i:i+batch_size]
        batch_features = process_batch(batch_paths)
        features.extend(batch_features)

    return np.array(features)
