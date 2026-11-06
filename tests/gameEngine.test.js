import assert from 'node:assert/strict';
import { MonopolyGame } from '../server/gameEngine.js';

function runTests() {
  console.log('🧪 Running MonopolyGame Full Classic Rules Verification...');

  const game = new MonopolyGame('TEST99', 'p1');
  game.addPlayer({ id: 'p1', name: 'Rex', token: 'crown', isBot: false });
  game.addPlayer({ id: 'p2', name: 'Sterling', token: 'racecar', isBot: false });

  const startRes = game.startGame('p1');
  assert.equal(startRes.ok, true, 'Host should start the game');
  assert.equal(game.phase, 'WAIT_FOR_ROLL');

  // 1. Test rolling and landing on Mediterranean Ave (index 1) and buying it
  // Wait: min 2 dice is 1+1=2 (Community Chest), so let's test landing on Baltic Ave (index 3) via [1, 2]
  const roll1 = game.rollDice('p1', [1, 2]);
  assert.equal(roll1.ok, true);
  assert.equal(game.players[0].position, 3, 'Player 1 should land on Baltic Avenue (index 3)');
  assert.equal(game.phase, 'BUY_DECISION');

  const buy1 = game.buyProperty('p1');
  assert.equal(buy1.ok, true);
  assert.equal(game.properties[3].ownerId, 'p1');
  assert.equal(game.players[0].cash, 1500 - 60);
  assert.equal(game.phase, 'MANAGE_AND_END_TURN');

  game.endTurn('p1');
  assert.equal(game.getActivePlayer().id, 'p2', 'Turn should pass to Player 2');

  // 2. Test Player 2 landing on Player 1's Baltic Avenue and paying base rent ($4)
  game.rollDice('p2', [1, 2]);
  assert.equal(game.players[1].position, 3);
  assert.equal(game.players[1].cash, 1500 - 4, 'Player 2 should pay $4 rent');
  assert.equal(game.players[0].cash, 1440 + 4, 'Player 1 should receive $4 rent');
  game.endTurn('p2');

  // 3. Test Monopoly Completion & Even House Building
  // Give Player 1 Mediterranean Ave (index 1) as well to complete the Brown set
  game.properties[1].ownerId = 'p1';
  assert.equal(game.ownsFullGroup('p1', 'brown'), true, 'Player 1 should own full Brown monopoly');

  const build1 = game.buildHouse('p1', 1);
  assert.equal(build1.ok, true, 'Should build 1st house on Mediterranean');
  assert.equal(game.properties[1].houses, 1);

  const unevenBuild = game.buildHouse('p1', 1);
  assert.ok(unevenBuild.error, 'Even-build rule should block 2nd house on Mediterranean before Baltic has 1');

  const build2 = game.buildHouse('p1', 3);
  assert.equal(build2.ok, true, 'Should build 1st house on Baltic evenly');
  assert.equal(game.properties[3].houses, 1);

  // 4. Test Mortgage & Unmortgage
  game.sellHouse('p1', 1);
  game.sellHouse('p1', 3);
  const mortRes = game.mortgageProperty('p1', 1);
  assert.equal(mortRes.ok, true);
  assert.equal(game.properties[1].mortgaged, true);

  const unmortRes = game.unmortgageProperty('p1', 1);
  assert.equal(unmortRes.ok, true);
  assert.equal(game.properties[1].mortgaged, false);

  // 5. Test 3 Consecutive Doubles -> Go To Jail
  game.players[0].position = 0;
  game.players[0].inJail = false;
  game.doublesCount = 0;

  const rDouble1 = game.rollDice('p1', [1, 1]); // lands on index 2 (Community Chest)
  assert.equal(rDouble1.ok, true);
  if (game.phase === 'BUY_DECISION') game.passProperty('p1', true);
  if (!game.players[0].inJail) {
    game.endTurn('p1'); // Bonus turn 1
    const rDouble2 = game.rollDice('p1', [2, 2]);
    assert.equal(rDouble2.ok, true);
    if (game.phase === 'BUY_DECISION') game.passProperty('p1', true);
    game.endTurn('p1'); // Bonus turn 2

    const jailRoll = game.rollDice('p1', [4, 4]); // 3rd consecutive double!
    assert.equal(jailRoll.sentToJail, true, '3rd consecutive double must send player to Jail');
    assert.equal(game.players[0].inJail, true);
    assert.equal(game.players[0].position, 10);
  }

  // 6. Test Turn Timer configuration
  const timerRes = game.setTurnTimer('p1', 30);
  assert.equal(timerRes.ok, true);
  assert.equal(game.turnTimeLimit, 30);

  // 7. Test Live Property Auction flow (Pass -> Bid -> Fold -> Hammer)
  game.endTurn('p1'); // Now p2's turn
  const rollP2 = game.rollDice('p2', [3, 3]); // p2 from 3 -> 9 (Taipei, price $120)
  assert.equal(rollP2.ok, true);
  assert.equal(game.phase, 'BUY_DECISION');

  const passRes = game.passProperty('p2'); // Triggers AUCTION!
  assert.equal(passRes.ok, true);
  assert.equal(game.phase, 'AUCTION', 'Passing on unowned city should start live auction');
  assert.ok(game.activeAuction);
  assert.equal(game.activeAuction.tileIndex, 9);

  const bidRes = game.placeAuctionBid('p1', 50);
  assert.equal(bidRes.ok, true);
  assert.equal(game.activeAuction.highestBid, 50);
  assert.equal(game.activeAuction.highestBidderId, 'p1');

  const foldRes = game.foldAuction('p2');
  assert.equal(foldRes.ok, true);
  assert.equal(game.phase, 'MANAGE_AND_END_TURN', 'Auction should conclude when all other bidders fold');
  assert.equal(game.properties[9].ownerId, 'p1', 'Highest bidder p1 should win Taipei at auction');

  // 8. Test Player-to-Player Trading (Cash + Property Swap)
  const tradePropRes = game.proposeTrade('p1', {
    toId: 'p2',
    offerCash: 25,
    requestCash: 0,
    offerTiles: [9],
    requestTiles: []
  });
  assert.equal(tradePropRes.ok, true);
  const tradeId = tradePropRes.trade.id;

  const p2CashBefore = game.players[1].cash;
  const acceptRes = game.respondTrade('p2', tradeId, true);
  assert.equal(acceptRes.ok, true);
  assert.equal(game.properties[9].ownerId, 'p2', 'Taipei ownership should transfer to p2');
  assert.equal(game.players[1].cash, p2CashBefore + 25, 'p2 should receive $25 cash in trade');

  // 9. Test Session Token Reconnection (rebindPlayerId)
  game.rebindPlayerId('p1', 'p1_new_socket');
  assert.equal(game.hostId, 'p1_new_socket');
  assert.equal(game.properties[1].ownerId, 'p1_new_socket');

  // 10. Test Wealth History & Stats
  assert.ok(game.wealthHistory.length >= 2, 'Wealth history snapshots should be recorded across turns');
  assert.ok(game.players[0].stats.rentCollected >= 4, 'Rent collected stat should track rent income');

  console.log('✅ All MonopolyGame Engine tests (Classic + Auctions + Trading + Reconnect + Stats) passed!');
}

runTests();
