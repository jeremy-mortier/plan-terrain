# Plan de terrain

Application web pour relever un terrain et préparer l'aménagement d'un événement, sur fond du plan PICC du Service public de Wallonie.

## Où on en est

| Étape | État |
|---|---|
| Accueil, liste des plans, export / import | fait |
| Nouveau plan à partir d'une adresse (Wallonie), chargement du PICC en direct | fait |
| Contour du terrain : tracé avec aimant, déplacement et ajout de points, validation | fait |
| Relevé des éléments fixes par deux mesures (arbres, haies, murets, autres) | fait |
| Coin du contour placé par deux mesures | fait |
| Aménagement : catalogue (+ éléments sur mesure), déplacement, rotation au degré, « Aligner sur… » | fait |
| Aménagement : points d'attention, liste du matériel, surfaces | fait |
| Plan SPW : année de relevé dans la légende, retrait des éléments disparus (et remise) | fait |
| Distances en direct aux éléments proches (aménagement) | fait |
| Partage d'un plan par lien (copie chez le destinataire) | fait |
| Synchronisation PC / téléphone | à décider |
| Impression / PDF (A4, échelle 1:200 à 1:1000, listes en 2e page) | fait |
| Vue 3D en consultation (Three.js, terrain plat) | fait |

## Tester sur ce PC

```
pwsh -NoProfile -File outils/serveur-local.ps1
```

Puis ouvrir http://localhost:8080 dans le navigateur.

## Organisation du code

- `index.html` : les deux écrans (accueil et plan)
- `css/style.css` : présentation
- `js/app.js` : écrans, formulaire, panneaux du contour, du relevé et de la mesure
- `js/carte.js` : carte (déplacement, zoom, aimant, édition du contour, dessin des éléments et des repères)
- `js/releve.js` : types d'éléments, choix des deux repères, calcul de position (trilatération)
- `js/lien.js` : partage d'un plan par lien (plan compressé après `#plan=`, jamais envoyé à un serveur)
- `js/vue3d.js` : vue 3D (chargée à la demande depuis cdn.jsdelivr.net, Three.js 0.160)
- `js/impression.js` : mise en page imprimable (plan à l'échelle en millimètres, listes)
- `js/amenagement.js` : catalogue, rectangles tournés, alertes (chevauchements, haies, arbres…), liste du matériel
- `js/spw.js` : accès aux services du SPW (adresses, PICC)
- `js/store.js` : sauvegarde sur l'appareil, export / import
- `js/geom.js` : calculs (surface, périmètre, distances)

Les coordonnées sont en mètres, Lambert belge 2008 (EPSG:3812). Chaque plan garde son origine ; les objets sont stockés relativement à elle.
