# Moteur qualité — livraison et validation du 26 septembre 2026

## Provenance et architecture examinée

Le dépôt DApp1 initial (`5645336`) ne contenait qu’un README. L’application a été récupérée depuis l’archive `survey-quality-corrige 2.zip` du dépôt `princensamba70-rgb/App-partage1`, commit `46c8c235f1a93aa247242684ec82a6ee9afd964f`.

SHA-256 de l’archive : `62d301e07472fe76f1b004967143e8b37c35ae3f1e742a67f8783b13dbea4a11`.

Ce travail **étend cette application**, sans créer une application parallèle :

- React / TypeScript / Vite, routes et composants existants ; React Router et Recharts.
- Express / TypeScript, sessions HTTP-only en PostgreSQL, rôles admin/user, contrôle d’origine et limitation des tentatives de connexion.
- PostgreSQL : questionnaires, versions, sections, questions, réponses, règles, résultats, journal d’activité et synchronisations.
- Adaptateur Survey Solutions : API REST paginée, documents, réponses et vecteurs de roster ; enrichissement GraphQL du superviseur lorsqu’il est disponible ; authentification et workspace existants conservés.
- Secrets Survey Solutions chiffrés AES-256-GCM ; mots de passe locaux bcrypt ; exports ExcelJS / CSV / PDF.

## Ce qui fonctionne dans cette livraison

### Analyse réelle après synchronisation

`sync.ts → reanalyzeVersion() → analyze()` : les mêmes réponses récupérées via l’API sont analysées et les résultats sont enregistrés dans PostgreSQL. Aucun résultat fictif n’est injecté dans l’interface.

1. Structure, libellés, choix, contraintes simples, caractère entier et obligation explicite des métadonnées sont conservés.
2. Classification sémantique par variable/libellé, métadonnées, puis échantillon pour un type inconnu. Les variables reconnues incluent âge, téléphone, village, aire, zone, identifiant, nom, montant, quantité, GPS, naissance et horaires.
3. Formats, plages, choix autorisés, obligations explicites, répétitions de villages, doublons, cohérence administrative, âge/naissance, dates début/fin, durée, valeurs aberrantes IQR, volume quotidien par enquêteur et composition du ménage.
4. Toutes les règles manuelles existantes restent disponibles : bornes, égalité, différence, listes, obligation, format, longueur, comparaison, cohérence conditionnelle et doublons multichamps.
5. Résultats, contexte, gravité, occurrences, entretiens associés et score sont persistés.

### Seuil strict et contexte

Le maximum par défaut est **5**. Une anomalie de répétition est produite exclusivement pour `nombre observé > maximum`. Le regroupement est limité à une version de questionnaire et à `(village, aire, zone)` après normalisation de la casse et des accents.

La colonne **Occurrence** contient le nombre observé, jamais le paramètre. Une ligne est enregistrée pour **chaque entretien concerné**. Un groupe de 9 entretiens produit donc 9 lignes, chacune portant l’occurrence 9. Les statistiques de villages dépassant le seuil comptent les groupes administratifs distincts, pas les lignes.

### Messages et exports

Le moteur écrit directement le constat métier dans `error_type` et `details`. Le tableau et les exports réutilisent ces champs sans générer un deuxième message divergent. Les réponses `/reports`, `/errors`, `/dashboard` et les exports de résultats ne contiennent plus `rule_type` ni `rule_params`.

Les exports de **configuration des règles**, séparés des exports d’anomalies, sont réservés aux administrateurs. Les formules Excel/CSV sont neutralisées. Les cellules numériques Excel, dont les occurrences et scores, restent numériques. Limite de sécurité existante : 5 000 lignes par export ; affiner les filtres au-delà.

### Doublons : prudence obligatoire

- **Exact** : même identifiant métier de ménage, dans la même localisation et version ; tous les entretiens concernés sont signalés. C’est une collision d’identifiant, pas une preuve de fraude. Vérifier que cet identifiant est censé être unique dans ce périmètre.
- **Probable** : blocage par téléphone, puis au moins le nombre configuré de champs concordants parmi nom, téléphone, village, aire, zone et identifiant.
- **Potentiel** : téléphone partagé avec preuves insuffisantes. Un numéro communautaire n’est jamais considéré comme une confirmation.
- Le village seul ne suffit jamais à déclarer un doublon.
- Les groupes sont comparés à un représentant, sans comparaison exhaustive quadratique. Pour les groupes exacts très importants, la liste associée est limitée aux 50 premiers identifiants ; le nombre observé reste complet.

### Applicabilité, absence de données et relations

- Les expressions C# Survey Solutions ne sont **jamais exécutées**.
- Les obligations conditionnelles et les rosters non instanciés ne sont pas supposés applicables ; cela évite les faux positifs.
- Les obligations inconditionnelles proviennent d’un indicateur explicite de métadonnées ou d’une configuration administrateur.
- Les règles manuelles de cohérence permettent de définir une obligation liée à la réponse d’une autre question, notamment un code de sexe validé par l’administrateur.
- La cohérence âge/naissance utilise une vraie variable début/fin de collecte, pas la date de modification ni la date du serveur. Une tolérance d’un an est appliquée.
- Si plusieurs variables pourraient représenter un même rôle, la relation automatique n’est pas choisie arbitrairement : corriger les types dans les paramètres.
- La composition ménage/membres requiert le nom explicite d’une variable de roster identifiant chaque membre. Seuls des vecteurs de profondeur 1 sont comptés ; les rosters imbriqués restent hors de ce contrôle.
- Un référentiel peut contenir plusieurs associations pour un village homonyme. Un village absent du référentiel ne devient pas automatiquement une incohérence.

### Administration

Page **Paramètres → Moteur automatique** : maximum d’occurrences, durées minimale/maximale, volume quotidien, facteur et échantillon IQR, concordances de doublons, activation/désactivation des familles de contrôle, gravité par famille, corrections de types, variables obligatoires, variable du roster des membres, import administratif JSON.

Exemple de fichier administratif (données fictives) :

```json
[
  {"village":"Kimbangu","healthArea":"Kimputu","healthZone":"Zone 1"}
]
```

L’import est validé avant enregistrement ; le fichier n’est pas une commande et aucune expression n’est exécutée. Limite actuelle de l’import UI : 120 Ko, requête complète : 128 Ko. Les paramètres et les résultats sont réenregistrés dans une transaction : pas de nouveau paramétrage exposé avec d’anciens résultats après une erreur.

### Score et statistiques

Score = `max(0, 100 − somme des pénalités)` : critique 35, majeure 15, modérée 5, mineure 2. Les règles manuelles ont actuellement la gravité modérée par défaut. Ce score explicable est un indicateur de supervision, pas une probabilité ni une certification. Les règles manuelles explicites de format, plage, obligation ou choix prennent priorité sur l’anomalie automatique de même famille afin de ne pas compter deux fois le même constat.

Classes : 95–100 Excellent ; 90–94 Bon ; 75–89 À surveiller ; 50–74 Qualité faible ; <50 Qualité critique. Un entretien sans contrôle applicable reste **Non évalué**, sans score fictif de 100 %.

La section dédiée affiche effectifs, conformité, gravités, doublons, villages au-dessus du seuil, enquêteurs concernés, score moyen et taux de données manquantes. Graphiques : types, enquêteurs, villages, aires, zones, questions, dates de modification et scores moyens par date de modification.

Le taux de données manquantes porte sur les questions de premier niveau sans condition connue, y compris les questions optionnelles. Il ne doit pas être interprété comme un taux de violations d’obligation. Les séries temporelles décrivent les résultats actuels regroupés par date de modification : ce ne sont pas des instantanés historiques du score.

## Performance et limites de volume

- Index par réponse, question, statut, gravité et version.
- Résultats persistés : aucun recalcul au chargement du tableau de bord.
- Empreinte SHA-256 sur données, structure, règles, paramètres et version du moteur : une synchronisation identique conserve résultats et dates d’analyse.
- Lorsqu’une version change, **réanalyse de cette version entière** : les seuils, doublons et distributions peuvent modifier les anomalies des anciens entretiens.
- Insertion des constats automatiques par lots de 500, regroupements indexés en mémoire, verrouillage transactionnel commun aux éditions et synchronisations.
- Le moteur pur est testé sur 10 000 entretiens. Cela ne constitue pas un benchmark de synchronisation de millions d’entretiens.
- L’adaptateur conserve le téléchargement complet des réponses par lots réseau de 4. Les données d’une version restent chargées en mémoire ; le remplacement par streaming/queue de tâches et le recalcul réellement différentiel sont des évolutions restantes.

## Limites fonctionnelles — ne pas confondre avec des fonctions livrées

Le cahier des charges complet n’est **pas intégralement couvert**. Restent notamment :

- rapprochement flou de noms et GPS avec score de similarité calibré ; le niveau potentiel actuel est basé sur le téléphone partagé, pas un modèle général de résolution d’identité ;
- comparaison entre formulaires distincts et versions : nécessite un mapping validé des identifiants et concepts ; aucune fusion implicite n’est faite ;
- analyse des paradata/journaux pour récupérer les vrais horaires lorsque ceux-ci ne sont pas des réponses exportées ; horaires inhabituels et séries de durées quasi identiques ;
- analyse générale des séquences de réponses, répétitions suspectes hors villages/téléphones et modèles de charge par enquêteur ;
- moteur universel de conditions C#, résolution automatique des rosters imbriqués et inférence des règles de sexe sans convention explicite ;
- historique daté des scores, queue asynchrone durable et traitement de très grands volumes ;
- import administratif CSV/Excel (JSON est livré), interface de réglage de la gravité individuelle des règles manuelles et traitement métier des corrections/confirmations de doublons.

L’API **réelle de votre serveur HQ n’a pas été testée** : aucune adresse ni autorisation de ce serveur n’était disponible. Le test bout en bout utilise le vrai adaptateur HTTP avec un serveur HQ simulé. Avant production : valider les chemins et payloads de votre version Survey Solutions, les métadonnées d’obligation, les variables de référence, le périmètre d’unicité des identifiants et les seuils avec vos responsables d’enquête.

## Validation exécutée

Environnement : Node 22, PostgreSQL 18 local isolé ; application conservant son déploiement Docker/PostgreSQL 16. Docker n’était pas disponible ici : aucune réussite de build Docker n’est revendiquée.

- Compilation TypeScript backend et build frontend réussis.
- Tests backend : **53** (dont 20 scénarios du nouveau moteur).
- Tests frontend : **6** (dont tableau des anomalies).
- `tests/intelligence-integration.mjs` : **38 assertions** sur synchronisation, seuils, doublons, obligation issue des métadonnées, téléphone, contradiction, scores, statistiques, exports identiques et cache.
- `tests/integration.mjs before` : **65 assertions** de non-régression (authentification, comptes, autorisations, API, règles manuelles, rapports, filtres, exports, chiffrement et base).
- Redémarrage réel du backend puis `tests/integration.mjs after` : **11 assertions** de persistance.
- Chromium : connexion, chargement du tableau de bord, rapport filtré, enregistrement/réanalyse des paramètres, affichage du rapport en largeur mobile ; aucune erreur JavaScript capturée.
- Dépendances de test vulnérables de l’archive mises à jour vers Vitest 4.1.11 ; `npm audit` backend/frontend : aucune vulnérabilité signalée à la date du contrôle.

Jeu de validation : 34 entretiens fictifs, villages A=5, B=6, C=9, D=14. Résultat attendu et observé : **34 lignes d’anomalies** (29 répétitions de village + 2 collisions d’identifiant + 1 obligation vide + 1 téléphone + 1 contradiction âge/naissance). La limite quotidienne est fixée à 100 pour isoler ces tests. À un seuil de 9, seuls les 14 entretiens du village D restent signalés pour répétition.

## Reproduire

```bash
cd backend && npm ci && npm run build && npm test
cd ../frontend && npm ci && npm run build && npm test
```

Les tests backend chargent la configuration : utiliser un `.env` de test non suivi, avec une URL de base isolée, des mots de passe locaux et une clé AES valides. Ne pas utiliser les données de production pour ces scripts.

Pour le test intelligent : démarrer PostgreSQL isolé, le backend (`cd backend && npm run dev`), le frontend (`cd frontend && npm run dev`) et `QUALITY_FIXTURES=1 node tests/mock-survey.cjs`, puis `node tests/intelligence-integration.mjs` à la racine. Ce script lit `backend/.env` et configure le backend vers le mock local. Ne pas le lancer sur une base métier.

Pour la non-régression sans Docker : `ENV_FILE=backend/.env.legacy BASE_URL=http://127.0.0.1:3002 MOCK_BASE=http://127.0.0.1:8100 LOCAL_DB=1 node tests/integration.mjs before`, avec une seconde base isolée et `MOCK_PORT=8100 node tests/mock-survey.cjs`. Redémarrer ce backend, puis relancer avec `after`. Le mode Compose d’origine reste disponible.

## Publication et secrets

Seuls code source, schéma idempotent, documentation et fixtures synthétiques sont publiés. Aucun `.env`, mot de passe réel, token, clé de chiffrement, export métier, archive de base ou `node_modules` n’est ajouté à Git. Le dépôt conserve les commandes de lancement Docker dans le README d’origine. Sauvegarder la base et la clé de chiffrement avant toute mise en production ; les comptes initiaux ne sont pas réinitialisés à chaque démarrage.
