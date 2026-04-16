const state = {
  config: null,
  imageDir: "",
  labelDir: "",
  format: "yolo_obb",
  classNames: [],
  images: [],
  filteredImages: [],
  activeImageIndex: -1,
  labels: [],
  selectedLabelIndex: -1,
  mode: "select",
  pendingPoints: [],
  displayScale: 1,
  drag: null,
  directoryPickerTarget: "image",
  directoryCursor: "",
};

const elements = {
  imageDirInput: document.getElementById("imageDirInput"),
  labelDirInput: document.getElementById("labelDirInput"),
  browseImageDirButton: document.getElementById("browseImageDirButton"),
  browseLabelDirButton: document.getElementById("browseLabelDirButton"),
  loadWorkspaceButton: document.getElementById("loadWorkspaceButton"),
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
  directoryDialog: document.getElementById("directoryDialog"),
  directoryDialogTitle: document.getElementById("directoryDialogTitle"),
  directoryCurrentPath: document.getElementById("directoryCurrentPath"),
  closeDirectoryDialog: document.getElementById("closeDirectoryDialog"),
  goParentDirectoryButton: document.getElementById("goParentDirectoryButton"),
  chooseCurrentDirectoryButton: document.getElementById("chooseCurrentDirectoryButton"),
  directoryList: document.getElementById("directoryList"),
};

const ctx = elements.overlayCanvas.getContext("2d");
const HANDLE_RADIUS = 6;

boot().catch((error) => {
  setStatus(error.message, "error");
});

async function boot() {
  state.config = await api("/api/config");
  state.imageDir = state.config.defaults.image_dir;
  state.labelDir = state.config.defaults.label_dir;
  elements.imageDirInput.value = state.imageDir;
  elements.labelDirInput.value = state.labelDir;
  renderFormats();
  bindEvents();
  await loadWorkspace();
}

function bindEvents() {
  elements.loadWorkspaceButton.addEventListener("click", () => loadWorkspace());
  elements.refreshButton.addEventListener("click", () => loadWorkspace());
  elements.browseImageDirButton.addEventListener("click", () => openDirectoryDialog("image"));
  elements.browseLabelDirButton.addEventListener("click", () => openDirectoryDialog("label"));
  elements.closeDirectoryDialog.addEventListener("click", () => elements.directoryDialog.close());
  elements.goParentDirectoryButton.addEventListener("click", () => browseDirectory(".."));
  elements.chooseCurrentDirectoryButton.addEventListener("click", useCurrentDirectory);
  elements.imageSearchInput.addEventListener("input", filterImages);
  elements.formatSelect.addEventListener("change", onFormatChange);
  elements.classNamesInput.addEventListener("change", syncClassNames);
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

async function loadWorkspace() {
  state.imageDir = elements.imageDirInput.value.trim();
  state.labelDir = elements.labelDirInput.value.trim();
  const query = buildWorkspaceQuery();
  const result = await api(`/api/images?${query}`);
  state.imageDir = result.image_dir;
  state.labelDir = result.label_dir || state.imageDir;
  elements.imageDirInput.value = state.imageDir;
  elements.labelDirInput.value = state.labelDir;
  state.images = result.images;
  filterImages();
  setStatus(`Loaded ${state.images.length} images from workspace.`, "ready");

  if (!state.images.length) {
    state.activeImageIndex = -1;
    state.labels = [];
    renderImageList();
    renderShapeList();
    redraw();
    return;
  }

  const nextIndex = Math.min(Math.max(state.activeImageIndex, 0), state.filteredImages.length - 1);
  await openImageById(state.filteredImages[nextIndex]?.id || state.images[0].id);
}

function buildWorkspaceQuery() {
  const params = new URLSearchParams();
  params.set("image_dir", state.imageDir);
  params.set("label_dir", state.labelDir);
  return params.toString();
}

function filterImages() {
  const keyword = elements.imageSearchInput.value.trim().toLowerCase();
  state.filteredImages = state.images.filter((item) => item.name.toLowerCase().includes(keyword));
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
      <div class="row-subtitle">${item.width} x ${item.height}</div>
    `;
    row.addEventListener("click", () => openImageById(item.id));
    elements.imageList.append(row);
  }
}

async function openImageById(imageId) {
  const index = state.images.findIndex((item) => item.id === imageId);
  if (index < 0) {
    return;
  }

  state.activeImageIndex = index;
  state.selectedLabelIndex = -1;
  state.pendingPoints = [];
  renderImageList();

  const image = getActiveImage();
  elements.imageTitle.textContent = image.name;
  elements.imageMeta.textContent = `${image.width} x ${image.height}`;
  elements.imageLayer.src = `/api/image?image_dir=${encodeURIComponent(state.imageDir)}&label_dir=${encodeURIComponent(state.labelDir)}&image_id=${encodeURIComponent(image.id)}`;

  await new Promise((resolve) => {
    elements.imageLayer.onload = resolve;
  });

  resizeCanvas();
  await loadAnnotations(image.id);
}

async function loadAnnotations(imageId) {
  const result = await api(`/api/annotations?image_dir=${encodeURIComponent(state.imageDir)}&label_dir=${encodeURIComponent(state.labelDir)}&image_id=${encodeURIComponent(imageId)}&format=${encodeURIComponent(state.format)}`);
  state.labels = (result.labels || []).map(normalizeShape);
  state.selectedLabelIndex = state.labels.length ? 0 : -1;
  renderShapeList();
  syncInspector();
  redraw();
  setStatus(`Loaded ${state.labels.length} annotations from ${getActiveImage().name}.`, "ready");
}

function normalizeShape(item) {
  return {
    label: item.label ?? "0",
    points: (item.points || []).slice(0, 4).map(([x, y]) => [Number(x), Number(y)]),
    confidence: item.confidence ?? null,
    track_id: item.track_id ?? null,
    difficult: Boolean(item.difficult),
  };
}

async function saveAnnotations() {
  if (!getActiveImage()) {
    return;
  }
  syncClassNames();
  await api(`/api/annotations?image_id=${encodeURIComponent(getActiveImage().id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      format: state.format,
      class_names: state.classNames,
      image_dir: state.imageDir,
      label_dir: state.labelDir,
      labels: state.labels,
    }),
  });
  setStatus(`Saved ${state.labels.length} annotations to ${state.labelDir}.`, "saved");
}

function syncClassNames() {
  state.classNames = elements.classNamesInput.value.split("\n").map((value) => value.trim()).filter(Boolean);
}

function onFormatChange() {
  state.format = elements.formatSelect.value;
  const option = state.config.formats.find((item) => item.key === state.format);
  if (option && !option.implemented) {
    setStatus(`${option.display_name} is reserved for later. Current working format is YOLO OBB.`, "warn");
  } else if (getActiveImage()) {
    loadAnnotations(getActiveImage().id);
  }
}

function setMode(mode) {
  state.mode = mode;
  state.pendingPoints = [];
  elements.modeBadge.textContent = mode === "draw" ? "4-point OBB" : mode === "sam" ? "SAM Assist" : "Select";
  elements.selectModeButton.classList.toggle("active", mode === "select");
  elements.drawModeButton.classList.toggle("active", mode === "draw");
  elements.samModeButton.classList.toggle("active", mode === "sam");
  redraw();
}

function resizeCanvas() {
  const viewportRect = elements.canvasViewport.getBoundingClientRect();
  const image = getActiveImage();
  if (!image) {
    return;
  }

  const maxWidth = Math.max(viewportRect.width - 52, 240);
  const maxHeight = Math.max(viewportRect.height - 52, 240);
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  state.displayScale = scale;

  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);

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
  ctx.fillStyle = active ? "rgba(63, 196, 255, 0.18)" : "rgba(50, 118, 255, 0.12)";
  ctx.strokeStyle = active ? "#3fc4ff" : "#5f8fff";
  ctx.lineWidth = active ? 2.5 : 1.6;
  ctx.fill();
  ctx.stroke();

  points.forEach(([x, y], index) => {
    ctx.beginPath();
    ctx.arc(x, y, active ? HANDLE_RADIUS : HANDLE_RADIUS - 1.5, 0, Math.PI * 2);
    ctx.fillStyle = index === 0 ? "#ff7b31" : "#d8e6ff";
    ctx.fill();
    ctx.strokeStyle = "#08111f";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  });

  ctx.fillStyle = "#ffffff";
  ctx.font = "600 12px ui-sans-serif";
  ctx.fillText(shape.label || "0", points[0][0] + 8, points[0][1] - 10);
  ctx.restore();
}

function drawPendingShape() {
  if (!state.pendingPoints.length) {
    return;
  }
  const points = state.pendingPoints.map(toCanvasPoint);
  ctx.save();
  ctx.strokeStyle = "#ffb15c";
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
    ctx.fillStyle = "#ff7b31";
    ctx.fill();
  });
  ctx.restore();
}

async function handleCanvasClick(event) {
  if (state.drag || !getActiveImage()) {
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
    setStatus(`SAM processing point (${Math.round(point[0])}, ${Math.round(point[1])}) ...`, "busy");
    const result = await api("/api/sam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_dir: state.imageDir,
        label_dir: state.labelDir,
        image_id: getActiveImage().id,
        x: point[0],
        y: point[1],
        label: nextLabel(),
      }),
    });
    state.labels.push(normalizeShape(result));
    state.selectedLabelIndex = state.labels.length - 1;
    renderShapeList();
    syncInspector();
    redraw();
    setStatus("SAM generated an OBB. You can refine vertices by dragging them.", "ready");
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
  const point = getImageCoordinates(event);
  if (!state.drag || state.selectedLabelIndex < 0) {
    return;
  }
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
  if (state.drag) {
    state.drag = null;
    try {
      elements.overlayCanvas.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }
}

function selectByPoint(point) {
  let selected = -1;
  for (let index = state.labels.length - 1; index >= 0; index -= 1) {
    const shape = state.labels[index];
    if (pointInPolygon(point, shape.points)) {
      selected = index;
      break;
    }
  }
  state.selectedLabelIndex = selected;
  renderShapeList();
  syncInspector();
  redraw();
}

function renderShapeList() {
  elements.shapeList.innerHTML = "";
  state.labels.forEach((shape, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `shape-row ${state.selectedLabelIndex === index ? "active" : ""}`;
    row.innerHTML = `
      <div class="row-title">${shape.label || "0"} <span class="row-subtitle">#${index + 1}</span></div>
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
  const image = getActiveImage();
  if (!image || !state.filteredImages.length) {
    return;
  }
  const currentFilteredIndex = state.filteredImages.findIndex((item) => item.id === image.id);
  const nextIndex = currentFilteredIndex + offset;
  if (nextIndex < 0 || nextIndex >= state.filteredImages.length) {
    return;
  }
  openImageById(state.filteredImages[nextIndex].id);
}

async function openDirectoryDialog(target) {
  state.directoryPickerTarget = target;
  const currentPath = target === "image" ? elements.imageDirInput.value.trim() : elements.labelDirInput.value.trim();
  await browseDirectory(currentPath || state.config.base_dir);
  elements.directoryDialogTitle.textContent = target === "image" ? "选择图片目录" : "选择标签目录";
  elements.directoryDialog.showModal();
}

async function browseDirectory(path) {
  const actualPath = path === ".." ? state.directoryCursor && state.directoryCursor !== "/" ? new URLSearchParams({ path: state.directoryCursor }).toString() : "" : new URLSearchParams({ path }).toString();
  let result;
  if (path === "..") {
    const browse = await api(`/api/browse?path=${encodeURIComponent(state.directoryCursor)}`);
    if (!browse.parent_path) {
      result = browse;
    } else {
      result = await api(`/api/browse?path=${encodeURIComponent(browse.parent_path)}`);
    }
  } else {
    result = await api(`/api/browse?${actualPath}`);
  }
  state.directoryCursor = result.current_path;
  elements.directoryCurrentPath.textContent = result.current_path;
  elements.directoryList.innerHTML = "";
  for (const child of result.children) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "directory-row";
    row.innerHTML = `<div class="row-title">${child.name}</div><div class="row-subtitle">${child.path}</div>`;
    row.addEventListener("click", () => browseDirectory(child.path));
    elements.directoryList.append(row);
  }
}

function useCurrentDirectory() {
  if (state.directoryPickerTarget === "image") {
    elements.imageDirInput.value = state.directoryCursor;
  } else {
    elements.labelDirInput.value = state.directoryCursor;
  }
  elements.directoryDialog.close();
}

function nextLabel() {
  syncClassNames();
  return state.classNames[0] || "0";
}

function getActiveImage() {
  return state.activeImageIndex >= 0 ? state.images[state.activeImageIndex] : null;
}

function getImageCoordinates(event) {
  const rect = elements.overlayCanvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / state.displayScale;
  const y = (event.clientY - rect.top) / state.displayScale;
  return clampPoint([x, y]);
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
