// Carte du plan : affichage des objets PICC, déplacement, zoom et édition du contour.
// Repère : mètres locaux, x vers l'est, y vers le nord. L'écran a y vers le bas.

import { dist, projSeg } from './geom.js';
import { valeur, centre, rotationDe, peutTourner, geometrie, longueurDe } from './releve.js';
import { coins, contourObjet, local, normRot, estMarche, travees, facade, aFacade, estRemorque, TIMON } from './amenagement.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
};
const fmtNb = (v) => (+v).toLocaleString('fr-BE', { maximumFractionDigits: 2 });
const chemin = (pts, ferme) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('') + (ferme ? 'Z' : '');

// Ordre de dessin (du dessous vers le dessus)
const ORDRE = ['eau', 'voirie', 'rigole', 'talus', 'berge', 'cours', 'batiment', 'ouvrage', 'limite', 'haie', 'rangee', 'cloture', 'muret', 'equipement', 'sol', 'poteau', 'arbre', 'autre'];

export class Carte {
  constructor(svg, { onContour, onSurvol, onVue, onTap, onObjet }) {
    this.svg = svg;
    this.onObjet = onObjet;       // aménagement : ('select'|'debut'|'bouge'|'fin', index)
    this.objets = [];
    this.selObj = -1;
    this.alertesObj = new Set();
    this.onTap = onTap;           // touche en mode relevé : (accroche, pointÉcran, évènement)
    this.elements = [];
    this.selEl = -1;
    this.brouillon = null;        // élément en cours de saisie
    this.mesure = null;           // mesure en cours (repères, cercles, résultat)
    this.sommetsEl = [];
    this.onContour = onContour;   // appelé quand le contour change (fin de geste)
    this.onSurvol = onSurvol;     // info d'accrochage sous le pointeur
    this.onVue = onVue;           // la vue (zoom) a changé
    this.vue = { s: 4, cx: 0, cy: 0 };
    this.mode = 'naviguer';       // 'naviguer' | 'tracer' | 'modifier'
    this.aimant = true;
    this.masques = new Set();
    this.contour = { points: [], ferme: false };
    this.selection = -1;
    this.pointeurs = new Map();
    this.geste = null;
    this.survol = null;

    this.monde = el('g', { class: 'monde' }, svg);
    this.gPicc = el('g', {}, this.monde);
    this.gContour = el('g', {}, this.monde);
    this.gElements = el('g', {}, this.monde);
    this.gBrouillon = el('g', {}, this.monde);
    this.gAmenag = el('g', {}, this.monde);
    this.gOverlay = el('g', { class: 'overlay' }, svg);

    new ResizeObserver(() => this.appliquerVue()).observe(svg);
    svg.addEventListener('pointerdown', (e) => this.down(e));
    svg.addEventListener('pointermove', (e) => this.move(e));
    svg.addEventListener('pointerup', (e) => this.up(e));
    svg.addEventListener('pointercancel', (e) => this.up(e, true));
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.setSurvol(null); });
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      this.zoomer(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
  }

  // ---------- Données ----------
  chargerPicc(objets) {
    this.picc = objets;
    this.selPicc = null;
    this.gPicc.replaceChildren();
    const groupes = {};
    for (const k of ORDRE) groupes[k] = el('g', { class: `c-${k}`, 'data-cat': k }, this.gPicc);
    this.sommets = [];   // points d'accrochage [x, y]
    this.segments = [];  // segments d'accrochage [x1, y1, x2, y2]
    for (const o of objets) {
      const g = groupes[o.k] || groupes.autre;
      if (o.t === 'p') {
        const [x, y] = o.g[0];
        el('circle', { cx: x, cy: y, r: o.k === 'arbre' ? 2.5 : 0.35 }, g);
        this.sommets.push([x, y]);
      } else if (o.t === 'l') {
        el('path', { d: chemin(o.g, false) }, g);
        this.ajouterAccroches(o.g, false);
      } else {
        el('path', { d: o.g.map((r) => chemin(r, true)).join(''), 'fill-rule': 'evenodd' }, g);
        for (const r of o.g) this.ajouterAccroches(r, true);
      }
    }
    this.appliquerMasques();
  }

  ajouterAccroches(pts, ferme) {
    for (let i = 0; i < pts.length; i++) {
      this.sommets.push(pts[i]);
      const j = i + 1 < pts.length ? i + 1 : (ferme ? 0 : -1);
      if (j >= 0) this.segments.push([pts[i][0], pts[i][1], pts[j][0], pts[j][1]]);
    }
  }

  masquer(cat, cache) {
    cache ? this.masques.add(cat) : this.masques.delete(cat);
    this.appliquerMasques();
  }
  appliquerMasques() {
    for (const g of this.gPicc.children) g.style.display = this.masques.has(g.dataset.cat) ? 'none' : '';
  }

  setContour(contour) {
    this.contour = structuredClone(contour);
    this.selection = -1;
    this.dessinerContour();
  }

  setElements(elements, sel = -1) {
    this.elements = elements;
    this.selEl = sel;
    this.sommetsEl = elements.flatMap((e) => e.points.map((p) => [p.x, p.y]));
    // segments des haies, murets et surfaces relevés : on peut s'y accrocher
    this.segmentsEl = elements.flatMap((e) => {
      if (e.forme === 'point' || e.points.length < 2) return [];
      const p = e.points, n = e.forme === 'surface' ? p.length : p.length - 1;
      return Array.from({ length: n }, (_, k) => [p[k].x, p[k].y, p[(k + 1) % p.length].x, p[(k + 1) % p.length].y]);
    });
    this.gElements.replaceChildren();
    elements.forEach((e, i) => {
      const mesure = e.points.every((p) => p.src === 'mesure');
      const place = !mesure && e.points.every((p) => p.src === 'mesure' || p.src === 'place');
      dessinerElement(e, el('g', { class: `el el-${e.type} ${mesure ? 'mesure' : place ? 'place' : 'estime'}${i === sel ? ' sel' : ''}` }, this.gElements));
    });
    this.dessinerOverlay();
  }

  setBrouillon(b) {
    this.brouillon = b;
    this.gBrouillon.replaceChildren();
    if (b && b.points.length) dessinerElement(b, el('g', { class: `el el-${b.type} brouillon` }, this.gBrouillon));
    this.dessinerOverlay();
  }

  // ---------- Aménagement ----------
  setAmenagement(objets, sel = -1, alertes = new Set()) {
    this.objets = objets;
    this.selObj = sel;
    this.alertesObj = alertes;
    this.dessinerAmenagement();
  }

  dessinerAmenagement() {
    const g = this.gAmenag;
    g.replaceChildren();
    // les zones dessous, le reste par-dessus
    const ordre = this.objets.map((o, i) => i).sort((a, b) => (this.objets[a].cat === 'zone' ? 0 : 1) - (this.objets[b].cat === 'zone' ? 0 : 1));
    for (const i of ordre) {
      const o = this.objets[i];
      const cls = ['am', `cat-${o.cat}`];
      if (i === this.selObj) cls.push('sel');
      if (this.alertesObj.has(o.id)) cls.push('alerte');
      el('polygon', { points: contourObjet(o).map((p) => `${p.x},${p.y}`).join(' '), class: cls.join(' ') }, g);
      if (estRemorque(o)) {
        // séparation caisse / timon et pointe du timon
        const c = coins(o), t = Math.min(TIMON / o.l, 0.45);
        const m = (p, q, k) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
        const a = m(c[3], c[0], t), b = m(c[2], c[1], t), pointe = m(c[3], c[2], 0.5);
        el('path', { d: `M${a.x} ${a.y}L${b.x} ${b.y}M${a.x} ${a.y}L${pointe.x} ${pointe.y}L${b.x} ${b.y}`, class: 'am-travee' }, g);
      }
      if (aFacade(o)) {
        // côté ouvert en trait épais, séparations entre emplacements en traits fins
        const [a, b] = facade(o), c = coins(o), n = estMarche(o) ? travees(o) : 1;
        el('path', { d: `M${a.x} ${a.y}L${b.x} ${b.y}`, class: 'am-facade' }, g);
        let d = '';
        for (let k = 1; k < n; k++) {
          const t = k / n;
          d += `M${c[0].x + (c[3].x - c[0].x) * t} ${c[0].y + (c[3].y - c[0].y) * t}L${a.x + (b.x - a.x) * t} ${a.y + (b.y - a.y) * t}`;
        }
        if (d) el('path', { d, class: 'am-travee' }, g);
      }
    }
    this.dessinerOverlay();
  }

  // Position écran de la poignée de rotation (au-delà du petit côté « nord » de l'objet)
  poignee(o) {
    const a = -o.rot * Math.PI / 180;
    const bout = this.versEcran({ x: o.x - Math.sin(a) * o.l / 2, y: o.y + Math.cos(a) * o.l / 2 });
    const dx = -Math.sin(a), dy = -Math.cos(a); // direction à l'écran (y vers le bas)
    return { bout, x: bout.x + dx * 30, y: bout.y + dy * 30 };
  }

  objetSous(sx, sy, e) {
    const m = this.versMonde(sx, sy), tol = (e && e.pointerType === 'touch' ? 8 : 3) / this.vue.s;
    let zone = -1;
    for (let i = this.objets.length - 1; i >= 0; i--) {
      const o = this.objets[i], q = local(o, m);
      if (Math.abs(q.x) <= o.w / 2 + tol && Math.abs(q.y) <= o.l / 2 + tol) {
        if (o.cat !== 'zone') return i;
        if (zone < 0) zone = i;
      }
    }
    return zone;
  }

  // Segment le plus proche (contour, plan SPW, éléments relevés) pour « Aligner sur… »
  segmentSous(sx, sy, e) {
    const m = this.versMonde(sx, sy), r = this.rayon(e) / this.vue.s;
    let best = null, bd = r;
    const essai = (a, b) => {
      const d = dist(projSeg(m, a, b), m);
      if (d < bd && dist(a, b) > 0.3) { bd = d; best = [a, b]; }
    };
    const c = this.contour.points;
    for (let i = 0; i < c.length; i++) if (i < c.length - 1 || this.contour.ferme) essai(c[i], c[(i + 1) % c.length]);
    for (const it of this.elements) {
      if (it.forme === 'point') continue;
      const p = it.points, n = it.forme === 'surface' ? p.length : p.length - 1;
      for (let k = 0; k < n; k++) essai(p[k], p[(k + 1) % p.length]);
    }
    for (const [x1, y1, x2, y2] of this.segments || []) {
      if (m.x < Math.min(x1, x2) - r || m.x > Math.max(x1, x2) + r || m.y < Math.min(y1, y2) - r || m.y > Math.max(y1, y2) + r) continue;
      essai({ x: x1, y: y1 }, { x: x2, y: y2 });
    }
    return best;
  }

  // Objet du plan SPW sous le doigt (lignes et points d'abord, puis surfaces) ; ignore les catégories masquées
  piccSous(sx, sy, e) {
    const m = this.versMonde(sx, sy), r = this.rayon(e) / this.vue.s;
    let best = -1, bd = r, dedansSurf = -1;
    (this.picc || []).forEach((o, i) => {
      if (this.masques.has(o.k)) return;
      if (o.t === 'p') {
        const d = Math.hypot(o.g[0][0] - m.x, o.g[0][1] - m.y) - (o.k === 'arbre' ? 2.5 : 0);
        if (d < bd) { bd = Math.max(d, 0); best = i; }
      } else if (o.t === 'l') {
        for (let k = 0; k < o.g.length - 1; k++) {
          const a = { x: o.g[k][0], y: o.g[k][1] }, b = { x: o.g[k + 1][0], y: o.g[k + 1][1] };
          const d = dist(projSeg(m, a, b), m);
          if (d < bd) { bd = d; best = i; }
        }
      } else if (dedansSurf < 0 && dedans(m, o.g[0].map(([x, y]) => ({ x, y })))) dedansSurf = i;
    });
    return best >= 0 ? best : dedansSurf;
  }

  setSelPicc(o) {
    this.selPicc = o;
    this.dessinerOverlay();
  }

  setMesure(m) {
    this.mesure = m;
    this.dessinerOverlay();
  }

  // Élément sous un point de l'écran (index ou -1)
  elementSous(sx, sy, e) {
    const r = this.rayon(e), m = this.versMonde(sx, sy);
    let best = -1, bd = r;
    this.elements.forEach((el, i) => {
      const d = this.distanceEcran(el, m);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  // Distance à l'écran (px) entre un point du monde et un élément relevé (0 = dessus)
  distanceEcran(el, m) {
    const pts = el.points, s = this.vue.s;
    if (!pts.length) return Infinity;
    if (el.forme === 'point') {
      const rayon = el.type === 'arbre' ? (valeur(el, 'couronne') || 4) / 2 : (valeur(el, 'largeur') || 0.5) / 2;
      return Math.max(0, dist(pts[0], m) - rayon) * s;
    }
    if (pts.length === 1) return dist(pts[0], m) * s;
    let d = Infinity;
    const n = el.forme === 'surface' ? pts.length : pts.length - 1;
    for (let k = 0; k < n; k++) d = Math.min(d, dist(projSeg(m, pts[k], pts[(k + 1) % pts.length]), m) * s);
    if (el.forme === 'surface' && dedans(m, pts)) d = 0;
    return d;
  }

  // Placement point par point : { pt (le point modifié), contraindre(pos) → pos, distances() → liste, refs, choix }
  setPlacement(pl) {
    this.placement = pl;
    this.dessinerOverlay();
  }

  // Élément relevé qu'on peut faire glisser sous le doigt : celui en cours de saisie ou celui sélectionné
  // (comme en aménagement : on attrape directement n'importe quel élément ; le sélectionné a priorité)
  cibleGlisser(p, e) {
    if (!this.glisserElements || this.alignement) return null;
    const m = this.versMonde(p.x, p.y), r = this.rayon(e);
    const el = this.elements[this.selEl];
    if (el && this.distanceEcran(el, m) < r) return this.selEl;
    const i = this.elementSous(p.x, p.y, e);
    return i >= 0 ? i : null;
  }

  // Poignée de rotation d'un élément relevé (haie, muret, rectangle), au-delà de son bout « nord »
  poigneeElement(el) {
    const c = centre(el), l = el.forme === 'ligne' ? longueurDe(el) : (valeur(el, 'longueur') || 3);
    return this.poignee({ x: c.x, y: c.y, rot: rotationDe(el), l });
  }

  setMode(mode) {
    this.mode = mode;
    this.selection = -1;
    this.svg.dataset.mode = mode;
    this.setSurvol(null);
    this.dessinerContour();
  }

  // ---------- Vue ----------
  taille() {
    const r = this.svg.getBoundingClientRect();
    return { w: r.width || 1, h: r.height || 1 };
  }
  versEcran(p) {
    const { w, h } = this.taille(), v = this.vue;
    return { x: w / 2 + (p.x - v.cx) * v.s, y: h / 2 - (p.y - v.cy) * v.s };
  }
  versMonde(x, y) {
    const { w, h } = this.taille(), v = this.vue;
    return { x: v.cx + (x - w / 2) / v.s, y: v.cy - (y - h / 2) / v.s };
  }
  appliquerVue() {
    const { w, h } = this.taille(), v = this.vue;
    this.monde.setAttribute('transform', `matrix(${v.s},0,0,${-v.s},${w / 2 - v.cx * v.s},${h / 2 + v.cy * v.s})`);
    this.dessinerOverlay();
    this.onVue?.(v);
  }
  cadrer(xmin, ymin, xmax, ymax) {
    const { w, h } = this.taille();
    const s = Math.min(w / Math.max(xmax - xmin, 1), h / Math.max(ymax - ymin, 1)) * 0.9;
    this.vue = { s: Math.max(0.3, Math.min(s, 200)), cx: (xmin + xmax) / 2, cy: (ymin + ymax) / 2 };
    this.appliquerVue();
  }
  cadrerContour(defaut) {
    const p = this.contour.points;
    if (p.length >= 2) {
      const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
      this.cadrer(Math.min(...xs) - 5, Math.min(...ys) - 5, Math.max(...xs) + 5, Math.max(...ys) + 5);
    } else this.cadrer(...defaut);
  }
  zoomer(f, sx, sy) {
    const { w, h } = this.taille();
    if (sx === undefined) { sx = w / 2; sy = h / 2; }
    const avant = this.versMonde(sx, sy);
    this.vue.s = Math.max(0.3, Math.min(this.vue.s * f, 200));
    const apres = this.versMonde(sx, sy);
    this.vue.cx += avant.x - apres.x;
    this.vue.cy += avant.y - apres.y;
    this.appliquerVue();
  }

  // ---------- Accrochage ----------
  rayon(e) { return e && e.pointerType === 'touch' ? 26 : 14; }

  accrocher(sx, sy, e, exclure = -1) {
    const m = this.versMonde(sx, sy);
    const libre = { x: m.x, y: m.y, src: 'libre' };
    if (!this.aimant) return libre;
    const r = this.rayon(e) / this.vue.s;
    let best = null, bd = r;
    // 1. sommets du contour
    this.contour.points.forEach((p, i) => {
      if (i === exclure) return;
      const d = dist(p, m);
      if (d < bd) { bd = d; best = { x: p.x, y: p.y, src: p.src || 'libre', contour: i }; }
    });
    if (best) return best;
    // 2. points des éléments relevés, puis sommets PICC
    for (const [x, y] of this.sommetsEl) {
      const d = Math.hypot(x - m.x, y - m.y);
      if (d < bd) { bd = d; best = { x, y, src: 'element' }; }
    }
    if (best) return best;
    for (const [x, y] of this.sommets || []) {
      const d = Math.hypot(x - m.x, y - m.y);
      if (d < bd) { bd = d; best = { x, y, src: 'picc' }; }
    }
    if (best) return best;
    // 3. sur une ligne PICC
    bd = r * 0.8;
    for (const [lst, src] of [[this.segmentsEl || [], 'element'], [this.segments || [], 'ligne']]) {
      for (const [x1, y1, x2, y2] of lst) {
        if (m.x < Math.min(x1, x2) - bd || m.x > Math.max(x1, x2) + bd || m.y < Math.min(y1, y2) - bd || m.y > Math.max(y1, y2) + bd) continue;
        const q = projSeg(m, { x: x1, y: y1 }, { x: x2, y: y2 });
        const d = dist(q, m);
        if (d < bd) { bd = d; best = { x: q.x, y: q.y, src }; }
      }
    }
    return best || libre;
  }

  setSurvol(a) {
    this.survol = a;
    this.onSurvol?.(a);
    this.dessinerOverlay();
  }

  // ---------- Gestes ----------
  pos(e) {
    const r = this.svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  sommetSous(sx, sy, e) {
    const r = this.rayon(e);
    let best = -1, bd = r;
    this.contour.points.forEach((p, i) => {
      const q = this.versEcran(p);
      const d = Math.hypot(q.x - sx, q.y - sy);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  milieuSous(sx, sy, e) {
    if (this.mode !== 'modifier' || !this.contour.ferme) return -1;
    const pts = this.contour.points, r = this.rayon(e);
    for (let i = 0; i < pts.length; i++) {
      const a = this.versEcran(pts[i]), b = this.versEcran(pts[(i + 1) % pts.length]);
      if (Math.hypot(b.x - a.x, b.y - a.y) < 40) continue;
      if (Math.hypot((a.x + b.x) / 2 - sx, (a.y + b.y) / 2 - sy) < r) return i;
    }
    return -1;
  }

  down(e) {
    this.svg.setPointerCapture(e.pointerId);
    const p = this.pos(e);
    this.pointeurs.set(e.pointerId, p);
    if (this.pointeurs.size === 2) {
      const [a, b] = [...this.pointeurs.values()];
      this.geste = { type: 'pince', d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    if (this.pointeurs.size > 2) return;
    // outil « Mesurer » : on attrape une cote gardée (ses bouts ou toute la cote) ;
    // sinon une touche pose un point et glisser déplace la carte
    if (this.outilCote) {
      const c = this.cotes?.[this.coteSel];
      if (c && this.cotesVisibles) {
        for (const k of ['a', 'b']) {
          const q = this.versEcran(c[k]);
          if (Math.hypot(q.x - p.x, q.y - p.y) < this.rayon(e) + 4) { this.geste = { type: 'coteBout', k, depart: p, bouge: false }; return; }
        }
      }
      const i = this.coteSous(p, e);
      if (i >= 0) {
        if (i !== this.coteSel) this.onCoteSel?.(i);
        this.geste = { type: 'coteLigne', depart: p, dernier: this.versMonde(p.x, p.y), bouge: false };
        return;
      }
      this.geste = { type: 'pan', depart: p, dernier: p, bouge: false };
      return;
    }
    if (this.mode === 'releve' && this.placement && !this.placement.choix) {
      const q = this.versEcran(this.placement.pt);
      if (Math.hypot(q.x - p.x, q.y - p.y) < this.rayon(e) + 14) { this.geste = { type: 'placer', depart: p, bouge: false }; return; }
    }
    if (this.mode === 'releve' && !this.mesure) {
      const sel = this.elements[this.selEl];
      if (sel && peutTourner(sel) && !this.alignement && this.glisserElements) {
        const h = this.poigneeElement(sel);
        if (Math.hypot(h.x - p.x, h.y - p.y) < this.rayon(e)) { this.geste = { type: 'rotEl', i: this.selEl, bouge: false }; return; }
      }
      const cible = this.cibleGlisser(p, e);
      if (cible != null) {
        this.geste = { type: 'element', cible, depart: p, dernier: this.versMonde(p.x, p.y), bouge: false };
        if (cible !== this.selEl) this.onElement?.('select', cible);
        return;
      }
    }
    if (this.mode === 'amenager' && !this.alignement) {
      const o = this.objets[this.selObj];
      if (o) {
        const h = this.poignee(o);
        if (Math.hypot(h.x - p.x, h.y - p.y) < this.rayon(e)) { this.geste = { type: 'rotation', i: this.selObj, bouge: false }; return; }
      }
      const i = this.objetSous(p.x, p.y, e);
      if (i >= 0) {
        const m = this.versMonde(p.x, p.y), ob = this.objets[i];
        this.geste = { type: 'objet', i, depart: p, dx: ob.x - m.x, dy: ob.y - m.y, bouge: false };
        if (i !== this.selObj) this.onObjet?.('select', i);
        return;
      }
    }
    if (this.mode === 'modifier') {
      const i = this.sommetSous(p.x, p.y, e);
      if (i >= 0) { this.geste = { type: 'sommet', i, depart: p, bouge: false }; return; }
      const m = this.milieuSous(p.x, p.y, e);
      if (m >= 0) {
        const a = this.contour.points[m], b = this.contour.points[(m + 1) % this.contour.points.length];
        this.contour.points.splice(m + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, src: 'libre' });
        this.selection = m + 1;
        this.geste = { type: 'sommet', i: m + 1, depart: p, bouge: true };
        this.dessinerContour();
        return;
      }
    }
    this.geste = { type: 'pan', depart: p, dernier: p, bouge: false };
  }

  move(e) {
    const p = this.pos(e);
    if (!this.pointeurs.has(e.pointerId)) {
      // survol à la souris
      if (e.pointerType === 'mouse' && this.outilCote) this.setSurvol(this.accrocher(p.x, p.y, e));
      else if (e.pointerType === 'mouse' && (this.mode === 'amenager' || (this.mode === 'releve' && this.alignement))) this.survolAmenag(p, e);
      else if (e.pointerType === 'mouse' && this.mode !== 'naviguer') this.setSurvol(this.accrocher(p.x, p.y, e));
      return;
    }
    this.pointeurs.set(e.pointerId, p);
    const g = this.geste;
    if (!g) return;
    if (g.type === 'pince' && this.pointeurs.size >= 2) {
      const [a, b] = [...this.pointeurs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.vue.cx -= (m.x - g.m.x) / this.vue.s;
      this.vue.cy += (m.y - g.m.y) / this.vue.s;
      this.zoomer(d / g.d, m.x, m.y);
      g.d = d; g.m = m;
    } else if (g.type === 'pan') {
      if (!g.bouge && Math.hypot(p.x - g.depart.x, p.y - g.depart.y) > 6) g.bouge = true;
      if (g.bouge) {
        this.vue.cx -= (p.x - g.dernier.x) / this.vue.s;
        this.vue.cy += (p.y - g.dernier.y) / this.vue.s;
        g.dernier = p;
        this.appliquerVue();
      } else if (e.pointerType !== 'mouse' && (this.mode === 'tracer' || this.mode === 'releve')) {
        this.setSurvol(this.accrocher(p.x, p.y, e));
      }
    } else if (g.type === 'placer') {
      if (!g.bouge && Math.hypot(p.x - g.depart.x, p.y - g.depart.y) > 3) g.bouge = true;
      if (g.bouge) {
        // aimant (sauf touche Maj), puis contraintes : longueur, angle droit…
        const a = e.shiftKey ? { ...this.versMonde(p.x, p.y), src: 'libre' } : this.accrocher(p.x, p.y, e);
        const pos = this.placement.contraindre ? this.placement.contraindre(a) : a;
        this.placement.pt.x = Math.round(pos.x * 1000) / 1000;
        this.placement.pt.y = Math.round(pos.y * 1000) / 1000;
        this.setBrouillon(this.brouillon);
        this.onPlacement?.('bouge');
      }
    } else if (g.type === 'coteBout' || g.type === 'coteLigne') {
      if (!g.bouge && Math.hypot(p.x - g.depart.x, p.y - g.depart.y) > 4) { g.bouge = true; this.onCoteModif?.('debut'); }
      if (g.bouge) {
        const c = this.cotes[this.coteSel];
        if (g.type === 'coteBout') {
          // le bout s'accroche aux coins et aux lignes du plan (sauf avec Maj)
          const a = e.shiftKey ? this.versMonde(p.x, p.y) : this.accrocher(p.x, p.y, e);
          c[g.k] = { x: Math.round(a.x * 1000) / 1000, y: Math.round(a.y * 1000) / 1000 };
          if (!e.shiftKey) this.setSurvol(a);
        } else {
          const m = this.versMonde(p.x, p.y), dx = m.x - g.dernier.x, dy = m.y - g.dernier.y;
          g.dernier = m;
          for (const k of ['a', 'b']) c[k] = { x: Math.round((c[k].x + dx) * 1000) / 1000, y: Math.round((c[k].y + dy) * 1000) / 1000 };
        }
        this.dessinerOverlay();
        this.onCoteModif?.('bouge');
      }
    } else if (g.type === 'rotEl') {
      const el = this.elements[g.i], c = this.versEcran(centre(el));
      const pas = e.shiftKey ? 15 : 1;
      const r = normRot(Math.round(Math.atan2(p.x - c.x, c.y - p.y) * 180 / Math.PI / pas) * pas);
      if (r !== el.rot) {
        if (!g.bouge) { g.bouge = true; this.onElement?.('debut', g.i); }
        el.rot = r;
        geometrie(el);
        this.setElements(this.elements, this.selEl);
        this.onElement?.('bouge', g.i);
      }
    } else if (g.type === 'element') {
      if (!g.bouge && Math.hypot(p.x - g.depart.x, p.y - g.depart.y) > 5) { g.bouge = true; this.onElement?.('debut', g.cible); }
      if (g.bouge) {
        const m = this.versMonde(p.x, p.y), dx = m.x - g.dernier.x, dy = m.y - g.dernier.y;
        g.dernier = m;
        const el = g.cible === 'brouillon' ? this.brouillon : this.elements[g.cible];
        for (const q of el.points) { q.x = Math.round((q.x + dx) * 1000) / 1000; q.y = Math.round((q.y + dy) * 1000) / 1000; }
        if (g.cible === 'brouillon') this.setBrouillon(this.brouillon);
        else this.setElements(this.elements, this.selEl);
        this.onElement?.('bouge', g.cible);
      }
    } else if (g.type === 'objet') {
      if (!g.bouge && Math.hypot(p.x - g.depart.x, p.y - g.depart.y) > 4) { g.bouge = true; this.onObjet?.('debut', g.i); }
      if (g.bouge) {
        const m = this.versMonde(p.x, p.y), o = this.objets[g.i];
        o.x = Math.round((m.x + g.dx) * 100) / 100;
        o.y = Math.round((m.y + g.dy) * 100) / 100;
        this.dessinerAmenagement();
        this.onObjet?.('bouge', g.i);
      }
    } else if (g.type === 'rotation') {
      const o = this.objets[g.i], c = this.versEcran(o);
      const pas = e.shiftKey ? 15 : 1;
      const r = normRot(Math.round(Math.atan2(p.x - c.x, c.y - p.y) * 180 / Math.PI / pas) * pas);
      if (r !== o.rot) {
        if (!g.bouge) { g.bouge = true; this.onObjet?.('debut', g.i); }
        o.rot = r;
        this.dessinerAmenagement();
        this.onObjet?.('bouge', g.i);
      }
    } else if (g.type === 'sommet') {
      if (!g.bouge && Math.hypot(p.x - g.depart.x, p.y - g.depart.y) > 4) g.bouge = true;
      if (g.bouge) {
        const a = this.accrocher(p.x, p.y, e, g.i);
        this.contour.points[g.i] = { x: a.x, y: a.y, src: a.src };
        this.selection = g.i;
        this.setSurvol(a);
        this.dessinerContour();
      }
    }
  }

  up(e, annule = false) {
    const p = this.pos(e);
    this.pointeurs.delete(e.pointerId);
    const g = this.geste;
    if (!g) return;
    if (g.type === 'pince') { if (this.pointeurs.size === 0) this.geste = null; return; }
    this.geste = null;
    if (annule) return;
    if (g.type === 'pan' && !g.bouge) this.tap(p, e);
    if ((g.type === 'objet' || g.type === 'rotation') && g.bouge) this.onObjet?.('fin', g.i);
    if (g.type === 'placer') {
      if (g.bouge) this.onPlacement?.('fin'); else this.tap(p, e);
      if (e.pointerType !== 'mouse') this.setSurvol(null);
    }
    if (g.type === 'rotEl' && g.bouge) this.onElement?.('fin', g.i);
    if (g.type === 'coteBout' || g.type === 'coteLigne') {
      if (g.bouge) { this.onCoteModif?.('fin'); if (e.pointerType !== 'mouse') this.setSurvol(null); }
    }
    if (g.type === 'element') {
      if (g.bouge) this.onElement?.('fin', g.cible);
      else this.tap(p, e);   // simple touche : comportement habituel (sélection, point suivant…)
    }
    if (g.type === 'sommet') {
      if (g.bouge) this.onContour?.(this.contour);
      else { this.selection = g.i; this.dessinerContour(); this.onContour?.(this.contour, true); }
      if (e.pointerType !== 'mouse') this.setSurvol(null);
    }
  }

  // Survol à la souris en aménagement : ligne visée pour « Aligner sur… »
  survolAmenag(p, e) {
    const s = this.alignement ? this.segmentSous(p.x, p.y, e) : null;
    const avant = this.segSurvol;
    this.segSurvol = s;
    if (s || avant) this.dessinerOverlay();
  }

  tap(p, e) {
    if (this.outilCote) {
      const a = this.accrocher(p.x, p.y, e);
      if (e.pointerType !== 'mouse') this.setSurvol(null);
      this.onCote?.(a);
      return;
    }
    if (this.mode === 'amenager') {
      this.onTap?.(null, p, e);
    } else if (this.mode === 'releve') {
      const a = this.accrocher(p.x, p.y, e);
      if (e.pointerType !== 'mouse') this.setSurvol(null);
      this.onTap?.(a, p, e);
    } else if (this.mode === 'tracer') {
      const pts = this.contour.points;
      if (pts.length >= 3 && this.sommetSous(p.x, p.y, e) === 0) { this.fermer(); return; }
      const a = this.accrocher(p.x, p.y, e);
      if (a.contour !== undefined) return; // pas de doublon
      pts.push({ x: a.x, y: a.y, src: a.src });
      if (e.pointerType !== 'mouse') this.setSurvol(null);
      this.dessinerContour();
      this.onContour?.(this.contour);
    } else if (this.mode === 'modifier') {
      this.selection = -1;
      this.dessinerContour();
      this.onContour?.(this.contour, true);
    }
  }

  fermer() {
    if (this.contour.points.length < 3) return false;
    this.contour.ferme = true;
    this.dessinerContour();
    this.onContour?.(this.contour);
    return true;
  }

  // ---------- Dessin ----------
  dessinerContour() {
    this.gContour.replaceChildren();
    const pts = this.contour.points;
    if (pts.length) {
      const d = chemin(pts.map((p) => [p.x, p.y]), this.contour.ferme);
      el('path', { d, class: this.contour.ferme ? 'contour ferme' : 'contour' }, this.gContour);
    }
    this.dessinerOverlay();
  }

  dessinerOverlay() {
    const o = this.gOverlay;
    o.replaceChildren();
    const pts = this.contour.points;
    const edit = this.mode === 'tracer' || this.mode === 'modifier';
    // longueurs des côtés (masquées pendant le relevé pour ne pas encombrer)
    const n = this.mode === 'releve' || this.mode === 'amenager' ? 0 : this.contour.ferme ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = this.versEcran(pts[i]), b = this.versEcran(pts[(i + 1) % pts.length]);
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 56) continue;
      let ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      const decal = this.mode === 'modifier' && this.contour.ferme ? -13 : -6; // au-dessus du « + »
      const t = el('text', { class: 'cote', transform: `translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2}) rotate(${ang}) translate(0,${decal})` }, o);
      t.textContent = dist(pts[i], pts[(i + 1) % pts.length]).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m';
    }
    if (edit) {
      // milieux (ajout de point)
      if (this.mode === 'modifier' && this.contour.ferme) {
        for (let i = 0; i < pts.length; i++) {
          const a = this.versEcran(pts[i]), b = this.versEcran(pts[(i + 1) % pts.length]);
          if (Math.hypot(b.x - a.x, b.y - a.y) < 40) continue;
          const g = el('g', { class: 'milieu', transform: `translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2})` }, o);
          el('circle', { r: 7 }, g);
          el('path', { d: 'M-3.5 0H3.5M0 -3.5V3.5' }, g);
        }
      }
      // sommets
      pts.forEach((p, i) => {
        const q = this.versEcran(p);
        const cls = ['sommet', `src-${p.src || 'libre'}`];
        if (i === this.selection) cls.push('sel');
        if (i === 0 && this.mode === 'tracer' && pts.length >= 3) cls.push('premier');
        el('circle', { cx: q.x, cy: q.y, r: i === this.selection ? 8 : 6, class: cls.join(' ') }, o);
      });
    }
    if (this.selPicc) {
      const sp = this.selPicc, E = ([x, y]) => this.versEcran({ x, y });
      if (sp.t === 'p') { const q = E(sp.g[0]); el('circle', { cx: q.x, cy: q.y, r: sp.k === 'arbre' ? Math.max(2.5 * this.vue.s, 8) : 9, class: 'picc-sel' }, o); }
      else {
        const anneaux = sp.t === 'a' ? sp.g : [sp.g];
        const d = anneaux.map((r) => r.map((p, i) => { const q = E(p); return `${i ? 'L' : 'M'}${q.x} ${q.y}`; }).join('') + (sp.t === 'a' ? 'Z' : '')).join('');
        el('path', { d, class: 'picc-sel' }, o);
      }
    }
    if (this.mode === 'releve') this.dessinerReleve(o);
    if (this.mode === 'amenager') this.dessinerAmenagOverlay(o);
    this.dessinerCotes(o);
    // marqueur d'accrochage
    const a = this.survol;
    const montrer = edit || this.outilCote || (this.mode === 'releve' && !(this.mesure && this.mesure.choix == null));
    if (a && montrer) {
      if (this.mode === 'releve' && !this.mesure && this.brouillon && this.brouillon.forme !== 'point' && this.brouillon.points.length) {
        const l = this.versEcran(this.brouillon.points[this.brouillon.points.length - 1]), q = this.versEcran(a);
        el('line', { x1: l.x, y1: l.y, x2: q.x, y2: q.y, class: 'elastique' }, o);
      }
      const q = this.versEcran(a);
      if (this.mode === 'tracer' && pts.length && !this.contour.ferme && !(this.geste && this.geste.type === 'sommet')) {
        const l = this.versEcran(pts[pts.length - 1]);
        el('line', { x1: l.x, y1: l.y, x2: q.x, y2: q.y, class: 'elastique' }, o);
      }
      if (a.src === 'picc' || a.src === 'element') el('rect', { x: q.x - 7, y: q.y - 7, width: 14, height: 14, class: 'accroche' }, o);
      else if (a.src === 'ligne') el('circle', { cx: q.x, cy: q.y, r: 7, class: 'accroche' }, o);
      else el('path', { d: `M${q.x - 8} ${q.y}H${q.x + 8}M${q.x} ${q.y - 8}V${q.y + 8}`, class: 'accroche libre' }, o);
    }
  }

  // Étiquettes des objets, poignée de rotation, ligne visée pour l'alignement
  dessinerAmenagOverlay(o) {
    const s = this.vue.s;
    this.objets.forEach((ob) => {
      const petit = Math.min(ob.w, ob.l) * s, grand = Math.max(ob.w, ob.l) * s;
      if (petit < 16 || grand < 46) return;
      const q = this.versEcran(ob);
      // texte dans le sens de la plus grande dimension, toujours lisible
      let ang = ob.l >= ob.w ? ob.rot - 90 : ob.rot;
      ang = ((ang % 360) + 360) % 360;
      if (ang > 90 && ang <= 270) ang -= 180;
      const t = el('text', { class: `am-lib${ob.cat === 'zone' ? ' zone' : ''}`, transform: `translate(${q.x},${q.y}) rotate(${ang})` }, o);
      const deux = petit >= 34;
      el('tspan', { x: 0, dy: deux ? -2 : 4 }, t).textContent = ob.nom;
      if (deux) el('tspan', { x: 0, dy: 14, class: 'dim' }, t).textContent = `${fmtNb(ob.w)} × ${fmtNb(ob.l)} m`;
    });
    const ob = this.objets[this.selObj];
    // distances aux éléments proches (calculées par l'application)
    this.distances = ob && this.calculDistances ? this.calculDistances(ob) : [];
    this.dessinerDistances(o, this.distances);
    if (ob && !this.alignement) {
      const h = this.poignee(ob);
      el('line', { x1: h.bout.x, y1: h.bout.y, x2: h.x, y2: h.y, class: 'rot-ligne' }, o);
      el('circle', { cx: h.x, cy: h.y, r: 8, class: 'rot-poignee' }, o);
      const lab = el('text', { x: h.x + 14, y: h.y + 4, class: 'rot-txt' }, o);
      lab.textContent = `${fmtNb(ob.rot)}°`;
    }
    if (this.alignement && this.segSurvol) {
      const [a, b] = this.segSurvol.map((p) => this.versEcran(p));
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'seg-vise' }, o);
    }
  }

  // Cote gardée sous le doigt (index ou -1)
  coteSous(p, e) {
    if (!this.cotesVisibles) return -1;
    let best = -1, bd = this.rayon(e);
    (this.cotes || []).forEach((c, i) => {
      const a = this.versEcran(c.a), b = this.versEcran(c.b);
      const q = projSeg(p, a, b), d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  // Cotes : celles gardées sur le plan (si affichées) et celle en cours de mesure
  dessinerCotes(o) {
    const sel = this.outilCote && this.cotesVisibles ? this.cotes?.[this.coteSel] : null;
    if (sel) {
      // cote sélectionnée : surlignée, avec une poignée à chaque bout
      const a = this.versEcran(sel.a), b = this.versEcran(sel.b);
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'cote-sel' }, o);
    }
    const liste = this.cotesVisibles ? [...(this.cotes || [])] : [];
    const t = this.coteTemp;
    if (t?.a) liste.push({ a: t.a, b: t.b || (this.survol && this.outilCote ? this.survol : null), temp: true });
    for (const c of liste) {
      const pa = this.versEcran(c.a);
      el('circle', { cx: pa.x, cy: pa.y, r: 3.5, class: `cote-bout${c.temp ? ' temp' : ''}` }, o);
      if (!c.b) continue;
      const pb = this.versEcran(c.b), L = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const cls = `cote-ligne${c.temp ? ' temp' : ''}`;
      el('line', { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, class: cls }, o);
      // petits traits perpendiculaires aux bouts
      const nx = L ? -(pb.y - pa.y) / L * 6 : 0, ny = L ? (pb.x - pa.x) / L * 6 : 0;
      el('path', { d: `M${pa.x + nx} ${pa.y + ny}L${pa.x - nx} ${pa.y - ny}M${pb.x + nx} ${pb.y + ny}L${pb.x - nx} ${pb.y - ny}`, class: cls }, o);
      el('circle', { cx: pb.x, cy: pb.y, r: 3.5, class: `cote-bout${c.temp ? ' temp' : ''}` }, o);
      let ang = Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180 / Math.PI;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      const d = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
      el('text', { class: `cote-txt${c.temp ? ' temp' : ''}`, transform: `translate(${(pa.x + pb.x) / 2},${(pa.y + pb.y) / 2}) rotate(${ang}) translate(0,-6)` }, o)
        .textContent = `${fmtNb(Math.round(d * 100) / 100)} m`;
    }
    if (sel) for (const k of ['a', 'b']) {
      const q = this.versEcran(sel[k]);
      el('circle', { cx: q.x, cy: q.y, r: 7.5, class: 'cote-poignee' }, o);
    }
  }

  // Traits de distance vers les éléments proches, avec la valeur
  dessinerDistances(o, liste, cls = 'dist') {
    for (const r of liste) {
      const p = this.versEcran(r.p), q = this.versEcran(r.q);
      const L = Math.hypot(q.x - p.x, q.y - p.y);
      el('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, class: `${cls}-ligne` }, o);
      el('circle', { cx: q.x, cy: q.y, r: 2.5, class: `${cls}-bout` }, o);
      const txt = `${fmtNb(Math.round(r.d * 100) / 100)} m`;
      if (L < 46) {
        // trait trop court pour y écrire : étiquette à côté de l'élément
        const ux = L ? (q.x - p.x) / L : 0, uy = L ? (q.y - p.y) / L : -1;
        el('text', { class: `${cls}-txt`, x: q.x + ux * 22, y: q.y + uy * 14 + 4 }, o).textContent = txt;
        continue;
      }
      let ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      const t = el('text', { class: `${cls}-txt`, transform: `translate(${(p.x + q.x) / 2},${(p.y + q.y) / 2}) rotate(${ang}) translate(0,-4)` }, o);
      t.textContent = txt;
    }
  }

  // Poignées de l'élément sélectionné / en saisie, repères et cercles de mesure
  dessinerReleve(o) {
    // distances en direct depuis l'élément en saisie ou sélectionné (sauf pendant une mesure)
    const pl = this.placement;
    const cibleDist = this.brouillon?.points.length ? this.brouillon : this.elements[this.selEl];
    const actif = cibleDist && !this.mesure && !pl && this.glisserElements;
    // hors placement : distances aux éléments proches de l'élément sélectionné
    this.distancesEl = actif ? this.calculDistancesEl?.(cibleDist) || [] : [];
    this.dessinerDistances(o, this.distancesEl, 'dist');
    // poignée de rotation de l'élément sélectionné (comme en aménagement) et ligne visée pour « Aligner sur… »
    const selEl = this.elements[this.selEl];
    if (selEl && peutTourner(selEl) && !this.mesure && this.glisserElements && !this.alignement) {
      const h = this.poigneeElement(selEl);
      el('line', { x1: h.bout.x, y1: h.bout.y, x2: h.x, y2: h.y, class: 'rot-ligne' }, o);
      el('circle', { cx: h.x, cy: h.y, r: 8, class: 'rot-poignee' }, o);
      el('text', { x: h.x + 14, y: h.y + 4, class: 'rot-txt' }, o).textContent = `${fmtNb(Math.round(rotationDe(selEl) * 10) / 10)}°`;
    }
    if (this.alignement && this.segSurvol) {
      const [a, b] = this.segSurvol.map((q) => this.versEcran(q));
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'seg-vise' }, o);
    }
    if (pl) {
      // placement : distances du point vers les repères choisis, repères numérotés, point à glisser
      this.dessinerDistances(o, pl.distances(), 'rep');
      pl.refs.forEach((r, i) => {
        const q = this.versEcran(r);
        const g = el('g', { class: 'repere-choisi', transform: `translate(${q.x},${q.y})` }, o);
        el('rect', { x: -6, y: -6, width: 12, height: 12, transform: 'rotate(45)' }, g);
        el('text', { x: 12, y: -8 }, g).textContent = `R${i + 1}`;
      });
      const q = this.versEcran(pl.pt);
      el('circle', { cx: q.x, cy: q.y, r: 13, class: 'pt-placer-halo' }, o);
      el('circle', { cx: q.x, cy: q.y, r: 6.5, class: 'pt-placer' }, o);
    }
    const poignees = (e, cls) => e.points.forEach((p) => {
      const q = this.versEcran(p);
      el('circle', { cx: q.x, cy: q.y, r: 5, class: `sommet ${cls} src-${p.src || 'libre'}` }, o);
    });
    if (this.selEl >= 0 && this.elements[this.selEl]) poignees(this.elements[this.selEl], 'el-poignee');
    if (this.brouillon) poignees(this.brouillon, 'el-poignee');

    const m = this.mesure;
    if (!m) return;
    const s = this.vue.s;
    if (m.choix != null) {
      for (const c of m.candidats) {
        const q = this.versEcran(c);
        el('path', { d: `M${q.x} ${q.y - 7}L${q.x + 7} ${q.y}L${q.x} ${q.y + 7}L${q.x - 7} ${q.y}Z`, class: 'candidat' }, o);
      }
    }
    const fin = this.versEcran(m.res || m.cible);
    m.refs.forEach((r, k) => {
      if (!r) return;
      const q = this.versEcran(r);
      if (m.d[k] > 0) el('circle', { cx: q.x, cy: q.y, r: m.d[k] * s, class: 'cercle-mesure' }, o);
      el('line', { x1: q.x, y1: q.y, x2: fin.x, y2: fin.y, class: 'rayon-mesure' }, o);
    });
    const qe = this.versEcran(m.cible);
    el('circle', { cx: qe.x, cy: qe.y, r: 10, class: 'cible' }, o);
    if (m.res) el('circle', { cx: fin.x, cy: fin.y, r: 5.5, class: 'resultat' }, o);
    m.refs.forEach((r, k) => {
      if (!r) return;
      const q = this.versEcran(r);
      el('circle', { cx: q.x, cy: q.y, r: 3.5, class: 'pt-ref' }, o);
      const g = el('g', { class: `badge-ref${m.choix === k ? ' choix' : ''}`, transform: `translate(${q.x + 13},${q.y - 13})` }, o);
      el('circle', { r: 10 }, g);
      el('text', { y: 4.5 }, g).textContent = 'AB'[k];
    });
  }
}

// Dessin d'un élément relevé, en mètres (dans le groupe « monde »)
function dessinerElement(e, g) {
  const pts = e.points;
  if (!pts.length) return;
  if (e.forme === 'point') {
    const p = pts[0];
    if (e.type === 'arbre') {
      el('circle', { cx: p.x, cy: p.y, r: Math.max((valeur(e, 'couronne') || 4) / 2, 0.3), class: 'couronne' }, g);
      el('circle', { cx: p.x, cy: p.y, r: Math.max((valeur(e, 'tronc') || 30) / 200, 0.08), class: 'tronc' }, g);
    } else {
      el('circle', { cx: p.x, cy: p.y, r: Math.max((valeur(e, 'largeur') || 0.5) / 2, 0.1), class: 'corps' }, g);
    }
    return;
  }
  const d = chemin(pts.map((p) => [p.x, p.y]), e.forme === 'surface');
  if (e.forme === 'surface') { el('path', { d, class: 'corps' }, g); return; }
  const ep = e.type === 'autre' ? valeur(e, 'largeur') : valeur(e, 'epaisseur');
  el('path', { d, class: 'epais', style: `stroke-width:${Math.max(ep || 0.1, 0.05)}` }, g);
  el('path', { d, class: 'axe' }, g);
}

// Point dans un polygone (règle pair-impair)
function dedans(p, pts) {
  let r = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}
