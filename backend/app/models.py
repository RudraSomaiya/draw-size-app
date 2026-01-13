from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from .database import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = {"schema": "data"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(Text, nullable=False)
    full_name = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    projects = relationship("Project", back_populates="user", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = {"schema": "data"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("data.users.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    is_archived = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="projects")
    images = relationship("ProjectImage", back_populates="project", cascade="all, delete-orphan")


class ProjectImage(Base):
    __tablename__ = "project_images"
    __table_args__ = {"schema": "data"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("data.projects.id", ondelete="CASCADE"), nullable=False)

    original_filename = Column(Text, nullable=False)
    storage_original_path = Column(Text, nullable=False)
    storage_transformed_path = Column(Text, nullable=True)

    width_px = Column(Integer, nullable=False)
    height_px = Column(Integer, nullable=False)

    real_width = Column(Numeric, nullable=True)
    real_height = Column(Numeric, nullable=True)
    real_unit = Column(String, nullable=True)

    mask_coverage_percent = Column(Numeric, nullable=True)
    deselect_area = Column(Numeric, nullable=True)
    effective_deselect_area = Column(Numeric, nullable=True)
    usable_area = Column(Numeric, nullable=True)
    cemented_area = Column(Numeric, nullable=True)
    cemented_percent = Column(Numeric, nullable=True)

    sort_key_numeric = Column(Numeric, nullable=True)

    status = Column(String, nullable=False, default="new")
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    project = relationship("Project", back_populates="images")
    deselections = relationship(
        "ImageDeselection", back_populates="image", cascade="all, delete-orphan"
    )


class ImageDeselection(Base):
    __tablename__ = "image_deselections"
    __table_args__ = {"schema": "data"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    image_id = Column(UUID(as_uuid=True), ForeignKey("data.project_images.id", ondelete="CASCADE"), nullable=False)

    shape = Column(Enum("rect", "circle", "irregular", name="deselect_shape", schema="data"), nullable=False)
    count = Column(Integer, nullable=False, default=1)

    length = Column(Numeric, nullable=True)
    breadth = Column(Numeric, nullable=True)
    diameter = Column(Numeric, nullable=True)
    area = Column(Numeric, nullable=True)

    unit = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    image = relationship("ProjectImage", back_populates="deselections")


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = {"schema": "data"}

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("data.users.id", ondelete="SET NULL"), nullable=True)
    event_type = Column(Text, nullable=False)
    entity_type = Column(Text, nullable=True)
    entity_id = Column(UUID(as_uuid=True), nullable=True)
    payload = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
