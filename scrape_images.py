import os
import json
import requests
import xml.etree.ElementTree as ET

import concurrent.futures

session = requests.Session()
session.headers = {'Accept-Encoding': 'gzip'}

file_counter = 0
directory_index = 0
max_files_per_directory = 500

def ensure_directory_exists(directory):
    if not os.path.exists(directory):
        os.makedirs(directory)

def get_save_directory(base_path):
    global file_counter, directory_index, max_files_per_directory
    # Calculate total files as pairs
    total_files = file_counter * 2
    if total_files >= max_files_per_directory * 2:  # Multiply by 2 as each pair includes two files
        directory_index += 1
        file_counter = 0
    save_directory = os.path.join(base_path, f"set_{directory_index}")
    ensure_directory_exists(save_directory)
    return save_directory

def download_image(comic_id, image_url, base_path):
    save_path = get_save_directory(base_path)
    # Get the filename from the URL
    filename = comic_id + '.' + image_url.split('.')[-1]
    file_path = os.path.join(save_path, filename)

    # Check if the file already exists to avoid re-downloading it
    if not os.path.exists(file_path):
        # Download and save the image
        response = session.get(image_url)
        with open(file_path, 'wb') as f:
            f.write(response.content)
        print(f"Downloaded and saved: {file_path}")

def save_metadata(comic_id, metadata, base_path):
    save_path = get_save_directory(base_path)
    # Save the metadata to a JSON file
    filename = comic_id + '.json'
    metadata_file = os.path.join(save_path, filename)
    with open(metadata_file, 'w') as f:
        json.dump(metadata, f, indent=4)
    print(f"Saved metadata: {metadata_file}")

def process_comic_entry(comic, base_path):
    global file_counter
    # Create a directory for the comic series if it doesn't exist
    comic_id = comic.find('./bpcomicid').text
    series_name = comic.find('./mainsection/series/displayname').text
    issue_number = comic.find('./issuenr').text if comic.find('./issuenr') is not None else None
    issue_number_ext = comic.find('./issueext').text if comic.find('./issueext') is not None else None
    #series_path = os.path.join(save_path, series_name)
    ensure_directory_exists(save_path)

    # Get the cover image URL
    cover_url = comic.find('./coverfrontdefault').text if comic.find('./coverfrontdefault') is not None else None
    if cover_url:
        download_image(comic_id, cover_url, base_path)

    # Prepare metadata
        #"Purchase Date","Purchase Store","Purchase Price","Cover Price","CovrPrice Value"
        # key, keycat, keyreason
    # Prepare metadata
    metadata = {
        'series': series_name,
        'issue_number': issue_number,
        'issue_ext': issue_number_ext,
        'publisher': comic.find('./publisher/displayname').text if comic.find('./publisher/displayname') is not None else None,
        'cover_date': comic.find('./coverdate/date').text if comic.find('./coverdate/date') is not None else None,
        'purchase_date': comic.find('./store/displayname').text if comic.find('./store/displayname') is not None else None,
        'purchase_date': comic.find('./purchasedate/date').text if comic.find('./purchasedate/date') is not None else None,
        'value': comic.find('./covrprice/value').text if comic.find('./covrprice/value') is not None else None,
        'cover_url': cover_url,
        'collection_status': comic.find('./collectionstatus').text if comic.find('./collectionstatus') is not None else None,
        'age': comic.find('./age/displayname').text if comic.find('./age/displayname') is not None else None,
        'key': comic.find('./iskeycomic').text if comic.find('./iskeycomic') is not None else None,
        'key_reason': comic.find('./keycomicreason').text if comic.find('./keycomicreason') is not None else None
    }
    metadata.update({child.tag: child.text for child in comic.iter() if child.text and child.tag not in metadata})

    save_metadata(comic_id, metadata, base_path)
    file_counter += 2

def parse_xml_and_process_entries(xml_file, save_path):
    # Parse the XML file
    tree = ET.parse(xml_file)
    root = tree.getroot()

    # Process each comic entry in parallel
    with concurrent.futures.ThreadPoolExecutor() as executor:
        futures = []
        for comic in root.findall('./data/comicinfo/comiclist/comic'):
            futures.append(executor.submit(process_comic_entry, comic, save_path))
        # Wait for all futures to complete
        concurrent.futures.wait(futures)

# def process_csv_concurrently(csv_path, save_path):
#     ensure_directory_exists(save_path)
#     with open(csv_path, newline='', encoding='utf-8') as csvfile:
#         reader = csv.DictReader(csvfile)
#         with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
#             futures = [executor.submit(process_row, row, save_path) for row in reader]
#             concurrent.futures.wait(futures)

# Example usage
xml_file_path = 'clz_comics.xml'
save_path = 'data/db_comic_new'
parse_xml_and_process_entries(xml_file_path, save_path)