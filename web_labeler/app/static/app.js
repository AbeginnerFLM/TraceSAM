const state = {
  config: null,
  format: "yolo_obb",
  classNames: [],
  imageDirHandle: null,
  labelDirHandle: null,
  imageDirName: "",
  labelDirName: "",
  images: [],
  filteredImages: [],
  activeImageIndex: -1,
  activeImageFile: null,
  activeImageUrl: "",
  labels: [],
  selectedLabelIndex: -1,
  mode: "select",
  pendingPoints: [],
  displayScale: 1,
  drag: null,
};

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp"]);

const elements = {
  pickImageDirButton: document.getElementById("pickImageDirButton"),
  pickLabelDirButton: document.getElementById("pickLabelDirButton"),
  imageDirDisplay: document.getElementById("imageDirDisplay"),
  labelDirDisplay: document.getElementById("labelDirDisplay"),
  refreshButton: document.getElementById("refreshButton"),
  formatSelect: document.getElementById("formatSelect"),
  classNamesInput: document.getElementById("classNamesInput"),
  imageSearchInput: document.getElementById("imageSearchInput"),
  imageList: document.getElementById("imageList"),
  imageCount: document.getElementById("imageCount"),
  imageTitle: document.getElementById("imageTitle"),
  imageMeta: document.getElementById("imageMeta"),
  labelCount: document.getElementById("labelCount"),
  statusText: document.getElementById("statusText"),
  statusBadge: document.getElementById("statusBadge"),
  modeBadge: document.getElementById("modeBadge"),
  imageLayer: document.getElementById("imageLayer"),
  overlayCanvas: document.getElementById("overlayCanvas"),
  canvasViewport: document.getElementById("canvasViewport"),
  selectModeButton: document.getElementById("selectModeButton"),
  drawModeButton: document.getElementById("drawModeButton"),
  samModeButton: document.getElementById("samModeButton"),
  prevImageButton: document.getElementById("prevImageButton"),
  nextImageButton: document.getElementById("nextImageButton"),
  deleteShapeButton: document.getElementById("deleteShapeButton"),
  saveButton: document.getElementById("saveButton"),
  labelEditor: document.getElementById("labelEditor"),
  confidenceEditor: document.getElementById("confidenceEditor"),
  trackIdEditor: document.getElementById("trackIdEditor"),
  difficultEditor: document.getElementById("difficultEditor"),
  shapeList: document.getElementById("shapeList"),
};

const ctx = elements.overlayCanvas.getContext("2d");
const HANDLE_RADIUS = 6;

boot().catch((error) => {
  setStatus(error.message, "error");
});

async function boot() {
  state.config = await api("/api/config");
  renderFormats();
  bindEvents();
  if (!window.showDirectoryPicker) {
    setStatus("当前浏览器不支持本地目录读写，请使用最新版 Chrome 或 Edge。", "warn");
  }
}

function bindEvents() {
  elements.pickImageDirButton.addEventListener("click", pickImageDirectory);
  elements.pickLabelDirButton.addEventListener("click", pickLabelDirectory);
  elements.refreshButton.addEventListener("click", rescanWorkspace);
  elements.formatSelect.addEventListener("change", onFormatChange);
  elements.classNamesInput.addEventListener("change", syncClassNames);
  elements.imageSearchInput.addEventListener("input", filterImages);
  elements.selectModeButton.addEventListener("click", () => setMode("select"));
  elements.drawModeButton.addEventListener("click", () => setMode("draw"));
  elements.samModeButton.addEventListener("click", () => setMode("sam"));
  elements.prevImageButton.addEventListener("click", () => stepImage(-1));
  elements.nextImageButton.addEventListener("click", () => stepImage(1));
  elements.deleteShapeButton.addEventListener("click", deleteSelectedShape);
  elements.saveButton.addEventListener("click", saveAnnotations);
  elements.labelEditor.addEventListener("input", updateSelectedMetadata);
  elements.confidenceEditor.addEventListener("input", updateSelectedMetadata);
  elements.trackIdEditor.addEventListener("input", updateSelectedMetadata);
  elements.difficultEditor.addEventListener("change", updateSelectedMetadata);
  elements.overlayCanvas.addEventListener("click", handleCanvasClick);
  elements.overlayCanvas.addEventListener("pointerdown", handlePointerDown);
  elements.overlayCanvas.addEventListener("pointermove", handlePointerMove);
  elements.overlayCanvas.addEventListener("pointerup", handlePointerUp);
  elements.overlayCanvas.addEventListener("pointerleave", handlePointerUp);
  window.addEventListener("resize", () => {
    if (state.activeImageIndex >= 0) {
      resizeCanvas();
      redraw();
    }
  });
}

function renderFormats() {
  elements.formatSelect.innerHTML = "";
  for (const item of state.config.formats) {
    const option = document.createElement("option");
    option.value = item.key;
    option.textContent = item.implemented ? item.display_name : `${item.display_name} (Reserved)`;
    elements.formatSelect.append(option);
  }
  elements.formatSelect.value = state.format;
}

async function pickImageDirectory() {
  try {
    ensureDirectoryApi();
    state.imageDirHandle = await window.showDirectoryPicker({ mode: "read" });
    state.imageDirName = state.imageDirHandle.name;
    elements.imageDirDisplay.textContent = state.imageDirName;
    await rescanWorkspace();
  } catch (error) {
    if (error.name !== "AbortError") {
      setStatus(error.message, "error");
    }
  }
}

async function pickLabelDirectory() {
  try {
    ensureDirectoryApi();
    state.labelDirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    state.labelDirName = state.labelDirHandle.name;
    elements.labelDirDisplay.textContent = state.labelDirName;
    setStatus(`标签目录已切换到 ${state.labelDirName}`, "ready");
    if (state.activeImageIndex >= 0) {
      await loadAnnotationsForActiveImage();
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      setStatus(error.message, "error");
    }
  }
}

async function rescanWorkspace() {
  if (!state.imageDirHandle) {
    setStatus("请先选择本地图片目录。", "warn");
    return;
  }
  state.images = await collectImageEntries(state.imageDirHandle);
  filterImages();
  setStatus(`已扫描 ${state.images.length} 张本地图片。`, "ready");
  if (state.images.length) {
    await openImageByIndex(0);
  } else {
    resetCanvasState();
  }
}

async function collectImageEntries(dirHandle, parentParts = []) {
  const results = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === "directory") {
      results.push(...await collectImageEntries(entry, [...parentParts, entry.name]));
      continue;
    }
    const extension = getExtension(entry.name);
    if (!IMAGE_EXTENSIONS.has(extension)) {
      continue;
    }
    const relativePath = [...parentParts, entry.name].join("/");
    results.push({
      id: relativePath,
      name: entry.name,
      relativePath,
      handle: entry,
    });
  }
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
}

function filterImages() {
  const keyword = elements.imageSearchInput.value.trim().toLowerCase();
  state.filteredImages = state.images.filter((item) => item.relativePath.toLowerCase().includes(keyword));
  elements.imageCount.textContent = String(state.filteredImages.length);
  renderImageList();
}

function renderImageList() {
  elements.imageList.innerHTML = "";
  for (const item of state.filteredImages) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `image-row ${getActiveImage()?.id === item.id ? "active" : ""}`;
    row.innerHTML = `
      <div class="row-title">${item.name}</div>
      <div class="row-subtitle">${item.relativePath}</div>
    `;
    row.addEventListener("click", () => openImageById(item.id));
    elements.imageList.append(row);
  }
}

async function openImageById(imageId) {
  const index = state.images.findIndex((item) => item.id === imageId);
  if (index >= 0) {
    await openImageByIndex(index);
  }
}

async function openImageByIndex(index) {
  const image = state.images[index];
  if (!image) {
    return;
  }

  state.activeImageIndex = index;
  state.pendingPoints = [];
  state.selectedLabelIndex = -1;
  renderImageList();

  if (state.activeImageUrl) {
    URL.revokeObjectURL(state.activeImageUrl);
  }
  const file = await image.handle.getFile();
  state.activeImageFile = file;
  state.activeImageUrl = URL.createObjectURL(file);
  elements.imageLayer.src = state.activeImageUrl;

  await new Promise((resolve) => {
    elements.imageLayer.onload = resolve;
  });

  image.width = elements.imageLayer.naturalWidth;
  image.height = elements.imageLayer.naturalHeight;
  elements.imageTitle.textContent = image.relativePath;
  elements.imageMeta.textContent = `${image.width} x ${image.height}`;
  resizeCanvas();
  await loadAnnotationsForActiveImage();
}

async function loadAnnotationsForActiveImage() {
  const image = getActiveImage();
  if (!image) {
    return;
  }
  try {
    const content = await readLabelFile(image.relativePath);
    state.labels = parseYoloObb(content, image.width, image.height);
  } catch (error) {
    state.labels = [];
  }
  state.selectedLabelIndex = state.labels.length ? 0 : -1;
  renderShapeList();
  syncInspector();
  redraw();
  setStatus(`已加载 ${state.labels.length} 个标注。`, "ready");
}

async function readLabelFile(relativePath) {
  if (!state.labelDirHandle) {
    return "";
  }
  const handle = await getLabelFileHandle(relativePath, false);
  if (!handle) {
    return "";
  }
  const file = await handle.getFile();
  return file.text();
}

function parseYoloObb(content, width, height) {
  const labels = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length < 9) {
      continue;
    }
    const points = [];
    const coords = parts.slice(1, 9).map(Number);
    for (let i = 0; i < coords.length; i += 2) {
      points.push([coords[i] * width, coords[i + 1] * height]);
    }
    labels.push({
      label: parts[0],
      points,
      confidence: parts[9] ? Number(parts[9]) : null,
      track_id: parts[10] ? Number(parts[10]) : null,
      difficult: false,
    });
  }
  return labels;
}

async function saveAnnotations() {
  const image = getActiveImage();
  if (!image) {
    setStatus("没有可保存的图片。", "warn");
    return;
  }
  if (!state.labelDirHandle) {
    setStatus("请先选择本地标签目录。", "warn");
    return;
  }
  syncClassNames();
  const content = serializeYoloObb(state.labels, image.width, image.height);
  const handle = await getLabelFileHandle(image.relativePath, true);
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
  setStatus(`已保存到本地标签目录：${state.labelDirName}`, "saved");
}

function serializeYoloObb(labels, width, height) {
  return labels
    .map((item) => {
      const classIndex = resolveClassIndex(item.label);
      const coords = item.points.flatMap(([x, y]) => [
        (x / width).toFixed(6),
        (y / height).toFixed(6),
      ]);
      const row = [String(classIndex), ...coords];
      if (item.confidence != null && item.confidence !== "") {
        row.push(Number(item.confidence).toFixed(6));
      }
      if (item.track_id != null && item.track_id !== "") {
        row.push(String(Math.trunc(Number(item.track_id))));
      }
      return row.join(" ");
    })
    .join("\n");
}

function resolveClassIndex(label) {
  const asNumber = Number(label);
  if (!Number.isNaN(asNumber)) {
    return asNumber;
  }
  const index = state.classNames.indexOf(label);
  return index >= 0 ? index : 0;
}

async function getLabelFileHandle(relativePath, create) {
  if (!state.labelDirHandle) {
    return null;
  }
  const parts = relativePath.split("/");
  const fileName = parts.pop().replace(/\.[^.]+$/, ".txt");
  let currentDir = state.labelDirHandle;
  for (const part of parts) {
    currentDir = await currentDir.getDirectoryHandle(part, { create });
  }
  try {
    return await currentDir.getFileHandle(fileName, { create });
  } catch {
    return null;
  }
}

function onFormatChange() {
  state.format = elements.formatSelect.value;
  const option = state.config.formats.find((item) => item.key === state.format);
  if (option && !option.implemented) {
    setStatus(`${option.display_name} 还未实现，当前请使用 YOLO OBB。`, "warn");
  }
}

function setMode(mode) {
  state.mode = mode;
  state.pendingPoints = [];
  elements.modeBadge.textContent = mode === "draw" ? "Draw" : mode === "sam" ? "Smart" : "Select";
  elements.selectModeButton.classList.toggle("active", mode === "select");
  elements.drawModeButton.classList.toggle("active", mode === "draw");
  elements.samModeButton.classList.toggle("active", mode === "sam");
  redraw();
}

function syncClassNames() {
  state.classNames = elements.classNamesInput.value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function resizeCanvas() {
  const viewportRect = elements.canvasViewport.getBoundingClientRect();
  const image = getActiveImage();
  if (!image) {
    return;
  }
  const maxWidth = Math.max(viewportRect.width - 44, 240);
  const maxHeight = Math.max(viewportRect.height - 44, 240);
  state.displayScale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = Math.round(image.width * state.displayScale);
  const height = Math.round(image.height * state.displayScale);
  elements.imageLayer.width = width;
  elements.imageLayer.height = height;
  elements.overlayCanvas.width = width;
  elements.overlayCanvas.height = height;
}

function redraw() {
  ctx.clearRect(0, 0, elements.overlayCanvas.width, elements.overlayCanvas.height);
  state.labels.forEach((shape, index) => drawShape(shape, index === state.selectedLabelIndex));
  drawPendingShape();
}

function drawShape(shape, active) {
  if (!shape.points || shape.points.length < 4) {
    return;
  }
  const points = shape.points.map(toCanvasPoint);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.closePath();
  ctx.fillStyle = active ? "rgba(50, 200, 255, 0.18)" : "rgba(74, 87, 255, 0.12)";
  ctx.strokeStyle = active ? "#32c8ff" : "#4a57ff";
  ctx.lineWidth = active ? 2.4 : 1.6;
  ctx.fill();
  ctx.stroke();

  points.forEach(([x, y], index) => {
    ctx.beginPath();
    ctx.arc(x, y, active ? HANDLE_RADIUS : HANDLE_RADIUS - 1.5, 0, Math.PI * 2);
    ctx.fillStyle = index === 0 ? "#ff9e44" : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#182130";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  });

  ctx.fillStyle = "#ffffff";
  ctx.font = "600 12px Inter, sans-serif";
  ctx.fillText(shape.label || "0", points[0][0] + 8, points[0][1] - 10);
  ctx.restore();
}

function drawPendingShape() {
  if (!state.pendingPoints.length) {
    return;
  }
  const points = state.pendingPoints.map(toCanvasPoint);
  ctx.save();
  ctx.strokeStyle = "#ff9e44";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.stroke();
  points.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = "#ff9e44";
    ctx.fill();
  });
  ctx.restore();
}

async function handleCanvasClick(event) {
  const image = getActiveImage();
  if (!image || state.drag) {
    return;
  }
  const point = getImageCoordinates(event);

  if (state.mode === "draw") {
    state.pendingPoints.push(point);
    if (state.pendingPoints.length === 4) {
      state.labels.push({
        label: nextLabel(),
        points: [...state.pendingPoints],
        confidence: null,
        track_id: null,
        difficult: false,
      });
      state.pendingPoints = [];
      state.selectedLabelIndex = state.labels.length - 1;
      renderShapeList();
      syncInspector();
    }
    redraw();
    return;
  }

  if (state.mode === "sam") {
    if (!state.activeImageFile) {
      setStatus("当前没有可用于 SAM 的图片。", "warn");
      return;
    }
    setStatus("SAM 正在处理当前本地图片...", "busy");
    const formData = new FormData();
    formData.append("image", state.activeImageFile, state.activeImageFile.name);
    formData.append("x", String(point[0]));
    formData.append("y", String(point[1]));
    formData.append("label", nextLabel());
    const result = await api("/api/sam-file", {
      method: "POST",
      body: formData,
    });
    state.labels.push({
      label: result.label,
      points: result.points,
      confidence: result.confidence,
      track_id: null,
      difficult: false,
    });
    state.selectedLabelIndex = state.labels.length - 1;
    renderShapeList();
    syncInspector();
    redraw();
    setStatus("SAM 已基于本地图片生成 OBB。", "ready");
    return;
  }

  selectByPoint(point);
}

function handlePointerDown(event) {
  if (state.mode !== "select" || state.selectedLabelIndex < 0) {
    return;
  }
  const point = getImageCoordinates(event);
  const shape = state.labels[state.selectedLabelIndex];
  const vertexIndex = findVertex(point, shape);
  if (vertexIndex >= 0) {
    state.drag = { kind: "vertex", vertexIndex, lastPoint: point };
    elements.overlayCanvas.setPointerCapture(event.pointerId);
    return;
  }
  if (pointInPolygon(point, shape.points)) {
    state.drag = { kind: "shape", lastPoint: point };
    elements.overlayCanvas.setPointerCapture(event.pointerId);
  }
}

function handlePointerMove(event) {
  if (!state.drag || state.selectedLabelIndex < 0) {
    return;
  }
  const point = getImageCoordinates(event);
  const shape = state.labels[state.selectedLabelIndex];
  const dx = point[0] - state.drag.lastPoint[0];
  const dy = point[1] - state.drag.lastPoint[1];
  state.drag.lastPoint = point;

  if (state.drag.kind === "vertex") {
    shape.points[state.drag.vertexIndex] = clampPoint(point);
  } else {
    shape.points = shape.points.map(([x, y]) => clampPoint([x + dx, y + dy]));
  }

  renderShapeList();
  redraw();
}

function handlePointerUp(event) {
  if (!state.drag) {
    return;
  }
  state.drag = null;
  try {
    elements.overlayCanvas.releasePointerCapture(event.pointerId);
  } catch {
    // ignore
  }
}

function renderShapeList() {
  elements.shapeList.innerHTML = "";
  state.labels.forEach((shape, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `shape-row ${index === state.selectedLabelIndex ? "active" : ""}`;
    row.innerHTML = `
      <div class="row-title">${shape.label || "0"}</div>
      <div class="row-subtitle">${shape.points.map(([x, y]) => `${x.toFixed(0)},${y.toFixed(0)}`).join(" · ")}</div>
    `;
    row.addEventListener("click", () => {
      state.selectedLabelIndex = index;
      syncInspector();
      renderShapeList();
      redraw();
    });
    elements.shapeList.append(row);
  });
  elements.labelCount.textContent = String(state.labels.length);
}

function syncInspector() {
  const shape = state.labels[state.selectedLabelIndex];
  elements.labelEditor.value = shape?.label ?? "";
  elements.confidenceEditor.value = shape?.confidence ?? "";
  elements.trackIdEditor.value = shape?.track_id ?? "";
  elements.difficultEditor.checked = shape?.difficult ?? false;
}

function updateSelectedMetadata() {
  const shape = state.labels[state.selectedLabelIndex];
  if (!shape) {
    return;
  }
  shape.label = elements.labelEditor.value.trim() || "0";
  shape.confidence = elements.confidenceEditor.value ? Number(elements.confidenceEditor.value) : null;
  shape.track_id = elements.trackIdEditor.value ? Number(elements.trackIdEditor.value) : null;
  shape.difficult = elements.difficultEditor.checked;
  renderShapeList();
  redraw();
}

function deleteSelectedShape() {
  if (state.selectedLabelIndex < 0) {
    return;
  }
  state.labels.splice(state.selectedLabelIndex, 1);
  state.selectedLabelIndex = state.labels.length ? Math.min(state.selectedLabelIndex, state.labels.length - 1) : -1;
  renderShapeList();
  syncInspector();
  redraw();
}

function stepImage(offset) {
  const active = getActiveImage();
  if (!active || !state.filteredImages.length) {
    return;
  }
  const filteredIndex = state.filteredImages.findIndex((item) => item.id === active.id);
  const next = filteredIndex + offset;
  if (next < 0 || next >= state.filteredImages.length) {
    return;
  }
  openImageById(state.filteredImages[next].id);
}

function selectByPoint(point) {
  let selected = -1;
  for (let index = state.labels.length - 1; index >= 0; index -= 1) {
    if (pointInPolygon(point, state.labels[index].points)) {
      selected = index;
      break;
    }
  }
  state.selectedLabelIndex = selected;
  renderShapeList();
  syncInspector();
  redraw();
}

function getImageCoordinates(event) {
  const rect = elements.overlayCanvas.getBoundingClientRect();
  return clampPoint([
    (event.clientX - rect.left) / state.displayScale,
    (event.clientY - rect.top) / state.displayScale,
  ]);
}

function toCanvasPoint([x, y]) {
  return [x * state.displayScale, y * state.displayScale];
}

function clampPoint([x, y]) {
  const image = getActiveImage();
  if (!image) {
    return [x, y];
  }
  return [
    Math.max(0, Math.min(image.width, x)),
    Math.max(0, Math.min(image.height, y)),
  ];
}

function findVertex(point, shape) {
  for (let index = 0; index < shape.points.length; index += 1) {
    const [x, y] = shape.points[index];
    const dx = x - point[0];
    const dy = y - point[1];
    if (Math.sqrt(dx * dx + dy * dy) <= HANDLE_RADIUS * 2 / state.displayScale) {
      return index;
    }
  }
  return -1;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect = yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

function nextLabel() {
  syncClassNames();
  return state.classNames[0] || "0";
}

function getActiveImage() {
  return state.activeImageIndex >= 0 ? state.images[state.activeImageIndex] : null;
}

function resetCanvasState() {
  state.activeImageIndex = -1;
  state.labels = [];
  state.selectedLabelIndex = -1;
  elements.imageTitle.textContent = "Select an image to begin";
  elements.imageMeta.textContent = "-";
  elements.imageLayer.removeAttribute("src");
  renderImageList();
  renderShapeList();
  redraw();
}

function ensureDirectoryApi() {
  if (!window.showDirectoryPicker) {
    throw new Error("当前浏览器不支持本地目录访问，请使用最新版 Chrome 或 Edge。");
  }
}

function getExtension(fileName) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function setStatus(text, tone = "idle") {
  elements.statusText.textContent = text;
  const mapping = {
    idle: "Idle",
    ready: "Ready",
    busy: "Busy",
    saved: "Saved",
    warn: "Warning",
    error: "Error",
  };
  elements.statusBadge.textContent = mapping[tone] || "Idle";
}

async function api(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(payload.detail || "Request failed");
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response;
}
