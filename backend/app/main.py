from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import cv2
import numpy as np
from PIL import Image
import io
import base64
from typing import List
import uuid
from pathlib import Path
import json

app = FastAPI(title="Draw Size API", version="1.0.0")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://127.0.0.1:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Storage directory
STORAGE_DIR = Path("storage")
STORAGE_DIR.mkdir(exist_ok=True)

# In-memory storage for uploaded images (session-based)
image_store = {}


@app.get("/")
async def root():
    """Root endpoint"""
    print("📍 Root endpoint called")
    return {"message": "Draw Size API is running", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    print("✅ Health check called")
    return {"status": "healthy", "service": "draw-size-api"}


@app.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    """
    Upload an image and store it temporarily
    Returns: image_id for subsequent operations
    """
    print(f"\n📤 Upload request received")
    print(f"   Filename: {file.filename}")
    print(f"   Content-Type: {file.content_type}")
    
    try:
        # Validate file type
        if not file.content_type.startswith("image/"):
            print(f"❌ Invalid file type: {file.content_type}")
            raise HTTPException(status_code=400, detail="File must be an image")
        
        # Read image data
        contents = await file.read()
        print(f"   File size: {len(contents)} bytes")
        
        # Convert to numpy array
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            print("❌ Failed to decode image")
            raise HTTPException(status_code=400, detail="Invalid image file")
        
        print(f"   Image shape: {img.shape}")
        
        # Generate unique ID
        image_id = str(uuid.uuid4())
        
        # Store image in memory
        image_store[image_id] = {
            "original": img,
            "filename": file.filename,
            "shape": img.shape
        }
        
        # Save to disk as well
        image_path = STORAGE_DIR / f"{image_id}_original.jpg"
        cv2.imwrite(str(image_path), img)
        print(f"   Saved to: {image_path}")
        
        # Convert to base64 for response
        _, buffer = cv2.imencode('.jpg', img)
        img_base64 = base64.b64encode(buffer).decode('utf-8')
        
        print(f"✅ Upload successful - Image ID: {image_id}")
        
        return {
            "image_id": image_id,
            "filename": file.filename,
            "width": img.shape[1],
            "height": img.shape[0],
            "image_data": f"data:image/jpeg;base64,{img_base64}"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Upload error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing image: {str(e)}")


@app.post("/transform")
async def transform_image(
    image_id: str = Form(...),
    corners: str = Form(...),  # JSON string of 4 corner points
    height: float = Form(...),  # Real-world height in meters
    width: float = Form(...)    # Real-world width in meters
):
    """
    Apply orthographic transformation to the image using 4 corner points
    
    Args:
        image_id: ID from /upload endpoint
        corners: JSON string with 4 points [{"x": 0, "y": 0}, ...]
        height: Real-world height of the wall in meters
        width: Real-world width of the wall in meters
    
    Returns:
        Transformed (orthographic) image
    """
    print(f"\n🔄 Transform request received")
    print(f"   Image ID: {image_id}")
    print(f"   Dimensions: {width}m x {height}m")
    
    try:
        # Validate image exists
        if image_id not in image_store:
            print(f"❌ Image not found: {image_id}")
            raise HTTPException(status_code=404, detail="Image not found")
        
        # Parse corners
        try:
            corners_data = json.loads(corners)
            print(f"   Corners received: {corners_data}")
        except json.JSONDecodeError:
            print("❌ Invalid corners JSON")
            raise HTTPException(status_code=400, detail="Invalid corners format")
        
        if len(corners_data) != 4:
            print(f"❌ Expected 4 corners, got {len(corners_data)}")
            raise HTTPException(status_code=400, detail="Exactly 4 corners required")
        
        # Get original image
        img = image_store[image_id]["original"]
        print(f"   Original image shape: {img.shape}")
        
        # Convert corners to numpy array
        src_points = np.float32([
            [corners_data[0]["x"], corners_data[0]["y"]],
            [corners_data[1]["x"], corners_data[1]["y"]],
            [corners_data[2]["x"], corners_data[2]["y"]],
            [corners_data[3]["x"], corners_data[3]["y"]]
        ])
        print(f"   Source points:\n{src_points}")
        
        # Calculate aspect ratio from real-world dimensions
        aspect_ratio = width / height
        
        # Define output dimensions (maintain aspect ratio)
        output_height = 800
        output_width = int(output_height * aspect_ratio)
        
        # Define destination points (rectangle)
        dst_points = np.float32([
            [0, 0],                          # Top-left
            [output_width, 0],               # Top-right
            [output_width, output_height],   # Bottom-right
            [0, output_height]               # Bottom-left
        ])
        print(f"   Destination points:\n{dst_points}")
        print(f"   Output dimensions: {output_width}x{output_height}")
        
        # Calculate perspective transform matrix
        matrix = cv2.getPerspectiveTransform(src_points, dst_points)
        print(f"   Transform matrix calculated")
        
        # Apply transformation
        transformed = cv2.warpPerspective(img, matrix, (output_width, output_height))
        print(f"   Transformation applied - Result shape: {transformed.shape}")
        
        # Store transformed image
        image_store[image_id]["transformed"] = transformed
        image_store[image_id]["dimensions"] = {"width": width, "height": height}
        
        # Save to disk
        transform_path = STORAGE_DIR / f"{image_id}_transformed.jpg"
        cv2.imwrite(str(transform_path), transformed)
        print(f"   Saved to: {transform_path}")
        
        # Convert to base64
        _, buffer = cv2.imencode('.jpg', transformed)
        img_base64 = base64.b64encode(buffer).decode('utf-8')
        
        print(f"✅ Transform successful")
        
        return {
            "image_id": image_id,
            "transformed_image": f"data:image/jpeg;base64,{img_base64}",
            "width": output_width,
            "height": output_height,
            "real_dimensions": {
                "width": width,
                "height": height,
                "unit": "meters"
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Transform error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error transforming image: {str(e)}")


@app.post("/annotate")
async def annotate_image():
    """Placeholder for annotation endpoint"""
    print("\n✏️ Annotate endpoint called (not implemented yet)")
    return {"message": "Annotate endpoint - Coming soon"}


@app.post("/cement-mask")
async def cement_mask():
    """Placeholder for cement mask endpoint"""
    print("\n🎭 Cement mask endpoint called (not implemented yet)")
    return {"message": "Cement mask endpoint - Coming soon"}


@app.post("/compute-area")
async def compute_area():
    """Placeholder for compute area endpoint"""
    print("\n📐 Compute area endpoint called (not implemented yet)")
    return {"message": "Compute area endpoint - Coming soon"}


if __name__ == "__main__":
    import uvicorn
    print("🚀 Starting FastAPI server...")
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
