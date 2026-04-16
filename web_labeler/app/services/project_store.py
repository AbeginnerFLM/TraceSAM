from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from PIL import Image

from .annotation_formats import IMAGE_EXTENSIONS


@dataclass
class ImageEntry:
    image_id: str
    name: str
    image_path: Path
    annotation_path: Path
    relative_path: Path
    width: int
    height: int


class ProjectStore:
    def __init__(self, base_dir: str | Path) -> None:
        self.base_dir = Path(base_dir).resolve()

    def resolve_data_dir(self, requested_path: str | None = None) -> Path:
        target = self.base_dir if not requested_path else Path(requested_path).expanduser().resolve()
        if not target.exists():
            raise FileNotFoundError(f"Directory not found: {target}")
        if not target.is_dir():
            raise NotADirectoryError(f"Not a directory: {target}")
        return target

    def list_images(
        self,
        image_dir: str | None = None,
        label_dir: str | None = None,
    ) -> tuple[Path, Path | None, list[ImageEntry]]:
        data_dir = self.resolve_data_dir(image_dir)
        annotations_dir = self.resolve_data_dir(label_dir) if label_dir else None
        images: list[ImageEntry] = []
        for image_path in sorted(data_dir.rglob("*")):
            if image_path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            width, height = _get_image_size(image_path)
            rel = image_path.relative_to(data_dir)
            image_id = quote(rel.as_posix(), safe="")
            annotation_path = (annotations_dir / rel).with_suffix(".txt") if annotations_dir else image_path.with_suffix(".txt")
            images.append(
                ImageEntry(
                    image_id=image_id,
                    name=rel.as_posix(),
                    image_path=image_path,
                    annotation_path=annotation_path,
                    relative_path=rel,
                    width=width,
                    height=height,
                )
            )
        return data_dir, annotations_dir, images

    def get_image_entry(
        self,
        image_dir: str | None,
        label_dir: str | None,
        image_id: str,
    ) -> tuple[Path, Path | None, ImageEntry]:
        data_dir, annotations_dir, images = self.list_images(image_dir, label_dir)
        image_map = {item.image_id: item for item in images}
        if image_id not in image_map:
            raise FileNotFoundError(f"Image not found: {image_id}")
        return data_dir, annotations_dir, image_map[image_id]

    def browse_directories(self, requested_path: str | None = None) -> dict:
        current = self.resolve_data_dir(requested_path)
        children = [
            {
                "name": child.name,
                "path": str(child),
            }
            for child in sorted(current.iterdir())
            if child.is_dir()
        ]
        parent = str(current.parent) if current != current.parent else None
        return {
            "current_path": str(current),
            "parent_path": parent,
            "children": children,
        }

    def guess_media_type(self, image_path: Path) -> str:
        media_type, _ = mimetypes.guess_type(image_path.name)
        return media_type or "application/octet-stream"


def _get_image_size(image_path: Path) -> tuple[int, int]:
    with Image.open(image_path) as image:
        return image.size
