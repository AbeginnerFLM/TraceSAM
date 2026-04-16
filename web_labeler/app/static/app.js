const state = {
  config: null,
  dataDir: "",
  format: "yolo_obb",
  images: [],
  activeImage: null,
  labels: [],
  classNames: [],
  selectedLabelIndex: -1,
  mode: "browse",
  pendingPoints: [],
};

const elements = {
  dataDirInput: document.getElementById("dataDirInput"),
  loadProjectButton: document.getElementById("loadProjectButton"),
  formatSelect: document.getElementById("formatSelect"),
  classNamesInput: document.getElementById("classNamesInput"),
  drawModeButton: document.getElementById("drawModeButton"),
  samModeButton: document.getElementById("samModeButton"),
  deleteShapeButton: document.getElementById("deleteShapeButton"),
  saveButton: document.getElementById("saveButton"),
  imageList: document.getElementById("imageList"),
  imageCount: document.getElementById("imageCount"),
  imageTitle: document.getElementById("imageTitle"),
  imageLayer: document.getElementById("imageLayer"),
  overlayCanvas: document.getElementById("overlayCanvas"),
  canvasWrap: document.getElementById("canvasWrap"),
  statusText: document.getElementById("statusText"),
  modeBadge: document.getElementById("modeBadge"),
  imageMeta: document.getElementById("imageMeta"),
  labelTableBody: document.getElementById("labelTableBody"),
  labelCount: document.getElementById("labelCount"),
};

const ctx = elements.overlayCanvas.getContext("2d");

boot();

async function boot() {
  state.config = await api("/api/config");
  state.dataDir = state.config.base_dir;
  elements.dataDirInput.value = state.dataDir;
  renderFormats();
  bindEvents();
  await loadProject();
}

function bindEvents() {
  elements.loadProjectButton.addEventListener("click", () => loadProject());
  elements.formatSelect.addEventListener("change", () => {
    state.format = elements.formatSelect.value;
    const option = state.config.formats.find((item) => item.key === state.format);
    if (option && !option.implemented) {
      setStatus(`当前仅实现了 YOLO OBB；${option.display_name} 接口已预留。`);
    }
    if (state.activeImage) {
      loadAnnotations(state.activeImage.id);
    }
  });
  elements.classNamesInput.addEventListener("change", syncClassNames);
  elements.drawModeButton.addEventListener("click", () => setMode("draw"));
  elements.samModeButton.addEventListener("click", () => setMode("sam"));
  elements.deleteShapeButton.addEventListener("click", deleteSelectedShape);
  elements.saveButton.addEventListener("click", saveAnnotations);
  elements.overlayCanvas.addEventListener("click", handleCanvasClick);
}

function renderFormats() {
  elements.formatSelect.innerHTML = "";
  for (const item of state.config.formats) {
    const option = document.createElement("option");
    option.value = item.key;
    option.textContent = item.implemented ? item.display_name : `${item.display_name} (预留)`;
    elements.formatSelect.append(option);
  }
  elements.formatSelect.value = state.format;
}

async function loadProject() {
  state.dataDir = elements.dataDirInput.value.trim();
  const result = await api(`/api/images?data_dir=${encodeURIComponent(state.dataDir)}`);
  state.images = result.images;
  renderImageList();
  elements.imageCount.textContent = `${state.images.length} 张`;
  if (state.images.length > 0) {
    await openImage(state.images[0].id);
  } else {
    setStatus("当前目录下没有可标注图片。");
  }
}

function renderImageList() {
  elements.imageList.innerHTML = "";
  for (const item of state.images) {
    const li = document.createElement("li");
    li.className = `image-item ${state.activeImage?.id === item.id ? "active" : ""}`;
    li.textContent = item.name;
    li.addEventListener("click", () => openImage(item.id));
    elements.imageList.append(li);
  }
}

async function openImage(imageId) {
  const image = state.images.find((item) => item.id === imageId);
  if (!image) {
    return;
  }
  state.activeImage = image;
  state.pendingPoints = [];
  state.selectedLabelIndex = -1;
  elements.imageTitle.textContent = image.name;
  elements.imageMeta.textContent = `${image.width} x ${image.height}`;
  elements.imageLayer.src = `/api/image?data_dir=${encodeURIComponent(state.dataDir)}&image_id=${encodeURIComponent(image.id)}`;

  await new Promise((resolve) => {
    elements.imageLayer.onload = resolve;
  });

  resizeCanvas();
  renderImageList();
  await loadAnnotations(image.id);
}

async function loadAnnotations(imageId) {
  const result = await api(`/api/annotations?data_dir=${encodeURIComponent(state.dataDir)}&image_id=${encodeURIComponent(imageId)}&format=${encodeURIComponent(state.format)}`);
  state.labels = result.labels || [];
  renderTable();
  redraw();
  setStatus(`已加载 ${state.activeImage.name}，当前 ${state.labels.length} 个标注。`);
}

async function saveAnnotations() {
  if (!state.activeImage) {
    return;
  }
  syncClassNames();
  await api(`/api/annotations?data_dir=${encodeURIComponent(state.dataDir)}&image_id=${encodeURIComponent(state.activeImage.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      format: state.format,
      class_names: state.classNames,
      labels: state.labels,
    }),
  });
  setStatus(`已保存 ${state.labels.length} 个标注到 ${state.activeImage.name} 的同名 txt。`);
}

function syncClassNames() {
  state.classNames = elements.classNamesInput.value
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
}

function setMode(mode) {
  state.mode = mode;
  state.pendingPoints = [];
  elements.modeBadge.textContent = `当前模式：${mode === "draw" ? "手动画 OBB" : mode === "sam" ? "SAM 智能标注" : "浏览"}`;
  redraw();
}

async function handleCanvasClick(event) {
  if (!state.activeImage) {
    return;
  }

  const rect = elements.overlayCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  if (state.mode === "draw") {
    state.pendingPoints.push([x, y]);
    if (state.pendingPoints.length === 4) {
      state.labels.push({
        label: nextLabel(),
        points: [...state.pendingPoints],
        confidence: null,
        track_id: null,
      });
      state.pendingPoints = [];
      state.selectedLabelIndex = state.labels.length - 1;
      renderTable();
    }
    redraw();
    return;
  }

  if (state.mode === "sam") {
    setStatus(`SAM 正在处理点击点 (${Math.round(x)}, ${Math.round(y)}) ...`);
    const result = await api("/api/sam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data_dir: state.dataDir,
        image_id: state.activeImage.id,
        x,
        y,
        label: nextLabel(),
      }),
    });
    state.labels.push(result);
    state.selectedLabelIndex = state.labels.length - 1;
    renderTable();
    redraw();
    setStatus("SAM 已生成 OBB，可以继续微调或直接保存。");
    return;
  }

  state.selectedLabelIndex = hitTest(x, y);
  renderTable();
  redraw();
}

function nextLabel() {
  return state.classNames[0] || "0";
}

function resizeCanvas() {
  const width = elements.imageLayer.naturalWidth;
  const height = elements.imageLayer.naturalHeight;
  elements.canvasWrap.style.width = `${width}px`;
  elements.canvasWrap.style.height = `${height}px`;
  elements.overlayCanvas.width = width;
  elements.overlayCanvas.height = height;
  elements.imageLayer.width = width;
  elements.imageLayer.height = height;
}

function redraw() {
  ctx.clearRect(0, 0, elements.overlayCanvas.width, elements.overlayCanvas.height);
  state.labels.forEach((shape, index) => drawShape(shape, index === state.selectedLabelIndex));
  if (state.pendingPoints.length > 0) {
    drawPending();
  }
}

function drawShape(shape, isActive = false) {
  const points = shape.points || [];
  if (points.length < 4) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = isActive ? "#2a7d58" : "#bb4d00";
  ctx.fillStyle = isActive ? "rgba(42,125,88,0.16)" : "rgba(187,77,0,0.12)";
  ctx.lineWidth = isActive ? 3 : 2;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index][0], points[index][1]);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.font = "12px sans-serif";
  ctx.fillText(shape.label ?? "0", points[0][0] + 4, points[0][1] - 6);
  ctx.restore();
}

function drawPending() {
  ctx.save();
  ctx.strokeStyle = "#1f2a24";
  ctx.fillStyle = "rgba(31,42,36,0.1)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(state.pendingPoints[0][0], state.pendingPoints[0][1]);
  for (let index = 1; index < state.pendingPoints.length; index += 1) {
    ctx.lineTo(state.pendingPoints[index][0], state.pendingPoints[index][1]);
  }
  ctx.stroke();
  for (const point of state.pendingPoints) {
    ctx.beginPath();
    ctx.arc(point[0], point[1], 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function renderTable() {
  elements.labelTableBody.innerHTML = "";
  state.labels.forEach((item, index) => {
    const tr = document.createElement("tr");
    if (index === state.selectedLabelIndex) {
      tr.className = "active";
    }
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td contenteditable="true" data-field="label">${item.label ?? ""}</td>
      <td contenteditable="true" data-field="confidence">${item.confidence ?? ""}</td>
      <td contenteditable="true" data-field="track_id">${item.track_id ?? ""}</td>
      <td>${(item.points || []).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" | ")}</td>
    `;
    tr.addEventListener("click", () => {
      state.selectedLabelIndex = index;
      renderTable();
      redraw();
    });
    tr.querySelectorAll("[contenteditable=true]").forEach((cell) => {
      cell.addEventListener("blur", () => {
        const field = cell.dataset.field;
        let value = cell.textContent.trim();
        if (field === "confidence") {
          value = value ? Number(value) : null;
        } else if (field === "track_id") {
          value = value ? Number(value) : null;
        }
        state.labels[index][field] = value;
      });
    });
    elements.labelTableBody.append(tr);
  });
  elements.labelCount.textContent = `${state.labels.length} 个`;
}

function deleteSelectedShape() {
  if (state.selectedLabelIndex < 0) {
    return;
  }
  state.labels.splice(state.selectedLabelIndex, 1);
  state.selectedLabelIndex = -1;
  renderTable();
  redraw();
}

function hitTest(x, y) {
  for (let index = state.labels.length - 1; index >= 0; index -= 1) {
    const points = state.labels[index].points || [];
    if (points.length < 4) {
      continue;
    }
    if (pointInPolygon([x, y], points)) {
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

function setStatus(text) {
  elements.statusText.textContent = text;
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
