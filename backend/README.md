# Draw Size API - FastAPI Backend

Backend service for the Draw Size application with orthographic transformation and area calculation.

## Setup

1. **Create virtual environment**:
```bash
cd backend
python -m venv venv
```

2. **Activate virtual environment**:
- Windows: `venv\Scripts\activate`
- Linux/Mac: `source venv/bin/activate`

3. **Install dependencies**:
```bash
pip install -r requirements.txt
```

## Running the Server

```bash
# From backend directory
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Or simply:
```bash
python app/main.py
```

The API will be available at: `http://localhost:8000`

## API Documentation

Once running, visit:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Endpoints

### 1. `/upload` (POST)
Upload an image for processing.

**Request**: Multipart form with `file`
**Response**: 
```json
{
  "image_id": "uuid",
  "filename": "image.jpg",
  "width": 1920,
  "height": 1080,
  "image_data": "data:image/jpeg;base64,..."
}
```

### 2. `/transform` (POST)
Apply orthographic transformation using 4 corner points.

**Request**: Form data
- `image_id`: UUID from upload
- `corners`: JSON string with 4 points `[{"x": 0, "y": 0}, ...]`
- `height`: Real-world height in meters
- `width`: Real-world width in meters

**Response**:
```json
{
  "image_id": "uuid",
  "transformed_image": "data:image/jpeg;base64,...",
  "width": 800,
  "height": 600,
  "real_dimensions": {
    "width": 5.0,
    "height": 3.0,
    "unit": "meters"
  }
}
```

### 3. `/annotate` (POST)
*Coming soon* - For drawing annotations

### 4. `/cement-mask` (POST)
*Coming soon* - For cement mask detection

### 5. `/compute-area` (POST)
*Coming soon* - For area calculations

## Storage

Uploaded and processed images are stored in `backend/storage/` directory.
