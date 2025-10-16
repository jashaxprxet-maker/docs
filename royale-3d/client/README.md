# Royale 3D (Babylon.js + WebSocket server)

Run the server:
```bash
cd royale-3d/server
npm install
npm run dev
```

Run the client:
```bash
cd royale-3d/client
npm install
npm run dev
```

Controls:
- Move: WASD/Arrows (Shift to sprint)
- Orbit: Mouse drag (third-person)

Notes:
- Map is a large flat terrain (4000x4000). Next steps: heightmap/tiles, foliage, POIs.
- Multiplayer: add WS client, state sync, interpolation, and shooting projectile logic.
