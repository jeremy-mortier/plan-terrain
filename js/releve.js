// Relevé des éléments fixes : types d'éléments, choix des repères et calcul de position
// à partir de deux distances mesurées au mètre ruban (trilatération).

import { dist } from './geom.js';

// forme : 'point' | 'ligne' | 'surface' (null = au choix)
// champs : [clé, libellé, unité, valeur par défaut utilisée pour le dessin]
export const TYPES = {
  arbre: {
    lib: 'Arbre', forme: 'point',
    champs: [['tronc', 'Ø du tronc', 'cm', 30], ['couronne', 'Ø de la couronne', 'm', 4], ['branches', 'Hauteur des 1res branches', 'm', null], ['hauteur', 'Hauteur totale', 'm', null]],
  },
  haie: { lib: 'Haie', forme: 'ligne', champs: [['epaisseur', 'Épaisseur', 'm', 0.8], ['hauteur', 'Hauteur', 'm', null]] },
  muret: { lib: 'Muret', forme: 'ligne', champs: [['epaisseur', 'Épaisseur', 'm', 0.2], ['hauteur', 'Hauteur', 'm', null]] },
  autre: { lib: 'Autre', forme: null, champs: [['largeur', 'Largeur ou Ø', 'm', 0.5], ['hauteur', 'Hauteur', 'm', null]] },
};

export const FORMES = { point: 'Point', ligne: 'Ligne', surface: 'Surface' };
export const MIN_POINTS = { point: 1, ligne: 2, surface: 3 };

export const valeur = (e, cle) => {
  const v = e.attrs?.[cle];
  if (v !== undefined && v !== null && v !== '') return +v;
  return TYPES[e.type].champs.find((c) => c[0] === cle)?.[3] ?? null;
};

// Distance à ajouter aux mesures : on mesure jusqu'à la face du tronc, le point est au centre.
export const ajoutMesure = (e) => (e.type === 'arbre' ? (valeur(e, 'tronc') || 0) / 200 : 0);

export function nomPoint(e, i) {
  const n = e.points.length;
  if (e.forme === 'point') return e.type === 'arbre' ? 'Centre du tronc' : 'Position';
  if (e.forme === 'surface') return `Coin ${i + 1} sur ${n}`;
  return i === 0 ? 'Début' : i === n - 1 ? 'Fin' : `Point intermédiaire ${i}`;
}

// ---------------------------------------------------------------- Repères
// Points qu'on peut retrouver sur place et d'où tirer le mètre.
// poids < 1 = préféré (point déjà mesuré, coin de bâtiment).
export function candidats(plan, { exclureEl = null, exclureContour = -1, courants = [] } = {}) {
  const out = [], vus = new Set();
  const add = (x, y, lib, poids) => {
    const k = `${Math.round(x * 20)},${Math.round(y * 20)}`;
    if (vus.has(k)) return;
    vus.add(k);
    out.push({ x, y, lib, poids });
  };
  for (const p of courants) if (p.src === 'mesure') add(p.x, p.y, 'Point de cet élément déjà mesuré', 0.8);
  for (const e of plan.elements || []) {
    if (e.id === exclureEl || e.type === 'arbre') continue; // un centre de tronc ne se vise pas
    e.points.forEach((p, i) => { if (p.src === 'mesure') add(p.x, p.y, `${e.nom} (${nomPoint(e, i).toLowerCase()})`, 0.8); });
  }
  plan.contour.points.forEach((p, i) => {
    if (i === exclureContour) return;
    if (p.src === 'mesure') add(p.x, p.y, `Coin ${i + 1} du contour (mesuré)`, 0.8);
    else if (p.src === 'picc') add(p.x, p.y, `Coin ${i + 1} du contour`, 1);
  });
  for (const o of plan.picc.objets) {
    if (o.t === 'p' && (o.k === 'poteau' || o.k === 'sol')) {
      const nature = (o.n || (o.k === 'sol' ? 'taque' : 'poteau')).toLowerCase();
      add(o.g[0][0], o.g[0][1], `${nature[0].toUpperCase()}${nature.slice(1)} (plan SPW)`, o.k === 'sol' ? 1.1 : 1);
    } else if (o.t === 'a' && (o.k === 'batiment' || o.k === 'ouvrage')) {
      for (const r of o.g) for (const [x, y] of r) add(x, y, o.k === 'batiment' ? 'Coin de bâtiment (plan SPW)' : "Coin d'ouvrage (plan SPW)", 0.9);
    } else if (o.t === 'l' && (o.k === 'muret' || o.k === 'cloture')) {
      const lib = o.k === 'muret' ? 'Bout de muret (plan SPW)' : 'Bout de clôture (plan SPW)';
      const g = o.g, a = g[0], b = g[g.length - 1];
      add(a[0], a[1], lib, o.k === 'muret' ? 1.1 : 1.3);
      add(b[0], b[1], lib, o.k === 'muret' ? 1.1 : 1.3);
    }
  }
  return out;
}

// Sinus de l'angle sous lequel on voit A et B depuis P (1 = angle droit, idéal)
export function sinAngle(p, a, b) {
  const ux = a.x - p.x, uy = a.y - p.y, vx = b.x - p.x, vy = b.y - p.y;
  const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  return n ? Math.abs(ux * vy - uy * vx) / n : 0;
}

// Choisit deux repères proches, à portée de mètre, vus sous un angle franc.
export function choisirReperes(cible, cands, portee = 30) {
  for (const lim of [portee, portee * 2, Infinity]) {
    const proches = cands
      .map((c) => ({ ...c, d: dist(c, cible) }))
      .filter((c) => c.d >= 0.5 && c.d <= lim)
      .sort((a, b) => a.d * a.poids - b.d * b.poids)
      .slice(0, 30);
    let best = null, bc = Infinity;
    for (let i = 0; i < proches.length; i++) {
      for (let j = i + 1; j < proches.length; j++) {
        const a = proches[i], b = proches[j];
        const s = sinAngle(cible, a, b);
        if (s < 0.34) continue; // moins de 20° : précision trop faible
        const cout = (a.d * a.poids + b.d * b.poids) / s;
        if (cout < bc) { bc = cout; best = [a, b]; }
      }
    }
    if (best) return best.sort((a, b) => a.d - b.d);
  }
  return null;
}

// ---------------------------------------------------------------- Calcul
// Intersection des cercles (A, rA) et (B, rB) ; garde la solution la plus proche de l'estimation.
// Si les cercles ne se touchent pas, prend le point le plus proche des deux et donne l'écart.
export function trilaterer(A, rA, B, rB, estime) {
  const d = dist(A, B);
  if (d < 0.01) return { erreur: 'Les repères A et B sont au même endroit. Changez l’un des deux.' };
  const ex = { x: (B.x - A.x) / d, y: (B.y - A.y) / d }, ey = { x: -ex.y, y: ex.x };
  const a = (d * d + rA * rA - rB * rB) / (2 * d);
  const h2 = rA * rA - a * a;
  let ecart = 0, sols;
  if (h2 < 0) {
    ecart = d > rA + rB ? d - (rA + rB) : Math.abs(rA - rB) - d;
    sols = [{ x: A.x + a * ex.x, y: A.y + a * ex.y }];
  } else {
    const h = Math.sqrt(h2), m = { x: A.x + a * ex.x, y: A.y + a * ex.y };
    sols = [{ x: m.x + h * ey.x, y: m.y + h * ey.y }, { x: m.x - h * ey.x, y: m.y - h * ey.y }];
  }
  sols.sort((p, q) => dist(p, estime) - dist(q, estime));
  const p = sols[0];
  return {
    x: p.x, y: p.y, ecart,
    ambigu: sols.length === 2 && dist(sols[0], sols[1]) < 1, // deux solutions très proches
    deplacement: dist(p, estime),
    sin: sinAngle(p, A, B),
  };
}

// Lecture d'une distance saisie : « 7,42 », « 7.42 », « 742 cm »
export function lireDistance(txt) {
  const t = String(txt).trim().toLowerCase().replace(',', '.');
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(cm|m)?$/);
  if (!m) return NaN;
  return m[2] === 'cm' ? +m[1] / 100 : +m[1];
}
