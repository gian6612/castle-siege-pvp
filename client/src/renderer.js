import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PATH_WAYPOINTS, TOWER_DEFS, ENEMY_DEFS, GRID_SIZE } from "./config.js";

const _gltfLoader = new GLTFLoader();
const _archerModels = {}; // cache: level -> THREE.Group clone source
let _burgModel = null; // cached burg model
let _burgPending = []; // scenes waiting for burg to load

// Preload burg immediately at module load
_gltfLoader.load('/models/burg.glb', (gltf) => {
  _burgModel = gltf.scene;
  _burgModel.scale.setScalar(3.2);
  _burgModel.traverse(c => { if (c.isMesh) c.castShadow = true; });
  _burgPending.forEach(fn => fn(_burgModel));
  _burgPending = [];
});

function _loadArcherGLB(level, url) {
  if (_archerModels[level] !== undefined) return;
  _archerModels[level] = null; // mark as loading
  _gltfLoader.load(url, (gltf) => {
    const model = gltf.scene;
    model.scale.setScalar(1.9);
    _archerModels[level] = model;
  });
}

// ─── Shared path geometry helpers ────────────────────────────────────────────

let _pathLength = null;
function pathLength() {
  if (_pathLength) return _pathLength;
  _pathLength = 0;
  for (let i = 0; i < PATH_WAYPOINTS.length - 1; i++) {
    const a = PATH_WAYPOINTS[i], b = PATH_WAYPOINTS[i + 1];
    _pathLength += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return _pathLength;
}

function progressToWorld(progress) {
  const total = pathLength();
  let traveled = progress * total;
  for (let i = 0; i < PATH_WAYPOINTS.length - 1; i++) {
    const a = PATH_WAYPOINTS[i], b = PATH_WAYPOINTS[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (traveled <= len) {
      const t = traveled / len;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    traveled -= len;
  }
  return { ...PATH_WAYPOINTS[PATH_WAYPOINTS.length - 1] };
}

// ─── One "half" scene (used for both player side and opponent side) ───────────

class SceneHalf {
  constructor(interactive) {
    this.interactive = interactive; // only player side is clickable
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x4a8a2a);
    this.scene.fog = new THREE.Fog(0x4a8a2a, 30, 55);
    this.towerMeshes = new Map();
    this.enemyMeshes = new Map();
    this.gridCells = [];
    this.arrows = [];
    this._initLights();
    this._initGround();
    this._initPath();
    this._initSpawnCastle();
    if (interactive) this._initGridCells();
    this._initHoverMesh();
    for (let i = 1; i <= 5; i++) _loadArcherGLB(i, `/models/archer_l${i}.glb`);
    if (!interactive) this.scene.scale.x = -1;
  }

  _initLights() {
    this.scene.add(new THREE.AmbientLight(0xffeedd, 0.6));
    const sun = new THREE.DirectionalLight(0xfff5cc, 1.2);
    sun.position.set(8, 16, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8899ff, 0.3);
    fill.position.set(-5, 8, -5);
    this.scene.add(fill);
  }

  _initGround() {
    // Base grass plane
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshLambertMaterial({ color: 0x4a8a2a })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    this.scene.add(grass);

    // Small grass tufts scattered around
    const rng = (min, max) => min + Math.random() * (max - min);
    const grassColors = [0x3d7a20, 0x559930, 0x4fa028, 0x52a82e, 0x3a7018];
    for (let i = 0; i < 100; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(rng(0.06, 0.16), rng(0.1, 0.22), rng(0.06, 0.14)),
        new THREE.MeshLambertMaterial({ color: grassColors[Math.floor(Math.random() * grassColors.length)] })
      );
      m.position.set(rng(-35, 35), 0.08, rng(-35, 35));
      this.scene.add(m);
    }
  }

  _initPath() {
    const makeRibbon = (curve, nSamples, width, y, color) => {
      const samples = curve.getPoints(nSamples);
      const pos = [], idx = [];
      let prevPerp = null;
      for (let i = 0; i < samples.length; i++) {
        const p = samples[i];
        const t = Math.min(i / nSamples, 0.9999);
        const tan = curve.getTangentAt(t);
        let perp = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
        if (prevPerp && perp.dot(prevPerp) < 0) perp.negate();
        prevPerp = perp.clone();
        pos.push(p.x - perp.x * width / 2, y, p.z - perp.z * width / 2);
        pos.push(p.x + perp.x * width / 2, y, p.z + perp.z * width / 2);
        if (i < samples.length - 1) {
          const b = i * 2;
          idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
      mesh.receiveShadow = true;
      return mesh;
    };

    const addRoad = (curve, n) => {
      this.scene.add(makeRibbon(curve, n, 1.8, 0.001, 0x8b6914));
      this.scene.add(makeRibbon(curve, n, 1.3, 0.003, 0xa07830));
    };

    // Sauberer 3-Reihen Zickzack: oben → rechts runter → links → links runter → exit
    const road = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-17,   0, -10),
      new THREE.Vector3(  9,   0, -10),   // gerade auf Abbiegung zu
      new THREE.Vector3( 13,   0, -10),   // obere rechte Ecke
      new THREE.Vector3( 13,   0,  -8),   // runter
      new THREE.Vector3( 13,   0,  -5),   // mitte rechts
      new THREE.Vector3( 10,   0,  -5),   // links losfahren
      new THREE.Vector3(-10,   0,  -5),   // lange Gerade links
      new THREE.Vector3(-13,   0,  -5),   // mittlere linke Ecke
      new THREE.Vector3(-13,   0,  -2),   // runter
      new THREE.Vector3(-13,   0,   0),   // unten links
      new THREE.Vector3( -9,   0,   0),   // rechts losfahren
      new THREE.Vector3( 17,   0,   0),   // exit
    ], false, "catmullrom", 0.5);
    addRoad(road, 700);
  }

  _initBase() {
    const end = PATH_WAYPOINTS[PATH_WAYPOINTS.length - 1];
    const bx = end.x - 1.5, bz = end.z;
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xb8a88a });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x8b1a1a });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 1.4), wallMat);
    body.position.set(bx, 1.1, bz);
    body.castShadow = true;
    this.scene.add(body);

    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.4, 0.25), wallMat);
      m.position.set(bx + Math.cos(i * Math.PI / 2) * 0.55, 2.4, bz + Math.sin(i * Math.PI / 2) * 0.55);
      this.scene.add(m);
    }

    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.0, 8), roofMat);
    roof.position.set(bx, 3.0, bz);
    this.scene.add(roof);

    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.25),
      new THREE.MeshLambertMaterial({
        color: this.interactive ? 0x2255dd : 0xdd2222,
        side: THREE.DoubleSide
      })
    );
    flag.position.set(bx + 0.2, 4.5, bz);
    this.scene.add(flag);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6),
      new THREE.MeshLambertMaterial({ color: 0x333333 })
    );
    pole.position.set(bx, 4.1, bz);
    this.scene.add(pole);
  }

  _initSpawnCastle() {
    const spawn = PATH_WAYPOINTS[0];
    const place = (src) => {
      const model = src.clone();
      model.position.set(spawn.x + 2.5, 4.5, spawn.z);
      model.rotation.y = Math.PI / 2;
      this.scene.add(model);
    };
    if (_burgModel) {
      place(_burgModel);
    } else {
      _burgPending.push(place);
    }
  }

  _initGridCells() {
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide });
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      for (let gz = 0; gz < GRID_SIZE; gz++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), mat.clone());
        m.rotation.x = -Math.PI / 2;
        m.position.set(gx - 14.5, 0.02, gz - 14.5);
        m.userData = { gx, gz };
        m.name = "gridcell";
        this.scene.add(m);
        this.gridCells.push(m);
      }
    }
  }

  _initHoverMesh() {
    this.hoverMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ color: 0x88ff88, transparent: true, opacity: 0.35 })
    );
    this.hoverMesh.rotation.x = -Math.PI / 2;
    this.hoverMesh.position.y = 0.03;
    this.hoverMesh.visible = false;
    this.scene.add(this.hoverMesh);
  }

  // ─── Tower ──────────────────────────────────────────────────────────────────

  addTower(id, type, gx, gz) {
    if (this.towerMeshes.has(id)) return;
    const def = TOWER_DEFS[type];
    const g = new THREE.Group();

    if (type !== "archer") {
      const platform = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.15, 0.85),
        new THREE.MeshLambertMaterial({ color: 0x888878 })
      );
      platform.position.y = 0.075;
      g.add(platform);
    }

    if (type === "archer") {
      this._buildArcherTower(g);
    } else {
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.52, 1.5, 8),
        new THREE.MeshLambertMaterial({ color: def.color })
      );
      body.position.y = 0.9;
      body.castShadow = true;
      g.add(body);

      const top = new THREE.Mesh(
        new THREE.ConeGeometry(0.52, 0.8, 8),
        new THREE.MeshLambertMaterial({ color: def.topColor })
      );
      top.position.y = 2.05;
      g.add(top);

      if (type === "mage") {
        const orb = new THREE.Mesh(
          new THREE.SphereGeometry(0.18, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xcc88ff })
        );
        orb.position.y = 2.65;
        g.add(orb);
      } else if (type === "cannon") {
        const barrel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.14, 0.14, 1.05, 8),
          new THREE.MeshLambertMaterial({ color: 0x333333 })
        );
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 1.7, 0.52);
        g.add(barrel);
      }
    }

    g.position.set(gx - 14.5, 0, gz - 14.5);
    g.userData = { gx, gz, type };
    this.scene.add(g);
    this.towerMeshes.set(id, g);
  }

  _buildArcherTower(g) {
    this._buildArcherCharacter(g, 1);
  }

  _buildArcherCharacter(g, level) {
    const old = g.children.find(c => c.userData.isArcherChar);
    if (old) {
      g.remove(old);
      old.traverse(c => { if (c.geometry) c.geometry.dispose(); });
    }

    if (_archerModels[level]) {
      const model = _archerModels[level].clone();
      model.position.y = 0.0;
      model.userData.isArcherChar = true;
      g.add(model);
      return;
    }
    if (_archerModels[level] === null) {
      setTimeout(() => this._buildArcherCharacter(g, level), 300);
      return;
    }

    const LEVELS = {
      1: { hair: 0xff69b4, outfit: 0x6b8e23,  boots: 0x6b3a20, bow: 0x8b5a2b, bowS: 1.0,  bowT: 0.03,  quiver: false, shoulder: 0, cape: false },
      2: { hair: 0xff69b4, outfit: 0x4a7a15,  boots: 0x5a2a10, bow: 0x6b3a1a, bowS: 1.15, bowT: 0.034, quiver: true,  shoulder: 0, cape: false },
      3: { hair: 0x9900cc, outfit: 0x2d6a35,  boots: 0x4a1a40, bow: 0x4a2a0a, bowS: 1.3,  bowT: 0.038, quiver: true,  shoulder: 1, cape: true  },
      4: { hair: 0x6600aa, outfit: 0x1a6a4a,  boots: 0x1a1a4a, bow: 0x3a1a00, bowS: 1.45, bowT: 0.044, quiver: true,  shoulder: 2, cape: true  },
      5: { hair: 0xff1493, outfit: 0x1a3a6a,  boots: 0x0a0a3a, bow: 0x1a0800, bowS: 1.6,  bowT: 0.052, quiver: true,  shoulder: 2, cape: true  },
    };
    const cfg = LEVELS[Math.min(level, 5)] || LEVELS[1];
    const m = (color) => new THREE.MeshLambertMaterial({ color });

    const archer = new THREE.Group();
    archer.position.y = 0.15; // stand on platform top
    archer.userData.isArcherChar = true;

    // Boots (knee-high)
    for (const x of [-0.075, 0.075]) {
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.22, 0.15), m(cfg.boots));
      boot.position.set(x, 0.11, 0.01);
      archer.add(boot);
      // Boot top cuff
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.16), m(0xc8a060));
      cuff.position.set(x, 0.235, 0.01);
      archer.add(cuff);
    }

    // Bare legs above boots
    for (const x of [-0.075, 0.075]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.18, 7), m(0xe8c99a));
      leg.position.set(x, 0.35, 0);
      archer.add(leg);
    }

    // Dress/skirt (cone - flared)
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.3, 9), m(cfg.outfit));
    skirt.position.y = 0.505;
    archer.add(skirt);

    // Belt
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.065, 0.18), m(0x6b3a20));
    belt.position.y = 0.465;
    archer.add(belt);

    // Lv2+: gold buckle
    if (level >= 2) {
      const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.055, 0.02), m(0xddaa00));
      buckle.position.set(0, 0.465, 0.1);
      archer.add(buckle);
    }

    // Torso (fitted tunic)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.18), m(cfg.outfit));
    torso.position.y = 0.71;
    archer.add(torso);

    // Chest detail stripe
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.02), m(0xc8a060));
    stripe.position.set(0, 0.73, 0.1);
    archer.add(stripe);

    // Neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 7), m(0xe8c99a));
    neck.position.y = 0.91;
    archer.add(neck);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 10, 8), m(0xe8c99a));
    head.position.y = 1.025;
    head.scale.set(0.92, 1, 0.92);
    archer.add(head);

    // === HAIR (big, voluminous pink - key CoC look) ===
    const hairMain = new THREE.Mesh(new THREE.SphereGeometry(0.185, 10, 8), m(cfg.hair));
    hairMain.position.set(0, 1.06, -0.02);
    hairMain.scale.set(1, 0.93, 0.88);
    archer.add(hairMain);

    // Hair front sweep
    const hairFront = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), m(cfg.hair));
    hairFront.position.set(0.07, 1.11, 0.09);
    hairFront.scale.set(1, 0.8, 0.7);
    archer.add(hairFront);

    // Side pigtail (right side)
    const pigtail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.028, 0.26, 6), m(cfg.hair));
    pigtail.position.set(0.18, 0.975, -0.04);
    pigtail.rotation.z = 0.45;
    archer.add(pigtail);
    const pigtailTip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), m(cfg.hair));
    pigtailTip.position.set(0.28, 0.875, -0.04);
    archer.add(pigtailTip);

    // Lv3+: Circlet/headband
    if (level >= 3) {
      const circletColor = level >= 4 ? 0xddaa00 : cfg.hair;
      const circlet = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.022, 6, 14), m(circletColor));
      circlet.position.y = 1.02;
      circlet.rotation.x = Math.PI / 2;
      archer.add(circlet);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.03, 0), new THREE.MeshBasicMaterial({ color: level >= 4 ? 0x00eeff : 0xff44aa }));
      gem.position.set(0, 1.04, 0.155);
      archer.add(gem);
    }

    // Lv4+: Crown
    if (level >= 4) {
      const goldM = m(0xddaa00);
      const crownRing = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.028, 6, 14), goldM);
      crownRing.position.y = 1.0;
      crownRing.rotation.x = Math.PI / 2;
      archer.add(crownRing);
      const numPts = level >= 5 ? 5 : 3;
      for (let i = 0; i < numPts; i++) {
        const a = (i / numPts) * Math.PI * 2;
        const pt = new THREE.Mesh(new THREE.ConeGeometry(0.025, level >= 5 ? 0.1 : 0.075, 4), goldM);
        pt.position.set(Math.cos(a) * 0.14, 1.02 + (level >= 5 ? 0.05 : 0.037), Math.sin(a) * 0.14);
        archer.add(pt);
      }
      if (level >= 5) {
        const topGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.032, 0), new THREE.MeshBasicMaterial({ color: 0x00eeff }));
        topGem.position.set(0, 1.14, 0.14);
        archer.add(topGem);
      }
    }

    // === LEFT ARM (bow arm — extended to left) ===
    const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.35, 7), m(cfg.outfit));
    leftArm.rotation.z = Math.PI / 2;
    leftArm.position.set(-0.3, 0.76, 0);
    archer.add(leftArm);
    // Left bracer
    const lBracer = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.057, 0.11, 7), m(0x6b3a20));
    lBracer.rotation.z = Math.PI / 2;
    lBracer.position.set(-0.41, 0.76, 0);
    archer.add(lBracer);
    // Left hand
    const lHand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 7, 5), m(0xe8c99a));
    lHand.position.set(-0.48, 0.76, 0);
    archer.add(lHand);

    // === RIGHT ARM (draw arm — animated) ===
    const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.3, 7), m(cfg.outfit));
    rightArm.rotation.z = -Math.PI / 3.5;
    rightArm.position.set(0.17, 0.8, 0);
    archer.add(rightArm);
    // Right bracer
    const rBracer = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.057, 0.1, 7), m(0x6b3a20));
    rBracer.rotation.z = -Math.PI / 3.5;
    rBracer.position.set(0.24, 0.72, 0);
    archer.add(rBracer);

    // Lv3+: Shoulder plates
    if (cfg.shoulder >= 1) {
      const sc = level >= 5 ? 0x2a3a6a : 0x3a6a25;
      const ls = new THREE.Mesh(new THREE.SphereGeometry(0.11, 7, 6), m(sc));
      ls.scale.set(1, 0.58, 1);
      ls.position.set(-0.22, 0.85, 0);
      archer.add(ls);
    }
    if (cfg.shoulder >= 2) {
      const sc = level >= 5 ? 0x2a3a6a : 0x3a6a25;
      const rs = new THREE.Mesh(new THREE.SphereGeometry(0.095, 7, 6), m(sc));
      rs.scale.set(1, 0.58, 1);
      rs.position.set(0.22, 0.85, 0);
      archer.add(rs);
    }

    // Lv3+: Cape
    let cape = null;
    if (cfg.cape) {
      const cc = level >= 5 ? 0x001a6a : level >= 4 ? 0x4b0082 : 0x1a4a10;
      cape = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, level >= 5 ? 0.45 : 0.35),
        new THREE.MeshLambertMaterial({ color: cc, side: THREE.DoubleSide })
      );
      cape.position.set(0, 0.72, -0.12);
      archer.add(cape);
    }

    // Lv2+: Quiver on back
    if (cfg.quiver) {
      const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.26, 7), m(0x6b3a20));
      quiver.position.set(0.12, 0.73, -0.13);
      quiver.rotation.z = 0.28;
      archer.add(quiver);
      for (let i = 0; i < 3; i++) {
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.16, 4), m(cfg.bow));
        stick.position.set(0.09 + i * 0.022, 0.88, -0.12);
        stick.rotation.z = 0.28;
        archer.add(stick);
      }
    }

    // === BOW (curved, CoC style) ===
    const bowGroup = new THREE.Group();
    bowGroup.position.set(0, 0.76, 0);
    const bowCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.45, 0.24, 0),
      new THREE.Vector3(-0.68, 0, 0),
      new THREE.Vector3(-0.45, -0.24, 0)
    );
    bowGroup.add(new THREE.Mesh(new THREE.TubeGeometry(bowCurve, 14, cfg.bowT, 7, false), m(cfg.bow)));
    const strCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.45, 0.24, 0),
      new THREE.Vector3(-0.37, 0, 0.055),
      new THREE.Vector3(-0.45, -0.24, 0)
    );
    bowGroup.add(new THREE.Mesh(new THREE.TubeGeometry(strCurve, 8, 0.009, 4, false), m(0xddcc88)));
    // Lv4+: Gold bow accents
    if (level >= 4) {
      for (const yOff of [0.24, -0.24]) {
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 4), m(0xddaa00));
        tip.position.set(-0.45, yOff, 0);
        bowGroup.add(tip);
      }
    }
    if (level >= 5) {
      const midRing = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.018, 4, 8), m(0xddaa00));
      midRing.position.set(-0.68, 0, 0);
      midRing.rotation.x = Math.PI / 2;
      bowGroup.add(midRing);
    }
    bowGroup.scale.setScalar(cfg.bowS);
    archer.add(bowGroup);

    // === ARROW (nocked on bow) ===
    const s = cfg.bowS;
    const arrowLen = 0.5 * s;
    const arrowCX = -0.37 * s;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, arrowLen, 4), m(cfg.bow));
    shaft.rotation.z = Math.PI / 2;
    shaft.position.set(arrowCX, 0.76, 0);
    archer.add(shaft);
    const arrowTip = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.09, 4), m(level >= 4 ? 0x6699ff : 0xbbbbbb));
    arrowTip.rotation.z = -Math.PI / 2;
    arrowTip.position.set(arrowCX - arrowLen / 2 - 0.045, 0.76, 0);
    archer.add(arrowTip);
    const fletchM = new THREE.MeshLambertMaterial({ color: cfg.hair, side: THREE.DoubleSide });
    for (const rot of [0, Math.PI / 2]) {
      const fletch = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.075), fletchM);
      fletch.rotation.y = rot;
      fletch.position.set(arrowCX + arrowLen / 2 - 0.02, 0.76, 0);
      archer.add(fletch);
    }

    archer.userData.rightArm = rightArm;
    archer.userData.rBracer = rBracer;
    archer.userData.cape = cape;
    archer.userData.hairColor = cfg.hair;
    g.add(archer);
  }

  updateTowerLevel(id, level) {
    const g = this.towerMeshes.get(id);
    if (!g) return;

    if (g.userData.type === 'archer') {
      this._buildArcherCharacter(g, level);
      return;
    }

    const oldGems = g.children.filter(c => c.userData.isLevelGem);
    oldGems.forEach(c => g.remove(c));
    const gemColors = [0xffdd00, 0xff6600];
    for (let i = 1; i < level; i++) {
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.1, 0),
        new THREE.MeshBasicMaterial({ color: gemColors[i - 1] ?? 0xffffff })
      );
      gem.position.set((i - 1) * 0.22 - 0.11, 0.3, 0.45);
      gem.userData.isLevelGem = true;
      g.add(gem);
    }
  }

  removeTower(id) {
    const m = this.towerMeshes.get(id);
    if (!m) return;
    this.scene.remove(m);
    m.traverse(c => { if (c.geometry) c.geometry.dispose(); });
    this.towerMeshes.delete(id);
  }

  // ─── Enemy ──────────────────────────────────────────────────────────────────

  _addEnemy(id, type) {
    const def = ENEMY_DEFS[type];
    const g = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.22, 0.45, 4, 8),
      new THREE.MeshLambertMaterial({ color: def.color })
    );
    body.position.y = 0.45;
    g.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 8),
      new THREE.MeshLambertMaterial({ color: def.color })
    );
    head.position.y = 1.0;
    g.add(head);

    const barBg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x330000, side: THREE.DoubleSide })
    );
    barBg.position.y = 1.4;
    g.add(barBg);

    const barFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x00ee00, side: THREE.DoubleSide })
    );
    barFill.position.set(0, 1.4, 0.001);
    g.add(barFill);

    this.scene.add(g);
    this.enemyMeshes.set(id, { group: g, barFill });
  }

  // ─── State update ────────────────────────────────────────────────────────────

  updateFromState(sideState, pathCells) {
    const { towers, enemies } = sideState;

    // Sync towers
    const tIds = new Set(towers.map(t => t.id));
    for (const [id] of this.towerMeshes) { if (!tIds.has(id)) this.removeTower(id); }
    for (const t of towers) {
      if (!this.towerMeshes.has(t.id)) this.addTower(t.id, t.type, t.gx, t.gz);
      if (t.level != null) this.updateTowerLevel(t.id, t.level);
      const mesh = this.towerMeshes.get(t.id);
      if (mesh) mesh.userData.attacking = t.attacking;
    }

    // Sync enemies
    const eIds = new Set(enemies.map(e => e.id));
    for (const [id, obj] of this.enemyMeshes) {
      if (!eIds.has(id)) {
        this.scene.remove(obj.group);
        obj.group.traverse(c => { if (c.geometry) c.geometry.dispose(); });
        this.enemyMeshes.delete(id);
      }
    }
    for (const e of enemies) {
      if (!this.enemyMeshes.has(e.id)) this._addEnemy(e.id, e.type);
      const obj = this.enemyMeshes.get(e.id);
      const pos = progressToWorld(e.progress);
      obj.group.position.set(pos.x, 0, pos.z);

      const pct = Math.max(0, e.hp / e.maxHp);
      obj.barFill.scale.x = pct;
      obj.barFill.position.x = (pct - 1) * 0.35;
      obj.barFill.material.color.setHex(pct > 0.5 ? 0x00ee00 : pct > 0.25 ? 0xeeee00 : 0xee2200);

      if (e.progress < 0.99) {
        const next = progressToWorld(Math.min(e.progress + 0.01, 1));
        const dx = next.x - pos.x, dz = next.z - pos.z;
        if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
          obj.group.rotation.y = Math.atan2(dx, dz);
        }
      }
    }

    // Update hover (only on interactive side)
    if (this._pendingHoverUpdate && pathCells) {
      this._updateHover(pathCells);
    }
  }

  updateHover(mouse2d, pathCells, raycaster) {
    raycaster.setFromCamera(mouse2d, this.camera);
    const hits = raycaster.intersectObjects(this.gridCells);
    if (hits.length > 0) {
      const { gx, gz } = hits[0].object.userData;
      const onPath = pathCells.has(`${gx},${gz}`);
      const occupied = [...this.towerMeshes.values()].some(
        m => Math.round(m.position.x + 14.5) === gx && Math.round(m.position.z + 14.5) === gz
      );
      this.hoverMesh.visible = true;
      this.hoverMesh.position.x = gx - 14.5;
      this.hoverMesh.position.z = gz - 14.5;
      this.hoverMesh.material.color.setHex(onPath || occupied ? 0xff4444 : 0x88ff88);
    } else {
      this.hoverMesh.visible = false;
    }
  }

  animateMageOrbs(t) {
    for (const [, mesh] of this.towerMeshes) {
      const orb = mesh.children.find(c => c.geometry?.type === "SphereGeometry");
      if (orb) {
        orb.position.y = 1.85 + Math.sin(t + mesh.position.x) * 0.06;
        const b = 0.7 + Math.sin(t * 2) * 0.3;
        orb.material.color.setRGB(b * 0.8, b * 0.5, b);
      }
    }
  }

  animateArchers(t, dt) {
    for (const [, g] of this.towerMeshes) {
      if (g.userData.type !== 'archer') continue;
      const archer = g.children.find(c => c.userData.isArcherChar);
      if (!archer) continue;

      // Idle bob
      archer.position.y = 0.15 + Math.sin(t * 1.8 + g.position.x * 0.5) * 0.022;

      // Bow draw cycle: pull back slowly, snap release
      const phase = (t * 0.9 + g.position.x * 0.3) % (Math.PI * 2);
      const draw = phase < Math.PI ? Math.sin(phase) * 0.4 : 0;
      if (archer.userData.rightArm) {
        archer.userData.rightArm.rotation.z = -Math.PI / 3.5 - draw;
      }
      if (archer.userData.rBracer) {
        archer.userData.rBracer.rotation.z = -Math.PI / 3.5 - draw;
      }

      // Cape sway
      if (archer.userData.cape) {
        archer.userData.cape.rotation.x = Math.sin(t * 1.2 + g.position.z * 0.4) * 0.09;
      }

      // Shoot kick animation
      if (g.userData.shootKick > 0) {
        g.userData.shootKick -= dt;
        const k = Math.max(0, g.userData.shootKick);
        archer.rotation.x = Math.sin(k * Math.PI / 0.18) * 0.22;
        archer.position.y = (archer.position.y || 0.15) + Math.sin(k * Math.PI / 0.18) * 0.06;
      } else {
        archer.rotation.x = 0;
      }

      // Face the target enemy
      const targetId = g.userData.attacking;
      if (targetId && this.enemyMeshes.has(targetId)) {
        const enemyObj = this.enemyMeshes.get(targetId);
        const dx = enemyObj.group.position.x - g.position.x;
        const dz = enemyObj.group.position.z - g.position.z;
        archer.rotation.y = Math.atan2(dx, dz);

        const now = Date.now();
        if (now - (g.userData.lastShot || 0) > 620) {
          g.userData.lastShot = now;
          g.userData.shootKick = 0.18;
          const from = g.position.clone();
          from.x -= 0.4;
          from.y += 1.0;
          const to = enemyObj.group.position.clone();
          to.y += 0.7;
          this._spawnArrow(from, to, archer.userData.hairColor || 0xff69b4);
        }
      }
    }
  }

  _spawnArrow(from, to, fletchColor) {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.1) return;
    const normDir = dir.clone().normalize();

    const arrowGroup = new THREE.Group();
    arrowGroup.position.copy(from);

    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.028, 0.85, 5),
      new THREE.MeshLambertMaterial({ color: 0x8b5a2b })
    );
    shaft.rotation.x = Math.PI / 2;
    arrowGroup.add(shaft);

    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.2, 5),
      new THREE.MeshLambertMaterial({ color: 0xaaaacc })
    );
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 0.525;
    arrowGroup.add(tip);

    const fletchMat = new THREE.MeshLambertMaterial({ color: fletchColor, side: THREE.DoubleSide });
    for (const rot of [0, Math.PI / 2]) {
      const fletch = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.14), fletchMat);
      fletch.rotation.y = rot;
      fletch.position.z = -0.38;
      arrowGroup.add(fletch);
    }

    arrowGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normDir);
    this.scene.add(arrowGroup);
    this.arrows.push({ mesh: arrowGroup, vel: normDir.multiplyScalar(10), ttl: dist / 10 + 0.1 });
  }

  updateArrows(dt) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.mesh.position.addScaledVector(a.vel, dt);
      a.ttl -= dt;
      if (a.ttl <= 0) {
        this.scene.remove(a.mesh);
        a.mesh.traverse(c => { if (c.geometry) c.geometry.dispose(); });
        this.arrows.splice(i, 1);
      }
    }
  }

  clear() {
    for (const [id] of this.towerMeshes) this.removeTower(id);
    for (const [, obj] of this.enemyMeshes) {
      this.scene.remove(obj.group);
      this.enemyMeshes.delete(obj);
    }
    this.enemyMeshes.clear();
  }
}

// ─── Main Renderer (manages two halves + split viewport rendering) ────────────

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.pathCells = new Set();
    this.onCellClick = null;

    this.myHalf = new SceneHalf(true);
    this.opHalf = new SceneHalf(false);

    this._initCameras();
    this._initWebGL();
    this._initRaycaster();
    this._startLoop();
  }

  _initCameras() {
    const makeCamera = () => {
      const cam = new THREE.PerspectiveCamera(64, 1, 0.1, 200);
      cam.position.set(0, 20, 11);
      cam.lookAt(0, 0, -4);
      return cam;
    };
    this.myHalf.camera = makeCamera();
    this.opHalf.camera = makeCamera();
  }

  _initWebGL() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._updateSize();
    window.addEventListener("resize", () => this._updateSize());
  }

  _updateSize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    const aspect = (w / 2) / h;
    this.myHalf.camera.aspect = aspect;
    this.myHalf.camera.updateProjectionMatrix();
    this.opHalf.camera.aspect = aspect;
    this.opHalf.camera.updateProjectionMatrix();
  }

  _initRaycaster() {
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-9999, -9999);

    this.canvas.addEventListener("mousemove", e => {
      const rect = this.canvas.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;
      // Only track hover on left half
      if (relX < w / 2) {
        this.mouse.x = (relX / (w / 2)) * 2 - 1;
        this.mouse.y = -(relY / h) * 2 + 1;
        this._onLeftHalf = true;
      } else {
        this.mouse.set(-9999, -9999);
        this._onLeftHalf = false;
        this.myHalf.hoverMesh.visible = false;
      }
    });

    // ── Path Editor ──────────────────────────────────────────────────────────
    this._pathEditMode = false;
    this._pathEditPoints = [];
    this._pathEditMarkers = [];
    this._pathEditLine = null;

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    window.addEventListener("keydown", e => {
      if (e.key === "e" || e.key === "E") {
        this._pathEditMode = !this._pathEditMode;
        this._pathEditPoints = [];
        this._pathEditMarkers.forEach(m => this.myHalf.scene.remove(m));
        this._pathEditMarkers = [];
        if (this._pathEditLine) { this.myHalf.scene.remove(this._pathEditLine); this._pathEditLine = null; }
        const banner = document.getElementById("path-edit-banner");
        if (banner) banner.style.display = this._pathEditMode ? "block" : "none";
        if (this._pathEditMode) console.log("PATH EDITOR ON — click ground to add points, Enter to finish");
      }
      if (e.key === "Enter" && this._pathEditMode) {
        const pts = this._pathEditPoints;
        if (pts.length < 2) return;
        const js = "[\n" + pts.map(p => `  { x: ${p.x.toFixed(1)}, z: ${p.z.toFixed(1)} }`).join(",\n") + "\n]";
        console.log("=== PATH_WAYPOINTS ===\n" + js);
        alert("Waypoints in der Browser-Konsole (F12)!\n\n" + js);
      }
      if (e.key === "z" && this._pathEditMode) {
        if (this._pathEditPoints.length > 0) {
          this._pathEditPoints.pop();
          const m = this._pathEditMarkers.pop();
          if (m) this.myHalf.scene.remove(m);
        }
      }
    });

    if (!document.getElementById("path-edit-banner")) {
      const banner = document.createElement("div");
      banner.id = "path-edit-banner";
      banner.style.cssText = "display:none;position:fixed;top:50%;left:25%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);color:#ffff00;padding:12px 18px;border-radius:8px;font-size:13px;z-index:9999;pointer-events:none;text-align:center";
      banner.innerHTML = "🗺️ <b>PFAD-EDITOR AN</b><br>Klick = Wegpunkt setzen &nbsp;|&nbsp; Z = Rückgängig &nbsp;|&nbsp; Enter = Fertig &amp; Koordinaten anzeigen &nbsp;|&nbsp; E = Beenden";
      document.body.appendChild(banner);
    }
    // ─────────────────────────────────────────────────────────────────────────

    this.canvas.addEventListener("click", e => {
      const rect = this.canvas.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const w = rect.width;
      if (relX >= w / 2) return;

      const mx = (relX / (w / 2)) * 2 - 1;
      const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const mouse = new THREE.Vector2(mx, my);
      this.raycaster.setFromCamera(mouse, this.myHalf.camera);

      // Path editor intercepts clicks
      if (this._pathEditMode) {
        const hit = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(groundPlane, hit);
        if (hit) {
          const pt = { x: Math.round(hit.x * 10) / 10, z: Math.round(hit.z * 10) / 10 };
          this._pathEditPoints.push(pt);
          const marker = new THREE.Mesh(
            new THREE.SphereGeometry(0.25, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xff0000 })
          );
          marker.position.set(pt.x, 0.3, pt.z);
          this.myHalf.scene.add(marker);
          this._pathEditMarkers.push(marker);
          const label = document.createElement("div");
          console.log(`Point ${this._pathEditPoints.length}: x=${pt.x}, z=${pt.z}`);
        }
        return;
      }

      // Check tower meshes first (recursive = true to hit children inside group)
      const towerGroups = [...this.myHalf.towerMeshes.values()];
      if (towerGroups.length > 0) {
        const towerHits = this.raycaster.intersectObjects(towerGroups, true);
        if (towerHits.length > 0) {
          const hitObj = towerHits[0].object;
          for (const [id, group] of this.myHalf.towerMeshes) {
            // Walk up the parent chain from hit object to find the group
            let node = hitObj;
            while (node) {
              if (node === group) {
                if (this.onTowerClick) this.onTowerClick(id);
                return;
              }
              node = node.parent;
            }
          }
        }
      }

      // No tower hit — check grid cells for placement
      const hits = this.raycaster.intersectObjects(this.myHalf.gridCells);
      if (hits.length > 0) {
        const { gx, gz } = hits[0].object.userData;
        if (this.onCellClick) this.onCellClick(gx, gz);
      }
    });
  }

  setPathCells(cells) {
    this.pathCells = cells instanceof Set ? cells : new Set(cells);
  }

  updateState(mySide, opSide) {
    this.myHalf.updateFromState(mySide, this.pathCells);
    this.opHalf.updateFromState(opSide, null);
  }

  _startLoop() {
    let lastTime = performance.now();
    const tick = () => {
      requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      const half = Math.floor(w / 2);

      // Hover on left half
      if (this._onLeftHalf && this.pathCells.size > 0) {
        this.myHalf.updateHover(this.mouse, this.pathCells, this.raycaster);
      }

      const t = now * 0.003;
      this.myHalf.animateMageOrbs(t);
      this.opHalf.animateMageOrbs(t);
      this.myHalf.animateArchers(t, dt);
      this.opHalf.animateArchers(t, dt);
      this.myHalf.updateArrows(dt);
      this.opHalf.updateArrows(dt);

      this.renderer.setScissorTest(true);

      // Left half — my side
      this.renderer.setViewport(0, 0, half, h);
      this.renderer.setScissor(0, 0, half, h);
      this.renderer.render(this.myHalf.scene, this.myHalf.camera);

      // Right half — opponent's side
      this.renderer.setViewport(half, 0, w - half, h);
      this.renderer.setScissor(half, 0, w - half, h);
      this.renderer.render(this.opHalf.scene, this.opHalf.camera);
    };
    tick();
  }

  clearAll() {
    this.myHalf.clear();
    this.opHalf.clear();
  }
}
