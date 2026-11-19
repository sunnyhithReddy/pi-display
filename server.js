const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const STATE_FILE = path.join(__dirname, 'state.json');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// Load or initialize persistent state for slots img1..img7
let state = {
  slots: {
    img1: null,
    img2: null,
    img3: null,
    img4: null,
    img5: null,
    img6: null,
    img7: null
  },
  activeSlot: null,
  monitorOn: true
};

if (fs.existsSync(STATE_FILE)) {
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  } catch (err) {
    console.error('Failed to read state.json, starting fresh:', err);
  }
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Configure local file storage per slot
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const slot = req.params.slot;
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `${slot}_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const valid = allowed.test(path.extname(file.originalname).toLowerCase());
    cb(null, valid);
  }
});

app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// Default route serves the phone controller UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'controller.html'));
});

// Kiosk display route opened on the portable monitor
app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

// Get current slot thumbnails, active image, and monitor status
app.get('/api/state', (req, res) => {
  res.json(state);
});

// Upload image/GIF to a specific slot (img1 - img7)
app.post('/api/upload/:slot', upload.single('media'), (req, res) => {
  const { slot } = req.params;
  if (!Object.prototype.hasOwnProperty.call(state.slots, slot)) {
    return res.status(400).json({ error: 'Invalid slot' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No valid image/GIF uploaded' });
  }

  // Delete previous file in this slot to save SD card space
  if (state.slots[slot]) {
    const oldFile = path.join(UPLOAD_DIR, path.basename(state.slots[slot]));
    if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
  }

  const fileUrl = `/uploads/${req.file.filename}`;
  state.slots[slot] = fileUrl;
  state.activeSlot = slot;
  saveState();

  io.emit('stateUpdate', state);
  res.json(state);
});

// Select an existing slot to display on the portable monitor
app.post('/api/select/:slot', (req, res) => {
  const { slot } = req.params;
  if (!Object.prototype.hasOwnProperty.call(state.slots, slot)) {
    return res.status(400).json({ error: 'Invalid slot' });
  }

  state.activeSlot = slot;
  saveState();

  io.emit('stateUpdate', state);
  res.json(state);
});

// Toggle HDMI monitor power to save battery
app.post('/api/monitor/toggle', (req, res) => {
  state.monitorOn = !state.monitorOn;
  saveState();

  // Works across Raspberry Pi OS Bookworm (Wayland/wlr-randr) and Bullseye (X11/xrandr)
  const cmd = state.monitorOn
    ? 'WAYLAND_DISPLAY=wayland-1 wlr-randr --output HDMI-A-1 --on 2>/dev/null || DISPLAY=:0 xrandr --output HDMI-1 --auto 2>/dev/null || vcgencmd display_power 1'
    : 'WAYLAND_DISPLAY=wayland-1 wlr-randr --output HDMI-A-1 --off 2>/dev/null || DISPLAY=:0 xrandr --output HDMI-1 --off 2>/dev/null || vcgencmd display_power 0';

  exec(cmd, (err) => {
    if (err) console.warn('Hardware HDMI toggle warning (falling back to black screen):', err.message);
  });

  io.emit('stateUpdate', state);
  res.json(state);
});

io.on('connection', (socket) => {
  socket.emit('stateUpdate', state);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Pi Display Server running on http://0.0.0.0:${PORT}`);
});