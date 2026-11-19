const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const STATE_FILE = path.join(__dirname, 'state.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    cb(null, safeName);
  }
});

const upload = multer({ storage });

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { mode: 'text', text: 'Pi Display Ready', mediaUrl: null, mediaType: null, updatedAt: null };
  }
}

function writeState(nextState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2));
}

const sseClients = new Set();

function broadcastState(state) {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/api/state', (_req, res) => {
  res.json(readState());
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify(readState())}\n\n`);
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

app.post('/api/text', (req, res) => {
  const text = typeof req.body.text === 'string' ? req.body.text : '';
  const state = {
    mode: 'text',
    text,
    mediaUrl: null,
    mediaType: null,
    updatedAt: new Date().toISOString()
  };
  writeState(state);
  broadcastState(state);
  res.json(state);
});

app.post('/api/upload', upload.single('media'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const isVideo = req.file.mimetype.startsWith('video/');
  const state = {
    mode: 'media',
    text: '',
    mediaUrl: `/uploads/${req.file.filename}`,
    mediaType: isVideo ? 'video' : 'image',
    updatedAt: new Date().toISOString()
  };
  writeState(state);
  broadcastState(state);
  res.json(state);
});

app.get('/api/uploads', (_req, res) => {
  const files = fs.readdirSync(UPLOADS_DIR).filter((f) => !f.startsWith('.'));
  res.json(files.map((f) => `/uploads/${f}`));
});

app.listen(PORT, () => {
  console.log(`Pi Display server running at http://localhost:${PORT}`);
  console.log(`Controller: http://localhost:${PORT}/controller.html`);
  console.log(`Display:    http://localhost:${PORT}/display.html`);
});
