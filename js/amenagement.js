// Aménagement : catalogue, géométrie des objets posés (rectangles tournés), alertes et liste du matériel.
// Un objet : { id, nom, cat, w (largeur, m), l (longueur, m), x, y (centre), rot (degrés, sens horaire, 0 = longueur vers le nord) }

import { aire } from './geom.js';
import { valeur } from './releve.js';

export const CATEGORIES = {
  tente: 'Tente, chapiteau',
  commerce: 'Stand, commerce',
  sanitaire: 'Sanitaires',
  technique: 'Technique',
  scene: 'Scène, animation',
  mobilier: 'Mobilier',
  zone: 'Zone (allée, public…)',
  obstacle: 'Obstacle fixe',
};

// Catalogue de base (repris de la première version de l'application)
// h = hauteur (m) ; pour les tentes, hauteur des côtés, le toit vient en plus
export const CATALOGUE = [
  { nom: 'Chapiteau', w: 10, l: 20, h: 3, cat: 'tente' },
  { nom: 'Chapiteau', w: 6, l: 12, h: 2.5, cat: 'tente' },
  { nom: 'Tonnelle', w: 3, l: 3, h: 2.2, cat: 'tente' },
  // stands de marché (tubes, tôle ondulée, bâches) : profondeur = largeur, façade ouverte = longueur
  // travee = largeur d'un emplacement en façade
  { nom: 'Stand de marché', w: 3, l: 3, h: 2.3, cat: 'commerce', modele: 'marche', travee: 3 },
  { nom: 'Stand de marché étroit', w: 3, l: 2.5, h: 2.3, cat: 'commerce', modele: 'marche', travee: 2.5 },
  { nom: 'Rangée de 5 stands', w: 3, l: 15, h: 2.3, cat: 'commerce', modele: 'marche', travee: 3 },
  { nom: 'Rangée de 5 stands étroits', w: 3, l: 12.5, h: 2.3, cat: 'commerce', modele: 'marche', travee: 2.5 },
  { nom: 'Buvette en bois', w: 3, l: 5, h: 2.5, cat: 'commerce', modele: 'buvette' },
  { nom: 'Food truck', w: 2.5, l: 7, h: 3, cat: 'commerce' },
  // longueur timon compris (≈ 1,3 m) ; le timon est du côté de la poignée de rotation
  { nom: 'Remorque frigo double essieu', w: 2.2, l: 6, h: 2.8, cat: 'technique', modele: 'remorque' },
  { nom: 'Semi-remorque de camion', w: 2.55, l: 13.6, h: 4, cat: 'technique', modele: 'semi' },
  { nom: 'Groupe électrogène', w: 1.2, l: 2.5, h: 1.5, cat: 'technique' },
  { nom: 'Toilette', w: 1.2, l: 1.2, h: 2.3, cat: 'sanitaire' },
  { nom: 'Remorque WC', w: 2.3, l: 4, h: 2.8, cat: 'sanitaire' },
  { nom: 'Scène', w: 8, l: 6, h: 1, cat: 'scene' },
  { nom: 'Table et bancs', w: 1.8, l: 2.2, h: 0.75, cat: 'mobilier' },
  { nom: 'Poubelle', w: 0.8, l: 0.8, h: 1, cat: 'mobilier' },
  { nom: 'Barrière Heras', w: 0.3, l: 3.5, h: 2, cat: 'mobilier' },
  { nom: 'Accès secours', w: 4, l: 20, h: 0, cat: 'zone' },
  { nom: 'Zone public', w: 10, l: 10, h: 0, cat: 'zone' },
  { nom: 'Obstacle fixe', w: 1, l: 1, h: 1.5, cat: 'obstacle' },
];

// Hauteur par défaut quand elle n'est pas donnée
export const HAUTEUR_CAT = { tente: 2.5, commerce: 2.5, sanitaire: 2.5, technique: 2, scene: 1, mobilier: 1, zone: 0, obstacle: 1.5 };
// Stand de marché : modèle explicite, ou ancien « Stand » posé avant l'ajout du modèle
export const estMarche = (o) => o.modele === 'marche' || (o.cat === 'commerce' && /^stand/i.test(o.nom));
export const estRemorque = (o) => o.modele === 'remorque' || /remorque frigo/i.test(o.nom);
export const TIMON = 1.3;
// Éléments dont un côté est ouvert (façade marquée sur le plan)
export const aFacade = (o) => estMarche(o) || o.modele === 'buvette';
export const travees = (o) => Math.max(1, Math.round(o.l / (o.travee || 3)));   // nombre d'emplacements
// Côté ouvert (façade) : le grand côté x = +largeur/2 ; renvoie ses deux coins
export function facade(o) {
  const c = coins(o);
  return [c[1], c[2]];
}

export const hauteur = (o) => (o.h != null && o.h !== '' ? +o.h : HAUTEUR_CAT[o.cat] ?? 1);

export const normRot = (r) => Math.round((((r % 360) + 360) % 360) * 10) / 10 % 360;

// Coins du rectangle, en mètres
export function coins(o) {
  const a = -o.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
    const lx = i * o.w / 2, ly = j * o.l / 2;
    return { x: o.x + lx * c - ly * s, y: o.y + lx * s + ly * c };
  });
}

// Coordonnées locales d'un point (axe x = largeur, axe y = longueur)
export function local(o, p) {
  const a = -o.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = p.x - o.x, dy = p.y - o.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

// Angle (sens horaire depuis le nord) qui aligne la longueur sur le segment a-b
export function rotationAlignee(a, b) {
  const theta = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  return normRot(90 - theta) % 180;
}

// ---------------------------------------------------------------- Géométrie
export function dansPolygone(p, pts) {
  let r = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}

// Deux polygones convexes se chevauchent-ils (axes séparateurs) ? Un simple contact ne compte pas.
function chevauche(P, Q) {
  for (const poly of [P, Q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const nx = a.y - b.y, ny = b.x - a.x, n = Math.hypot(nx, ny) || 1;
      let p1 = Infinity, p2 = -Infinity, q1 = Infinity, q2 = -Infinity;
      for (const p of P) { const v = (p.x * nx + p.y * ny) / n; p1 = Math.min(p1, v); p2 = Math.max(p2, v); }
      for (const q of Q) { const v = (q.x * nx + q.y * ny) / n; q1 = Math.min(q1, v); q2 = Math.max(q2, v); }
      if (p2 <= q1 + 0.02 || q2 <= p1 + 0.02) return false;
    }
  }
  return true;
}

const distPtSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const croise = (a, b, c, d) => {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};
function distSegSeg(a, b, c, d) {
  if (croise(a, b, c, d)) return 0;
  return Math.min(distPtSeg(a, c, d), distPtSeg(b, c, d), distPtSeg(c, a, b), distPtSeg(d, a, b));
}

// Distance entre le rectangle (coins R) et une polyligne
function distRectLigne(R, pts) {
  let d = Infinity;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    if (dansPolygone(a, R) || dansPolygone(b, R)) return 0;
    for (let i = 0; i < 4; i++) d = Math.min(d, distSegSeg(a, b, R[i], R[(i + 1) % 4]));
  }
  return d;
}

function distRectPoint(R, p) {
  if (dansPolygone(p, R)) return 0;
  let d = Infinity;
  for (let i = 0; i < 4; i++) d = Math.min(d, distPtSeg(p, R[i], R[(i + 1) % 4]));
  return d;
}

const boite = (pts, m = 0) => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return [Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m];
};
const seCroisent = (A, B) => A[0] <= B[2] && B[0] <= A[2] && A[1] <= B[3] && B[1] <= A[3];

// ---------------------------------------------------------------- Alertes
// Obstacles du terrain : plan SPW + éléments relevés
function obstacles(plan) {
  const lignes = [], points = [], arbres = [], eaux = [];
  const P = (g) => g.map(([x, y]) => ({ x, y }));
  for (const o of plan.picc.objets) {
    if (o.t === 'l' && (o.k === 'haie' || o.k === 'muret' || o.k === 'cloture')) {
      lignes.push({ pts: P(o.g), marge: { haie: 0.5, muret: 0.2, cloture: 0.1 }[o.k], lib: { haie: 'une haie', muret: 'un muret', cloture: 'une clôture' }[o.k] });
    } else if (o.t === 'p' && (o.k === 'poteau' || o.k === 'sol')) {
      points.push({ p: { x: o.g[0][0], y: o.g[0][1] }, lib: o.k === 'sol' ? 'une taque ou un avaloir' : 'un poteau ou une borne' });
    } else if (o.t === 'p' && o.k === 'arbre') {
      arbres.push({ p: { x: o.g[0][0], y: o.g[0][1] }, r: 2, lib: "un arbre du plan SPW (couronne estimée)" });
    } else if (o.t === 'a' && o.k === 'eau') {
      for (const r of o.g) eaux.push(P(r));
    }
  }
  for (const e of plan.elements || []) {
    if (e.type === 'arbre') {
      arbres.push({ p: e.points[0], r: (valeur(e, 'couronne') || 4) / 2, lib: e.nom });
      points.push({ p: e.points[0], r: (valeur(e, 'tronc') || 30) / 200, lib: `le tronc de ${e.nom}` });
    } else if (e.forme === 'point') {
      points.push({ p: e.points[0], r: (valeur(e, 'largeur') || 0.5) / 2, lib: e.nom });
    } else {
      const ep = (e.type === 'autre' ? valeur(e, 'largeur') : valeur(e, 'epaisseur')) || 0.2;
      const pts = e.forme === 'surface' ? [...e.points, e.points[0]] : e.points;
      lignes.push({ pts, marge: ep / 2, lib: e.nom });
    }
  }
  return { lignes, points, arbres, eaux };
}

export function alertes(plan) {
  const items = plan.amenagement || [];
  const out = [], mauvais = new Set();
  const ajoute = (ids, t) => { out.push({ ids, t }); ids.forEach((id) => mauvais.add(id)); };
  const R = new Map(items.map((o) => [o.id, coins(o)]));
  const solides = items.filter((o) => o.cat !== 'zone');
  const terrain = plan.contour.ferme && plan.contour.points.length >= 3 ? plan.contour.points : null;
  const obs = obstacles(plan);

  for (const o of items) {
    if (o.cat === 'obstacle' || !terrain) continue;
    if (!R.get(o.id).every((p) => dansPolygone(p, terrain))) ajoute([o.id], `${o.nom} dépasse du terrain`);
  }
  for (let i = 0; i < solides.length; i++) {
    for (let j = i + 1; j < solides.length; j++) {
      const a = solides[i], b = solides[j];
      if (chevauche(R.get(a.id), R.get(b.id))) ajoute([a.id, b.id], `${a.nom} chevauche ${b.nom}`);
    }
  }
  for (const z of items.filter((o) => o.cat === 'zone' && /secours|allée|allee|accès|acces|passage/i.test(o.nom))) {
    for (const s of solides) if (chevauche(R.get(z.id), R.get(s.id))) ajoute([s.id, z.id], `${s.nom} bloque ${z.nom}`);
  }
  for (const s of solides) {
    if (s.cat === 'obstacle') continue;
    const C = R.get(s.id), B = boite(C, 0.6);
    const vus = new Set();
    for (const l of obs.lignes) {
      if (vus.has(l.lib) || !seCroisent(B, boite(l.pts))) continue;
      if (distRectLigne(C, l.pts) < l.marge) { vus.add(l.lib); ajoute([s.id], `${s.nom} touche ${l.lib}`); }
    }
    for (const q of obs.points) {
      if (vus.has(q.lib)) continue;
      if (distRectPoint(C, q.p) < (q.r || 0.3)) { vus.add(q.lib); ajoute([s.id], `${s.nom} recouvre ${q.lib}`); }
    }
    if (obs.eaux.some((w) => C.some((p) => dansPolygone(p, w)) || dansPolygone({ x: s.x, y: s.y }, w))) ajoute([s.id], `${s.nom} empiète sur l'eau`);
    if (s.cat === 'tente' || s.cat === 'scene' || s.cat === 'technique') {
      for (const t of obs.arbres) if (distRectPoint(C, t.p) < t.r * 0.85) ajoute([s.id], `${s.nom} est sous la couronne de ${t.lib}`);
    }
  }
  return { liste: out, mauvais };
}

// ---------------------------------------------------------------- Distances en direct
// Points les plus proches entre les segments [a,b] et [c,d] (p sur ab, q sur cd)
function procheSegSeg(a, b, c, d) {
  if (croise(a, b, c, d)) return { d: 0 };
  const proj = (p, s, t) => {
    const dx = t.x - s.x, dy = t.y - s.y, l2 = dx * dx + dy * dy;
    const k = l2 ? Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / l2)) : 0;
    return { x: s.x + k * dx, y: s.y + k * dy };
  };
  let best = null;
  for (const [p, q] of [[proj(c, a, b), c], [proj(d, a, b), d], [a, proj(a, c, d)], [b, proj(b, c, d)]]) {
    const dd = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || dd < best.d) best = { p, q, d: dd };
  }
  return best;
}

const LIB_PICC = {
  batiment: 'Bâtiment', ouvrage: 'Ouvrage', haie: 'Haie', muret: 'Muret', cloture: 'Clôture', voirie: 'Bord de voirie',
  poteau: 'Poteau', sol: 'Taque, avaloir', arbre: 'Arbre (plan SPW)', eau: 'Eau', berge: 'Berge',
};

// Éléments à moins de `portee` mètres de l'objet o : un trait par élément, du plus proche au plus loin.
// Renvoie [{ p (sur l'objet), q (sur l'élément), d, lib }]
export function distancesProches(plan, o, portee = 5, max = 10) {
  const R = coins(o), aretes = R.map((p, i) => [p, R[(i + 1) % 4]]);
  const [x0, y0, x1, y1] = boite(R, portee + 1);
  const dehors = (pts) => pts.every((p) => p.x < x0) || pts.every((p) => p.x > x1) || pts.every((p) => p.y < y0) || pts.every((p) => p.y > y1);
  const res = [];
  // segs : liste de [a, b] ; marge : demi-épaisseur ou rayon à déduire
  const tester = (segs, lib, marge = 0) => {
    if (dehors(segs.flat())) return;
    let best = null;
    for (const [a, b] of segs) {
      if (dansPolygone(a, R) || dansPolygone(b, R)) return;            // l'élément touche l'objet : c'est une alerte, pas une distance
      for (const [c, d] of aretes) {
        const r = procheSegSeg(c, d, a, b);
        if (r.d === 0) return;
        if (!best || r.d < best.d) best = r;
      }
    }
    if (!best) return;
    const d = best.d - marge;
    if (d <= 0.01 || d > portee) return;
    const k = marge / best.d;  // ramène q sur le bord réel (tronc, épaisseur)
    res.push({ p: best.p, q: { x: best.q.x + (best.p.x - best.q.x) * k, y: best.q.y + (best.p.y - best.q.y) * k }, d, lib });
  };
  const anneau = (pts, ferme) => pts.slice(0, ferme ? pts.length : pts.length - 1).map((p, i) => [p, pts[(i + 1) % pts.length]]);
  const P = (g) => g.map(([x, y]) => ({ x, y }));

  for (const a of plan.amenagement || []) if (a.id !== o.id) tester(anneau(coins(a), true), a.nom);
  const c = plan.contour.points;
  if (c.length >= 2) {
    // chaque côté du terrain séparément, pour voir la distance aux différents bords
    for (const s of anneau(c, plan.contour.ferme)) tester([s], 'Bord du terrain');
  }
  for (const e of plan.elements || []) {
    if (e.forme === 'point') {
      const r = e.type === 'arbre' ? (valeur(e, 'tronc') || 30) / 200 : (valeur(e, 'largeur') || 0.5) / 2;
      tester([[e.points[0], e.points[0]]], e.type === 'arbre' ? `${e.nom} (tronc)` : e.nom, r);
    } else {
      const ep = (e.type === 'autre' ? valeur(e, 'largeur') : valeur(e, 'epaisseur')) || 0.2;
      tester(anneau(e.points, e.forme === 'surface'), e.nom, e.forme === 'surface' ? 0 : ep / 2);
    }
  }
  for (const ob of plan.picc.objets) {
    const lib = LIB_PICC[ob.k];
    if (!lib) continue;
    if (ob.t === 'p') { const q = { x: ob.g[0][0], y: ob.g[0][1] }; tester([[q, q]], lib); }
    else if (ob.t === 'l') tester(anneau(P(ob.g), false), lib, ob.k === 'haie' ? 0.4 : 0);
    else for (const r of ob.g) tester(anneau(P(r), true), lib);
  }
  res.sort((a, b) => a.d - b.d);
  // un même type d'élément au même endroit (morceaux d'une haie…) : garder le plus proche
  const gardes = [];
  for (const r of res) {
    if (gardes.some((g) => g.lib === r.lib && Math.hypot(g.q.x - r.q.x, g.q.y - r.q.y) < 1)) continue;
    gardes.push(r);
    if (gardes.length >= max) break;
  }
  return gardes;
}

// ---------------------------------------------------------------- Matériel et surfaces
export function materiel(plan) {
  const groupes = new Map();
  for (const o of plan.amenagement || []) {
    const k = `${o.nom}|${o.w}|${o.l}|${o.cat}`;
    const g = groupes.get(k) || { nom: o.nom, w: o.w, l: o.l, cat: o.cat, nb: 0 };
    g.nb++;
    groupes.set(k, g);
  }
  const lignes = [...groupes.values()].sort((a, b) => Object.keys(CATEGORIES).indexOf(a.cat) - Object.keys(CATEGORIES).indexOf(b.cat) || a.nom.localeCompare(b.nom));
  const occupe = (plan.amenagement || []).filter((o) => o.cat !== 'zone').reduce((s, o) => s + o.w * o.l, 0);
  const terrain = plan.contour.ferme && plan.contour.points.length >= 3 ? aire(plan.contour.points) : null;
  return { lignes, occupe, terrain };
}
