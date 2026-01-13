from datetime import timedelta
from pathlib import Path
from typing import List
from uuid import UUID, uuid4

import base64
import json

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from .database import get_db
from . import models, schemas
from .auth import (
    authenticate_user,
    create_access_token,
    get_current_active_user,
    get_password_hash,
)


router = APIRouter()


STORAGE_DIR = Path("storage")
STORAGE_DIR.mkdir(exist_ok=True)


# ============================
# Auth routes
# ============================


@router.post("/auth/signup", response_model=schemas.UserRead)
async def signup(user_in: schemas.UserCreate, db: AsyncSession = Depends(get_db)):
    # Check existing user
    existing = await db.execute(select(models.User).where(models.User.email == user_in.email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = models.User(
        email=user_in.email,
        full_name=user_in.full_name,
        hashed_password=get_password_hash(user_in.password),
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/auth/login", response_model=schemas.Token)
async def login_for_access_token(
    email: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    user = await authenticate_user(db, email, password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")

    access_token = create_access_token({"sub": str(user.id)})
    return schemas.Token(access_token=access_token)


@router.get("/auth/me", response_model=schemas.UserRead)
async def read_users_me(current_user: models.User = Depends(get_current_active_user)):
    return current_user


# ============================
# Project routes
# ============================


@router.get("/projects", response_model=List[schemas.ProjectRead])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    result = await db.execute(
        select(models.Project)
        .where(models.Project.user_id == current_user.id)
        .order_by(models.Project.created_at.desc())
    )
    return result.scalars().all()


@router.post("/projects", response_model=schemas.ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_in: schemas.ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    project = models.Project(
        user_id=current_user.id,
        name=project_in.name,
        description=project_in.description,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    result = await db.execute(
        select(models.Project).where(
            models.Project.id == project_id, models.Project.user_id == current_user.id
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    await db.delete(project)
    await db.commit()
    return JSONResponse(status_code=status.HTTP_204_NO_CONTENT, content=None)


# ============================
# Project images routes
# ============================


@router.get("/projects/{project_id}/images", response_model=List[schemas.ProjectImageRead])
async def list_project_images(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    # Ensure project belongs to user
    project_q = await db.execute(
        select(models.Project).where(
            models.Project.id == project_id, models.Project.user_id == current_user.id
        )
    )
    if not project_q.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    result = await db.execute(
        select(models.ProjectImage)
        .where(models.ProjectImage.project_id == project_id)
        .order_by(models.ProjectImage.created_at.desc())
    )
    return result.scalars().all()


@router.get("/projects/{project_id}/images/{image_id}", response_model=schemas.ProjectImageRead)
async def get_project_image(
    project_id: UUID,
    image_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    result = await db.execute(
        select(models.ProjectImage)
        .join(models.Project)
        .where(
            models.ProjectImage.id == image_id,
            models.ProjectImage.project_id == project_id,
            models.Project.user_id == current_user.id,
        )
    )
    image = result.scalar_one_or_none()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    return image


@router.get("/projects/{project_id}/images/{image_id}/original")
async def get_project_image_original(
    project_id: UUID,
    image_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    result = await db.execute(
        select(models.ProjectImage)
        .join(models.Project)
        .where(
            models.ProjectImage.id == image_id,
            models.ProjectImage.project_id == project_id,
            models.Project.user_id == current_user.id,
        )
    )
    image = result.scalar_one_or_none()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    img = cv2.imread(image.storage_original_path)
    if img is None:
        raise HTTPException(status_code=500, detail="Stored image could not be read")

    _, buffer = cv2.imencode(".jpg", img)
    img_base64 = base64.b64encode(buffer).decode("utf-8")

    return {
        "image_id": str(image.id),
        "image_data": f"data:image/jpeg;base64,{img_base64}",
        "width": image.width_px,
        "height": image.height_px,
    }


@router.get("/projects/{project_id}/images/{image_id}/next", response_model=schemas.ProjectImageRead)
async def get_next_image(
    project_id: UUID,
    image_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    # Validate project ownership
    project_q = await db.execute(
        select(models.Project).where(
            models.Project.id == project_id, models.Project.user_id == current_user.id
        )
    )
    if not project_q.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    # For now, define order as created_at DESC, and "next" = previous in time
    current_q = await db.execute(
        select(models.ProjectImage).where(
            models.ProjectImage.id == image_id,
            models.ProjectImage.project_id == project_id,
        )
    )
    current = current_q.scalar_one_or_none()
    if not current:
        raise HTTPException(status_code=404, detail="Image not found")

    result = await db.execute(
        select(models.ProjectImage)
        .where(
            models.ProjectImage.project_id == project_id,
            models.ProjectImage.created_at < current.created_at,
        )
        .order_by(models.ProjectImage.created_at.desc())
    )
    next_image = result.scalars().first()
    if not next_image:
        raise HTTPException(status_code=404, detail="No next image")

    return next_image


# ============================
# Project-bound upload / transform / analysis
# ============================


@router.post(
    "/projects/{project_id}/images/upload",
    response_model=schemas.ProjectImageUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_project_image(
    project_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    # Ensure project belongs to user
    project_q = await db.execute(
        select(models.Project).where(
            models.Project.id == project_id, models.Project.user_id == current_user.id
        )
    )
    project = project_q.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Validate file type
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    contents = await file.read()

    # Decode to get dimensions
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image file")

    height_px, width_px = img.shape[0], img.shape[1]

    # Save original to disk
    storage_name = f"{uuid4()}_original.jpg"
    image_path = STORAGE_DIR / storage_name
    cv2.imwrite(str(image_path), img)

    # Create DB row
    db_image = models.ProjectImage(
        project_id=project.id,
        original_filename=file.filename,
        storage_original_path=str(image_path),
        width_px=width_px,
        height_px=height_px,
        status="new",
    )
    db.add(db_image)
    await db.commit()
    await db.refresh(db_image)

    # Prepare base64 for frontend
    _, buffer = cv2.imencode(".jpg", img)
    img_base64 = base64.b64encode(buffer).decode("utf-8")

    return schemas.ProjectImageUploadResponse(
        id=db_image.id,
        project_id=db_image.project_id,
        width_px=db_image.width_px,
        height_px=db_image.height_px,
        original_filename=db_image.original_filename,
        image_data=f"data:image/jpeg;base64,{img_base64}",
    )


@router.post("/projects/{project_id}/images/{image_id}/transform")
async def transform_project_image(
    project_id: UUID,
    image_id: UUID,
    corners: str = Form(...),  # JSON string of 4 corner points
    height: float = Form(...),  # Real-world height in meters
    width: float = Form(...),  # Real-world width in meters
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    # Validate ownership and fetch image
    result = await db.execute(
        select(models.ProjectImage)
        .join(models.Project)
        .where(
            models.ProjectImage.id == image_id,
            models.ProjectImage.project_id == project_id,
            models.Project.user_id == current_user.id,
        )
    )
    db_image = result.scalar_one_or_none()
    if not db_image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Parse corners
    try:
        corners_data = json.loads(corners)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid corners format")

    if len(corners_data) != 4:
        raise HTTPException(status_code=400, detail="Exactly 4 corners required")

    # Load original image from disk
    img = cv2.imread(db_image.storage_original_path)
    if img is None:
        raise HTTPException(status_code=500, detail="Stored image could not be read")

    # Convert corners to numpy array
    src_points = np.float32(
        [
            [corners_data[0]["x"], corners_data[0]["y"]],
            [corners_data[1]["x"], corners_data[1]["y"]],
            [corners_data[2]["x"], corners_data[2]["y"]],
            [corners_data[3]["x"], corners_data[3]["y"]],
        ]
    )

    # Calculate aspect ratio from real-world dimensions
    aspect_ratio = width / height

    # Define output dimensions (maintain aspect ratio)
    output_height = 800
    output_width = int(output_height * aspect_ratio)

    # Destination points
    dst_points = np.float32(
        [
            [0, 0],
            [output_width, 0],
            [output_width, output_height],
            [0, output_height],
        ]
    )

    matrix = cv2.getPerspectiveTransform(src_points, dst_points)
    transformed = cv2.warpPerspective(img, matrix, (output_width, output_height))

    # Save transformed image
    transform_path = STORAGE_DIR / f"{image_id}_transformed.jpg"
    cv2.imwrite(str(transform_path), transformed)

    # Update DB with transform info
    db_image.storage_transformed_path = str(transform_path)
    db_image.real_width = width
    db_image.real_height = height
    db_image.real_unit = "m"  # Frontend normalizes 'meters'/'m'
    db_image.status = "ready"
    await db.commit()
    await db.refresh(db_image)

    # Convert to base64 for response
    _, buffer = cv2.imencode(".jpg", transformed)
    img_base64 = base64.b64encode(buffer).decode("utf-8")

    return {
        "image_id": str(db_image.id),
        "transformed_image": f"data:image/jpeg;base64,{img_base64}",
        "width": output_width,
        "height": output_height,
        "real_dimensions": {
            "width": width,
            "height": height,
            "unit": "meters",
        },
    }


@router.post("/projects/{project_id}/images/{image_id}/analysis", response_model=schemas.ProjectImageRead)
async def save_image_analysis(
    project_id: UUID,
    image_id: UUID,
    analysis: schemas.ImageAnalysisUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    # Validate ownership and fetch image
    result = await db.execute(
        select(models.ProjectImage)
        .join(models.Project)
        .where(
            models.ProjectImage.id == image_id,
            models.ProjectImage.project_id == project_id,
            models.Project.user_id == current_user.id,
        )
    )
    db_image = result.scalar_one_or_none()
    if not db_image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Update numeric fields if provided
    for field in [
        "mask_coverage_percent",
        "deselect_area",
        "effective_deselect_area",
        "usable_area",
        "cemented_area",
        "cemented_percent",
        "sort_key_numeric",
        "real_width",
        "real_height",
        "real_unit",
    ]:
        value = getattr(analysis, field)
        if value is not None:
            setattr(db_image, field, value)

    # Replace deselection items if provided
    if analysis.deselections is not None:
        await db.execute(
            delete(models.ImageDeselection).where(
                models.ImageDeselection.image_id == db_image.id
            )
        )
        for item in analysis.deselections:
            db_item = models.ImageDeselection(
                image_id=db_image.id,
                shape=item.shape,
                count=item.count,
                length=item.length,
                breadth=item.breadth,
                diameter=item.diameter,
                area=item.area,
                unit=item.unit,
            )
            db.add(db_item)

    await db.commit()
    await db.refresh(db_image)

    return db_image
