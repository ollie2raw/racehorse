# Racehorse Dominoes

A web-based multiplayer Racehorse Dominoes game with real-time gameplay, visual domino tiles, and crossed-double branching support.

## Features

- **Correct Racehorse Rules**: Full implementation of Racehorse Dominoes including:
  - Opening must be a double OR a scoring play
  - Extra turn on doubles and scoring plays (can chain)
  - Last-tile scoring/double: legal; forces draw while boneyard is drawable, otherwise hand ends
  - Crossed-double branching (up to 2 branches per hub)
  - Dead tiles that cannot be drawn
  - Blocked hand resolution

- **Scoring**: Points = Open Ends Sum / 5 (when divisible by 5)
  - Includes all branch ends in the sum

- **Multiplayer**: Real-time 2-player gameplay via Socket.IO
  - Create/join rooms with room codes
  - Live state synchronization

- **Visual UI**:
  - Real domino tiles with pip display
  - Visual board layout with branch visualization
  - Turn indicators, scores, boneyard count
  - Placement zone highlighting

## Project Structure

```
racehorse-dominoes/
├── server/           # Node.js + Express + Socket.IO + TypeScript
│   └── src/
│       ├── game/
│       │   ├── types.ts      # Core types and utilities
│       │   ├── scoring.ts    # Board placement and scoring
│       │   ├── engine.ts     # Game engine and rules
│       │   └── __tests__/    # Vitest tests
│       ├── rooms.ts          # Room management
│       └── index.ts          # Server entry point
│
└── client/           # Vite + React + TypeScript
    └── src/
        ├── App.tsx           # Main application
        ├── App.css           # Game styles
        └── index.css         # Base styles
```

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd racehorse-dominoes

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

## Running the App

You need two terminals:

### Terminal 1: Server (port 3001)
```bash
cd server
npm run dev
```

### Terminal 2: Client (port 5173)
```bash
cd client
npm run dev
```

Then open http://localhost:5173 in two browser windows to play.

## Running Tests

```bash
cd server
npm test
```

## Building for Production

### Server
```bash
cd server
npm run build
npm start
```

### Client
```bash
cd client
npm run build
npm run preview
```

## Game Rules Summary

### Setup
- Double-six tile set (28 tiles)
- Each player draws 7 tiles
- 2 tiles are "dead" and cannot be drawn

### Opening
- First play must be a double OR a tile that scores

### Play
- Match a tile to any open end (main line left/right, or branch ends)
- Playing a double grants an extra turn
- Scoring (open ends sum divisible by 5) grants an extra turn
- Extra turns can chain

### Branching
- When a double is "crossed" (another tile played through it on the main line), it becomes a hub
- Each hub can spawn up to 2 branch arms
- Branch ends count toward the open ends sum for scoring

### Last Tile on a Score or Double
- Scoring plays and doubles keep your turn alive
- If you empty your hand with one while the boneyard can still be drawn, you must draw and continue
- If the boneyard is locked (only dead tiles remain), the hand can end
- There is no manual draw or pass — drawing and passing only happen when the rules force them

### Blocked Hand
- When all players pass consecutively, the hand is blocked
- Player with lowest pip count wins
- Winner receives opponent's pip penalty (rounded up to nearest 5)

## Tech Stack

- **Server**: Node.js, Express, Socket.IO, TypeScript, Vitest
- **Client**: Vite, React, TypeScript, Socket.IO Client
