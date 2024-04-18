from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import base64
import numpy as np
import cv2
from match_comic import preprocess_image, match_image_with_db, get_image_paths_from_subdirs, precompute_db_features, save_db_features, load_db_features_safely
from config import DevelopmentConfig, ProductionConfig
import os
import json

app = Flask(__name__, static_folder='static')

if os.getenv('FLASK_ENV') == 'development':
    app.config.from_object(DevelopmentConfig())
else:
    app.config.from_object(ProductionConfig())

CORS(app) if app.config['ENV'] == 'development' else None

if( not os.path.isfile('./db_features.pkl') ):
    img_db_folder = 'data/db_comic_new'
    db_img_paths = get_image_paths_from_subdirs(img_db_folder)

    db_features = precompute_db_features(db_img_paths, feature_detector='ORB')
    save_db_features(db_features)

# Load the features once and reuse
db_features = None

def load_features():
    global db_features
    db_features = load_db_features_safely('db_features.pkl')

load_features()

def list_image_files(directory):
    supported_extensions = ['.jpg', '.jpeg', '.png', '.gif']  # Add more if needed
    image_files = []
    for subdir, _, files in os.walk(directory):
        image_files.extend(os.path.join(subdir, f) for f in files if any(f.endswith(ext) for ext in supported_extensions))
    return image_files

@app.route('/list-images')
def list_images():
    image_directory = 'data/db_comic_new'
    image_files = list_image_files(image_directory)
    return jsonify(image_files)

@app.route('/capture', methods=['POST'])
def capture_image():
    data = request.json
    if not data or 'image' not in data:
        return jsonify({'error': 'No image data provided'}), 400

    image_data = data['image']

    if image_data.startswith('data:image/png;base64,'):
        image_data = image_data.replace('data:image/png;base64,', '')
        image_bytes = base64.b64decode(image_data)
        image_array = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    elif image_data.startswith('data:image/jpeg;base64,'):
        image_data = image_data.replace('data:image/jpeg;base64,', '')
        image_bytes = base64.b64decode(image_data)
        image_array = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
        cv2.imwrite('capture.jpg', image) 
    elif image_data.startswith('test'):
        # Assuming 'test1.jpg', 'test2.jpg', etc. are in a known directory
        try:
            test_image_path = os.path.join('./', image_data)
        except:
            return jsonify({'error': 'Test image does not exist'}), 400
        image = cv2.imread(test_image_path, cv2.IMREAD_COLOR)
        image = preprocess_image(image)
    elif image_data.startswith('data/'):
        # Assuming 'test1.jpg', 'test2.jpg', etc. are in a known directory
        try:
            test_image_path = os.path.join('./', image_data)
        except:
            return jsonify({'error': 'Test image does not exist'}), 400
        image = cv2.imread(test_image_path, cv2.IMREAD_COLOR)
        image = preprocess_image(image)
    else:
        return jsonify({'error': 'Invalid image data format'}), 400

    if image is None:
        return jsonify({'error': 'Invalid image data'}), 400

    # target_img = preprocess_image(image)
    top_matches = match_image_with_db(image, db_features)

    results_metadata = {}
    # print(len(top_matches))
    # for (comic, score) in top_matches:
    #     comic_folder = '/'.join(comic.split('/')[:-1])
    #     with open(comic_folder + '/metadata.json', 'r') as f:
    #         results_metadata[comic.split('/')[-1][:-4]] = (json.load(f))
    try:
        match_count = len(top_matches)
        scores = []
        for (score, path) in top_matches:
            comic_folder = '.'.join(path.split('.')[:-1])
            comic_id = path.split('/')[-1]
            with open(f"{comic_folder}.json", 'r') as f:
                results_metadata[comic_id] = (json.load(f))
            scores.append(int(score))
        return jsonify({
            'message': f'{match_count} matches found',
            'score': f'{max(scores)}',
            'top_matches': results_metadata
        })
    except:
        return jsonify({'message': 'No matches found', 'top_matches': {}})

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    img_db_folder = 'data/db_comic_new'
    db_img_paths = get_image_paths_from_subdirs(img_db_folder)

    db_features = precompute_db_features(db_img_paths, feature_detector='ORB')
    save_db_features(db_features)
    app.run(debug=True, port=5000, use_reloader=False)