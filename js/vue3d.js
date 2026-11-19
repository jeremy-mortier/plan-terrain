// Vue 3D en consultation (terrain plat) : plan SPW, contour, éléments relevés et aménagement.
// Repère Three.js : x vers l'est, y vers le haut, z vers le sud (z = -nord).

import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coins, hauteur, estMarche, travees, estRemorque, TIMON } from './amenagement.js';
import { valeur } from './releve.js';

const RAYON = 120;              // on ne montre le plan SPW que dans ce rayon (m)
const H_BATIMENT = 6;           // hauteur par défaut des bâtiments voisins (inconnue au PICC)

const COULEURS = {
  sol: 0xdfe4dc, pelouse: 0xa9cf8f, batiment: 0xd8d2c8, eau: 0x8fc1e3, voirie: 0x9aa5a1,
  haie: 0x3f7f3a, muret: 0x9b8f80, cloture: 0x6e6a62, tronc: 0x6b4423, couronne: 0x4f9a4c,
  tente: 0xf4f7fb, toit: 0xcfe0f4, commerce: 0xf6dea2, sanitaire: 0xbde6de, technique: 0xd6c6ec,
  scene: 0xe9a996, mobilier: 0xc9c7bb, zone: 0x1d4e89, obstacle: 0x8a8378, autre: 0x9a6fc0,
  tube: 0x5b7472, tole: 0x8e9391, bache: 0x1f3f95, planche: 0x9a7a5c, poteauTente: 0xd2d4d4,
  caisse: 0xf3f4f2, chassis: 0x30373a, pneu: 0x1d2022, groupeFroid: 0x5a6264,
};

// Toile rayée rouge et blanc : une paire de bandes par mètre (u en mètres)
let texRayee = null;
function toileRayee() {
  if (texRayee) return texRayee;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 4;
  const x = c.getContext('2d');
  x.fillStyle = '#f4f2ee'; x.fillRect(0, 0, 64, 4);
  x.fillStyle = '#c4262e'; x.fillRect(0, 0, 32, 4);
  texRayee = new THREE.CanvasTexture(c);
  texRayee.wrapS = texRayee.wrapT = THREE.RepeatWrapping;
  texRayee.colorSpace = THREE.SRGBColorSpace;
  return texRayee;
}

// Quadrilatère p0-p1-p2-p3 ; u = distance en mètres le long de p0→p1, v = hauteur p0→p3 en mètres
function quad(p0, p1, p2, p3) {
  const L = p0.distanceTo(p1), H = p0.distanceTo(p3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([p0, p1, p2, p0, p2, p3].flatMap((p) => [p.x, p.y, p.z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, L, 0, L, H, 0, 0, L, H, 0, H], 2));
  g.computeVertexNormals();
  return g;
}

// Planches de bois horizontales (≈ 15 cm), v en mètres
let texBois = null;
function bois() {
  if (texBois) return texBois;
  const c = document.createElement('canvas');
  c.width = 16; c.height = 128;
  const x = c.getContext('2d');
  const teintes = ['#a07a52', '#946f49', '#a8815a', '#8f6a45', '#9c7650', '#a37c55'];
  for (let i = 0; i < 6; i++) {
    x.fillStyle = teintes[i]; x.fillRect(0, i * 128 / 6, 16, 128 / 6);
    x.fillStyle = 'rgba(40, 25, 10, .55)'; x.fillRect(0, i * 128 / 6, 16, 1.5);
  }
  texBois = new THREE.CanvasTexture(c);
  texBois.wrapS = texBois.wrapT = THREE.RepeatWrapping;
  texBois.repeat.set(1, 1 / 0.9);   // 6 planches sur 90 cm
  texBois.colorSpace = THREE.SRGBColorSpace;
  return texBois;
}

// Tôle ondulée (ondes dans le sens de la pente), entre x = -w/2 (arrière, hauteur hAr) et +w/2 (avant, hAv)
function toleOndulee(w, l, hAv, hAr, materiau, debord = { av: 0.25, ar: 0.12, cote: 0.1 }) {
  const yToit = (x) => hAr + (x + w / 2) / w * (hAv - hAr);
  const pas = 0.177, ampl = 0.018;
  const segZ = Math.max(8, Math.round((l + 2 * debord.cote) / (pas / 4)));
  const toit = new THREE.PlaneGeometry(w + debord.av + debord.ar, l + 2 * debord.cote, 1, segZ);
  toit.rotateX(-Math.PI / 2);
  toit.translate((debord.av - debord.ar) / 2, 0, 0);
  const pos = toit.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, yToit(pos.getX(i)) + 0.03 + ampl * Math.sin(2 * Math.PI * pos.getZ(i) / pas));
  toit.computeVertexNormals();
  const m = new THREE.Mesh(toit, materiau('tole', { side: THREE.DoubleSide }));
  m.castShadow = m.receiveShadow = true;
  return m;
}

// Buvette en bois : murs en planches, comptoir sur la façade (x = +w/2) avec grande ouverture,
// porte à l'arrière, toit en tôle ondulée à une pente vers l'arrière.
function buvette(o, h, materiau) {
  const g = new THREE.Group(), w = o.w, l = o.l;
  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  const hAv = h, hAr = Math.max(h - 0.3, 1.9);
  const yToit = (x) => hAr + (x + w / 2) / w * (hAv - hAr);
  const mBois = new THREE.MeshLambertMaterial({ map: bois(), side: THREE.DoubleSide });
  const murs = [];
  // arrière et côtés (les côtés suivent la pente du toit)
  murs.push(quad(P(-w / 2, 0, l / 2), P(-w / 2, 0, -l / 2), P(-w / 2, hAr, -l / 2), P(-w / 2, hAr, l / 2)));
  for (const z of [-l / 2, l / 2]) {
    const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(w / 2, yToit(w / 2)), new THREE.Vector2(-w / 2, yToit(-w / 2))]);
    const c = new THREE.ShapeGeometry(s);
    c.translate(0, 0, z);
    murs.push(c.toNonIndexed());
  }
  // façade : bas jusqu'au comptoir (1,05 m), montants aux bouts, bandeau sous le toit
  const comptoir = 1.05, montant = Math.min(0.5, l * 0.12), bandeau = 0.35;
  murs.push(quad(P(w / 2, 0, -l / 2), P(w / 2, 0, l / 2), P(w / 2, comptoir, l / 2), P(w / 2, comptoir, -l / 2)));
  for (const [z0, z1] of [[-l / 2, -l / 2 + montant], [l / 2 - montant, l / 2]]) murs.push(quad(P(w / 2, comptoir, z0), P(w / 2, comptoir, z1), P(w / 2, hAv, z1), P(w / 2, hAv, z0)));
  murs.push(quad(P(w / 2, hAv - bandeau, -l / 2), P(w / 2, hAv - bandeau, l / 2), P(w / 2, hAv, l / 2), P(w / 2, hAv, -l / 2)));
  const mesh = new THREE.Mesh(mergeGeometries(murs.map((m) => (m.index ? m.toNonIndexed() : m))), mBois);
  mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh);
  // tablette du comptoir, débordant vers l'extérieur
  const tab = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, l - 2 * montant), materiau('planche'));
  tab.position.set(w / 2 + 0.12, comptoir + 0.025, 0);
  tab.castShadow = true;
  g.add(tab);
  g.add(toleOndulee(w, l, hAv, hAr, materiau, { av: 0.4, ar: 0.15, cote: 0.15 }));
  return g;
}

// Chapiteau ou tonnelle : toit à deux pans dans le sens de la longueur, toile blanche ou rayée,
// côtés fermés ou non (sinon poteaux + lambrequin), plancher en option.
function chapiteau(o, h, materiau) {
  const g = new THREE.Group(), w = o.w, l = o.l;
  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  const raye = o.toile === 'raye';
  const toile = raye
    ? new THREE.MeshLambertMaterial({ map: toileRayee(), side: THREE.DoubleSide })
    : new THREE.MeshLambertMaterial({ color: 0xf5f4ef, side: THREE.DoubleSide });
  const y0 = o.plancher ? 0.12 : 0;
  const faite = Math.min(w * 0.35, 2.5), yF = h + faite;
  const ombre = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const pans = [];
  // toit : deux pans (rayures du faîte vers le bas) + pignons
  pans.push(quad(P(-w / 2, h, -l / 2), P(-w / 2, h, l / 2), P(0, yF, l / 2), P(0, yF, -l / 2)));
  pans.push(quad(P(w / 2, h, l / 2), P(w / 2, h, -l / 2), P(0, yF, -l / 2), P(0, yF, l / 2)));
  for (const z of [-l / 2, l / 2]) {
    const t = new THREE.BufferGeometry();
    t.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, h, z, w / 2, h, z, 0, yF, z], 3));
    t.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, w, 0, w / 2, 1], 2));
    t.computeVertexNormals();
    pans.push(t);
  }
  // côtés fermés, ou simple lambrequin de 30 cm sous la gouttière
  const bas = o.cotes === false ? h - 0.3 : y0;
  const c = [P(-w / 2, 0, -l / 2), P(w / 2, 0, -l / 2), P(w / 2, 0, l / 2), P(-w / 2, 0, l / 2)];
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    pans.push(quad(P(a.x, bas, a.z), P(b.x, bas, b.z), P(b.x, h, b.z), P(a.x, h, a.z)));
  }
  g.add(ombre(new THREE.Mesh(mergeGeometries(pans), toile)));
  // poteaux aux coins et tous les 3 m environ sur les longs côtés
  const n = Math.max(1, Math.round(l / 3)), tubes = [];
  for (let i = 0; i <= n; i++) {
    for (const x of [-w / 2, w / 2]) {
      const t = new THREE.CylinderGeometry(0.04, 0.04, h - y0, 8);
      t.translate(x, y0 + (h - y0) / 2, -l / 2 + i * l / n);
      tubes.push(t.toNonIndexed());
    }
  }
  g.add(ombre(new THREE.Mesh(mergeGeometries(tubes), materiau('poteauTente'))));
  // plancher
  if (o.plancher) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.12, l + 0.1), materiau('planche'));
    p.position.y = 0.06;
    p.receiveShadow = true;
    g.add(p);
  }
  return g;
}

// Scène : plateau en planches de bois à la hauteur choisie, jupe en bois, escalier sur un petit côté
function scene3D(o, h, materiau) {
  const g = new THREE.Group(), w = o.w, l = o.l, H = Math.max(h, 0.1);
  const cote = new THREE.MeshLambertMaterial({ map: bois(), side: THREE.DoubleSide });
  const dessus = bois().clone();
  dessus.needsUpdate = true;
  dessus.repeat.set(1, 1 / 0.9);
  const plateau = new THREE.Mesh(new THREE.BoxGeometry(w, H, l), [cote, cote, new THREE.MeshLambertMaterial({ map: dessus }), cote, cote, cote]);
  // uv des faces latérales en mètres pour garder des planches de 15 cm
  const uv = plateau.geometry.attributes.uv, pos = plateau.geometry.attributes.position, nrm = plateau.geometry.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (Math.abs(nrm.getY(i)) > 0.5) uv.setXY(i, x, z);                 // dessus : planches le long de la largeur
    else if (Math.abs(nrm.getX(i)) > 0.5) uv.setXY(i, z, y + H / 2);
    else uv.setXY(i, x, y + H / 2);
  }
  plateau.position.y = H / 2;
  plateau.castShadow = plateau.receiveShadow = true;
  g.add(plateau);
  // escalier (marches de 18 cm) devant le petit côté sud, si la scène est haute
  const nb = Math.round(H / 0.18);
  if (nb >= 2) {
    const marches = [];
    for (let i = 1; i < nb; i++) {
      const b = new THREE.BoxGeometry(1.2, i * H / nb, 0.3);
      b.translate(w / 2 - 0.8, i * H / nb / 2, l / 2 + (nb - i) * 0.3 - 0.15);
      marches.push(b.toNonIndexed());
    }
    const m = new THREE.Mesh(mergeGeometries(marches), materiau('planche'));
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

// Remorques : frigo double essieu (timon + groupe froid) ou semi-remorque (3 essieux à l'arrière, béquilles).
// L'avant est vers le nord local (z négatif), côté poignée de rotation sur le plan.
function remorque3D(o, h, materiau, semi) {
  const g = new THREE.Group(), w = o.w, l = o.l;
  const lt = semi ? 0 : Math.min(TIMON, l * 0.45), lb = l - lt;
  const zAv = -l / 2 + lt, zc = zAv + lb / 2, yBas = semi ? 1.25 : 0.75;
  const ombre = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const boite = (sx, sy, sz, x, y, z, mat) => { const m = ombre(new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), materiau(mat))); m.position.set(x, y, z); g.add(m); return m; };

  // caisse isotherme blanche + arêtes
  const caisse = boite(w, h - yBas, lb, 0, (h + yBas) / 2, zc, 'caisse');
  const ar = new THREE.LineSegments(new THREE.EdgesGeometry(caisse.geometry), new THREE.LineBasicMaterial({ color: 0x5d6466 }));
  ar.position.copy(caisse.position);
  g.add(ar);
  // portes arrière : joint central et charnières
  boite(0.04, h - yBas - 0.1, 0.02, 0, (h + yBas) / 2, l / 2 + 0.01, 'chassis');
  // châssis
  boite(w * 0.8, 0.16, lb - 0.2, 0, yBas - 0.08, zc, 'chassis');
  // roues
  const r = semi ? 0.5 : 0.33, lr = semi ? 0.55 : 0.2, nb = semi ? 3 : 2, pas = semi ? 1.31 : 0.9;
  const z0 = semi ? l / 2 - 1.5 - (nb - 1) * pas : zc + lb * 0.05 - (nb - 1) * pas / 2;
  const roues = [];
  for (let i = 0; i < nb; i++) {
    for (const s of [-1, 1]) {
      const c = new THREE.CylinderGeometry(r, r, lr, 18);
      c.rotateZ(Math.PI / 2);
      c.translate(s * (w / 2 - lr / 2 - 0.03), r, z0 + i * pas);
      roues.push(c.toNonIndexed());
    }
  }
  g.add(ombre(new THREE.Mesh(mergeGeometries(roues), materiau('pneu'))));
  if (semi) {
    // béquilles avant et pivot d'attelage
    for (const s of [-1, 1]) boite(0.12, yBas - 0.1, 0.12, s * w * 0.35, (yBas - 0.1) / 2, zAv + 2.4, 'chassis');
    boite(w * 0.75, 0.1, 0.3, 0, 0.05, zAv + 2.4, 'chassis');
  } else {
    // timon en V et roue jockey
    const pointe = new THREE.Vector3(0, 0.5, -l / 2 + 0.1);
    for (const s of [-1, 1]) {
      const a = new THREE.Vector3(s * w * 0.3, 0.6, zAv + 0.2), L = a.distanceTo(pointe);
      const b = ombre(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, L), materiau('chassis')));
      b.position.copy(a.clone().add(pointe).multiplyScalar(0.5));
      b.lookAt(pointe);
      g.add(b);
    }
    boite(0.06, 0.5, 0.06, 0, 0.3, -l / 2 + 0.45, 'chassis');
    const jockey = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12), materiau('pneu'));
    jockey.rotation.z = Math.PI / 2;
    jockey.position.set(0, 0.1, -l / 2 + 0.45);
    g.add(jockey);
    // groupe froid sur la face avant
    boite(w * 0.7, 0.6, 0.35, 0, h - 0.45, zAv - 0.17, 'groupeFroid');
  }
  return g;
}

// Stand de marché d'après la photo : tubes métalliques, tôle ondulée presque plate (pente vers l'arrière),
// bâche bleue au fond et aux deux bouts, façade ouverte, pas de plancher.
// Repère local : x = profondeur (façade ouverte en x = +w/2), z = longueur de la façade.
function standMarche(o, h, materiau) {
  const g = new THREE.Group();
  const w = o.w, l = o.l, n = travees(o);
  const hAv = h, hAr = Math.max(h - 0.25, 1.5);                 // la tôle descend vers l'arrière
  const yToit = (x) => hAr + (x + w / 2) / w * (hAv - hAr);
  const ombre = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // tubes verticaux à chaque séparation, devant et derrière
  const tubes = [];
  for (let i = 0; i <= n; i++) {
    const z = -l / 2 + i * l / n;
    for (const x of [-w / 2, w / 2]) {
      const t = new THREE.CylinderGeometry(0.025, 0.025, yToit(x), 6);
      t.translate(x, yToit(x) / 2, z);
      tubes.push(t);
    }
    // traverses basses au sol et de toit, d'avant en arrière
    for (const y of [0.05, null]) {
      const L = Math.hypot(w, y == null ? hAv - hAr : 0);
      const t = new THREE.CylinderGeometry(0.02, 0.02, L, 6);
      t.rotateZ(Math.PI / 2);
      if (y == null) t.rotateZ(Math.atan2(hAv - hAr, w));
      t.translate(0, y ?? (hAv + hAr) / 2 - 0.04, z);
      tubes.push(t);
    }
  }
  // lisses horizontales le long de la façade et du fond (haut et à mi-hauteur au fond)
  for (const [x, y] of [[w / 2, hAv - 0.05], [-w / 2, hAr - 0.05], [-w / 2, 1.1], [w / 2, 0.05], [-w / 2, 0.05]]) {
    const t = new THREE.CylinderGeometry(0.02, 0.02, l, 6);
    t.rotateX(Math.PI / 2);
    t.translate(x, y, 0);
    tubes.push(t);
  }
  g.add(ombre(new THREE.Mesh(mergeGeometries(tubes.map((t) => t.toNonIndexed())), materiau('tube'))));

  // tôle ondulée : ondes dans le sens de la pente (d'avant en arrière)
  const debord = { av: 0.25, ar: 0.12, cote: 0.1 };
  const pas = 0.177, ampl = 0.018;
  const segZ = Math.max(8, Math.round((l + 2 * debord.cote) / (pas / 4)));
  const toit = new THREE.PlaneGeometry(w + debord.av + debord.ar, l + 2 * debord.cote, 1, segZ);
  toit.rotateX(-Math.PI / 2);
  toit.translate((debord.av - debord.ar) / 2, 0, 0);
  const pos = toit.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, yToit(x) + 0.03 + ampl * Math.sin(2 * Math.PI * z / pas));
  }
  toit.computeVertexNormals();
  g.add(ombre(new THREE.Mesh(toit, materiau('tole', { side: THREE.DoubleSide }))));

  // bâches bleues : fond + les deux bouts de la rangée (pas de cloison entre emplacements)
  const bache = materiau('bache', { side: THREE.DoubleSide });
  const fond = new THREE.PlaneGeometry(l, hAr - 0.1);
  fond.rotateY(Math.PI / 2);
  fond.translate(-w / 2 + 0.03, (hAr - 0.1) / 2 + 0.05, 0);
  const pans = [fond];
  for (const z of [-l / 2, l / 2]) {
    // pan trapézoïdal qui suit la pente du toit
    const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0.05), new THREE.Vector2(w / 2 - 0.05, 0.05), new THREE.Vector2(w / 2 - 0.05, yToit(w / 2) - 0.1), new THREE.Vector2(-w / 2, yToit(-w / 2) - 0.1)]);
    const c = new THREE.ShapeGeometry(s);
    c.translate(0, 0, z);
    pans.push(c);
  }
  g.add(ombre(new THREE.Mesh(mergeGeometries(pans.map((p) => (p.index ? p.toNonIndexed() : p)).map((p) => { p.deleteAttribute('uv'); return p; })), bache)));
  return g;
}

export function ouvrir(conteneur, plan) {
  const largeur = () => conteneur.clientWidth || 1, hauteurEcran = () => conteneur.clientHeight || 1;
  const rendu = new THREE.WebGLRenderer({ antialias: true });
  rendu.setPixelRatio(Math.min(devicePixelRatio, 2));
  rendu.setSize(largeur(), hauteurEcran());
  rendu.shadowMap.enabled = true;
  rendu.shadowMap.type = THREE.PCFSoftShadowMap;
  conteneur.prepend(rendu.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdde8ef);
  scene.fog = new THREE.Fog(0xdde8ef, 160, 320);

  // centre : milieu du contour, sinon l'adresse
  const pts = plan.contour.points;
  const c = pts.length ? { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length } : { x: 0, y: 0 };
  const V = (p) => new THREE.Vector3(p.x - c.x, 0, -(p.y - c.y));
  const proche = (x, y) => Math.hypot(x - c.x, y - c.y) < RAYON;

  // lumières
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa38f, 1.1));
  const soleil = new THREE.DirectionalLight(0xffffff, 1.6);
  soleil.position.set(-40, 70, 50);          // soleil au sud-ouest
  soleil.castShadow = true;
  soleil.shadow.mapSize.set(2048, 2048);
  Object.assign(soleil.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 250 });
  soleil.shadow.bias = -0.0005;
  scene.add(soleil);

  const mat = {};
  const materiau = (nom, opts = {}) => (mat[nom + JSON.stringify(opts)] ??= new THREE.MeshLambertMaterial({ color: COULEURS[nom], ...opts }));
  const geoms = {};                                   // géométries à fusionner par matériau
  const ajouterGeo = (cle, g) => (geoms[cle] ??= []).push(g);

  // sol
  const sol = new THREE.Mesh(new THREE.PlaneGeometry(RAYON * 3, RAYON * 3), materiau('sol'));
  sol.rotation.x = -Math.PI / 2;
  sol.receiveShadow = true;
  scene.add(sol);

  // forme plate ou extrudée à partir d'anneaux [[x,y],...] (le premier = extérieur)
  const forme = (anneaux) => {
    const s = new THREE.Shape(anneaux[0].map(([x, y]) => new THREE.Vector2(x - c.x, y - c.y)));
    for (const r of anneaux.slice(1)) s.holes.push(new THREE.Path(r.map(([x, y]) => new THREE.Vector2(x - c.x, y - c.y))));
    return s;
  };
  const extruder = (anneaux, h, y0 = 0) => {
    const g = h > 0 ? new THREE.ExtrudeGeometry(forme(anneaux), { depth: h, bevelEnabled: false }) : new THREE.ShapeGeometry(forme(anneaux));
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0, 0);
    return g;
  };
  // mur (boîte) le long d'un segment
  const muret = (a, b, h, ep, y0 = 0) => {
    const A = V(a), B = V(b), L = A.distanceTo(B);
    if (L < 0.01) return null;
    const g = new THREE.BoxGeometry(L, h, Math.max(ep, 0.04));
    g.rotateY(Math.atan2(-(B.z - A.z), B.x - A.x));
    g.translate((A.x + B.x) / 2, y0 + h / 2, (A.z + B.z) / 2);
    return g;
  };
  const ligneMurs = (points, h, ep, cle) => {
    for (let i = 0; i < points.length - 1; i++) { const g = muret(points[i], points[i + 1], h, ep); if (g) ajouterGeo(cle, g); }
  };
  const arbre = (p, { tronc = 0.3, couronne = 4, branches, total }) => {
    const H = Math.max(total ?? 8, 2), hb = Math.min(branches ?? Math.min(2.5, H * 0.35), H - 0.8);
    const r = Math.max(tronc / 2, 0.06), R = Math.max(couronne / 2, 0.5), P = V(p);
    const t = new THREE.CylinderGeometry(r * 0.85, r, hb + (H - hb) * 0.3, 10);
    t.translate(P.x, (hb + (H - hb) * 0.3) / 2, P.z);
    ajouterGeo('tronc', t);
    const s = new THREE.SphereGeometry(1, 18, 12);
    s.scale(R, (H - hb) / 2, R);
    s.translate(P.x, hb + (H - hb) / 2, P.z);
    ajouterGeo('couronne', s);
  };

  // ------------------------------------------------ plan SPW
  const lignesSol = [];
  for (const o of plan.picc.objets) {
    const p0 = o.g[0];
    if (o.t === 'p') {
      if (!proche(p0[0], p0[1])) continue;
      if (o.k === 'arbre') arbre({ x: p0[0], y: p0[1] }, { couronne: 4 });
      else if (o.k === 'poteau') { const g = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 8); const P = V({ x: p0[0], y: p0[1] }); g.translate(P.x, 0.6, P.z); ajouterGeo('cloture', g); }
      continue;
    }
    const premier = o.t === 'a' ? o.g[0][0] : p0;
    if (!proche(premier[0], premier[1])) continue;
    if (o.t === 'a') {
      if (o.k === 'batiment' || o.k === 'ouvrage') ajouterGeo('batiment', extruder(o.g, o.k === 'batiment' ? H_BATIMENT : 1));
      else if (o.k === 'eau') ajouterGeo('eau', extruder(o.g, 0, 0.02));
      continue;
    }
    const P = o.g.map(([x, y]) => ({ x, y }));
    if (o.k === 'haie') ligneMurs(P, 1.6, 0.8, 'haie');
    else if (o.k === 'muret') ligneMurs(P, 0.8, 0.2, 'muret');
    else if (o.k === 'cloture') ligneMurs(P, 1.2, 0.04, 'cloture');
    else for (let i = 0; i < P.length - 1; i++) lignesSol.push(V(P[i]).setY(0.03), V(P[i + 1]).setY(0.03));
  }
  if (lignesSol.length) scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lignesSol), new THREE.LineBasicMaterial({ color: COULEURS.voirie })));

  // ------------------------------------------------ terrain
  if (plan.contour.ferme && pts.length >= 3) {
    const m = new THREE.Mesh(extruder([pts.map((p) => [p.x, p.y])], 0, 0.015), materiau('pelouse'));
    m.receiveShadow = true;
    scene.add(m);
    const bord = pts.map((p) => V(p).setY(0.05));
    scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(bord), new THREE.LineBasicMaterial({ color: 0x1d4e89 })));
  }

  // ------------------------------------------------ éléments relevés
  for (const e of plan.elements) {
    const p = e.points;
    if (e.type === 'arbre') {
      arbre(p[0], { tronc: (valeur(e, 'tronc') || 30) / 100, couronne: valeur(e, 'couronne') || 4, branches: e.attrs.branches != null ? +e.attrs.branches : undefined, total: e.attrs.hauteur != null ? +e.attrs.hauteur : undefined });
    } else if (e.forme === 'point') {
      const r = (valeur(e, 'largeur') || 0.5) / 2, h = valeur(e, 'hauteur') || 1, P = V(p[0]);
      const g = new THREE.CylinderGeometry(r, r, h, 16); g.translate(P.x, h / 2, P.z); ajouterGeo('autre', g);
    } else if (e.forme === 'surface') {
      ajouterGeo('autre', extruder([p.map((q) => [q.x, q.y])], valeur(e, 'hauteur') || 0.3));
    } else {
      const defaut = { haie: [1.6, 0.8], muret: [1, 0.2], autre: [1, 0.2] }[e.type];
      const ep = (e.type === 'autre' ? valeur(e, 'largeur') : valeur(e, 'epaisseur')) || defaut[1];
      ligneMurs(p, valeur(e, 'hauteur') || defaut[0], ep, e.type === 'autre' ? 'autre' : e.type);
    }
  }

  // ------------------------------------------------ aménagement
  for (const o of plan.amenagement) {
    const h = hauteur(o), P = V(o), groupe = new THREE.Group();
    if (o.cat === 'zone') {
      const z = new THREE.Mesh(new THREE.BoxGeometry(o.w, 0.04, o.l), new THREE.MeshLambertMaterial({ color: COULEURS.zone, transparent: true, opacity: 0.25 }));
      z.position.y = 0.04;
      groupe.add(z);
    } else if (estMarche(o)) {
      groupe.add(standMarche(o, h, materiau));
    } else if (o.modele === 'semi' || estRemorque(o)) {
      groupe.add(remorque3D(o, h, materiau, o.modele === 'semi'));
    } else if (o.modele === 'buvette') {
      groupe.add(buvette(o, h, materiau));
    } else if (o.cat === 'tente') {
      groupe.add(chapiteau(o, h, materiau));
    } else if (o.cat === 'scene') {
      groupe.add(scene3D(o, h, materiau));
    } else {
      const corps = new THREE.Mesh(new THREE.BoxGeometry(o.w, Math.max(h, 0.05), o.l), materiau(o.cat in COULEURS ? o.cat : 'autre'));
      corps.position.y = Math.max(h, 0.05) / 2;
      corps.castShadow = corps.receiveShadow = true;
      groupe.add(corps);
      if (o.cat === 'tente') {
        // toit à deux pans dans le sens de la longueur
        const faite = Math.min(o.w * 0.35, 2.5);
        const tri = new THREE.Shape([new THREE.Vector2(-o.w / 2, 0), new THREE.Vector2(o.w / 2, 0), new THREE.Vector2(0, faite)]);
        const g = new THREE.ExtrudeGeometry(tri, { depth: o.l, bevelEnabled: false });
        g.translate(0, h, -o.l / 2);
        const toit = new THREE.Mesh(g, materiau('toit'));
        toit.castShadow = true;
        groupe.add(toit);
      }
      // arêtes pour bien lire les volumes
      const aretes = new THREE.LineSegments(new THREE.EdgesGeometry(corps.geometry), new THREE.LineBasicMaterial({ color: 0x13201e, transparent: true, opacity: 0.35 }));
      aretes.position.copy(corps.position);
      groupe.add(aretes);
    }
    groupe.position.set(P.x, 0, P.z);
    groupe.rotation.y = -o.rot * Math.PI / 180;
    scene.add(groupe);
  }

  // fusion des géométries par matériau (beaucoup plus léger à afficher)
  for (const [cle, liste] of Object.entries(geoms)) {
    const g = mergeGeometries(liste.map((x) => (x.index ? x.toNonIndexed() : x)));
    liste.forEach((x) => x.dispose());
    const m = new THREE.Mesh(g, materiau(cle, cle === 'couronne' ? { transparent: true, opacity: 0.88 } : {}));
    m.castShadow = cle !== 'eau';
    m.receiveShadow = true;
    scene.add(m);
  }

  // ------------------------------------------------ caméra et contrôles
  const tailleTerrain = pts.length ? Math.max(...pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y))) : 40;
  const D = Math.max(tailleTerrain * 2.2, 30);
  const camera = new THREE.PerspectiveCamera(50, largeur() / hauteurEcran(), 0.1, 1000);
  // Commandes façon carte : glisser (1 doigt / clic gauche) = se déplacer sur le sol,
  // 2 doigts / clic droit = tourner et incliner, molette / pincer = zoomer vers l'endroit visé
  const ctrl = new MapControls(camera, rendu.domElement);
  ctrl.enableDamping = true;
  ctrl.dampingFactor = 0.12;
  ctrl.zoomToCursor = true;
  ctrl.maxPolarAngle = Math.PI / 2 - 0.03;
  ctrl.minDistance = 1;
  ctrl.maxDistance = 400;

  // Déplacements au clavier ou aux boutons : avancer / reculer / gauche / droite dans le sens du regard
  const avant = new THREE.Vector3(), droite = new THREE.Vector3(), haut = new THREE.Vector3(0, 1, 0);
  function deplacer(av, dr) {
    const d = Math.max(camera.position.distanceTo(ctrl.target) * 0.06, 0.4);   // pas proportionnel au zoom
    avant.subVectors(ctrl.target, camera.position).setY(0).normalize();
    droite.crossVectors(avant, haut).normalize();
    const v = avant.multiplyScalar(av * d).add(droite.multiplyScalar(dr * d));
    camera.position.add(v);
    ctrl.target.add(v);
    ctrl.update();
  }
  // Tourner le regard sur place (comme tourner la tête) : la caméra ne bouge pas, le point visé tourne autour d'elle.
  // lacet = gauche/droite, tangage = haut/bas (radians). Le point visé reste posé au sol.
  function regarder(lacet, tangage = 0) {
    const dir = ctrl.target.clone().sub(camera.position);
    dir.applyAxisAngle(haut, lacet);
    if (tangage) {
      const axe = new THREE.Vector3().crossVectors(dir, haut).normalize();
      const essai = dir.clone().applyAxisAngle(axe, tangage).normalize();
      if (essai.y < -0.04 && essai.y > -0.995) dir.copy(essai);   // toujours un peu vers le bas, jamais à la verticale
    }
    dir.normalize();
    // nouveau point visé : là où le regard touche le sol (limité à 200 m devant)
    const t = dir.y < -0.01 ? Math.min(camera.position.y / -dir.y, 200) : 200;
    ctrl.target.copy(camera.position).addScaledVector(dir, t);
    if (ctrl.target.y < 0) ctrl.target.y = 0;
    ctrl.update();
  }
  const tourner = (degres) => regarder(degres * Math.PI / 180, 0);

  // Souris : clic gauche + glisser = tourner le regard (gauche/droite et haut/bas) ;
  // clic droit + glisser = se déplacer ; Maj + clic droit = tourner autour du centre ; molette = zoom
  ctrl.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  let regard = null;
  rendu.domElement.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    regard = { x: e.clientX, y: e.clientY, id: e.pointerId };
    rendu.domElement.style.cursor = 'grabbing';
  });
  rendu.domElement.addEventListener('pointermove', (e) => {
    if (!regard || e.pointerId !== regard.id) return;
    const dx = e.clientX - regard.x, dy = e.clientY - regard.y;
    regard.x = e.clientX; regard.y = e.clientY;
    regarder(dx * 0.005, dy * 0.004);   // on « attrape » le paysage, comme dans Street View
  });
  const finRegard = () => { regard = null; rendu.domElement.style.cursor = ''; };
  rendu.domElement.addEventListener('pointerup', finRegard);
  rendu.domElement.addEventListener('pointercancel', finRegard);
  rendu.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  function zoomer(f) {
    const off = camera.position.clone().sub(ctrl.target);
    const L = Math.min(Math.max(off.length() * f, ctrl.minDistance), ctrl.maxDistance);
    camera.position.copy(ctrl.target).add(off.setLength(L));
    ctrl.update();
  }

  function pointDeVue(nom) {
    if (nom === 'dessus') { camera.position.set(0, D * 1.25, 0.01); ctrl.target.set(0, 0, 0); }
    else if (nom === 'pieton') {
      // au bord sud du terrain, à hauteur d'yeux, regard vers le centre
      const sud = pts.length ? pts.reduce((a, b) => (b.y < a.y ? b : a)) : { x: c.x, y: c.y - 20 };
      const P = V(sud);
      camera.position.set(P.x * 1.15, 1.7, P.z * 1.15 + 2);
      ctrl.target.set(0, 1.5, 0);
    } else { camera.position.set(-D * 0.35, D * 0.55, D * 0.75); ctrl.target.set(0, 0, 0); }
    ctrl.update();
  }
  pointDeVue('oblique');

  // double-clic / double-touche : s'approcher de l'endroit visé
  const rayon = new THREE.Raycaster();
  rendu.domElement.addEventListener('dblclick', (e) => {
    const r = rendu.domElement.getBoundingClientRect();
    rayon.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = rayon.intersectObjects(scene.children, true).find((i) => i.object.isMesh);
    if (!hit) return;
    const decalage = camera.position.clone().sub(ctrl.target).multiplyScalar(0.45);
    if (decalage.length() < 6) decalage.setLength(6);
    ctrl.target.copy(hit.point);
    camera.position.copy(hit.point.clone().add(decalage));
    ctrl.update();
  });

  let actif = true;
  const boucle = () => {
    if (!actif) return;
    ctrl.update();
    rendu.render(scene, camera);
    requestAnimationFrame(boucle);
  };
  boucle();

  const ro = new ResizeObserver(() => {
    camera.aspect = largeur() / hauteurEcran();
    camera.updateProjectionMatrix();
    rendu.setSize(largeur(), hauteurEcran());
  });
  ro.observe(conteneur);

  return {
    pointDeVue, deplacer, tourner, zoomer,
    fermer() {
      actif = false;
      ro.disconnect();
      ctrl.dispose();
      scene.traverse((o) => { o.geometry?.dispose(); });
      Object.values(mat).forEach((m) => m.dispose());
      rendu.dispose();
      rendu.domElement.remove();
    },
  };
}
