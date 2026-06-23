import { io } from "socket.io-client";
import { LobbyScene } from "./lobby.js";
import { GameScene } from "./game.js";
import { SERVER_URL } from "./config.js";
import "./style.css";

const socket = io(SERVER_URL, { transports: ["websocket"] });

socket.on("connect", () => {
  console.log("Connected to server:", socket.id);
});

socket.on("connect_error", (err) => {
  console.error("Connection error:", err);
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;color:#fff;font-family:sans-serif">
      <h2>⚠️ Cannot connect to server</h2>
      <p>Make sure the server is running:<br><code>cd server && npm run dev</code></p>
      <button onclick="location.reload()" style="margin-top:16px;padding:10px 24px;background:#4a7a3a;border:none;color:#fff;border-radius:8px;cursor:pointer;font-size:1rem">Retry</button>
    </div>
  `;
});

let activeScene = null;

function startLobby() {
  activeScene = new LobbyScene(socket, (roomId, playerIndex) => {
    activeScene = new GameScene(socket, roomId, playerIndex);
  });
}

startLobby();
