import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import gsap from 'gsap';
import { BOARD_SPACES, COLOR_GROUPS, LIGHT_TEXT_GROUPS } from '@shared/boardData.js';
import {
  createPlayerTokenMesh,
  createHouseMesh,
  createHotelMesh,
  createDieMesh,
  getRotationForDieValue,
  createCityLandmarkMesh
} from './TokensAndModels.js';

const CORNERS = [0, 10, 20, 30];
const FONT = '"Inter", "Segoe UI", system-ui, sans-serif';
const DISPLAY_FONT = '"Outfit", "Inter", "Segoe UI", sans-serif';
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function wrapWords(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function makeCanvasTexture(canvas, anisotropy = 8) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const LABELLED_TYPES = ['property', 'railroad', 'utility', 'tax'];
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class BoardScene {
  constructor(canvas, onTileSelected, onTileHover = null) {
    this.canvas = canvas;
    this.onTileSelected = onTileSelected;
    this.onTileHover = onTileHover;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06080e);
    this.scene.fog = new THREE.Fog(0x06080e, 70, 165);

    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 300);
    this.camera.position.set(0, 26, 28);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // HTML overlay renderer for always-upright, readable tile name labels
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    Object.assign(this.labelRenderer.domElement.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '3'
    });
    this.labelRenderer.domElement.className = 'label-layer';
    document.body.appendChild(this.labelRenderer.domElement);
    this.labels = new Map();
    this.labelsVisible = true;
    // Image-based lighting for glossy, reflective tokens, dice and trim
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI / 2.2;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 115;
    this.controls.autoRotateSpeed = 0.55;
    this.controls.target.set(0, 0, 0);

    this.currentPreset = 'overview';

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hoveredTileIndex = null;
    this.cameraFollowMode = false;
    this.clock = new THREE.Clock();
    this.lastState = null;
    this.activePlayerId = null;

    this.tileMeshes = [];
    this.tileTransforms = [];
    this.buildingGroups = new Map();
    this.playerTokens = new Map();
    this.playerPositions = new Map();

    this.setupLights();
    this.buildTable();
    this.buildBoardGeometry();
    this.buildTileLabels();
    this.setupDice();
    this.setupActiveBeacon();
    this.setupInteractions();

    // Re-render tile textures once webfonts are available so canvas text uses Inter/Outfit
    document.fonts?.ready.then(() => this.refreshAllTileTextures());

    window.addEventListener('resize', () => this.onResize());
    this.animate();
  }

  setupLights() {
    const hemiLight = new THREE.HemisphereLight(0xe0ecff, 0x1a120a, 0.45);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e0, 2.1);
    keyLight.position.set(14, 30, 16);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(4096, 4096);
    keyLight.shadow.camera.near = 5;
    keyLight.shadow.camera.far = 80;
    const d = 19;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.02;
    keyLight.shadow.radius = 4;
    this.scene.add(keyLight);

    const rimCool = new THREE.PointLight(0x5ea8ff, 1.4, 60, 1.6);
    rimCool.position.set(-20, 10, -18);
    this.scene.add(rimCool);

    const rimWarm = new THREE.PointLight(0xffa860, 1.1, 60, 1.6);
    rimWarm.position.set(20, 9, 18);
    this.scene.add(rimWarm);
  }

  buildTable() {
    // Procedural walnut tabletop
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 1024;
    const ctx = c.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, 1024, 1024);
    base.addColorStop(0, '#2b1a10');
    base.addColorStop(0.5, '#3a2416');
    base.addColorStop(1, '#25160c');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 1024, 1024);

    for (let i = 0; i < 260; i++) {
      const y = Math.random() * 1024;
      const amp = 4 + Math.random() * 14;
      const freq = 0.004 + Math.random() * 0.01;
      const phase = Math.random() * Math.PI * 2;
      ctx.strokeStyle = Math.random() > 0.5
        ? `rgba(20, 10, 4, ${0.08 + Math.random() * 0.18})`
        : `rgba(120, 76, 40, ${0.05 + Math.random() * 0.1})`;
      ctx.lineWidth = 0.6 + Math.random() * 2.4;
      ctx.beginPath();
      for (let x = 0; x <= 1024; x += 8) {
        const yy = y + Math.sin(x * freq + phase) * amp;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }

    const woodTex = makeCanvasTexture(c, 8);
    woodTex.wrapS = THREE.RepeatWrapping;
    woodTex.wrapT = THREE.RepeatWrapping;
    woodTex.repeat.set(5, 5);

    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(170, 170),
      new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.62, metalness: 0.05 })
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.96;
    table.receiveShadow = true;
    this.scene.add(table);

    // Soft vignette spotlight pool on the table
    const pool = new THREE.SpotLight(0xfff1d6, 60, 70, Math.PI / 5, 0.65, 1.4);
    pool.position.set(0, 38, 0);
    pool.target.position.set(0, 0, 0);
    this.scene.add(pool);
    this.scene.add(pool.target);
  }

  getTileLayout(index) {
    const cornerOffset = 10.9;
    const step = 2.066;

    // All 4 corners use rotY: 0 so corner text & icons are always upright from the camera
    if (index === 0) return { x: cornerOffset, z: cornerOffset, w: 3.2, d: 3.2, rotY: 0, isCorner: true };
    if (index > 0 && index < 10) {
      const i = index - 5;
      return { x: -i * step, z: cornerOffset, w: 2.02, d: 3.2, rotY: 0, isCorner: false };
    }
    if (index === 10) return { x: -cornerOffset, z: cornerOffset, w: 3.2, d: 3.2, rotY: 0, isCorner: true };
    if (index > 10 && index < 20) {
      const i = index - 15;
      // rotY = -Math.PI/2 puts local -z (color band & 3D monuments) on the INNER (+x) edge
      return { x: -cornerOffset, z: -i * step, w: 2.02, d: 3.2, rotY: -Math.PI / 2, isCorner: false };
    }
    if (index === 20) return { x: -cornerOffset, z: -cornerOffset, w: 3.2, d: 3.2, rotY: 0, isCorner: true };
    if (index > 20 && index < 30) {
      const i = index - 25;
      return { x: i * step, z: -cornerOffset, w: 2.02, d: 3.2, rotY: Math.PI, isCorner: false };
    }
    if (index === 30) return { x: cornerOffset, z: -cornerOffset, w: 3.2, d: 3.2, rotY: 0, isCorner: true };
    const i = index - 35;
    // rotY = +Math.PI/2 puts local -z (color band & 3D monuments) on the INNER (-x) edge
    return { x: cornerOffset, z: i * step, w: 2.02, d: 3.2, rotY: Math.PI / 2, isCorner: false };
  }

  createTileTexture(tile, propState = null, ownerColor = null) {
    const isCorner = CORNERS.includes(tile.index);
    const W = isCorner ? 512 : 330;
    const H = 512;
    const S = 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * S;
    canvas.height = H * S;
    const ctx = canvas.getContext('2d');
    ctx.scale(S, S);

    const mortgaged = !!propState?.mortgaged;

    // Aged-paper background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, mortgaged ? '#c9ced6' : '#fcf8ee');
    bg.addColorStop(1, mortgaged ? '#a3a9b4' : '#ebe2ca');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Paper speckle
    ctx.fillStyle = 'rgba(120, 100, 60, 0.05)';
    for (let i = 0; i < 160; i++) {
      ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
    }

    if (isCorner) {
      this.drawCornerTile(ctx, tile.index, W, H);
    } else {
      this.drawEdgeTile(ctx, tile, W, H);
    }

    // Hairline border
    ctx.strokeStyle = 'rgba(28, 22, 12, 0.9)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, W - 3, H - 3);

    // Ownership: glowing coloured frame + bottom strip
    if (ownerColor) {
      ctx.strokeStyle = ownerColor;
      ctx.lineWidth = 9;
      roundRect(ctx, 8, 8, W - 16, H - 16, 10);
      ctx.stroke();

      ctx.fillStyle = ownerColor;
      roundRect(ctx, 22, H - 30, W - 44, 14, 7);
      ctx.fill();
    }

    if (mortgaged) {
      ctx.save();
      ctx.translate(W / 2, H / 2 + 20);
      ctx.rotate(-0.42);
      ctx.strokeStyle = '#c81e1e';
      ctx.lineWidth = 6;
      roundRect(ctx, -W * 0.44, -30, W * 0.88, 60, 8);
      ctx.stroke();
      ctx.fillStyle = '#c81e1e';
      ctx.font = `900 ${isCorner ? 44 : 34}px ${DISPLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('MORTGAGED', 0, 2);
      ctx.restore();
    }

    return makeCanvasTexture(canvas);
  }

  drawEdgeTile(ctx, tile, W, H) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const isProperty = tile.type === 'property' && COLOR_GROUPS[tile.group];
    const hasGroup = ['property', 'railroad', 'utility'].includes(tile.type) && COLOR_GROUPS[tile.group];

    // Unified Header Band across ALL edge tiles so the board forms a continuous organized ring
    const bandH = 138;
    let bandTopHex = '#334155';
    let bandBotHex = '#1e293b';
    let darkText = false;
    let subText = '';

    if (hasGroup) {
      const group = COLOR_GROUPS[tile.group];
      bandTopHex = group.lightHex;
      bandBotHex = group.hex;
      darkText = LIGHT_TEXT_GROUPS.includes(tile.group);
      subText = (tile.country || group.name).toUpperCase();
    } else if (tile.type === 'chance') {
      bandTopHex = '#fb923c';
      bandBotHex = '#ea580c';
      subText = 'SURPRISE CARD';
    } else if (tile.type === 'chest') {
      bandTopHex = '#38bdf8';
      bandBotHex = '#0284c7';
      subText = 'TREASURY CARD';
    } else if (tile.type === 'tax') {
      bandTopHex = '#f87171';
      bandBotHex = '#dc2626';
      subText = 'GOVERNMENT FEE';
    }

    const grad = ctx.createLinearGradient(0, 0, 0, bandH);
    grad.addColorStop(0, bandTopHex);
    grad.addColorStop(1, bandBotHex);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, bandH);

    // Subtle top gloss
    const gloss = ctx.createLinearGradient(0, 0, 0, bandH * 0.5);
    gloss.addColorStop(0, 'rgba(255,255,255,0.32)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.fillRect(0, 0, W, bandH * 0.5);

    // Gold/Dark structural divider line under header band
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, bandH, W, 6);
    ctx.fillStyle = '#d4af37';
    ctx.fillRect(0, bandH + 6, W, 3);

    // For Top-Row tiles (indices 21..29), rotY is Math.PI so the color band stays on the inner board ring.
    // Flip text/emblems 180° inside each zone so top-row text reads upright from the camera!
    const flipTopRow = tile.index > 20 && tile.index < 30;
    const drawInZone = (cy, fn) => {
      ctx.save();
      if (flipTopRow) {
        ctx.translate(W / 2, cy);
        ctx.rotate(Math.PI);
        ctx.translate(-W / 2, -cy);
      }
      fn();
      ctx.restore();
    };

    drawInZone(bandH / 2, () => {
      // Country / Type subtitle inside header band
      ctx.fillStyle = darkText ? 'rgba(17, 24, 39, 0.8)' : 'rgba(255, 255, 255, 0.9)';
      ctx.font = `800 20px ${FONT}`;
      ctx.fillText(subText, W / 2, 34);

      // Primary Tile Title inside header band
      ctx.fillStyle = darkText ? '#0f172a' : '#ffffff';
      let bannerSize = 44;
      ctx.font = `900 ${bannerSize}px ${DISPLAY_FONT}`;
      while (ctx.measureText(tile.shortName.toUpperCase()).width > W - 28 && bannerSize > 24) {
        bannerSize -= 2;
        ctx.font = `900 ${bannerSize}px ${DISPLAY_FONT}`;
      }
      if (!darkText) {
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowOffsetY = 2;
        ctx.shadowBlur = 5;
      }
      ctx.fillText(tile.shortName.toUpperCase(), W / 2, 104);
    });

    // Organized Inner Card Frame (Zone 2: 158..390px)
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.14)';
    ctx.lineWidth = 2;
    roundRect(ctx, 18, 158, W - 36, 232, 14);
    ctx.stroke();

    // Center Emblem / Landmark
    drawInZone(274, () => {
      if (isProperty || tile.type === 'railroad' || tile.type === 'utility') {
        const emoji = tile.landmark || (tile.type === 'railroad' ? '✈️' : (tile.index === 12 ? '💡' : '🚰'));
        ctx.font = `96px ${EMOJI_FONT}`;
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, W / 2, 256);
        ctx.textBaseline = 'alphabetic';

        const baseLabel = tile.type === 'property'
          ? `BASE RENT $${tile.rent[0]}`
          : tile.type === 'railroad'
            ? '1–4 AIRPORTS'
            : '4× / 10× DICE';
        ctx.fillStyle = '#475569';
        ctx.font = `800 21px ${FONT}`;
        ctx.fillText(baseLabel, W / 2, 366);
      } else if (tile.type === 'chance') {
        const iconY = 274;
        ctx.beginPath();
        ctx.arc(W / 2, iconY, 68, 0, Math.PI * 2);
        const cg = ctx.createRadialGradient(W / 2 - 16, iconY - 16, 8, W / 2, iconY, 72);
        cg.addColorStop(0, '#ffb057');
        cg.addColorStop(1, '#e8590c');
        ctx.fillStyle = cg;
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = `900 104px ${DISPLAY_FONT}`;
        ctx.textBaseline = 'middle';
        ctx.fillText('?', W / 2, iconY + 4);
        ctx.textBaseline = 'alphabetic';
      } else if (tile.type === 'chest') {
        ctx.font = `104px ${EMOJI_FONT}`;
        ctx.textBaseline = 'middle';
        ctx.fillText('💰', W / 2, 274);
        ctx.textBaseline = 'alphabetic';
      } else if (tile.type === 'tax') {
        ctx.font = `96px ${EMOJI_FONT}`;
        ctx.textBaseline = 'middle';
        ctx.fillText(tile.index === 4 ? '🧾' : '💎', W / 2, 270);
        ctx.textBaseline = 'alphabetic';
      }
    });

    // Zone 3: High-contrast Footer Pill for Price / Tax / Action (410..484px)
    let footer = null;
    if (tile.price) footer = `$${tile.price}`;
    else if (tile.type === 'tax') footer = `PAY $${tile.taxAmount}`;
    else if (tile.type === 'chance' || tile.type === 'chest') footer = 'DRAW CARD';

    if (footer) {
      const py = H - 94;
      ctx.fillStyle = tile.type === 'tax' ? '#b91c1c' : '#0f172a';
      roundRect(ctx, 18, py, W - 36, 58, 14);
      ctx.fill();
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      drawInZone(py + 29, () => {
        ctx.font = `900 36px ${DISPLAY_FONT}`;
        ctx.fillStyle = tile.price ? '#fef08a' : '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(footer, W / 2, py + 30);
        ctx.textBaseline = 'alphabetic';
      });
    }
  }

  drawCornerTile(ctx, index, W, H) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (index === 0) {
      ctx.fillStyle = '#1b160d';
      ctx.font = `700 26px ${FONT}`;
      ctx.fillText('COLLECT $200 SALARY', W / 2, 74);
      ctx.fillText('AS YOU PASS', W / 2, 108);

      const goGrad = ctx.createLinearGradient(0, 160, 0, 330);
      goGrad.addColorStop(0, '#ff4d4d');
      goGrad.addColorStop(1, '#b3121f');
      ctx.fillStyle = goGrad;
      ctx.font = `900 190px ${DISPLAY_FONT}`;
      ctx.fillText('GO', W / 2, 250);

      // Arrow pointing in the direction of travel
      ctx.fillStyle = '#d61f2c';
      ctx.beginPath();
      ctx.moveTo(70, 420);
      ctx.lineTo(160, 370);
      ctx.lineTo(160, 400);
      ctx.lineTo(440, 400);
      ctx.lineTo(440, 440);
      ctx.lineTo(160, 440);
      ctx.lineTo(160, 470);
      ctx.closePath();
      ctx.fill();
    } else if (index === 10) {
      // Jail cell
      const cx = 120;
      const cy = 60;
      const size = 330;
      const jg = ctx.createLinearGradient(cx, cy, cx + size, cy + size);
      jg.addColorStop(0, '#ffa94d');
      jg.addColorStop(1, '#e8590c');
      ctx.fillStyle = jg;
      ctx.fillRect(cx, cy, size, size);
      ctx.strokeStyle = '#1b160d';
      ctx.lineWidth = 6;
      ctx.strokeRect(cx, cy, size, size);

      ctx.fillStyle = '#1b160d';
      ctx.font = `900 54px ${DISPLAY_FONT}`;
      ctx.fillText('IN JAIL', cx + size / 2, cy + 70);

      ctx.lineWidth = 9;
      ctx.strokeStyle = '#2b2b2b';
      for (let bx = cx + 50; bx < cx + size - 20; bx += 48) {
        ctx.beginPath();
        ctx.moveTo(bx, cy + 120);
        ctx.lineTo(bx, cy + size - 20);
        ctx.stroke();
      }
      ctx.font = `90px ${EMOJI_FONT}`;
      ctx.fillText('😟', cx + size / 2, cy + 225);

      ctx.fillStyle = '#1b160d';
      ctx.font = `800 34px ${DISPLAY_FONT}`;
      ctx.fillText('JUST VISITING', W / 2, H - 50);
    } else if (index === 20) {
      ctx.fillStyle = '#1b160d';
      ctx.font = `900 64px ${DISPLAY_FONT}`;
      ctx.fillText('FREE', W / 2, 110);
      ctx.font = `150px ${EMOJI_FONT}`;
      ctx.fillText('🚗', W / 2, 270);
      ctx.fillStyle = '#1b160d';
      ctx.font = `900 64px ${DISPLAY_FONT}`;
      ctx.fillText('PARKING', W / 2, 420);
    } else if (index === 30) {
      ctx.fillStyle = '#1b160d';
      ctx.font = `900 64px ${DISPLAY_FONT}`;
      ctx.fillText('GO TO', W / 2, 110);
      ctx.font = `150px ${EMOJI_FONT}`;
      ctx.fillText('👮', W / 2, 270);
      ctx.fillStyle = '#b3121f';
      ctx.font = `900 72px ${DISPLAY_FONT}`;
      ctx.fillText('JAIL', W / 2, 420);
    }
  }

  createCenterTexture() {
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 2048;
    const ctx = c.getContext('2d');

    const g = ctx.createRadialGradient(1024, 1024, 100, 1024, 1024, 1400);
    g.addColorStop(0, '#134e43');
    g.addColorStop(0.6, '#0a352e');
    g.addColorStop(1, '#041b17');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2048, 2048);

    // Subtle architectural grid
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.05)';
    ctx.lineWidth = 2;
    for (let i = 128; i < 2048; i += 128) {
      ctx.beginPath();
      ctx.moveTo(i, 60);
      ctx.lineTo(i, 1988);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(60, i);
      ctx.lineTo(1988, i);
      ctx.stroke();
    }

    // Gold double outer frame
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 14;
    ctx.strokeRect(56, 56, 1936, 1936);
    ctx.lineWidth = 4;
    ctx.strokeRect(92, 92, 1864, 1864);

    // Organized Card Deck Bays (Top-Left: Chance, Top-Right: Community Chest)
    const drawDeckBay = (cx, cy, label, color) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = 'rgba(4, 15, 13, 0.55)';
      roundRect(ctx, -230, -155, 460, 310, 24);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.setLineDash([14, 10]);
      roundRect(ctx, -214, -140, 428, 280, 18);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(245, 215, 110, 0.75)';
      ctx.font = `800 26px ${DISPLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, 192);
      ctx.restore();
    };
    drawDeckBay(474, 474, 'CHANCE DECK', '#fb923c');
    drawDeckBay(1574, 474, 'COMMUNITY CHEST', '#38bdf8');

    // Dedicated Dice Rolling Arena in lower center (z = +3.2 in world -> y = 1376 on canvas)
    const arenaY = 1420;
    ctx.fillStyle = 'rgba(4, 15, 13, 0.55)';
    ctx.beginPath();
    ctx.arc(1024, arenaY, 290, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(212, 175, 55, 0.65)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(1024, arenaY, 290, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(212, 175, 55, 0.28)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(1024, arenaY, 260, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(245, 215, 110, 0.65)';
    ctx.font = `800 26px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('🎲  D I C E   A R E N A', 1024, arenaY + 225);

    return makeCanvasTexture(c, 8);
  }

  createLogoTexture() {
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 360;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 360);
    g.addColorStop(0, '#ef2b3b');
    g.addColorStop(1, '#9c0f1c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1280, 360);

    ctx.strokeStyle = '#f5d76e';
    ctx.lineWidth = 12;
    ctx.strokeRect(18, 18, 1244, 324);
    ctx.lineWidth = 3;
    ctx.strokeRect(40, 40, 1200, 280);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowOffsetY = 6;
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 160px ${DISPLAY_FONT}`;
    ctx.fillText('MONOPOLY', 640, 165);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#f5d76e';
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText('A R G O N   ·   3 D   O N L I N E   E D I T I O N', 640, 280);
    return makeCanvasTexture(c, 8);
  }

  buildBoardGeometry() {
    const lacquer = new THREE.MeshStandardMaterial({ color: 0x0d1424, roughness: 0.28, metalness: 0.35 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.25, metalness: 1.0 });

    const outerFrame = new THREE.Mesh(new THREE.BoxGeometry(26.4, 0.9, 26.4), lacquer);
    outerFrame.position.y = -0.5;
    outerFrame.castShadow = true;
    outerFrame.receiveShadow = true;
    this.scene.add(outerFrame);

    const trim = new THREE.Mesh(new THREE.BoxGeometry(26.65, 0.1, 26.65), gold);
    trim.position.y = -0.1;
    this.scene.add(trim);

    const baseTrim = new THREE.Mesh(new THREE.BoxGeometry(26.65, 0.08, 26.65), gold);
    baseTrim.position.y = -0.9;
    this.scene.add(baseTrim);

    // Center surface with felt texture
    this.centerTexture = this.createCenterTexture();
    const centerTop = new THREE.MeshStandardMaterial({ map: this.centerTexture, roughness: 0.82, metalness: 0.0 });
    const centerSide = new THREE.MeshStandardMaterial({ color: 0x05201b, roughness: 0.8 });
    const centerSurface = new THREE.Mesh(
      new THREE.BoxGeometry(18.6, 0.22, 18.6),
      [centerSide, centerSide, centerTop, centerSide, centerSide, centerSide]
    );
    centerSurface.position.y = -0.06;
    centerSurface.receiveShadow = true;
    this.scene.add(centerSurface);

    // Logo plaque aligned straight in the center-upper court
    this.logoMaterial = new THREE.MeshStandardMaterial({ map: this.createLogoTexture(), roughness: 0.35, metalness: 0.1 });
    const plaque = new THREE.Mesh(
      new THREE.BoxGeometry(9.8, 0.16, 2.7),
      [gold, gold, this.logoMaterial, gold, gold, gold]
    );
    plaque.position.set(0, 0.12, -0.5);
    plaque.rotation.y = 0;
    plaque.castShadow = true;
    plaque.receiveShadow = true;
    this.scene.add(plaque);

    this.createDeckStack(-5.0, -5.0, 'chance');
    this.createDeckStack(5.0, -5.0, 'chest');

    const tileSide = new THREE.MeshStandardMaterial({ color: 0xd9ceb2, roughness: 0.7, metalness: 0.0 });

    for (const tile of BOARD_SPACES) {
      const layout = this.getTileLayout(tile.index);
      this.tileTransforms[tile.index] = layout;

      const topMat = new THREE.MeshStandardMaterial({
        map: this.createTileTexture(tile),
        roughness: 0.55,
        metalness: 0.0,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0
      });

      const geo = new THREE.BoxGeometry(layout.w - 0.05, 0.26, layout.d - 0.05);
      const mesh = new THREE.Mesh(geo, [tileSide, tileSide, topMat, tileSide, tileSide, tileSide]);
      mesh.position.set(layout.x, 0.08, layout.z);
      mesh.rotation.y = layout.rotY;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.userData = { tileIndex: tile.index, baseY: 0.08 };

      this.scene.add(mesh);
      this.tileMeshes[tile.index] = mesh;

      const buildGroup = new THREE.Group();
      buildGroup.position.set(layout.x, 0.21, layout.z);
      buildGroup.rotation.y = layout.rotY;
      this.scene.add(buildGroup);
      this.buildingGroups.set(tile.index, buildGroup);

      // Spawn default 3D World City architectural monument on the inner strip
      if (tile.type === 'property' && COLOR_GROUPS[tile.group]) {
        const monument = createCityLandmarkMesh(tile.index, COLOR_GROUPS[tile.group].hex);
        monument.position.set(0, 0, -1.05);
        buildGroup.add(monument);
      }
    }
  }

  createDeckStack(x, z, deckType) {
    const isChance = deckType === 'chance';
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 400;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 640, 400);
    g.addColorStop(0, isChance ? '#ffa94d' : '#4dabf7');
    g.addColorStop(1, isChance ? '#e8590c' : '#1864ab');
    ctx.fillStyle = g;
    roundRect(ctx, 0, 0, 640, 400, 36);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 10;
    roundRect(ctx, 22, 22, 596, 356, 26);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    if (isChance) {
      ctx.font = `900 170px ${DISPLAY_FONT}`;
      ctx.fillText('?', 320, 165);
      ctx.font = `800 52px ${DISPLAY_FONT}`;
      ctx.fillText('CHANCE', 320, 300);
    } else {
      ctx.font = `130px ${EMOJI_FONT}`;
      ctx.fillText('💰', 320, 160);
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 44px ${DISPLAY_FONT}`;
      ctx.fillText('COMMUNITY CHEST', 320, 300);
    }

    const topMat = new THREE.MeshStandardMaterial({ map: makeCanvasTexture(c), roughness: 0.45 });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.6 });

    const group = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const card = new THREE.Mesh(
        new THREE.BoxGeometry(3.3, 0.045, 2.06),
        i === 5 ? [sideMat, sideMat, topMat, sideMat, sideMat, sideMat] : sideMat
      );
      card.position.set((Math.random() - 0.5) * 0.03, 0.06 + i * 0.05, (Math.random() - 0.5) * 0.03);
      card.rotation.y = (Math.random() - 0.5) * 0.02;
      card.castShadow = true;
      card.receiveShadow = true;
      group.add(card);
    }
    group.position.set(x, 0, z);
    group.rotation.y = 0;
    this.scene.add(group);
  }

  buildTileLabels() {
    for (const tile of BOARD_SPACES) {
      if (!LABELLED_TYPES.includes(tile.type)) continue;
      const layout = this.tileTransforms[tile.index];

      const el = document.createElement('div');
      el.className = 'tile-label';
      const inner = document.createElement('div');
      inner.className = 'tile-label-inner';
      const groupColor = COLOR_GROUPS[tile.group]?.hex || (tile.type === 'tax' ? '#d63b3b' : '#8b95a8');
      inner.style.setProperty('--gc', groupColor);
      el.appendChild(inner);

      const obj = new CSS2DObject(el);
      // Positioned cleanly along the outer perimeter rim so tiles, landmarks, houses & tokens stay 100% unobstructed
      const local = new THREE.Vector3(0, 0, 2.05).applyAxisAngle(Y_AXIS, layout.rotY);
      obj.position.set(layout.x + local.x, 0.18, layout.z + local.z);
      this.scene.add(obj);

      this.labels.set(tile.index, { obj, inner, tile, sig: null, lastScale: '' });
      this.renderLabel(tile.index, null, null);
    }
  }

  renderLabel(index, prop, owner) {
    const entry = this.labels.get(index);
    if (!entry) return;
    const { inner, tile } = entry;
    const sig = `${owner?.id || '-'}|${owner?.name || ''}|${prop?.houses || 0}|${prop?.mortgaged ? 1 : 0}`;
    if (entry.sig === sig) return;
    entry.sig = sig;

    const icon = tile.landmark || (tile.type === 'railroad' ? '✈️'
      : tile.type === 'utility' ? (tile.index === 12 ? '💡' : '🚰')
      : tile.type === 'tax' ? '🧾' : '');

    let sub;
    if (prop?.mortgaged) sub = '<span class="tl-mort">MORT</span>';
    else if (owner) sub = `<i class="tl-dot"></i><span class="tl-owner">${escapeHtml(owner.name)}</span>`;
    else if (tile.price) sub = `$${tile.price}`;
    else sub = `-$${tile.taxAmount}`;

    let buildings = '';
    if (prop?.houses === 5) buildings = '<span class="tl-build hotel">H</span>';
    else if (prop?.houses > 0) buildings = `<span class="tl-build">${'<i class="tl-house"></i>'.repeat(prop.houses)}</span>`;

    const darkHeader = LIGHT_TEXT_GROUPS.includes(tile.group);
    inner.classList.toggle('owned', !!owner);
    inner.classList.toggle('mortgaged', !!prop?.mortgaged);
    inner.classList.toggle('dark-head', darkHeader);
    inner.style.setProperty('--oc', owner?.color || 'transparent');
    inner.innerHTML = `
      <span class="tl-head">${icon ? `<span class="tl-icon">${icon}</span>` : ''}<span>${escapeHtml(tile.shortName)}</span></span>
      <span class="tl-sub">${sub}${buildings}</span>`;
  }

  setLabelsVisible(visible) {
    this.labelsVisible = visible;
    this.labelRenderer.domElement.style.display = visible ? '' : 'none';
  }

  setupDice() {
    this.die1 = createDieMesh();
    this.die2 = createDieMesh();
    this.die1.position.set(-1.05, 0.62, 3.55);
    this.die2.position.set(1.05, 0.62, 3.55);
    this.die1.rotation.y = 0.3;
    this.die2.rotation.y = -0.25;
    this.scene.add(this.die1);
    this.scene.add(this.die2);
  }

  setupActiveBeacon() {
    this.beaconColor = new THREE.Color(0xf5c451);

    this.beaconRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.66, 0.045, 12, 48),
      new THREE.MeshBasicMaterial({ color: this.beaconColor, transparent: true, opacity: 0.95 })
    );
    this.beaconRing.rotation.x = Math.PI / 2;
    this.beaconRing.visible = false;
    this.scene.add(this.beaconRing);

    this.beaconBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.62, 7, 32, 1, true),
      new THREE.MeshBasicMaterial({
        color: this.beaconColor,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    this.beaconBeam.visible = false;
    this.scene.add(this.beaconBeam);
  }

  setAutoRotate(enabled) {
    this.controls.autoRotate = enabled;
  }

  highlightTile(tileIndex, colorHex = '#f5c451') {
    const mesh = this.tileMeshes[tileIndex];
    if (!mesh) return;
    const mat = mesh.material[2];
    mat.emissive.set(colorHex);
    gsap.killTweensOf(mat);
    gsap.fromTo(mat, { emissiveIntensity: 0.55 }, { emissiveIntensity: 0, duration: 1.6, ease: 'power2.out' });
    gsap.fromTo(mesh.position, { y: mesh.userData.baseY + 0.22 }, { y: mesh.userData.baseY, duration: 0.6, ease: 'bounce.out' });
  }

  rollDiceAnimation(d1Val, d2Val) {
    const [r1x, r1y, r1z] = getRotationForDieValue(d1Val);
    const [r2x, r2y, r2z] = getRotationForDieValue(d2Val);
    const spins1 = Math.PI * 6;
    const spins2 = Math.PI * 8;
    const yaw1 = (Math.random() - 0.5) * 0.8;
    const yaw2 = (Math.random() - 0.5) * 0.8;

    gsap.killTweensOf([this.die1.position, this.die1.rotation, this.die2.position, this.die2.rotation]);

    this.die1.position.set(-3.4, 5, 5);
    this.die2.position.set(3.4, 5.6, 5);

    gsap.to(this.die1.position, {
      x: -0.95 + (Math.random() * 0.36 - 0.18), y: 0.62, z: 3.55 + (Math.random() * 0.36 - 0.18),
      duration: 0.85, ease: 'bounce.out'
    });
    gsap.to(this.die2.position, {
      x: 0.95 + (Math.random() * 0.36 - 0.18), y: 0.62, z: 3.55 + (Math.random() * 0.36 - 0.18),
      duration: 0.92, ease: 'bounce.out'
    });

    // Yaw is applied around world Y after the face-up rotation, so the up face stays correct
    this.die1.rotation.order = 'YXZ';
    this.die2.rotation.order = 'YXZ';
    gsap.fromTo(this.die1.rotation,
      { x: r1x + spins1, y: yaw1 + spins1, z: r1z + spins1 },
      { x: r1x, y: yaw1 + r1y, z: r1z, duration: 0.85, ease: 'power3.out' });
    gsap.fromTo(this.die2.rotation,
      { x: r2x - spins2, y: yaw2 + spins2, z: r2z - spins2 },
      { x: r2x, y: yaw2 + r2y, z: r2z, duration: 0.92, ease: 'power3.out' });
  }

  getTokenWorldCoords(tileIndex, slotIndex = 0, totalOnTile = 1, inJail = false) {
    const layout = this.tileTransforms[tileIndex];
    if (!layout) return new THREE.Vector3(0, 0.21, 0);

    if (tileIndex === 10) {
      return inJail
        ? new THREE.Vector3(layout.x + 0.4 + (slotIndex % 2) * 0.35, 0.21, layout.z - 0.4 - Math.floor(slotIndex / 2) * 0.35)
        : new THREE.Vector3(layout.x - 1.05 + slotIndex * 0.15, 0.21, layout.z + 1.05 - slotIndex * 0.3);
    }

    const spread = 0.44;
    const offsets = [[-spread, 0.15], [spread, 0.15], [-spread, 0.75], [spread, 0.75], [0, -0.35], [0, 1.1]];
    const [ox, oz] = totalOnTile === 1 ? [0, 0.35] : (offsets[slotIndex % offsets.length] || [0, 0]);

    const localVec = new THREE.Vector3(ox, 0, oz);
    localVec.applyAxisAngle(new THREE.Vector3(0, 1, 0), layout.rotY);
    return new THREE.Vector3(layout.x + localVec.x, 0.21, layout.z + localVec.z);
  }

  refreshAllTileTextures() {
    for (const mesh of this.tileMeshes) {
      if (mesh) delete mesh.userData.stateSig;
    }
    if (this.lastState) {
      this.syncState(this.lastState);
    } else {
      for (const tile of BOARD_SPACES) {
        const mat = this.tileMeshes[tile.index].material[2];
        mat.map?.dispose();
        mat.map = this.createTileTexture(tile);
        mat.needsUpdate = true;
      }
    }
    this.logoMaterial.map?.dispose();
    this.logoMaterial.map = this.createLogoTexture();
    this.logoMaterial.needsUpdate = true;
  }

  syncState(gameState) {
    this.lastState = gameState;
    this.activePlayerId = gameState.activePlayerId;

    for (const [idxStr, prop] of Object.entries(gameState.properties)) {
      const idx = Number(idxStr);
      const tile = BOARD_SPACES[idx];
      const owner = gameState.players.find(p => p.id === prop.ownerId);
      const ownerColor = owner ? owner.color : null;
      this.renderLabel(idx, prop, owner);

      const mesh = this.tileMeshes[idx];
      const sig = `${prop.ownerId || 'none'}-${prop.mortgaged}-${prop.houses}`;
      if (mesh && mesh.userData.stateSig !== sig) {
        mesh.userData.stateSig = sig;
        const mat = mesh.material[2];
        mat.map?.dispose();
        mat.map = this.createTileTexture(tile, prop, ownerColor);
        mat.needsUpdate = true;

        const buildGroup = this.buildingGroups.get(idx);
        if (buildGroup) {
          const previousCount = buildGroup.userData.count || 0;
          while (buildGroup.children.length > 0) buildGroup.remove(buildGroup.children[0]);

          const spawned = [];
          if (prop.houses === 0 && tile.type === 'property' && COLOR_GROUPS[tile.group]) {
            const monument = createCityLandmarkMesh(idx, ownerColor || COLOR_GROUPS[tile.group].hex);
            monument.position.set(0, 0, -1.05);
            buildGroup.add(monument);
          } else if (prop.houses > 0 && prop.houses <= 4) {
            const spacing = 0.44;
            const startX = -((prop.houses - 1) * spacing) / 2;
            for (let h = 0; h < prop.houses; h++) {
              const house = createHouseMesh();
              house.position.set(startX + h * spacing, 0, -1.05);
              buildGroup.add(house);
              spawned.push(house);
            }
          } else if (prop.houses === 5) {
            const hotel = createHotelMesh();
            hotel.position.set(0, 0, -1.05);
            buildGroup.add(hotel);
            spawned.push(hotel);
          }

          // Drop-in animation for newly constructed buildings
          if (prop.houses > previousCount && spawned.length) {
            const newest = spawned[spawned.length - 1];
            gsap.fromTo(newest.position, { y: 2.2 }, { y: 0, duration: 0.7, ease: 'bounce.out' });
            gsap.fromTo(newest.scale, { x: 0.3, y: 0.3, z: 0.3 }, { x: 1, y: 1, z: 1, duration: 0.45, ease: 'back.out(2)' });
          }
          buildGroup.userData.count = prop.houses;
        }
      }
    }

    const activeIds = new Set(gameState.players.filter(p => !p.bankrupt).map(p => p.id));
    for (const [pid, mesh] of this.playerTokens.entries()) {
      if (!activeIds.has(pid)) {
        gsap.to(mesh.scale, { x: 0, y: 0, z: 0, duration: 0.5, onComplete: () => this.scene.remove(mesh) });
        this.playerTokens.delete(pid);
        this.playerPositions.delete(pid);
      }
    }

    const tileOccupants = new Map();
    for (const p of gameState.players) {
      if (p.bankrupt) continue;
      const list = tileOccupants.get(p.position) || [];
      list.push(p);
      tileOccupants.set(p.position, list);
    }

    for (const p of gameState.players) {
      if (p.bankrupt) continue;
      let tokenMesh = this.playerTokens.get(p.id);
      const siblings = tileOccupants.get(p.position) || [p];
      const slotIdx = siblings.findIndex(s => s.id === p.id);
      const targetVec = this.getTokenWorldCoords(p.position, slotIdx, siblings.length, p.inJail);

      if (!tokenMesh) {
        tokenMesh = createPlayerTokenMesh(p.token, p.color);
        tokenMesh.position.copy(targetVec);
        tokenMesh.userData.color = p.color;
        this.scene.add(tokenMesh);
        this.playerTokens.set(p.id, tokenMesh);
        this.playerPositions.set(p.id, p.position);
        gsap.fromTo(tokenMesh.scale, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'back.out(2)' });
      } else if (!tokenMesh.userData.isAnimating) {
        gsap.to(tokenMesh.position, { x: targetVec.x, y: targetVec.y, z: targetVec.z, duration: 0.35, ease: 'power2.out' });
        this.playerPositions.set(p.id, p.position);
      }
    }

    const active = gameState.players.find(p => p.id === gameState.activePlayerId);
    if (active && gameState.phase !== 'LOBBY' && gameState.phase !== 'GAME_OVER') {
      this.beaconColor.set(active.color);
      this.beaconRing.material.color.copy(this.beaconColor);
      this.beaconBeam.material.color.copy(this.beaconColor);
      this.beaconRing.visible = true;
      this.beaconBeam.visible = true;
    } else {
      this.beaconRing.visible = false;
      this.beaconBeam.visible = false;
    }

    if (this.cameraFollowMode && gameState.activePlayerId) {
      this.focusOnPlayer(gameState.activePlayerId);
    }
  }

  animateTokenPath(playerId, fromPos, toPos, intermediatePos = null, inJail = false, onComplete = null) {
    const tokenMesh = this.playerTokens.get(playerId);
    if (!tokenMesh) {
      onComplete?.();
      return;
    }

    tokenMesh.userData.isAnimating = true;
    gsap.killTweensOf(tokenMesh.position);

    const waypoints = [];
    const pushSteps = (start, end) => {
      let curr = start;
      let guard = 0;
      while (curr !== end && guard < 42) {
        curr = (curr + 1) % 40;
        waypoints.push(curr);
        guard++;
      }
    };

    if (inJail && toPos === 10) {
      waypoints.push(10);
    } else if (intermediatePos !== null && intermediatePos !== undefined && intermediatePos !== toPos) {
      pushSteps(fromPos, intermediatePos);
      waypoints.push(toPos);
    } else {
      pushSteps(fromPos, toPos);
    }

    const tl = gsap.timeline({
      onComplete: () => {
        tokenMesh.userData.isAnimating = false;
        this.playerPositions.set(playerId, toPos);
        onComplete?.();
      }
    });

    const jumpDuration = waypoints.length > 1 ? 0.16 : 0.5;
    for (const stepTileIdx of waypoints) {
      const dest = this.getTokenWorldCoords(stepTileIdx, 0, 1, inJail && stepTileIdx === 10);
      tl.to(tokenMesh.position, { x: dest.x, z: dest.z, duration: jumpDuration, ease: 'power1.inOut' }, '>')
        .to(tokenMesh.position, {
          y: waypoints.length > 1 ? 1.0 : 3.2,
          duration: jumpDuration / 2,
          yoyo: true,
          repeat: 1,
          ease: 'sine.out'
        }, '<');
    }
    tl.to(tokenMesh.scale, { y: 0.8, x: 1.12, z: 1.12, duration: 0.08, yoyo: true, repeat: 1 });
  }

  computeSafeCameraPose(preset = 'overview') {
    const W = Math.max(1, window.innerWidth);
    const H = Math.max(1, window.innerHeight);
    const topBar = document.getElementById('top-bar');
    const dock = document.getElementById('action-dock');
    const leftPanel = document.getElementById('players-sidebar');
    const rightPanel = document.getElementById('feed-sidebar');

    const isVisible = (el) => el && !el.classList.contains('hidden');
    const topInset = isVisible(topBar) ? Math.min(H * 0.25, topBar.getBoundingClientRect().bottom + 12) : 16;
    const bottomInset = isVisible(dock) ? Math.min(H * 0.28, (H - dock.getBoundingClientRect().top) + 12) : 16;

    // Sidebars are docked on wide screens (> 1180px) and slide-over drawers on smaller screens
    const sidebarsDocked = W > 1180;
    const leftInset = sidebarsDocked && isVisible(leftPanel)
      ? Math.min(W * 0.3, leftPanel.getBoundingClientRect().right + 12)
      : 16;
    const rightInset = sidebarsDocked && isVisible(rightPanel)
      ? Math.min(W * 0.3, (W - rightPanel.getBoundingClientRect().left) + 12)
      : 16;

    const fracH = Math.max(0.42, (H - topInset - bottomInset) / H);
    const fracW = Math.max(0.42, (W - leftInset - rightInset) / W);

    const fovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const halfTan = Math.tan(fovRad / 2);
    const aspect = W / H;

    // Board + outer perimeter labels span ~30.8 world units
    const boardSpan = preset === 'topdown' ? 31.2 : 29.5;
    const distV = (boardSpan / fracH) / (2 * halfTan);
    const distH = (boardSpan / fracW) / (2 * halfTan * aspect);
    const reqDist = Math.max(distV, distH);

    // Shift camera target slightly to center the board inside the asymmetric HUD margins
    const visibleWorldH = 2 * reqDist * halfTan;
    const visibleWorldW = visibleWorldH * aspect;
    const shiftX = -((leftInset - rightInset) / (2 * W)) * visibleWorldW;
    const shiftZ = -((topInset - bottomInset) / (2 * H)) * visibleWorldH;

    if (preset === 'topdown') {
      return {
        camX: shiftX,
        camY: reqDist,
        camZ: shiftZ + 0.08,
        targetX: shiftX,
        targetZ: shiftZ
      };
    }

    // 3D Overview angled at ~44 degrees
    const scale = reqDist / 41.5;
    return {
      camX: shiftX,
      camY: 27.5 * scale,
      camZ: 28.0 * scale + shiftZ,
      targetX: shiftX,
      targetZ: shiftZ - 0.6
    };
  }

  setCameraPreset(preset, activePlayerId = null, immediate = false) {
    this.currentPreset = preset;
    this.cameraFollowMode = preset === 'follow';
    this.controls.autoRotate = false;
    const dur = immediate ? 0.01 : 0.95;

    if (preset === 'overview' || preset === 'topdown') {
      const pose = this.computeSafeCameraPose(preset);
      gsap.to(this.camera.position, {
        x: pose.camX,
        y: pose.camY,
        z: pose.camZ,
        duration: dur,
        ease: 'power3.inOut'
      });
      gsap.to(this.controls.target, {
        x: pose.targetX,
        y: 0,
        z: pose.targetZ,
        duration: dur,
        ease: 'power3.inOut'
      });
    } else if (preset === 'follow' && activePlayerId) {
      this.focusOnPlayer(activePlayerId);
    }
  }

  focusOnPlayer(playerId) {
    const tokenMesh = this.playerTokens.get(playerId);
    if (!tokenMesh) return;
    const pos = tokenMesh.position;
    gsap.to(this.controls.target, { x: pos.x * 0.55, y: 0, z: pos.z * 0.55, duration: 0.85, ease: 'power2.out' });
    gsap.to(this.camera.position, {
      x: pos.x * 1.35,
      y: 14,
      z: pos.z * 1.35 + (pos.z >= 0 ? 7 : -7),
      duration: 0.95,
      ease: 'power2.out'
    });
  }

  setupInteractions() {
    let pointerDownPos = { x: 0, y: 0 };

    this.canvas.addEventListener('pointerdown', (e) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.tileMeshes, false);

      const lower = (idx) => {
        const m = this.tileMeshes[idx];
        if (m) gsap.to(m.position, { y: m.userData.baseY, duration: 0.2 });
      };

      if (hits.length > 0) {
        const hitIdx = hits[0].object.userData.tileIndex;
        this.onTileHover?.(hitIdx, e.clientX, e.clientY);
        if (this.hoveredTileIndex !== hitIdx) {
          if (this.hoveredTileIndex !== null) lower(this.hoveredTileIndex);
          this.hoveredTileIndex = hitIdx;
          const m = this.tileMeshes[hitIdx];
          gsap.to(m.position, { y: m.userData.baseY + 0.14, duration: 0.2 });
          this.canvas.style.cursor = 'pointer';
        }
      } else if (this.hoveredTileIndex !== null) {
        lower(this.hoveredTileIndex);
        this.hoveredTileIndex = null;
        this.canvas.style.cursor = 'grab';
        this.onTileHover?.(null);
      }
    });

    this.canvas.addEventListener('pointerleave', () => this.onTileHover?.(null));
    this.canvas.addEventListener('pointerdown', () => this.onTileHover?.(null));

    this.canvas.addEventListener('pointerup', (e) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 8) return;
      // On touch devices, pointermove might not have fired prior to pointerup, so raycast directly on tap
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.tileMeshes, false);
      if (hits.length > 0) {
        this.onTileSelected?.(hits[0].object.userData.tileIndex);
      }
    });
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    if (!this.cameraFollowMode && (this.currentPreset === 'overview' || this.currentPreset === 'topdown')) {
      this.setCameraPreset(this.currentPreset);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const t = this.clock.getElapsedTime();

    // Active player beacon follows and pulses around the token
    const activeToken = this.activePlayerId ? this.playerTokens.get(this.activePlayerId) : null;
    if (activeToken && this.beaconRing.visible) {
      const pulse = 1 + Math.sin(t * 4) * 0.08;
      this.beaconRing.position.set(activeToken.position.x, 0.24, activeToken.position.z);
      this.beaconRing.scale.set(pulse, pulse, pulse);
      this.beaconBeam.position.set(activeToken.position.x, 3.7, activeToken.position.z);
      this.beaconBeam.material.opacity = 0.07 + (Math.sin(t * 2.5) + 1) * 0.03;
      if (!activeToken.userData.isAnimating) {
        activeToken.rotation.y += 0.012;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    if (this.labelsVisible) {
      // Perspective-style scaling so outer-rim labels stay organized and never overlap neighbors
      for (const entry of this.labels.values()) {
        const dist = this.camera.position.distanceTo(entry.obj.position);
        const s = THREE.MathUtils.clamp(24 / dist, 0.44, 1.05).toFixed(2);
        if (s !== entry.lastScale) {
          entry.lastScale = s;
          entry.inner.style.transform = `scale(${s})`;
        }
        const hovered = this.hoveredTileIndex === entry.tile.index;
        if (hovered !== entry.hovered) {
          entry.hovered = hovered;
          entry.inner.classList.toggle('hovered', hovered);
        }
      }
      this.labelRenderer.render(this.scene, this.camera);
    }
  }
}
