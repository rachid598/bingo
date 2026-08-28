// ---------------------------------------------------------------------------
//  CONFIGURATION
// ---------------------------------------------------------------------------
//  Pour jouer à plusieurs, il faut une base de données temps réel.
//  Le plus simple : Firebase Realtime Database (gratuit, 5 minutes de mise en
//  place). La marche à suivre complète est dans le README.
//
//  Tant que ce fichier n'est pas rempli, l'application fonctionne quand même,
//  mais en « mode local » : la grille reste sur ton appareil et n'est pas
//  partagée avec les collègues.
//
//  Ces clés ne sont PAS des secrets : une configuration Firebase web est
//  publique par nature. Ce sont les règles de sécurité (firebase.rules.json)
//  qui protègent la base.
// ---------------------------------------------------------------------------

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBgITY-i_R-0atUirlVQQAq6sqa8QnO2hQ",
  authDomain: "bingo-9ebfd.firebaseapp.com",
  databaseURL: "https://bingo-9ebfd-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bingo-9ebfd",
  storageBucket: "bingo-9ebfd.firebasestorage.app",
  messagingSenderId: "287254616906",
  appId: "1:287254616906:web:b3124cf67f4d50b12fffb3",
};

// Se connecter en « anonyme » avant d'écrire. Recommandé : les règles de
// sécurité fournies n'autorisent que les utilisateurs authentifiés.
// Pense à activer le fournisseur « Anonyme » dans Firebase → Authentication.
export const USE_ANONYMOUS_AUTH = true;

// Réglages par défaut d'une nouvelle grille.
export const DEFAULTS = {
  room: "salle-des-profs",
  size: 5,        // 3, 4 ou 5 → grille de 3x3, 4x4 ou 5x5
  freeCell: true, // case centrale offerte (grilles impaires uniquement)
};
