# DApp1 — SurveyQuality : contrôle qualité intelligent

Application existante de `App-partage1`, importée et améliorée sans remplacer son architecture React / Express / PostgreSQL.

**État de livraison, tests et limites : [docs/QUALITE_INTELLIGENTE.md](docs/QUALITE_INTELLIGENTE.md).**

## Nouveautés

- Moteur automatique réellement appelé après synchronisation Survey Solutions.
- Détection des types, contrôles contextuels, seuil strict configurable (5 par défaut), doublons et cohérences.
- Occurrences réelles, messages métier identiques dans l’interface et les exports CSV/Excel.
- Gravité, score par entretien, statistiques et graphiques de qualité.
- Configuration administrateur, import administratif JSON, cache d’analyse et migrations non destructives.
- Tests unitaires, intégration API/base, non-régression et validation navigateur.

**Important :** les données visibles dans l’environnement de validation sont synthétiques. La connexion à votre serveur Survey Solutions réel reste à valider. Les contrôles flous avancés, inter-formulaires et paradata ne sont pas présentés comme implémentés ; consulter les limites détaillées.

## Démarrage

Conserver la procédure Docker ci-dessous : copier `.env.example` en `.env`, remplacer les secrets localement, puis `docker compose up -d --build`. Ne jamais publier le fichier `.env`. Pour le développement, utiliser Node 22.12+ et une base PostgreSQL isolée ; les instructions de validation locale sont dans le rapport lié ci-dessus.

---

## Documentation de l’application source

Le contenu suivant décrit le socle d’origine. Pour le nouveau moteur et le périmètre testé dans cette livraison, le rapport ci-dessus fait référence.

# SurveyQuality — contrôle qualité Survey Solutions

Application web francophone de suivi des questionnaires, de contrôle des réponses et de production de rapports. Le projet comprend un frontend React/TypeScript, une API REST Express/TypeScript, PostgreSQL et un déploiement Docker Compose. Les appels Survey Solutions sont **exclusivement effectués par le backend**.

## Fonctionnalités

- Connexion par session, gestion des comptes et des rôles `admin` / `user`, changement et réinitialisation des mots de passe, journal d’activités.
- Configuration administrateur d’un serveur Survey Solutions : URL racine HQ, espace de travail et compte API. Le test vérifie **d’abord une route API authentifiée dans l’espace choisi** ; version et documentation Swagger sont consultées lorsqu’elles sont accessibles, avec avertissement distinct si elles ne le sont pas.
- Synchronisation manuelle et périodique des questionnaires et de leurs versions, sections, sous-sections, questions, options, contraintes et entretiens. Les questions sont **détectées automatiquement** depuis le document questionnaire, jamais créées par formulaire local. Import des réponses et occurrences de rosters ; synchronisation idempotente.
- Plusieurs règles par question : bornes, égalité, valeurs autorisées, présence, format, longueur, comparaison entre questions, cohérence conditionnelle explicite et doublons potentiels. Réanalyse lors de la modification des règles et après synchronisation.
- Tableaux de bord, tendances, résultats par contrôle, rapports filtrables par questionnaire, question, statut, type d’erreur, enquêteur, superviseur et dates. Exports CSV, XLSX et PDF des résultats, erreurs, statistiques, questionnaires, questions et règles.
- Interface responsive, navigation adaptée au rôle et contrôle des permissions **également côté backend**.

### Permissions

| Opération | Administrateur | Utilisateur |
| --- | :---: | :---: |
| Tableau de bord, questionnaires/questions, qualité, rapports, activité, exports, profil | Oui | Oui |
| Connexion Survey Solutions, test et synchronisation | Oui | Non |
| Création, modification et suppression de règles | Oui | Non |
| Gestion des utilisateurs | Oui | Non |

## Démarrage avec Docker Compose

**Prérequis :** Docker et son plugin Compose. Seul le frontend est publié sur le port `APP_PORT` (8080 par défaut) ; l’API et PostgreSQL restent sur le réseau Docker interne.

1. Dans le répertoire du projet :

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

2. Modifier `.env` en privé : définir des mots de passe **propres à l’installation** pour PostgreSQL et les comptes initiaux, et une clé `SURVEY_ENCRYPTION_KEY` constituée de **32 octets encodés en base64** (`openssl rand -base64 32`). Ne pas partager ce fichier, ne pas enregistrer ses valeurs dans le dépôt et ne pas réutiliser les secrets de développement en production. Les comptes `admin` et `user1` sont initialisés avec les valeurs `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `USER1_USERNAME`, `USER1_PASSWORD` **uniquement lors de la création de la base** ; changer ensuite leur mot de passe via l’interface ne sera pas annulé par un redémarrage. Le `.env` local de démonstration est ignoré par Git.

3. Vérifier la configuration **sans afficher les secrets**, puis démarrer :

   ```bash
   node scripts/diagnose.mjs
   docker compose config --quiet
   docker compose build
   docker compose up -d --wait
   docker compose ps
   curl -f http://localhost:8080/health
   ```

   Le backend utilise des paramètres PostgreSQL séparés plutôt qu’une URL assemblée : les caractères spéciaux du mot de passe ne cassent donc plus la connexion. Si votre mot de passe contient `$` ou `#`, protégez-le également de l’interpolation du fichier `.env` (par exemple avec des guillemets simples conformément à la syntaxe Compose).

4. Ouvrir `http://localhost:8080`, se connecter avec l’un des comptes initialisés, puis, en tant qu’administrateur, aller dans **Paramètres → Connexion Survey Solutions**. Saisir **l’adresse racine du HQ**, sans `/api` ni nom d’espace à la fin ; renseigner séparément le nom exact de l’espace (par exemple `sankurusaco`) et le compte de rôle **API User** autorisé dans cet espace. Pour un serveur `http://` privé, lire l’avertissement et cocher **l’autorisation HTTP explicite** avant de tester puis d’enregistrer. Le test envoie la requête depuis le backend vers l’API de l’espace choisi. Les secrets ne sont ni réaffichés dans le formulaire, ni renvoyés dans les erreurs. La page de connexion ne préremplit aucun mot de passe.

   **Diagnostic en cas d’échec :** HTTP **401** = authentification API refusée ou en-tête `Authorization` non transmis par un proxy ; HTTP **403** = accès à la ressource ou à l’espace refusé, à vérifier auprès de l’administrateur du HQ ; HTTP **404** = adresse de base, espace ou route API à vérifier ; **redirection** = utiliser directement l’adresse finale, souvent HTTPS. Une page de connexion ou un Swagger privé n’invalident plus un accès API réellement réussi ; un avertissement indique alors que la version ou la compatibilité complète reste à confirmer. Si l’adresse contient `localhost` ou `127.0.0.1`, rappelez-vous qu’elle désigne le conteneur backend depuis Docker, pas nécessairement le serveur HQ. Ne transmettez jamais votre mot de passe dans une demande d’assistance.

Pour suivre les journaux : `docker compose logs --tail=100 backend frontend postgres`. Pour arrêter **sans effacer les données** : `docker compose down`. Le volume nommé `postgres_data` demeure. **Ne jamais utiliser `down -v` sur une base contenant des données à conserver** : cette option détruit le volume.

### Si Compose indique « backend is unhealthy »

Le résumé Compose ne précise pas la cause. Exécuter depuis la racine du projet :

```bash
node scripts/diagnose.mjs
docker compose ps -a
docker compose logs --no-color --tail=100 backend postgres
```

Les journaux de démarrage affichent désormais un **code et une indication sans dévoiler les secrets** :

- `CONFIG_INVALIDE`, `CONFIG_COMPTES` ou `CONFIG_CLE` : `.env` absent, valeurs fictives, mots de passe trop courts ou clé de chiffrement invalide. Corriger les variables indiquées, puis relancer `docker compose up -d --build`. Ne pas envoyer `.env` à une autre personne.
- `PG_AUTH` : PostgreSQL refuse la connexion. **Un volume existant garde son ancien mot de passe** : changer `POSTGRES_PASSWORD` dans `.env` ne change pas automatiquement le mot de passe du rôle en base. Le plus simple est de remettre la valeur précédente dans `.env`. Pour une rotation voulue, si le nom du rôle est resté inchangé et si vous avez les droits PostgreSQL, ouvrez `docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres'`, lancez `\password` **dans psql** pour saisir le nouveau secret sans l’afficher, puis `\q` et redémarrez le backend. Cette opération ne doit pas être automatisée aveuglément. **Ne pas effacer le volume** pour régler ce problème.
- `PG_UTILISATEUR` / `PG_BASE` : les noms du rôle ou de la base ont été changés alors que `postgres_data` existait déjà ; les noms initiaux restent en base. Restaurer les anciens paramètres ou migrer explicitement.
- `PG_SCHEMA` : vérifier les droits du propriétaire PostgreSQL et la migration SQL ; sauvegarder avant toute intervention. `PG_RESEAU` / `PG_INDISPONIBLE` : vérifier le réseau, la disponibilité et les journaux PostgreSQL.

`pg_isready` peut déclarer PostgreSQL *healthy* sans vérifier que le mot de passe du backend est accepté. **Ne partagez que les codes et lignes de diagnostic, jamais des mots de passe ni la sortie complète de `.env`.**

### Configuration d’environnement

Voir `.env.example` pour toutes les variables. Principales précautions :

- `SURVEY_ALLOW_HTTP=false` est la valeur globale recommandée. Pour un HQ privé uniquement disponible en HTTP, **l’administrateur peut autoriser explicitement HTTP pour cette connexion dans le formulaire** : ce choix est enregistré et réutilisé par la synchronisation. La valeur globale `true` demeure un mécanisme hérité pour les configurations de test anciennes ; ne l’activez pas par défaut. **HTTP n’assure aucune confidentialité des identifiants en transit : préférez HTTPS**, y compris pour l’accès à cette application.
- `SESSION_COOKIE_SECURE=true` seulement une fois le site servi en HTTPS par un reverse proxy TLS. Le paramètre vaut `false` pour le test local en HTTP ; **activer HTTPS en production** et limiter l’accès au port public.
- `SYNC_INTERVAL_MINUTES=60` détermine la périodicité de la synchronisation. Celle-ci peut également être lancée manuellement ; une configuration sauvegardée programme une première synchronisation différée.
- Conserver la clé AES en lieu sûr et dans les sauvegardes sécurisées : la changer sans réchiffrer les identifiants API enregistrés rend ceux-ci illisibles. Après rotation non migrée, renseigner à nouveau le compte API via l’interface.

## Intégration Survey Solutions

Toute l’intégration distante est isolée dans `backend/src/survey-solutions.service.ts`. Le test contacte **d’abord** `/{workspace}/api/v1/questionnaires` avec le compte API : seul cet appel confirme l’accès effectif à l’espace demandé. La page de connexion et `/swagger/v1/swagger.json` sont ensuite consultés **sans identifiants**, uniquement pour déterminer la version et vérifier les routes publiées. S’ils ne sont pas accessibles, le test peut réussir avec un avertissement de compatibilité non vérifiée ; si le Swagger accessible ne publie pas les routes nécessaires, la synchronisation est bloquée avec un diagnostic de version. Les appels exploités sont `GET /api/v1/questionnaires`, `GET /api/v1/questionnaires/{id}/{version}/document`, `GET /api/v1/interviews` et `GET /api/v1/interviews/{id}`, avec workspace et pagination. Les identifiants API restent côté serveur ; les redirections ne sont pas suivies avec l’en-tête d’authentification. Les identifiants enregistrés sont chiffrés en base par AES-256-GCM. Le parseur de document questionnaire accepte les champs JSON PascalCase/camelCase, quelques enveloppes de réponse (`Document`, `QuestionnaireDocument`, etc.) et parcourt récursivement les sections et rosters ; un conteneur intermédiaire sans identifiant ne coupe plus la détection. Si aucun nœud question n’est reconnu, le code conserve une erreur explicite au lieu de synchroniser une liste vide. Les journaux `[survey-api]` et `[sync]` indiquent les URL/méthodes, statuts HTTP, clés JSON et nombres d’éléments sans journaliser les identifiants, mots de passe, jetons ou cookies.

Les données de superviseur, parfois absentes des listes REST, sont enrichies **facultativement** via `/graphql` si le schéma de l’instance fournit les champs correspondants. En cas d’indisponibilité ou d’incompatibilité GraphQL, les données REST sont conservées ; un filtre superviseur ne peut pas être exhaustif sans cette information. La disponibilité de ces champs et la compatibilité exacte **doivent être validées contre votre instance Survey Solutions**, notamment sa documentation intégrée `/apidocs/index.html` : https://docs.mysurvey.solutions/headquarters/api/survey-solutions-api/ . Le simulateur inclus reproduit un jeu de réponses basé sur le Swagger public de la démonstration 26.09 (build 41860) ; il ne remplace pas une instance cible.

**Limite intentionnelle :** les conditions Survey Solutions sont des expressions dont la sémantique complète n’est pas exécutée localement. Une valeur absente sur une question conditionnelle ou dans un roster peut être classée `NON CONTRÔLÉ` plutôt que signalée à tort ; les règles explicites de cohérence configurées dans l’application restent évaluées. Les bornes détectées automatiquement correspondent uniquement aux contraintes simples reconnues ; d’autres expressions sont conservées dans le document importé sans être présentées comme des bornes vérifiées.

## API REST (principales routes)

Toutes les routes `/api` sauf la connexion exigent une session. Le frontend utilise les mêmes chemins via Nginx, sans adresse de backend codée dans le navigateur.

| Méthode et chemin | Usage | Rôle |
| --- | --- | --- |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `PUT /api/auth/password` | Session et profil | Selon la route |
| `GET/POST /api/users`, `PUT/DELETE /api/users/:id`, `PUT /api/users/:id/password` | Comptes et réinitialisation | Admin |
| `GET/PUT /api/settings/survey-solutions`, `POST /api/settings/survey-solutions/test` | Connexion HQ | Admin |
| `POST /api/sync`, `GET /api/sync/logs` | Synchronisation et suivi | Admin |
| `GET /api/questionnaires`, `GET /api/questionnaires/:id`, `GET /api/questions` | Structure et versions | Authentifié |
| `GET/POST /api/quality-rules`, `PUT/DELETE /api/quality-rules/:id` | Lecture pour tous ; mutations admin | Selon la méthode |
| `GET /api/dashboard`, `GET /api/quality-results`, `GET /api/errors`, `GET /api/reports`, `GET /api/reports/statistics` | Analyse et rapports | Authentifié |
| `GET /api/exports/:resource?format=csv\|xlsx\|pdf`, `GET /api/activity` | Exports et activité | Authentifié |
| `GET /health` | État API + base | Public |

Schéma SQL idempotent : `database/schema.sql`. Il est appliqué au démarrage du backend, sans suppression des données existantes ; l’ajout de l’autorisation HTTP par connexion inclut un `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pour les bases préexistantes. Les migrations complexes d’une future version du schéma demanderont un outil de migration dédié et des sauvegardes préalables.

## Tests et simulateur

Pour les tests unitaires, Node.js 20+ et `npm` sont nécessaires :

```bash
cd backend
npm ci
DOTENV_CONFIG_PATH=../.env DATABASE_URL=postgres://unit:unit@127.0.0.1:5432/unit npm test
npm run build
cd ../frontend
npm ci
npm test
npm run build
```

Ces tests de logique backend ne se connectent pas à la base, mais sa variable d’environnement est nécessaire à la validation de la configuration. Le projet comprend également `npm audit --omit=dev` dans chaque dossier pour l’audit des dépendances de production.

Le simulateur HQ est activé **uniquement** sous le profil Compose `test`. Les tests d’intégration utilisent le port 8080 et la commande `docker compose` depuis la racine. **Ils présupposent une base de test vierge, configurent le faux HQ et créent des comptes et règles : ne pas les lancer sur une installation réelle.** Sur une instance de test jetable exclusivement :

```bash
# ATTENTION : efface le volume de la base de test !
docker compose --profile test down -v
docker compose --profile test up -d --build --wait
node tests/integration.mjs before
# Conserver expressément le volume pour vérifier la persistance :
docker compose --profile test down
docker compose --profile test up -d --wait
node tests/integration.mjs after
```

`tests/integration-state.json` est un état transitoire ignoré par Git, sans mot de passe. Sur un système où le socket Docker exige des droits élevés, préfixer les commandes Docker par `sudo` ; le script essaie automatiquement l’accès direct, puis `sudo -n` (droits sudo non interactifs requis) pour ses vérifications SQL. Ne pas exposer le simulateur au public. Si une installation destinée à une instance réelle a été testée avec le simulateur, retirer le profil de test et réenregistrer la véritable configuration HQ **avant** toute nouvelle synchronisation.

## Organisation et sécurité

- `backend/src/` : API, autorisation serveur, sessions à jeton haché, chiffrement des secrets, synchronisation, moteur qualité, exports et audit.
- `frontend/src/` : application React/TypeScript, pages, graphiques et présentation responsive ; chargement différé des pages pour éviter de charger les graphiques sur la page de connexion.
- `database/schema.sql` : tables, contraintes, index, relations et statut des contrôles.
- `tests/` : serveur HQ simulé et parcours d’intégration avant/après redémarrage.
- `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml` : conteneurisation et volume PostgreSQL persistant.

Les mots de passe utilisateurs sont hachés avec bcrypt et ne figurent pas dans les réponses API. La connexion est limitée en fréquence ; les cookies de session sont `HttpOnly` et `SameSite=Strict`, une vérification d’origine est appliquée aux méthodes de modification. Le journal d’activité conserve les actions, pas les mots de passe. Les réponses d’enquête peuvent contenir des données personnelles : protéger la base, restreindre les accès aux exports, chiffrer les sauvegardes et définir une politique de conservation appropriée.

Le bilan détaillé des vérifications et limites est dans [RAPPORT_FINAL.md](RAPPORT_FINAL.md).
