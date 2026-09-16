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
   Vérification : `select public.p3d_version();` doit répondre `1`.
3. Bouton **Connect** en haut du projet (ou **Project Settings → API Keys**) : note l'**URL du projet** (`https://xxxx.supabase.co`) et la clé **publishable** (ou **anon**).
   ⚠️ Ne copie jamais la clé **secret** / **service_role** : l'application la refuse.
4. **Authentication → URL Configuration** : mets l'adresse du site (ex. `https://paulo-3d.github.io/`) dans **Site URL** et dans **Redirect URLs**. Sans ça, les liens reçus par email (confirmation du compte, mot de passe oublié) ne ramènent pas vers l'application.
5. Crée le compte de l'atelier : soit depuis l'application (« Créer le compte », puis clique sur le lien reçu par email), soit dans **Authentication → Users → Add user** (coche « Auto Confirm User »).
6. Une fois le compte créé, ferme les inscriptions : **Authentication → Sign In / Providers → Allow new users to sign up** = désactivé.

> Le script peut être relancé sans rien perdre : c'est aussi comme ça qu'on applique une mise à jour de la base.

## 2. Mettre le site en ligne (GitHub Pages)

1. Crée une **organisation GitHub gratuite** (ex. `paulo-3d`) : l'adresse du site sera `https://paulo-3d.github.io/`.
2. Dans cette organisation, crée le dépôt `paulo-3d.github.io` et envoie-y ce dossier.
3. Dépôt → **Settings → Pages** → *Deploy from a branch* → branche `main`, dossier **`/docs`**.
4. Le site est en ligne au bout d'une minute environ.

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
- **Sauvegardes** : Paramètres → Données → **Exporter** (JSON complet ou CSV pour Excel). L'offre gratuite de Supabase ne fournit pas de sauvegarde restaurable : exporte régulièrement.
- **Projet en pause** : un projet Supabase gratuit inutilisé pendant plusieurs jours peut être mis en pause par Supabase. Il suffit de le relancer depuis le tableau de bord Supabase.
- **Sécurité** : chaque ligne de la base appartient à un compte ; sans connexion, rien n'est lisible (Row Level Security). La clé publique peut être visible sans risque, c'est prévu pour.

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

`npm test` lance près de 80 tests : le script SQL sur un vrai PostgreSQL local (sécurité, stock FIFO, pesées, rejeu sans doublon, suppressions qui ne reviennent pas), la parité entre les calculs de l'application et ceux de la base, la synchronisation (ordre des modifications, temps réel, session expirée, suppressions sur un autre appareil), le fonctionnement hors-ligne après une mise à jour, et les calculs de coûts, prix, graphiques et import slicer.

Tests de bout en bout sans toucher une vraie base : `node tools/dev-supabase.mjs` démarre une imitation locale de Supabase (PostgreSQL + PostgREST officiel + connexion), puis `node tools/build.mjs --dev` produit un site de test dans `.dev/site/`.
