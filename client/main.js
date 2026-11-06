import { io } from 'socket.io-client';
import confetti from 'canvas-confetti';
import { BOARD_SPACES, COLOR_GROUPS, PLAYER_TOKENS, LIGHT_TEXT_GROUPS } from '@shared/boardData.js';
import { BoardScene } from './scene/BoardScene.js';

const TOKEN_EMOJI = {
  crown: '👑',
  racecar: '🏎️',
  tophat: '🎩',
  battleship: '🚢',
  obelisk: '🔮',
  aviator: '✈️'
};

const PIP_LAYOUT = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

/* ───────── Sound ───────── */
class SoundFX {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }

  ensureCtx() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  tone(freq, duration = 0.12, type = 'sine', gainVal = 0.12) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(gainVal, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  roll() {
    for (let i = 0; i < 5; i++) {
      setTimeout(() => this.tone(180 + Math.random() * 260, 0.05, 'triangle', 0.12), i * 70);
    }
  }

  buy() {
    this.tone(523.25, 0.1, 'sine', 0.14);
    setTimeout(() => this.tone(659.25, 0.14, 'sine', 0.16), 90);
    setTimeout(() => this.tone(783.99, 0.22, 'sine', 0.18), 190);
  }

  rent() {
    this.tone(320, 0.15, 'sawtooth', 0.08);
    setTimeout(() => this.tone(220, 0.25, 'sawtooth', 0.1), 140);
  }

  turn() {
    this.tone(880, 0.09, 'sine', 0.1);
    setTimeout(() => this.tone(1174, 0.16, 'sine', 0.1), 100);
  }

  error() {
    this.tone(200, 0.18, 'square', 0.06);
  }

  tick(urgent = false) {
    this.tone(urgent ? 980 : 660, 0.045, 'sine', urgent ? 0.11 : 0.06);
  }

  fanfare() {
    [523, 659, 784, 1046].forEach((f, idx) => setTimeout(() => this.tone(f, 0.25, 'triangle', 0.18), idx * 120));
  }
}

const sfx = new SoundFX();
const socket = io();

let myPlayerId = null;
let isSpectator = false;
let selectedToken = PLAYER_TOKENS[0].id;
let gameState = null;
let inspectedTileIndex = null;
let isAnimatingMovement = false;
let hudRevealed = false;
let lastActivePlayerId = null;
let gameOverShown = false;
let clockSkewMs = 0;
let lastBeepSecond = null;
const prevCash = new Map();
const cashDeltas = new Map(); // playerId -> { amount, at }

// Persistent session token for seamless reconnection
const SESSION_KEY = 'mono_argon_session_token';
const LAST_ROOM_KEY = 'mono_argon_last_room';
let sessionToken = localStorage.getItem(SESSION_KEY);
if (!sessionToken) {
  sessionToken = `tok_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
  localStorage.setItem(SESSION_KEY, sessionToken);
}

/* ───────── 3D scene ───────── */
const canvas = document.getElementById('board-canvas');
const tooltipEl = document.getElementById('tile-tooltip');
const boardScene = new BoardScene(
  canvas,
  (tileIndex) => {
    hideTooltip();
    openTileInspector(tileIndex);
  },
  (tileIndex, x, y) => {
    if (tileIndex === null) hideTooltip();
    else showTooltip(tileIndex, x, y);
  }
);
boardScene.setAutoRotate(true);

const LIGHT_GROUPS = LIGHT_TEXT_GROUPS;
const GROUP_ORDER = ['brown', 'lightBlue', 'pink', 'orange', 'red', 'yellow', 'green', 'darkBlue', 'railroad', 'utility'];

function tileAccent(tile) {
  if (COLOR_GROUPS[tile.group]) return COLOR_GROUPS[tile.group].hex;
  return { chance: '#e8590c', chest: '#1c7ed6', tax: '#b91c1c', go: '#d61f2c', gotojail: '#1b160d', jail: '#e8590c', parking: '#2b8a3e' }[tile.type] || '#334155';
}

function groupLabel(tile) {
  if (tile.type === 'property') {
    const country = tile.country ? `${tile.country.toUpperCase()} · ` : '';
    return `${country}${COLOR_GROUPS[tile.group].name.toUpperCase()} SET`;
  }
  if (tile.type === 'railroad') {
    return tile.country ? `${tile.country.toUpperCase()} · AIRPORT` : 'AIRPORT';
  }
  return { utility: 'UTILITY', tax: 'TAX', chance: 'CHANCE', chest: 'COMMUNITY CHEST' }[tile.type] || 'CORNER';
}

function ownsWholeGroup(playerId, group) {
  if (!gameState) return false;
  return BOARD_SPACES.filter(t => t.group === group).every(t => gameState.properties[t.index]?.ownerId === playerId);
}

function groupOwnedCount(playerId, group) {
  if (!gameState) return 0;
  return BOARD_SPACES.filter(t => t.group === group && gameState.properties[t.index]?.ownerId === playerId).length;
}

/** Rent a visitor would pay right now (string, because utilities depend on the dice). */
function currentRentText(tile, prop) {
  if (!prop?.ownerId) return null;
  if (prop.mortgaged) return '$0 (mortgaged)';
  if (tile.type === 'property') {
    if (prop.houses > 0) return `$${tile.rent[prop.houses]}`;
    return `$${ownsWholeGroup(prop.ownerId, tile.group) ? tile.rent[0] * 2 : tile.rent[0]}`;
  }
  if (tile.type === 'railroad') {
    const n = groupOwnedCount(prop.ownerId, 'railroad');
    return `$${tile.rent[Math.max(0, n - 1)]}`;
  }
  if (tile.type === 'utility') {
    return groupOwnedCount(prop.ownerId, 'utility') >= 2 ? '10× dice' : '4× dice';
  }
  return null;
}

function showTooltip(tileIndex, x, y) {
  const tile = BOARD_SPACES[tileIndex];
  if (!tile) return;
  const prop = gameState?.properties?.[tileIndex];
  const owner = prop?.ownerId ? gameState.players.find(p => p.id === prop.ownerId) : null;
  const dark = tile.type === 'property' && LIGHT_GROUPS.includes(tile.group);

  let rows = '';
  if (tile.price) {
    rows += `<div class="tt-row"><span>Price</span><strong class="gold">$${tile.price}</strong></div>`;
    rows += `<div class="tt-row"><span>Owner</span><strong>${owner
      ? `<i class="tt-dot" style="background:${owner.color}"></i>${escapeHtml(owner.name)}`
      : 'For sale'}</strong></div>`;
    if (owner) {
      rows += `<div class="tt-row"><span>Rent now</span><strong class="${prop.mortgaged ? 'red' : 'gold'}">${currentRentText(tile, prop)}</strong></div>`;
      if (tile.type === 'property' && prop.houses > 0) {
        rows += `<div class="tt-row"><span>Buildings</span><strong>${prop.houses === 5 ? '🏨 Hotel' : `🏠 × ${prop.houses}`}</strong></div>`;
      }
    } else if (tile.type === 'property') {
      rows += `<div class="tt-row"><span>Base rent</span><strong>$${tile.rent[0]}</strong></div>`;
    }
  } else if (tile.type === 'tax') {
    rows += `<div class="tt-row"><span>Pay</span><strong class="red">$${tile.taxAmount}</strong></div>`;
  } else {
    rows += `<div class="tt-desc">${tile.description || ''}</div>`;
  }

  const here = gameState?.players.filter(p => !p.bankrupt && p.position === tileIndex) || [];
  if (here.length) {
    rows += `<div class="tt-row"><span>Here</span><strong>${here.map(p => `<i class="tt-dot" style="background:${p.color}" title="${escapeHtml(p.name)}"></i>`).join('')}</strong></div>`;
  }

  tooltipEl.innerHTML = `
    <div class="tt-band ${dark ? 'dark-text' : ''}" style="--gc:${tileAccent(tile)}">
      <div class="tt-group">${groupLabel(tile)}</div>
      <div class="tt-name">${tile.name}</div>
    </div>
    <div class="tt-body">${rows}<div class="tt-foot">Click to open the full deed</div></div>`;

  tooltipEl.classList.remove('hidden');
  const w = 236;
  const h = tooltipEl.offsetHeight || 160;
  const left = x + 18 + w > window.innerWidth ? x - w - 18 : x + 18;
  const top = Math.min(Math.max(10, y - h / 2), window.innerHeight - h - 10);
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

function hideTooltip() {
  tooltipEl.classList.add('hidden');
}

/* ───────── Helpers ───────── */
function notify(message, type = 'info', duration = 3200) {
  const stack = document.getElementById('toast-stack');
  const el = document.createElement('div');
  const icon = { error: '⚠️', success: '✅', info: '✨' }[type] || '✨';
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
  stack.appendChild(el);
  if (type === 'error') sfx.error();
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function handleResponse(res) {
  if (res?.error) notify(res.error, 'error');
}

function renderDieFace(el, value) {
  el.innerHTML = '';
  el.classList.toggle('one', value === 1);
  const on = new Set(PIP_LAYOUT[value] || []);
  for (let i = 0; i < 9; i++) {
    const pip = document.createElement('span');
    pip.className = `pip ${on.has(i) ? 'on' : ''}`;
    el.appendChild(pip);
  }
}

function avatarHtml(token, color, size = '') {
  return `<span class="avatar ${size}" style="--pc:${color}">${TOKEN_EMOJI[token] || '♟️'}</span>`;
}

function formatMoney(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString()}`;
}

renderDieFace(document.getElementById('ui-die-1'), 1);
renderDieFace(document.getElementById('ui-die-2'), 1);

/* ───────── Lobby ───────── */
const tokenSelectorEl = document.getElementById('token-selector');
function renderTokenSelector() {
  tokenSelectorEl.innerHTML = '';
  for (const t of PLAYER_TOKENS) {
    const div = document.createElement('div');
    div.className = `token-option ${t.id === selectedToken ? 'selected' : ''}`;
    div.style.setProperty('--pc', t.color);
    div.innerHTML = `${avatarHtml(t.id, t.color)}<span>${t.name}</span>`;
    div.addEventListener('click', () => {
      selectedToken = t.id;
      renderTokenSelector();
    });
    tokenSelectorEl.appendChild(div);
  }
}
renderTokenSelector();

const lobbyModal = document.getElementById('lobby-modal');
const lobbyEntryView = document.getElementById('lobby-entry-view');
const lobbyWaitingView = document.getElementById('lobby-waiting-view');
const lobbyErrorEl = document.getElementById('lobby-error');
const waitingErrorEl = document.getElementById('waiting-error');

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
  sfx.error();
  setTimeout(() => el.classList.add('hidden'), 4500);
}

function copyRoomCode() {
  if (!gameState?.roomCode) return;
  navigator.clipboard?.writeText(gameState.roomCode);
  notify(`Room code ${gameState.roomCode} copied`, 'success', 2000);
}

// Pre-fill last room code if available for quick 1-click reconnect
const savedRoom = localStorage.getItem(LAST_ROOM_KEY);
if (savedRoom) {
  const joinInput = document.getElementById('join-code-input');
  if (joinInput) joinInput.value = savedRoom;
}

document.getElementById('btn-create-room').addEventListener('click', () => {
  const playerName = document.getElementById('player-name-input').value.trim() || 'Tycoon';
  socket.emit('CREATE_ROOM', { playerName, token: selectedToken, sessionToken }, (res) => {
    if (res?.error) return showError(lobbyErrorEl, res.error);
    myPlayerId = res.playerId;
    isSpectator = false;
    localStorage.setItem(LAST_ROOM_KEY, res.roomCode);
    enterWaitingRoom(res.state);
  });
});

function joinRoom() {
  const playerName = document.getElementById('player-name-input').value.trim() || 'Tycoon';
  const roomCode = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (!roomCode) return showError(lobbyErrorEl, 'Enter a 6-character room code.');
  socket.emit('JOIN_ROOM', { roomCode, playerName, token: selectedToken, sessionToken }, (res) => {
    if (res?.error) return showError(lobbyErrorEl, res.error);
    myPlayerId = res.playerId;
    isSpectator = Boolean(res.spectating);
    localStorage.setItem(LAST_ROOM_KEY, res.roomCode);
    if (res.reconnected) {
      notify('Reconnected! Reclaimed your tycoon seat & portfolio.', 'success', 3800);
    } else if (res.spectating) {
      notify('Joined match in progress as a Live Spectator 👁️', 'info', 4000);
    }
    if (res.state.phase === 'LOBBY') {
      enterWaitingRoom(res.state);
    }
  });
}

document.getElementById('btn-join-room').addEventListener('click', joinRoom);
document.getElementById('join-code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});

document.getElementById('btn-add-bot').addEventListener('click', () => {
  socket.emit('ADD_BOT', {}, (res) => {
    if (res?.error) showError(waitingErrorEl, res.error);
  });
});

document.getElementById('btn-start-game').addEventListener('click', () => {
  socket.emit('START_GAME', {}, (res) => {
    if (res?.error) showError(waitingErrorEl, res.error);
  });
});

document.getElementById('btn-copy-code').addEventListener('click', copyRoomCode);
document.getElementById('room-code-chip').addEventListener('click', copyRoomCode);

function enterWaitingRoom(state) {
  gameState = state;
  lobbyEntryView.classList.add('hidden');
  lobbyWaitingView.classList.remove('hidden');
  updateLobbyUI(state);
}

function updateLobbyUI(state) {
  document.getElementById('lobby-room-code').textContent = state.roomCode;
  document.getElementById('lobby-player-count').textContent = `${state.players.length}/6`;
  const listEl = document.getElementById('lobby-players-list');
  listEl.innerHTML = '';

  const isHost = state.hostId === myPlayerId;
  for (const p of state.players) {
    const row = document.createElement('div');
    row.className = 'lobby-player-row';
    const tokenMeta = PLAYER_TOKENS.find(t => t.id === p.token);
    const tags = [
      p.id === state.hostId ? '<span class="tag">HOST</span>' : '',
      p.id === myPlayerId ? '<span class="tag you">YOU</span>' : '',
      p.isBot ? '<span class="tag">AI</span>' : ''
    ].join('');
    row.innerHTML = `
      ${avatarHtml(p.token, p.color)}
      <div class="grow">
        <span class="player-name">${escapeHtml(p.name)} ${tags}</span>
        <span class="sub">${tokenMeta?.name || p.token}</span>
      </div>
      ${isHost && p.isBot ? `<button class="remove-bot-btn" data-bot="${p.id}" title="Remove bot">✕</button>` : ''}
    `;
    listEl.appendChild(row);
  }

  listEl.querySelectorAll('.remove-bot-btn').forEach(btn => {
    btn.addEventListener('click', () => socket.emit('REMOVE_BOT', { botId: btn.dataset.bot }));
  });

  document.getElementById('lobby-host-controls').classList.toggle('hidden', !isHost);
  document.getElementById('waiting-guest-msg').classList.toggle('hidden', isHost);
  document.getElementById('btn-start-game').disabled = state.players.length < 2;

  const limit = state.turnTimeLimit ?? 60;
  document.getElementById('lobby-timer-label').textContent = limit === 0 ? 'Unlimited time' : `${limit}s per turn`;
  document.querySelectorAll('#timer-options .timer-opt').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.sec) === limit);
    btn.disabled = !isHost;
  });

  // House Rules sync
  const rules = state.houseRules || { startingCash: 1500, freeParkingJackpot: true, doubleOnGo: false, auctionsEnabled: true };
  document.querySelectorAll('#cash-options .timer-opt').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.cash) === rules.startingCash);
    btn.disabled = !isHost;
  });
  const chkJackpot = document.getElementById('rule-jackpot');
  const chkDoubleGo = document.getElementById('rule-double-go');
  const chkAuctions = document.getElementById('rule-auctions');
  if (chkJackpot) { chkJackpot.checked = Boolean(rules.freeParkingJackpot); chkJackpot.disabled = !isHost; }
  if (chkDoubleGo) { chkDoubleGo.checked = Boolean(rules.doubleOnGo); chkDoubleGo.disabled = !isHost; }
  if (chkAuctions) { chkAuctions.checked = Boolean(rules.auctionsEnabled); chkAuctions.disabled = !isHost; }
}

document.querySelectorAll('#timer-options .timer-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    socket.emit('SET_TURN_TIMER', { seconds: Number(btn.dataset.sec) }, handleResponse);
  });
});

document.querySelectorAll('#cash-options .timer-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    socket.emit('SET_HOUSE_RULES', { startingCash: Number(btn.dataset.cash) }, handleResponse);
  });
});

['rule-jackpot', 'rule-double-go', 'rule-auctions'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => {
    socket.emit('SET_HOUSE_RULES', {
      freeParkingJackpot: document.getElementById('rule-jackpot').checked,
      doubleOnGo: document.getElementById('rule-double-go').checked,
      auctionsEnabled: document.getElementById('rule-auctions').checked
    }, handleResponse);
  });
});

/* ───────── Top bar controls ───────── */
document.querySelectorAll('.cam-btn[data-cam]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cam-btn[data-cam]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    boardScene.setCameraPreset(btn.dataset.cam, gameState?.activePlayerId);
  });
});

const soundToggleBtn = document.getElementById('sound-toggle-btn');
soundToggleBtn.addEventListener('click', () => {
  sfx.enabled = !sfx.enabled;
  soundToggleBtn.textContent = sfx.enabled ? '🔊' : '🔇';
  soundToggleBtn.classList.toggle('active', sfx.enabled);
});

const labelsToggleBtn = document.getElementById('labels-toggle-btn');
function toggleLabels() {
  const next = !boardScene.labelsVisible;
  boardScene.setLabelsVisible(next);
  labelsToggleBtn.classList.toggle('active', next);
}
labelsToggleBtn.addEventListener('click', toggleLabels);

// Flexible Responsive Drawers (Tycoons & Live Feed/Chat on tablet/mobile)
const playersSidebar = document.getElementById('players-sidebar');
const feedSidebar = document.getElementById('feed-sidebar');
const btnTogglePlayers = document.getElementById('btn-toggle-players');
const btnToggleFeed = document.getElementById('btn-toggle-feed');

function setPlayersDrawer(open) {
  playersSidebar.classList.toggle('drawer-open', open);
  btnTogglePlayers.classList.toggle('active', open);
  if (open) {
    feedSidebar.classList.remove('drawer-open');
    btnToggleFeed.classList.remove('active');
  }
}

function setFeedDrawer(open) {
  feedSidebar.classList.toggle('drawer-open', open);
  btnToggleFeed.classList.toggle('active', open);
  if (open) {
    playersSidebar.classList.remove('drawer-open');
    btnTogglePlayers.classList.remove('active');
  }
}

btnTogglePlayers.addEventListener('click', () => {
  setPlayersDrawer(!playersSidebar.classList.contains('drawer-open'));
});
btnToggleFeed.addEventListener('click', () => {
  setFeedDrawer(!feedSidebar.classList.contains('drawer-open'));
});
document.getElementById('close-players-drawer').addEventListener('click', () => setPlayersDrawer(false));
document.getElementById('close-feed-drawer').addEventListener('click', () => setFeedDrawer(false));

const portfolioModal = document.getElementById('portfolio-modal');
function openPortfolio() {
  renderPortfolio();
  portfolioModal.classList.remove('hidden');
}
function closePortfolio() {
  portfolioModal.classList.add('hidden');
}
document.getElementById('btn-portfolio').addEventListener('click', openPortfolio);
document.getElementById('portfolio-close').addEventListener('click', closePortfolio);
portfolioModal.addEventListener('click', (e) => {
  if (e.target === portfolioModal) closePortfolio();
});

/* ───────── Trade Center Modal ───────── */
const tradeModal = document.getElementById('trade-modal');
function openTradeModal() {
  renderTradeModal(true);
  tradeModal.classList.remove('hidden');
}
function closeTradeModal() {
  tradeModal.classList.add('hidden');
}
document.getElementById('btn-trade').addEventListener('click', openTradeModal);
document.getElementById('trade-close').addEventListener('click', closeTradeModal);
tradeModal.addEventListener('click', (e) => {
  if (e.target === tradeModal) closeTradeModal();
});
document.getElementById('trade-partner-select').addEventListener('change', () => renderTradeTileLists());
document.getElementById('btn-send-trade').addEventListener('click', () => {
  const toId = document.getElementById('trade-partner-select').value;
  if (!toId) return notify('Select a trade partner first', 'error');
  const offerCash = Math.max(0, Math.floor(Number(document.getElementById('trade-offer-cash').value) || 0));
  const requestCash = Math.max(0, Math.floor(Number(document.getElementById('trade-request-cash').value) || 0));
  const offerTiles = Array.from(document.querySelectorAll('#trade-offer-tiles input[type="checkbox"]:checked'))
    .map(cb => Number(cb.value));
  const requestTiles = Array.from(document.querySelectorAll('#trade-request-tiles input[type="checkbox"]:checked'))
    .map(cb => Number(cb.value));

  socket.emit('PROPOSE_TRADE', { toId, offerCash, requestCash, offerTiles, requestTiles }, (res) => {
    if (res?.error) return notify(res.error, 'error');
    notify('Trade proposal sent!', 'success', 2600);
    document.getElementById('trade-offer-cash').value = '0';
    document.getElementById('trade-request-cash').value = '0';
    renderTradeTileLists();
  });
});

/* ───────── Wealth Timeline & Match Awards Modal ───────── */
const statsModal = document.getElementById('stats-modal');
function openStatsModal() {
  renderStatsModal();
  statsModal.classList.remove('hidden');
}
function closeStatsModal() {
  statsModal.classList.add('hidden');
}
document.getElementById('btn-stats').addEventListener('click', openStatsModal);
document.getElementById('btn-gameover-stats')?.addEventListener('click', openStatsModal);
document.getElementById('stats-close').addEventListener('click', closeStatsModal);
statsModal.addEventListener('click', (e) => {
  if (e.target === statsModal) closeStatsModal();
});

/* ───────── Live Property Auction Controls ───────── */
document.querySelectorAll('#auction-actions .bid-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const inc = Number(btn.dataset.inc) || 10;
    const base = gameState?.activeAuction?.highestBid || 10;
    const amount = gameState?.activeAuction?.highestBidderId ? base + inc : Math.max(10, base);
    socket.emit('AUCTION_BID', { amount }, handleResponse);
  });
});
document.getElementById('btn-auction-fold').addEventListener('click', () => {
  socket.emit('AUCTION_FOLD', {}, handleResponse);
});

document.getElementById('offer-buy').addEventListener('click', () => socket.emit('BUY_PROPERTY', {}, handleResponse));
document.getElementById('offer-pass').addEventListener('click', () => socket.emit('PASS_PROPERTY', {}, handleResponse));

/* ───────── Gameplay actions ───────── */
const actionMap = {
  'btn-roll': 'ROLL_DICE',
  'btn-buy': 'BUY_PROPERTY',
  'btn-pass': 'PASS_PROPERTY',
  'btn-pay-jail': 'PAY_JAIL_FINE',
  'btn-use-card': 'USE_JAIL_CARD',
  'btn-end-turn': 'END_TURN'
};

for (const [id, evt] of Object.entries(actionMap)) {
  document.getElementById(id).addEventListener('click', () => socket.emit(evt, {}, handleResponse));
}

document.getElementById('btn-bankrupt').addEventListener('click', () => {
  if (confirm('Declare bankruptcy? You will be eliminated from the game.')) {
    socket.emit('DECLARE_BANKRUPTCY', {}, handleResponse);
  }
});

// Keyboard shortcuts: Space = roll / end turn, B = buy, P = pass, M = portfolio, T = trade, G = stats, L = names
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || !hudRevealed) return;
  const visible = (id) => !document.getElementById(id).classList.contains('hidden');
  const key = e.key.toLowerCase();
  if (e.code === 'Space') {
    e.preventDefault();
    if (visible('btn-roll')) document.getElementById('btn-roll').click();
    else if (visible('btn-end-turn')) document.getElementById('btn-end-turn').click();
  } else if (key === 'b' && visible('offer-card')) {
    document.getElementById('offer-buy').click();
  } else if (key === 'p' && visible('offer-card')) {
    document.getElementById('offer-pass').click();
  } else if (key === 'm') {
    visible('portfolio-modal') ? closePortfolio() : openPortfolio();
  } else if (key === 't') {
    visible('trade-modal') ? closeTradeModal() : openTradeModal();
  } else if (key === 'g') {
    visible('stats-modal') ? closeStatsModal() : openStatsModal();
  } else if (key === 'l') {
    toggleLabels();
  } else if (e.key === 'Escape') {
    closeTileInspector();
    closePortfolio();
    closeTradeModal();
    closeStatsModal();
  }
});

document.getElementById('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;
  socket.emit('SEND_CHAT', { message });
  input.value = '';
});

/* ───────── Socket events ───────── */
socket.on('STATE_UPDATE', (state) => {
  gameState = state;
  if (!myPlayerId) myPlayerId = socket.id;
  if (state.serverNow) {
    clockSkewMs = state.serverNow - Date.now();
  }

  // Track cash changes for floating +/- indicators
  for (const p of state.players) {
    const prev = prevCash.get(p.id);
    if (prev !== undefined && prev !== p.cash) {
      cashDeltas.set(p.id, { amount: p.cash - prev, at: Date.now() });
    }
    prevCash.set(p.id, p.cash);
  }

  if (state.phase === 'LOBBY') {
    updateLobbyUI(state);
    boardScene.syncState(state);
    return;
  }

  if (!hudRevealed) {
    hudRevealed = true;
    lobbyModal.classList.add('hidden');
    ['top-bar', 'players-sidebar', 'feed-sidebar', 'action-dock'].forEach(id =>
      document.getElementById(id).classList.remove('hidden'));
    boardScene.setAutoRotate(false);
    requestAnimationFrame(() => boardScene.setCameraPreset('overview'));
    notify('The match has begun — good luck!', 'success');
  }

  if (state.activePlayerId !== lastActivePlayerId) {
    lastActivePlayerId = state.activePlayerId;
    lastBeepSecond = null;
    if (state.activePlayerId === myPlayerId && state.phase !== 'GAME_OVER') {
      sfx.turn();
      notify("It's your turn! Press Space to roll.", 'info', 2600);
    }
  }

  if (!isAnimatingMovement) boardScene.syncState(state);
  renderHUD(state);

  if (inspectedTileIndex !== null) renderTileInspectorContent(inspectedTileIndex);
  if (!portfolioModal.classList.contains('hidden')) renderPortfolio();
  if (!tradeModal.classList.contains('hidden')) renderTradeModal(false);
  if (!statsModal.classList.contains('hidden')) renderStatsModal();

  if (state.phase === 'GAME_OVER' && state.winner && !gameOverShown) {
    gameOverShown = true;
    sfx.fanfare();
    const end = Date.now() + 2200;
    (function burst() {
      confetti({ particleCount: 6, angle: 60, spread: 60, origin: { x: 0 }, colors: ['#f5c451', '#ef2b3b', '#ffffff'] });
      confetti({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1 }, colors: ['#f5c451', '#ef2b3b', '#ffffff'] });
      if (Date.now() < end) requestAnimationFrame(burst);
    })();
    document.getElementById('winner-title').textContent = `${state.winner.name} wins!`;
    document.getElementById('winner-subtitle').textContent = `Final net worth: ${formatMoney(state.winner.netWorth ?? state.winner.cash)}`;
    document.getElementById('gameover-modal').classList.remove('hidden');
  }
});

socket.on('DICE_ROLLED', (payload) => {
  sfx.roll();
  const [d1, d2] = payload.dice;
  const die1 = document.getElementById('ui-die-1');
  const die2 = document.getElementById('ui-die-2');
  [die1, die2].forEach(el => {
    el.classList.remove('rolling');
    void el.offsetWidth;
    el.classList.add('rolling');
  });
  renderDieFace(die1, d1);
  renderDieFace(die2, d2);
  document.getElementById('ui-dice-sum').innerHTML =
    `${d1} + ${d2} = ${d1 + d2}${d1 === d2 ? '<span class="doubles">DOUBLES</span>' : ''}`;

  boardScene.rollDiceAnimation(d1, d2);

  if (payload.cardDrawn) setTimeout(() => showCardToast(payload.cardDrawn), 700);
  if (payload.events?.some(e => e.type === 'RENT')) setTimeout(() => sfx.rent(), 900);

  // Personal money notifications, delayed until the token has roughly arrived
  const nameOf = (id) => gameState?.players.find(p => p.id === id)?.name || 'someone';
  const steps = payload.stayedInJail ? 0 : ((payload.toPos - payload.fromPos + 40) % 40);
  const arriveDelay = 600 + Math.min(steps, 14) * 160;
  for (const ev of payload.events || []) {
    setTimeout(() => {
      if (ev.type === 'RENT' && ev.fromId === myPlayerId) {
        notify(`You paid $${ev.amount} rent to ${nameOf(ev.toId)} (${BOARD_SPACES[ev.tileIndex].name})`, 'error', 3800);
      } else if (ev.type === 'RENT' && ev.toId === myPlayerId) {
        notify(`${nameOf(ev.fromId)} paid you $${ev.amount} rent!`, 'success', 3800);
      } else if (ev.type === 'PASS_GO' && ev.playerId === myPlayerId) {
        notify(`Passed GO — collected $${ev.amount || 200}`, 'success', 2600);
      } else if (ev.type === 'JACKPOT') {
        sfx.buy();
        notify(`🎰 Free Parking Jackpot! ${nameOf(ev.playerId)} won $${ev.amount}!`, 'success', 4000);
      } else if (ev.type === 'TAX' && ev.playerId === myPlayerId) {
        notify(`Paid $${ev.amount} in tax`, 'error', 2800);
      } else if (ev.type === 'GOTO_JAIL' && ev.playerId === myPlayerId) {
        notify('Busted! You were sent to Jail.', 'error', 3200);
      }
    }, ev.type === 'PASS_GO' ? 700 : arriveDelay);
  }

  const mover = gameState?.players.find(p => p.id === payload.playerId);

  if (!payload.stayedInJail && payload.fromPos !== undefined) {
    isAnimatingMovement = true;
    setTimeout(() => {
      boardScene.animateTokenPath(
        payload.playerId,
        payload.fromPos,
        payload.toPos,
        payload.intermediatePos,
        payload.sentToJail,
        () => {
          isAnimatingMovement = false;
          boardScene.highlightTile(payload.toPos, mover?.color || '#f5c451');
          if (gameState) {
            boardScene.syncState(gameState);
            renderHUD(gameState);
          }
        }
      );
    }, 450);
  }
});

socket.on('PROPERTY_BOUGHT', ({ tileIndex, completedMonopoly, playerId }) => {
  sfx.buy();
  const buyer = gameState?.players.find(p => p.id === playerId);
  boardScene.highlightTile(tileIndex, buyer?.color || '#22c58b');
  if (completedMonopoly) {
    confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 }, colors: ['#f5c451', '#22c58b', '#ffffff'] });
    if (playerId === myPlayerId) notify('Monopoly complete! You can now build houses.', 'success', 4000);
  }
});

function showCardToast(card) {
  const toast = document.getElementById('card-toast');
  const tag = document.getElementById('card-toast-tag');
  const isChance = card.deckType === 'chance';
  const color = isChance ? '#f08c00' : '#1c7ed6';
  tag.textContent = isChance ? 'CHANCE' : 'COMMUNITY CHEST';
  tag.style.background = color;
  toast.style.setProperty('--deck-color', color);
  document.getElementById('card-toast-title').textContent = card.title;
  document.getElementById('card-toast-text').textContent = card.text;

  toast.classList.add('hidden');
  void toast.offsetWidth;
  toast.classList.remove('hidden');

  clearTimeout(toast.hideTimer);
  toast.hideTimer = setTimeout(() => toast.classList.add('hidden'), 4800);
}

/* ───────── HUD ───────── */
function renderHUD(state) {
  document.getElementById('room-code-display').textContent = state.roomCode;
  document.getElementById('turn-counter').textContent = state.turnNumber;

  const activePlayer = state.players.find(p => p.id === state.activePlayerId);
  const isMyTurn = state.activePlayerId === myPlayerId;
  const banner = document.getElementById('active-turn-banner');
  const bannerText = document.getElementById('turn-banner-text');
  const dot = document.getElementById('turn-dot');

  if (activePlayer) {
    const tileName = BOARD_SPACES[activePlayer.position]?.name || 'GO';
    bannerText.textContent = isMyTurn
      ? `Your turn · ${tileName}`
      : `${activePlayer.name}'s turn · ${tileName}`;
    dot.style.background = activePlayer.color;
    dot.style.color = activePlayer.color;
    banner.classList.toggle('my-turn', isMyTurn);
  }

  // Players
  document.getElementById('player-count-badge').textContent = `${state.players.filter(p => !p.bankrupt).length}/${state.players.length}`;
  const playersList = document.getElementById('players-list');
  playersList.innerHTML = '';

  for (const p of state.players) {
    const card = document.createElement('div');
    card.className = `player-card ${p.id === state.activePlayerId ? 'active-turn' : ''} ${p.bankrupt ? 'bankrupt' : ''}`;
    card.style.setProperty('--pc', p.color);

    const clustersHtml = GROUP_ORDER.map(grp => {
      const groupTiles = BOARD_SPACES.filter(t => t.group === grp);
      const ownedInGroup = groupTiles.filter(t => state.properties[t.index]?.ownerId === p.id);
      if (ownedInGroup.length === 0) return '';
      const isFullSet = ownedInGroup.length === groupTiles.length;
      const bg = COLOR_GROUPS[grp]?.hex || '#64748b';
      const slots = groupTiles.map(t => {
        const prop = state.properties[t.index];
        const isMine = prop?.ownerId === p.id;
        if (!isMine) {
          return `<span class="prop-pip empty" data-tile="${t.index}" title="${t.name} (Unowned/Rival)" style="--gc:${bg}"></span>`;
        }
        const badge = prop.houses === 5 ? 'H' : prop.houses > 0 ? prop.houses : '';
        return `<span class="prop-pip ${prop.mortgaged ? 'mortgaged' : ''}" data-tile="${t.index}" title="${t.name}${prop.mortgaged ? ' (mortgaged)' : ''}" style="background:${bg}">${badge}</span>`;
      }).join('');
      return `<div class="prop-cluster ${isFullSet ? 'complete-set' : ''}" title="${COLOR_GROUPS[grp]?.name || grp} (${ownedInGroup.length}/${groupTiles.length})">${slots}</div>`;
    }).join('');

    const currentTile = BOARD_SPACES[p.position];
    const location = p.bankrupt ? 'Bankrupt' : p.inJail ? 'In Jail' : currentTile.name;
    const tags = [
      p.id === myPlayerId ? '<span class="tag you">YOU</span>' : '',
      p.isBot ? '<span class="tag">AI</span>' : '',
      p.inJail && !p.bankrupt ? '<span class="tag jail">JAIL</span>' : '',
      p.jailCards > 0 ? `<span class="tag" title="Get Out of Jail Free cards">🎟️${p.jailCards}</span>` : '',
      !p.connected && !p.isBot ? '<span class="tag">OFFLINE</span>' : ''
    ].join('');

    let deltaHtml = '';
    const delta = cashDeltas.get(p.id);
    if (delta) {
      const elapsed = Date.now() - delta.at;
      if (elapsed < 2200) {
        deltaHtml = `<span class="cash-delta ${delta.amount > 0 ? 'up' : 'down'}" style="animation-delay:-${elapsed}ms">${delta.amount > 0 ? '+' : '−'}$${Math.abs(delta.amount)}</span>`;
      } else {
        cashDeltas.delete(p.id);
      }
    }

    card.innerHTML = `
      <div class="player-top">
        ${avatarHtml(p.token, p.color)}
        <div class="player-info">
          <div class="player-name">${escapeHtml(p.name)} ${tags}</div>
          <div class="player-location">📍 ${location}</div>
        </div>
        <div class="cash-col">
          ${deltaHtml}
          <div class="player-cash ${p.cash < 0 ? 'negative' : ''}">${formatMoney(p.cash)}</div>
          <div class="player-networth">NET ${formatMoney(p.netWorth)}</div>
        </div>
      </div>
      <div class="owned-pips">${clustersHtml || '<span class="no-props-hint">No deeds owned yet</span>'}</div>
    `;

    card.querySelectorAll('.prop-pip').forEach(pip => {
      pip.addEventListener('click', (e) => {
        e.stopPropagation();
        openTileInspector(Number(pip.dataset.tile));
      });
    });

    playersList.appendChild(card);
  }

  // Feed
  const logEl = document.getElementById('event-log');
  const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 80;
  logEl.innerHTML = '';
  for (const item of state.logs) {
    const div = document.createElement('div');
    div.className = `log-item ${item.type || 'info'}`;
    div.innerHTML = `<span class="log-time">${item.timestamp}</span>${escapeHtml(item.text)}`;
    logEl.appendChild(div);
  }
  if (nearBottom || logEl.scrollTop === 0) logEl.scrollTop = logEl.scrollHeight;

  // Actions
  const ids = ['btn-roll', 'btn-buy', 'btn-pass', 'btn-pay-jail', 'btn-use-card', 'btn-bankrupt', 'btn-end-turn'];
  const btn = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  ids.forEach(id => btn[id].classList.add('hidden'));
  btn['btn-roll'].classList.remove('pulse');

  const waitingHint = document.getElementById('waiting-hint');
  let anyAction = false;

  if (isMyTurn && activePlayer && !activePlayer.bankrupt && !isAnimatingMovement) {
    const currentTile = BOARD_SPACES[activePlayer.position];
    const show = (id) => { btn[id].classList.remove('hidden'); anyAction = true; };

    if (state.phase === 'WAIT_FOR_ROLL') {
      show('btn-roll');
      btn['btn-roll'].classList.add('pulse');
      btn['btn-roll'].textContent = state.doublesCount > 0 ? '🎲 Roll Again (Doubles!)' : '🎲 Roll Dice';
      if (activePlayer.inJail) {
        if (activePlayer.cash >= 50) show('btn-pay-jail');
        if (activePlayer.jailCards > 0) show('btn-use-card');
      }
    } else if (state.phase === 'BUY_DECISION') {
      anyAction = true;
      waitingHint.classList.remove('hidden');
      waitingHint.textContent = `Buy ${currentTile.name}?  ↑`;
      renderOffer(activePlayer, currentTile);
    } else if (state.phase === 'MANAGE_AND_END_TURN') {
      show('btn-end-turn');
      btn['btn-end-turn'].textContent = state.doublesCount > 0 && !activePlayer.inJail
        ? '🎲 Take Bonus Roll'
        : '✅ End Turn';
    } else if (state.phase === 'DEBT_RESOLUTION') {
      show('btn-bankrupt');
      waitingHint.classList.remove('hidden');
      waitingHint.textContent = `In debt ${formatMoney(activePlayer.cash)} — sell or mortgage via tiles`;
    }
  }

  if (!anyAction) {
    waitingHint.classList.remove('hidden');
    waitingHint.textContent = isAnimatingMovement
      ? 'Moving…'
      : activePlayer ? `Waiting for ${activePlayer.name}…` : 'Waiting…';
  } else if ((state.phase !== 'DEBT_RESOLUTION' && state.phase !== 'BUY_DECISION') || !isMyTurn) {
    waitingHint.classList.add('hidden');
  }

  // Offer card only lives during my buy decision
  const offerVisible = isMyTurn && state.phase === 'BUY_DECISION' && !isAnimatingMovement;
  document.getElementById('offer-card').classList.toggle('hidden', !offerVisible);

  // Portfolio count badge
  const mine = Object.values(state.properties).filter(p => p.ownerId === myPlayerId).length;
  document.getElementById('portfolio-count').textContent = mine;

  // Free Parking Jackpot & Spectator chips
  const jackpotChip = document.getElementById('jackpot-chip');
  if (jackpotChip) {
    const showPot = Boolean(state.houseRules?.freeParkingJackpot);
    jackpotChip.classList.toggle('hidden', !showPot);
    if (showPot) {
      document.getElementById('jackpot-amount').textContent = formatMoney(state.freeParkingPot ?? 0);
    }
  }
  const specChip = document.getElementById('spectator-chip');
  if (specChip) {
    const specCount = state.spectatorCount || 0;
    specChip.classList.toggle('hidden', specCount === 0);
    document.getElementById('spectator-count').textContent = specCount;
  }

  // Incoming Trade badge
  const incomingTrades = (state.activeTrades || []).filter(t => t.toId === myPlayerId);
  const tradeCountEl = document.getElementById('trade-count');
  if (tradeCountEl) {
    tradeCountEl.textContent = incomingTrades.length;
    tradeCountEl.classList.toggle('hidden', incomingTrades.length === 0);
  }

  // Live Auction Modal
  renderAuctionModal(state);
}

function renderAuctionModal(state) {
  const modal = document.getElementById('auction-modal');
  if (!modal) return;
  const auc = state.activeAuction;
  if (state.phase !== 'AUCTION' || !auc || isAnimatingMovement) {
    modal.classList.add('hidden');
    return;
  }
  modal.classList.remove('hidden');

  const tile = BOARD_SPACES[auc.tileIndex];
  const groupInfo = COLOR_GROUPS[tile.group];
  const band = document.getElementById('auction-band');
  band.style.background = tile.type === 'property' && groupInfo
    ? `linear-gradient(180deg, ${groupInfo.lightHex}, ${groupInfo.hex})`
    : '#1b160d';
  band.classList.toggle('dark-text', tile.type === 'property' && LIGHT_GROUPS.includes(tile.group));

  document.getElementById('auction-title').textContent = `${tile.landmark ? `${tile.landmark} ` : ''}${tile.name}`;
  document.getElementById('auction-sub').textContent = `Retail Price: $${tile.price} · ${tile.country || 'Global Asset'}`;
  document.getElementById('auction-price').textContent = formatMoney(auc.highestBid);

  const leader = auc.highestBidderId ? state.players.find(p => p.id === auc.highestBidderId) : null;
  document.getElementById('auction-leader').textContent = leader
    ? `👑 Held by ${leader.name}${leader.id === myPlayerId ? ' (You)' : ''}`
    : 'No bids placed yet — starts at $10';

  const me = state.players.find(p => p.id === myPlayerId);
  const folded = (auc.foldedIds || []).includes(myPlayerId);
  const canAct = Boolean(me && !me.bankrupt && !folded && !isSpectator);

  document.querySelectorAll('#auction-actions .bid-btn').forEach(btn => {
    const inc = Number(btn.dataset.inc) || 10;
    const nextBid = auc.highestBidderId ? auc.highestBid + inc : Math.max(10, auc.highestBid);
    btn.textContent = auc.highestBidderId ? `+$${inc} ($${nextBid})` : `Bid $${nextBid}`;
    btn.disabled = !canAct || me.cash < nextBid;
  });
  const foldBtn = document.getElementById('btn-auction-fold');
  if (foldBtn) {
    foldBtn.disabled = !canAct || auc.highestBidderId === myPlayerId;
    foldBtn.textContent = folded ? 'Folded' : 'Fold';
  }
}

function renderTradeModal(resetPartner = false) {
  if (!gameState) return;
  const incomingBox = document.getElementById('incoming-trades-box');
  const trades = (gameState.activeTrades || []).filter(t => t.toId === myPlayerId || t.fromId === myPlayerId);

  const describeOffer = (cash, tiles) => {
    const parts = [];
    if (cash > 0) parts.push(`$${cash}`);
    for (const idx of tiles || []) {
      const t = BOARD_SPACES[idx];
      if (t) parts.push(`${t.landmark || ''} ${t.name}`.trim());
    }
    return parts.length ? parts.join(' + ') : 'Nothing';
  };

  incomingBox.innerHTML = trades.map(tr => {
    const fromP = gameState.players.find(p => p.id === tr.fromId);
    const toP = gameState.players.find(p => p.id === tr.toId);
    const isIncoming = tr.toId === myPlayerId;
    return `
      <div class="incoming-trade-item">
        <div class="incoming-trade-desc">
          <strong>${escapeHtml(fromP?.name || 'Player')} → ${escapeHtml(toP?.name || 'Player')}</strong>
          <span>Offers <b>${escapeHtml(describeOffer(tr.offerCash, tr.offerTiles))}</b> for <b>${escapeHtml(describeOffer(tr.requestCash, tr.requestTiles))}</b></span>
        </div>
        <div class="pf-actions">
          ${isIncoming
            ? `<button class="mini-btn build" data-trade="${tr.id}" data-act="accept">Accept</button>
               <button class="mini-btn sell" data-trade="${tr.id}" data-act="decline">Decline</button>`
            : `<button class="mini-btn" data-trade="${tr.id}" data-act="decline">Cancel</button>`}
        </div>
      </div>`;
  }).join('');

  incomingBox.querySelectorAll('button[data-trade]').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('RESPOND_TRADE', {
        tradeId: btn.dataset.trade,
        accept: btn.dataset.act === 'accept'
      }, handleResponse);
    });
  });

  const select = document.getElementById('trade-partner-select');
  const prevVal = select.value;
  const rivals = gameState.players.filter(p => p.id !== myPlayerId && !p.bankrupt);
  select.innerHTML = rivals.map(p =>
    `<option value="${p.id}">${escapeHtml(p.name)} (${formatMoney(p.cash)}${p.isBot ? ' · AI' : ''})</option>`
  ).join('');
  if (!resetPartner && prevVal && rivals.some(r => r.id === prevVal)) {
    select.value = prevVal;
  }
  renderTradeTileLists();
}

function renderTradeTileLists() {
  if (!gameState) return;
  const partnerId = document.getElementById('trade-partner-select').value;
  const offerList = document.getElementById('trade-offer-tiles');
  const reqList = document.getElementById('trade-request-tiles');

  const isTradable = (prop) => {
    const t = BOARD_SPACES[prop.index];
    if (!t) return false;
    if (t.type === 'property') {
      const groupHasBuildings = BOARD_SPACES
        .filter(sp => sp.group === t.group)
        .some(sp => (gameState.properties[sp.index]?.houses || 0) > 0);
      if (groupHasBuildings) return false;
    }
    return true;
  };

  const renderCheckList = (ownerId, container) => {
    const props = Object.values(gameState.properties)
      .filter(p => p.ownerId === ownerId && isTradable(p))
      .sort((a, b) => a.index - b.index);
    if (!props.length) {
      container.innerHTML = `<div class="pf-meta">No tradable unimproved properties</div>`;
      return;
    }
    container.innerHTML = props.map(p => {
      const t = BOARD_SPACES[p.index];
      const dotColor = COLOR_GROUPS[t.group]?.hex || '#64748b';
      return `
        <label class="trade-tile-check">
          <input type="checkbox" value="${p.index}" />
          <span class="tt-dot" style="background:${dotColor}"></span>
          <span>${t.landmark ? `${t.landmark} ` : ''}${escapeHtml(t.name)} ($${t.price})</span>
        </label>`;
    }).join('');
  };

  renderCheckList(myPlayerId, offerList);
  renderCheckList(partnerId, reqList);
}

function renderStatsModal() {
  if (!gameState) return;
  const canvasEl = document.getElementById('wealth-chart-canvas');
  if (canvasEl) {
    const ctx = canvasEl.getContext('2d');
    const W = canvasEl.width;
    const H = canvasEl.height;
    ctx.clearRect(0, 0, W, H);

    const history = gameState.wealthHistory || [];
    const padL = 56, padR = 20, padT = 24, padB = 30;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    let maxVal = 2000;
    for (const snap of history) {
      for (const p of gameState.players) {
        if ((snap.values?.[p.id] || 0) > maxVal) maxVal = snap.values[p.id];
      }
    }
    maxVal = Math.ceil(maxVal / 500) * 500;

    // Grid lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 11px Inter, sans-serif';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      const val = Math.round(maxVal * (1 - i / 4));
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.fillText(`$${val}`, 8, y + 4);
    }

    // Player wealth lines
    for (const p of gameState.players) {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      history.forEach((snap, idx) => {
        const x = padL + (history.length <= 1 ? plotW / 2 : (idx / (history.length - 1)) * plotW);
        const val = Math.max(0, snap.values?.[p.id] ?? 0);
        const y = padT + plotH - (val / maxVal) * plotH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Legend dot at top
      const pIdx = gameState.players.indexOf(p);
      const lx = padL + pIdx * 95;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(lx, 11, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(p.name.slice(0, 10), lx + 8, 15);
    }
  }

  // Match Awards Grid
  const awardsEl = document.getElementById('stats-awards-grid');
  if (!awardsEl) return;
  const topBy = (fn) => {
    const sorted = [...gameState.players].sort((a, b) => fn(b) - fn(a));
    return sorted[0];
  };
  const rentWinner = topBy(p => p.stats?.rentCollected || 0);
  const mogulWinner = topBy(p => Object.values(gameState.properties).filter(pr => pr.ownerId === p.id).length);
  const luckyWinner = topBy(p => p.stats?.doublesRolled || 0);
  const jailWinner = topBy(p => p.stats?.timesInJail || 0);

  const cards = [
    {
      label: '💰 RENT TYCOON',
      winner: rentWinner?.name || '—',
      sub: `${formatMoney(rentWinner?.stats?.rentCollected || 0)} rent collected`
    },
    {
      label: '🏙️ REAL ESTATE MOGUL',
      winner: mogulWinner?.name || '—',
      sub: `${Object.values(gameState.properties).filter(pr => pr.ownerId === mogulWinner?.id).length} world deeds owned`
    },
    {
      label: '🎲 LUCKY ROLLER',
      winner: luckyWinner?.name || '—',
      sub: `${luckyWinner?.stats?.doublesRolled || 0} doubles rolled`
    },
    {
      label: '🚔 MOST WANTED',
      winner: jailWinner?.name || '—',
      sub: `${jailWinner?.stats?.timesInJail || 0} trips to Jail`
    }
  ];

  awardsEl.innerHTML = cards.map(c => `
    <div class="award-card">
      <div class="award-label">${c.label}</div>
      <div class="award-winner">${escapeHtml(c.winner)}</div>
      <div class="award-sub">${escapeHtml(c.sub)}</div>
    </div>
  `).join('');
}

function renderOffer(player, tile) {
  const card = document.getElementById('offer-card');
  const band = document.getElementById('offer-band');
  const accent = tileAccent(tile);
  const groupInfo = COLOR_GROUPS[tile.group];
  band.style.background = tile.type === 'property'
    ? `linear-gradient(180deg, ${groupInfo.lightHex}, ${groupInfo.hex})`
    : '#1b160d';
  band.classList.toggle('dark-text', tile.type === 'property' && LIGHT_GROUPS.includes(tile.group));
  document.getElementById('offer-title').textContent = tile.name;

  const after = player.cash - tile.price;
  const affordable = after >= 0;

  // Set progress: which members of this group I already own
  const members = BOARD_SPACES.filter(t => t.group === tile.group);
  const ownedNow = members.filter(t => gameState.properties[t.index]?.ownerId === player.id).length;
  const progress = members.map(t => {
    const cls = t.index === tile.index ? 'this' : gameState.properties[t.index]?.ownerId === player.id ? 'mine' : '';
    return `<i class="${cls}" title="${t.name}"></i>`;
  }).join('');
  const completes = ownedNow + 1 === members.length;
  const groupName = tile.type === 'property' ? groupInfo.name : tile.type === 'railroad' ? 'railroads' : 'utilities';

  let rentRows = '';
  if (tile.type === 'property') {
    rentRows = `
      <div class="offer-row"><span>Base rent</span><strong>$${tile.rent[0]}</strong></div>
      <div class="offer-row"><span>With full set</span><strong>$${tile.rent[0] * 2}</strong></div>
      <div class="offer-row"><span>With hotel</span><strong>$${tile.rent[5]}</strong></div>`;
  } else if (tile.type === 'railroad') {
    rentRows = `<div class="offer-row"><span>Rent if you buy</span><strong>$${tile.rent[ownedNow]}</strong></div>`;
  } else {
    rentRows = `<div class="offer-row"><span>Rent if you buy</span><strong>${ownedNow + 1 >= 2 ? '10×' : '4×'} dice</strong></div>`;
  }

  document.getElementById('offer-body').innerHTML = `
    <div class="set-progress" style="--gc:${accent}">${progress}</div>
    <div class="set-caption ${completes ? 'hot' : ''}">
      ${completes ? `🔥 Completes your ${groupName} set!` : `You'd own ${ownedNow + 1} of ${members.length} ${groupName}`}
    </div>
    ${rentRows}
    <div class="offer-row big"><span>Your cash after</span><strong class="${affordable ? 'pos' : 'neg'}">${formatMoney(after)}</strong></div>`;

  const buyBtn = document.getElementById('offer-buy');
  buyBtn.disabled = !affordable;
  buyBtn.innerHTML = affordable
    ? `Buy · $${tile.price} <kbd>B</kbd>`
    : `Not enough cash`;
  card.style.setProperty('--gc', accent);
}

function renderPortfolio() {
  if (!gameState) return;
  const me = gameState.players.find(p => p.id === myPlayerId);
  const body = document.getElementById('portfolio-body');
  const isMyTurn = gameState.activePlayerId === myPlayerId && !me?.bankrupt;
  const owned = Object.values(gameState.properties).filter(p => p.ownerId === myPlayerId);

  const houses = owned.reduce((n, p) => n + (p.houses > 0 && p.houses < 5 ? p.houses : 0), 0);
  const hotels = owned.filter(p => p.houses === 5).length;
  document.getElementById('portfolio-summary').innerHTML = me
    ? `Cash <b>${formatMoney(me.cash)}</b> · Net worth <b>${formatMoney(me.netWorth)}</b> · ${owned.length} properties · ${houses} houses · ${hotels} hotels`
    : '';
  document.getElementById('portfolio-note').textContent = isMyTurn
    ? 'Build evenly across a complete set. Mortgaging gives 50% of the price; unmortgaging costs +10%.'
    : 'You can build, sell and mortgage during your own turn.';

  if (!owned.length) {
    body.innerHTML = `<div class="pf-empty"><span class="big">🏚️</span>You don't own any properties yet.<br/>Land on an unowned tile and buy it!</div>`;
    return;
  }

  body.innerHTML = '';
  for (const group of GROUP_ORDER) {
    const members = BOARD_SPACES.filter(t => t.group === group);
    const mineInGroup = members.filter(t => gameState.properties[t.index]?.ownerId === myPlayerId);
    if (!mineInGroup.length) continue;

    const info = COLOR_GROUPS[group];
    const fullSet = mineInGroup.length === members.length;
    const groupEl = document.createElement('div');
    groupEl.className = 'pf-group';
    groupEl.style.setProperty('--gc', info.hex);
    groupEl.innerHTML = `
      <div class="pf-group-head">
        <span class="pf-group-name">${info.name}${group === 'railroad' || group === 'utility' ? 's' : ''}</span>
        ${fullSet ? '<span class="pf-set-badge">FULL SET</span>' : ''}
        <span class="pf-group-count">${mineInGroup.length}/${members.length}</span>
      </div>`;

    for (const tile of mineInGroup) {
      const prop = gameState.properties[tile.index];
      const row = document.createElement('div');
      row.className = 'pf-row';

      let houseIcons = '';
      if (prop.houses === 5) houseIcons = '<span class="pf-houses"><i class="hotel"></i></span> Hotel';
      else if (prop.houses > 0) houseIcons = `<span class="pf-houses">${'<i></i>'.repeat(prop.houses)}</span> ${prop.houses} house${prop.houses > 1 ? 's' : ''}`;

      row.innerHTML = `
        <div>
          <div class="pf-name" data-tile="${tile.index}">${tile.name}</div>
          <div class="pf-meta">
            ${prop.mortgaged ? '<span class="mort">MORTGAGED</span>' : houseIcons || `Price $${tile.price}`}
          </div>
        </div>
        <div class="pf-rent">Rent<strong>${currentRentText(tile, prop)}</strong></div>
        <div class="pf-actions"></div>`;

      const actionsEl = row.querySelector('.pf-actions');
      const addMini = (label, cls, evt, enabled, title) => {
        const b = document.createElement('button');
        b.className = `mini-btn ${cls}`;
        b.textContent = label;
        b.title = title;
        b.disabled = !enabled;
        b.addEventListener('click', () => socket.emit(evt, { tileIndex: tile.index }, handleResponse));
        actionsEl.appendChild(b);
      };

      if (tile.type === 'property') {
        const canBuild = isMyTurn && fullSet && !prop.mortgaged && prop.houses < 5 && me.cash >= tile.houseCost
          && !mineInGroup.some(t => gameState.properties[t.index].mortgaged);
        addMini(prop.houses === 4 ? '+🏨' : '+🏠', 'build', 'BUILD_HOUSE', canBuild,
          fullSet ? `Build for $${tile.houseCost}` : 'Own the full set to build');
        addMini('−🏠', 'sell', 'SELL_HOUSE', isMyTurn && prop.houses > 0, `Sell for $${Math.floor(tile.houseCost / 2)}`);
      }

      const groupHasHouses = tile.type === 'property' && members.some(t => gameState.properties[t.index].houses > 0);
      if (prop.mortgaged) {
        const cost = Math.ceil(tile.mortgage * 1.1);
        addMini(`Unmortgage $${cost}`, 'unmort', 'UNMORTGAGE_PROPERTY', isMyTurn && me.cash >= cost, 'Lift the mortgage');
      } else {
        addMini(`Mortgage +$${tile.mortgage}`, '', 'MORTGAGE_PROPERTY', isMyTurn && !groupHasHouses,
          groupHasHouses ? 'Sell all houses in this set first' : 'Mortgage for cash');
      }

      row.querySelector('.pf-name').addEventListener('click', () => {
        closePortfolio();
        openTileInspector(tile.index);
      });
      groupEl.appendChild(row);
    }
    body.appendChild(groupEl);
  }
}

/* ───────── Title deed inspector ───────── */
const deedModal = document.getElementById('deed-modal');

function closeTileInspector() {
  inspectedTileIndex = null;
  deedModal.classList.add('hidden');
}

document.getElementById('deed-close-btn').addEventListener('click', closeTileInspector);
deedModal.addEventListener('click', (e) => {
  if (e.target === deedModal) closeTileInspector();
});

function openTileInspector(tileIndex) {
  inspectedTileIndex = tileIndex;
  renderTileInspectorContent(tileIndex);
  deedModal.classList.remove('hidden');
}

function ownerBadge(owner, prop) {
  if (!owner) return '<span class="owner-badge">🏦 Unowned · Bank</span>';
  return `<span class="owner-badge"><span class="dot" style="background:${owner.color}"></span>${escapeHtml(owner.name)}${prop?.mortgaged ? ' · MORTGAGED' : ''}</span>`;
}

function renderTileInspectorContent(tileIndex) {
  const tile = BOARD_SPACES[tileIndex];
  if (!tile) return;

  const header = document.getElementById('deed-header');
  const sub = document.getElementById('deed-sub');
  const title = document.getElementById('deed-title');
  const body = document.getElementById('deed-body');
  const actions = document.getElementById('deed-actions');

  const groupInfo = COLOR_GROUPS[tile.group];
  header.style.background = tile.type === 'property' && groupInfo
    ? `linear-gradient(180deg, ${groupInfo.lightHex}, ${groupInfo.hex})`
    : tile.type === 'railroad' && groupInfo ? `linear-gradient(180deg, ${groupInfo.lightHex}, ${groupInfo.hex})`
    : tile.type === 'utility' && groupInfo ? `linear-gradient(180deg, ${groupInfo.lightHex}, ${groupInfo.hex})`
    : tile.type === 'chance' ? 'linear-gradient(180deg,#ffa94d,#e8590c)'
    : tile.type === 'chest' ? 'linear-gradient(180deg,#4dabf7,#1864ab)'
    : '#1b160d';
  header.classList.toggle('light-text-dark', tile.type === 'property' && LIGHT_GROUPS.includes(tile.group));
  sub.textContent = tile.country
    ? `${tile.country.toUpperCase()} · ${tile.type === 'railroad' ? 'AIRPORT' : 'TITLE DEED'}`
    : tile.type === 'property' ? 'TITLE DEED' : tile.type.toUpperCase().replace('GOTOJAIL', 'CORNER');
  title.textContent = `${tile.landmark ? `${tile.landmark} ` : ''}${tile.name}`;
  actions.innerHTML = '';

  const prop = gameState?.properties?.[tileIndex];
  const owner = prop?.ownerId ? gameState.players.find(p => p.id === prop.ownerId) : null;

  if (tile.type === 'property') {
    const rows = [
      ['Rent', tile.rent[0]],
      ['Rent with color set', tile.rent[0] * 2],
      ['With 1 house', tile.rent[1]],
      ['With 2 houses', tile.rent[2]],
      ['With 3 houses', tile.rent[3]],
      ['With 4 houses', tile.rent[4]],
      ['With HOTEL', tile.rent[5]]
    ];
    const ownsSet = owner && gameState && Object.values(gameState.properties)
      .filter(pp => BOARD_SPACES[pp.index].group === tile.group)
      .every(pp => pp.ownerId === owner.id);
    const activeRow = !owner || prop.mortgaged ? -1 : prop.houses > 0 ? prop.houses + 1 : ownsSet ? 1 : 0;

    body.innerHTML = `
      ${rows.map(([label, val], i) => `
        <div class="rent-row ${i === activeRow ? 'active-tier' : ''} ${i === 6 ? 'hotel' : ''}">
          <span>${label}</span><strong>$${val}</strong>
        </div>`).join('')}
      <div class="deed-divider"></div>
      <div class="deed-meta">
        <span>Price <strong>$${tile.price}</strong> · Houses <strong>$${tile.houseCost}</strong> each</span>
        <span>Mortgage value <strong>$${tile.mortgage}</strong></span>
        ${ownerBadge(owner, prop)}
      </div>`;
  } else if (tile.type === 'railroad') {
    const ownedCount = owner ? BOARD_SPACES.filter(t => t.type === 'railroad' && gameState.properties[t.index].ownerId === owner.id).length : 0;
    body.innerHTML = `
      <div class="deed-icon">✈️</div>
      ${[1, 2, 3, 4].map(n => `
        <div class="rent-row ${n === ownedCount && !prop?.mortgaged ? 'active-tier' : ''}">
          <span>${n} airport${n > 1 ? 's' : ''} owned</span><strong>$${tile.rent[n - 1]}</strong>
        </div>`).join('')}
      <div class="deed-divider"></div>
      <div class="deed-meta">
        <span>Price <strong>$${tile.price}</strong> · Mortgage <strong>$${tile.mortgage}</strong></span>
        ${ownerBadge(owner, prop)}
      </div>`;
  } else if (tile.type === 'utility') {
    body.innerHTML = `
      <div class="deed-icon">${tile.index === 12 ? '💡' : '🚰'}</div>
      <div class="rent-row"><span>One utility owned</span><strong>4× dice</strong></div>
      <div class="rent-row"><span>Both utilities owned</span><strong>10× dice</strong></div>
      <div class="deed-divider"></div>
      <div class="deed-meta">
        <span>Price <strong>$${tile.price}</strong> · Mortgage <strong>$${tile.mortgage}</strong></span>
        ${ownerBadge(owner, prop)}
      </div>`;
  } else {
    const icons = { go: '🏁', jail: '🚔', parking: '🚗', gotojail: '👮', chance: '❓', chest: '💰', tax: '🧾' };
    body.innerHTML = `
      <div class="deed-icon">${icons[tile.type] || '⬜'}</div>
      <p class="deed-desc">${tile.description || tile.name}</p>`;
  }

  // Management actions for the owner on their turn
  const canManage = gameState && prop && prop.ownerId === myPlayerId && gameState.activePlayerId === myPlayerId;
  if (!canManage) return;

  const addAction = (label, cls, evt) => {
    const b = document.createElement('button');
    b.className = `action-btn ${cls} full-width`;
    b.textContent = label;
    b.addEventListener('click', () => socket.emit(evt, { tileIndex }, handleResponse));
    actions.appendChild(b);
  };

  if (tile.type === 'property' && !prop.mortgaged && prop.houses < 5) {
    addAction(prop.houses === 4 ? `🏨 Build Hotel · $${tile.houseCost}` : `🏡 Build House · $${tile.houseCost}`, 'success', 'BUILD_HOUSE');
  }
  if (tile.type === 'property' && prop.houses > 0) {
    addAction(`🔨 Sell Building · +$${Math.floor(tile.houseCost / 2)}`, 'warning', 'SELL_HOUSE');
  }
  if (!prop.mortgaged && prop.houses === 0) {
    addAction(`🏦 Mortgage · +$${tile.mortgage}`, 'secondary', 'MORTGAGE_PROPERTY');
  }
  if (prop.mortgaged) {
    addAction(`🔓 Unmortgage · −$${Math.ceil(tile.mortgage * 1.1)}`, 'primary', 'UNMORTGAGE_PROPERTY');
  }
}

/* ───────── Live Turn Countdown & Match Elapsed Timer ───────── */
function updateLiveTimers() {
  if (!gameState || gameState.phase === 'LOBBY' || gameState.phase === 'GAME_OVER') return;

  const now = Date.now() + clockSkewMs;

  // 1. Match Elapsed Clock (MM:SS)
  if (gameState.gameStartedAt) {
    const elapsedSec = Math.max(0, Math.floor((now - gameState.gameStartedAt) / 1000));
    const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const secs = String(elapsedSec % 60).padStart(2, '0');
    const matchEl = document.getElementById('match-timer');
    if (matchEl) matchEl.textContent = `${mins}:${secs}`;
  }

  // 1b. Live Auction Hammer Clock
  if (gameState.phase === 'AUCTION' && gameState.activeAuction) {
    const aucRemSec = Math.max(0, Math.ceil((gameState.activeAuction.endsAt - now) / 1000));
    const aucClock = document.getElementById('auction-clock');
    if (aucClock) aucClock.textContent = `${aucRemSec}s`;
  }

  // 2. Turn Countdown Pill & Progress Bar
  const pill = document.getElementById('turn-timer-pill');
  const textEl = document.getElementById('turn-timer-text');
  const barEl = document.getElementById('turn-progress-bar');
  if (!pill || !textEl || !barEl) return;

  if (!gameState.turnTimeLimit || !gameState.turnDeadline) {
    pill.classList.add('hidden');
    barEl.style.width = '100%';
    barEl.classList.remove('urgent');
    return;
  }

  pill.classList.remove('hidden');
  const remMs = Math.max(0, gameState.turnDeadline - now);
  const remSec = Math.ceil(remMs / 1000);
  const pct = Math.min(100, Math.max(0, (remMs / (gameState.turnTimeLimit * 1000)) * 100));

  textEl.textContent = `${remSec}s`;
  barEl.style.width = `${pct.toFixed(1)}%`;

  const isWarn = remSec <= 15 && remSec > 7;
  const isUrgent = remSec <= 7;
  pill.classList.toggle('warn', isWarn);
  pill.classList.toggle('urgent', isUrgent);
  barEl.classList.toggle('urgent', isUrgent);

  // Subtle tick sound during final 7 seconds of the local player's turn
  if (gameState.activePlayerId === myPlayerId && remSec <= 7 && remSec > 0 && lastBeepSecond !== remSec) {
    lastBeepSecond = remSec;
    sfx.tick(remSec <= 3);
  }
}

setInterval(updateLiveTimers, 200);
