from datetime import datetime
from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, EmailStr


# ========================
# Auth & User Schemas
# ========================


class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None


class UserCreate(UserBase):
    password: str


class UserRead(UserBase):
    id: UUID
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    user_id: Optional[UUID] = None


# ========================
# Project & Image Schemas
# ========================


class ProjectBase(BaseModel):
    name: str
    description: Optional[str] = None


class ProjectCreate(ProjectBase):
    pass


class ProjectRead(ProjectBase):
    id: UUID
    is_archived: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProjectImageBase(BaseModel):
    original_filename: str


class ProjectImageCreate(ProjectImageBase):
    pass


class ProjectImageRead(ProjectImageBase):
    id: UUID
    project_id: UUID
    width_px: int
    height_px: int
    real_width: Optional[float] = None
    real_height: Optional[float] = None
    real_unit: Optional[str] = None
    mask_coverage_percent: Optional[float] = None
    deselect_area: Optional[float] = None
    effective_deselect_area: Optional[float] = None
    usable_area: Optional[float] = None
    cemented_area: Optional[float] = None
    cemented_percent: Optional[float] = None
    sort_key_numeric: Optional[float] = None
    status: str
    error_message: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ProjectImageUploadResponse(BaseModel):
    id: UUID
    project_id: UUID
    width_px: int
    height_px: int
    original_filename: str
    image_data: str  # data URL (base64) used by the frontend


class DeselectItemBase(BaseModel):
    shape: str
    count: int
    length: Optional[float] = None
    breadth: Optional[float] = None
    diameter: Optional[float] = None
    area: Optional[float] = None
    unit: str


class DeselectItemCreate(DeselectItemBase):
    pass


class DeselectItemRead(DeselectItemBase):
    id: UUID

    class Config:
        from_attributes = True


class ImageAnalysisUpdate(BaseModel):
    mask_coverage_percent: Optional[float] = None
    deselect_area: Optional[float] = None
    effective_deselect_area: Optional[float] = None
    usable_area: Optional[float] = None
    cemented_area: Optional[float] = None
    cemented_percent: Optional[float] = None
    sort_key_numeric: Optional[float] = None
    real_width: Optional[float] = None
    real_height: Optional[float] = None
    real_unit: Optional[str] = None
    deselections: Optional[List[DeselectItemCreate]] = None
    cemented_image: Optional[str] = None

