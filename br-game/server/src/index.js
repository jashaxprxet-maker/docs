import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuid } from 'uuid';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static('public'));

const TICK_RATE = 30; // 30Hz authoritative loop
const WORLD_SIZE = 2048;
const PLAYER_RADIUS = 16;
const FIRE_COOLDOWN_MS = 120;
const BULLET_RANGE = 700;
const BULLET_DAMAGE = 25;
const RESPAWN_MS = 5000;

// Zone configuration (shrinking circle)
const ZONE_START_RADIUS = WORLD_SIZE * 0.75;
const ZONE_MIN_RADIUS = 160;
const ZONE_SHRINK_RATE = 30; // units per second
const ZONE_DPS = 6; // damage per second outside zone

const players = new Map(); // socketId -> player state

const zone = {
  x: WORLD_SIZE / 2,
  y: WORLD_SIZE / 2,
  radius: ZONE_START_RADIUS,
};

function spawnPoint() {
  return {
    x: Math.floor(Math.random() * WORLD_SIZE),
    y: Math.floor(Math.random() * WORLD_SIZE),
  };
}

function createPlayer(socketId, name) {
  const id = uuid();
  const pos = spawnPoint();
  return {
    id,
    socketId,
    name: name || `Player-${id.slice(0, 4)}`,
    x: pos.x,
    y: pos.y,
    rot: 0,
    hp: 100,
    alive: true,
    vx: 0,
    vy: 0,
    lastInputSeq: 0,
    lastShotAt: 0,
    respawnAt: 0,
  };
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

// Returns the closest hit (t in [0,1]) or null
function raycastToCircle(rayOrigin, rayDirUnit, rayLength, circleCenter, circleRadius) {
  const ox = rayOrigin.x - circleCenter.x;
  const oy = rayOrigin.y - circleCenter.y;
  // Solve quadratic for |(o + d*t)| = r with t scaled by length
  const dx = rayDirUnit.x;
  const dy = rayDirUnit.y;
  const a = dx * dx + dy * dy; // = 1
  const b = 2 * (ox * dx + oy * dy);
  const c = ox * ox + oy * oy - circleRadius * circleRadius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);
  const tNear = Math.min(t1, t2);
  const tFar = Math.max(t1, t2);
  // Accept first intersection within [0, rayLength]
  if (tNear >= 0 && tNear <= rayLength) return tNear;
  if (tFar >= 0 && tFar <= rayLength) return tFar;
  return null;
}

function applyDamage(target, amount) {
  if (!target.alive) return false;
  target.hp = Math.max(0, target.hp - amount);
  if (target.hp === 0) {
    target.alive = false;
    target.vx = 0;
    target.vy = 0;
    target.respawnAt = Date.now() + RESPAWN_MS;
    return true;
  }
  return false;
}

io.on('connection', (socket) => {
  const player = createPlayer(socket.id);
  players.set(socket.id, player);

  socket.emit('init', {
    self: player,
    others: Array.from(players.values()).filter(p => p.socketId !== socket.id),
    world: { size: WORLD_SIZE },
    zone,
  });

  socket.broadcast.emit('player:join', player);

  socket.on('input', (input) => {
    const p = players.get(socket.id);
    if (!p || !p.alive) return;

    // input: { up, down, left, right, rot, seq }
    const speed = 180; // units per second
    let vx = 0, vy = 0;
    if (input.up) vy -= 1;
    if (input.down) vy += 1;
    if (input.left) vx -= 1;
    if (input.right) vx += 1;

    const len = Math.hypot(vx, vy) || 1;
    p.vx = (vx / len) * speed;
    p.vy = (vy / len) * speed;
    if (typeof input.rot === 'number') p.rot = input.rot;
    if (typeof input.seq === 'number') p.lastInputSeq = input.seq;
  });

  socket.on('shoot', ({ rot, seq }) => {
    const shooter = players.get(socket.id);
    if (!shooter || !shooter.alive) return;
    const now = Date.now();
    if (now - shooter.lastShotAt < FIRE_COOLDOWN_MS) return;
    shooter.lastShotAt = now;

    const origin = { x: shooter.x, y: shooter.y };
    const dir = { x: Math.cos(rot), y: Math.sin(rot) };

    let closestHit = null; // { target, t }
    for (const p of players.values()) {
      if (!p.alive || p.id === shooter.id) continue;
      const t = raycastToCircle(origin, dir, BULLET_RANGE, { x: p.x, y: p.y }, PLAYER_RADIUS);
      if (t == null) continue;
      if (!closestHit || t < closestHit.t) closestHit = { target: p, t };
    }

    let hitId = null;
    let end = { x: origin.x + dir.x * BULLET_RANGE, y: origin.y + dir.y * BULLET_RANGE };
    if (closestHit) {
      hitId = closestHit.target.id;
      end = { x: origin.x + dir.x * closestHit.t, y: origin.y + dir.y * closestHit.t };
      const killed = applyDamage(closestHit.target, BULLET_DAMAGE);
      if (killed) io.emit('player:down', { id: closestHit.target.id });
    }

    io.emit('effect:shot', { shooterId: shooter.id, hitId, from: origin, to: end });
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    players.delete(socket.id);
    io.emit('player:leave', { id: p?.id, socketId: socket.id });
  });
});

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTick) / 1000; // seconds
  lastTick = now;

  // integrate positions
  for (const p of players.values()) {
    if (!p.alive) continue;
    p.x = Math.max(0, Math.min(WORLD_SIZE, p.x + p.vx * dt));
    p.y = Math.max(0, Math.min(WORLD_SIZE, p.y + p.vy * dt));
  }

  // shrink zone
  if (zone.radius > ZONE_MIN_RADIUS) {
    zone.radius = Math.max(ZONE_MIN_RADIUS, zone.radius - ZONE_SHRINK_RATE * dt);
  }

  // zone damage
  for (const p of players.values()) {
    if (!p.alive) continue;
    const dist = distance({ x: p.x, y: p.y }, zone);
    if (dist > zone.radius) {
      const killed = applyDamage(p, ZONE_DPS * dt);
      if (killed) io.emit('player:down', { id: p.id });
    }
  }

  // respawn handling
  for (const p of players.values()) {
    if (p.alive) continue;
    if (now >= p.respawnAt) {
      const pos = spawnPoint();
      p.x = pos.x; p.y = pos.y; p.hp = 100; p.alive = true; p.respawnAt = 0;
      io.emit('player:respawn', { id: p.id, x: p.x, y: p.y });
    }
  }

  // broadcast state snapshot
  io.emit('state', {
    t: now,
    players: Array.from(players.values()).map(({ socketId, ...rest }) => rest),
    zone,
  });
}, 1000 / TICK_RATE);

const DESIRED_PORT = Number(process.env.PORT) || 8080;

function startServer(port) {
  httpServer.listen(port, () => {
    const addr = httpServer.address();
    console.log(`Server running on :${typeof addr === 'object' ? addr.port : port}`);
  });
}

httpServer.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE' && DESIRED_PORT !== 0) {
    console.warn(`Port ${DESIRED_PORT} in use, falling back to random port`);
    // Try an ephemeral port
    startServer(0);
  } else {
    throw err;
  }
});

startServer(DESIRED_PORT);
