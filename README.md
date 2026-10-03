# COOL — Gestion de laboratoire éducatif

Application web pour gérer un laboratoire de sciences en milieu scolaire ou universitaire :
inventaire du matériel et des produits chimiques, planning des salles, travaux pratiques (TP),
emprunts, sécurité et incidents. Interface en français, utilisable sur ordinateur et sur mobile
(thème clair ou sombre selon le système).

## Fonctionnalités

| Domaine | Ce que l'on peut faire |
|---|---|
| **Tableau de bord** | Alertes (stocks bas, produits périmés ou bientôt périmés, matériel indisponible, emprunts en retard), séances du jour et de la semaine, compteurs. |
| **Planning** | Vue hebdomadaire des séances par salle, création/modification/suppression. Refuse les chevauchements dans une même salle et les groupes plus nombreux que la capacité de la salle. |
| **Travaux pratiques** | Fiches TP (objectifs, protocole, consignes de sécurité), matériel et produits requis **par poste**, pictogrammes de danger (SGH) agrégés automatiquement à partir des produits. |
| **Fiche de préparation** | Pour une séance : besoins (par poste × nombre de postes) comparés au stock et à la disponibilité réelle ; signale les manques, le matériel en maintenance et les produits périmés à la date de la séance. Imprimable. |
| **Matériel** | Quantités, emplacement, état (disponible / maintenance / hors service), disponibilité calculée en tenant compte des emprunts. |
| **Produits chimiques** | Stock, unité, seuil d'alerte, péremption, n° CAS, pictogrammes SGH. **Journal des mouvements** : toute entrée, consommation ou correction d'inventaire est tracée (qui, quand, pourquoi) ; le stock ne peut jamais devenir négatif. |
| **Emprunts** | Sortie et retour de matériel, contrôle du stock disponible, détection des retards. |
| **Incidents** | Tout le monde peut signaler ; le personnel technique traite (statut, résolution). |
| **Administration** | Salles, groupes (classes), utilisateurs et rôles. Export CSV de l'inventaire. |

### Rôles et droits

| | Administrateur | Technicien | Enseignant | Élève |
|---|:-:|:-:|:-:|:-:|
| Consulter inventaire, TP, planning | ✔ | ✔ | ✔ | ✔ |
| Modifier matériel, produits, salles | ✔ | ✔ | — | — |
| Mouvements de stock, emprunts, traiter les incidents, export CSV | ✔ | ✔ | — | — |
| Créer des TP et des séances (modifier uniquement les siens) | ✔ (tous) | — | ✔ | — |
| Gérer les groupes | ✔ | — | ✔ | — |
| Fiche de préparation | ✔ | ✔ | ✔ | — |
| Signaler un incident | ✔ | ✔ | ✔ | ✔ (voit les siens) |
| Voir les emprunts | tous | tous | les siens | les siens |
| Gérer les utilisateurs | ✔ | — | — | — |

Les droits sont appliqués **côté serveur** ; l'interface ne fait que masquer les actions interdites.

## Démarrage rapide

Prérequis : **Node.js ≥ 22.13** (la base SQLite est celle intégrée à Node, aucune compilation native).

```bash
npm install
npm start          # http://127.0.0.1:3000
```

Au premier lancement, la base `data/lab.db` est créée avec des **données de démonstration**
(le mot de passe de démo est affiché dans la console, `demo1234` par défaut) :

| Compte | Rôle |
|---|---|
| `admin@lab.local` | Administrateur |
| `prof@lab.local`, `sophie@lab.local` | Enseignants |
| `tech@lab.local` | Technicien |
| `eleve@lab.local`, `hugo@lab.local` | Élèves |

Les dates de démonstration sont relatives à la date du jour, de sorte que les alertes
(stock bas, péremption, retards) sont visibles immédiatement.

## Configuration

Variables d'environnement :

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute. |
| `HOST` | `127.0.0.1` | Adresse d'écoute. Mettre `0.0.0.0` pour être joignable sur le réseau. |
| `LAB_DB` | `data/lab.db` | Chemin du fichier SQLite. |
| `LAB_DEMO` | `1` | `0` : ne charge pas les données de démo (voir ci-dessous). |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@lab.local` / aléatoire | Compte administrateur créé quand `LAB_DEMO=0` et que la base est vide. Sans `ADMIN_PASSWORD`, un mot de passe aléatoire est généré et affiché une fois. |
| `DEMO_PASSWORD` | `demo1234` | Mot de passe des comptes de démo. |
| `COOKIE_SECURE` | — | `1` : marque le cookie de session `Secure` (obligatoire derrière HTTPS). |

### Mise en service réelle

1. Partir d'une base vide : `LAB_DEMO=0 ADMIN_PASSWORD='un-mot-de-passe-solide' npm start`.
2. Placer l'application derrière un reverse proxy HTTPS (nginx, Caddy…) et définir `COOKIE_SECURE=1`.
3. Créer les comptes depuis *Administration → Utilisateurs*.
4. Sauvegarder régulièrement `data/lab.db` (et ses fichiers `-wal`/`-shm` à chaud, ou arrêter le serveur avant copie).

## Architecture

```
server/
  index.js        démarrage (variables d'environnement, amorçage, arrêt propre)
  app.js          assemblage Express, en-têtes de sécurité, gestion d'erreurs
  db.js           schéma SQLite et transactions
  auth.js         mots de passe (scrypt), sessions, rôles, limiteur de connexions
  validate.js     validation et nettoyage des entrées (types, bornes, énumérations)
  crud.js         routeur CRUD générique (salles, groupes, matériel, produits)
  routes/         session, users, catalog, practicals, bookings, loans, incidents, dashboard
  seed.js         compte administrateur et données de démonstration
public/           interface (JavaScript natif en modules ES, sans étape de build)
  js/views/       une vue par page ; js/ui.js : composants, formulaires, dialogues
test/             tests d'API (runner natif de Node)
```

Choix techniques : une seule dépendance (Express 5) ; SQLite intégré à Node (`node:sqlite`) ;
sessions stockées en base ; aucune étape de build côté interface.

## API

Toutes les routes sont sous `/api`, répondent en JSON et exigent une session (cookie) sauf `login`.
Les requêtes qui modifient des données doivent porter l'en-tête `X-Requested-With: XMLHttpRequest`
(protection CSRF). Les erreurs ont la forme `{ "error": "message", "fields": { "champ": "message" } }`.

| Ressource | Routes |
|---|---|
| Session | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password` |
| Utilisateurs | `GET·POST /users`, `PUT·DELETE /users/:id` (admin) ; `GET /users/people` (liste minimale) |
| Salles, groupes, matériel, produits | `GET·POST /{rooms,groups,equipment,reagents}`, `GET·PUT·DELETE …/:id` |
| Mouvements de stock | `GET·POST /reagents/:id/movements` |
| TP | `GET·POST /practicals`, `GET·PUT·DELETE /practicals/:id` (avec `equipment[]` et `reagents[]`) |
| Séances | `GET /bookings?from=&to=&room_id=`, `POST /bookings`, `PUT·DELETE /bookings/:id`, `GET /bookings/:id/preparation` |
| Emprunts | `GET /loans?status=open\|overdue\|returned`, `POST /loans`, `PUT /loans/:id`, `POST /loans/:id/return`, `DELETE /loans/:id` |
| Incidents | `GET·POST /incidents`, `PUT·DELETE /incidents/:id` |
| Autres | `GET /dashboard`, `GET /export/{equipment,reagents}.csv` |

## Tests

```bash
npm test
```

La suite lance l'application sur un port libre avec une base en mémoire et vérifie notamment :
authentification et expiration, permissions par rôle, validation, conflits de réservation,
capacité des salles, stocks et emprunts, journal des mouvements, fiche de préparation,
tableau de bord et neutralisation des formules dans les exports CSV.

## Sécurité

- Mots de passe hachés avec **scrypt** ; jetons de session aléatoires, **seul leur hachage** est stocké ; cookie `HttpOnly`, `SameSite=Lax` (+ `Secure` avec `COOKIE_SECURE=1`).
- Sessions révoquées à la désactivation d'un compte, au changement de rôle ou de mot de passe.
- Limitation des tentatives de connexion (8 échecs / 15 min par adresse IP et compte) ; message identique pour compte inconnu et mauvais mot de passe.
- Requêtes SQL toujours **paramétrées** ; entrées validées côté serveur (types, bornes, listes de valeurs).
- Interface construite par nœuds DOM (jamais de HTML issu des données) et **Content-Security-Policy** stricte (`default-src 'self'` : aucun script ni style en ligne, aucune ressource externe).
- Protection CSRF : cookie `SameSite` + en-tête personnalisé obligatoire sur les écritures.
- Exports CSV protégés contre l'injection de formules.

Limites connues : le limiteur de connexions est en mémoire (une seule instance) et ne tient pas compte d'un
éventuel `X-Forwarded-For` ; l'application est pensée pour un établissement, pas pour une exposition
publique massive.

## Pistes d'évolution

Pagination des listes (inutile aux volumes d'un laboratoire, mais utile au-delà de quelques milliers de lignes),
décompte automatique des consommations à la clôture d'une séance, notifications par email des alertes,
import CSV de l'inventaire, prise en compte des autres séances du même jour dans la fiche de préparation.
