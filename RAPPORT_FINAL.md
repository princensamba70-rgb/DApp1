> **Archive documentaire de la source App-partage1.** Ce rapport préexistait à cette livraison et ne décrit pas les tests exécutés ici. Voir [le rapport actuel](docs/QUALITE_INTELLIGENTE.md).

# Rapport de diagnostic et de correction — Survey Solutions

**Date :** 26 septembre 2026
**Branche :** `arena/01a0dc79-dapp1`
**État :** correction du parseur et tests logiciels réussis ; synchronisation sur le HQ réel non vérifiable dans cet environnement.

## Constat initial

Le checkout fourni par Arena (`princensamba70-rgb/DApp1`) ne contenait initialement qu’un `README.md`. Le dépôt demandé (`App-partage1`) contient une archive `survey-quality 3.zip` et non les sources à sa racine. J’ai analysé l’archive et intégré ses fichiers applicatifs dans le checkout courant afin de travailler sur l’application existante plutôt que de créer une application de démonstration distincte.

Aucun fichier `.env` n’était fourni ; `.env` est exclu du dépôt par conception. L’adresse du HQ, l’espace, le compte API et le mot de passe Survey Solutions réels ne sont donc pas disponibles ici.

## Cause identifiée

Le code qui émet `QUESTIONS_NON_DÉTECTÉES` est `extractStructure()` dans `backend/src/survey-solutions.service.ts`, appelé immédiatement après `GET /{workspace}/api/v1/questionnaires/{id}/{version}/document`. L’erreur n’est pas émise par la recherche des questionnaires ni par la base : elle signifie qu’un document a été récupéré mais qu’aucun nœud n’a satisfait les hypothèses du parseur.

Le parseur initial reposait sur plusieurs hypothèses rigides :

- présence exacte de `Children` à la racine et sur les nœuds ;
- présence de `PublicKey` ou `Id` sur chaque nœud avant même de parcourir ses enfants ; un conteneur intermédiaire sans identifiant faisait donc perdre tout son sous-arbre ;
- nom exact de `$type`, `VariableName`, `QuestionType`, `QuestionText`, `Answers` et des propriétés des options ;
- types principalement reconnus par la valeur numérique de `QuestionType` ou un nom de classe se terminant par `Question`.

Cela explique précisément **comment le code peut produire** `QUESTIONS_NON_DÉTECTÉES` malgré un document comportant des questions dans une structure enveloppée, camelCase ou comportant des conteneurs intermédiaires. En l’absence de réponse HTTP réelle du HQ cible, il n’est pas possible d’affirmer laquelle de ces variantes est celle de l’installation concernée. L’URL, l’authentification et les droits ne peuvent pas non plus être déclarés cause ou innocentés sans test contre ce serveur.

## Corrections

- Parseur récursif et limité en profondeur, insensible à la casse pour les propriétés usuelles ; prend en charge `Children`/`children`, des enveloppes (`Document`, `QuestionnaireDocument`, etc.), les conteneurs sans identifiant, les sections imbriquées et les rosters.
- Normalisation des champs de questions, options, conditions, bornes et types via `$type` **ou** `QuestionType` ; les variables et métadonnées restent ignorées comme questions.
- Erreur explicite conservée si aucune question ne peut réellement être identifiée : aucune synchronisation artificielle avec une liste vide.
- Variantes PascalCase/camelCase prises en charge également pour les listes de questionnaires, entretiens et réponses.
- Journaux `[survey-api]` et `[sync]` ajoutés : méthode, URL construite, statut HTTP, type de contenu, noms de champs et nombre d’éléments. Les mots de passe, en-têtes Authorization, cookies et jetons ne sont jamais journalisés.
- Routes de l’API et normalisation des URLs avec `/` final couvertes par les tests.

## Fichiers

**Fichiers modifiés pour cette correction :**

- `backend/src/survey-solutions.service.ts` — normalisation/parsing plus robuste, diagnostics HTTP et prise en charge des formes de réponse.
- `backend/src/survey-solutions.test.ts` — tests de structure officielle, enveloppes/casse alternative, rosters, options, bornes, URL et réponse vide.
- `backend/src/sync.ts` — journalisation non sensible du processus de synchronisation.
- `README.md` — documentation du parseur, de ses limites et des journaux.
- `RAPPORT_FINAL.md` — ce rapport.

**Sources applicatives importées de l’archive liée** (car absentes du checkout initial) : `.dockerignore`, `.env.example`, `.gitignore`, `backend/`, `database/`, `docker-compose.yml`, `frontend/`, `scripts/` et `tests/`.

## Tests réalisés dans cet environnement

| Test | Résultat |
| --- | --- |
| Tests backend `npm test` | **33/33 réussis** (dont appels API simulés et parsing) |
| Build backend `npm run build` | Réussi |
| Tests frontend `npm test` | **5/5 réussis** |
| Build frontend `npm run build` | Réussi |
| Réponse de questionnaire + document, endpoints, Basic Auth et URL à slash final | Test unitaire HTTP simulé réussi ; test supplémentaire par vraie requête réseau vers `tests/mock-survey.cjs` : compatibilité API `v1`, **1 questionnaire, 5 questions, 3 sections, 3 entretiens et 5 variables de réponse** détectés (données synthétiques) |
| Docker Compose / ports / PostgreSQL / frontend lancé | **Non exécutés : la commande `docker` n’est pas installée dans cet environnement** |
| API Survey Solutions réelle / credentials / questionnaires distants | **Non exécutés : URL et accès du HQ réel non fournis** |
| Enregistrement dans PostgreSQL réel, affichage frontend de données synchronisées et test après redémarrage Docker | **Non vérifiables ici** (aucun Docker ni PostgreSQL local disponible) |

Commandes effectivement exécutées :

```bash
cd backend
npm ci
ADMIN_PASSWORD='unit-test-password' USER1_PASSWORD='unit-test-password' SURVEY_ENCRYPTION_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' DATABASE_URL='postgres://unit:unit@127.0.0.1:5432/unit' npm test
ADMIN_PASSWORD='unit-test-password' USER1_PASSWORD='unit-test-password' SURVEY_ENCRYPTION_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' DATABASE_URL='postgres://unit:unit@127.0.0.1:5432/unit' npm run build

cd ../frontend
npm ci
npm test
npm run build

# Le serveur mock local a été lancé puis interrogé via le service TypeScript.
node tests/mock-survey.cjs
node --import tsx --input-type=module -e '… appels testConnection, listQuestionnaires, document, extractStructure, listInterviews, interviewAnswers …'
# Tentative Docker : docker compose up --build → docker: command not found.
```

Les variables de test ci-dessus étaient des valeurs jetables pour satisfaire la validation de configuration ; aucun mot de passe réel Survey Solutions n’a été utilisé. `npm ci` a signalé des vulnérabilités dans les dépendances (5 dans chaque arbre installé) ; elles ne font pas partie du correctif de synchronisation et n’ont pas été mises à jour automatiquement.

## Résultat et limites

- **Authentification réelle Survey Solutions :** non confirmée.
- **Questionnaires réels récupérés :** non confirmés (0 réponse du HQ réel observée dans cette session).
- **Questions réelles détectées et sauvegardées :** non confirmées.
- **Frontend avec données réelles / synchronisation répétée / redémarrage Docker :** non confirmés.
- **Tests automatisés de parsing et d’API simulée :** réussis.

Il serait trompeur d’affirmer une synchronisation réelle réussie ou de fournir un nombre positif de questionnaires/questions sans accès au serveur cible. Pour terminer la validation de bout en bout, configurer dans l’application l’URL racine HQ, le workspace et le compte **API User** (ne pas transmettre le mot de passe dans un échange), puis exécuter le test de connexion et une synchronisation. Si elle échoue toujours, les journaux sans secrets donneront désormais l’URL/route, le statut HTTP et les champs/tailles JSON ; une réponse expurgée de toute donnée personnelle permettra d’identifier la variante exacte du document.
