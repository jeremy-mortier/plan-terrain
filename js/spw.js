// Accès aux données PICC du Service public de Wallonie (geoservices.wallonie.be).
// Coordonnées : Lambert belge 2008 (EPSG:3812), en mètres.

const BASE = 'https://geoservices.wallonie.be/arcgis/rest/services/TOPOGRAPHIE/PICC_VDIFF/MapServer';
const SR = 3812;

async function requete(couche, params) {
  const u = new URL(`${BASE}/${couche}/query`);
  for (const [k, v] of Object.entries({ f: 'json', ...params })) u.searchParams.set(k, v);
  let r;
  try {
    r = await fetch(u);
  } catch {
    throw new Error("Le serveur du SPW ne répond pas : il est peut-être en panne, ou la connexion Internet est coupée. Réessayez dans quelques minutes.");
  }
  if (!r.ok) throw new Error(`Le serveur du SPW a répondu par une erreur (${r.status}).`);
  const j = await r.json();
  if (j.error) throw new Error(`Le serveur du SPW a refusé la demande : ${j.error.message}`);
  return j;
}

const sql = (s) => String(s).replace(/'/g, "''");
export const sansAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Liste des rues d'un code postal
export async function rues(cp) {
  const j = await requete(1, {
    where: `CODEPOSTAL=${Number(cp)}`,
    outFields: 'RUE_NOM,COMMU_NOM',
    returnDistinctValues: 'true',
    returnGeometry: 'false',
  });
  return j.features
    .map((f) => ({ rue: f.attributes.RUE_NOM, commune: f.attributes.COMMU_NOM }))
    .filter((r) => r.rue)
    .sort((a, b) => a.rue.localeCompare(b.rue, 'fr'));
}

// Position d'une adresse. Sans numéro (ou numéro introuvable) : centre des adresses de la rue.
export async function localiser(cp, rue, numero) {
  const base = `CODEPOSTAL=${Number(cp)} AND RUE_NOM='${sql(rue)}'`;
  const params = { outFields: 'RUE_NOM,NUMERO,COMMU_NOM', returnGeometry: 'true', outSR: SR };
  if (numero) {
    const j = await requete(1, { ...params, where: `${base} AND NUMERO='${sql(numero)}'` });
    if (j.features.length) {
      const f = j.features[0];
      return { x: f.geometry.x, y: f.geometry.y, commune: f.attributes.COMMU_NOM, exact: true };
    }
  }
  const j = await requete(1, { ...params, where: base });
  if (!j.features.length) throw new Error("Cette rue est introuvable pour ce code postal.");
  const xs = j.features.map((f) => f.geometry.x), ys = j.features.map((f) => f.geometry.y);
  return {
    x: xs.reduce((a, b) => a + b) / xs.length,
    y: ys.reduce((a, b) => a + b) / ys.length,
    commune: j.features[0].attributes.COMMU_NOM,
    exact: false,
  };
}

// Couches PICC chargées pour un plan
const COUCHES = [
  { id: 11, geo: 'poly' },  // Bâtiments (emprise)
  { id: 12, geo: 'poly' },  // Ouvrages (emprise)
  { id: 30, geo: 'poly' },  // Eau (emprise)
  { id: 29, geo: 'ligne' }, // Berges
  { id: 28, geo: 'ligne' }, // Cours d'eau (axe)
  { id: 20, geo: 'ligne' }, // Voirie (bords, trottoirs, rigoles…)
  { id: 15, geo: 'ligne' }, // Haies, rangées d'arbres
  { id: 5, geo: 'ligne' },  // Clôtures, murets
  { id: 32, geo: 'ligne' }, // Talus
  { id: 14, geo: 'point' }, // Arbres isolés
  { id: 4, geo: 'point' },  // Poteaux, bornes, avaloirs…
];

// Classe d'affichage d'un objet selon sa couche et sa nature
function classer(couche, nature = '') {
  const n = sansAccents(nature);
  switch (couche) {
    case 11: return 'batiment';
    case 12: return 'ouvrage';
    case 30: return 'eau';
    case 29: return 'berge';
    case 28: return 'cours';
    case 20: return n.includes('rigole') ? 'rigole' : 'voirie';
    case 15: return n.startsWith('haie') ? 'haie' : n.includes('arbre') ? 'rangee' : 'limite';
    case 5: return n.startsWith('cloture') ? 'cloture' : n.startsWith('muret') ? 'muret' : 'equipement';
    case 32: return 'talus';
    case 14: return 'arbre';
    case 4: return /taque|avaloir|chambre|regard|grille/.test(n) ? 'sol' : 'poteau';
    default: return 'autre';
  }
}

const r2 = (v) => Math.round(v * 100) / 100;

// Signature stable d'un objet PICC (sert à retenir les objets retirés d'un plan, même après rechargement)
export function signature(o) {
  const p = o.t === 'a' ? o.g[0][0] : o.g[0];
  const n = o.t === 'a' ? o.g[0].length : o.g.length;
  return `${o.k}:${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}:${n}`;
}

// Charge les objets PICC dans un carré autour de (cx, cy).
// Les coordonnées renvoyées sont locales : relatives à l'origine (ox, oy).
export async function chargerPICC(zone, origine, progression = () => {}) {
  const env = `${zone.xmin},${zone.ymin},${zone.xmax},${zone.ymax}`;
  const loc = ([x, y]) => [r2(x - origine.x), r2(y - origine.y)];
  const objets = [];
  let fait = 0;
  await Promise.all(COUCHES.map(async (c) => {
    let offset = 0;
    for (;;) {
      const j = await requete(c.id, {
        geometry: env, geometryType: 'esriGeometryEnvelope', inSR: SR, outSR: SR,
        spatialRel: 'esriSpatialRelIntersects', outFields: c.id === 12 ? 'NATUR_DESC,DATE_MODIF' : 'NATUR_DESC,DATE_LEVE,DATE_MODIF',
        geometryPrecision: 2, orderByFields: 'OBJECTID',
        resultOffset: offset, resultRecordCount: 2000,
      });
      for (const f of j.features) {
        const g = f.geometry;
        if (!g) continue;
        const nature = f.attributes.NATUR_DESC || '';
        const base = { k: classer(c.id, nature), n: nature };
        // années : a = relevé sur le terrain, m = dernière modification de la donnée
        const an = (v) => (v ? new Date(v).getUTCFullYear() : null);
        if (an(f.attributes.DATE_LEVE)) base.a = an(f.attributes.DATE_LEVE);
        if (an(f.attributes.DATE_MODIF)) base.m = an(f.attributes.DATE_MODIF);
        if (c.geo === 'point') objets.push({ ...base, t: 'p', g: [loc([g.x, g.y])] });
        else if (c.geo === 'ligne') for (const p of g.paths || []) objets.push({ ...base, t: 'l', g: p.map(loc) });
        else objets.push({ ...base, t: 'a', g: (g.rings || []).map((r) => r.map(loc)) });
      }
      if (!j.exceededTransferLimit) break;
      offset += j.features.length;
    }
    progression(++fait, COUCHES.length);
  }));
  return objets;
}
