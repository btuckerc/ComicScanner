import cv2
import numpy as np
import os
from concurrent.futures import ThreadPoolExecutor
import concurrent
import threading
import pickle

NUMFEATURES = 80
DETECTOR = 'ORB'
DIST_THRESH = 25

def get_image_paths_from_subdirs(base_folder):
    img_paths = []
    for root, dirs, files in os.walk(base_folder):
        for file in files:
            if file.lower().endswith(('.png', '.jpg', '.jpeg')):
                full_path = os.path.join(root, file)
                img_paths.append(full_path)
    return img_paths

# def preprocess_image(img):
#     # Assuming the borders are not needed, crop the image
#     # You need to adjust the values according to your specific images
#     # h, w = img.shape
#     # return img[int(h*0.05):int(h*0.95), int(w*0.05):int(w*0.95)]
#     resized_img = cv2.resize(img, (640, 480))
#     return resized_img

def keypoints_to_tuple(kps, des):
    return [(kp.pt, kp.size, kp.angle, kp.response, kp.octave, kp.class_id) for kp in kps], des

def tuple_to_keypoints(tupled_kps, des):
    # Re-create the list of keypoints from the tuple
    kps = [cv2.KeyPoint(x=pt[0], y=pt[1], size=size, angle=angle, response=response, octave=octave, class_id=class_id)
           for pt, size, angle, response, octave, class_id in tupled_kps]
    return kps, des

def save_db_features(db_features, filename='db_features.pkl'):
    db_features_picklable = {
        k: {'keypoints': keypoints_to_tuple(v['keypoints'], v['descriptors'])}
        for k, v in db_features.items()
    }
    with open(filename, 'wb') as f:
        pickle.dump(db_features_picklable, f)

def load_db_features(filename='db_features.pkl'):
    with open(filename, 'rb') as f:
        db_features_picklable = pickle.load(f)
    db_features = {k: {'keypoints': tuple_to_keypoints(v['keypoints'][0], v['keypoints'][1])[0], 'descriptors': tuple_to_keypoints(v['keypoints'][0], v['keypoints'][1])[1]} for k, v in db_features_picklable.items()}
    return db_features

db_features_lock = threading.Lock()
db_features = None
def load_db_features_safely(filename='db_features.pkl'):
    global db_features
    if db_features is not None:
        return db_features
    with db_features_lock:
        if db_features is None:
            db_features = load_db_features(filename)
    return db_features

def filter_matches(matches, distance_threshold=50):
    distances = np.array([m.distance for m in matches])
    filtered_indices = np.where(distances < distance_threshold)[0]
    filtered_matches = [matches[i] for i in filtered_indices]
    return filtered_matches#[m for m in matches if m.distance < distance_threshold]

def verify_homography(matches, kp1, kp2, reprojection_threshold=3.0):
    if len(matches) < 4:
        return 0

    src_pts = np.float32([kp1[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
    dst_pts = np.float32([kp2[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)

    M, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, reprojection_threshold)
    if M is not None:
        inliers = mask.ravel().tolist()
        num_inliers = sum(inliers)
        return num_inliers
    return 0

def match_with_bfmatcher(des1, des2):
    # Create BFMatcher object with distance measurement
    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    # Match descriptors
    # if des1.dtype != np.float32:
    #     des1 = des1.astype(np.float32)
    # if des2.dtype != np.float32:
    #     des2 = des2.astype(np.float32)
    matches = bf.match(des1, des2)
    # Sort them in the order of their distance (lower is better)
    matches = sorted(matches, key=lambda x: x.distance)
    return matches

def match_with_bf_and_lowe(des1, des2, lowe_ratio=0.75):
    # Initialize BFMatcher with default params
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    # Find two nearest matches for each descriptor
    matches = bf.knnMatch(des1, des2, k=2)

    # Apply Lowe's ratio test
    good_matches = []
    for m, n in matches:
        if m.distance < lowe_ratio * n.distance:
            good_matches.append(m)

    return good_matches

def detect_and_compute(img, feature_detector='ORB'):
    if feature_detector == 'ORB':
        detector = cv2.ORB_create(nfeatures=NUMFEATURES)
        # For ORB, NORM_HAMMING should be used
        FLANN_INDEX_LSH = 6
        index_params= dict(algorithm = FLANN_INDEX_LSH,
                           table_number = 6, 
                           key_size = 12,     
                           multi_probe_level = 1) 
        search_params = dict(checks=50)
    elif feature_detector == 'AKAZE':
        detector = cv2.AKAZE_create()
        # For AKAZE, NORM_HAMMING should be used
        FLANN_INDEX_LSH = 6
        index_params= dict(algorithm = FLANN_INDEX_LSH,
                           table_number = 6, 
                           key_size = 12,     
                           multi_probe_level = 1) 
        search_params = dict(checks=50)
    elif feature_detector == 'BRISK':
        detector = cv2.BRISK_create()
        # For BRISK, NORM_HAMMING should be used
        FLANN_INDEX_LSH = 6
        index_params= dict(algorithm = FLANN_INDEX_LSH,
                           table_number = 6, 
                           key_size = 12,     
                           multi_probe_level = 1) 
        search_params = dict(checks=50)
    elif feature_detector == 'SURF':
        detector = cv2.xfeatures2d.SURF_create(hessianThreshold=100, nOctaves=4, nOctaveLayers=3)
    else:
        raise ValueError("Unknown feature detector type")

    kp, des = detector.detectAndCompute(img, None)
    return kp, des

def preprocess_image(img, max_dimension=600):
    """Resize image to a maximum dimension."""
    h, w = img.shape[:2]
    if max(h, w) > max_dimension:
        scaling_factor = max_dimension / max(h, w)
        img = cv2.resize(img, None, fx=scaling_factor, fy=scaling_factor, interpolation=cv2.INTER_AREA)
    return img

def precompute_db_features(db_img_paths, feature_detector='ORB'):
    db_features = {}
    for path in db_img_paths:
        img_color = cv2.imread(path, cv2.IMREAD_COLOR)
        img_color = preprocess_image(img_color)  # Downscale image
        img_gray = cv2.cvtColor(img_color, cv2.COLOR_BGR2GRAY)
        kp, des = detect_and_compute(img_gray, feature_detector)
        db_features[path] = {'keypoints': kp, 'descriptors': des, 'image': img_color}
    return db_features

def match_with_flann(des1, des2, index_params, search_params):
    flann = cv2.FlannBasedMatcher(index_params, search_params)
    matches = flann.match(des1, des2)
    matches = sorted(matches, key=lambda x: x.distance)
    return matches

def match_image_with_db(target_img, loaded_features, feature_detector='ORB', lowe_ratio=0.75, distance_threshold=DIST_THRESH, reprojection_threshold=3.0):
    # loaded_features = load_db_features_safely()

    kp1, des1 = detect_and_compute(target_img, feature_detector=feature_detector)
    match_details = []

    def process_precomputed_features(path, features):
        kp2, des2 = features['keypoints'], features['descriptors']
        matches = match_with_bfmatcher(des1, des2)#, lowe_ratio)
        filtered_matches = filter_matches(matches, distance_threshold)
        
        if len(filtered_matches) >= 4:
            num_inliers = verify_homography(filtered_matches, kp1, kp2, reprojection_threshold)
            if num_inliers > 0:  # Consider using a minimum inlier count to filter poor matches
                return num_inliers, path
        return 0, path

    with ThreadPoolExecutor(max_workers=16) as executor:
        futures = [executor.submit(process_precomputed_features, path, features) for path, features in loaded_features.items()]
        for future in concurrent.futures.as_completed(futures):
            score, path = future.result()
            if score > 0:
                match_details.append((score, path))

    # Sort based on the number of inliers (higher is better)
    match_details.sort(reverse=True, key=lambda x: x[0])
    top_3_match_details = match_details[:3]

    # Display top 3 matches
    for i, (score, path) in enumerate(top_3_match_details, start=1):
        print(f"Top {i} match: {path} with {score} inliers")
    return(top_3_match_details)

    # return top_3_match_details  # Return top 3 matches for further processing
    # return best_match_path, best_score

def process_match(db_img_path, des_query, kp_query, db_features, lowe_ratio, distance_threshold, reprojection_threshold):
    kp_db, des_db = db_features[db_img_path]
    matches = match_with_bf_and_lowe(des_query, des_db, lowe_ratio)
    filtered_matches = filter_matches(matches, distance_threshold)

    num_inliers = verify_homography(filtered_matches, kp_query, kp_db, reprojection_threshold)
    return num_inliers, db_img_path

def match_query_with_precomputed_db(target_img, db_features, feature_detector='ORB', lowe_ratio=0.75, distance_threshold=DIST_THRESH, reprojection_threshold=3.0):
    kp_query, des_query = detect_and_compute(target_img, feature_detector)
    match_details = []

    with ThreadPoolExecutor(max_workers=4) as executor:
        future_to_img = {executor.submit(process_match, db_img_path, des_query, kp_query, db_features, lowe_ratio, distance_threshold, reprojection_threshold): db_img_path for db_img_path in db_features.keys()}
        for future in concurrent.futures.as_completed(future_to_img):
            num_inliers, db_img_path = future.result()
            if num_inliers > 0:
                match_details.append((num_inliers, db_img_path))

    match_details.sort(reverse=True, key=lambda x: x[0])
    top_match_details = match_details[:3]
    return top_match_details

    # for db_img_path, (kp_db, des_db) in db_features.items():
    #     # Use precomputed keypoints and descriptors for matching
    #     matches = match_with_bf_and_lowe(des_query, des_db, lowe_ratio)
    #     filtered_matches = filter_matches(matches, distance_threshold)
        
    #     num_inliers = verify_homography(filtered_matches, kp_query, kp_db)
    #     if num_inliers > 0:  # Consider using a minimum inlier count to filter poor matches
    #         match_details.append((num_inliers, db_img_path))

    match_details.sort(reverse=True, key=lambda x: x[0])
    top_match_details = match_details[:3]
    return top_match_details

def visualize_matches(img1, kp1, img2, kp2, matches):
    return cv2.drawMatches(img1, kp1, img2, kp2, matches, None, flags=cv2.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS)

def visualize_keypoints(img, keypoints, color=(0, 255, 0), radius=3, thickness=-1):
    for kp in keypoints:
        # Draw a small circle at each keypoint location
        img = cv2.circle(img, (int(kp.pt[0]), int(kp.pt[1])), radius, color, thickness)
    return img

def visualize_top_matches(target_img_path, top_matches):
    target_img = cv2.imread(target_img_path, cv2.IMREAD_GRAYSCALE)
    # target_img = preprocess_image(target_img)
    kp1, des1 = detect_and_compute(target_img, feature_detector=DETECTOR)

    for i, (score, db_img_path) in enumerate(top_matches, start=1):
        db_img = cv2.imread(db_img_path, cv2.IMREAD_GRAYSCALE)
        # db_img = preprocess_image(db_img)
        kp2, des2 = detect_and_compute(db_img, feature_detector=DETECTOR)
        good_matches = match_with_bfmatcher(des1, des2)

        # Draw matches
        img_matches = cv2.drawMatches(target_img, kp1, db_img, kp2, good_matches, None, flags=cv2.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS)
        cv2.imshow(f"Top {i} Match", img_matches)
    
    # # Draw keypoints on the target image
    # target_img_keypoints_visualization = visualize_keypoints(target_img.copy(), kp1)

    # # Draw keypoints on the matched database image
    # db_img_keypoints_visualization = visualize_keypoints(db_img.copy(), kp2)

    # # Display the images
    # cv2.imshow('Target Image Keypoints', target_img_keypoints_visualization)
    # cv2.imshow('DB Image Keypoints', db_img_keypoints_visualization)

    cv2.waitKey(0)
    cv2.destroyAllWindows()

def find_best_match(target_img, db_img_paths, feature_detector='ORB', lowe_ratio=0.75, distance_threshold=30, reprojection_threshold=3.0):
    kp1, des1 = detect_and_compute(target_img, feature_detector)
    best_score = 0
    best_match_path = None

    for db_img_path in db_img_paths:
        db_img = cv2.imread(db_img_path, cv2.IMREAD_GRAYSCALE)
        db_img = preprocess_image(db_img)
        kp2, des2 = detect_and_compute(db_img, feature_detector)
        matches = match_with_bf_and_lowe(des1, des2, lowe_ratio)
        filtered_matches = [m for m in matches if m.distance < distance_threshold]

        if len(filtered_matches) >= 4:
            num_inliers = verify_homography(filtered_matches, kp1, kp2, reprojection_threshold)
            if num_inliers > best_score:
                best_score = num_inliers
                best_match_path = db_img_path

    return best_match_path, best_score


def main():
    cap = cv2.VideoCapture(0)  # Capture video from the first webcam

    while True:
        ret, frame = cap.read()  # Read a frame
        if not ret:
            print("Failed to capture video")
            break

        frame_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        # frame_preprocessed = preprocess_image(frame_gray)  # Preprocess the frame
        # kp_frame, des_frame = detect_and_compute(frame_preprocessed, feature_detector=DETECTOR)
        
        # Assuming you have a function that finds the best match from db_img_paths
        # best_match_path = find_best_match(frame_preprocessed, db_img_paths)  # You need to implement this function
        
        # Optionally visualize the keypoints on the frame
        # frame_with_keypoints = visualize_keypoints(frame_preprocessed, kp_frame)
        
        # cv2.imshow("Webcam Feed", frame_with_keypoints)
        
        # Display the best match image in a window
        # Inside your main function, after calling find_best_match
        # best_match_path, best_match_score = find_best_match(frame_preprocessed, db_img_paths)
        # if best_match_path:
        #     best_match_img = cv2.imread(best_match_path, cv2.IMREAD_GRAYSCALE)
        #     cv2.imshow("Best Match", best_match_img)
        # else:
        #     print("No best match found.")


        # Wait for 3 seconds
        if cv2.waitKey(3000) & 0xFF == ord('q'):  # Press 'q' to quit
            break

    cap.release()
    cv2.destroyAllWindows()

# target_img_path = 'test1.jpg'
# # Correctly load the target image before passing
# target_img = cv2.imread(target_img_path, cv2.IMREAD_GRAYSCALE)
# if target_img is None:
#     print(f"Failed to load image from {target_img_path}")
# else:
#     # target_img = preprocess_image(target_img)
#     top_matches = match_image_with_db(target_img, db_img_paths, feature_detector=DETECTOR)  # Pass target_img here
#     # visualize_top_matches(target_img_path, top_matches)

if __name__ == "__main__":
    # main()
    img_db_folder = 'data/db_comic_new'
    db_img_paths = get_image_paths_from_subdirs(img_db_folder)

    db_features = precompute_db_features(db_img_paths, feature_detector=DETECTOR)
    save_db_features(db_features)