from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np


class SamService:
    def __init__(self, model_source: str | None = None, fallback_model_name: str = "sam2.1_b.pt") -> None:
        self.model_source = model_source or "sam3.pt"
        self.fallback_model_name = fallback_model_name
        self._model = None

    def segment_to_obb(self, image_path: str | Path, x: float, y: float) -> dict:
        image_path = str(image_path)
        model = self._ensure_model()
        results = model.predict(source=image_path, points=[int(round(x)), int(round(y))], labels=[1], verbose=False)
        if not results:
            raise RuntimeError("SAM did not return any result.")

        contours = self._extract_contours(results[0])
        contour, confidence = self._select_contour(contours, x, y)
        points = self._build_obb_points(contour)
        return {
            "points": points,
            "confidence": confidence,
        }

    def _ensure_model(self):
        if self._model is not None:
            return self._model

        try:
            from ultralytics import SAM
        except ImportError as exc:
            raise RuntimeError("Ultralytics is not installed. Run `pip install -U ultralytics`.") from exc

        checkpoint = self._ensure_checkpoint()
        self._model = SAM(checkpoint)
        return self._model

    def _ensure_checkpoint(self) -> str:
        source = Path(self.model_source).expanduser()
        if source.exists():
            return str(source)

        try:
            from ultralytics.utils.downloads import attempt_download_asset
        except ImportError as exc:
            raise RuntimeError("Ultralytics download helper is unavailable.") from exc

        try:
            downloaded = Path(attempt_download_asset(str(source), release="latest"))
            if downloaded.exists():
                return str(downloaded)
        except Exception:
            fallback = Path(self.fallback_model_name)
            downloaded = Path(attempt_download_asset(str(fallback), release="v8.4.0"))
            if downloaded.exists():
                return str(downloaded)
        raise RuntimeError(f"Unable to prepare SAM checkpoint from `{self.model_source}`.")

    def _extract_contours(self, result) -> list[tuple[np.ndarray, float | None]]:
        masks = getattr(result, "masks", None)
        if masks is None or getattr(masks, "xy", None) is None:
            return []

        confidences: list[float] = []
        boxes = getattr(result, "boxes", None)
        if boxes is not None and getattr(boxes, "conf", None) is not None:
            try:
                confidences = boxes.conf.detach().cpu().tolist()
            except Exception:
                confidences = []

        contours: list[tuple[np.ndarray, float | None]] = []
        for index, segment in enumerate(masks.xy):
            contour = np.asarray(segment, dtype=np.float32)
            if contour.ndim != 2 or contour.shape[0] < 3:
                continue
            confidence = confidences[index] if index < len(confidences) else None
            contours.append((contour, confidence))
        return contours

    def _select_contour(
        self,
        contours: list[tuple[np.ndarray, float | None]],
        x: float,
        y: float,
    ) -> tuple[np.ndarray, float | None]:
        point_xy = (float(x), float(y))
        containing: list[tuple[float, np.ndarray, float | None]] = []
        fallback: list[tuple[float, float, np.ndarray, float | None]] = []

        for contour, confidence in contours:
            area = abs(cv2.contourArea(contour))
            if area < 9.0:
                continue

            if cv2.pointPolygonTest(contour, point_xy, False) >= 0:
                containing.append((area, contour, confidence))
                continue

            moments = cv2.moments(contour)
            if moments["m00"]:
                center_x = moments["m10"] / moments["m00"]
                center_y = moments["m01"] / moments["m00"]
                distance_sq = (center_x - point_xy[0]) ** 2 + (center_y - point_xy[1]) ** 2
            else:
                distance_sq = float("inf")
            fallback.append((distance_sq, -area, contour, confidence))

        if containing:
            _, contour, confidence = max(containing, key=lambda item: item[0])
            return contour, confidence
        if fallback:
            _, _, contour, confidence = min(fallback, key=lambda item: (item[0], item[1]))
            return contour, confidence
        raise RuntimeError("SAM returned masks, but none could be converted into a valid OBB.")

    def _build_obb_points(self, contour: np.ndarray) -> list[list[float]]:
        rect = cv2.minAreaRect(contour.astype(np.float32))
        (_, _), (width, height), _ = rect
        if width < 2.0 or height < 2.0:
            raise RuntimeError("Object is too small to create a stable OBB.")

        box = cv2.boxPoints(rect)
        return [[float(x), float(y)] for x, y in box]
