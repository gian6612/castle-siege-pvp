export class LobbyScene {
  constructor(socket, onGameStart) {
    this.socket = socket;
    this.onGameStart = onGameStart;
    this.roomId = null;
    this.playerIndex = null;
    this.el = null;
    this._buildUI();
    this._bindSocketEvents();
  }

  _buildUI() {
    this.el = document.createElement("div");
    this.el.id = "lobby";
    this.el.innerHTML = `
      <div class="lobby-bg"></div>
      <div class="lobby-container">
        <h1 class="lobby-title">⚔️ Castle Siege PvP ⚔️</h1>
        <p class="lobby-subtitle">Medieval Tower Defense — 1v1 Online</p>

        <div class="lobby-panels">
          <div class="lobby-panel" id="create-panel">
            <h2>Create Room</h2>
            <input id="room-name" type="text" placeholder="Room name..." maxlength="24" value="Battle Arena" />
            <div class="mode-selector">
              <button class="mode-btn active" data-mode="1v1">1v1</button>
              <button class="mode-btn" data-mode="2v2">2v2 (soon)</button>
            </div>
            <button id="create-btn" class="btn-primary">⚔️ Create Room</button>
          </div>

          <div class="lobby-divider">— or —</div>

          <div class="lobby-panel" id="join-panel">
            <h2>Join Room</h2>
            <div id="room-list">
              <div class="room-list-empty">Searching for rooms...</div>
            </div>
            <button id="refresh-btn" class="btn-secondary">🔄 Refresh</button>
          </div>
        </div>

        <div id="waiting-room" class="waiting-room hidden">
          <h2>⏳ Waiting for opponent...</h2>
          <div id="waiting-players"></div>
          <p class="waiting-hint">Game starts automatically when 2 players join</p>
          <button id="leave-btn" class="btn-danger">Leave Room</button>
        </div>

        <div id="lobby-status" class="lobby-status"></div>
      </div>
    `;

    document.body.appendChild(this.el);
    this._bindUIEvents();
  }

  _bindUIEvents() {
    // Mode selector
    this.el.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.el.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

    // Create room
    this.el.querySelector("#create-btn").addEventListener("click", () => {
      const name = this.el.querySelector("#room-name").value.trim() || "Battle Arena";
      const mode = this.el.querySelector(".mode-btn.active").dataset.mode;
      this.socket.emit("createRoom", { name, mode });
      this._setStatus("Creating room...");
    });

    // Refresh room list
    this.el.querySelector("#refresh-btn").addEventListener("click", () => {
      this._setStatus("Refreshing...");
      setTimeout(() => this._setStatus(""), 600);
    });

    // Leave room
    this.el.querySelector("#leave-btn").addEventListener("click", () => {
      location.reload();
    });
  }

  _bindSocketEvents() {
    this.socket.on("roomList", (rooms) => {
      this._renderRoomList(rooms);
    });

    this.socket.on("roomJoined", ({ roomId, playerIndex }) => {
      this.roomId = roomId;
      this.playerIndex = playerIndex;
      this._showWaitingRoom(playerIndex);
    });

    this.socket.on("playerJoined", ({ playerCount }) => {
      const msg = this.el.querySelector("#waiting-players");
      msg.innerHTML = `<div class="player-dot active">Player 1 ✓</div>` +
        (playerCount >= 2 ? `<div class="player-dot active">Player 2 ✓</div>` : `<div class="player-dot waiting">Player 2 ⏳</div>`);
    });

    this.socket.on("gameStart", () => {
      this.destroy();
      this.onGameStart(this.roomId, this.playerIndex);
    });

    this.socket.on("playerIndex", (idx) => {
      this.playerIndex = idx;
    });

    this.socket.on("error", (msg) => {
      this._setStatus(`❌ ${msg}`, "error");
    });
  }

  _renderRoomList(rooms) {
    const container = this.el.querySelector("#room-list");
    if (rooms.length === 0) {
      container.innerHTML = `<div class="room-list-empty">No open rooms — create one!</div>`;
      return;
    }
    container.innerHTML = rooms.map((r) => `
      <div class="room-entry" data-id="${r.id}">
        <span class="room-entry-name">${this._escHtml(r.name)}</span>
        <span class="room-entry-mode">${r.mode}</span>
        <span class="room-entry-players">${r.players}/${r.maxPlayers}</span>
        <button class="btn-join" data-id="${r.id}">Join</button>
      </div>
    `).join("");

    container.querySelectorAll(".btn-join").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.socket.emit("joinRoom", { roomId: btn.dataset.id });
        this._setStatus("Joining room...");
      });
    });
  }

  _showWaitingRoom(playerIndex) {
    this.el.querySelector("#create-panel").classList.add("hidden");
    this.el.querySelector(".lobby-divider").classList.add("hidden");
    this.el.querySelector("#join-panel").classList.add("hidden");
    const wr = this.el.querySelector("#waiting-room");
    wr.classList.remove("hidden");
    wr.querySelector("#waiting-players").innerHTML =
      `<div class="player-dot active">You (Player ${playerIndex + 1}) ✓</div>` +
      `<div class="player-dot waiting">Opponent ⏳</div>`;
    this._setStatus(`Room joined as Player ${playerIndex + 1}`);
  }

  _setStatus(msg, type = "info") {
    const el = this.el.querySelector("#lobby-status");
    el.textContent = msg;
    el.className = `lobby-status ${type}`;
  }

  _escHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  destroy() {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
  }
}
