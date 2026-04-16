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

    def list_images(self, requested_path: str | None = None) -> tuple[Path, list[ImageEntry]]:
        data_dir = self.resolve_data_dir(requested_path)
        images: list[ImageEntry] = []
        for image_path in sorted(data_dir.rglob("*")):
            if image_path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            width, height = _get_image_size(image_path)
            rel = image_path.relative_to(data_dir)
            image_id = quote(rel.as_posix(), safe="")
            annotation_path = image_path.with_suffix(".txt")
            images.append(
                ImageEntry(
                    image_id=image_id,
                    name=rel.as_posix(),
                    image_path=image_path,
                    annotation_path=annotation_path,
                    width=width,
                    height=height,
                )
            )
        return data_dir, images

    def get_image_entry(self, requested_path: str | None, image_id: str) -> tuple[Path, ImageEntry]:
        data_dir, images = self.list_images(requested_path)
        image_map = {item.image_id: item for item in images}
        if image_id not in image_map:
            raise FileNotFoundError(f"Image not found: {image_id}")
        return data_dir, image_map[image_id]

    def guess_media_type(self, image_path: Path) -> str:
        media_type, _ = mimetypes.guess_type(image_path.name)
        return media_type or "application/octet-stream"


def _get_image_size(image_path: Path) -> tuple[int, int]:
    with Image.open(image_path) as image:
        return image.size
