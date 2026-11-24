import * as spw from './spw.js';
import * as store from './store.js';
import { Carte } from './carte.js';
import { aire, perimetre, seRecoupe, fmtM, fmtM2, fmt, dist, projSeg } from './geom.js';
import * as rel from './releve.js';
import * as am from './amenagement.js';
import * as imp from './impression.js';
import * as lien from './lien.js';

const $ = (s) => document.querySelector(s);
const RAYON_ZONE = 150; // demi-côté de la zone chargée autour de l'adresse (m)

// ---------------------------------------------------------------- Accueil
const vAccueil = $('#accueil'), vPlan = $('#plan');

async function afficherAccueil() {
  fermer3D();
  vPlan.hidden = true;
  vAccueil.hidden = false;
  document.title = 'Plan de terrain';
  const liste = $('#listePlans');
  let plans = [];
  try { plans = await store.lister(); } catch (e) { $('#msgListe').textContent = e.message; }
  liste.replaceChildren();
  $('#videPlans').hidden = plans.length > 0;
  for (const p of plans) {
    const li = document.createElement('li');
    li.className = 'ligne-plan';
    const pts = p.contour?.points || [];
    const nbEl = p.elements?.length || 0;
    const surf = (p.contour?.ferme && pts.length >= 3 ? fmtM2(aire(pts)) : 'contour à tracer') + (nbEl ? ` · ${nbEl} élément${nbEl > 1 ? 's' : ''}` : '');
    const date = new Date(p.modifie).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' });
    li.innerHTML = `
      <a class="lp-ouvrir" href="#p-${p.id}">
        <b></b><span class="lp-adr"></span>
        <span class="lp-meta"><span class="pastille ${p.contour?.valide ? 'ok' : ''}">${p.contour?.valide ? 'Contour validé' : 'Contour à valider'}</span><span>${surf}</span><span>modifié le ${date}</span></span>
      </a>
      <div class="lp-actions">
        <button class="btn petit" data-act="exporter">Exporter</button>
        <button class="btn petit danger" data-act="supprimer">Supprimer</button>
      </div>`;
    li.querySelector('b').textContent = p.nom;
    li.querySelector('.lp-adr').textContent = adresseTexte(p.adresse);
    li.querySelector('[data-act=exporter]').onclick = () => store.exporter(p);
    const bSup = li.querySelector('[data-act=supprimer]');
    bSup.onclick = async () => {
      if (bSup.dataset.confirme) { await store.supprimer(p.id); afficherAccueil(); return; }
      bSup.dataset.confirme = '1';
      bSup.textContent = 'Confirmer la suppression';
      setTimeout(() => { delete bSup.dataset.confirme; bSup.textContent = 'Supprimer'; }, 4000);
    };
    liste.append(li);
  }
}

const adresseTexte = (a) => a ? `${a.rue}${a.numero ? ' ' + a.numero : ''}, ${a.cp} ${a.commune || ''}`.trim() : '';

// Formulaire « Nouveau plan »
const fCp = $('#nCp'), fRue = $('#nRue'), fNum = $('#nNum'), fNom = $('#nNom'), fMsg = $('#nMsg');
let ruesCp = { cp: null, liste: [] };

fCp.addEventListener('input', async () => {
  const cp = fCp.value.trim();
  if (!/^\d{4}$/.test(cp) || cp === ruesCp.cp) return;
  fMsg.textContent = 'Recherche des rues…';
  try {
    const l = await spw.rues(cp);
    ruesCp = { cp, liste: l };
    $('#listeRues').replaceChildren(...l.map((r) => Object.assign(document.createElement('option'), { value: r.rue })));
    fMsg.textContent = l.length ? `${l.length} rues trouvées à ${[...new Set(l.map((r) => r.commune))].join(', ')}.` : "Aucune rue trouvée pour ce code postal. Ce service couvre uniquement la Wallonie.";
    fRue.disabled = fNum.disabled = !l.length;
    if (l.length) fRue.focus();
  } catch (e) { fMsg.textContent = e.message; }
});

$('#formNouveau').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const cp = fCp.value.trim();
  const saisie = spw.sansAccents(fRue.value);
  const rue = ruesCp.liste.find((r) => spw.sansAccents(r.rue) === saisie)
    || ruesCp.liste.find((r) => spw.sansAccents(r.rue).includes(saisie) && saisie.length > 2);
  if (!/^\d{4}$/.test(cp)) { fMsg.textContent = 'Indiquez un code postal à 4 chiffres.'; return; }
  if (!rue) { fMsg.textContent = 'Choisissez une rue dans la liste proposée.'; fRue.focus(); return; }
  const btn = $('#nCreer');
  btn.disabled = true;
  try {
    fMsg.textContent = "Recherche de l'adresse…";
    const num = fNum.value.trim();
    const pos = await spw.localiser(cp, rue.rue, num);
    const origine = { x: Math.round(pos.x), y: Math.round(pos.y) };
    const zone = { xmin: origine.x - RAYON_ZONE, ymin: origine.y - RAYON_ZONE, xmax: origine.x + RAYON_ZONE, ymax: origine.y + RAYON_ZONE };
    const objets = await spw.chargerPICC(zone, origine, (i, n) => { fMsg.textContent = `Chargement du plan SPW… ${Math.round(i / n * 100)} %`; });
    const adresse = { rue: rue.rue, numero: pos.exact ? num : '', cp, commune: pos.commune };
    const plan = {
      format: 'cartographie-plan', version: 1, id: store.nouvelId(),
      nom: fNom.value.trim() || adresseTexte(adresse),
      adresse, origine, zone, srid: 3812,
      picc: { charge: new Date().toISOString(), objets },
      contour: { points: [], ferme: false, valide: false },
      elements: [], amenagement: [],
      cree: new Date().toISOString(),
    };
    await store.enregistrer(plan);
    fMsg.textContent = num && !pos.exact ? `Le n° ${num} est introuvable : le plan est centré sur la rue.` : '';
    $('#formNouveau').reset();
    $('#dlgNouveau').hidden = true;
    location.hash = `p-${plan.id}`;
  } catch (e) {
    fMsg.textContent = e.message;
  } finally { btn.disabled = false; }
});

$('#bNouveau').onclick = () => { $('#dlgNouveau').hidden = false; fCp.focus(); };
$('#nAnnuler').onclick = () => { $('#dlgNouveau').hidden = true; };
$('#fImport').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  try { const p = await store.importer(f); $('#msgListe').textContent = `Plan « ${p.nom} » importé.`; afficherAccueil(); }
  catch (e) { $('#msgListe').textContent = e.message; }
});

// ---------------------------------------------------------------- Plan
let plan = null, histo = [], minuterie = null;
let etape = 1;                                            // 1 contour, 2 relevé
let R = { sel: -1, brouillon: null, dernierType: 'arbre' }; // état du relevé
let M = null;                                             // mesure en cours
let A = { sel: -1, aligner: false };                      // état de l'aménagement
let RT = { actif: false, sel: -1, modeAvant: null };      // retrait d'éléments SPW disparus

const carte = new Carte($('#carte'), {
  onContour: (c, selectionSeule) => {
    if (!selectionSeule) {
      pousserHisto();
      plan.contour = { ...plan.contour, points: structuredClone(c.points), ferme: c.ferme };
      if (c.ferme && carte.mode === 'tracer') carte.setMode('modifier');
      sauver();
    }
    majPanneau();
  },
  onSurvol: (a) => {
    const t = $('#infoSurvol');
    if (!a) { t.hidden = true; return; }
    t.hidden = false;
    t.textContent = a.contour !== undefined ? 'Point du contour'
      : { picc: 'Coin du plan SPW', ligne: 'Sur une ligne du plan SPW', libre: 'Point libre', element: "Point d'un élément relevé" }[a.src] || 'Point';
  },
  onVue: majEchelle,
  onTap: (a, p, e) => (RT.actif ? tapRetrait(p, e) : etape === 3 ? tapAmenag(p, e) : tapReleve(a, p, e)),
  onObjet: (evt, i) => objetCarte(evt, i),
});

function pousserHisto() {
  histo.push(JSON.stringify({ contour: plan.contour, elements: plan.elements, amenagement: plan.amenagement, retires: resumeRetires(plan.picc.retires), cotes: plan.cotes }));
  if (histo.length > 60) histo.shift();
  $('#bAnnuler').disabled = false;
}

function annuler() {
  if (!histo.length) return;
  const retraitActif = RT.actif;
  if (retraitActif) finRetrait();
  if (M) finMesure();
  R.brouillon = null; R.sel = -1;
  carte.setBrouillon(null);
  const h = JSON.parse(histo.pop());
  plan.contour = h.contour;
  plan.elements = h.elements;
  plan.amenagement = h.amenagement || [];
  plan.cotes = h.cotes || plan.cotes || [];
  if (C.sel >= plan.cotes.length) selCote(-1);
  majCotes();
  if (A.sel >= plan.amenagement.length) A.sel = -1;
  retablirRetires(h.retires || []);
  finAlignement();
  carte.setContour(plan.contour);
  carte.setElements(plan.elements);
  if (etape >= 2) carte.setMode(modeEtape());
  else if (plan.contour.valide) carte.setMode('naviguer');
  $('#bAnnuler').disabled = !histo.length;
  sauver();
  majPanneau();
  majReleve();
  majAmenag(true);
  if (retraitActif) debutRetrait();
}

function sauver() {
  const etat = $('#etatSauve');
  etat.textContent = 'Enregistrement…';
  clearTimeout(minuterie);
  minuterie = setTimeout(async () => {
    try { await store.enregistrer(plan); etat.textContent = 'Enregistré sur cet appareil'; }
    catch (e) { etat.textContent = `Non enregistré : ${e.message}`; }
  }, 300);
}

async function ouvrirPlan(id) {
  const p = await store.lire(id);
  if (!p) { location.hash = ''; return; }
  fermer3D();
  plan = p;
  plan.elements ||= [];
  plan.amenagement ||= [];
  plan.cotes ||= [];
  plan.picc.retires ||= [];
  RT = { actif: false, sel: -1, modeAvant: null };
  histo = [];
  if (M) finMesure();
  R = { sel: -1, brouillon: null, dernierType: R.dernierType };
  A = { sel: -1, aligner: false };
  etape = !plan.contour.valide ? 1 : plan.amenagement.length ? 3 : 2;
  carte.setBrouillon(null);
  carte.setElements(plan.elements);
  $('#bAnnuler').disabled = true;
  vAccueil.hidden = true;
  vPlan.hidden = false;
  document.title = `${plan.nom} · Plan de terrain`;
  $('#pNom').textContent = plan.nom;
  $('#pAdr').textContent = adresseTexte(plan.adresse);
  $('#etatSauve').textContent = 'Enregistré sur cet appareil';
  carte.chargerPicc(plan.picc.objets);
  carte.setContour(plan.contour);
  requestAnimationFrame(() => recadrer());
  majLegende();
  outilCote(false);
  majCotes();
  allerEtape(etape);
}

// Mode de la carte selon l'étape affichée
const modeEtape = () => etape === 3 ? 'amenager' : etape === 2 ? 'releve' : plan.contour.valide ? 'naviguer' : plan.contour.ferme ? 'modifier' : 'naviguer';

// Sections du panneau visibles selon l'étape (la mesure en cours prend toute la place)
const SECTIONS = { 1: ['sContour'], 2: ['sReleve'], 3: ['sAmenag', 'sAlertes', 'sCatalogue', 'sMateriel'] };
function majSections() {
  const plein = !!M || RT.actif;
  for (const [n, ids] of Object.entries(SECTIONS)) for (const id of ids) $(`#${id}`).hidden = plein || +n !== etape;
  $('#sMesure').hidden = !M;
  $('#sRetrait').hidden = !RT.actif || !!M;
  carte.glisserElements = etape === 2 && !RT.actif && !M;
  if (plan) majSuite();
}

function allerEtape(n) {
  if (RT.actif) finRetrait();
  if (M) finMesure();
  if (R.brouillon) annulerBrouillon();
  finAlignement();
  etape = n;
  document.querySelectorAll('.etapes [data-etape]').forEach((b) => {
    const actif = +b.dataset.etape === n;
    b.classList.toggle('actif', actif);
    actif ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current');
  });
  R.sel = -1;
  A.sel = -1;
  majSections();
  carte.setElements(plan.elements);
  carte.setMode(modeEtape());
  majPanneau();
  majReleve();
  majAmenag(true);
}
document.querySelectorAll('.etapes [data-etape]').forEach((b) => { b.onclick = () => allerEtape(+b.dataset.etape); });

// Cadre le contour, ou 80 m autour de l'adresse s'il n'y en a pas encore
const recadrer = () => carte.cadrerContour([-40, -40, 40, 40]);

// Panneau du contour
function majPanneau() {
  const c = plan.contour, pts = c.points, n = pts.length;
  const etat = c.valide ? 'valide' : c.ferme ? 'ferme' : n ? 'trace' : 'vide';
  const pill = $('#cEtat');
  pill.textContent = { vide: 'À tracer', trace: 'Tracé en cours', ferme: 'À valider', valide: 'Validé' }[etat];
  pill.className = 'pastille ' + (etat === 'valide' ? 'ok' : etat === 'ferme' ? 'attention' : '');
  const traceEnCours = carte.mode === 'tracer';
  $('#cAide').textContent = {
    vide: "Touchez la carte pour poser les coins du terrain, l'un après l'autre. Les points s'accrochent aux coins et aux lignes du plan SPW.",
    trace: traceEnCours
      ? 'Continuez à poser les coins. Touchez le premier point (ou « Fermer le contour ») pour terminer.'
      : 'Le tracé est en pause. Reprenez-le pour ajouter des coins.',
    ferme: 'Vérifiez le contour. Glissez un point pour le déplacer, touchez un « + » pour en ajouter un. Validez quand il est juste.',
    valide: 'Le contour est validé. Vous pourrez y revenir à tout moment.',
  }[etat];
  $('#cTracer').hidden = c.ferme;
  $('#cTracer').textContent = traceEnCours ? 'Pause' : n ? 'Reprendre le tracé' : 'Commencer le tracé';
  $('#cTracer').setAttribute('aria-pressed', traceEnCours);
  $('#cRetirer').hidden = c.ferme || !n;
  $('#cFermer').hidden = c.ferme;
  $('#cFermer').disabled = n < 3;
  $('#cSuppr').hidden = !(c.ferme && !c.valide && carte.selection >= 0);
  $('#cSuppr').disabled = n <= 3;
  $('#cValider').hidden = !c.ferme || c.valide;
  $('#cRouvrir').hidden = !c.valide;
  $('#cEffacer').hidden = !n || c.valide;
  const recoupe = c.ferme && seRecoupe(pts);
  $('#cAlerte').hidden = !recoupe;
  $('#cValider').disabled = recoupe;
  // chiffres
  $('#sSurface').textContent = c.ferme && n >= 3 ? fmtM2(aire(pts)) : '–';
  $('#sPerim').textContent = n >= 2 ? fmtM(perimetre(pts, c.ferme), 1) : '–';
  const compte = (s) => pts.filter((p) => (p.src || 'libre') === s).length;
  const details = [['mesure', 'mesuré', 'mesurés'], ['picc', 'coin SPW', 'coins SPW'], ['ligne', 'sur ligne', 'sur ligne'], ['libre', 'libre', 'libres']]
    .map(([s, un, plus]) => [compte(s), un, plus]).filter(([k]) => k).map(([k, un, plus]) => `${k} ${k > 1 ? plus : un}`).join(', ');
  $('#sPoints').textContent = n ? `${n} (${details})` : '–';
  // point sélectionné
  const sel = carte.selection >= 0 ? pts[carte.selection] : null;
  $('#cSel').hidden = !sel;
  if (sel) $('#cSelTxt').textContent = `Point ${carte.selection + 1} : ${{ picc: 'coin du plan SPW', ligne: 'sur une ligne SPW', libre: 'placé librement', mesure: 'mesuré sur place' }[sel.src] || sel.src}`;
}

$('#cTracer').onclick = () => { carte.setMode(carte.mode === 'tracer' ? 'naviguer' : 'tracer'); majPanneau(); };
$('#cRetirer').onclick = () => {
  if (!plan.contour.points.length) return;
  pousserHisto();
  plan.contour.points.pop();
  carte.setContour(plan.contour);
  sauver(); majPanneau();
};
$('#cFermer').onclick = () => { if (carte.mode !== 'tracer') carte.setMode('tracer'); carte.fermer(); };
$('#cSuppr').onclick = () => {
  const i = carte.selection;
  if (i < 0 || plan.contour.points.length <= 3) return;
  pousserHisto();
  plan.contour.points.splice(i, 1);
  carte.setContour(plan.contour);
  sauver(); majPanneau();
};
$('#cValider').onclick = () => {
  pousserHisto();
  plan.contour.valide = true;
  sauver(); majLegende();
  allerEtape(2);
};
$('#cMesurer').onclick = () => {
  const i = carte.selection;
  if (i < 0) return;
  demarrerMesure({
    cible: plan.contour.points[i],
    titre: `Coin ${i + 1} du contour`, sous: '', prog: '',
    aide: "Tendez le mètre depuis chaque repère jusqu'au coin du terrain.",
    ajout: 0,
    cands: () => rel.candidats(plan, { exclureContour: i }),
    onOk: (res, info) => {
      pousserHisto();
      plan.contour.points[i] = { x: res.x, y: res.y, src: 'mesure', mesure: info };
      carte.setContour(plan.contour);
      carte.selection = i;
      carte.dessinerContour();
      sauver(); majPanneau();
    },
  });
};
$('#cRouvrir').onclick = () => {
  pousserHisto();
  plan.contour.valide = false;
  carte.setMode('modifier');
  sauver(); majPanneau();
};
const bEff = $('#cEffacer');
bEff.onclick = () => {
  if (!bEff.dataset.confirme) {
    bEff.dataset.confirme = '1'; bEff.textContent = 'Confirmer : tout effacer';
    setTimeout(() => { delete bEff.dataset.confirme; bEff.textContent = 'Tout effacer'; }, 4000);
    return;
  }
  delete bEff.dataset.confirme; bEff.textContent = 'Tout effacer';
  pousserHisto();
  plan.contour = { points: [], ferme: false, valide: false };
  carte.setContour(plan.contour);
  carte.setMode('tracer');
  sauver(); majPanneau();
};
$('#cAimant').onchange = (e) => { carte.aimant = e.target.checked; };

// ---------------------------------------------------------------- Relevé des éléments
// Même principe que l'aménagement : on touche la carte, l'élément est créé à ses dimensions,
// puis on le fait glisser et tourner en lisant en direct les distances aux éléments proches.
const estMesure = (e) => e.points.every((p) => p.src === 'mesure');
const estPlace = (e) => !estMesure(e) && e.points.every((p) => p.src === 'mesure' || p.src === 'place');
const etatEl = (e) => (estMesure(e) ? 'mesuré' : estPlace(e) ? 'placé' : 'estimé');
const elSel = () => (plan && R.sel >= 0 ? plan.elements[R.sel] : null);
const libAccroche = (a) => (a.contour !== undefined ? `Coin ${a.contour + 1} du contour`
  : { picc: 'Coin du plan SPW', ligne: 'Point sur une ligne du plan SPW', element: "Point d'un élément relevé", libre: 'Point libre' }[a.src] || 'Point');

function tapReleve(a, p, e) {
  if (M) { if (M.choix != null) choisirRepereSur(a, p, e); return; }
  if (R.aligner) { alignerReleve(p, e); return; }
  const i = carte.elementSous(p.x, p.y, e);
  if (i >= 0) { selectionner(i); return; }
  creerElement(a);
}

// Crée l'élément du dernier type utilisé, centré là où on a touché
function creerElement(a) {
  pousserHisto();
  const type = R.dernierType || 'arbre';
  const forme = rel.TYPES[type].forme || R.derniereForme || 'point';
  const e = { id: store.nouvelId(), type, forme, nom: nomParDefaut(type), attrs: {}, rot: R.derniereRot ?? 0, points: [], cree: new Date().toISOString() };
  rel.geometrie(e, { x: a.x, y: a.y });
  plan.elements.push(e);
  sauver();
  selectionner(plan.elements.length - 1);
}

// Sur téléphone, le panneau est sous la carte : un bouton sur la carte y emmène
function majSuite() {
  const b = $('#suite');
  let txt = '', cible = null;
  if (M) { txt = 'Saisir les distances ↓'; cible = '#sMesure'; }
  else if (RT.actif && RT.sel >= 0) { txt = 'Retirer cet élément ↓'; cible = '#sRetrait'; }
  else if (etape === 2 && R.sel >= 0) { txt = 'Fiche et distances ↓'; cible = '#rForm'; }
  else if (etape === 3 && A.sel >= 0) { txt = 'Voir la fiche ↓'; cible = '#aFiche'; }
  b.hidden = !txt;
  b.textContent = txt;
  b.dataset.cible = cible || '';
}
$('#suite').onclick = () => {
  const c = $('#suite').dataset.cible;
  if (c) $(c).scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function selectionner(i) {
  if (i !== R.sel) finAlignementReleve();
  R.sel = i;
  carte.setElements(plan.elements, i);
  majReleve(true);
}

function annulerBrouillon() {   // ancien mode de saisie : plus utilisé, gardé pour les appels existants
  R.brouillon = null;
  carte.setBrouillon(null);
}

function nomParDefaut(type) {
  const lib = rel.TYPES[type].lib;
  const n = plan.elements.filter((e) => e.type === type).length + 1;
  return `${lib} ${n}`;
}

function resume(e) {
  const v = (k) => e.attrs?.[k];
  const parts = [];
  if (e.type === 'arbre') {
    if (v('tronc')) parts.push(`tronc Ø ${fmt(+v('tronc'), 0)} cm`);
    if (v('couronne')) parts.push(`couronne Ø ${fmt(+v('couronne'), 1)} m`);
  } else if (e.forme === 'ligne') parts.push(fmtM(perimetre(e.points, false), 2));
  else if (e.forme === 'surface') parts.push(fmtM2(aire(e.points)));
  if (v('epaisseur')) parts.push(`ép. ${fmt(+v('epaisseur'), 2)} m`);
  if (v('hauteur')) parts.push(`h. ${fmt(+v('hauteur'), 1)} m`);
  return parts.join(' · ');
}

// Panneau du relevé ; « refaire » reconstruit la fiche (autre élément affiché)
function majReleve(refaire = false) {
  if (!plan) return;
  majSuite();
  const els = plan.elements, sel = elSel();
  $('#rEtat').textContent = els.length ? `${els.length} élément${els.length > 1 ? 's' : ''}` : 'Aucun élément';
  $('#rEtat').className = 'pastille';
  $('#rForm').hidden = !sel;
  $('#rAide').textContent = R.aligner
    ? "Touchez une ligne sur la carte (mur, haie, bord de voirie, côté du terrain…) : l'élément s'alignera dessus."
    : sel ? 'Glissez l’élément sur la carte pour le déplacer : les distances aux éléments proches s’affichent en direct. Tournez-le avec la poignée ronde (Maj : crans de 15°) ou au degré près ci-dessous.'
      : "Touchez la carte à l'endroit d'un élément (arbre, haie, muret…) : il est créé à cet endroit, à ses dimensions. Faites-le ensuite glisser et tourner jusqu'aux bonnes distances. Touchez un élément existant pour l'ouvrir."
        + (plan.contour.valide ? '' : ' Le contour n’est pas encore validé.');
  if (sel) {
    $('#rPts').textContent = estMesure(sel) ? 'Position mesurée sur place.' : '';
    $('#rRotation').hidden = !rel.peutTourner(sel);
    if (document.activeElement !== $('#rRot')) $('#rRot').value = fmtRot(Math.round(rel.rotationDe(sel) * 10) / 10);
    $('#rAligner').setAttribute('aria-pressed', !!R.aligner);
    if (refaire) remplirForm(sel);
    majDistances(carte.distancesEl, '#rDist', '#rPortee');
  }
  // liste
  const ul = $('#rListe');
  ul.replaceChildren();
  els.forEach((e, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'el-ligne' + (i === R.sel ? ' sel' : '');
    btn.innerHTML = `<i class="pastille-el t-${e.type}"></i><span class="el-txt"><b></b><small></small></span>`;
    btn.querySelector('b').textContent = e.nom;
    btn.querySelector('small').textContent = resume(e) || rel.TYPES[e.type].lib;
    btn.onclick = () => { selectionner(i === R.sel ? -1 : i); if (i !== R.sel) return; centrerSur(e); };
    li.append(btn);
    ul.append(li);
  });
}

function centrerSur(e) {
  const xs = e.points.map((p) => p.x), ys = e.points.map((p) => p.y);
  const m = 8;
  carte.cadrer(Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m);
}

// Modification de l'élément sélectionné (avec annulation, redessin et sauvegarde)
function modifierEl(fn, refaire = false) {
  const e = elSel();
  if (!e) return;
  pousserHisto();
  fn(e);
  carte.setElements(plan.elements, R.sel);
  sauver();
  majReleve(refaire);
}

// Fiche : type, forme, nom, dimensions
function remplirForm(obj) {
  $('#rTypes').replaceChildren(...Object.entries(rel.TYPES).map(([k, t]) => {
    const bt = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: t.lib });
    bt.setAttribute('aria-pressed', obj.type === k);
    bt.onclick = () => {
      if (obj.type === k) return;
      modifierEl((e) => {
        const c = rel.centre(e);
        if (new RegExp(`^${rel.TYPES[e.type].lib} \\d+$`).test(e.nom)) e.nom = nomParDefaut(k);
        e.type = k;
        R.dernierType = k;
        e.forme = t.forme || R.derniereForme || 'point';
        if (e.forme !== 'surface') delete e.rect;
        rel.geometrie(e, c);
      }, true);
    };
    return bt;
  }));
  const formes = $('#rFormes');
  formes.hidden = obj.type !== 'autre';
  formes.replaceChildren(...Object.entries(rel.FORMES).map(([k, lib]) => {
    const bt = Object.assign(document.createElement('button'), { type: 'button', className: 'btn petit', textContent: k === 'surface' ? 'Rectangle' : lib });
    bt.setAttribute('aria-pressed', obj.forme === k);
    bt.onclick = () => {
      if (obj.forme === k) return;
      modifierEl((e) => { const c = rel.centre(e); e.forme = k; R.derniereForme = k; if (k !== 'surface') delete e.rect; rel.geometrie(e, c); }, true);
    };
    return bt;
  }));
  const nom = $('#rNom');
  nom.value = obj.nom || '';
  nom.onchange = () => { const v = nom.value.trim(); if (v) modifierEl((e) => { e.nom = v; }); else nom.value = obj.nom; };
  $('#rAttrs').replaceChildren(...rel.TYPES[obj.type].champs
    .filter(([cle]) => !(cle === 'longueur' && obj.forme === 'point'))
    .map(([cle, lib, unite, def]) => {
      const l = document.createElement('label');
      l.textContent = `${lib} (${unite})`;
      const inp = Object.assign(document.createElement('input'), { inputMode: 'decimal', autocomplete: 'off' });
      const actuel = cle === 'longueur' && obj.attrs.longueur == null && obj.forme === 'ligne' ? Math.round(rel.longueurDe(obj) * 100) / 100 : obj.attrs[cle];
      inp.value = actuel != null ? String(actuel).replace('.', ',') : '';
      if (def != null) inp.placeholder = `ex. ${String(def).replace('.', ',')}`;
      inp.onchange = () => {
        const t = inp.value.trim().replace(',', '.');
        const v = t === '' ? null : +t;
        if (Number.isNaN(v) || (v !== null && v < 0)) { inp.setCustomValidity('Nombre attendu'); inp.reportValidity(); return; }
        inp.setCustomValidity('');
        modifierEl((e) => {
          if (v === null) delete e.attrs[cle]; else e.attrs[cle] = v;
          // longueur ou largeur : l'élément est redessiné autour de son centre
          if ((cle === 'longueur' || cle === 'largeur') && rel.peutTourner(e)) rel.geometrie(e);
        });
      };
      l.append(inp);
      return l;
    }));
}

// Rotation de l'élément sélectionné (champ, crans, 0°, 90°, « Aligner sur… »)
function tournerEl(delta, absolu) {
  const e = elSel();
  if (!e || !rel.peutTourner(e)) return;
  modifierEl((x) => { x.rot = am.normRot(absolu ?? rel.rotationDe(x) + delta); R.derniereRot = x.rot; rel.geometrie(x); });
}
$('#rRot').onchange = () => {
  const v = lireNombre($('#rRot').value);
  if (Number.isNaN(v)) { majReleve(); return; }
  tournerEl(0, v);
};
$('#rRot').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#rRot').blur(); });
document.querySelectorAll('[data-rrot]').forEach((b) => { b.onclick = () => tournerEl(+b.dataset.rrot); });
$('#rRot0').onclick = () => tournerEl(0, 0);
$('#rAligner').onclick = () => {
  R.aligner = !R.aligner;
  carte.alignement = R.aligner;
  carte.segSurvol = null;
  majReleve();
  carte.dessinerOverlay();
};
function finAlignementReleve() {
  if (!R.aligner) return;
  R.aligner = false;
  carte.alignement = false;
  carte.segSurvol = null;
}
function alignerReleve(p, e) {
  const s = carte.segmentSous(p.x, p.y, e);
  if (!s) return;
  finAlignementReleve();
  tournerEl(0, am.rotationAlignee(s[0], s[1]));
}

$('#rFermerSel').onclick = () => selectionner(-1);
$('#rDupliquer').onclick = () => {
  const e = elSel();
  if (!e) return;
  pousserHisto();
  const c = structuredClone(e);
  c.id = store.nouvelId();
  c.nom = nomParDefaut(c.type);
  c.cree = new Date().toISOString();
  c.points = c.points.map((p) => ({ ...p, x: p.x + 1, y: p.y - 1, src: 'place' }));
  plan.elements.push(c);
  sauver();
  selectionner(plan.elements.length - 1);
};
function supprimerElement() {
  if (R.sel < 0) return;
  pousserHisto();
  plan.elements.splice(R.sel, 1);
  sauver();
  selectionner(-1);
}
$('#rSupprimer').onclick = supprimerElement;
// ---------------------------------------------------------------- Outil « Mesurer » : cotes entre deux points
// Bouton ↔ sur la carte : on touche deux points (ils s'accrochent au plan), la distance s'affiche.
// « Garder la cote » la laisse sur le plan ; la carte « Cotes » permet de les afficher ou non et de les effacer.
const C = { actif: false, sel: -1 };
const r3 = (v) => Math.round(v * 1000) / 1000;
carte.onCote = (a) => tapCote(a);

function outilCote(on) {
  C.actif = on;
  carte.outilCote = on;
  carte.coteTemp = on ? { a: null, b: null } : null;
  if (!on) { carte.setSurvol(null); selCote(-1); }
  if (on && !carte.cotesVisibles && plan?.cotes.length) { plan.cotesVisibles = true; majCotes(); }  // pour pouvoir les toucher
  $('#zMesurer').setAttribute('aria-pressed', on);
  majCoteBarre();
  carte.dessinerOverlay();
}
// Sélection d'une cote gardée (pour la déplacer, la modifier ou la supprimer)
function selCote(i) {
  C.sel = i;
  carte.coteSel = i;
  if (i >= 0) carte.coteTemp = { a: null, b: null };
  majCoteBarre();
  majCotes();
  carte.dessinerOverlay();
}
carte.onCoteSel = (i) => selCote(i);
carte.onCoteModif = (evt) => {
  if (evt === 'debut') pousserHisto();
  else if (evt === 'bouge') majCoteBarre();
  else if (evt === 'fin') { sauver(); majCotes(); majCoteBarre(); }
};
function tapCote(a) {
  // une touche dans le vide quand une cote est sélectionnée : on la désélectionne seulement
  if (C.sel >= 0) { selCote(-1); return; }
  const t = carte.coteTemp, p = { x: r3(a.x), y: r3(a.y) };
  if (!t.a || t.b) carte.coteTemp = { a: p, b: null };
  else t.b = p;
  majCoteBarre();
  carte.dessinerOverlay();
}
function majCoteBarre() {
  $('#coteBarre').hidden = !C.actif;
  if (!C.actif) return;
  const c = plan?.cotes[C.sel];
  if (c) {
    $('#coteTxt').textContent = `Cote ${C.sel + 1} :`;
    $('#coteVal').textContent = fmtM(dist(c.a, c.b), 2);
    $('#coteGarder').hidden = $('#coteNouv').hidden = true;
    $('#coteSuppr').hidden = false;
    $('#coteAide').textContent = 'Glissez un bout pour le déplacer (il s’accroche au plan), ou la ligne pour déplacer toute la cote.';
    return;
  }
  const t = carte.coteTemp, fini = t.a && t.b;
  $('#coteTxt').textContent = !t.a ? 'Touchez le premier point' : !fini ? 'Touchez le second point' : 'Distance :';
  $('#coteVal').textContent = fini ? fmtM(dist(t.a, t.b), 2) : '';
  $('#coteGarder').hidden = $('#coteNouv').hidden = !fini;
  $('#coteSuppr').hidden = true;
  $('#coteAide').textContent = !t.a && plan?.cotes.length ? 'ou touchez une cote pour la modifier' : '';
}
function majCotes() {
  if (!plan) return;
  const l = plan.cotes;
  carte.cotes = l;
  carte.cotesVisibles = plan.cotesVisibles !== false;
  $('#sCotes').hidden = !l.length;
  $('#cotesVis').checked = carte.cotesVisibles;
  $('#cotesListe').replaceChildren(...l.map((c, i) => {
    const li = document.createElement('li');
    if (i === C.sel && C.actif) li.className = 'sel';
    li.innerHTML = '<button type="button" class="cote-nom" title="Modifier cette cote"></button><b></b><button type="button" title="Effacer cette cote" aria-label="Effacer cette cote">×</button>';
    li.querySelector('.cote-nom').textContent = `Cote ${i + 1}`;
    li.querySelector('.cote-nom').onclick = () => {
      if (!C.actif) outilCote(true);
      selCote(i);
      const xs = [c.a.x, c.b.x], ys = [c.a.y, c.b.y];
      carte.cadrer(Math.min(...xs) - 5, Math.min(...ys) - 5, Math.max(...xs) + 5, Math.max(...ys) + 5);
    };
    li.querySelector('b').textContent = fmtM(dist(c.a, c.b), 2);
    li.querySelector('button:last-child').onclick = () => supprimerCote(i);
    return li;
  }));
}
function supprimerCote(i) {
  if (i < 0 || !plan.cotes[i]) return;
  pousserHisto();
  plan.cotes.splice(i, 1);
  sauver();
  if (C.sel === i) selCote(-1); else if (C.sel > i) selCote(C.sel - 1); else { majCotes(); majCoteBarre(); carte.dessinerOverlay(); }
}
$('#zMesurer').onclick = () => outilCote(!C.actif);
$('#coteFin').onclick = () => outilCote(false);
$('#coteSuppr').onclick = () => supprimerCote(C.sel);
$('#coteNouv').onclick = () => { carte.coteTemp = { a: null, b: null }; majCoteBarre(); carte.dessinerOverlay(); };
$('#coteGarder').onclick = () => {
  const t = carte.coteTemp;
  if (!t?.a || !t.b) return;
  pousserHisto();
  plan.cotes.push({ a: t.a, b: t.b });
  plan.cotesVisibles = true;
  carte.coteTemp = { a: null, b: null };
  sauver();
  majCotes();
  majCoteBarre();
  carte.dessinerOverlay();
};
$('#cotesVis').onchange = () => { plan.cotesVisibles = $('#cotesVis').checked; if (!plan.cotesVisibles) selCote(-1); sauver(); majCotes(); carte.dessinerOverlay(); };
$('#cotesEffacer').onclick = () => { pousserHisto(); plan.cotes = []; selCote(-1); sauver(); majCotes(); carte.dessinerOverlay(); };

// ---------------------------------------------------------------- Mesure par deux distances
let modeAvantMesure = null;

function demarrerMesure(o) {
  const cands = o.cands();
  // un repère du point précédent est réutilisable s'il n'est pas sur la cible et croise bien
  const bonAngle = (A, B) => A && B && dist(A, o.cible) >= 0.5 && dist(B, o.cible) >= 0.5 && dist(A, B) >= 0.3 && rel.sinAngle(o.cible, A, B) >= 0.34;
  const prec = (o.preferes || []).map((r) => ({ ...r, lib: r.lib.replace(/ \(même repère\)$/, '') + ' (même repère)' }));
  let paire;
  if (o.refFixe) {
    const B = prec.filter((r) => bonAngle(o.refFixe, r)).sort((a, b) => rel.sinAngle(o.cible, o.refFixe, b) - rel.sinAngle(o.cible, o.refFixe, a))[0]
      || rel.choisirAvec(o.cible, o.refFixe, cands);
    paire = B ? [o.refFixe, B] : null;
    M = { ...o, cands, refs: [o.refFixe, B], choix: B ? null : 1, res: null };
  } else {
    paire = prec.length === 2 && bonAngle(prec[0], prec[1]) ? prec : rel.choisirReperes(o.cible, cands);
    M = { ...o, cands, refs: paire ? [paire[0], paire[1]] : [null, null], choix: paire ? null : 0, res: null };
  }
  modeAvantMesure ??= carte.mode;
  carte.setMode('releve');
  majSections();
  $('#mTitre').textContent = o.titre;
  $('#mSous').textContent = o.sous ? `· ${o.sous}` : '';
  $('#mProg').textContent = o.prog;
  $('#mProg').hidden = !o.prog;
  $('#mPasser').hidden = !o.onPasser;
  $('#mD0').value = $('#mD1').value = '';
  if (o.refFixe) $('#mD0').value = String(Math.round(o.dFixe * 100) / 100).replace('.', ',');
  cadrerMesure();
  majMesure();
  if (matchMedia('(min-width: 901px)').matches && paire) $(o.refFixe ? '#mD1' : '#mD0').focus();
}

function cadrerMesure() {
  const pts = [M.cible, ...M.refs.filter(Boolean)];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  carte.cadrer(Math.min(...xs) - 4, Math.min(...ys) - 4, Math.max(...xs) + 4, Math.max(...ys) + 4);
}

function finMesure() {
  M = null;
  carte.setMesure(null);
  majSections();
  if (modeAvantMesure) carte.setMode(modeAvantMesure);
  modeAvantMesure = null;
}

function majMesure() {
  const m = M;
  if (!m) return;
  const lus = [0, 1].map((k) => rel.lireDistance($(`#mD${k}`).value));
  const d = lus.map((v) => (v > 0 ? v + m.ajout : null));
  [0, 1].forEach((k) => {
    const r = m.refs[k];
    const enChoix = m.choix === k;
    $(`#mLib${k}`).textContent = enChoix ? 'touchez un repère sur la carte (losanges)' : r ? `${r.lib}, à ≈ ${fmt(Math.max(dist(r, m.cible) - m.ajout, 0), 1)} m` : 'à choisir';
    $(`#mChg${k}`).textContent = enChoix ? 'Annuler' : 'Changer';
    $(`#mChg${k}`).setAttribute('aria-pressed', enChoix);
    const inp = $(`#mD${k}`);
    inp.disabled = !r;
    inp.placeholder = r ? `≈ ${fmt(Math.max(dist(r, m.cible) - m.ajout, 0), 2)}` : '';
    inp.setCustomValidity(Number.isNaN(lus[k]) ? 'Distance en mètres, par ex. 7,42' : '');
  });
  let aide = m.aide;
  if (m.choix != null) aide = `Touchez sur la carte le repère ${'AB'[m.choix]} : un losange proposé, ou n'importe quel coin du plan SPW.`;
  else if (!m.refs[0] || !m.refs[1]) aide = 'Aucun repère trouvé à proximité : choisissez-les sur la carte.';
  $('#mAide').textContent = aide;
  let res = null, txt = '', alerte = '';
  if (m.refs[0] && m.refs[1] && d[0] && d[1]) {
    const r = rel.trilaterer(m.refs[0], d[0], m.refs[1], d[1], m.cible);
    if (r.erreur) alerte = r.erreur;
    else if (r.ecart > 0.5) alerte = `Les deux distances ne se rejoignent pas (il manque ${fmt(r.ecart, 2)} m). Vérifiez les mesures et que vous êtes partis des bons repères.`;
    else {
      res = r;
      txt = `Point calculé à ${fmtM(r.deplacement, 2)} de la position estimée.`;
      if (r.ecart > 0.02) alerte = `Les deux distances ne se croisent pas tout à fait (écart de ${fmt(r.ecart * 100, 0)} cm) : position moyenne retenue.`;
      else if (r.sin < 0.34 || r.ambigu) alerte = 'Les repères sont presque alignés avec le point : la position est peu précise. Changez un repère si possible.';
      else if (r.deplacement > 5) alerte = 'Le point se place loin de la position estimée. Vérifiez que les distances correspondent bien aux repères A et B.';
    }
  } else if (m.refs[0] && m.refs[1]) txt = 'Saisissez les deux distances.';
  m.res = res;
  $('#mRes').textContent = txt;
  $('#mAlerte').textContent = alerte;
  $('#mAlerte').hidden = !alerte;
  $('#mOk').disabled = !res;
  const proches = m.choix != null ? m.cands.filter((c) => dist(c, m.cible) < 60) : [];
  carte.setMesure({ cible: m.cible, refs: m.refs, d, res, choix: m.choix, candidats: proches });
}

function choisirRepereSur(a, p, e) {
  const m = M, rayon = e.pointerType === 'touch' ? 30 : 18;
  let best = null, bd = rayon;
  for (const c of m.cands) {
    const q = carte.versEcran(c), dd = Math.hypot(q.x - p.x, q.y - p.y);
    if (dd < bd) { bd = dd; best = c; }
  }
  if (!best && (a.src === 'picc' || a.src === 'element' || a.contour !== undefined)) {
    best = { x: a.x, y: a.y, lib: a.contour !== undefined ? `Coin ${a.contour + 1} du contour` : a.src === 'element' ? "Point d'un élément" : 'Point du plan SPW' };
  }
  if (!best) return;
  const autre = m.refs[1 - m.choix];
  if (autre && dist(autre, best) < 0.05) {
    $('#mAide').textContent = `Ce point est déjà le repère ${'AB'[1 - m.choix]}. Il faut deux repères différents : deux distances prises du même endroit ne donnent qu'un cercle, pas une position. Touchez un autre point.`;
    return;
  }
  if (dist(best, m.cible) < 0.3) { $('#mAide').textContent = "C'est le point à mesurer lui-même : choisissez un autre repère."; return; }
  m.refs[m.choix] = best;
  $(`#mD${m.choix}`).value = '';
  m.choix = !m.refs[1] ? 1 : !m.refs[0] ? 0 : null;
  majMesure();
  if (m.choix == null && matchMedia('(min-width: 901px)').matches) $('#mD0').focus();
}

[0, 1].forEach((k) => {
  $(`#mD${k}`).addEventListener('input', majMesure);
  $(`#mD${k}`).addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (k === 0) $('#mD1').focus(); else if (!$('#mOk').disabled) $('#mOk').click();
  });
  $(`#mChg${k}`).onclick = () => { if (!M) return; M.choix = M.choix === k ? null : k; majMesure(); };
});
$('#mOk').onclick = () => {
  const m = M;
  if (!m || !m.res) return;
  const info = {
    refs: m.refs.map((r) => ({ x: r.x, y: r.y, lib: r.lib })),
    d: [0, 1].map((k) => rel.lireDistance($(`#mD${k}`).value)),
    ajout: m.ajout, ecart: +m.res.ecart.toFixed(3), le: new Date().toISOString(),
  };
  const res = { x: +m.res.x.toFixed(3), y: +m.res.y.toFixed(3) };
  const suite = !!m.onPasser; // un élément : il y a peut-être un point suivant
  M = null;
  if (!suite) finMesure();
  m.onOk(res, info);
  if (!M) finMesure();
};
$('#mPasser').onclick = () => { const m = M; if (!m) return; M = null; m.onPasser(); if (!M) finMesure(); };
$('#mAnnuler').onclick = () => { const m = M; if (!m) return; finMesure(); m.onAnnuler?.(); majReleve(); };

// ---------------------------------------------------------------- Aménagement
let cataloguePerso = [];
store.lireReglage('catalogue').then((c) => { cataloguePerso = c || []; majCatalogue(); }).catch(() => majCatalogue());

const optionsCat = (sel) => sel.replaceChildren(...Object.entries(am.CATEGORIES).map(([k, lib]) => Object.assign(document.createElement('option'), { value: k, textContent: lib })));
optionsCat($('#aCat'));
optionsCat($('#kCat'));
const fmtRot = (r) => fmt(r, Number.isInteger(r) ? 0 : 1);
const lireNombre = (txt) => { const t = String(txt).trim().replace(',', '.'); return t === '' ? NaN : +t; };

function majCatalogue() {
  const box = $('#aCatalogue');
  const puce = (it, perso, idx) => {
    const d = document.createElement('div');
    d.className = 'puce-wrap';
    const b = Object.assign(document.createElement('button'), { type: 'button', className: `puce cat-b-${it.cat}` });
    b.innerHTML = '<b></b><span></span>';
    b.querySelector('b').textContent = it.nom;
    b.querySelector('span').textContent = `${fmt(it.w, it.w % 1 ? 1 : 0)} × ${fmt(it.l, it.l % 1 ? 1 : 0)} m`;
    b.title = am.CATEGORIES[it.cat];
    b.onclick = () => poser(it);
    d.append(b);
    if (perso) {
      const x = Object.assign(document.createElement('button'), { type: 'button', className: 'puce-x', textContent: '×', title: 'Retirer de mon catalogue' });
      x.setAttribute('aria-label', `Retirer ${it.nom} de mon catalogue`);
      x.onclick = () => { cataloguePerso.splice(idx, 1); store.ecrireReglage('catalogue', cataloguePerso); majCatalogue(); };
      d.append(x);
    }
    return d;
  };
  box.replaceChildren(...am.CATALOGUE.map((it) => puce(it, false)), ...cataloguePerso.map((it, i) => puce(it, true, i)));
}

// Pose un objet du catalogue au centre de la vue
function poser(it) {
  if (etape !== 3) return;
  finAlignement();
  pousserHisto();
  const o = { id: store.nouvelId(), nom: it.nom, cat: it.cat, w: it.w, l: it.l, ...(it.h != null ? { h: it.h } : {}), ...(it.modele ? { modele: it.modele, travee: it.travee } : {}), x: Math.round(carte.vue.cx * 100) / 100, y: Math.round(carte.vue.cy * 100) / 100, rot: 0 };
  plan.amenagement.push(o);
  A.sel = plan.amenagement.length - 1;
  sauver();
  majAmenag(true);
}

$('#aFormPerso').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const nom = $('#kNom').value.trim(), w = lireNombre($('#kW').value), l = lireNombre($('#kL').value);
  if (!nom || !(w > 0) || !(l > 0)) { $('#kMsg').textContent = 'Donnez un nom, une largeur et une longueur (en mètres).'; return; }
  const it = { nom, w, l, cat: $('#kCat').value };
  const h = lireNombre($('#kH').value);
  if (h >= 0) it.h = h;
  if ($('#kGarder').checked && !cataloguePerso.some((c) => c.nom === nom && c.w === w && c.l === l && c.cat === it.cat)) {
    cataloguePerso.push(it);
    store.ecrireReglage('catalogue', cataloguePerso).catch((e) => { $('#kMsg').textContent = e.message; });
    majCatalogue();
  }
  $('#kMsg').textContent = $('#kGarder').checked ? `« ${nom} » ajouté à votre catalogue et posé sur le plan.` : `« ${nom} » posé sur le plan.`;
  poser(it);
});

// Distances en direct : la carte les calcule en dessinant, la fiche les liste
carte.calculDistances = (o) => am.distancesProches(plan, o, +$('#aPortee').value);
carte.calculDistancesEl = (e) => am.distancesElement(plan, e, +$('#rPortee').value);
$('#rPortee').onchange = () => { carte.dessinerOverlay(); majDistances(carte.distancesEl, '#rDist', '#rPortee'); };

// Glisser un élément relevé (en saisie ou sélectionné) : il devient « placé à la main »
carte.onElement = (evt, i) => {
  const el = plan.elements[i];
  if (!el) return;
  if (evt === 'select') selectionner(i);
  else if (evt === 'debut') pousserHisto();
  else if (evt === 'bouge') {
    majDistances(carte.distancesEl, '#rDist', '#rPortee');
    if (document.activeElement !== $('#rRot')) $('#rRot').value = fmtRot(Math.round(rel.rotationDe(el) * 10) / 10);
  } else if (evt === 'fin') {
    el.points.forEach((p) => { p.src = 'place'; delete p.mesure; });
    carte.setElements(plan.elements, R.sel);
    sauver();
    majReleve();
  }
};

function majDistances(liste = carte.distances, ulSel = '#aDist', porteeSel = '#aPortee') {
  const l = liste || [];
  const ul = $(ulSel);
  ul.replaceChildren(...l.map((r) => {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><b></b>';
    li.querySelector('span').textContent = r.n ? `R${r.n} · ${r.lib}` : r.lib;
    li.querySelector('b').textContent = fmtM(r.d, 2);
    return li;
  }));
  if (!l.length) ul.innerHTML = `<li><span class="aide">Rien à moins de ${$(porteeSel).value} m.</span></li>`;
}
$('#aPortee').onchange = () => { carte.dessinerOverlay(); majDistances(); };

function objetCarte(evt, i) {
  if (evt === 'select') { finAlignement(); A.sel = i; majAmenag(true); }
  else if (evt === 'debut') pousserHisto();
  else if (evt === 'bouge') { if (i === A.sel && document.activeElement !== $('#aRot')) $('#aRot').value = fmtRot(plan.amenagement[i].rot); majDistances(); }
  else if (evt === 'fin') { sauver(); majAmenag(); }
}

function tapAmenag(p, e) {
  if (A.aligner) {
    const s = carte.segmentSous(p.x, p.y, e);
    if (!s) return;
    const o = plan.amenagement[A.sel];
    pousserHisto();
    o.rot = am.rotationAlignee(s[0], s[1]);
    finAlignement();
    sauver();
    majAmenag(true);
    return;
  }
  if (A.sel >= 0) { A.sel = -1; majAmenag(true); }
}

function finAlignement() {
  if (!A.aligner) return;
  A.aligner = false;
  carte.alignement = false;
  carte.segSurvol = null;
  $('#aAligner').setAttribute('aria-pressed', 'false');
  majAmenag();
}

function majAmenag(refaire = false) {
  if (!plan) return;
  majSuite();
  const items = plan.amenagement;
  const { liste, mauvais } = am.alertes(plan);
  carte.setAmenagement(items, A.sel, mauvais);
  const o = items[A.sel];
  $('#aEtat').textContent = items.length ? `${items.length} élément${items.length > 1 ? 's' : ''}` : 'Plan vide';
  $('#aAide').textContent = A.aligner
    ? "Touchez une ligne sur la carte (bord de voirie, mur, côté du terrain, haie…) : la longueur de l'élément s'alignera dessus."
    : o ? 'Glissez l’élément pour le déplacer. Tournez-le avec la poignée ronde (Maj pour des crans de 15°) ou au degré près ci-dessous.'
      : items.length ? 'Touchez un élément sur la carte pour le modifier, ou ajoutez-en depuis le catalogue.'
        : 'Ajoutez des éléments depuis le catalogue ci-dessous : chapiteaux, stands, sanitaires, zones d’accès…'
          + (plan.contour.ferme ? '' : ' Tracez d’abord le contour pour vérifier que tout tient sur le terrain.');
  $('#aFiche').hidden = !o;
  if (o && refaire) {
    $('#aNom').value = o.nom;
    $('#aW').value = fmt(o.w, o.w % 1 ? 2 : 0);
    $('#aL').value = fmt(o.l, o.l % 1 ? 2 : 0);
    $('#aH').value = o.h != null ? fmt(o.h, o.h % 1 ? 2 : 0) : '';
    $('#aH').placeholder = `ex. ${fmt(am.HAUTEUR_CAT[o.cat] ?? 1, 1)}`;
  }
  $('#aTente').hidden = !o || o.cat !== 'tente';
  if (o && o.cat === 'tente') {
    $('#aToile').value = o.toile || 'blanc';
    $('#aCotes').checked = o.cotes !== false;
    $('#aPlancherT').checked = !!o.plancher;
  }
  $('#aMarche').hidden = !o || !am.estMarche(o);
  if (o && am.estMarche(o)) {
    const n = am.travees(o);
    $('#aMarcheTxt').textContent = `Stand de marché : ${n} emplacement${n > 1 ? 's' : ''} de ${fmt(o.l / n, 1)} m sur ${fmt(o.w, 1)} m de profondeur. Le côté ouvert est marqué d'un trait épais sur le plan ; « Pivoter de 90° » deux fois pour le retourner.`;
    $('#aCat').value = o.cat;
  }
  if (o && document.activeElement !== $('#aRot')) $('#aRot').value = fmtRot(o.rot);
  // alertes
  $('#aNbAlertes').textContent = liste.length ? `${liste.length}` : 'aucun';
  $('#aNbAlertes').className = 'pastille ' + (liste.length ? 'attention' : 'ok');
  const ul = $('#aAlertes');
  ul.replaceChildren(...liste.map((a) => {
    const li = document.createElement('li');
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: a.t });
    b.onclick = () => {
      const i = items.findIndex((x) => x.id === a.ids[0]);
      if (i < 0) return;
      A.sel = i;
      const c = am.coins(items[i]);
      const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
      carte.cadrer(Math.min(...xs) - 10, Math.min(...ys) - 10, Math.max(...xs) + 10, Math.max(...ys) + 10);
      majAmenag(true);
    };
    li.append(b);
    return li;
  }));
  if (!liste.length) ul.innerHTML = `<li class="ok">${items.length ? 'Rien à signaler.' : 'Les alertes apparaîtront ici (chevauchements, haies, arbres…).'}</li>`;
  // matériel
  const mat = am.materiel(plan);
  $('#aMateriel').replaceChildren(...mat.lignes.map((g) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><i class="sw cat-b-${g.cat}"></i><span></span> <small></small></td><td class="n">${g.nb}</td><td class="n">${g.cat === 'zone' ? '–' : fmt(g.nb * g.w * g.l, 0)}</td>`;
    tr.querySelector('span').textContent = g.nom;
    tr.querySelector('small').textContent = `${fmt(g.w, g.w % 1 ? 1 : 0)} × ${fmt(g.l, g.l % 1 ? 1 : 0)} m`;
    return tr;
  }));
  if (!mat.lignes.length) $('#aMateriel').innerHTML = '<tr><td colspan="3" class="vide-mat">Aucun élément posé.</td></tr>';
  $('#aSurfTerrain').textContent = mat.terrain != null ? fmtM2(mat.terrain) : '–';
  $('#aSurfOcc').textContent = fmtM2(mat.occupe);
  $('#aSurfLibre').textContent = mat.terrain != null ? fmtM2(Math.max(mat.terrain - mat.occupe, 0)) : '–';
  if (o) majDistances();
}

// Fiche de l'objet sélectionné
const objSel = () => plan?.amenagement[A.sel];
function modifier(fn) {
  const o = objSel();
  if (!o) return;
  pousserHisto();
  fn(o);
  sauver();
  majAmenag();
}
$('#aNom').onchange = () => { const v = $('#aNom').value.trim(); if (v) modifier((o) => { o.nom = v; }); };
for (const [id, cle] of [['#aW', 'w'], ['#aL', 'l']]) {
  $(id).onchange = () => {
    const v = lireNombre($(id).value);
    if (!(v > 0)) { $(id).value = fmt(objSel()[cle], 2); return; }
    modifier((o) => { o[cle] = v; });
  };
}
$('#aH').onchange = () => {
  const t = $('#aH').value.trim(), v = lireNombre(t);
  if (t && !(v >= 0)) { $('#aH').value = ''; return; }
  modifier((o) => { if (t) o.h = v; else delete o.h; });
};
$('#aCat').onchange = () => modifier((o) => { o.cat = $('#aCat').value; });
$('#aToile').onchange = () => modifier((o) => { o.toile = $('#aToile').value; });
$('#aCotes').onchange = () => modifier((o) => { o.cotes = $('#aCotes').checked; });
$('#aPlancherT').onchange = () => modifier((o) => { if ($('#aPlancherT').checked) o.plancher = true; else delete o.plancher; });$('#aRot').onchange = () => {
  const v = lireNombre($('#aRot').value);
  if (Number.isNaN(v)) { $('#aRot').value = fmtRot(objSel().rot); return; }
  modifier((o) => { o.rot = am.normRot(v); });
  $('#aRot').value = fmtRot(objSel().rot);
};
$('#aRot').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#aRot').blur(); });
const tourner = (delta) => modifier((o) => { o.rot = am.normRot(o.rot + delta); });
document.querySelectorAll('#aFiche [data-rot]').forEach((b) => { b.onclick = () => tourner(+b.dataset.rot); });
$('#aRot0').onclick = () => modifier((o) => { o.rot = 0; });
$('#aAligner').onclick = () => {
  if (A.aligner) { finAlignement(); return; }
  A.aligner = true;
  carte.alignement = true;
  $('#aAligner').setAttribute('aria-pressed', 'true');
  majAmenag();
};
$('#aDup').onclick = () => {
  const o = objSel();
  if (!o) return;
  pousserHisto();
  plan.amenagement.push({ ...o, id: store.nouvelId(), x: o.x + 1, y: o.y - 1 });
  A.sel = plan.amenagement.length - 1;
  sauver();
  majAmenag(true);
};
$('#aFermer').onclick = () => { finAlignement(); A.sel = -1; majAmenag(); };
function supprimerObjet() {
  if (A.sel < 0) return;
  finAlignement();
  pousserHisto();
  plan.amenagement.splice(A.sel, 1);
  A.sel = -1;
  sauver();
  majAmenag();
}
$('#aSuppr').onclick = supprimerObjet;

// Légende / couches
const CATEGORIES = [
  ['batiment', 'Bâtiments'], ['voirie', 'Voirie, trottoirs'], ['haie', 'Haies'], ['rangee', "Rangées d'arbres"],
  ['arbre', 'Arbres isolés'], ['muret', 'Murets'], ['cloture', 'Clôtures'], ['poteau', 'Poteaux, bornes'],
  ['sol', 'Avaloirs, taques'], ['eau', 'Eau'], ['berge', 'Berges'], ['talus', 'Talus'],
];
function majLegende() {
  const ul = $('#legende');
  ul.replaceChildren();
  const presentes = new Set(plan.picc.objets.map((o) => o.k));
  for (const [k, lib] of CATEGORIES) {
    if (!presentes.has(k)) continue;
    const objs = plan.picc.objets.filter((o) => o.k === k);
    const li = document.createElement('li');
    li.innerHTML = `<label><input type="checkbox" checked><svg width="26" height="14" class="leg c-${k}" aria-hidden="true">${symbole(k)}</svg><span class="leg-txt"><span></span><small></small></span><em>${objs.length}</em></label>`;
    li.querySelector('.leg-txt span').textContent = lib;
    li.querySelector('small').textContent = datesPicc(objs);
    const cb = li.querySelector('input');
    cb.checked = !carte.masques.has(k);
    cb.onchange = () => carte.masquer(k, !cb.checked);
    ul.append(li);
  }
  const avecDates = plan.picc.objets.some((o) => o.a || o.m);
  $('#piccDate').textContent = `Données chargées le ${new Date(plan.picc.charge).toLocaleDateString('fr-BE')}.`
    + (avecDates ? '' : ' Rechargez les données SPW pour voir les années de relevé.');
  majRetires();
}

// « relevé en 2015 », « relevé 2015 à 2017 », ou à défaut l'année de mise à jour
function datesPicc(objs) {
  const a = objs.map((o) => o.a).filter(Boolean), m = objs.map((o) => o.m).filter(Boolean);
  if (a.length) {
    const min = Math.min(...a), max = Math.max(...a);
    return min === max ? `relevé en ${min}` : `relevé de ${min} à ${max}`;
  }
  return m.length ? `mis à jour en ${Math.max(...m)}` : '';
}
function symbole(k) {
  if (k === 'arbre') return '<circle cx="13" cy="7" r="6"/>';
  if (k === 'poteau' || k === 'sol') return '<circle cx="13" cy="7" r="3"/>';
  if (k === 'batiment' || k === 'eau') return '<rect x="3" y="2" width="20" height="10"/>';
  return '<path d="M2 7H24"/>';
}

$('#bRecharger').onclick = async () => {
  const b = $('#bRecharger');
  b.disabled = true;
  try {
    const objets = await spw.chargerPICC(plan.zone, plan.origine, (i, n) => { b.textContent = `Chargement… ${Math.round(i / n * 100)} %`; });
    // les éléments retirés (ou coupés) par vous le restent
    const res = appliquerRetires(objets, plan.picc.retires || []);
    plan.picc = { charge: new Date().toISOString(), ...res };
    if (RT.actif) { RT.sel = -1; majRetrait(); }
    carte.chargerPicc(plan.picc.objets);
    majLegende(); majAmenag(); sauver();
  } catch (e) { $('#piccDate').textContent = e.message; }
  finally { b.disabled = false; b.textContent = 'Recharger les données SPW'; }
};

// ---------------------------------------------------------------- Éléments SPW disparus
const libPicc = (o) => {
  const cat = CATEGORIES.find(([k]) => k === o.k)?.[1];
  const nature = o.n ? o.n[0].toUpperCase() + o.n.slice(1).toLowerCase() : '';
  return nature || cat || 'Élément du plan SPW';
};
function infoPicc(o) {
  const parts = [];
  if (o.t === 'l') parts.push(`longueur ${fmtM(perimetre(o.g.map(([x, y]) => ({ x, y })), false), 1)}`);
  if (o.t === 'a') parts.push(`surface ${fmtM2(aire(o.g[0].map(([x, y]) => ({ x, y }))))}`);
  if (o.a) parts.push(`relevé en ${o.a}`);
  else if (o.m) parts.push(`mis à jour en ${o.m}`);
  return parts.join(' · ');
}

function debutRetrait() {
  if (!plan || RT.actif) return;
  if (M) finMesure();
  if (R.brouillon) annulerBrouillon();
  finAlignement();
  RT = { actif: true, sel: -1, modeAvant: carte.mode };
  carte.setMode('releve');
  majSections();
  majRetrait();
}
function finRetrait() {
  if (!RT.actif) return;
  carte.setSelPicc(null);
  carte.setMode(RT.modeAvant || modeEtape());
  RT = { actif: false, sel: -1, modeAvant: null };
  majSections();
}
function tapRetrait(p, e) {
  if (RT.coupe) { tapCoupe(p, e); return; }
  RT.sel = carte.piccSous(p.x, p.y, e);
  carte.setSelPicc(RT.sel >= 0 ? plan.picc.objets[RT.sel] : null);
  majRetrait(RT.sel < 0);
}
function majRetrait(rien = false) {
  majSuite();
  const o = plan.picc.objets[RT.sel];
  $('#rtAide').textContent = o
    ? "Vérifiez que c'est bien l'élément surligné en rouge. S'il est fait de plusieurs morceaux, retirez-les un par un."
    : (rien ? "Aucun élément du plan SPW à cet endroit. " : '')
      + "Touchez sur la carte l'élément qui n'existe plus : haie, arbre, muret, clôture, poteau… Vous pourrez le remettre plus tard.";
  $('#rtSel').hidden = !o;
  if (!o) RT.coupe = null;
  $('#rtBoutons').hidden = !!RT.coupe;
  $('#rtCoupe').hidden = !RT.coupe;
  $('#rtCouper').hidden = !o || o.t !== 'l';
  if (o) { $('#rtNom').textContent = libPicc(o); $('#rtInfo').textContent = infoPicc(o); }
  if (o && RT.coupe) {
    const c = RT.coupe, L = longueurLigne(o.g);
    $('#rtCoupeAide').textContent = c.s.length === 0
      ? "Touchez sur la ligne l'endroit où la partie disparue commence."
      : c.s.length === 1
        ? "Touchez maintenant l'endroit où elle s'arrête (touchez près d'un bout pour aller jusqu'au bout)."
        : `Partie à retirer : ${fmtM(Math.abs(c.s[1] - c.s[0]), 1)} sur ${fmtM(L, 1)}. Le reste est conservé. Touchez à nouveau la ligne pour recommencer.`;
    $('#rtCoupeOk').disabled = c.s.length < 2 || Math.abs(c.s[1] - c.s[0]) < 0.2;
  }
}
$('#rtRetirer').onclick = () => {
  const o = plan.picc.objets[RT.sel];
  if (!o) return;
  pousserHisto();
  plan.picc.retires.push({ sig: spw.signature(o), o, le: new Date().toISOString() });
  plan.picc.objets.splice(RT.sel, 1);
  RT.sel = -1;
  apresChangementPicc();
  majRetrait();
};
$('#rtFin').onclick = finRetrait;
document.querySelectorAll('[data-retrait]').forEach((b) => { b.onclick = debutRetrait; });

// ---- Coupe d'une ligne (haie, muret, clôture…) : on ne retire que la partie entre deux points
const longueurLigne = (g) => g.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - g[i][0], p[1] - g[i][1]), 0);
// position du point le plus proche de m sur la ligne, en mètres depuis le début
function abscisse(g, m) {
  let best = { s: 0, d: Infinity }, cumul = 0;
  for (let i = 0; i < g.length - 1; i++) {
    const [ax, ay] = g[i], [bx, by] = g[i + 1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    const t = L ? Math.max(0, Math.min(1, ((m.x - ax) * dx + (m.y - ay) * dy) / (L * L))) : 0;
    const d = Math.hypot(ax + t * dx - m.x, ay + t * dy - m.y);
    if (d < best.d) best = { s: cumul + t * L, d };
    cumul += L;
  }
  return best;
}
// morceau de ligne entre s0 et s1 (en mètres depuis le début)
function sousLigne(g, s0, s1) {
  const out = [];
  let cumul = 0;
  const point = (i, t) => [Math.round((g[i][0] + (g[i + 1][0] - g[i][0]) * t) * 100) / 100, Math.round((g[i][1] + (g[i + 1][1] - g[i][1]) * t) * 100) / 100];
  for (let i = 0; i < g.length - 1; i++) {
    const L = Math.hypot(g[i + 1][0] - g[i][0], g[i + 1][1] - g[i][1]);
    const a = cumul, b = cumul + L;
    if (b >= s0 && a <= s1 && L > 0) {
      if (!out.length) out.push(point(i, Math.max(0, (s0 - a) / L)));
      out.push(b <= s1 ? g[i + 1] : point(i, (s1 - a) / L));
    }
    cumul = b;
  }
  return out;
}

$('#rtCouper').onclick = () => {
  RT.coupe = { s: [] };
  majRetrait();
};
$('#rtCoupeAnnuler').onclick = () => {
  RT.coupe = null;
  carte.setSelPicc(plan.picc.objets[RT.sel] || null);
  majRetrait();
};
function tapCoupe(p, e) {
  const o = plan.picc.objets[RT.sel];
  if (!o) return;
  const m = carte.versMonde(p.x, p.y), L = longueurLigne(o.g);
  let { s, d } = abscisse(o.g, m);
  if (d > carte.rayon(e) * 1.5 / carte.vue.s) { $('#rtCoupeAide').textContent = 'Touchez sur la ligne surlignée en rouge.'; return; }
  if (s < 0.5) s = 0;
  if (L - s < 0.5) s = L;
  const c = RT.coupe;
  if (c.s.length >= 2) c.s = [];
  c.s.push(s);
  if (c.s.length === 2) {
    const [s0, s1] = [...c.s].sort((a, b) => a - b);
    carte.setSelPicc({ k: o.k, t: 'l', g: sousLigne(o.g, s0, s1) });
  } else {
    const [pt] = sousLigne(o.g, s, Math.min(s + 0.01, L));
    carte.setSelPicc({ k: 'poteau', t: 'p', g: [pt || o.g[0]] });
  }
  majRetrait();
}
$('#rtCoupeOk').onclick = () => {
  const o = plan.picc.objets[RT.sel], c = RT.coupe;
  if (!o || !c || c.s.length < 2) return;
  const [s0, s1] = [...c.s].sort((a, b) => a - b), L = longueurLigne(o.g);
  const garde = [s0 > 0.2 ? sousLigne(o.g, 0, s0) : null, L - s1 > 0.2 ? sousLigne(o.g, s1, L) : null].filter((g) => g && g.length >= 2);
  pousserHisto();
  const sig = spw.signature(o);
  plan.picc.objets.splice(RT.sel, 1);
  plan.picc.objets.push(...garde.map((g) => ({ ...o, g, de: sig })));
  plan.picc.retires.push({ sig, o, garde, long: Math.round((s1 - s0) * 10) / 10, le: new Date().toISOString() });
  RT.coupe = null;
  RT.sel = -1;
  apresChangementPicc();
  majRetrait();
};

// Applique une liste de retraits à des objets SPW : retire chaque objet par sa signature et,
// pour une coupe, ajoute les morceaux conservés (dans l'ordre, pour les coupes de morceaux).
function appliquerRetires(objets, liste) {
  const obj = [...objets], retires = [];
  for (const r0 of liste) {
    const r = typeof r0 === 'string' ? { sig: r0 } : r0;   // ancien format de l'historique
    const i = obj.findIndex((o) => spw.signature(o) === r.sig);
    if (i < 0) continue;
    const [o] = obj.splice(i, 1);
    if (r.garde) obj.push(...r.garde.map((g) => ({ ...o, g, de: r.sig })));
    retires.push({ sig: r.sig, o, ...(r.garde ? { garde: r.garde, long: r.long } : {}), ...(r.le ? { le: r.le } : {}) });
  }
  return { objets: obj, retires };
}
// Tous les objets SPW d'origine (affichés + retirés), sans les morceaux issus de coupes
const objetsComplets = () => [...plan.picc.objets, ...plan.picc.retires.map((r) => r.o)].filter((o) => !o.de);
const resumeRetires = (l) => l.map(({ sig, garde, long, le }) => ({ sig, ...(garde ? { garde, long } : {}), ...(le ? { le } : {}) }));

function remettre(i) {
  pousserHisto();
  const liste = resumeRetires(plan.picc.retires).filter((_, k) => k !== i);
  Object.assign(plan.picc, appliquerRetires(objetsComplets(), liste));
  apresChangementPicc();
}

// Après annulation : reconstruit les objets SPW pour correspondre à la liste voulue
function retablirRetires(cible) {
  const avant = JSON.stringify(resumeRetires(plan.picc.retires));
  Object.assign(plan.picc, appliquerRetires(objetsComplets(), cible));
  if (JSON.stringify(resumeRetires(plan.picc.retires)) !== avant) apresChangementPicc();
}

function apresChangementPicc() {
  carte.chargerPicc(plan.picc.objets);
  if (RT.actif) { RT.sel = -1; majRetrait(); }
  majLegende();
  majAmenag();
  sauver();
}

function majRetires() {
  const l = plan.picc.retires;
  $('#rtRetires').hidden = !l.length;
  $('#rtResume').textContent = `${l.length} élément${l.length > 1 ? 's' : ''} retiré${l.length > 1 ? 's' : ''} car disparu${l.length > 1 ? 's' : ''}`;
  $('#rtListe').replaceChildren(...l.map((r, i) => {
    const li = document.createElement('li');
    li.className = 'el-ligne';
    li.innerHTML = '<span class="el-txt"><b></b><small></small></span><button class="btn petit" type="button">Remettre</button>';
    li.querySelector('b').textContent = libPicc(r.o);
    li.querySelector('small').textContent = r.garde ? `partie de ${fmtM(r.long, 1)} retirée · ${infoPicc(r.o)}` : infoPicc(r.o);
    li.querySelector('button').onclick = () => remettre(i);
    return li;
  }));
}

// Barre d'échelle
function majEchelle(v) {
  const cible = 110 / v.s; // mètres pour ~110 px
  const p = 10 ** Math.floor(Math.log10(cible));
  const m = [1, 2, 5, 10].map((k) => k * p).filter((x) => x <= cible).pop() || p;
  $('#echBarre').style.width = `${m * v.s}px`;
  $('#echTxt').textContent = m >= 1 ? `${fmt(m, 0)} m` : `${fmt(m * 100, 0)} cm`;
}

$('#zPlus').onclick = () => carte.zoomer(1.5);
$('#zMoins').onclick = () => carte.zoomer(1 / 1.5);
$('#zCadrer').onclick = () => recadrer();
$('#bAnnuler').onclick = annuler;
$('#pExporter').onclick = () => store.exporter(plan);

// ---------------------------------------------------------------- Vue 3D (chargée à la demande)
let vue3d = null;
async function ouvrir3D() {
  if (vue3d) return;
  if (M) finMesure();
  const boite = $('#vue3d');
  boite.hidden = false;
  $('#p3d').setAttribute('aria-pressed', 'true');
  const msg = $('#v3Msg'), aide = msg.textContent;
  msg.textContent = 'Chargement de la vue 3D…';
  try {
    const mod = await import('./vue3d.js');
    if (boite.hidden) return; // refermée entre-temps
    vue3d = mod.ouvrir(boite, plan);
    msg.textContent = aide;
  } catch (e) {
    console.error(e);
    msg.textContent = "La vue 3D n'a pas pu se charger (elle a besoin d'Internet et d'un navigateur récent).";
  }
}
function fermer3D() {
  vue3d?.fermer();
  vue3d = null;
  $('#vue3d').hidden = true;
  $('#p3d').setAttribute('aria-pressed', 'false');
}
$('#p3d').onclick = () => (vue3d || !$('#vue3d').hidden ? fermer3D() : ouvrir3D());
$('#v3Fermer').onclick = fermer3D;
document.querySelectorAll('#vue3d [data-vue]').forEach((b) => { b.onclick = () => vue3d?.pointDeVue(b.dataset.vue); });

// Navigation 3D : flèches à l'écran (maintenir pour continuer) et clavier
const NAV = {
  av: (v) => v.deplacer(1, 0), ar: (v) => v.deplacer(-1, 0), g: (v) => v.deplacer(0, -1), d: (v) => v.deplacer(0, 1),
  tg: (v) => v.tourner(4), td: (v) => v.tourner(-4), zp: (v) => v.zoomer(0.9), zm: (v) => v.zoomer(1 / 0.9),
};
let navMinuterie = null;
const arreterNav = () => { clearInterval(navMinuterie); navMinuterie = null; };
document.querySelectorAll('#vue3d [data-nav]').forEach((b) => {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!vue3d) return;
    const f = NAV[b.dataset.nav];
    f(vue3d);
    arreterNav();
    navMinuterie = setInterval(() => (vue3d ? f(vue3d) : arreterNav()), 60);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, arreterNav);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
});
const TOUCHES_3D = { ArrowUp: 'av', ArrowDown: 'ar', ArrowLeft: 'g', ArrowRight: 'd', z: 'av', s: 'ar', q: 'tg', e: 'td', '+': 'zp', '=': 'zp', '-': 'zm' };
document.addEventListener('keydown', (e) => {
  if (!vue3d || e.ctrlKey || e.metaKey || e.altKey || e.target.matches?.('input, textarea, select')) return;
  const k = TOUCHES_3D[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!k) return;
  e.preventDefault();
  e.stopImmediatePropagation(); // en 3D, les flèches ne doivent pas tourner l'élément sélectionné
  NAV[k](vue3d);
}, true);

// ---------------------------------------------------------------- Impression / PDF
const optsImpression = () => ({
  orientation: $('#iOrientation').value, echelle: $('#iEchelle').value,
  fond: $('#iFond').checked, cotes: $('#iCotes').checked, releve: $('#iReleve').checked,
  amenagement: $('#iAmenag').checked, listes: $('#iListes').checked,
});
function majInfoImpression() {
  const o = optsImpression();
  const auto = imp.echelleAuto(plan, o);
  $('#iInfo').textContent = o.echelle === 'auto'
    ? `Le plan tiendra sur la page à l'échelle 1:${auto} (1 cm sur la feuille = ${fmt(auto / 100, auto % 100 ? 1 : 0)} m).`
    : +o.echelle < auto ? `À 1:${o.echelle}, une partie du terrain sortira de la page ; l'échelle 1:${auto} le montre en entier.` : '';
}
$('#pImprimer').onclick = () => {
  if (M) finMesure();
  majInfoImpression();
  $('#dlgImpression').returnValue = '';
  $('#dlgImpression').showModal();
};
$('#formImpression').addEventListener('change', majInfoImpression);
$('#formImpression').addEventListener('submit', (ev) => {
  ev.preventDefault();
  $('#dlgImpression').close();
  if (ev.submitter?.value !== 'ok') return;
  const o = optsImpression();
  $('#stylePage').textContent = `@page { size: A4 ${o.orientation === 'paysage' ? 'landscape' : 'portrait'}; margin: 10mm; }`;
  $('#impression').innerHTML = imp.construire(plan, o, adresseTexte(plan.adresse));
  document.body.dataset.orientation = o.orientation;
  setTimeout(() => window.print(), 50);
});
window.addEventListener('afterprint', () => { $('#impression').replaceChildren(); });

document.addEventListener('keydown', (e) => {
  if (vPlan.hidden || e.target.matches?.('input, textarea, select')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); annuler(); }
  else if (e.key === 'Escape' && C.actif) outilCote(false);
  else if (e.key === 'Escape' && RT.actif && !M) finRetrait();
  else if (e.key === 'Escape' && M) { if (M.choix != null) { M.choix = null; majMesure(); } else $('#mAnnuler').click(); }
  else if (e.key === 'Escape' && R.brouillon && etape === 2) annulerBrouillon();
  else if (e.key === 'Escape' && R.sel >= 0 && etape === 2) selectionner(-1);
  else if (e.key === 'Escape' && carte.mode === 'tracer') { carte.setMode('naviguer'); majPanneau(); }
  else if (etape === 2 && e.key === 'Escape' && R.aligner) { finAlignementReleve(); majReleve(); carte.dessinerOverlay(); }
  else if (etape === 2 && elSel() && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && rel.peutTourner(elSel())) {
    e.preventDefault();
    tournerEl((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 15 : 1));
  }
  else if (etape === 2 && elSel() && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); supprimerElement(); }
  else if (etape === 3 && e.key === 'Escape') { if (A.aligner) finAlignement(); else { A.sel = -1; majAmenag(); } }
  else if (etape === 3 && objSel() && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    tourner((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 15 : 1));
  }
  else if (etape === 3 && objSel() && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); supprimerObjet(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && !$('#cSuppr').hidden) { e.preventDefault(); $('#cSuppr').click(); }
  else if (e.key === 'Enter' && carte.mode === 'tracer' && plan.contour.points.length >= 3) carte.fermer();
});

// ---------------------------------------------------------------- Navigation
function router() {
  const m = location.hash.match(/^#p-(\w+)$/);
  if (m) ouvrirPlan(m[1]);
  else { plan = null; afficherAccueil(); afficherRecu(); }
}

// ---------------------------------------------------------------- Plan reçu par lien
let planRecu = null;
async function afficherRecu() {
  const box = $('#recu');
  box.hidden = true;
  planRecu = null;
  if (!lien.contientPlan(location.hash)) return;
  box.hidden = false;
  $('#recuMsg').textContent = '';
  $('#recuAjouter').disabled = false;
  try {
    planRecu = await lien.relire(location.hash);
    $('#recuNom').textContent = planRecu.nom;
    const n = [planRecu.elements?.length && `${planRecu.elements.length} élément(s) relevé(s)`, planRecu.amenagement?.length && `${planRecu.amenagement.length} élément(s) d'aménagement`].filter(Boolean);
    $('#recuInfo').textContent = [adresseTexte(planRecu.adresse), ...n].filter(Boolean).join(' · ');
  } catch (e) {
    $('#recuNom').textContent = 'Lien illisible';
    $('#recuInfo').textContent = '';
    $('#recuMsg').textContent = e.message;
    $('#recuAjouter').disabled = true;
  }
}
const oublierLien = () => history.replaceState(null, '', location.pathname + location.search);
$('#recuIgnorer').onclick = () => { oublierLien(); $('#recu').hidden = true; planRecu = null; };
$('#recuAjouter').onclick = async () => {
  const p = planRecu;
  if (!p) return;
  const b = $('#recuAjouter'), msg = $('#recuMsg');
  b.disabled = true;
  try {
    // le fond SPW n'est pas dans le lien : on le recharge, puis on retire à nouveau les éléments disparus
    const objets = await spw.chargerPICC(p.zone, p.origine, (i, n) => { msg.textContent = `Chargement du plan SPW… ${Math.round(i / n * 100)} %`; });
    p.picc = { charge: new Date().toISOString(), ...appliquerRetires(objets, p.picc?.retires || []) };
    if (!p.id || await store.lire(p.id)) p.id = store.nouvelId();
    await store.enregistrer(p);
    planRecu = null;
    $('#recu').hidden = true;
    location.replace(`${location.pathname}${location.search}#p-${p.id}`);
  } catch (e) {
    msg.textContent = e.message;
    b.disabled = false;
  }
};

// ---------------------------------------------------------------- Partager le plan ouvert
$('#pPartager').onclick = async () => {
  if (!plan) return;
  const dlg = $('#dlgPartage');
  $('#ptMsg').textContent = '';
  $('#ptLien').value = 'Préparation du lien…';
  dlg.showModal();
  let adresseLien;
  try { adresseLien = location.origin + location.pathname + await lien.fabriquer(plan); }
  catch { $('#ptLien').value = ''; $('#ptInfo').textContent = "Ce navigateur ne sait pas préparer de lien de partage. Utilisez « Exporter » et envoyez le fichier."; return; }
  $('#ptLien').value = adresseLien;
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  const infos = [`La personne qui ouvre ce lien reçoit une copie du plan « ${plan.nom} » (contour, relevé, aménagement) et peut l'ajouter à ses plans. Le fond SPW se recharge chez elle.`];
  if (local) infos.push("Attention : vous êtes sur la version de test de ce PC. Ce lien ne fonctionnera que sur ce PC ; partagez depuis le site en ligne.");
  if (adresseLien.length > lien.LIMITE) infos.push(`Ce plan est très gros (${Math.round(adresseLien.length / 1000)} 000 caractères) : le lien risque d'être coupé. Utilisez plutôt « Exporter » et envoyez le fichier.`);
  $('#ptInfo').textContent = infos.join(' ');
  $('#ptEnvoyer').hidden = !navigator.share;
};
$('#ptEnvoyer').onclick = async () => {
  try { await navigator.share({ title: plan.nom, text: `Plan « ${plan.nom} »`, url: $('#ptLien').value }); }
  catch (e) { if (e.name !== 'AbortError') $('#ptMsg').textContent = "L'envoi n'a pas pu s'ouvrir : copiez le lien."; }
};
$('#ptCopier').onclick = async () => {
  const t = $('#ptLien');
  try { await navigator.clipboard.writeText(t.value); }
  catch { t.select(); document.execCommand('copy'); }
  $('#ptMsg').textContent = 'Lien copié : collez-le dans un e-mail, un SMS ou WhatsApp.';
};
window.addEventListener('hashchange', router);
router();
