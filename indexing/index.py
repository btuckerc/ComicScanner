import faiss
import numpy as np

def create_index(db_features):
    dimension = db_features.shape[1]  # The dimension of the feature vectors
    index = faiss.IndexFlatL2(dimension)
    index.add(db_features)  # Add the vectors to the index
    return index

def save_index(index, path):
    faiss.write_index(index, path)

def load_index(path):
    return faiss.read_index(path)