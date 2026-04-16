from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


@dataclass
class LabelRecord:
    label: str
    points: list[list[float]]
    confidence: float | None = None
    track_id: int | None = None
    difficult: bool = False
    extra: dict[str, Any] = field(default_factory=dict)


class AnnotationFormat:
    key = ""
    display_name = ""
    supports_obb = False

    def load(self, annotation_path: Path, image_width: int, image_height: int) -> list[LabelRecord]:
        raise NotImplementedError

    def save(
        self,
        annotation_path: Path,
        image_width: int,
        image_height: int,
        labels: list[LabelRecord],
        class_names: list[str],
    ) -> None:
        raise NotImplementedError


class YoloObbFormat(AnnotationFormat):
    key = "yolo_obb"
    display_name = "YOLO OBB"
    supports_obb = True

    def load(self, annotation_path: Path, image_width: int, image_height: int) -> list[LabelRecord]:
        if not annotation_path.exists():
            return []

        labels: list[LabelRecord] = []
        for raw_line in annotation_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line:
                continue
            parts = line.split()
            if len(parts) < 9:
                continue

            class_id = parts[0]
            coords = [float(value) for value in parts[1:9]]
            is_normalized = all(0.0 <= value <= 1.0 for value in coords)
            points: list[list[float]] = []
            for index in range(0, 8, 2):
                x = coords[index]
                y = coords[index + 1]
                if is_normalized:
                    x *= image_width
                    y *= image_height
                points.append([x, y])

            confidence = float(parts[9]) if len(parts) >= 10 else None
            track_id = int(parts[10]) if len(parts) >= 11 else None
            labels.append(
                LabelRecord(
                    label=str(class_id),
                    points=points,
                    confidence=confidence,
                    track_id=track_id,
                )
            )
        return labels

    def save(
        self,
        annotation_path: Path,
        image_width: int,
        image_height: int,
        labels: list[LabelRecord],
        class_names: list[str],
    ) -> None:
        annotation_path.parent.mkdir(parents=True, exist_ok=True)
        lines: list[str] = []
        width = max(1, image_width)
        height = max(1, image_height)

        for item in labels:
            class_index = _resolve_class_index(item.label, class_names)
            flat_points: list[str] = []
            for x, y in item.points[:4]:
                flat_points.append(f"{float(x) / width:.6f}")
                flat_points.append(f"{float(y) / height:.6f}")

            row = [str(class_index), *flat_points]
            if item.confidence is not None:
                row.append(f"{float(item.confidence):.6f}")
            if item.track_id is not None:
                row.append(str(int(item.track_id)))
            lines.append(" ".join(row))

        annotation_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


class ReservedAnnotationFormat(AnnotationFormat):
    def __init__(self, key: str, display_name: str, supports_obb: bool = False) -> None:
        self.key = key
        self.display_name = display_name
        self.supports_obb = supports_obb

    def load(self, annotation_path: Path, image_width: int, image_height: int) -> list[LabelRecord]:
        return []

    def save(
        self,
        annotation_path: Path,
        image_width: int,
        image_height: int,
        labels: list[LabelRecord],
        class_names: list[str],
    ) -> None:
        raise NotImplementedError(f"Format `{self.key}` is reserved but not implemented yet.")


def _resolve_class_index(label: str, class_names: list[str]) -> int:
    try:
        return int(label)
    except (TypeError, ValueError):
        pass

    if label in class_names:
        return class_names.index(label)
    return 0


FORMAT_REGISTRY: dict[str, AnnotationFormat] = {
    "yolo_obb": YoloObbFormat(),
    "yolo_hbb": ReservedAnnotationFormat("yolo_hbb", "YOLO HBB"),
    "labelimg_obb": ReservedAnnotationFormat("labelimg_obb", "LabelImg OBB", supports_obb=True),
    "dota": ReservedAnnotationFormat("dota", "DOTA", supports_obb=True),
}


def get_annotation_format(format_key: str) -> AnnotationFormat:
    try:
        return FORMAT_REGISTRY[format_key]
    except KeyError as exc:
        raise ValueError(f"Unsupported format: {format_key}") from exc
