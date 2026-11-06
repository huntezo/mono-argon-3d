import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export function createPlayerTokenMesh(tokenType, colorHex) {
  const group = new THREE.Group();
  const mainMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex),
    metalness: 0.72,
    roughness: 0.22
  });
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.85,
    roughness: 0.18
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex),
    emissive: new THREE.Color(colorHex),
    emissiveIntensity: 0.45,
    roughness: 0.2
  });

  // Pedestal base for all tokens
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.16, 24), baseMat);
  pedestal.position.y = 0.08;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  group.add(pedestal);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.04, 12, 28), glowMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.15;
  group.add(ring);

  switch (tokenType) {
    case 'crown': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.3, 0.42, 16), mainMat);
      body.position.y = 0.36;
      body.castShadow = true;
      group.add(body);

      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 8), mainMat);
        spike.position.set(Math.cos(angle) * 0.28, 0.68, Math.sin(angle) * 0.28);
        spike.castShadow = true;
        group.add(spike);
      }
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), glowMat);
      orb.position.y = 0.75;
      group.add(orb);
      break;
    }

    case 'racecar': {
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.2, 0.42), mainMat);
      chassis.position.y = 0.28;
      chassis.castShadow = true;
      group.add(chassis);

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.18, 0.32), glowMat);
      cabin.position.set(-0.05, 0.45, 0);
      cabin.castShadow = true;
      group.add(cabin);

      const wheelGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.1, 16);
      wheelGeo.rotateX(Math.PI / 2);
      const positions = [
        [-0.24, 0.22, 0.23],
        [0.24, 0.22, 0.23],
        [-0.24, 0.22, -0.23],
        [0.24, 0.22, -0.23]
      ];
      for (const [wx, wy, wz] of positions) {
        const w = new THREE.Mesh(wheelGeo, baseMat);
        w.position.set(wx, wy, wz);
        group.add(w);
      }
      break;
    }

    case 'tophat': {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 24), mainMat);
      brim.position.y = 0.2;
      brim.castShadow = true;
      group.add(brim);

      const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.1, 24), glowMat);
      ribbon.position.y = 0.28;
      group.add(ribbon);

      const tall = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.27, 0.58, 24), mainMat);
      tall.position.y = 0.52;
      tall.castShadow = true;
      group.add(tall);
      break;
    }

    case 'battleship': {
      const hull = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.85, 4), mainMat);
      hull.rotation.z = Math.PI / 2;
      hull.rotation.y = Math.PI / 4;
      hull.scale.set(1, 1, 0.55);
      hull.position.y = 0.3;
      hull.castShadow = true;
      group.add(hull);

      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.2), glowMat);
      tower.position.set(0, 0.52, 0);
      tower.castShadow = true;
      group.add(tower);
      break;
    }

    case 'obelisk': {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.32, 0.72, 6), mainMat);
      pillar.position.y = 0.52;
      pillar.castShadow = true;
      group.add(pillar);

      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), glowMat);
      crystal.position.y = 1.02;
      group.add(crystal);
      break;
    }

    default: {
      // Sky Jet / Aviator
      const fuselage = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.8, 16), mainMat);
      fuselage.rotation.z = -Math.PI / 2;
      fuselage.position.y = 0.38;
      fuselage.castShadow = true;
      group.add(fuselage);

      const wings = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.82), glowMat);
      wings.position.set(0, 0.38, 0);
      wings.castShadow = true;
      group.add(wings);
      break;
    }
  }

  return group;
}

export function createHouseMesh() {
  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x00e676,
    roughness: 0.35,
    metalness: 0.15
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x00a152,
    roughness: 0.4,
    metalness: 0.2
  });

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.28, 0.38), wallMat);
  base.position.y = 0.14;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.24, 4), roofMat);
  roof.position.y = 0.4;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  group.add(roof);

  return group;
}

export function createHotelMesh() {
  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xff1744,
    roughness: 0.25,
    metalness: 0.3
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    roughness: 0.2,
    metalness: 0.8
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.52, 0.48), wallMat);
  body.position.y = 0.26;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const crown = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.08, 0.54), goldMat);
  crown.position.y = 0.55;
  crown.castShadow = true;
  group.add(crown);

  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.28, 4), goldMat);
  spire.position.y = 0.72;
  spire.rotation.y = Math.PI / 4;
  spire.castShadow = true;
  group.add(spire);

  return group;
}

function makeDieFaceTexture(value) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Ivory glossy background with a soft vignette toward the rounded edges
  const bg = ctx.createRadialGradient(128, 128, 40, 128, 128, 190);
  bg.addColorStop(0, '#ffffff');
  bg.addColorStop(1, '#e7e2d6');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 256);

  const pipColor = value === 1 ? '#d61f2c' : '#111827';
  ctx.fillStyle = pipColor;

  const r = 22;
  const coords = {
    1: [[128, 128]],
    2: [[68, 68], [188, 188]],
    3: [[68, 68], [128, 128], [188, 188]],
    4: [[68, 68], [188, 68], [68, 188], [188, 188]],
    5: [[68, 68], [188, 68], [128, 128], [68, 188], [188, 188]],
    6: [[68, 60], [188, 60], [68, 128], [188, 128], [68, 196], [188, 196]]
  };

  for (const [cx, cy] of coords[value] || []) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createDieMesh() {
  // Standard Three.js BoxGeometry material order:
  // 0: +X (Right), 1: -X (Left), 2: +Y (Top), 3: -Y (Bottom), 4: +Z (Front), 5: -Z (Back)
  // Let's map values: +X=3, -X=4, +Y=1, -Y=6, +Z=2, -Z=5
  const faceOrder = [3, 4, 1, 6, 2, 5];
  const materials = faceOrder.map(val =>
    new THREE.MeshStandardMaterial({
      map: makeDieFaceTexture(val),
      roughness: 0.18,
      metalness: 0.08
    })
  );

  const geo = new RoundedBoxGeometry(1.05, 1.05, 1.05, 5, 0.14);
  const mesh = new THREE.Mesh(geo, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function getRotationForDieValue(value) {
  // Returns Euler angles [rx, ry, rz] so the face with `value` points straight up (+Y)
  // Recall faceOrder: +X=3, -X=4, +Y=1, -Y=6, +Z=2, -Z=5
  switch (value) {
    case 1:
      return [0, 0, 0]; // +Y is already up
    case 6:
      return [Math.PI, 0, 0]; // -Y up
    case 2:
      return [-Math.PI / 2, 0, 0]; // +Z up
    case 5:
      return [Math.PI / 2, 0, 0]; // -Z up
    case 3:
      return [0, 0, Math.PI / 2]; // +X up
    case 4:
      return [0, 0, -Math.PI / 2]; // -X up
    default:
      return [0, 0, 0];
  }
}

/* ───────── 3D Iconic World City Monuments ───────── */
export function createCityLandmarkMesh(tileIndex, groupColorHex = '#d4af37') {
  const group = new THREE.Group();
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    metalness: 0.78,
    roughness: 0.25
  });
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0xe2d9c5,
    metalness: 0.15,
    roughness: 0.55
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(groupColorHex),
    metalness: 0.45,
    roughness: 0.3
  });

  switch (tileIndex) {
    case 1: {
      // Cairo — Great Pyramid of Giza
      const pyr = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.46, 4), goldMat);
      pyr.position.y = 0.23;
      pyr.rotation.y = Math.PI / 4;
      pyr.castShadow = true;
      group.add(pyr);
      break;
    }
    case 8: {
      // Istanbul — Mosque Dome & Minaret
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.36), stoneMat);
      base.position.y = 0.1;
      group.add(base);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), goldMat);
      dome.position.y = 0.2;
      group.add(dome);
      break;
    }
    case 13: {
      // Rome — Colosseum Arch Ring
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.32, 16, 1, true), stoneMat);
      col.position.y = 0.16;
      col.castShadow = true;
      group.add(col);
      break;
    }
    case 18: {
      // Sydney — Opera House Sails
      for (let i = -1; i <= 1; i++) {
        const sail = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.38, 4), stoneMat);
        sail.position.set(i * 0.12, 0.19, 0);
        sail.rotation.z = -0.25;
        sail.castShadow = true;
        group.add(sail);
      }
      break;
    }
    case 19: {
      // Toronto — CN Tower
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.09, 0.65, 12), stoneMat);
      shaft.position.y = 0.325;
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 16), accentMat);
      pod.position.y = 0.46;
      group.add(shaft, pod);
      break;
    }
    case 31: {
      // Tokyo — Tokyo Tower / Pagoda Spire
      const redMat = new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.4, roughness: 0.3 });
      const tBase = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.68, 4), redMat);
      tBase.position.y = 0.34;
      tBase.rotation.y = Math.PI / 4;
      tBase.castShadow = true;
      group.add(tBase);
      break;
    }
    case 32: {
      // Paris — Eiffel Tower
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.26, 0.32, 4), goldMat);
      lower.position.y = 0.16;
      lower.rotation.y = Math.PI / 4;
      const upper = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.48, 4), goldMat);
      upper.position.y = 0.56;
      upper.rotation.y = Math.PI / 4;
      lower.castShadow = true;
      upper.castShadow = true;
      group.add(lower, upper);
      break;
    }
    case 34: {
      // London — Big Ben Clock Tower
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.54, 0.22), stoneMat);
      tower.position.y = 0.27;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.24, 4), goldMat);
      roof.position.y = 0.66;
      roof.rotation.y = Math.PI / 4;
      tower.castShadow = true;
      group.add(tower, roof);
      break;
    }
    case 37: {
      // Dubai — Burj Khalifa Tiered Skyscraper
      const t1 = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.3, 6), stoneMat);
      t1.position.y = 0.15;
      const t2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.3, 6), accentMat);
      t2.position.y = 0.45;
      const t3 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.38, 6), goldMat);
      t3.position.y = 0.79;
      t1.castShadow = true;
      t2.castShadow = true;
      t3.castShadow = true;
      group.add(t1, t2, t3);
      break;
    }
    case 39: {
      // New York — Statue of Liberty Pedestal & Torch Spire
      const ped = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), stoneMat);
      ped.position.y = 0.13;
      const statue = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 0.38, 12), new THREE.MeshStandardMaterial({ color: 0x34d399, roughness: 0.4 }));
      statue.position.y = 0.45;
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), goldMat);
      flame.position.set(0.06, 0.7, 0);
      group.add(ped, statue, flame);
      break;
    }
    default: {
      // Stylish Architectural Obelisk for all other world cities
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.24), stoneMat);
      base.position.y = 0.04;
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.32, 0.15), accentMat);
      pillar.position.y = 0.24;
      pillar.castShadow = true;
      group.add(base, pillar);
      break;
    }
  }

  return group;
}
