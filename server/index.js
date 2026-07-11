const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// ── Static file server ──────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, '../public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(__dirname, '../public/index.html'), (e, d) => {
        if (e) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(d);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

// ── Room registry ───────────────────────────
const rooms = new Map();

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function broadcastRoom(code, obj, except = null) {
  const room = rooms.get(code);
  if (!room) return;
  [room.host, room.guest].forEach(ws => {
    if (ws && ws !== except) send(ws, obj);
  });
}

// ── WebSocket ───────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws._roomCode = null;
  ws._role = null;

  // Single unified message handler (handles both text JSON and binary)
  ws.on('message', (data, isBinary) => {

    // ── Binary: video chunk relay ──
    if (isBinary) {
      const room = rooms.get(ws._roomCode);
      if (!room) return;
      const target = ws._role === 'host' ? room.guest : room.host;
      if (target && target.readyState === target.OPEN) {
        target.send(data, { binary: true });
      }
      return;
    }

    // ── Text JSON messages ──
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    const { type, payload = {} } = msg;

    if (type === 'CREATE_ROOM') {
      const code = genCode();
      rooms.set(code, { host: ws, guest: null });
      ws._roomCode = code;
      ws._role = 'host';
      send(ws, { type: 'ROOM_CREATED', payload: { code } });
      console.log(`[room] created ${code}`);
    }

    else if (type === 'JOIN_ROOM') {
      const code = (payload.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) { send(ws, { type: 'ERROR', payload: { msg: '找不到此房間號，請確認後再試' } }); return; }
      if (room.guest) { send(ws, { type: 'ERROR', payload: { msg: '此房間已有人加入' } }); return; }
      room.guest = ws;
      ws._roomCode = code;
      ws._role = 'guest';
      send(ws, { type: 'JOIN_OK', payload: { code } });
      send(room.host, { type: 'GUEST_JOINED' });
      console.log(`[room] ${code} guest joined`);
    }

    else if (type === 'HOST_ACK') {
      const room = rooms.get(ws._roomCode);
      if (room?.guest) send(room.guest, { type: 'HOST_ACK' });
    }

    else if (type === 'START_COUNTDOWN') {
      broadcastRoom(ws._roomCode, { type: 'START_COUNTDOWN' });
      console.log(`[room] ${ws._roomCode} countdown started`);
    }

    else if (type === 'STOP_RECORDING') {
      broadcastRoom(ws._roomCode, { type: 'STOP_RECORDING' });
    }

    else if (type === 'RELAY') {
      const room = rooms.get(ws._roomCode);
      if (!room) return;
      const target = ws._role === 'host' ? room.guest : room.host;
      send(target, { type: 'RELAY', payload });
    }

    else if (type === 'PING') {
      send(ws, { type: 'PONG' });
    }
  });

  ws.on('close', () => {
    const code = ws._roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    broadcastRoom(code, { type: 'PARTNER_LEFT' }, ws);
    rooms.delete(code);
    console.log(`[room] ${code} closed`);
  });

  ws.on('error', (e) => console.error('ws error', e.message));
});

server.listen(PORT, () => {
  console.log(`✦ DuoTalk server running on port ${PORT}`);
});
