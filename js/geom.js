// Outils géométriques. Toutes les coordonnées sont en mètres,
// dans le repère local du plan (Lambert 2008 moins l'origine du plan).

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function aire(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function perimetre(pts, ferme = true) {
  let s = 0;
  const n = ferme ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) s += dist(pts[i], pts[(i + 1) % pts.length]);
  return s;
}

// Projection du point p sur le segment [a,b]
export function projSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy, t };
}

function segCoupe(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return (o1 * o2 < 0) && (o3 * o4 < 0);
}

// Vrai si le polygone fermé se recoupe lui-même
export function seRecoupe(pts) {
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // segments voisins
      const c = pts[j], d = pts[(j + 1) % n];
      if (segCoupe(a, b, c, d)) return true;
    }
  }
  return false;
}

const nf = (dec) => new Intl.NumberFormat('fr-BE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const fmt = (v, dec = 1) => nf(dec).format(v);
export const fmtM = (v, dec = 2) => `${fmt(v, dec)} m`;
export const fmtM2 = (v) => `${fmt(v, v < 100 ? 1 : 0)} m²`;
