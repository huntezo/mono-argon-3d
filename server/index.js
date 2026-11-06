import express from 'express';
import http from 'http';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { MonopolyGame } from './gameEngine.js';
import { BotController } from './botController.js';

const PORT = process.env.PORT || 3000;
const BOT_NAMES = ['Lord Sterling (AI)', 'Duchess Vance (AI)', 'Baroness Kael (AI)', 'Magnate Orion (AI)', 'Countess Vega (AI)'];

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*' }
  });

  const games = new Map();
  const socketToRoom = new Map();
  const botController = new BotController(io);

  function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return games.has(code) ? generateRoomCode() : code;
  }

  function broadcastState(game) {
    io.to(game.roomCode).emit('STATE_UPDATE', game.serialize());
  }

  function emitRollAnimation(game, playerId, rollRes) {
    io.to(game.roomCode).emit('DICE_ROLLED', {
      playerId,
      dice: rollRes.dice,
      fromPos: rollRes.fromPos,
      toPos: rollRes.toPos,
      intermediatePos: rollRes.intermediatePos,
      stayedInJail: !!rollRes.stayedInJail,
      sentToJail: !!rollRes.sentToJail,
      cardDrawn: rollRes.cardDrawn || null,
      events: rollRes.events || []
    });
  }

  // Authoritative Turn & Auction Timer Watchdog (checks every 1s)
  setInterval(() => {
    const now = Date.now();
    for (const game of games.values()) {
      if (game.phase === 'LOBBY' || game.phase === 'GAME_OVER') continue;

      // 1. Check active auction hammer clock
      if (game.phase === 'AUCTION' && game.activeAuction && now >= game.activeAuction.deadline) {
        const res = game.checkAuctionCompletion(true);
        if (res && res.winnerId) {
          io.to(game.roomCode).emit('PROPERTY_BOUGHT', {
            playerId: res.winnerId,
            tileIndex: res.tileIndex,
            completedMonopoly: res.completedMonopoly
          });
        }
        broadcastState(game);
        botController.scheduleCheck(game, broadcastState, emitRollAnimation);
        continue;
      }

      // 2. Check turn timer
      if (!game.turnTimeLimit || !game.turnDeadline) continue;
      if (now < game.turnDeadline) continue;

      const active = game.getActivePlayer();
      if (!active || active.isBot || active.bankrupt) continue;

      game.addLog(`⏰ Time's up for ${active.name}! Auto-completing turn.`, 'warn');

      if (game.phase === 'WAIT_FOR_ROLL') {
        const rollRes = game.rollDice(active.id);
        if (rollRes.ok) {
          emitRollAnimation(game, active.id, rollRes);
        }
      }

      if (game.phase === 'BUY_DECISION') {
        game.passProperty(active.id, true); // Skip auction on timeout so turn advances cleanly
      }

      if (game.phase === 'DEBT_RESOLUTION') {
        botController.tryRaiseFunds(game, active);
        if (active.cash < 0) {
          game.declareBankruptcy(active.id);
        }
      }

      if (game.phase === 'MANAGE_AND_END_TURN') {
        game.endTurn(active.id);
      }

      broadcastState(game);
      botController.scheduleCheck(game, broadcastState, emitRollAnimation);
    }
  }, 1000);

  io.on('connection', (socket) => {
    socket.on('CREATE_ROOM', ({ playerName, token, sessionToken }, callback) => {
      const roomCode = generateRoomCode();
      const game = new MonopolyGame(roomCode, socket.id);
      const res = game.addPlayer({ id: socket.id, name: playerName, token, isBot: false, sessionToken });
      if (res.error) {
        return callback?.({ error: res.error });
      }
      games.set(roomCode, game);
      socketToRoom.set(socket.id, roomCode);
      socket.join(roomCode);

      broadcastState(game);
      callback?.({ ok: true, roomCode, playerId: socket.id, state: game.serialize() });
    });

    socket.on('JOIN_ROOM', ({ roomCode, playerName, token, sessionToken }, callback) => {
      const cleanCode = (roomCode || '').trim().toUpperCase();
      const game = games.get(cleanCode);
      if (!game) {
        return callback?.({ error: `Room "${cleanCode}" not found.` });
      }
      const res = game.addPlayer({ id: socket.id, name: playerName, token, isBot: false, sessionToken });
      if (res.error) {
        return callback?.({ error: res.error });
      }
      socketToRoom.set(socket.id, cleanCode);
      socket.join(cleanCode);

      broadcastState(game);
      callback?.({
        ok: true,
        roomCode: cleanCode,
        playerId: socket.id,
        reconnected: !!res.reconnected,
        isSpectator: !!res.isSpectator,
        state: game.serialize()
      });
    });

    socket.on('ADD_BOT', (_, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });
      if (game.hostId !== socket.id) return callback?.({ error: 'Only the host can add bots.' });

      const botCount = game.players.filter(p => p.isBot).length;
      const botName = BOT_NAMES[botCount % BOT_NAMES.length];
      const botId = `bot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const res = game.addPlayer({ id: botId, name: botName, isBot: true });
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      callback?.({ ok: true });
    });

    socket.on('REMOVE_BOT', ({ botId }, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });
      if (game.hostId !== socket.id) return callback?.({ error: 'Only the host can remove bots.' });

      game.removePlayer(botId);
      broadcastState(game);
      callback?.({ ok: true });
    });

    socket.on('SET_TURN_TIMER', ({ seconds }, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.setTurnTimer(socket.id, seconds);
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      callback?.(res);
    });

    socket.on('SET_HOUSE_RULES', (rules, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.setHouseRules(socket.id, rules);
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      callback?.(res);
    });

    socket.on('START_GAME', (_, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.startGame(socket.id);
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      botController.scheduleCheck(game, broadcastState, emitRollAnimation);
      callback?.({ ok: true });
    });

    socket.on('ROLL_DICE', (_, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.rollDice(socket.id);
      if (res.error) return callback?.({ error: res.error });

      emitRollAnimation(game, socket.id, res);
      broadcastState(game);
      botController.scheduleCheck(game, broadcastState, emitRollAnimation);
      callback?.({ ok: true, ...res });
    });

    socket.on('BUY_PROPERTY', (_, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.buyProperty(socket.id);
      if (res.error) return callback?.({ error: res.error });

      io.to(roomCode).emit('PROPERTY_BOUGHT', {
        playerId: socket.id,
        tileIndex: res.tileIndex,
        completedMonopoly: res.completedMonopoly
      });
      broadcastState(game);
      botController.scheduleCheck(game, broadcastState, emitRollAnimation);
      callback?.(res);
    });

    socket.on('PASS_PROPERTY', (_, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.passProperty(socket.id);
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      botController.scheduleCheck(game, broadcastState, emitRollAnimation);
      callback?.(res);
    });

    socket.on('AUCTION_BID', ({ amount }, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.placeAuctionBid(socket.id, amount);
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      botController.scheduleCheck(game, broadcastState, emitRollAnimation);
      callback?.(res);
    });

    socket.on('AUCTION_FOLD', (_, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.foldAuction(socket.id);
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      botController.scheduleCheck(game, broadcastState, emitRollAnimation);
      callback?.(res);
    });

    socket.on('PROPOSE_TRADE', (payload, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.proposeTrade(socket.id, payload || {});
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      botController.scheduleCheck(game, broadcastState, emitRollAnimation);
      callback?.(res);
    });

    socket.on('RESPOND_TRADE', ({ tradeId, accept }, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.respondTrade(socket.id, tradeId, !!accept);
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      botController.scheduleCheck(game, broadcastState, emitRollAnimation);
      callback?.(res);
    });

    socket.on('BUILD_HOUSE', ({ tileIndex }, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.buildHouse(socket.id, Number(tileIndex));
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      callback?.(res);
    });

    socket.on('SELL_HOUSE', ({ tileIndex }, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.sellHouse(socket.id, Number(tileIndex));
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      callback?.(res);
    });

    socket.on('MORTGAGE_PROPERTY', ({ tileIndex }, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.mortgageProperty(socket.id, Number(tileIndex));
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      callback?.(res);
    });

    socket.on('UNMORTGAGE_PROPERTY', ({ tileIndex }, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.unmortgageProperty(socket.id, Number(tileIndex));
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      callback?.(res);
    });

    socket.on('PAY_JAIL_FINE', (_, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.payJailFine(socket.id);
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      callback?.(res);
    });

    socket.on('USE_JAIL_CARD', (_, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.useJailCard(socket.id);
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      callback?.(res);
    });

    socket.on('DECLARE_BANKRUPTCY', (_, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.declareBankruptcy(socket.id);
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      botController.scheduleCheck(game, broadcastState, emitRollAnimation);
      callback?.(res);
    });

    socket.on('END_TURN', (_, callback) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game) return callback?.({ error: 'Room not found.' });

      const res = game.endTurn(socket.id);
      if (res.error) return callback?.({ error: res.error });

      broadcastState(game);
      botController.scheduleCheck(game, broadcastState, emitRollAnimation);
      callback?.(res);
    });

    socket.on('SEND_CHAT', ({ message }) => {
      const roomCode = socketToRoom.get(socket.id);
      const game = games.get(roomCode);
      if (!game || !message) return;

      const player = game.players.find(p => p.id === socket.id) || game.spectators.find(s => s.id === socket.id);
      const cleanMsg = String(message).trim().slice(0, 140);
      if (!cleanMsg) return;

      game.addLog(`💬 ${player ? player.name : 'Spectator'}: ${cleanMsg}`, 'chat');
      broadcastState(game);
    });

    socket.on('disconnect', () => {
      const roomCode = socketToRoom.get(socket.id);
      if (!roomCode) return;
      socketToRoom.delete(socket.id);

      const game = games.get(roomCode);
      if (!game) return;
      game.removePlayer(socket.id);

      const anyHumanLeft = game.players.some(p => !p.isBot && p.connected);
      if (!anyHumanLeft && game.phase === 'LOBBY') {
        games.delete(roomCode);
      } else {
        broadcastState(game);
      }
    });
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      configFile: path.resolve(process.cwd(), 'vite.config.js'),
      server: { middlewareMode: true }
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, () => {
    console.log(`\n🎲 MONO ARGON 3D Multiplayer Server running at http://localhost:${PORT}\n`);
  });

  return { httpServer, io, games };
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  startServer();
}

export { startServer };
