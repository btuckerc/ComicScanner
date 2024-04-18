def search_comic(query_features, index, db_img_paths, top_k=3):
    # Reshape query_features for FAISS, and search for the top_k closest features
    distances, indices = index.search(query_features.reshape(1, -1), top_k)
    
    # Get the top_k closest image paths and their distances
    closest_img_paths = [db_img_paths[idx]['path'] for idx in indices[0]]
    scores = distances[0]
    
    return closest_img_paths, scores
