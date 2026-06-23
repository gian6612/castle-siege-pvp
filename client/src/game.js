import { Renderer } from "./renderer.js";
import { TOWER_DEFS, ENEMY_DEFS, PATH_CELLS } from "./config.js";

export class GameScene {
  constructor(socket, roomId, playerIndex) {
    this.socket = socket;
    this.roomId = roomId;
    this.playerIndex = playerIndex;
    this.selectedTower = null;
    this.selectedTowerId = null; // for upgrade popup
    this.gameState = null;
    this.pathCells = PATH_CELLS; // immediate fallback; overwritten by server data
    this.el = null;
    this.canvas = null;
    this.renderer = null;

    this._buildUI();
    this._initRenderer();
    this._bindSocketEvents();
  }

  _buildUI() {
    this.el = document.createElement("div");
    this.el.id = "game-container";
    this.el.innerHTML = `
      <canvas id="game-canvas"></canvas>

      <!-- Top HUD -->
      <div id="top-hud">
        <div class="hud-section hud-left">
          <div class="hud-base">
            <span class="hud-label">🏰 Your Base</span>
            <div class="hp-bar-wrap">
              <div id="my-hp-bar" class="hp-bar mine"></div>
              <span id="my-hp-text">100</span>
            </div>
          </div>
          <div class="hud-gold">💰 <span id="my-gold">150</span></div>
        </div>

        <div class="hud-section hud-center">
          <div id="wave-display">
            <span id="wave-label">Wave 0</span>
            <div id="wave-timer-bar-wrap"><div id="wave-timer-bar"></div></div>
            <span id="wave-phase">Preparing...</span>
          </div>
        </div>

        <div class="hud-section hud-right">
          <div class="hud-base hud-enemy">
            <span class="hud-label">⚔️ Enemy Base</span>
            <div class="hp-bar-wrap">
              <div id="enemy-hp-bar" class="hp-bar enemy"></div>
              <span id="enemy-hp-text">100</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Tower panel (bottom left) -->
      <div id="tower-panel">
        <div class="panel-title">🗼 Build Tower</div>
        <div id="tower-buttons"></div>
      </div>

      <!-- Send enemy panel (bottom right) -->
      <div id="send-panel">
        <div class="panel-title">⚔️ Send Enemies</div>
        <div id="send-buttons"></div>
      </div>

      <!-- Selected tower info -->
      <div id="tower-info" class="hidden">
        <span id="tower-info-name"></span>
        <span id="tower-info-desc"></span>
        <button id="cancel-btn">✕ Cancel</button>
      </div>

      <!-- Tower upgrade popup (shown on left/your side) -->
      <div id="upgrade-popup" class="hidden">
        <div class="up-header">
          <span id="up-title"></span>
          <button id="up-close" class="up-close-btn">✕</button>
        </div>
        <div class="up-level-row">
          <span id="up-level-badge" class="up-level-badge"></span>
          <span id="up-range"></span>
        </div>
        <div class="up-stats" id="up-stats"></div>
        <div class="up-arrows" id="up-arrows">▼</div>
        <div class="up-stats up-stats-next hidden" id="up-stats-next"></div>
        <div class="up-actions">
          <button id="up-upgrade-btn" class="btn-upgrade"></button>
          <button id="up-sell-btn" class="btn-sell"></button>
        </div>
      </div>

      <!-- Split-screen labels -->
      <div class="split-label left">🛡️ YOUR SIDE</div>
      <div class="split-divider"></div>
      <div class="split-label right">⚔️ ENEMY SIDE</div>

      <!-- Game over overlay -->
      <div id="game-over" class="hidden">
        <div class="game-over-box">
          <h1 id="game-over-title"></h1>
          <p id="game-over-reason"></p>
          <button onclick="location.reload()" class="btn-primary">🏠 Back to Lobby</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.el);

    this._buildTowerButtons();
    this._buildSendButtons();
    this.el.querySelector("#cancel-btn").addEventListener("click", () => this._clearSelection());
  }

  _buildTowerButtons() {
    const container = this.el.querySelector("#tower-buttons");
    Object.entries(TOWER_DEFS).forEach(([key, def]) => {
      const btn = document.createElement("button");
      btn.className = "tower-btn";
      btn.dataset.type = key;
      btn.innerHTML = `
        <span class="tower-icon">${def.icon}</span>
        <span class="tower-name">${def.label}</span>
        <span class="tower-cost">💰 ${def.cost}</span>
      `;
      btn.addEventListener("click", () => this._selectTower(key));
      container.appendChild(btn);
    });
  }

  _buildSendButtons() {
    const container = this.el.querySelector("#send-buttons");
    Object.entries(ENEMY_DEFS).forEach(([key, def]) => {
      const btn = document.createElement("button");
      btn.className = "send-btn";
      btn.dataset.type = key;
      btn.innerHTML = `
        <span class="send-icon">${def.icon}</span>
        <span class="send-name">${def.label}</span>
        <span class="send-cost">💰 ${def.sendCost}</span>
      `;
      btn.addEventListener("click", () => this._sendEnemy(key));
      container.appendChild(btn);
    });
  }

  _initRenderer() {
    this.canvas = this.el.querySelector("#game-canvas");
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;

    this.renderer = new Renderer(this.canvas);
    this.renderer.onCellClick = (gx, gz) => this._onCellClick(gx, gz);
    this.renderer.onTowerClick = (id) => this._openUpgradePopup(id);
    this.renderer.setPathCells(this.pathCells);
    this._initUpgradePopup();

    window.addEventListener("resize", () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    });
  }

  // ─── Upgrade popup ─────────────────────────────────────────────────────────

  _initUpgradePopup() {
    this.el.querySelector("#up-close").addEventListener("click", () => this._closeUpgradePopup());
    this.el.querySelector("#up-upgrade-btn").addEventListener("click", () => {
      if (!this.selectedTowerId) return;
      this.socket.emit("upgradeTower", { roomId: this.roomId, towerId: this.selectedTowerId });
    });
    this.el.querySelector("#up-sell-btn").addEventListener("click", () => {
      if (!this.selectedTowerId) return;
      this.socket.emit("sellTower", { roomId: this.roomId, towerId: this.selectedTowerId });
      this._closeUpgradePopup();
    });
  }

  _openUpgradePopup(towerId) {
    this._clearSelection(); // deselect any tower-to-place
    this.selectedTowerId = towerId;

    const side = this.gameState?.sides[this.playerIndex];
    if (!side) return;
    const tower = side.towers.find(t => t.id === towerId);
    if (!tower) return;

    this._renderUpgradePopup(tower, side.gold);
    this.el.querySelector("#upgrade-popup").classList.remove("hidden");
  }

  _renderUpgradePopup(tower, gold) {
    const def = TOWER_DEFS[tower.type];
    const lv = tower.level ?? 1;
    const MAX_LEVEL = 5;

    // Level multipliers (must match server)
    const MULT = {
      1: [1.0,  1.0,  1.0],
      2: [1.6,  1.15, 1.2],
      3: [2.5,  1.3,  1.4],
      4: [3.8,  1.45, 1.6],
      5: [5.5,  1.6,  1.8],
    };
    const UPGRADE_FRAC = { 1: 0.8, 2: 1.4, 3: 2.0, 4: 2.8 };

    const stats = (level) => {
      const m = MULT[level] || MULT[1];
      return {
        dmg: Math.round(def.damage * m[0]),
        range: Math.round(def.range * m[1] * 10) / 10,
        aps: Math.round(def.attacksPerSec * m[2] * 10) / 10,
      };
    };

    const cur = stats(lv);
    const upgradable = lv < MAX_LEVEL;
    const cost = upgradable ? Math.floor(def.cost * (UPGRADE_FRAC[lv] ?? 999)) : null;

    // Sell refund calculation
    let totalPaid = def.cost;
    for (let l = 1; l < lv; l++) totalPaid += Math.floor(def.cost * (UPGRADE_FRAC[l] ?? 0));
    const sellValue = Math.floor(totalPaid * 0.6);

    const lvStars = "★".repeat(lv) + "☆".repeat(MAX_LEVEL - lv);
    this.el.querySelector("#up-title").textContent = `${def.icon} ${def.label}`;
    this.el.querySelector("#up-level-badge").textContent = `Lv.${lv}  ${lvStars}`;
    this.el.querySelector("#up-range").textContent = `Range: ${cur.range}`;

    const fmtStats = (s) =>
      `<div class="up-stat">⚔️ DMG <strong>${s.dmg}</strong></div>` +
      `<div class="up-stat">⚡ ATK/s <strong>${s.aps}</strong></div>`;

    this.el.querySelector("#up-stats").innerHTML = fmtStats(cur);

    const arrowEl = this.el.querySelector("#up-arrows");
    const nextEl = this.el.querySelector("#up-stats-next");

    if (upgradable) {
      const nxt = stats(lv + 1);
      arrowEl.classList.remove("hidden");
      nextEl.classList.remove("hidden");
      nextEl.innerHTML =
        `<div class="up-stat upgrade-preview">⚔️ DMG <strong>${nxt.dmg}</strong> <span class="up-gain">(+${nxt.dmg - cur.dmg})</span></div>` +
        `<div class="up-stat upgrade-preview">⚡ ATK/s <strong>${nxt.aps}</strong> <span class="up-gain">(+${(nxt.aps - cur.aps).toFixed(1)})</span></div>`;

      const canAfford = gold >= cost;
      const upgradeBtn = this.el.querySelector("#up-upgrade-btn");
      upgradeBtn.textContent = `⬆️ Upgrade Lv.${lv + 1}  💰 ${cost}`;
      upgradeBtn.classList.toggle("cant-afford", !canAfford);
      upgradeBtn.disabled = !canAfford;
    } else {
      arrowEl.classList.add("hidden");
      nextEl.classList.add("hidden");
      const upgradeBtn = this.el.querySelector("#up-upgrade-btn");
      upgradeBtn.textContent = "✅ MAX LEVEL";
      upgradeBtn.disabled = true;
      upgradeBtn.classList.add("cant-afford");
    }

    this.el.querySelector("#up-sell-btn").textContent = `💰 Sell (+${sellValue} gold)`;
  }

  _closeUpgradePopup() {
    this.selectedTowerId = null;
    this.el.querySelector("#upgrade-popup").classList.add("hidden");
  }

  _bindSocketEvents() {
    // pathCells come from gameStart — but GameScene may be created after it fires,
    // so we also accept them from the first gameState via config.js fallback
    this.socket.on("gameStart", (data) => {
      if (data?.pathCells) {
        this.pathCells = new Set(data.pathCells);
        this.renderer.setPathCells(this.pathCells);
      }
    });

    this.socket.on("gameState", (state) => {
      this.gameState = state;
      this._updateHUD(state);
      const myIdx = this.playerIndex;
      const opIdx = myIdx === 0 ? 1 : 0;
      const mySide = state.sides[myIdx];
      const opSide = state.sides[opIdx];
      if (mySide && opSide) this.renderer.updateState(mySide, opSide);
      this._updateButtonAffordability(mySide?.gold ?? 0);
      // Keep upgrade popup in sync
      if (this.selectedTowerId && mySide) {
        const t = mySide.towers.find(t => t.id === this.selectedTowerId);
        if (t) this._renderUpgradePopup(t, mySide.gold);
        else this._closeUpgradePopup(); // tower was sold / destroyed
      }
    });

    this.socket.on("waveStart", (wave) => {
      const label = this.el.querySelector("#wave-label");
      label.textContent = `Wave ${wave}`;
      label.classList.add("wave-flash");
      setTimeout(() => label.classList.remove("wave-flash"), 800);
    });

    this.socket.on("gameOver", ({ winnerIndex, reason }) => {
      const won = winnerIndex === this.playerIndex;
      this._showGameOver(won, reason);
    });

    this.socket.on("error", (msg) => {
      this._showToast(`❌ ${msg}`);
    });
  }

  _selectTower(type) {
    this.selectedTower = type;
    const def = TOWER_DEFS[type];
    this.el.querySelectorAll(".tower-btn").forEach((b) => b.classList.remove("selected"));
    this.el.querySelector(`.tower-btn[data-type="${type}"]`).classList.add("selected");
    const info = this.el.querySelector("#tower-info");
    info.classList.remove("hidden");
    info.querySelector("#tower-info-name").textContent = `${def.icon} ${def.label} — 💰${def.cost}`;
    info.querySelector("#tower-info-desc").textContent = def.desc;
  }

  _clearSelection() {
    this.selectedTower = null;
    this.el.querySelectorAll(".tower-btn").forEach((b) => b.classList.remove("selected"));
    this.el.querySelector("#tower-info").classList.add("hidden");
  }

  _onCellClick(gx, gz) {
    if (!this.selectedTower) return;
    if (this.pathCells.has(`${gx},${gz}`)) {
      this._showToast("❌ Can't build on the path!");
      return;
    }
    this.socket.emit("placeTower", {
      roomId: this.roomId,
      towerType: this.selectedTower,
      gx,
      gz,
    });
  }

  _sendEnemy(type) {
    const gold = this.gameState?.sides[this.playerIndex]?.gold ?? 0;
    const cost = ENEMY_DEFS[type]?.sendCost ?? 999;
    if (gold < cost) {
      this._showToast("❌ Not enough gold!");
      return;
    }
    this.socket.emit("sendEnemy", { roomId: this.roomId, enemyType: type });
  }

  _updateHUD(state) {
    const myIdx = this.playerIndex;
    const opIdx = myIdx === 0 ? 1 : 0;
    const me = state.sides[myIdx];
    const op = state.sides[opIdx];

    if (me) {
      const hp = Math.max(0, me.baseHP);
      this.el.querySelector("#my-hp-text").textContent = hp;
      this.el.querySelector("#my-hp-bar").style.width = `${hp}%`;
      this.el.querySelector("#my-gold").textContent = me.gold;
    }
    if (op) {
      const hp = Math.max(0, op.baseHP);
      this.el.querySelector("#enemy-hp-text").textContent = hp;
      this.el.querySelector("#enemy-hp-bar").style.width = `${hp}%`;
    }

    // Wave timer bar
    const timerBar = this.el.querySelector("#wave-timer-bar");
    const phase = this.el.querySelector("#wave-phase");
    if (state.wavePhase === "intermission") {
      const pct = (state.waveTimer / 12) * 100;
      timerBar.style.width = `${Math.max(0, pct)}%`;
      timerBar.style.background = "#44aaff";
      phase.textContent = `Next wave in ${Math.ceil(state.waveTimer)}s`;
    } else {
      timerBar.style.width = "100%";
      timerBar.style.background = "#ff4444";
      phase.textContent = "⚠️ Wave in progress!";
    }
  }

  _updateButtonAffordability(gold) {
    this.el.querySelectorAll(".tower-btn").forEach((btn) => {
      const cost = TOWER_DEFS[btn.dataset.type]?.cost ?? 0;
      btn.classList.toggle("cant-afford", gold < cost);
    });
    this.el.querySelectorAll(".send-btn").forEach((btn) => {
      const cost = ENEMY_DEFS[btn.dataset.type]?.sendCost ?? 0;
      btn.classList.toggle("cant-afford", gold < cost);
    });
  }

  _showGameOver(won, reason) {
    const overlay = this.el.querySelector("#game-over");
    overlay.classList.remove("hidden");
    overlay.querySelector("#game-over-title").textContent = won ? "🏆 Victory!" : "💀 Defeat!";
    overlay.querySelector("#game-over-title").style.color = won ? "#ffd700" : "#ff4444";
    let reasonText = won ? "Your castle stands!" : "Your castle fell...";
    if (reason === "disconnect") reasonText = won ? "Opponent disconnected." : "You disconnected.";
    overlay.querySelector("#game-over-reason").textContent = reasonText;
  }

  _showToast(msg) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  destroy() {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
  }
}
