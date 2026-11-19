// Plan transmis par lien : le contenu du plan (sans le fond SPW, rechargé à l'arrivée)
// est compressé puis écrit en caractères simples après « #plan= ». Rien n'est envoyé à un serveur :
// le lien est seulement copié par l'utilisateur dans le message de son choix.

export const DEBUT = '#plan=';
export const LIMITE = 60000; // au-delà, certaines messageries coupent les liens trop longs

// Écriture en 64 caractères sûrs dans une adresse (A-Z a-z 0-9 - _)
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const RANG = new Map([...ALPHABET].map((c, i) => [c, i]));

function versTexte(octets) {
  let t = '';
  for (let i = 0; i < octets.length; i += 3) {
    const n = (octets[i] << 16) | ((octets[i + 1] ?? 0) << 8) | (octets[i + 2] ?? 0);
    const reste = octets.length - i;
    t += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (reste > 1) t += ALPHABET[(n >> 6) & 63];
    if (reste > 2) t += ALPHABET[n & 63];
  }
  return t;
}

function versOctets(t) {
  const sortie = [];
  for (let i = 0; i < t.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => RANG.get(t[i + k]) ?? 0);
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    sortie.push((n >> 16) & 255);
    if (i + 2 < t.length) sortie.push((n >> 8) & 255);
    if (i + 3 < t.length) sortie.push(n & 255);
  }
  return new Uint8Array(sortie);
}

async function transformer(donnees, etape) {
  const flux = new Blob([donnees]).stream().pipeThrough(etape);
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

// Plan allégé : sans les objets SPW (ils seront rechargés), avec la liste des éléments retirés
export function alleger(plan) {
  const { picc, ...reste } = plan;
  return { ...reste, picc: { charge: picc.charge, objets: [], retires: (picc.retires || []).map((r) => (r.garde ? { sig: r.sig, garde: r.garde, long: r.long } : { sig: r.sig })) } };
}

// Texte à placer après l'adresse du site
export async function fabriquer(plan) {
  const octets = await transformer(JSON.stringify(alleger(plan)), new CompressionStream('deflate-raw'));
  return DEBUT + versTexte(octets);
}

export const contientPlan = (fragment) => fragment.startsWith(DEBUT);

export async function relire(fragment) {
  try {
    const octets = versOctets(fragment.slice(DEBUT.length));
    const texte = new TextDecoder().decode(await transformer(octets, new DecompressionStream('deflate-raw')));
    const plan = JSON.parse(texte);
    if (plan?.format !== 'cartographie-plan' || !plan.zone || !plan.origine) throw new Error();
    return plan;
  } catch {
    throw new Error("Ce lien est incomplet ou abîmé. Demandez à la personne de vous le renvoyer.");
  }
}