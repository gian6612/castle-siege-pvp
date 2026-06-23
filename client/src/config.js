export const SERVER_URL = "https://castle-siege-pvp-production.up.railway.app";

export const PATH_WAYPOINTS = [
  { x: -17, z: -10 },  // spawn
  { x:  13, z: -10 },  // oben rechts
  { x:  13, z:  -5 },  // mitte rechts
  { x: -13, z:  -5 },  // mitte links
  { x: -13, z:   0 },  // unten links
  { x:  17, z:   0 },  // exit (mitte Bildschirm)
];

export const TOWER_DEFS = {
  archer: {
    label: "Archer",
    cost: 60,
    damage: 18,
    range: 4.0,
    attacksPerSec: 1.5,
    aoe: 0,
    color: 0x8b4513,
    topColor: 0xc8a060,
    desc: "Fast single-target attacks",
    icon: "🏹",
  },
  mage: {
    label: "Mage",
    cost: 110,
    damage: 40,
    range: 3.5,
    attacksPerSec: 0.8,
    aoe: 1.8,
    color: 0x4b0082,
    topColor: 0xaa00ff,
    desc: "Slow AoE magic blasts",
    icon: "🔮",
  },
  cannon: {
    label: "Cannon",
    cost: 160,
    damage: 65,
    range: 5.5,
    attacksPerSec: 0.5,
    aoe: 2.5,
    color: 0x555555,
    topColor: 0x888888,
    desc: "Long range heavy AoE",
    icon: "💣",
  },
};

export const ENEMY_DEFS = {
  goblin: {
    label: "Goblin",
    hp: 35,
    speed: 2.8,
    dmgToBase: 5,
    sendCost: 25,
    reward: 8,
    color: 0x22bb22,
    icon: "👺",
    desc: "Fast and cheap",
  },
  orc: {
    label: "Orc",
    hp: 130,
    speed: 1.1,
    dmgToBase: 20,
    sendCost: 70,
    reward: 28,
    color: 0xcc3300,
    icon: "👹",
    desc: "Slow tank, heavy base damage",
  },
  knight: {
    label: "Knight",
    hp: 85,
    speed: 1.8,
    dmgToBase: 12,
    sendCost: 45,
    reward: 18,
    color: 0x334455,
    icon: "⚔️",
    desc: "Balanced armored unit",
  },
  troll: {
    label: "Troll",
    hp: 300,
    speed: 0.7,
    dmgToBase: 40,
    sendCost: 130,
    reward: 55,
    color: 0x667700,
    icon: "🧌",
    desc: "Massive HP, deadly to base",
  },
};

export const GRID_SIZE = 30;
export const CELL_SIZE = 1;

// Build path cells client-side (mirrors server logic)
function buildPathCells() {
  const cells = new Set();
  const add = (x, z) => cells.add(`${x},${z}`);
  // Obere Reihe: gz=4,5 (z=-10), gx 0..28
  for (let x = 0; x <= 28; x++) { add(x, 4); add(x, 5); }
  // Rechte Spalte: gx=27,28 (x=13), gz 4..10
  for (let z = 4; z <= 10; z++) { add(27, z); add(28, z); }
  // Mittlere Reihe: gz=9,10 (z=-5), gx 1..28
  for (let x = 1; x <= 28; x++) { add(x, 9); add(x, 10); }
  // Linke Spalte: gx=1,2 (x=-13), gz 9..15
  for (let z = 9; z <= 15; z++) { add(1, z); add(2, z); }
  // Untere Reihe: gz=14,15 (z=0), gx 1..29
  for (let x = 1; x <= 29; x++) { add(x, 14); add(x, 15); }
  return cells;
}
export const PATH_CELLS = buildPathCells();
