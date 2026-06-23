# Castle Siege PvP — Medieval Tower Defense

3D Multiplayer Tower Defense Spiel für CrazyGames.

## Setup

### 1. Node.js installieren
Lade Node.js von https://nodejs.org herunter (LTS Version)
Nach der Installation PowerShell neu öffnen.

### 2. Server starten
```powershell
cd server
npm install
npm run dev
```
Server läuft auf http://localhost:3001

### 3. Client starten (neues Terminal)
```powershell
cd client
npm install
npm run dev
```
Spiel öffnet sich auf http://localhost:5173

### Multiplayer testen
- Tab 1: http://localhost:5173 → Room erstellen
- Tab 2: http://localhost:5173 → Room joinen
- Spiel startet automatisch wenn 2 Spieler da sind

## Spielanleitung
- **Türme bauen**: Tower auswählen (unten links) → auf grüne Felder klicken
- **Gegner senden**: Unten rechts auf einen Gegner-Typ klicken → kostet Gold
- **Gold verdienen**: Gegner töten + Wellen überleben
- **Wellen**: Alle paar Sekunden spawnen automatisch Gegner
- **Gewinnen**: Der Gegner muss zuerst 0 Basis-HP erreichen

## Tower Typen
| Tower   | Kosten | Schaden | Reichweite | Besonderheit       |
|---------|--------|---------|------------|--------------------|
| Archer  | 60💰   | 18      | 4.0        | Schnell, single    |
| Mage    | 110💰  | 40      | 3.5        | AoE Magie          |
| Cannon  | 160💰  | 65      | 5.5        | Große AoE Reichweite |

## Gegner Typen
| Gegner  | HP  | Speed | Senden kostet | Belohnung |
|---------|-----|-------|---------------|-----------|
| Goblin  | 35  | Schnell | 25💰        | 8💰       |
| Orc     | 130 | Langsam | 70💰        | 28💰      |
| Knight  | 85  | Mittel  | 45💰         | 18💰      |
| Troll   | 300 | Sehr langsam | 130💰  | 55💰      |
