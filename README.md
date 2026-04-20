# Dashboard v2 — maquette app mobile

Nouvelle version du dashboard pensee comme maquette navigable de la future app mobile catcam.
La version actuelle (`dashboard/`) reste intacte et redeployable — voir
`wiki/decisions/2026-04-20_dashboard_v2_isolation.md`.

## Stack

- HTML statique + **Tailwind CSS** (CDN, pas de build)
- **Supabase JS v2** (CDN) — meme table `sessions` et bucket `media` que la v1
- Google Fonts **Inter**
- Zero dependance npm, zero outil a installer

## Structure

```
dashboard-v2/
├── index.html   page d'accueil mobile-first (440px max)
├── app.js       logique (fetch Supabase, rendu cartes, sparkline SVG)
└── README.md    ce fichier
```

## Lancer en local

Ouvrir `index.html` directement dans le navigateur. Aucun serveur requis.

Pour tester l'apparence mobile sur desktop : ouvrir les devtools, activer
"Toggle device toolbar" et choisir un preset iPhone.

## Design

- Palette **warm-cream** (fond `#FAF7F2`), vert calme pour "dans la norme",
  ambre pour "a surveiller", rouge reserve aux urgences device.
- Typographie Inter, hierarchie claire : chiffre contextualise par un label
  ("dans la norme") plutot qu'un chiffre isole.
- Approche **calm tech** : pas de badge notification, pas de streak,
  statut vert domine. Voir `wiki/sources/catcam_mobile_ux_claude_desktop_approach.md`.

## Baselines (v0)

Les plages "dans la norme" sont en dur dans `app.js` :
- Papouille : 25–55 ml/jour
- Tigrou    :  6–20 ml/jour

(1 g d'eau = 1 mL, donc les valeurs `delta_g` de Supabase sont utilisees directement comme ml.)

A remplacer par un calcul glissant ±1σ sur 4 semaines en v1.

## Prochaines pages

- [ ] Profil chat (baseline, heatmap horaire, 30j)
- [ ] Session detail (timelapse, courbe poids, validation ReID)
- [ ] Timeline (liste + heatmap calendaire)
- [ ] Alertes (tab conditionnel)
- [ ] Settings / device
