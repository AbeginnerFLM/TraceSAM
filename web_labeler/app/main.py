from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .services.annotation_formats import FORMAT_REGISTRY, LabelRecord, get_annotation_format
from .services.project_store import ProjectStore
from .services.sam_service import SamService


BASE_DIR = Path(os.environ.get("TRACE_SAM_DATA_ROOT", "/projects/TraceSAM/projects")).resolve()
SAM_MODEL = os.environ.get("LABELIMG_SAM_MODEL")

app = FastAPI(title="TraceSAM Web Labeler")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

project_store = ProjectStore(BASE_DIR)
sam_service = SamService(SAM_MODEL)


class AnnotationPayload(BaseModel):
    format: str = "yolo_obb"
    class_names: list[str] = Field(default_factory=list)
    image_dir: str | None = None
    label_dir: str | None = None
    labels: list[dict]


class SamPromptPayload(BaseModel):
    image_dir: str | None = None
    label_dir: str | None = None
    image_id: str
    x: float
    y: float
    label: str | None = None


@app.get("/api/config")
def get_config() -> dict:
    return {
        "base_dir": str(BASE_DIR),
        "defaults": {
            "image_dir": str(BASE_DIR),
            "label_dir": str(BASE_DIR),
        },
        "formats": [
            {
                "key": item.key,
                "display_name": item.display_name,
                "supports_obb": item.supports_obb,
                "implemented": item.key == "yolo_obb",
            }
            for item in FORMAT_REGISTRY.values()
        ],
        "sam_enabled": True,
    }


@app.get("/api/browse")
def browse_directories(path: str | None = Query(default=None)) -> dict:
    try:
        return project_store.browse_directories(path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/images")
def list_images(
    image_dir: str | None = Query(default=None),
    label_dir: str | None = Query(default=None),
) -> dict:
    try:
        resolved_image_dir, resolved_label_dir, items = project_store.list_images(image_dir, label_dir)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "image_dir": str(resolved_image_dir),
        "label_dir": str(resolved_label_dir) if resolved_label_dir else None,
        "images": [
            {
                "id": item.image_id,
                "name": item.name,
                "width": item.width,
                "height": item.height,
                "relative_path": item.relative_path.as_posix(),
                "annotation_path": str(item.annotation_path),
            }
            for item in items
        ],
    }


@app.get("/api/image")
def get_image_file(
    image_id: str,
    image_dir: str | None = Query(default=None),
    label_dir: str | None = Query(default=None),
):
    try:
        _, _, entry = project_store.get_image_entry(image_dir, label_dir, image_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(entry.image_path, media_type=project_store.guess_media_type(entry.image_path))


@app.get("/api/annotations")
def get_annotations(
    image_id: str,
    image_dir: str | None = Query(default=None),
    label_dir: str | None = Query(default=None),
    format: str = Query(default="yolo_obb"),
) -> dict:
    try:
        _, _, entry = project_store.get_image_entry(image_dir, label_dir, image_id)
        annotation_format = get_annotation_format(format)
        labels = annotation_format.load(entry.annotation_path, entry.width, entry.height)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return {
        "image": {
            "id": entry.image_id,
            "name": entry.name,
            "width": entry.width,
            "height": entry.height,
        },
        "format": format,
        "labels": [item.__dict__ for item in labels],
    }


@app.put("/api/annotations")
def save_annotations(payload: AnnotationPayload, image_id: str, data_dir: str | None = Query(default=None)) -> dict:
    try:
        _, _, entry = project_store.get_image_entry(payload.image_dir, payload.label_dir, image_id)
        annotation_format = get_annotation_format(payload.format)
        labels = [
            LabelRecord(
                label=str(item.get("label", "0")),
                points=[[float(x), float(y)] for x, y in item.get("points", [])[:4]],
                confidence=item.get("confidence"),
                track_id=item.get("track_id"),
                difficult=bool(item.get("difficult", False)),
                extra={k: v for k, v in item.items() if k not in {"label", "points", "confidence", "track_id", "difficult"}},
            )
            for item in payload.labels
        ]
        annotation_format.save(entry.annotation_path, entry.width, entry.height, labels, payload.class_names)
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"ok": True, "annotation_path": str(entry.annotation_path)}


@app.post("/api/sam")
def sam_prompt(payload: SamPromptPayload) -> dict:
    try:
        _, _, entry = project_store.get_image_entry(payload.image_dir, payload.label_dir, payload.image_id)
        result = sam_service.segment_to_obb(entry.image_path, payload.x, payload.y)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "label": payload.label or "0",
        "points": result["points"],
        "confidence": result["confidence"],
    }


@app.post("/api/sam-file")
async def sam_from_file(
    image: UploadFile = File(...),
    x: float = Form(...),
    y: float = Form(...),
    label: str | None = Form(default=None),
) -> dict:
    suffix = Path(image.filename or "image.jpg").suffix or ".jpg"
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await image.read())
            tmp_path = Path(tmp.name)
        result = sam_service.segment_to_obb(tmp_path, x, y)
        return {
            "label": label or "0",
            "points": result["points"],
            "confidence": result["confidence"],
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


static_dir = Path(__file__).resolve().parent / "static"
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
