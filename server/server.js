const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3001;

// ─── Game Constants ───────────────────────────────────────────────────────────

const TICK_RATE = 20; // ticks per second
const TICK_MS = 1000 / TICK_RATE;
const MAP_SIZE = 30; // 30x30 grid

const TOWER_DEFS = {
  archer: { cost: 60,  damage: 18, range: 4.0, attacksPerSec: 1.5, aoe: 0,   color: "archer" },
  mage:   { cost: 110, damage: 40, range: 3.5, attacksPerSec: 0.8, aoe: 1.8, color: "mage"   },
  cannon: { cost: 160, damage: 65, range: 5.5, attacksPerSec: 0.5, aoe: 2.5, color: "cannon" },
};

const MAX_LEVEL = 5;
// Per-level multipliers for [damage, range, attacksPerSec]
const LEVEL_MULT = {
  1: [1.0,  1.0,  1.0 ],
  2: [1.6,  1.15, 1.2 ],
  3: [2.5,  1.3,  1.4 ],
  4: [3.8,  1.45, 1.6 ],
  5: [5.5,  1.6,  1.8 ],
};
// Gold cost to upgrade: fraction of base tower cost
const UPGRADE_COST_FRACTION = { 1: 0.8, 2: 1.4, 3: 2.0, 4: 2.8 };

function getTowerStats(type, level) {
  const def = TOWER_DEFS[type];
  const m = LEVEL_MULT[level] || LEVEL_MULT[1];
  return {
    damage:       Math.round(def.damage       * m[0]),
    range:        Math.round(def.range        * m[1] * 10) / 10,
    attacksPerSec: Math.round(def.attacksPerSec * m[2] * 10) / 10,
    aoe: def.aoe > 0 ? Math.round(def.aoe * (1 + (level - 1) * 0.15) * 10) / 10 : 0,
  };
}

function upgradeCost(type, currentLevel) {
  return Math.floor(TOWER_DEFS[type].cost * (UPGRADE_COST_FRACTION[currentLevel] ?? 999));
}

const ENEMY_DEFS = {
  goblin:    { hp: 35,  speed: 2.8, dmgToBase: 5,  sendCost: 25, reward: 8  },
  orc:       { hp: 130, speed: 1.1, dmgToBase: 20, sendCost: 70, reward: 28 },
  knight:    { hp: 85,  speed: 1.8, dmgToBase: 12, sendCost: 45, reward: 18 },
  troll:     { hp: 300, speed: 0.7, dmgToBase: 40, sendCost: 130, reward: 55 },
};

// Waves: array of { type, count, interval }
const WAVE_DEFS = [
  [{ type: "goblin", count: 6, interval: 0.8 }],
  [{ type: "goblin", count: 8, interval: 0.7 }, { type: "orc", count: 2, interval: 2.0 }],
  [{ type: "orc", count: 4, interval: 1.5 }, { type: "goblin", count: 5, interval: 0.6 }],
  [{ type: "knight", count: 6, interval: 1.0 }],
  [{ type: "goblin", count: 10, interval: 0.5 }, { type: "knight", count: 4, interval: 0.9 }],
  [{ type: "orc", count: 6, interval: 1.2 }, { type: "knight", count: 4, interval: 0.8 }],
  [{ type: "troll", count: 2, interval: 3.0 }, { type: "goblin", count: 12, interval: 0.4 }],
  [{ type: "troll", count: 4, interval: 2.0 }, { type: "knight", count: 6, interval: 0.7 }],
];

const INTERMISSION_SECS = 12;
const STARTING_GOLD = 150;
const BASE_HP = 100;

// Path waypoints in world coords (enemies follow these)
const PATH_WAYPOINTS = [
  { x: -17, z: -10 },  // spawn
  { x:  13, z: -10 },  // oben rechts
  { x:  13, z:  -5 },  // mitte rechts
  { x: -13, z:  -5 },  // mitte links
  { x: -13, z:   0 },  // unten links
  { x:  17, z:   0 },  // exit
];

// Pre-compute which grid cells are path cells (towers can't go here)
function buildPathCells() {
  const cells = new Set();
  const add = (x, z) => cells.add(`${x},${z}`);
  // Obere Reihe: gz=4,5, gx 0..28
  for (let x = 0; x <= 28; x++) { add(x, 4); add(x, 5); }
  // Rechte Spalte: gx=27,28, gz 4..10
  for (let z = 4; z <= 10; z++) { add(27, z); add(28, z); }
  // Mittlere Reihe: gz=9,10, gx 1..28
  for (let x = 1; x <= 28; x++) { add(x, 9); add(x, 10); }
  // Linke Spalte: gx=1,2, gz 9..15
  for (let z = 9; z <= 15; z++) { add(1, z); add(2, z); }
  // Untere Reihe: gz=14,15, gx 1..29
  for (let x = 1; x <= 29; x++) { add(x, 14); add(x, 15); }
  return cells;
}
const PATH_CELLS = buildPathCells();

// ─── Room State ───────────────────────────────────────────────────────────────

const rooms = new Map(); // roomId → room
let uidCounter = 0;
const uid = () => (++uidCounter).toString(36);

function createSide(playerId) {
  return {
    playerId,
    baseHP: BASE_HP,
    gold: STARTING_GOLD,
    towers: [],    // { id, type, gx, gz, cooldown }
    enemies: [],   // { id, type, hp, maxHp, progress, speed, dmgToBase }
    nextEnemyId: 0,
    nextTowerId: 0,
  };
}

function createRoom(name, mode, hostId) {
  return {
    id: uid(),
    name,
    mode, // "1v1" | "2v2"
    hostId,
    players: [hostId],
    readySet: new Set(),
    state: "waiting", // waiting | playing | finished
    sides: [null, null], // sides[0] = player[0]'s side, sides[1] = player[1]'s side
    wave: 0,
    waveTimer: INTERMISSION_SECS, // seconds until next wave starts
    wavePhase: "intermission",    // "intermission" | "wave"
    pendingSpawns: [[], []],      // per-side spawn queues
    spawnTimers: [0, 0],
    spawnQueues: [[], []],        // [{ type, delay }, ...]
    created: Date.now(),
  };
}

// Convert grid coords to world coords
function gridToWorld(gx, gz) {
  return { x: gx - 14.5, z: gz - 14.5 };
}

// Distance between two world points
function dist(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// Get world position of enemy from its path progress (0..1)
function enemyWorldPos(progress) {
  const totalLen = pathLength();
  let traveled = progress * totalLen;
  for (let i = 0; i < PATH_WAYPOINTS.length - 1; i++) {
    const a = PATH_WAYPOINTS[i];
    const b = PATH_WAYPOINTS[i + 1];
    const segLen = dist(a, b);
    if (traveled <= segLen) {
      const t = traveled / segLen;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    traveled -= segLen;
  }
  return { ...PATH_WAYPOINTS[PATH_WAYPOINTS.length - 1] };
}

let _pathLength = null;
function pathLength() {
  if (_pathLength) return _pathLength;
  _pathLength = 0;
  for (let i = 0; i < PATH_WAYPOINTS.length - 1; i++) {
    _pathLength += dist(PATH_WAYPOINTS[i], PATH_WAYPOINTS[i + 1]);
  }
  return _pathLength;
}

// ─── Game Logic ───────────────────────────────────────────────────────────────

function startGame(room) {
  room.state = "playing";
  room.wave = 0;
  room.waveTimer = INTERMISSION_SECS;
  room.wavePhase = "intermission";
  room.sides[0] = createSide(room.players[0]);
  room.sides[1] = createSide(room.players[1]);
  room.spawnQueues = [[], []];
  room.spawnTimers = [0, 0];
  io.to(room.id).emit("gameStart", {
    pathWaypoints: PATH_WAYPOINTS,
    pathCells: [...PATH_CELLS],
    towerDefs: TOWER_DEFS,
    enemyDefs: ENEMY_DEFS,
    playerIndex: -1, // overridden per socket below
  });
  // Tell each player their index
  room.players.forEach((pid, idx) => {
    io.to(pid).emit("playerIndex", idx);
  });
}

function spawnEnemy(side, type) {
  const def = ENEMY_DEFS[type];
  if (!def) return;
  side.enemies.push({
    id: `e${side.nextEnemyId++}`,
    type,
    hp: def.hp,
    maxHp: def.hp,
    progress: 0,
    speed: def.speed,
    dmgToBase: def.dmgToBase,
  });
}

function tickSide(side, dt, spawnQueue, spawnTimerRef) {
  // Process spawn queue
  spawnTimerRef.t -= dt;
  if (spawnTimerRef.t <= 0 && spawnQueue.length > 0) {
    const next = spawnQueue.shift();
    spawnEnemy(side, next.type);
    spawnTimerRef.t = spawnQueue.length > 0 ? spawnQueue[0].delay : 0;
  }

  const totalLen = pathLength();
  const dead = [];

  // Move enemies
  for (const e of side.enemies) {
    e.progress += (e.speed * dt) / totalLen;
    if (e.progress >= 1) {
      side.baseHP -= e.dmgToBase;
      dead.push(e.id);
    }
  }

  // Tower attacks
  for (const tower of side.towers) {
    tower.cooldown -= dt;
    if (tower.cooldown > 0) continue;

    const stats = getTowerStats(tower.type, tower.level || 1);
    const tPos = gridToWorld(tower.gx, tower.gz);
    tPos.y = 0;

    // Find enemies in range
    const inRange = side.enemies
      .filter((e) => !dead.includes(e.id))
      .filter((e) => {
        const ePos = enemyWorldPos(e.progress);
        return dist(tPos, ePos) <= stats.range;
      })
      .sort((a, b) => b.progress - a.progress); // target furthest first

    if (inRange.length === 0) continue;

    tower.cooldown = 1 / stats.attacksPerSec;
    tower.lastTargetId = inRange[0].id;

    if (stats.aoe > 0) {
      // AoE: damage all enemies near the primary target
      const primaryPos = enemyWorldPos(inRange[0].progress);
      for (const e of side.enemies) {
        if (dead.includes(e.id)) continue;
        const ePos = enemyWorldPos(e.progress);
        if (dist(primaryPos, ePos) <= stats.aoe) {
          e.hp -= stats.damage;
          if (e.hp <= 0) {
            dead.push(e.id);
            side.gold += ENEMY_DEFS[e.type].reward;
          }
        }
      }
    } else {
      inRange[0].hp -= stats.damage;
      if (inRange[0].hp <= 0) {
        dead.push(inRange[0].id);
        side.gold += ENEMY_DEFS[inRange[0].type].reward;
      }
    }
  }

  // Remove dead enemies
  side.enemies = side.enemies.filter((e) => !dead.includes(e.id));
}

function queueWaveForSide(sideIdx, waveIdx, queues, timers) {
  const waveDef = WAVE_DEFS[waveIdx % WAVE_DEFS.length];
  const queue = [];
  for (const group of waveDef) {
    for (let i = 0; i < group.count; i++) {
      queue.push({ type: group.type, delay: group.interval });
    }
  }
  queues[sideIdx] = queue;
  timers[sideIdx] = { t: 0 };
}

function tickRoom(room, dt) {
  if (room.state !== "playing") return;

  const [s0, s1] = room.sides;

  // Wave / intermission timer
  room.waveTimer -= dt;
  if (room.waveTimer <= 0) {
    if (room.wavePhase === "intermission") {
      room.wave++;
      room.wavePhase = "wave";
      room.waveTimer = 999; // wave ends when queue is empty
      queueWaveForSide(0, room.wave - 1, room.spawnQueues, room.spawnTimers);
      queueWaveForSide(1, room.wave - 1, room.spawnQueues, room.spawnTimers);
      io.to(room.id).emit("waveStart", room.wave);
    } else {
      room.wavePhase = "intermission";
      room.waveTimer = INTERMISSION_SECS;
    }
  }

  // If wave phase and both queues empty → end wave
  if (
    room.wavePhase === "wave" &&
    room.spawnQueues[0].length === 0 &&
    room.spawnQueues[1].length === 0 &&
    s0.enemies.length === 0 &&
    s1.enemies.length === 0
  ) {
    room.wavePhase = "intermission";
    room.waveTimer = INTERMISSION_SECS;
    // Bonus gold for surviving the wave
    s0.gold += 30 + room.wave * 5;
    s1.gold += 30 + room.wave * 5;
  }

  const t0 = room.spawnTimers[0] || { t: 0 };
  const t1 = room.spawnTimers[1] || { t: 0 };
  tickSide(s0, dt, room.spawnQueues[0], t0);
  tickSide(s1, dt, room.spawnQueues[1], t1);
  room.spawnTimers[0] = t0;
  room.spawnTimers[1] = t1;

  // Check win condition
  if (s0.baseHP <= 0 || s1.baseHP <= 0) {
    room.state = "finished";
    const winner = s0.baseHP <= 0 ? 1 : 0;
    io.to(room.id).emit("gameOver", {
      winnerIndex: winner,
      winnerId: room.players[winner],
    });
  }
}

function buildClientState(room) {
  return {
    wave: room.wave,
    wavePhase: room.wavePhase,
    waveTimer: Math.max(0, room.waveTimer),
    sides: room.sides.map((s) => ({
      playerId: s.playerId,
      baseHP: Math.max(0, s.baseHP),
      gold: s.gold,
      towers: s.towers.map((t) => ({
        id: t.id, type: t.type, gx: t.gx, gz: t.gz,
        level: t.level || 1,
        attacking: t.lastTargetId || null,
      })),
      enemies: s.enemies.map((e) => ({
        id: e.id, type: e.type, progress: e.progress,
        hp: e.hp, maxHp: e.maxHp,
      })),
    })),
  };
}

// ─── Game Loop ────────────────────────────────────────────────────────────────

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  for (const [, room] of rooms) {
    if (room.state !== "playing") continue;
    tickRoom(room, dt);
    io.to(room.id).emit("gameState", buildClientState(room));
  }
}, TICK_MS);

// ─── Socket.io Events ─────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log("connect", socket.id);

  const sendRoomList = () => {
    const list = [...rooms.values()]
      .filter((r) => r.state === "waiting")
      .map((r) => ({
        id: r.id,
        name: r.name,
        mode: r.mode,
        players: r.players.length,
        maxPlayers: r.mode === "1v1" ? 2 : 4,
      }));
    io.emit("roomList", list);
  };

  sendRoomList();

  socket.on("createRoom", ({ name, mode }) => {
    const room = createRoom(name || "Room", mode || "1v1", socket.id);
    rooms.set(room.id, room);
    socket.join(room.id);
    socket.emit("roomJoined", { roomId: room.id, playerIndex: 0 });
    sendRoomList();
  });

  socket.on("joinRoom", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit("error", "Room not found");
    const maxPlayers = room.mode === "1v1" ? 2 : 4;
    if (room.players.length >= maxPlayers) return socket.emit("error", "Room full");
    if (room.state !== "waiting") return socket.emit("error", "Game already started");

    room.players.push(socket.id);
    socket.join(room.id);
    const idx = room.players.indexOf(socket.id);
    socket.emit("roomJoined", { roomId: room.id, playerIndex: idx });
    io.to(room.id).emit("playerJoined", { playerId: socket.id, playerIndex: idx, playerCount: room.players.length });
    sendRoomList();

    // Auto-start for 1v1 when 2 players joined
    if (room.mode === "1v1" && room.players.length === 2) {
      setTimeout(() => {
        if (room.state === "waiting") startGame(room);
        sendRoomList();
      }, 1500);
    }
  });

  socket.on("placeTower", ({ roomId, towerType, gx, gz }) => {
    const room = rooms.get(roomId);
    if (!room || room.state !== "playing") return;
    const idx = room.players.indexOf(socket.id);
    if (idx === -1) return;

    const side = room.sides[idx];
    const def = TOWER_DEFS[towerType];
    if (!def) return;
    if (side.gold < def.cost) return socket.emit("error", "Not enough gold");
    if (PATH_CELLS.has(`${gx},${gz}`)) return socket.emit("error", "Cannot build on path");
    if (gx < 0 || gx >= MAP_SIZE || gz < 0 || gz >= MAP_SIZE) return;
    if (side.towers.find((t) => t.gx === gx && t.gz === gz)) return socket.emit("error", "Cell occupied");

    side.gold -= def.cost;
    side.towers.push({
      id: `t${side.nextTowerId++}`,
      type: towerType,
      gx, gz,
      level: 1,
      cooldown: 0,
      lastTargetId: null,
    });
  });

  socket.on("upgradeTower", ({ roomId, towerId }) => {
    const room = rooms.get(roomId);
    if (!room || room.state !== "playing") return;
    const idx = room.players.indexOf(socket.id);
    if (idx === -1) return;

    const side = room.sides[idx];
    const tower = side.towers.find((t) => t.id === towerId);
    if (!tower) return;

    const lv = tower.level || 1;
    if (lv >= MAX_LEVEL) return socket.emit("error", "Tower is already max level!");

    const cost = upgradeCost(tower.type, lv);
    if (side.gold < cost) return socket.emit("error", "Not enough gold!");

    side.gold -= cost;
    tower.level = lv + 1;
  });

  socket.on("sellTower", ({ roomId, towerId }) => {
    const room = rooms.get(roomId);
    if (!room || room.state !== "playing") return;
    const idx = room.players.indexOf(socket.id);
    if (idx === -1) return;

    const side = room.sides[idx];
    const tIdx = side.towers.findIndex((t) => t.id === towerId);
    if (tIdx === -1) return;

    const tower = side.towers[tIdx];
    const def = TOWER_DEFS[tower.type];
    // Refund: base cost × 0.6 + sum of paid upgrade costs × 0.6
    let totalPaid = def.cost;
    for (let lv = 1; lv < (tower.level || 1); lv++) {
      totalPaid += upgradeCost(tower.type, lv);
    }
    side.gold += Math.floor(totalPaid * 0.6);
    side.towers.splice(tIdx, 1);
  });

  socket.on("sendEnemy", ({ roomId, enemyType }) => {
    const room = rooms.get(roomId);
    if (!room || room.state !== "playing") return;
    const idx = room.players.indexOf(socket.id);
    if (idx === -1) return;

    const side = room.sides[idx];
    const def = ENEMY_DEFS[enemyType];
    if (!def) return;
    if (side.gold < def.sendCost) return socket.emit("error", "Not enough gold");

    side.gold -= def.sendCost;
    const opponentIdx = idx === 0 ? 1 : 0;
    spawnEnemy(room.sides[opponentIdx], enemyType);
  });

  socket.on("disconnect", () => {
    console.log("disconnect", socket.id);
    for (const [roomId, room] of rooms) {
      if (!room.players.includes(socket.id)) continue;
      if (room.state === "playing") {
        // Opponent wins
        const winnerIdx = room.players.indexOf(socket.id) === 0 ? 1 : 0;
        if (room.players[winnerIdx]) {
          io.to(room.id).emit("gameOver", {
            winnerIndex: winnerIdx,
            winnerId: room.players[winnerIdx],
            reason: "disconnect",
          });
        }
        room.state = "finished";
      }
      rooms.delete(roomId);
      sendRoomList();
      break;
    }
  });
});

app.get("/health", (_, res) => res.json({ ok: true }));

httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
