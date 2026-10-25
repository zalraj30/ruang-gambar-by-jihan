'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'board.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_STROKES = 5000;
const MAX_POINTS_PER_STROKE = 5000;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  pingInterval: 25000,
  pingTimeout: 20000
});

let strokes = [];
let saveQueue = Promise.resolve();
const activeStrokes = new Map();

app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, strokes: strokes.length, online: io.engine.clientsCount });
});

function validPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function cleanPoints(points, maxAllowed = MAX_POINTS_PER_STROKE) {
  if (!Array.isArray(points) || points.length < 1) return null;
  const cleaned = [];
  for (const point of points) {
    if (!validPoint(point)) return null;
    cleaned.push({ x: Math.round(point.x * 100000) / 100000, y: Math.round(point.y * 100000) / 100000 });
  }
  if (cleaned.length > maxAllowed) return null;
  return cleaned;
}

function queueSave() {
  // Queue writes so a slower disk write cannot overwrite a newer board snapshot.
  const snapshot = JSON.stringify({ version: 1, strokes });
  saveQueue = saveQueue
    .then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const temporaryFile = `${DATA_FILE}.tmp`;
      await fs.writeFile(temporaryFile, snapshot, 'utf8');
      await fs.rename(temporaryFile, DATA_FILE);
    })
    .catch((error) => console.error('Gagal menyimpan papan:', error));
}

function commitStroke(stroke) {
  strokes.push(stroke);
  if (strokes.length > MAX_STROKES) strokes = strokes.slice(-MAX_STROKES);
  queueSave();
  io.emit('stroke:saved', stroke);
  io.emit('board:count', { strokes: strokes.length });
}

async function loadBoard() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.strokes)) {
      strokes = parsed.strokes.slice(-MAX_STROKES).filter((stroke) => {
        return stroke && typeof stroke.id === 'string' && Array.isArray(stroke.points)
          && stroke.points.length > 0 && stroke.points.length <= MAX_POINTS_PER_STROKE
          && stroke.points.every(validPoint) && HEX_COLOR.test(stroke.color)
          && ['brush', 'erase'].includes(stroke.mode)
          && Number.isFinite(stroke.size) && stroke.size > 0 && stroke.size <= 0.15;
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Tidak bisa membaca penyimpanan papan:', error);
  }
}

io.on('connection', (socket) => {
  socket.emit('board:init', { strokes, online: io.engine.clientsCount });
  io.emit('presence:update', { online: io.engine.clientsCount });

  socket.on('stroke:start', (incoming) => {
    if (!incoming || typeof incoming.id !== 'string' || incoming.id.length > 100) return;
    if (activeStrokes.has(incoming.id)) return;
    if (!HEX_COLOR.test(incoming.color)) return;
    if (!['brush', 'erase'].includes(incoming.mode)) return;
    if (!Number.isFinite(incoming.size) || incoming.size < 0.0001 || incoming.size > 0.15) return;
    const points = cleanPoints(incoming.points, 1);
    if (!points) return;

    const stroke = {
      id: incoming.id,
      color: incoming.color,
      size: incoming.size,
      mode: incoming.mode,
      points,
      createdAt: Date.now()
    };
    activeStrokes.set(stroke.id, { owner: socket.id, stroke });
    socket.broadcast.emit('stroke:start', stroke);
  });

  socket.on('stroke:points', (message) => {
    if (!message || typeof message.id !== 'string') return;
    const entry = activeStrokes.get(message.id);
    if (!entry || entry.owner !== socket.id) return;
    const points = cleanPoints(message.points, MAX_POINTS_PER_STROKE);
    if (!points || entry.stroke.points.length + points.length > MAX_POINTS_PER_STROKE) return;
    entry.stroke.points.push(...points);
    socket.broadcast.emit('stroke:points', { id: message.id, points });
  });

  socket.on('stroke:end', (message) => {
    if (!message || typeof message.id !== 'string') return;
    const entry = activeStrokes.get(message.id);
    if (!entry || entry.owner !== socket.id) return;
    activeStrokes.delete(message.id);
    commitStroke(entry.stroke);
  });

  socket.on('disconnect', () => {
    // If someone closes a tab mid-stroke, keep the portion already received.
    for (const [id, entry] of activeStrokes.entries()) {
      if (entry.owner === socket.id) {
        activeStrokes.delete(id);
        if (entry.stroke.points.length) commitStroke(entry.stroke);
      }
    }
    io.emit('presence:update', { online: io.engine.clientsCount });
  });
});

loadBoard().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Ruang Gambar berjalan di http://localhost:${PORT}`);
    console.log(`Folder penyimpanan: ${DATA_DIR}`);
  });
}).catch((error) => {
  console.error('Gagal menyiapkan server:', error);
  process.exit(1);
});
