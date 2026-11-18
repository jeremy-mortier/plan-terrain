// Impression / PDF : plan à l'échelle (en millimètres sur la feuille) et listes.
// Le navigateur se charge de l'impression ou de l'enregistrement en PDF.

import { aire, perimetre, fmt, fmtM, fmtM2, dist } from './geom.js';
import * as am from './amenagement.js';
import { TYPES, valeur } from './releve.js';

const ECHELLES = [100, 200, 250, 500, 1000, 2000, 2500, 5000];
// Zone utile pour le plan sur une feuille A4 (marges de 10 mm, en-tête compris)
const FORMATS = { paysage: { w: 277, h: 168 }, portrait: { w: 190, h: 240 } };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n2 = (v) => Math.round(v * 100) / 100;

// Emprise utile : contour, éléments relevés, aménagement
function emprise(plan, opts) {
  const pts = [...plan.contour.points];
  if (opts.releve) for (const e of plan.elements) {
    const r = e.type === 'arbre' ? (valeur(e, 'couronne') || 4) / 2 : 0;
    for (const p of e.points) pts.push({ x: p.x - r, y: p.y - r }, { x: p.x + r, y: p.y + r });
  }
  if (opts.amenagement) for (const o of plan.amenagement) pts.push(...am.coins(o));
  if (!pts.length) return [-40, -40, 40, 40];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return [Math.min(...xs) - 3, Math.min(...ys) - 3, Math.max(...xs) + 3, Math.max(...ys) + 3];
}

export function echelleAuto(plan, opts) {
  const [x0, y0, x1, y1] = emprise(plan, opts), F = FORMATS[opts.orientation];
  return ECHELLES.find((N) => (x1 - x0) * 1000 / N <= F.w && (y1 - y0) * 1000 / N <= F.h) || 5000;
}

// ---------------------------------------------------------------- Plan (SVG en mm)
function planSVG(plan, opts, N) {
  const F = FORMATS[opts.orientation], k = 1000 / N;      // mm par mètre
  const [x0, y0, x1, y1] = emprise(plan, opts);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const X = (x) => n2(F.w / 2 + (x - cx) * k), Y = (y) => n2(F.h / 2 - (y - cy) * k);
  const P = (p) => `${X(p.x)},${Y(p.y)}`;
  const chemin = (pts, ferme) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0] ?? p.x)} ${Y(p[1] ?? p.y)}`).join('') + (ferme ? 'Z' : '');
  const out = [];
  const t = (x, y, txt, cls, ang = 0) => out.push(`<text class="${cls}" transform="translate(${n2(x)},${n2(y)}) rotate(${n2(ang)})">${txt}</text>`);

  // fond PICC
  if (opts.fond) {
    const ordre = ['eau', 'voirie', 'rigole', 'talus', 'berge', 'cours', 'batiment', 'ouvrage', 'limite', 'haie', 'rangee', 'cloture', 'muret', 'equipement', 'sol', 'poteau', 'arbre'];
    const objets = [...plan.picc.objets].sort((a, b) => ordre.indexOf(a.k) - ordre.indexOf(b.k));
    for (const o of objets) {
      if (o.t === 'p') {
        const r = o.k === 'arbre' ? 2 * k : 0.6;
        out.push(`<circle class="i-${o.k}" cx="${X(o.g[0][0])}" cy="${Y(o.g[0][1])}" r="${n2(r)}"/>`);
      } else if (o.t === 'l') out.push(`<path class="i-${o.k}" d="${chemin(o.g, false)}"/>`);
      else out.push(`<path class="i-${o.k}" fill-rule="evenodd" d="${o.g.map((r) => chemin(r, true)).join('')}"/>`);
    }
  }
  // contour
  const c = plan.contour.points;
  if (c.length >= 2) {
    out.push(`<path class="i-contour" d="${chemin(c, plan.contour.ferme)}"/>`);
    if (opts.cotes) {
      const n = plan.contour.ferme ? c.length : c.length - 1;
      const mm = c.map((p) => ({ x: X(p.x), y: Y(p.y) }));
      for (let i = 0; i < n; i++) {
        const a = mm[i], b = mm[(i + 1) % c.length], L = Math.hypot(b.x - a.x, b.y - a.y);
        if (L < 14) continue;
        let nx = (b.y - a.y) / L, ny = -(b.x - a.x) / L;
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (plan.contour.ferme && am.dansPolygone({ x: m.x + nx, y: m.y + ny }, mm)) { nx = -nx; ny = -ny; }
        let ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
        if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
        t(m.x + nx * 2.4, m.y + ny * 2.4 + 0.9, `${fmt(dist(c[i], c[(i + 1) % c.length]), 2)} m`, 'i-cote', ang);
      }
    }
  }
  // éléments relevés
  if (opts.releve) for (const e of plan.elements) {
    const p = e.points;
    const etat = p.every((q) => q.src === 'mesure') ? '' : ' i-estime';
    if (e.forme === 'point') {
      if (e.type === 'arbre') {
        out.push(`<circle class="i-couronne${etat}" cx="${X(p[0].x)}" cy="${Y(p[0].y)}" r="${n2((valeur(e, 'couronne') || 4) / 2 * k)}"/>`);
        out.push(`<circle class="i-tronc" cx="${X(p[0].x)}" cy="${Y(p[0].y)}" r="${n2(Math.max((valeur(e, 'tronc') || 30) / 200 * k, 0.5))}"/>`);
      } else out.push(`<circle class="i-autre${etat}" cx="${X(p[0].x)}" cy="${Y(p[0].y)}" r="${n2(Math.max((valeur(e, 'largeur') || 0.5) / 2 * k, 0.6))}"/>`);
      t(X(p[0].x), Y(p[0].y) + Math.max(((valeur(e, 'couronne') || 0) / 2) * k * 0.3, 2.5) + 1.5, esc(e.nom), 'i-nom-el');
    } else if (e.forme === 'surface') {
      out.push(`<path class="i-autre${etat}" d="${chemin(p, true)}"/>`);
    } else {
      const ep = (e.type === 'autre' ? valeur(e, 'largeur') : valeur(e, 'epaisseur')) || 0.2;
      out.push(`<path class="i-ep-${e.type}${etat}" style="stroke-width:${n2(Math.max(ep * k, 0.4))}" d="${chemin(p, false)}"/>`);
    }
  }
  // aménagement
  if (opts.amenagement) {
    const objets = [...plan.amenagement].sort((a, b) => (a.cat === 'zone' ? 0 : 1) - (b.cat === 'zone' ? 0 : 1));
    for (const o of objets) {
      out.push(`<polygon class="i-am i-cat-${o.cat}" points="${am.coins(o).map(P).join(' ')}"/>`);
      if (am.aFacade(o)) {
        const [a, b] = am.facade(o), c = am.coins(o), n = am.estMarche(o) ? am.travees(o) : 1;
        out.push(`<path class="i-facade" d="M${P(a)}L${P(b)}"/>`);
        let d = '';
        for (let k = 1; k < n; k++) { const t = k / n; d += `M${P({ x: c[0].x + (c[3].x - c[0].x) * t, y: c[0].y + (c[3].y - c[0].y) * t })}L${P({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })}`; }
        if (d) out.push(`<path class="i-travee" d="${d}"/>`);
      }
    }
    for (const o of objets) {
      const petit = Math.min(o.w, o.l) * k, grand = Math.max(o.w, o.l) * k;
      const fs = Math.min(2.6, petit / 2.6);
      if (fs < 1.4 || o.nom.length * fs * 0.55 > grand - 1) continue;
      let ang = o.l >= o.w ? o.rot - 90 : o.rot;
      ang = ((ang % 360) + 360) % 360;
      if (ang > 90 && ang <= 270) ang -= 180;
      const deux = petit >= fs * 3.2;
      out.push(`<text class="i-am-lib${o.cat === 'zone' ? ' zone' : ''}" style="font-size:${n2(fs)}px" transform="translate(${X(o.x)},${Y(o.y)}) rotate(${n2(ang)})">`
        + `<tspan x="0" dy="${deux ? n2(-fs * 0.15) : n2(fs * 0.35)}">${esc(o.nom)}</tspan>`
        + (deux ? `<tspan x="0" dy="${n2(fs * 1.15)}" class="dim">${fmt(o.w, o.w % 1 ? 1 : 0)} × ${fmt(o.l, o.l % 1 ? 1 : 0)} m</tspan>` : '')
        + '</text>');
    }
  }
  // nord et échelle
  const L = [1, 2, 5, 10, 20, 50, 100, 200].find((m) => m * k >= 20) || 200;
  const bx = 4, by = F.h - 5, lw = n2(L * k);
  out.push(`<g class="i-cartouche"><rect x="1.5" y="${F.h - 13}" width="${lw + 18}" height="11.5" rx="1"/>`
    + `<path class="i-ech" d="M${bx} ${by}h${lw}M${bx} ${by - 1.5}v3M${bx + lw} ${by - 1.5}v3M${n2(bx + lw / 2)} ${by - 1}v2"/>`
    + `<text class="i-ech-t" x="${bx}" y="${by - 2.6}">0</text><text class="i-ech-t" x="${n2(bx + lw)}" y="${by - 2.6}" text-anchor="middle">${L} m</text>`
    + `<text class="i-ech-t" x="${n2(bx + lw + 3)}" y="${by + 1}">1:${N}</text></g>`);
  out.push(`<g class="i-nord" transform="translate(8,9)"><rect x="-5" y="-6.5" width="10" height="13" rx="1"/><path d="M0 -4.5L2.6 2.5L0 1.2L-2.6 2.5Z"/><text y="5.6" text-anchor="middle">N</text></g>`);

  return `<svg class="i-plan" xmlns="http://www.w3.org/2000/svg" width="${F.w}mm" height="${F.h}mm" viewBox="0 0 ${F.w} ${F.h}">${out.join('')}</svg>`;
}

// ---------------------------------------------------------------- Listes
function resumeElement(e) {
  const v = (c) => e.attrs?.[c];
  const parts = [];
  if (e.type === 'arbre') {
    if (v('tronc')) parts.push(`tronc Ø ${fmt(+v('tronc'), 0)} cm`);
    if (v('couronne')) parts.push(`couronne Ø ${fmt(+v('couronne'), 1)} m`);
    if (v('branches')) parts.push(`1res branches à ${fmt(+v('branches'), 1)} m`);
  } else if (e.forme === 'ligne') parts.push(fmtM(perimetre(e.points, false), 2));
  else if (e.forme === 'surface') parts.push(fmtM2(aire(e.points)));
  if (v('epaisseur')) parts.push(`ép. ${fmt(+v('epaisseur'), 2)} m`);
  if (v('largeur')) parts.push(`larg. ${fmt(+v('largeur'), 2)} m`);
  if (v('hauteur')) parts.push(`h. ${fmt(+v('hauteur'), 1)} m`);
  return parts.join(' · ');
}

function listes(plan, opts) {
  const blocs = [];
  if (opts.amenagement && plan.amenagement.length) {
    const mat = am.materiel(plan);
    blocs.push(`<section><h2>Liste du matériel</h2><table><thead><tr><th>Élément</th><th>Dimensions</th><th>Catégorie</th><th class="n">Nb</th><th class="n">m²</th></tr></thead><tbody>`
      + mat.lignes.map((g) => `<tr><td>${esc(g.nom)}</td><td>${fmt(g.w, g.w % 1 ? 1 : 0)} × ${fmt(g.l, g.l % 1 ? 1 : 0)} m</td><td>${am.CATEGORIES[g.cat]}</td><td class="n">${g.nb}</td><td class="n">${g.cat === 'zone' ? '–' : fmt(g.nb * g.w * g.l, 0)}</td></tr>`).join('')
      + `</tbody></table><p class="i-totaux">${mat.terrain != null ? `Terrain ${fmtM2(mat.terrain)} · ` : ''}occupé ${fmtM2(mat.occupe)}${mat.terrain != null ? ` · reste libre ${fmtM2(Math.max(mat.terrain - mat.occupe, 0))}` : ''}</p></section>`);
    const al = am.alertes(plan).liste;
    blocs.push(`<section><h2>Points d'attention</h2>${al.length ? `<ul>${al.map((a) => `<li>${esc(a.t)}</li>`).join('')}</ul>` : '<p>Rien à signaler.</p>'}</section>`);
  }
  if (opts.releve && plan.elements.length) {
    blocs.push(`<section><h2>Éléments relevés</h2><table><thead><tr><th>Nom</th><th>Type</th><th>Dimensions</th><th>Position</th></tr></thead><tbody>`
      + plan.elements.map((e) => `<tr><td>${esc(e.nom)}</td><td>${TYPES[e.type].lib}</td><td>${esc(resumeElement(e)) || '–'}</td><td>${e.points.every((p) => p.src === 'mesure') ? 'mesurée' : 'estimée'}</td></tr>`).join('')
      + '</tbody></table></section>');
  }
  return blocs.join('');
}

// ---------------------------------------------------------------- Document complet
export function construire(plan, opts, adresse) {
  const N = opts.echelle === 'auto' ? echelleAuto(plan, opts) : +opts.echelle;
  const c = plan.contour;
  const infos = [adresse];
  if (c.ferme && c.points.length >= 3) infos.push(`terrain ${fmtM2(aire(c.points))}, périmètre ${fmtM(perimetre(c.points), 1)}`);
  infos.push(`échelle 1:${N} sur A4`);
  const date = new Date().toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' });
  const lst = opts.listes ? listes(plan, opts) : '';
  return `
    <div class="i-page">
      <header class="i-tete"><div><h1>${esc(plan.nom)}</h1><p>${infos.map(esc).join(' · ')}</p></div><p class="i-date">${date}</p></header>
      ${planSVG(plan, opts, N)}
      <p class="i-pied">Fond de plan : PICC © SPW (précision indicative 30 à 50 cm). Positions mesurées au mètre sur place lorsque indiqué.</p>
    </div>
    ${lst ? `<div class="i-page i-listes"><header class="i-tete"><div><h1>${esc(plan.nom)}</h1><p>${esc(adresse)}</p></div><p class="i-date">${date}</p></header>${lst}</div>` : ''}`;
}
