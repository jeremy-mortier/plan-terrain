// Sauvegarde des plans sur l'appareil (IndexedDB).
// La synchronisation entre appareils viendra se brancher ici plus tard.

const DB = 'cartographie', STORE = 'plans', REGLAGES = 'reglages';
let dbp;

function ouvrir() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(REGLAGES)) db.createObjectStore(REGLAGES); // catalogue perso…
      };
      r.onsuccess = () => {
        // un autre onglet passe à une version plus récente : on libère la base
        r.result.onversionchange = () => { r.result.close(); dbp = null; };
        res(r.result);
      };
      r.onblocked = () => rej(new Error("L'application est ouverte dans un autre onglet avec une ancienne version : fermez cet onglet puis rechargez la page."));
      r.onerror = () => rej(new Error("La sauvegarde sur cet appareil n'est pas disponible (navigation privée ?)."));
    });
  }
  return dbp;
}

async function tx(mode, fn, store = STORE) {
  const db = await ouvrir();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}

export const lister = () => tx('readonly', (s) => s.getAll())
  .then((l) => l.sort((a, b) => (b.modifie || '').localeCompare(a.modifie || '')));
export const lire = (id) => tx('readonly', (s) => s.get(id));
export const supprimer = (id) => tx('readwrite', (s) => s.delete(id));
export function enregistrer(plan) {
  plan.modifie = new Date().toISOString();
  return tx('readwrite', (s) => s.put(plan));
}

// Réglages communs à tous les plans (catalogue personnel)
export const lireReglage = (cle) => tx('readonly', (s) => s.get(cle), REGLAGES);
export const ecrireReglage = (cle, v) => tx('readwrite', (s) => s.put(v, cle), REGLAGES);

export const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Export / import en fichier JSON
export function exporter(plan) {
  const blob = new Blob([JSON.stringify(plan)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const nom = (plan.nom || 'plan').replace(/[^\w\- àâäéèêëïîôöùûüç]/gi, '').trim() || 'plan';
  a.download = `${nom}.plan.json`;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function importer(fichier) {
  let plan;
  try {
    plan = JSON.parse(await fichier.text());
  } catch {
    throw new Error("Ce fichier n'est pas un plan valide.");
  }
  if (!plan || plan.format !== 'cartographie-plan' || !plan.id) throw new Error("Ce fichier n'est pas un plan de cette application.");
  const existant = await lire(plan.id);
  if (existant) plan.id = nouvelId(); // garde les deux versions
  await tx('readwrite', (s) => s.put(plan));
  return plan;
}
