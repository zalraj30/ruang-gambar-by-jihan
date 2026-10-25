'use strict';

(() => {
  const permanentCanvas = document.getElementById('permanentCanvas');
  const liveCanvas = document.getElementById('liveCanvas');
  const frame = document.getElementById('canvasFrame');
  const permanentCtx = permanentCanvas.getContext('2d');
  const liveCtx = liveCanvas.getContext('2d');
  const brushButton = document.getElementById('brushTool');
  const eraserButton = document.getElementById('eraserTool');
  const colorInput = document.getElementById('customColor');
  const sizeInput = document.getElementById('brushSize');
  const sizeValue = document.getElementById('sizeValue');
  const onlineCount = document.getElementById('onlineCount');
  const strokeCount = document.getElementById('strokeCount');
  const canvasHint = document.getElementById('canvasHint');
  const saveIcon = document.getElementById('saveIcon');
  const saveTitle = document.getElementById('saveTitle');
  const saveSubtitle = document.getElementById('saveSubtitle');
  const toast = document.getElementById('toast');
  const downloadButton = document.getElementById('downloadButton');

  const MAX_LOCAL_STROKES = 5000;
  let boardStrokes = [];
  const activeStrokes = new Map();
  let currentStroke = null;
  let pendingPoints = [];
  let animationQueued = false;
  let currentTool = 'brush';
  let currentColor = '#232323';
  let toastTimer;
  let lastSaveNotice = 0;
  const socket = io({ reconnection: true, reconnectionDelayMax: 5000 });

  const getSize = () => Math.min(frame.clientWidth || 1, frame.clientHeight || 1);
  const getPoint = (event) => {
    const rect = liveCanvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    };
  };

  function fitCanvases() {
    const rect = frame.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    [permanentCanvas, liveCanvas].forEach((canvas) => {
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    });
    redrawBoard();
    redrawLiveLayer();
  }

  function drawStroke(ctx, stroke) {
    if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length) return;
    const width = frame.clientWidth;
    const height = frame.clientHeight;
    const points = stroke.points;
    const lineWidth = Math.max(0.8, stroke.size * getSize());
    ctx.save();
    ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.color || '#232323';
    ctx.fillStyle = stroke.color || '#232323';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x * width, points[0].y * height, lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(points[0].x * width, points[0].y * height);
      for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i].x * width, points[i].y * height);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function redrawBoard() {
    permanentCtx.clearRect(0, 0, frame.clientWidth, frame.clientHeight);
    for (const stroke of boardStrokes) drawStroke(permanentCtx, stroke);
    updateBoardMeta();
  }

  function redrawLiveLayer() {
    liveCtx.clearRect(0, 0, frame.clientWidth, frame.clientHeight);
    for (const stroke of activeStrokes.values()) drawStroke(liveCtx, stroke);
  }

  function scheduleLiveRedraw() {
    if (animationQueued) return;
    animationQueued = true;
    requestAnimationFrame(() => {
      animationQueued = false;
      flushPendingPoints();
      redrawLiveLayer();
    });
  }

  function updateBoardMeta() {
    strokeCount.textContent = `${boardStrokes.length.toLocaleString('id-ID')} goresan`;
    canvasHint.classList.toggle('hidden', boardStrokes.length > 0 || activeStrokes.size > 0);
  }

  function setConnectionState(connected) {
    saveIcon.classList.toggle('is-offline', !connected);
    saveIcon.textContent = connected ? '✓' : '!';
    saveTitle.textContent = connected ? 'Tersimpan otomatis' : 'Koneksi terputus';
    saveSubtitle.textContent = connected ? 'Karya tersimpan di papan publik' : 'Cek koneksi internetmu';
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2300);
  }

  function announceSaved() {
    const now = Date.now();
    if (now - lastSaveNotice > 1500) {
      saveTitle.textContent = 'Tersimpan otomatis';
      saveSubtitle.textContent = 'Karya terbaru sudah tersimpan';
      lastSaveNotice = now;
      window.setTimeout(() => {
        if (socket.connected) saveSubtitle.textContent = 'Karya tersimpan di papan publik';
      }, 2400);
    }
  }

  function chooseTool(tool) {
    currentTool = tool;
    const brushActive = tool === 'brush';
    brushButton.classList.toggle('active', brushActive);
    brushButton.setAttribute('aria-pressed', String(brushActive));
    eraserButton.classList.toggle('active', !brushActive);
    eraserButton.setAttribute('aria-pressed', String(!brushActive));
    liveCanvas.classList.toggle('eraser-cursor', !brushActive);
  }

  function selectColor(color, updateInput = true) {
    currentColor = color;
    if (updateInput) colorInput.value = color;
    document.querySelectorAll('.swatch').forEach((button) => {
      const selected = button.dataset.color.toLowerCase() === color.toLowerCase();
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    chooseTool('brush');
  }

  function flushPendingPoints() {
    if (!currentStroke || pendingPoints.length === 0) return;
    const pointsToSend = pendingPoints;
    pendingPoints = [];
    socket.emit('stroke:points', { id: currentStroke.id, points: pointsToSend });
  }

  function startStroke(event) {
    if (!socket.connected) {
      showToast('Lagi offline. Tunggu koneksi tersambung dulu ya.');
      return;
    }
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    liveCanvas.setPointerCapture?.(event.pointerId);
    const point = getPoint(event);
    const id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `stroke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const stroke = {
      id,
      color: currentColor,
      size: Number(sizeInput.value) / getSize(),
      mode: currentTool,
      points: [point]
    };
    currentStroke = stroke;
    activeStrokes.set(id, stroke);
    pendingPoints = [];
    socket.emit('stroke:start', {
      id: stroke.id,
      color: stroke.color,
      size: stroke.size,
      mode: stroke.mode,
      points: stroke.points
    });
    scheduleLiveRedraw();
    updateBoardMeta();
  }

  function moveStroke(event) {
    if (!currentStroke || event.pointerId !== undefined && !liveCanvas.hasPointerCapture?.(event.pointerId)) return;
    event.preventDefault();
    const point = getPoint(event);
    const previous = currentStroke.points[currentStroke.points.length - 1];
    if (previous && Math.abs(point.x - previous.x) < 0.0005 && Math.abs(point.y - previous.y) < 0.0005) return;
    if (currentStroke.points.length >= 5000) return;
    currentStroke.points.push(point);
    pendingPoints.push(point);
    scheduleLiveRedraw();
  }

  function endStroke(event) {
    if (!currentStroke) return;
    if (event && event.pointerId !== undefined && liveCanvas.hasPointerCapture?.(event.pointerId)) {
      liveCanvas.releasePointerCapture(event.pointerId);
    }
    flushPendingPoints();
    socket.emit('stroke:end', { id: currentStroke.id });
    currentStroke = null;
    pendingPoints = [];
  }

  brushButton.addEventListener('click', () => chooseTool('brush'));
  eraserButton.addEventListener('click', () => chooseTool('erase'));
  document.getElementById('swatches').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-color]');
    if (button) selectColor(button.dataset.color);
  });
  colorInput.addEventListener('input', () => selectColor(colorInput.value, false));
  sizeInput.addEventListener('input', () => { sizeValue.textContent = `${sizeInput.value} px`; });
  liveCanvas.addEventListener('pointerdown', startStroke);
  liveCanvas.addEventListener('pointermove', moveStroke);
  liveCanvas.addEventListener('pointerup', endStroke);
  liveCanvas.addEventListener('pointercancel', endStroke);
  liveCanvas.addEventListener('lostpointercapture', () => { if (currentStroke) endStroke(); });

  downloadButton.addEventListener('click', () => {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = permanentCanvas.width;
    exportCanvas.height = permanentCanvas.height;
    const context = exportCanvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    context.drawImage(permanentCanvas, 0, 0);
    context.drawImage(liveCanvas, 0, 0);
    const link = document.createElement('a');
    link.download = `ruang-gambar-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
    showToast('Gambar berhasil disiapkan sebagai PNG.');
  });

  socket.on('connect', () => setConnectionState(true));
  socket.on('disconnect', () => {
    setConnectionState(false);
    currentStroke = null;
    pendingPoints = [];
    activeStrokes.clear();
    redrawLiveLayer();
    updateBoardMeta();
  });
  socket.on('board:init', (data) => {
    boardStrokes = Array.isArray(data.strokes) ? data.strokes : [];
    activeStrokes.clear();
    redrawBoard();
    redrawLiveLayer();
    onlineCount.textContent = Number(data.online || 1).toLocaleString('id-ID');
    setConnectionState(socket.connected);
  });
  socket.on('presence:update', (data) => {
    onlineCount.textContent = Number(data.online || 0).toLocaleString('id-ID');
  });
  socket.on('board:count', updateBoardMeta);
  socket.on('stroke:start', (stroke) => {
    activeStrokes.set(stroke.id, { ...stroke, points: [...stroke.points] });
    scheduleLiveRedraw();
    updateBoardMeta();
  });
  socket.on('stroke:points', (message) => {
    const stroke = activeStrokes.get(message.id);
    if (!stroke || !Array.isArray(message.points)) return;
    stroke.points.push(...message.points);
    if (stroke.points.length > 5000) stroke.points = stroke.points.slice(-5000);
    scheduleLiveRedraw();
  });
  socket.on('stroke:saved', (stroke) => {
    activeStrokes.delete(stroke.id);
    boardStrokes.push(stroke);
    if (boardStrokes.length > MAX_LOCAL_STROKES) {
      boardStrokes = boardStrokes.slice(-MAX_LOCAL_STROKES);
      redrawBoard();
    } else {
      drawStroke(permanentCtx, stroke);
      updateBoardMeta();
    }
    scheduleLiveRedraw();
    announceSaved();
  });

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => fitCanvases());
    observer.observe(frame);
  } else {
    window.addEventListener('resize', fitCanvases);
  }
  sizeValue.textContent = `${sizeInput.value} px`;
  fitCanvases();
})();
