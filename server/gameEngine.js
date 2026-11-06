import { BOARD_SPACES, COLOR_GROUPS, CHANCE_CARDS, CHEST_CARDS, PLAYER_TOKENS } from '../shared/boardData.js';

function shuffleDeck(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export class MonopolyGame {
  constructor(roomCode, hostId) {
    this.roomCode = roomCode;
    this.hostId = hostId;
    this.phase = 'LOBBY'; // LOBBY, WAIT_FOR_ROLL, BUY_DECISION, AUCTION, MANAGE_AND_END_TURN, DEBT_RESOLUTION, GAME_OVER
    this.players = [];
    this.spectators = [];
    this.activePlayerIndex = 0;
    this.turnNumber = 1;
    this.doublesCount = 0;
    this.lastDice = [1, 1];
    this.lastCard = null;
    this.pendingRentMultiplier = 1;
    this.forceUtilityTenX = false;
    this.winner = null;

    this.turnTimeLimit = 60; // seconds per turn (0 = unlimited)
    this.turnDeadline = null;
    this.gameStartedAt = null;

    // House Rules & Match Settings
    this.houseRules = {
      startingCash: 1500, // 1000, 1500, 2500
      freeParkingJackpot: true,
      doubleOnGo: false,
      auctionsEnabled: true
    };
    this.freeParkingPot = 0;

    // Live Auction State
    this.activeAuction = null; // { tileIndex, highestBid, highestBidderId, passedIds: [], deadline }

    // Player-to-Player Trade Offers
    this.activeTrades = [];

    // Wealth & Analytics History
    this.wealthHistory = []; // [{ turn: 1, values: { [playerId]: netWorth } }]

    // Property ownership state keyed by board index
    this.properties = {};
    for (const tile of BOARD_SPACES) {
      if (['property', 'railroad', 'utility'].includes(tile.type)) {
        this.properties[tile.index] = {
          index: tile.index,
          ownerId: null,
          houses: 0, // 0..4 houses, 5 = hotel
          mortgaged: false
        };
      }
    }

    this.chanceDeck = shuffleDeck(CHANCE_CARDS);
    this.chestDeck = shuffleDeck(CHEST_CARDS);
    this.logs = [];
    this.addLog('Room created. Waiting for players to join...');
  }

  addLog(text, type = 'info') {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      text,
      type
    };
    this.logs.push(entry);
    if (this.logs.length > 80) {
      this.logs.shift();
    }
    return entry;
  }

  getAvailableToken() {
    const used = new Set(this.players.map(p => p.token));
    const available = PLAYER_TOKENS.find(t => !used.has(t.id));
    return available ? available.id : PLAYER_TOKENS[this.players.length % PLAYER_TOKENS.length].id;
  }

  addPlayer({ id, name, token, isBot = false, sessionToken = null }) {
    // Check if reconnecting via sessionToken
    if (sessionToken) {
      const existingBySession = this.players.find(p => p.sessionToken === sessionToken);
      if (existingBySession) {
        const oldId = existingBySession.id;
        this.rebindPlayerId(oldId, id);
        existingBySession.connected = true;
        this.addLog(`🔄 ${existingBySession.name} reconnected to their seat!`, 'join');
        return { ok: true, player: existingBySession, reconnected: true };
      }
    }

    if (this.players.some(p => p.id === id)) {
      return { ok: true, player: this.players.find(p => p.id === id) };
    }

    // If match already started, join as live Spectator
    if (this.phase !== 'LOBBY') {
      const specName = (name || `Spectator ${this.spectators.length + 1}`).slice(0, 20);
      if (!this.spectators.some(s => s.id === id)) {
        this.spectators.push({ id, name: specName });
        this.addLog(`👁️ ${specName} joined as a Spectator.`, 'info');
      }
      return { ok: true, isSpectator: true };
    }

    if (this.players.length >= 6) {
      return { error: 'Room is full (maximum 6 players).' };
    }

    const chosenToken = token && !this.players.some(p => p.token === token)
      ? token
      : this.getAvailableToken();

    const tokenMeta = PLAYER_TOKENS.find(t => t.id === chosenToken) || PLAYER_TOKENS[0];

    const player = {
      id,
      sessionToken: sessionToken || `sess-${id}`,
      name: (name || `Player ${this.players.length + 1}`).slice(0, 20),
      token: chosenToken,
      color: tokenMeta.color,
      isBot,
      cash: this.houseRules.startingCash,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      bankrupt: false,
      connected: true,
      creditorId: null,
      stats: {
        rentCollected: 0,
        rentPaid: 0,
        doublesRolled: 0,
        timesInJail: 0,
        propertiesBought: 0
      }
    };

    this.players.push(player);
    this.addLog(`${player.name} (${tokenMeta.name}) joined the table.`, 'join');
    return { ok: true, player };
  }

  rebindPlayerId(oldId, newId) {
    if (oldId === newId) return;
    const player = this.players.find(p => p.id === oldId);
    if (!player) return;
    player.id = newId;
    if (this.hostId === oldId) this.hostId = newId;
    for (const prop of Object.values(this.properties)) {
      if (prop.ownerId === oldId) prop.ownerId = newId;
    }
    for (const p of this.players) {
      if (p.creditorId === oldId) p.creditorId = newId;
    }
    if (this.activeAuction) {
      if (this.activeAuction.highestBidderId === oldId) this.activeAuction.highestBidderId = newId;
      this.activeAuction.passedIds = this.activeAuction.passedIds.map(pid => (pid === oldId ? newId : pid));
    }
    for (const t of this.activeTrades) {
      if (t.fromId === oldId) t.fromId = newId;
      if (t.toId === oldId) t.toId = newId;
    }
    for (const snap of this.wealthHistory) {
      if (snap.values[oldId] !== undefined) {
        snap.values[newId] = snap.values[oldId];
        delete snap.values[oldId];
      }
    }
  }

  removePlayer(playerId) {
    const specIdx = this.spectators.findIndex(s => s.id === playerId);
    if (specIdx !== -1) {
      this.spectators.splice(specIdx, 1);
      return;
    }

    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx === -1) return;
    const player = this.players[idx];

    if (this.phase === 'LOBBY') {
      this.players.splice(idx, 1);
      this.addLog(`${player.name} left the lobby.`);
      if (this.hostId === playerId && this.players.length > 0) {
        const nextHuman = this.players.find(p => !p.isBot) || this.players[0];
        this.hostId = nextHuman.id;
      }
    } else {
      player.connected = false;
      this.addLog(`${player.name} disconnected (seat reserved for reconnect).`, 'warn');
    }
  }

  setTurnTimer(requesterId, seconds) {
    if (requesterId !== this.hostId) return { error: 'Only the host can change the timer.' };
    const allowed = [0, 30, 60, 90, 120];
    const clean = allowed.includes(Number(seconds)) ? Number(seconds) : 60;
    this.turnTimeLimit = clean;
    this.addLog(`⏱️ Turn timer set to ${clean === 0 ? 'Unlimited' : `${clean}s`}.`, 'info');
    return { ok: true, turnTimeLimit: this.turnTimeLimit };
  }

  setHouseRules(requesterId, partialRules = {}) {
    if (requesterId !== this.hostId) return { error: 'Only the host can change house rules.' };
    if (this.phase !== 'LOBBY') return { error: 'Cannot change house rules after match starts.' };

    if (partialRules.startingCash !== undefined) {
      const allowedCash = [1000, 1500, 2500];
      if (allowedCash.includes(Number(partialRules.startingCash))) {
        this.houseRules.startingCash = Number(partialRules.startingCash);
        for (const p of this.players) {
          p.cash = this.houseRules.startingCash;
        }
      }
    }
    if (partialRules.freeParkingJackpot !== undefined) {
      this.houseRules.freeParkingJackpot = !!partialRules.freeParkingJackpot;
    }
    if (partialRules.doubleOnGo !== undefined) {
      this.houseRules.doubleOnGo = !!partialRules.doubleOnGo;
    }
    if (partialRules.auctionsEnabled !== undefined) {
      this.houseRules.auctionsEnabled = !!partialRules.auctionsEnabled;
    }
    return { ok: true, houseRules: this.houseRules };
  }

  refreshTurnDeadline() {
    if (this.phase === 'LOBBY' || this.phase === 'GAME_OVER' || !this.turnTimeLimit) {
      this.turnDeadline = null;
    } else {
      this.turnDeadline = Date.now() + this.turnTimeLimit * 1000;
    }
  }

  recordWealthSnapshot() {
    const values = {};
    for (const p of this.players) {
      values[p.id] = this.calculateNetWorth(p.id);
    }
    const existing = this.wealthHistory.find(w => w.turn === this.turnNumber);
    if (existing) {
      existing.values = values;
    } else {
      this.wealthHistory.push({ turn: this.turnNumber, values });
    }
  }

  startGame(requesterId) {
    if (requesterId !== this.hostId) {
      return { error: 'Only the room host can start the game.' };
    }
    if (this.players.length < 2) {
      return { error: 'Need at least 2 players (add an AI Bot or invite a friend) to start.' };
    }
    if (this.phase !== 'LOBBY') {
      return { error: 'Game already in progress.' };
    }

    for (const p of this.players) {
      p.cash = this.houseRules.startingCash;
    }
    this.freeParkingPot = this.houseRules.freeParkingJackpot ? 100 : 0;
    this.phase = 'WAIT_FOR_ROLL';
    this.activePlayerIndex = 0;
    this.turnNumber = 1;
    this.doublesCount = 0;
    this.gameStartedAt = Date.now();
    this.refreshTurnDeadline();
    this.recordWealthSnapshot();
    const active = this.getActivePlayer();
    this.addLog(`Game started! ${active.name} is up first.`, 'highlight');
    return { ok: true };
  }

  getActivePlayer() {
    return this.players[this.activePlayerIndex] || null;
  }

  ownsFullGroup(playerId, groupName) {
    if (!groupName || !COLOR_GROUPS[groupName]) return false;
    const groupTiles = BOARD_SPACES.filter(t => t.group === groupName);
    return groupTiles.every(t => {
      const prop = this.properties[t.index];
      return prop && prop.ownerId === playerId && !prop.mortgaged;
    });
  }

  ownsAllInColorGroupRaw(playerId, groupName) {
    if (!groupName || !COLOR_GROUPS[groupName]) return false;
    const groupTiles = BOARD_SPACES.filter(t => t.group === groupName);
    return groupTiles.every(t => {
      const prop = this.properties[t.index];
      return prop && prop.ownerId === playerId;
    });
  }

  calculateRent(tileIndex, diceTotal) {
    const tile = BOARD_SPACES[tileIndex];
    const prop = this.properties[tileIndex];
    if (!tile || !prop || !prop.ownerId || prop.mortgaged) return 0;

    if (tile.type === 'property') {
      if (prop.houses > 0) {
        return tile.rent[prop.houses];
      }
      const base = tile.rent[0];
      return this.ownsFullGroup(prop.ownerId, tile.group) ? base * 2 : base;
    }

    if (tile.type === 'railroad') {
      const ownedRailroads = BOARD_SPACES.filter(
        t => t.type === 'railroad' &&
             this.properties[t.index]?.ownerId === prop.ownerId &&
             !this.properties[t.index]?.mortgaged
      ).length;
      const baseRent = tile.rent[Math.max(0, ownedRailroads - 1)] || 25;
      return baseRent * this.pendingRentMultiplier;
    }

    if (tile.type === 'utility') {
      if (this.forceUtilityTenX) {
        return diceTotal * 10;
      }
      const ownedUtilities = BOARD_SPACES.filter(
        t => t.type === 'utility' &&
             this.properties[t.index]?.ownerId === prop.ownerId &&
             !this.properties[t.index]?.mortgaged
      ).length;
      const mult = ownedUtilities >= 2 ? 10 : 4;
      return diceTotal * mult;
    }

    return 0;
  }

  payJailFine(playerId) {
    const player = this.getActivePlayer();
    if (!player || player.id !== playerId) return { error: 'Not your turn.' };
    if (this.phase !== 'WAIT_FOR_ROLL') return { error: 'Can only pay jail fine before rolling.' };
    if (!player.inJail) return { error: 'You are not in Jail.' };
    if (player.cash < 50) return { error: 'Insufficient cash ($50 required).' };

    player.cash -= 50;
    if (this.houseRules.freeParkingJackpot) this.freeParkingPot += 50;
    player.inJail = false;
    player.jailTurns = 0;
    this.addLog(`${player.name} paid $50 fine and is released from Jail.`, 'cash');
    return { ok: true };
  }

  useJailCard(playerId) {
    const player = this.getActivePlayer();
    if (!player || player.id !== playerId) return { error: 'Not your turn.' };
    if (this.phase !== 'WAIT_FOR_ROLL') return { error: 'Can only use card before rolling.' };
    if (!player.inJail) return { error: 'You are not in Jail.' };
    if (player.jailCards <= 0) return { error: 'You do not have a Get Out of Jail Free card.' };

    player.jailCards -= 1;
    player.inJail = false;
    player.jailTurns = 0;
    this.addLog(`${player.name} used a Get Out of Jail Free card!`, 'highlight');
    return { ok: true };
  }

  rollDice(playerId, forcedDice = null) {
    const player = this.getActivePlayer();
    if (!player || player.id !== playerId) return { error: 'Not your turn.' };
    if (this.phase !== 'WAIT_FOR_ROLL') return { error: 'Cannot roll right now.' };

    const d1 = forcedDice ? forcedDice[0] : Math.floor(Math.random() * 6) + 1;
    const d2 = forcedDice ? forcedDice[1] : Math.floor(Math.random() * 6) + 1;
    const total = d1 + d2;
    const isDoubles = d1 === d2;

    if (isDoubles) player.stats.doublesRolled += 1;

    this.lastDice = [d1, d2];
    this.lastCard = null;
    this.pendingRentMultiplier = 1;
    this.forceUtilityTenX = false;

    const fromPos = player.position;
    let events = [];

    if (player.inJail) {
      if (isDoubles) {
        player.inJail = false;
        player.jailTurns = 0;
        this.doublesCount = 0;
        this.addLog(`${player.name} rolled doubles (${d1} + ${d2}) and escaped Jail!`, 'highlight');
      } else {
        player.jailTurns += 1;
        if (player.jailTurns >= 3) {
          player.cash -= 50;
          if (this.houseRules.freeParkingJackpot) this.freeParkingPot += 50;
          player.inJail = false;
          player.jailTurns = 0;
          this.addLog(`${player.name} rolled ${d1} + ${d2} (3rd attempt in Jail), paid $50 fine, and moves ${total} spaces.`, 'warn');
        } else {
          this.addLog(`${player.name} rolled ${d1} + ${d2} and stays in Jail (Attempt ${player.jailTurns}/3).`, 'info');
          this.phase = player.cash < 0 ? 'DEBT_RESOLUTION' : 'MANAGE_AND_END_TURN';
          return {
            ok: true,
            dice: [d1, d2],
            fromPos,
            toPos: player.position,
            stayedInJail: true,
            events
          };
        }
      }
    } else {
      if (isDoubles) {
        this.doublesCount += 1;
        if (this.doublesCount >= 3) {
          this.addLog(`${player.name} rolled 3 consecutive doubles (${d1} + ${d2}) and goes directly to Jail!`, 'warn');
          this.sendPlayerToJail(player);
          return {
            ok: true,
            dice: [d1, d2],
            fromPos,
            toPos: 10,
            sentToJail: true,
            events
          };
        }
      } else {
        this.doublesCount = 0;
      }
    }

    this.addLog(`${player.name} rolled ${d1} + ${d2} = ${total}${isDoubles ? ' (DOUBLES!)' : ''}.`, 'roll');
    const moveResult = this.movePlayerBySteps(player, total, events);

    return {
      ok: true,
      dice: [d1, d2],
      fromPos,
      toPos: player.position,
      intermediatePos: moveResult.intermediatePos,
      cardDrawn: this.lastCard,
      events
    };
  }

  movePlayerBySteps(player, steps, events = []) {
    const oldPos = player.position;
    let newPos = (oldPos + steps) % 40;
    if (newPos < 0) newPos += 40;

    if (steps > 0 && oldPos + steps >= 40) {
      const exactGo = newPos === 0 && this.houseRules.doubleOnGo;
      const salary = exactGo ? 400 : 200;
      player.cash += salary;
      this.addLog(`${player.name} ${exactGo ? 'landed directly on GO (Double Bonus!)' : 'passed GO'} and collected $${salary}!`, 'cash');
      events.push({ type: 'PASS_GO', playerId: player.id, amount: salary });
    }

    player.position = newPos;
    const intermediatePos = newPos;
    this.resolveSpaceLanding(player, events);

    return { intermediatePos, finalPos: player.position };
  }

  movePlayerToTarget(player, targetIndex, collectGo = true, events = []) {
    const oldPos = player.position;
    if (collectGo && targetIndex < oldPos) {
      const exactGo = targetIndex === 0 && this.houseRules.doubleOnGo;
      const salary = exactGo ? 400 : 200;
      player.cash += salary;
      this.addLog(`${player.name} ${exactGo ? 'landed directly on GO (Double Bonus!)' : 'passed GO'} and collected $${salary}!`, 'cash');
      events.push({ type: 'PASS_GO', playerId: player.id, amount: salary });
    }
    player.position = targetIndex;
    this.resolveSpaceLanding(player, events);
  }

  sendPlayerToJail(player) {
    player.position = 10;
    player.inJail = true;
    player.jailTurns = 0;
    player.stats.timesInJail += 1;
    this.doublesCount = 0;
    this.phase = player.cash < 0 ? 'DEBT_RESOLUTION' : 'MANAGE_AND_END_TURN';
  }

  resolveSpaceLanding(player, events = []) {
    const tile = BOARD_SPACES[player.position];
    const prop = this.properties[player.position];

    if (tile.type === 'go') {
      this.addLog(`${player.name} landed on GO.`);
      this.finishLandingPhase(player);
      return;
    }

    if (tile.type === 'parking') {
      if (this.houseRules.freeParkingJackpot && this.freeParkingPot > 0) {
        const won = this.freeParkingPot;
        player.cash += won;
        this.freeParkingPot = 0;
        this.addLog(`🎰 ${player.name} hit the Free Parking Jackpot and won $${won}!`, 'highlight');
        events.push({ type: 'JACKPOT', playerId: player.id, amount: won });
      } else {
        this.addLog(`${player.name} is resting at Free Parking.`);
      }
      this.finishLandingPhase(player);
      return;
    }

    if (tile.type === 'jail') {
      this.addLog(`${player.name} is Just Visiting Jail.`);
      this.finishLandingPhase(player);
      return;
    }

    if (tile.type === 'gotojail') {
      this.addLog(`${player.name} landed on Go To Jail!`, 'warn');
      this.sendPlayerToJail(player);
      events.push({ type: 'GOTO_JAIL', playerId: player.id });
      return;
    }

    if (tile.type === 'tax') {
      player.cash -= tile.taxAmount;
      if (this.houseRules.freeParkingJackpot) {
        this.freeParkingPot += tile.taxAmount;
      }
      player.creditorId = null;
      this.addLog(`${player.name} paid $${tile.taxAmount} for ${tile.name}${this.houseRules.freeParkingJackpot ? ` (Pot: $${this.freeParkingPot})` : ''}.`, 'warn');
      events.push({ type: 'TAX', playerId: player.id, amount: tile.taxAmount });
      this.finishLandingPhase(player);
      return;
    }

    if (tile.type === 'chance' || tile.type === 'chest') {
      this.drawCard(player, tile.type, events);
      return;
    }

    if (['property', 'railroad', 'utility'].includes(tile.type)) {
      if (!prop.ownerId) {
        this.addLog(`${player.name} landed on unowned ${tile.name} ($${tile.price}).`, 'info');
        this.phase = 'BUY_DECISION';
        return;
      }

      if (prop.ownerId === player.id) {
        this.addLog(`${player.name} landed on their own city (${tile.name}).`);
        this.finishLandingPhase(player);
        return;
      }

      if (prop.mortgaged) {
        this.addLog(`${player.name} landed on ${tile.name}, which is mortgaged (No rent due).`);
        this.finishLandingPhase(player);
        return;
      }

      const owner = this.players.find(p => p.id === prop.ownerId);
      if (!owner || owner.bankrupt) {
        this.finishLandingPhase(player);
        return;
      }

      const diceTotal = this.lastDice[0] + this.lastDice[1];
      const rent = this.calculateRent(tile.index, diceTotal);
      player.cash -= rent;
      owner.cash += rent;
      player.stats.rentPaid += rent;
      owner.stats.rentCollected += rent;
      player.creditorId = owner.id;

      this.addLog(`${player.name} paid $${rent} rent to ${owner.name} in ${tile.name}!`, 'rent');
      events.push({ type: 'RENT', fromId: player.id, toId: owner.id, amount: rent, tileIndex: tile.index });
      this.finishLandingPhase(player);
    }
  }

  drawCard(player, deckType, events = []) {
    const deck = deckType === 'chance' ? this.chanceDeck : this.chestDeck;
    const card = deck.shift();
    deck.push(card);

    this.lastCard = { ...card, deckType };
    const deckLabel = deckType === 'chance' ? 'Chance' : 'Community Chest';
    this.addLog(`${player.name} drew ${deckLabel}: "${card.text}"`, 'card');
    events.push({ type: 'CARD', deckType, card });

    switch (card.action) {
      case 'move':
        this.movePlayerToTarget(player, card.target, true, events);
        break;

      case 'move_relative':
        this.movePlayerBySteps(player, card.steps, events);
        break;

      case 'nearest_utility': {
        const pos = player.position;
        const target = (pos >= 12 && pos < 28) ? 28 : 12;
        this.forceUtilityTenX = true;
        this.movePlayerToTarget(player, target, true, events);
        break;
      }

      case 'nearest_railroad': {
        const pos = player.position;
        let target = 5;
        if (pos >= 5 && pos < 15) target = 15;
        else if (pos >= 15 && pos < 25) target = 25;
        else if (pos >= 25 && pos < 35) target = 35;
        else target = 5;
        this.pendingRentMultiplier = 2;
        this.movePlayerToTarget(player, target, true, events);
        break;
      }

      case 'goto_jail':
        this.sendPlayerToJail(player);
        break;

      case 'jail_card':
        player.jailCards += 1;
        this.finishLandingPhase(player);
        break;

      case 'cash':
        player.cash += card.amount;
        if (card.amount < 0) {
          player.creditorId = null;
          if (this.houseRules.freeParkingJackpot) this.freeParkingPot += Math.abs(card.amount);
        }
        this.finishLandingPhase(player);
        break;

      case 'pay_each_player': {
        const others = this.players.filter(p => p.id !== player.id && !p.bankrupt);
        const total = others.length * card.amount;
        player.cash -= total;
        player.creditorId = null;
        for (const o of others) {
          o.cash += card.amount;
        }
        this.finishLandingPhase(player);
        break;
      }

      case 'collect_each_player': {
        const others = this.players.filter(p => p.id !== player.id && !p.bankrupt);
        for (const o of others) {
          o.cash -= card.amount;
          player.cash += card.amount;
        }
        this.finishLandingPhase(player);
        break;
      }

      case 'repairs': {
        let houses = 0;
        let hotels = 0;
        for (const prop of Object.values(this.properties)) {
          if (prop.ownerId === player.id) {
            if (prop.houses === 5) hotels += 1;
            else houses += prop.houses;
          }
        }
        const cost = houses * card.houseRate + hotels * card.hotelRate;
        player.cash -= cost;
        if (this.houseRules.freeParkingJackpot && cost > 0) this.freeParkingPot += cost;
        player.creditorId = null;
        this.addLog(`${player.name} paid $${cost} for property repairs (${houses} houses, ${hotels} hotels).`, 'warn');
        this.finishLandingPhase(player);
        break;
      }

      default:
        this.finishLandingPhase(player);
    }
  }

  finishLandingPhase(player) {
    if (player.cash < 0) {
      this.phase = 'DEBT_RESOLUTION';
    } else {
      this.phase = 'MANAGE_AND_END_TURN';
    }
  }

  buyProperty(playerId) {
    const player = this.getActivePlayer();
    if (!player || player.id !== playerId) return { error: 'Not your turn.' };
    if (this.phase !== 'BUY_DECISION') return { error: 'No property available to buy right now.' };

    const tile = BOARD_SPACES[player.position];
    const prop = this.properties[player.position];
    if (!tile || !prop || prop.ownerId) return { error: 'Property is already owned.' };
    if (player.cash < tile.price) return { error: `Not enough cash ($${tile.price} required).` };

    player.cash -= tile.price;
    player.stats.propertiesBought += 1;
    prop.ownerId = player.id;
    prop.mortgaged = false;
    prop.houses = 0;

    const completedMonopoly = tile.type === 'property' && this.ownsFullGroup(player.id, tile.group);
    if (completedMonopoly) {
      this.addLog(`${player.name} purchased ${tile.name} for $${tile.price} and completed the ${COLOR_GROUPS[tile.group].name} Monopoly!`, 'highlight');
    } else {
      this.addLog(`${player.name} purchased ${tile.name} for $${tile.price}.`, 'buy');
    }

    this.finishLandingPhase(player);
    return { ok: true, tileIndex: tile.index, completedMonopoly };
  }

  passProperty(playerId, skipAuction = false) {
    const player = this.getActivePlayer();
    if (!player || player.id !== playerId) return { error: 'Not your turn.' };
    if (this.phase !== 'BUY_DECISION') return { error: 'Not in buy decision phase.' };

    const tile = BOARD_SPACES[player.position];
    this.addLog(`${player.name} passed on buying ${tile.name}.`);

    if (this.houseRules.auctionsEnabled && !skipAuction) {
      this.startAuction(tile.index);
      return { ok: true, auctionStarted: true };
    }

    this.finishLandingPhase(player);
    return { ok: true };
  }

  /* ───────── Live Property Auctions ───────── */
  startAuction(tileIndex) {
    const tile = BOARD_SPACES[tileIndex];
    this.phase = 'AUCTION';
    this.activeAuction = {
      tileIndex,
      highestBid: Math.max(10, Math.floor(tile.price * 0.25)),
      highestBidderId: null,
      passedIds: [],
      deadline: Date.now() + 12000 // 12 seconds per bid
    };
    this.addLog(`🔨 AUCTION STARTED for ${tile.name} (Retail $${tile.price})! Opening bid: $${this.activeAuction.highestBid}.`, 'highlight');
  }

  placeAuctionBid(playerId, amount) {
    if (this.phase !== 'AUCTION' || !this.activeAuction) {
      return { error: 'No active auction.' };
    }
    const player = this.players.find(p => p.id === playerId && !p.bankrupt);
    if (!player) return { error: 'Invalid player.' };
    if (this.activeAuction.passedIds.includes(playerId)) {
      return { error: 'You already folded from this auction.' };
    }

    const bidAmount = Number(amount);
    const minRequired = this.activeAuction.highestBidderId
      ? this.activeAuction.highestBid + 10
      : this.activeAuction.highestBid;

    if (bidAmount < minRequired) {
      return { error: `Minimum bid is $${minRequired}.` };
    }
    if (player.cash < bidAmount) {
      return { error: 'You do not have enough cash for that bid.' };
    }

    this.activeAuction.highestBid = bidAmount;
    this.activeAuction.highestBidderId = player.id;
    this.activeAuction.deadline = Date.now() + 10000; // reset 10s hammer clock

    const tile = BOARD_SPACES[this.activeAuction.tileIndex];
    this.addLog(`🔨 ${player.name} bid $${bidAmount} for ${tile.name}!`, 'buy');
    this.checkAuctionCompletion();
    return { ok: true };
  }

  foldAuction(playerId) {
    if (this.phase !== 'AUCTION' || !this.activeAuction) {
      return { error: 'No active auction.' };
    }
    if (!this.activeAuction.passedIds.includes(playerId)) {
      this.activeAuction.passedIds.push(playerId);
      const p = this.players.find(pl => pl.id === playerId);
      if (p) this.addLog(`${p.name} folded from the auction.`);
    }
    this.checkAuctionCompletion();
    return { ok: true };
  }

  checkAuctionCompletion(forceExpire = false) {
    if (this.phase !== 'AUCTION' || !this.activeAuction) return null;

    const alive = this.players.filter(p => !p.bankrupt);
    const remainingBidders = alive.filter(p => !this.activeAuction.passedIds.includes(p.id));

    const shouldClose =
      forceExpire ||
      remainingBidders.length === 0 ||
      (remainingBidders.length === 1 && this.activeAuction.highestBidderId === remainingBidders[0].id);

    if (!shouldClose) return null;

    const { tileIndex, highestBid, highestBidderId } = this.activeAuction;
    const tile = BOARD_SPACES[tileIndex];
    const prop = this.properties[tileIndex];
    let result = { tileIndex, winnerId: null, price: 0, completedMonopoly: false };

    if (highestBidderId) {
      const winner = this.players.find(p => p.id === highestBidderId);
      if (winner && winner.cash >= highestBid) {
        winner.cash -= highestBid;
        winner.stats.propertiesBought += 1;
        prop.ownerId = winner.id;
        prop.mortgaged = false;
        prop.houses = 0;
        const completedMonopoly = tile.type === 'property' && this.ownsFullGroup(winner.id, tile.group);
        result = { tileIndex, winnerId: winner.id, price: highestBid, completedMonopoly };
        this.addLog(`🔨 SOLD! ${winner.name} won ${tile.name} at auction for $${highestBid}!`, 'highlight');
      }
    } else {
      this.addLog(`🔨 No bids placed for ${tile.name}. Property remains with the Bank.`);
    }

    this.activeAuction = null;
    const active = this.getActivePlayer();
    this.finishLandingPhase(active);
    this.refreshTurnDeadline();
    return result;
  }

  /* ───────── Player-to-Player Trading ───────── */
  proposeTrade(fromId, { toId, offerCash = 0, requestCash = 0, offerTiles = [], requestTiles = [] }) {
    if (this.phase === 'LOBBY' || this.phase === 'GAME_OVER') {
      return { error: 'Trading is only available during an active match.' };
    }
    const fromPlayer = this.players.find(p => p.id === fromId && !p.bankrupt);
    const toPlayer = this.players.find(p => p.id === toId && !p.bankrupt);
    if (!fromPlayer || !toPlayer || fromId === toId) {
      return { error: 'Invalid trade participants.' };
    }

    const cleanOfferCash = Math.max(0, Math.floor(Number(offerCash) || 0));
    const cleanRequestCash = Math.max(0, Math.floor(Number(requestCash) || 0));
    if (fromPlayer.cash < cleanOfferCash) return { error: 'You do not have enough cash for this offer.' };
    if (toPlayer.cash < cleanRequestCash) return { error: `${toPlayer.name} does not have $${cleanRequestCash}.` };

    const cleanOfferTiles = [...new Set(offerTiles.map(Number))];
    const cleanRequestTiles = [...new Set(requestTiles.map(Number))];

    if (cleanOfferCash === 0 && cleanRequestCash === 0 && cleanOfferTiles.length === 0 && cleanRequestTiles.length === 0) {
      return { error: 'Trade must include at least one city or cash amount.' };
    }

    // Validate ownership & ensure no houses exist on any group being traded
    for (const idx of cleanOfferTiles) {
      const prop = this.properties[idx];
      const tile = BOARD_SPACES[idx];
      if (!prop || prop.ownerId !== fromId) return { error: `You do not own ${tile?.name || 'that tile'}.` };
      if (tile.type === 'property') {
        const groupHasHouses = BOARD_SPACES.filter(t => t.group === tile.group).some(t => this.properties[t.index].houses > 0);
        if (groupHasHouses) return { error: `Sell all buildings in ${COLOR_GROUPS[tile.group].name} set before trading ${tile.name}.` };
      }
    }

    for (const idx of cleanRequestTiles) {
      const prop = this.properties[idx];
      const tile = BOARD_SPACES[idx];
      if (!prop || prop.ownerId !== toId) return { error: `${toPlayer.name} does not own ${tile?.name || 'that tile'}.` };
      if (tile.type === 'property') {
        const groupHasHouses = BOARD_SPACES.filter(t => t.group === tile.group).some(t => this.properties[t.index].houses > 0);
        if (groupHasHouses) return { error: `${toPlayer.name} has buildings in ${COLOR_GROUPS[tile.group].name} set.` };
      }
    }

    const trade = {
      id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fromId,
      toId,
      offerCash: cleanOfferCash,
      requestCash: cleanRequestCash,
      offerTiles: cleanOfferTiles,
      requestTiles: cleanRequestTiles,
      createdAt: Date.now()
    };

    this.activeTrades.push(trade);
    this.addLog(`🤝 ${fromPlayer.name} sent a trade offer to ${toPlayer.name}.`, 'info');
    return { ok: true, trade };
  }

  respondTrade(responderId, tradeId, accept) {
    const idx = this.activeTrades.findIndex(t => t.id === tradeId);
    if (idx === -1) return { error: 'Trade offer no longer exists.' };
    const trade = this.activeTrades[idx];

    if (responderId !== trade.toId && responderId !== trade.fromId) {
      return { error: 'Not authorized for this trade.' };
    }

    this.activeTrades.splice(idx, 1);
    const fromPlayer = this.players.find(p => p.id === trade.fromId);
    const toPlayer = this.players.find(p => p.id === trade.toId);

    if (!accept) {
      const actor = responderId === trade.fromId ? fromPlayer?.name : toPlayer?.name;
      this.addLog(`❌ ${actor || 'Player'} declined/canceled the trade offer.`, 'warn');
      return { ok: true, status: 'declined' };
    }

    if (responderId !== trade.toId) return { error: 'Only the recipient can accept the trade.' };
    if (!fromPlayer || !toPlayer || fromPlayer.bankrupt || toPlayer.bankrupt) {
      return { error: 'Player no longer active.' };
    }
    if (fromPlayer.cash < trade.offerCash || toPlayer.cash < trade.requestCash) {
      return { error: 'Cash balances changed; trade cannot be completed.' };
    }

    for (const tIdx of trade.offerTiles) {
      if (this.properties[tIdx]?.ownerId !== fromPlayer.id) return { error: 'Property ownership changed.' };
    }
    for (const tIdx of trade.requestTiles) {
      if (this.properties[tIdx]?.ownerId !== toPlayer.id) return { error: 'Property ownership changed.' };
    }

    // Execute swap
    fromPlayer.cash = fromPlayer.cash - trade.offerCash + trade.requestCash;
    toPlayer.cash = toPlayer.cash - trade.requestCash + trade.offerCash;

    for (const tIdx of trade.offerTiles) {
      this.properties[tIdx].ownerId = toPlayer.id;
    }
    for (const tIdx of trade.requestTiles) {
      this.properties[tIdx].ownerId = fromPlayer.id;
    }

    this.addLog(`🤝 TRADE COMPLETED between ${fromPlayer.name} and ${toPlayer.name}!`, 'highlight');
    return { ok: true, status: 'accepted', trade };
  }

  canBuildHouse(playerId, tileIndex) {
    const tile = BOARD_SPACES[tileIndex];
    const prop = this.properties[tileIndex];
    const player = this.players.find(p => p.id === playerId);
    if (!tile || tile.type !== 'property' || !prop || !player) return { ok: false, reason: 'Invalid property.' };
    if (prop.ownerId !== playerId) return { ok: false, reason: 'You do not own this property.' };
    if (prop.mortgaged) return { ok: false, reason: 'Property is mortgaged.' };
    if (prop.houses >= 5) return { ok: false, reason: 'Maximum hotel level reached.' };
    if (!this.ownsFullGroup(playerId, tile.group)) {
      return { ok: false, reason: 'Must own all unmortgaged properties in this color group.' };
    }
    if (player.cash < tile.houseCost) {
      return { ok: false, reason: `Need $${tile.houseCost} to build.` };
    }

    const groupProps = BOARD_SPACES
      .filter(t => t.group === tile.group)
      .map(t => this.properties[t.index]);
    const minHouses = Math.min(...groupProps.map(p => p.houses));
    if (prop.houses > minHouses) {
      return { ok: false, reason: 'Must build evenly across the color group.' };
    }

    return { ok: true };
  }

  buildHouse(playerId, tileIndex) {
    const active = this.getActivePlayer();
    if (!active || active.id !== playerId) return { error: 'You can only build on your turn.' };

    const check = this.canBuildHouse(playerId, tileIndex);
    if (!check.ok) return { error: check.reason };

    const tile = BOARD_SPACES[tileIndex];
    const prop = this.properties[tileIndex];
    active.cash -= tile.houseCost;
    prop.houses += 1;

    const label = prop.houses === 5 ? 'a Hotel' : `House #${prop.houses}`;
    this.addLog(`${active.name} built ${label} in ${tile.name} for $${tile.houseCost}.`, 'buy');
    return { ok: true, tileIndex, houses: prop.houses };
  }

  canSellHouse(playerId, tileIndex) {
    const tile = BOARD_SPACES[tileIndex];
    const prop = this.properties[tileIndex];
    if (!tile || tile.type !== 'property' || !prop) return { ok: false, reason: 'Invalid property.' };
    if (prop.ownerId !== playerId) return { ok: false, reason: 'You do not own this property.' };
    if (prop.houses <= 0) return { ok: false, reason: 'No houses to sell.' };

    const groupProps = BOARD_SPACES
      .filter(t => t.group === tile.group)
      .map(t => this.properties[t.index]);
    const maxHouses = Math.max(...groupProps.map(p => p.houses));
    if (prop.houses < maxHouses) {
      return { ok: false, reason: 'Must sell houses evenly across the color group.' };
    }

    return { ok: true };
  }

  sellHouse(playerId, tileIndex) {
    const active = this.getActivePlayer();
    if (!active || active.id !== playerId) return { error: 'You can only sell houses on your turn.' };

    const check = this.canSellHouse(playerId, tileIndex);
    if (!check.ok) return { error: check.reason };

    const tile = BOARD_SPACES[tileIndex];
    const prop = this.properties[tileIndex];
    const refund = Math.floor(tile.houseCost / 2);

    prop.houses -= 1;
    active.cash += refund;

    if (this.phase === 'DEBT_RESOLUTION' && active.cash >= 0) {
      this.phase = 'MANAGE_AND_END_TURN';
    }

    this.addLog(`${active.name} sold a building in ${tile.name} for $${refund}.`, 'cash');
    return { ok: true, tileIndex, houses: prop.houses };
  }

  mortgageProperty(playerId, tileIndex) {
    const active = this.getActivePlayer();
    if (!active || active.id !== playerId) return { error: 'Only allowed on your turn.' };

    const tile = BOARD_SPACES[tileIndex];
    const prop = this.properties[tileIndex];
    if (!tile || !prop || prop.ownerId !== playerId) return { error: 'You do not own this property.' };
    if (prop.mortgaged) return { error: 'Already mortgaged.' };

    if (tile.type === 'property') {
      const groupProps = BOARD_SPACES
        .filter(t => t.group === tile.group)
        .map(t => this.properties[t.index]);
      if (groupProps.some(p => p.houses > 0)) {
        return { error: 'Sell all houses in this color group before mortgaging.' };
      }
    }

    prop.mortgaged = true;
    active.cash += tile.mortgage;

    if (this.phase === 'DEBT_RESOLUTION' && active.cash >= 0) {
      this.phase = 'MANAGE_AND_END_TURN';
    }

    this.addLog(`${active.name} mortgaged ${tile.name} for $${tile.mortgage}.`, 'warn');
    return { ok: true, tileIndex };
  }

  unmortgageProperty(playerId, tileIndex) {
    const active = this.getActivePlayer();
    if (!active || active.id !== playerId) return { error: 'Only allowed on your turn.' };

    const tile = BOARD_SPACES[tileIndex];
    const prop = this.properties[tileIndex];
    if (!tile || !prop || prop.ownerId !== playerId) return { error: 'You do not own this property.' };
    if (!prop.mortgaged) return { error: 'Property is not mortgaged.' };

    const cost = Math.ceil(tile.mortgage * 1.1);
    if (active.cash < cost) return { error: `Need $${cost} (mortgage + 10% interest) to unmortgage.` };

    active.cash -= cost;
    prop.mortgaged = false;
    this.addLog(`${active.name} unmortgaged ${tile.name} for $${cost}.`, 'cash');
    return { ok: true, tileIndex };
  }

  declareBankruptcy(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || player.bankrupt) return { error: 'Invalid player.' };

    player.bankrupt = true;
    player.cash = 0;
    const creditor = this.players.find(p => p.id === player.creditorId && !p.bankrupt);

    for (const [idxStr, prop] of Object.entries(this.properties)) {
      if (prop.ownerId === player.id) {
        const tile = BOARD_SPACES[Number(idxStr)];
        if (prop.houses > 0 && tile.houseCost) {
          const liquidation = prop.houses * Math.floor(tile.houseCost / 2);
          if (creditor) creditor.cash += liquidation;
        }
        prop.houses = 0;
        if (creditor) {
          prop.ownerId = creditor.id;
        } else {
          prop.ownerId = null;
          prop.mortgaged = false;
        }
      }
    }

    if (creditor) {
      this.addLog(`${player.name} declared bankruptcy! All assets transferred to ${creditor.name}.`, 'warn');
    } else {
      this.addLog(`${player.name} declared bankruptcy! All properties returned to the Bank.`, 'warn');
    }

    this.recordWealthSnapshot();

    const alivePlayers = this.players.filter(p => !p.bankrupt);
    if (alivePlayers.length === 1) {
      this.winner = alivePlayers[0];
      this.phase = 'GAME_OVER';
      this.turnDeadline = null;
      this.addLog(`🏆 ${this.winner.name} has won the game of Monopoly!`, 'highlight');
      return { ok: true, gameOver: true, winner: this.winner };
    }

    this.advanceToNextPlayer();
    return { ok: true };
  }

  endTurn(playerId) {
    const player = this.getActivePlayer();
    if (!player || player.id !== playerId) return { error: 'Not your turn.' };

    if (player.cash < 0) {
      return { error: 'You are in debt! Sell houses, mortgage properties, or declare bankruptcy.' };
    }

    if (this.phase !== 'MANAGE_AND_END_TURN') {
      return { error: 'Complete your current action before ending your turn.' };
    }

    if (this.doublesCount > 0 && !player.inJail) {
      this.phase = 'WAIT_FOR_ROLL';
      this.refreshTurnDeadline();
      this.addLog(`${player.name} rolled doubles and gets another roll!`, 'highlight');
      return { ok: true, bonusTurn: true };
    }

    this.advanceToNextPlayer();
    return { ok: true };
  }

  advanceToNextPlayer() {
    this.doublesCount = 0;
    this.lastCard = null;
    this.recordWealthSnapshot();
    const total = this.players.length;

    for (let step = 1; step <= total; step++) {
      const candidateIdx = (this.activePlayerIndex + step) % total;
      if (!this.players[candidateIdx].bankrupt) {
        if (candidateIdx <= this.activePlayerIndex) {
          this.turnNumber += 1;
        }
        this.activePlayerIndex = candidateIdx;
        this.phase = 'WAIT_FOR_ROLL';
        this.refreshTurnDeadline();
        this.recordWealthSnapshot();
        const nextPlayer = this.players[candidateIdx];
        this.addLog(`Turn ${this.turnNumber}: ${nextPlayer.name}'s turn to roll.`, 'turn');
        return;
      }
    }
  }

  calculateNetWorth(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || player.bankrupt) return 0;
    let worth = player.cash;
    for (const [idxStr, prop] of Object.entries(this.properties)) {
      if (prop.ownerId === playerId) {
        const tile = BOARD_SPACES[Number(idxStr)];
        worth += prop.mortgaged ? tile.mortgage : tile.price;
        if (prop.houses > 0 && tile.houseCost) {
          worth += prop.houses * tile.houseCost;
        }
      }
    }
    return worth;
  }

  serialize() {
    return {
      roomCode: this.roomCode,
      hostId: this.hostId,
      phase: this.phase,
      turnNumber: this.turnNumber,
      activePlayerIndex: this.activePlayerIndex,
      activePlayerId: this.getActivePlayer()?.id || null,
      doublesCount: this.doublesCount,
      lastDice: this.lastDice,
      lastCard: this.lastCard,
      winner: this.winner,
      turnTimeLimit: this.turnTimeLimit,
      turnDeadline: this.turnDeadline,
      gameStartedAt: this.gameStartedAt,
      serverNow: Date.now(),
      houseRules: this.houseRules,
      freeParkingPot: this.freeParkingPot,
      activeAuction: this.activeAuction,
      activeTrades: this.activeTrades,
      wealthHistory: this.wealthHistory.slice(-40),
      spectatorCount: this.spectators.length,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        token: p.token,
        color: p.color,
        isBot: p.isBot,
        cash: p.cash,
        position: p.position,
        inJail: p.inJail,
        jailTurns: p.jailTurns,
        jailCards: p.jailCards,
        bankrupt: p.bankrupt,
        connected: p.connected,
        stats: p.stats,
        netWorth: this.calculateNetWorth(p.id)
      })),
      properties: this.properties,
      logs: this.logs.slice(-35)
    };
  }
}
