# 🎯 Bingo de la pré-rentrée

Un bingo collaboratif pour survivre à la réunion de pré-rentrée, avec les collègues.

Une grille de phrases (« Le vidéoprojecteur refuse de s'allumer », « On cherche
un volontaire… silence total »). Dès que ça arrive pour de vrai, chacun touche
sa propre case pour la cocher sur SA grille — exactement comme un vrai carton
de loto. On voit en direct l'avancée des collègues, et tout le monde voit les
confettis quand quelqu'un fait une ligne.

<!-- Capture : ajoute ici une image de la grille si tu en veux une dans le README -->

## Ce qu'il y a dedans

- **86 phrases** prêtes à l'emploi, tirées au sort à chaque nouvelle grille
- **Un vrai loto** : tout le monde a le même fond de phrases, mais chacun les voit rangées différemment sur sa grille — comme des cartons de loto
- **Chacun coche sa propre grille**, à son propre rythme, et peut se corriger en re-touchant une case : personne ne peut cocher ou décocher celle d'un collègue. Le but reste de faire une ligne sur SA grille, pas d'être le premier à cliquer
- **« Qui avance ? »** : un tableau en direct montre la progression de chaque collègue connecté — qui s'approche du bingo, qui l'a déjà fait
- **Synchronisation temps réel** entre tous les téléphones et ordinateurs connectés
- **Journal en direct** de ce qui vient de se passer
- **Cases modifiables** : écris vos propres phrases maison, elles se propagent à tout le monde
- **Salles séparées** : `?salle=college-jean-moulin` — chaque établissement sa grille
- **Détection des bingos** (lignes, colonnes, diagonales) et du carton plein
- Grilles 3×3, 4×4 ou 5×5, mode sombre, pensé pour le téléphone
- Aucune étape de compilation : c'est un site statique, du HTML et du JavaScript

## 1. L'essayer tout de suite

Ouvre `index.html` dans un navigateur — ou, mieux, sers le dossier :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

Sans base de données, l'app démarre en **mode local** : la grille fonctionne,
mais elle reste sur ton appareil. C'est parfait pour choisir les phrases avant
le jour J.

## 2. Le mettre en ligne (gratuit)

Le plus simple : **GitHub Pages**.

1. Dans ce dépôt sur GitHub : **Settings → Pages**
2. *Source* : « Deploy from a branch », branche `main`, dossier `/ (root)`
3. Attends une minute : le site est sur `https://<ton-pseudo>.github.io/bingo/`

C'est cette adresse que tu enverras aux collègues.

## 3. Le rendre collaboratif — ce qu'il faut

C'est la seule étape qui demande un compte quelque part. Il faut une **base de
données temps réel** : un endroit commun où l'app écrit « la case 7 vient d'être
cochée » et d'où les autres le reçoivent aussitôt.

Je recommande **Firebase Realtime Database** (Google) : gratuit à cette échelle,
pas de serveur à installer, et le temps réel est natif.

### Les étapes, une par une

1. Va sur [console.firebase.google.com](https://console.firebase.google.com) et
   connecte-toi avec un compte Google.
2. **Créer un projet** → nomme-le `bingo-prerentree` → tu peux refuser Google Analytics.
3. Dans le menu de gauche : **Créer** → **Realtime Database** → **Créer une base de données**.
   - Choisis un emplacement en Europe (`europe-west1`).
   - Démarre en **mode verrouillé** (on met les bonnes règles à l'étape 5).
4. Menu **Créer → Authentication** → **Commencer** → onglet **Sign-in method** →
   active le fournisseur **Anonyme**.
   *(Cette étape est obligatoire : sans elle l'app affichera une erreur explicite.)*
5. Retourne dans **Realtime Database → onglet Règles**, remplace tout par le
   contenu du fichier [`firebase.rules.json`](firebase.rules.json), puis **Publier**.
6. Menu **Paramètres du projet** (roue dentée) → descends jusqu'à **Vos applications** →
   clique sur l'icône **`</>`** (Web) → donne un nom → **Enregistrer l'application**.
   Firebase affiche alors un bloc `firebaseConfig` :

   ```js
   const firebaseConfig = {
     apiKey: "AIza…",
     authDomain: "bingo-prerentree.firebaseapp.com",
     databaseURL: "https://bingo-prerentree-default-rtdb.europe-west1.firebasedatabase.app",
     projectId: "bingo-prerentree",
     appId: "1:123…:web:abc…"
   };
   ```

   ⚠️ Vérifie que `databaseURL` est bien là. Si elle manque, c'est que la base de
   l'étape 3 n'a pas été créée — reprends-la.

7. Recopie ces valeurs dans [`src/config.js`](src/config.js), puis pousse sur GitHub.
   Le site déployé est maintenant synchronisé.

> **Pas envie de toucher au code ?** Ouvre le site, clique sur ⚙️ →
> « Connexion à la base de données », colle le bloc `firebaseConfig` tel quel et
> valide. Ensuite le bouton **🔗 Inviter** génère un lien qui contient la
> configuration : les collègues qui l'ouvrent sont connectés automatiquement.
> C'est plus rapide, mais il faut que chacun passe par ce lien-là.

### Ces clés, c'est un secret ?

Non. Une configuration Firebase web est **publique par nature** — elle part dans
le navigateur de chaque visiteur, il n'y a aucun moyen de la cacher. Ce qui
protège la base, ce sont les **règles de sécurité** (étape 5) : elles limitent
l'écriture à `rooms/`, imposent une connexion anonyme et bornent la taille des
textes. C'est le modèle de sécurité prévu par Firebase.

### Combien ça coûte ?

Rien. Le plan gratuit (« Spark ») de la Realtime Database couvre 100 connexions
simultanées, 1 Go stocké et 10 Go de trafic par mois. Un bingo pour une salle des
profs pèse quelques kilo-octets. Aucune carte bancaire n'est demandée.

### Si tu préfères autre chose

L'app isole toute la synchronisation dans [`src/sync/`](src/sync/), avec une
interface volontairement minuscule (`ensureRoom`, `setCell`, `setCellText`,
`newGame`, `resetCells`, `setPresence`, `pushEvent`). Écrire un
`src/sync/supabase.js` sur le même modèle et le brancher dans
`src/sync/index.js` suffirait à basculer sur **Supabase** (Postgres + Realtime,
gratuit lui aussi) — c'est le bon choix si tu veux du SQL. Firebase reste le
chemin le plus court pour un usage ponctuel comme celui-là.

## 4. Personnaliser les phrases

Deux façons :

- **Dans l'app** : bouton **✏️ Modifier**, touche une case, réécris-la. Le
  changement part chez tout le monde. Idéal pour glisser les private jokes de
  l'établissement la veille au soir.
- **Dans le code** : édite [`src/phrases.js`](src/phrases.js). Plus il y a de
  phrases, plus les grilles successives sont variées. Garde-les courtes : elles
  doivent tenir en deux ou trois lignes dans une case.

## 5. Le jour J

1. Envoie le lien (bouton **🔗 Inviter**) dans le groupe des collègues.
2. Chacun entre son prénom en arrivant.
3. Une personne clique une fois sur **🎲 Nouvelle grille** pour repartir propre.
4. Et on coche. La case centrale est offerte.

Petit conseil : sur téléphone, une grille **4×4** se lit beaucoup mieux qu'une
5×5. Ça se change dans ⚙️.

## Comment c'est fait

```
index.html              structure de la page
assets/styles.css       styles (clair / sombre, responsive)
src/app.js              interface, interactions, détection des bingos
src/grid.js             tirage de la grille (déterministe) et lignes gagnantes
src/phrases.js          la banque de 86 phrases
src/config.js           ← la configuration Firebase va ici
src/sync/index.js       choisit le moteur de synchro selon la configuration
src/sync/firebase.js    moteur temps réel (Realtime Database)
src/sync/local.js       moteur de secours (localStorage + onglets)
firebase.rules.json     règles de sécurité à coller dans la console Firebase
```

Le SDK Firebase est chargé à la demande depuis le CDN Google : pas de
`npm install`, pas de build, le dépôt se déploie tel quel.

### Le modèle de données

```
rooms/<salle>/
  meta      { size, seed, freeCell, createdAt }   ← le fond de phrases, partagé
  layout    [ "phrase 0", "phrase 1", … ]         ← le texte des cases, partagé
  checks    { <client>: { "7": { at } } }         ← les cases cochées, PAR PERSONNE
  presence  { <client>: { name, color, ts } }     ← qui est là (nettoyé à la déconnexion)
  events    { <clé>: { type, name, text, at } }
```

La grille (`meta` + `layout`) est créée par transaction : si deux personnes
ouvrent la salle en même temps, une seule est tirée et tout le monde a le même
fond de phrases.

Chaque participant ne voit ni ne modifie jamais que sa propre entrée sous
`checks/<son identifiant>` : c'est ce qui rend chaque grille indépendante.
L'ordre d'affichage (quelle case du fond commun tombe à quelle position
visuelle) n'est stocké nulle part — il est recalculé à la volée à partir de la
graine de la partie et de l'identifiant du navigateur, ce qui permet aussi de
calculer la progression d'un collègue sans jamais recevoir sa disposition.

## Sources

Le bingo de la rentrée est une tradition bien installée en salle des profs. Les
phrases de ce dépôt sont originales, mais le format et l'esprit s'inspirent de :

- [Bingo de la rentrée spécial profs en secondaire — ÊtreProf](https://etreprof.fr/ressources/3275-bingo-de-la-rentree-special-profs-en-secondaire-vous-lentendez-vous-cochez-4299)
- [Un bingo de la pré-rentrée spécial prof — Calédosphère](https://caledosphere.com/2015/02/12/un-bingo-de-la-pre-rentree-special-prof/)
- [Parents, profs, élèves : le bingo de la rentrée — Slate.fr](https://www.slate.fr/story/106069/bingo-rentree)
- [Le bingo des réunions parents-professeurs — Cursus](https://cursus.edu/fr/10239/le-bingo-des-reunions-parents-professeurs)
- [Le bingo des réunions — Codexa](https://www.codexa.fr/animer-une-reunion/le-bingo-des-reunions/)

Bonne rentrée. ☕
