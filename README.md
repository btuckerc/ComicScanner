# ComicScanner

ComicScanner is a tool designed to scan and catalog comic book collections. It allows users to easily manage their comic book library by scanning barcodes, retrieving metadata, and organizing the collection.

## Features

- Barcode scanning for quick cataloging
- Automatic retrieval of comic metadata
- User-friendly interface for managing collections
- Support for multiple comic book databases
- Export and import functionality for backups

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [License](#license)

## Installation

### Prerequisites

- Python 3.7 or higher
- pip (Python package installer)

### Steps

1. Clone the repository:
    ```bash
    git clone https://github.com/btuckerc/ComicScanner.git
    cd ComicScanner
    ```

2. Create a virtual environment:
    ```bash
    python3 -m venv venv
    source venv/bin/activate  # On Windows use `venv\Scripts\activate`
    ```

3. Install the required dependencies:
    ```bash
    pip install -r requirements.txt
    ```

## Usage

1. Activate the virtual environment if not already activated:
    ```bash
    source venv/bin/activate  # On Windows use `venv\Scripts\activate`
    ```

2. Run the application:
    ```bash
    python run.py
    ```

3. Follow the on-screen instructions to start scanning and managing your comic book collection.

## Configuration

Configuration options can be found in the `config.yaml` file. Modify this file to customize the behavior of ComicScanner.

### Example `config.yaml`

```yaml
database:
  name: comic_db
  user: user
  password: password
  host: localhost
  port: 5432

scanner:
  device: /dev/usbscanner
  resolution: 300

metadata_sources:
  - source: 'ComicVine'
  - source: 'GrandComicsDatabase'
```

## Contributing
We welcome contributions! Please follow these steps:

### Fork the repository.
Create a new branch (git checkout -b feature/YourFeature).
Make your changes and commit them (git commit -m 'Add some feature').
Push to the branch (git push origin feature/YourFeature).
Open a pull request.

## License
This project is licensed under the MIT License. See the LICENSE file for details.
