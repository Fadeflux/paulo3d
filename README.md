# Paulo3D — atelier d'impression 3D

Application web installable sur PC et téléphone : bobines de filament, coût de revient, productions, prints ratés, stock de pièces, ventes et tableau de bord financier. Les données sont enregistrées dans **Supabase** (PostgreSQL) et restent utilisables **sans réseau** : les actions attendent sur l'appareil et partent toutes seules au retour de la connexion.

## Contenu du dossier

| Dossier / fichier | Rôle |
|---|---|
| `docs/` | **Le site prêt à publier** : `index.html` (toute l'application en un fichier), `sw.js` (hors-ligne), `manifest.webmanifest` (installation), `icons/` |
| `supabase/schema.sql` | **Le script à exécuter une fois dans Supabase** (tables, calculs, sécurité, temps réel) |
| `src/` | Le code source. On modifie ici, puis on reconstruit `docs/` |
| `tests/`, `tools/` | Tests automatiques et outils de construction |

---

## 1. Créer la base Supabase (≈ 10 minutes)

1. Sur [supabase.com](https://supabase.com), crée un projet gratuit (région Europe). Garde le mot de passe de la base en lieu sûr.
2. Menu **SQL Editor** → **New query** → colle **tout** le fichier `supabase/schema.sql` → **Run**.
   Vérification : `select public.p3d_version();` doit répondre `3`.
3. Bouton **Connect** en haut du projet (ou **Project Settings → API Keys**) : note l'**URL du projet** (`https://xxxx.supabase.co`) et la clé **publishable** (ou **anon**).
   ⚠️ Ne copie jamais la clé **secret** / **service_role** : l'application la refuse.
4. **Authentication → URL Configuration** : mets l'adresse du site (`https://fadeflux.github.io/paulo3d/`) dans **Site URL** et dans **Redirect URLs**. Sans ça, le lien « mot de passe oublié » reçu par email ne ramène pas vers l'application.
5. **Fermer les inscriptions** (l'application n'a volontairement AUCUN bouton d'inscription) :
   - **Authentication → Sign In / Providers → Allow new users to sign up** = désactivé ;
   - même page, **Email → Minimum password length** = `12` et **Password requirements** = « Lowercase, uppercase letters, digits and symbols » (l'application applique la même règle) ;
   - **Authentication → Rate Limits → sign-ups and sign-ins** = `10` par 5 minutes (freine les essais de mots de passe).
6. **Créer LE compte de l'atelier** (le seul) : **Authentication → Users → Add user → Create new user** : un email, un mot de passe d'au moins 12 caractères (minuscule, majuscule, chiffre, symbole), coche **Auto Confirm User**. C'est cet email + ce mot de passe qu'on tape dans l'application (Supabase ne connaît pas les noms d'utilisateur, seulement les emails).
7. **Authentication → Multi-Factor** : **TOTP** doit être activé (c'est ce qui permet la double authentification, voir « Bon à savoir »).

> Le script peut être relancé sans rien perdre : c'est aussi comme ça qu'on applique une mise à jour de la base.

## 2. Mettre le site en ligne (GitHub Pages)

1. Le dépôt GitHub `paulo3d` contient ce dossier.
2. Dépôt → **Settings → Pages** → *Deploy from a branch* → branche `main`, dossier **`/docs`**.
3. Le site est en ligne au bout d'une minute environ : **https://fadeflux.github.io/paulo3d/**.
4. Une mise à jour = reconstruire `docs/` (`npm run build`) puis envoyer sur GitHub : l'appli propose « Nouvelle version disponible ».
5. **Anti-pause** : dépôt → **Settings → Secrets and variables → Actions** → deux secrets, `SUPABASE_URL` (adresse du projet) et `SUPABASE_KEY` (clé **publishable**, jamais la secrète). La tâche `veille-supabase.yml` envoie alors un signe de vie à la base le lundi et le jeudi (sans lire ni écrire aucune donnée) ; si la base ne répond pas, GitHub prévient par email.

> D'autres sites sont publiés à la même adresse de base (`fadeflux.github.io`). Paulo3D range tout ce qu'il garde dans le navigateur sous ses propres noms (`p3d_…`, `paulo3d:…`) et reconstitue tout seul sa copie hors-ligne si un autre site vide les caches du navigateur.

## 3. Première utilisation

1. Ouvre le site → colle l'URL et la clé publique → **Tester et continuer** → connecte-toi.
   Pour découvrir l'application sans rien configurer : **Essayer en mode démo** (données d'exemple, gardées uniquement sur l'appareil).
2. **Installer sur téléphone** :
   - iPhone : dans **Safari**, bouton **Partager** → **Sur l'écran d'accueil** ;
   - Android : dans **Chrome**, menu ⋮ → **Installer l'application**.
3. **Configurer un autre appareil en 5 secondes** : Paramètres → **Autre appareil (QR code)**, puis scanne avec le téléphone.
4. Dans **Paramètres**, règle tes taux (machine, main-d'œuvre), tes machines et les commissions de tes canaux de vente.

## Bon à savoir

- **Hors-ligne** : la pastille en haut indique honnêtement l'état : « Synchronisé », « Hors-ligne · 2 en attente », « Reconnexion requise », « 1 action refusée ». Une action n'est jamais annoncée « enregistrée » avant la réponse de la base. Les actions en attente survivent à la fermeture de l'appli et partent seules au retour du réseau (ou après reconnexion si la session a expiré). Une action refusée (ex. stock insuffisant) reste visible dans le panneau de synchronisation pour la corriger ou l'abandonner.
- **Commissions** : elles sont à 0 par défaut. Renseigne les frais réels de chaque plateforme (Etsy, Vinted…) dans **Paramètres → Canaux de vente** : ils sont alors calculés automatiquement à chaque vente (toujours modifiables).
- **Import Bambu Studio** : dans un template, dépose le fichier **.gcode.3mf** (« Exporter le fichier de plaque découpée ») ou un **.gcode**. Les grammes par couleur (purge et tour incluses), le temps et le nombre de pièces sont lus directement dans le fichier.
- **Poids des bobines** : le bouton **Peser** corrige le poids restant avec la balance (la tare de la bobine vide est retenue). Les consommations enregistrées après la pesée sont déduites automatiquement.
- **Coût de revient figé** : chaque production garde le coût du jour. Changer un prix de bobine plus tard ne modifie pas les marges passées.
- **Commandes clients** : Stock & Ventes → **Commandes** (ou le bouton « + ») : client, pièce, quantité, date promise. Les commandes en retard passent en tête. **Produire** lance la production de la commande, **Livrer** enregistre la vente déjà remplie (client, prix, canal) et range la commande dans « livrées ».
- **Bilan du mois** : Tableau de bord → **Bilan du mois** : chiffres clés, ventes, productions et achats du mois, avec les flèches pour changer de mois. Le bouton **PDF** crée un vrai fichier : sur téléphone, le menu de partage s'ouvre (Imprimer, Enregistrer dans Fichiers, WhatsApp…) ; sur ordinateur, il est téléchargé. **Imprimer** (quand le navigateur le permet) imprime directement.
- **Étiquettes QR des bobines** : Bobines → **Étiquettes** (ou menu ⋮ d'une bobine) → **PDF** : une feuille A4 de 14 étiquettes à découper. Scanner l'étiquette avec le téléphone ouvre directement la pesée de cette bobine.
- **Sauvegardes** : Paramètres → Données → **Exporter** (JSON complet ou CSV pour Excel). L'offre gratuite de Supabase ne fournit pas de sauvegarde restaurable : le tableau de bord rappelle de faire une sauvegarde tous les 30 jours (un geste : bouton **Sauvegarder**).
- **Projet en pause** : un projet Supabase gratuit sans aucune activité pendant 7 jours est mis en pause. Le signe de vie automatique (section 2, point 5) l'évite ; si jamais c'est arrivé, bouton **Restore** dans le tableau de bord Supabase.
- **Double authentification** (conseillée) : Paramètres → **Double authentification** → **Activer** → scanner le QR code avec une appli gratuite (Google Authenticator, Microsoft Authenticator, 2FAS…) → taper le code affiché. Ensuite, chaque connexion demande le mot de passe **et** le code à 6 chiffres de l'appli. **Téléphone perdu** : le propriétaire du projet Supabase retire la double authentification du compte (**Authentication → Users → le compte**, partie des facteurs MFA ; ou, dans **SQL Editor** : `delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'EMAIL-DU-COMPTE');`), puis on la réactive sur le nouveau téléphone.
- **Sécurité** :
  - chaque ligne de la base appartient à un compte ; sans connexion, rien n'est lisible ni modifiable (Row Level Security, vérifiée par les tests). La clé publique peut être visible sans risque, c'est prévu pour ;
  - aucune inscription possible (ni dans l'application, ni côté Supabase) : seul le compte créé dans le tableau de bord peut entrer ;
  - la page n'exécute que son propre code (reconnu par son empreinte) et 4 bibliothèques à adresse exacte, vérifiées par leur intégrité : un code glissé dans la page est bloqué par le navigateur ;
  - les données ne peuvent partir que vers Supabase ; la page refuse de s'afficher dans le cadre d'un autre site ; elle n'est pas indexée par les moteurs de recherche ;
  - limite à connaître : tous les sites `fadeflux.github.io/…` partagent la même adresse, donc le même stockage du navigateur. Un autre de ces sites, s'il était piraté, pourrait lire la session de Paulo3D sur un appareil où les deux ont été ouverts. Pour une séparation totale, héberger Paulo3D sur sa propre adresse.

---

## Pour modifier l'application

```bash
npm install
```

```bash
npm run build
```

`npm run build` reconstruit `docs/` à partir de `src/` : compile le CSS (Tailwind, seulement les classes utilisées), intègre les icônes, calcule l'empreinte d'intégrité des bibliothèques (mise en cache dans `tools/sri.json`, internet nécessaire la première fois) et vérifie au passage la syntaxe et les noms jamais définis.

```bash
npm test
```

`npm test` lance plus de 120 tests : le script SQL sur un vrai PostgreSQL local (sécurité, double authentification, stock FIFO, pesées, commandes, rejeu sans doublon, suppressions qui ne reviennent pas), la parité entre les calculs de l'application et ceux de la base, la synchronisation (ordre des modifications, temps réel, session expirée, code de sécurité demandé, suppressions sur un autre appareil), le fonctionnement hors-ligne après une mise à jour, la politique de sécurité de la page, la règle des mots de passe, les fichiers PDF (structure, texte français, pages, étiquettes) et les calculs de coûts, prix, graphiques et import slicer.

Tests de bout en bout sans toucher une vraie base : `node tools/dev-supabase.mjs` démarre une imitation locale de Supabase (PostgreSQL + PostgREST officiel + connexion), puis `node tools/build.mjs --dev` produit un site de test dans `.dev/site/`.
