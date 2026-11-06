# MONO ARGON 3D — Online Multiplayer Monopoly

🎲 A high-performance 3D online multiplayer web edition of Monopoly built with **Three.js (WebGL)**, **Node.js**, **Express**, **Socket.IO**, and **Vite**.

🌐 **Live Demo**: [https://silver-birds-lay.loca.lt](https://silver-birds-lay.loca.lt)  
*(When accessing via the tunnel link for the first time, if prompted for the endpoint IP password, enter: `2.89.46.13`)*

---

## Features
- **3D Interactive Game Board**: Smooth orbit/follow/top-down cameras, procedural wood table, 3D animated dice, and city monuments (Pyramids, Eiffel Tower, Big Ben, Burj Khalifa, etc.).
- **Live Multiplayer & AI Bots**: Host public/private rooms with room codes, play with up to 6 players or AI bots.
- **Player-to-Player Trading**: Exchange cities, airports, utilities, and cash with human players and smart AI bots (`T` shortcut).
- **Live Property Auctions**: When a player passes on buying an unowned property, a live bidding war begins with hammer countdown timer.
- **House Rules & Starting Cash**: Custom starting cash ($1,000 / $1,500 / $2,500), Free Parking Jackpot pool, and Double salary on exact GO ($400).
- **Reconnection & Spectator Mode**: Auto-reclaims tycoon seat and portfolio on page refresh; mid-game joiners enter as live spectators.
- **Wealth Graph & Match Analytics**: Net worth timeline chart across turns and post-game awards (`G` shortcut).

---

## 1-Click Free Hosting on Render
1. Go to [Render Dashboard](https://dashboard.render.com).
2. Click **New +** ➔ **Web Service**.
3. Select your repository `huntezo/mono-argon-3d`.
4. Render will auto-detect the configuration:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free
5. Click **Create Web Service**.
