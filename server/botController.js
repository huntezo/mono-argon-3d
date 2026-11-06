import { BOARD_SPACES } from '../shared/boardData.js';

export class BotController {
  constructor(io) {
    this.io = io;
    this.timers = new Map();
  }

  scheduleCheck(game, broadcastState, emitRollAnimation) {
    if (!game || game.phase === 'LOBBY' || game.phase === 'GAME_OVER') return;

    // 1. Evaluate any pending trade offers sent to AI bots
    if (this.evaluatePendingBotTrades(game, broadcastState)) {
      return;
    }

    // 2. If an Auction is active, let AI bots place competitive bids or fold
    if (game.phase === 'AUCTION' && game.activeAuction) {
      const existing = this.timers.get(game.roomCode);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        this.executeAuctionStep(game, broadcastState, emitRollAnimation);
      }, 650);
      this.timers.set(game.roomCode, timer);
      return;
    }

    const active = game.getActivePlayer();
    if (!active || !active.isBot || active.bankrupt) return;

    const existing = this.timers.get(game.roomCode);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.executeStep(game, broadcastState, emitRollAnimation);
    }, 950);

    this.timers.set(game.roomCode, timer);
  }

  evaluatePendingBotTrades(game, broadcastState) {
    for (const trade of [...game.activeTrades]) {
      const toBot = game.players.find(p => p.id === trade.toId && p.isBot && !p.bankrupt);
      if (!toBot) continue;

      const offerPropVal = trade.offerTiles.reduce((sum, idx) => sum + (BOARD_SPACES[idx]?.price || 0), 0);
      const reqPropVal = trade.requestTiles.reduce((sum, idx) => sum + (BOARD_SPACES[idx]?.price || 0), 0);

      // Bonus value if offered tiles complete a color monopoly for the bot
      let monopolyBonusForBot = 0;
      for (const idx of trade.offerTiles) {
        const tile = BOARD_SPACES[idx];
        if (tile?.type === 'property') {
          const groupTiles = BOARD_SPACES.filter(t => t.group === tile.group);
          const botOwnedCount = groupTiles.filter(t => game.properties[t.index]?.ownerId === toBot.id || trade.offerTiles.includes(t.index)).length;
          if (botOwnedCount === groupTiles.length) monopolyBonusForBot += 140;
        }
      }

      // Penalty if requested tiles complete a color monopoly for the human proposer
      let monopolyRiskPenalty = 0;
      for (const idx of trade.requestTiles) {
        const tile = BOARD_SPACES[idx];
        if (tile?.type === 'property') {
          const groupTiles = BOARD_SPACES.filter(t => t.group === tile.group);
          const senderOwnedCount = groupTiles.filter(t => game.properties[t.index]?.ownerId === trade.fromId || trade.requestTiles.includes(t.index)).length;
          if (senderOwnedCount === groupTiles.length) monopolyRiskPenalty += 120;
        }
      }

      const incomingValue = trade.offerCash + offerPropVal + monopolyBonusForBot;
      const outgoingValue = trade.requestCash + reqPropVal + monopolyRiskPenalty;
      const shouldAccept = incomingValue >= outgoingValue * 0.95 && toBot.cash >= trade.requestCash;

      setTimeout(() => {
        game.respondTrade(toBot.id, trade.id, shouldAccept);
        broadcastState(game);
      }, 750);
      return true;
    }
    return false;
  }

  executeAuctionStep(game, broadcastState, emitRollAnimation) {
    if (game.phase !== 'AUCTION' || !game.activeAuction) return;
    const auction = game.activeAuction;
    const tile = BOARD_SPACES[auction.tileIndex];

    const bots = game.players.filter(
      p => p.isBot && !p.bankrupt && !auction.passedIds.includes(p.id) && p.id !== auction.highestBidderId
    );

    if (bots.length === 0) return;

    const bot = bots[Math.floor(Math.random() * bots.length)];
    const minNextBid = auction.highestBidderId ? auction.highestBid + 10 : auction.highestBid;

    // Bot valuation: up to 110% of retail price (or 145% if it completes their color set)
    const groupTiles = BOARD_SPACES.filter(t => t.group === tile.group);
    const ownedInGroup = groupTiles.filter(t => game.properties[t.index]?.ownerId === bot.id).length;
    const completesSet = tile.type === 'property' && ownedInGroup === groupTiles.length - 1;
    const maxWilling = Math.min(bot.cash - 50, Math.floor(tile.price * (completesSet ? 1.45 : 1.05)));

    if (minNextBid <= maxWilling && bot.cash >= minNextBid) {
      game.placeAuctionBid(bot.id, minNextBid);
    } else {
      game.foldAuction(bot.id);
    }

    broadcastState(game);
    this.scheduleCheck(game, broadcastState, emitRollAnimation);
  }

  executeStep(game, broadcastState, emitRollAnimation) {
    const bot = game.getActivePlayer();
    if (!bot || !bot.isBot || bot.bankrupt || game.phase === 'GAME_OVER') return;

    if (game.phase === 'WAIT_FOR_ROLL') {
      if (bot.inJail) {
        if (bot.jailCards > 0) {
          game.useJailCard(bot.id);
          broadcastState(game);
          this.scheduleCheck(game, broadcastState, emitRollAnimation);
          return;
        }
        if (bot.cash >= 250) {
          game.payJailFine(bot.id);
          broadcastState(game);
          this.scheduleCheck(game, broadcastState, emitRollAnimation);
          return;
        }
      }

      const rollRes = game.rollDice(bot.id);
      if (rollRes.ok) {
        emitRollAnimation(game, bot.id, rollRes);
      }
      broadcastState(game);
      const existing = this.timers.get(game.roomCode);
      if (existing) clearTimeout(existing);
      this.timers.set(
        game.roomCode,
        setTimeout(() => {
          this.executeStep(game, broadcastState, emitRollAnimation);
        }, 1600)
      );
      return;
    }

    if (game.phase === 'BUY_DECISION') {
      const tile = BOARD_SPACES[bot.position];
      if (tile && bot.cash >= tile.price && (bot.cash - tile.price >= 60 || tile.price <= 200)) {
        game.buyProperty(bot.id);
      } else {
        game.passProperty(bot.id);
      }
      broadcastState(game);
      this.scheduleCheck(game, broadcastState, emitRollAnimation);
      return;
    }

    if (game.phase === 'DEBT_RESOLUTION') {
      const resolved = this.tryRaiseFunds(game, bot);
      if (!resolved && bot.cash < 0) {
        game.declareBankruptcy(bot.id);
      }
      broadcastState(game);
      this.scheduleCheck(game, broadcastState, emitRollAnimation);
      return;
    }

    if (game.phase === 'MANAGE_AND_END_TURN') {
      for (const [idxStr, prop] of Object.entries(game.properties)) {
        if (prop.ownerId === bot.id && prop.mortgaged) {
          const tile = BOARD_SPACES[Number(idxStr)];
          const cost = Math.ceil(tile.mortgage * 1.1);
          if (bot.cash - cost >= 350) {
            game.unmortgageProperty(bot.id, Number(idxStr));
          }
        }
      }

      let builtSomething = false;
      for (const [idxStr, prop] of Object.entries(game.properties)) {
        const idx = Number(idxStr);
        const tile = BOARD_SPACES[idx];
        if (prop.ownerId === bot.id && tile.type === 'property') {
          if (bot.cash - tile.houseCost >= 250 && game.canBuildHouse(bot.id, idx).ok) {
            game.buildHouse(bot.id, idx);
            builtSomething = true;
            break;
          }
        }
      }

      if (builtSomething) {
        broadcastState(game);
        this.scheduleCheck(game, broadcastState, emitRollAnimation);
        return;
      }

      game.endTurn(bot.id);
      broadcastState(game);
      this.scheduleCheck(game, broadcastState, emitRollAnimation);
    }
  }

  tryRaiseFunds(game, bot) {
    for (const [idxStr, prop] of Object.entries(game.properties)) {
      if (bot.cash >= 0) return true;
      const idx = Number(idxStr);
      if (prop.ownerId === bot.id && !prop.mortgaged && prop.houses === 0) {
        const res = game.mortgageProperty(bot.id, idx);
        if (res.ok && bot.cash >= 0) return true;
      }
    }

    let sold = true;
    while (bot.cash < 0 && sold) {
      sold = false;
      for (const [idxStr, prop] of Object.entries(game.properties)) {
        const idx = Number(idxStr);
        if (prop.ownerId === bot.id && prop.houses > 0 && game.canSellHouse(bot.id, idx).ok) {
          game.sellHouse(bot.id, idx);
          sold = true;
          if (bot.cash >= 0) return true;
        }
      }
    }

    for (const [idxStr, prop] of Object.entries(game.properties)) {
      if (bot.cash >= 0) return true;
      const idx = Number(idxStr);
      if (prop.ownerId === bot.id && !prop.mortgaged && prop.houses === 0) {
        game.mortgageProperty(bot.id, idx);
      }
    }

    return bot.cash >= 0;
  }
}
