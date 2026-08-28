// Moteur temps réel : Firebase Realtime Database.
// Le SDK est chargé à la demande depuis le CDN Google, il n'y a donc aucune
// étape de build ni de `npm install` : le site reste un site statique.

const SDK = "https://www.gstatic.com/firebasejs/10.12.5";
const PRESENCE_TTL = 45000;
const MAX_EVENTS = 30;

// La base renvoie les tableaux sous forme d'objets {0:…, 1:…} dès qu'un index
// manque. On normalise systématiquement.
function toArray(value, length) {
  if (Array.isArray(value)) return value.slice(0, length);
  if (value && typeof value === "object") {
    return Array.from({ length }, (_, i) => value[i] ?? value[String(i)] ?? "");
  }
  return [];
}

export function isConfigured(config) {
  return Boolean(config?.apiKey && config?.databaseURL);
}

export function createFirebaseBackend(config, { useAnonymousAuth = true } = {}) {
  return {
    id: "firebase",
    label: "Synchronisé",

    async connect(roomId, handlers) {
      handlers.onStatus?.({ state: "connecting" });

      const [{ initializeApp }, db, auth] = await Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-database.js`),
        useAnonymousAuth ? import(`${SDK}/firebase-auth.js`) : Promise.resolve(null),
      ]);

      const app = initializeApp(config);

      if (auth) {
        try {
          await auth.signInAnonymously(auth.getAuth(app));
        } catch (error) {
          const hint =
            error?.code === "auth/configuration-not-found" || error?.code === "auth/operation-not-allowed"
              ? "Active le fournisseur « Anonyme » dans Firebase → Authentication → Sign-in method."
              : error?.message || String(error);
          handlers.onStatus?.({ state: "error", message: hint });
          throw error;
        }
      }

      const {
        getDatabase, ref, child, onValue, set, remove, update,
        onDisconnect, runTransaction, push, query, limitToLast, serverTimestamp,
      } = db;

      const database = getDatabase(app);
      const roomRef = ref(database, `rooms/${roomId}`);
      const unsubscribers = [];
      let me = null;
      let size = 5;

      // État de la grille (métadonnées + cases cochées).
      unsubscribers.push(
        onValue(
          roomRef,
          (snap) => {
            const raw = snap.val();
            if (!raw) {
              handlers.onRoom?.(null);
              return;
            }
            size = raw.meta?.size || 5;
            handlers.onRoom?.({
              meta: raw.meta || {},
              layout: toArray(raw.layout, size * size),
              checks: raw.checks || {},
            });
          },
          (error) => handlers.onStatus?.({ state: "error", message: describe(error) })
        )
      );

      // Qui est connecté.
      unsubscribers.push(
        onValue(child(roomRef, "presence"), (snap) => {
          const now = Date.now();
          const list = Object.entries(snap.val() || {})
            .filter(([, p]) => !p.ts || now - p.ts < PRESENCE_TTL)
            .map(([id, p]) => ({ id, ...p }));
          handlers.onPresence?.(list);
        })
      );

      // Journal des dernières actions.
      unsubscribers.push(
        onValue(query(child(roomRef, "events"), limitToLast(MAX_EVENTS)), (snap) => {
          const list = Object.entries(snap.val() || {}).map(([id, e]) => ({ id, ...e }));
          list.sort((a, b) => (a.at || 0) - (b.at || 0));
          handlers.onEvent?.(list);
        })
      );

      // La connexion est vivante ? `.info/connected` est géré par le SDK.
      unsubscribers.push(
        onValue(ref(database, ".info/connected"), (snap) => {
          const connected = snap.val() === true;
          handlers.onStatus?.({ state: connected ? "online" : "offline" });
          if (connected && me) armPresence(me);
        })
      );

      function armPresence(user) {
        const myRef = child(roomRef, `presence/${user.id}`);
        onDisconnect(myRef).remove();
        reported(set(myRef, { name: user.name, color: user.color, ts: serverTimestamp() }), "Présence");
      }

      function describe(error) {
        const code = error?.code || "";
        const message = error?.message || String(error);
        if (code === "PERMISSION_DENIED" || /permission[_ ]denied/i.test(message)) {
          return "accès refusé par les règles de sécurité de la base — vérifie qu'elles sont bien publiées dans Firebase → Realtime Database → Règles.";
        }
        return code ? `${code} — ${message}` : message;
      }

      // Une écriture refusée par les règles de sécurité échouait jusqu'ici en
      // silence (aucun catch côté app.js) : le clic n'avait l'air de rien
      // faire, sans explication. On remonte l'erreur — avec l'action qui a
      // échoué — dans la pastille de statut, et on efface une éventuelle
      // erreur précédente dès qu'une écriture repasse avec succès.
      function reported(promise, label) {
        return promise.then(
          (value) => {
            handlers.onStatus?.({ state: "online" });
            return value;
          },
          (error) => {
            handlers.onStatus?.({ state: "error", message: `${label} : ${describe(error)}` });
          }
        );
      }

      return {
        mode: "firebase",

        // Transaction : si deux personnes ouvrent la salle en même temps,
        // une seule grille est créée et tout le monde voit la même.
        async ensureRoom(defaults) {
          await reported(
            runTransaction(roomRef, (current) => {
              if (current && current.layout) {
                // Nettoie un éventuel champ « cells » hérité de l'ancien
                // modèle (avant les cases cochées par joueur) : les règles
                // actuelles ne le connaissent plus et rejetteraient toute
                // écriture qui le laisserait traîner tel quel.
                if (Object.prototype.hasOwnProperty.call(current, "cells")) {
                  const { cells, ...clean } = current;
                  return clean;
                }
                return current;
              }
              return {
                meta: defaults.meta,
                layout: defaults.layout,
                checks: current?.checks || null,
                presence: current?.presence || null,
              };
            }),
            "Ouverture de la salle"
          );
        },

        // Chacun coche sa propre grille : la case se pose dans checks/<toi>,
        // jamais dans celle d'un collègue. Une fois posée elle reste posée
        // (une transaction ne l'écrase pas si tu la recliques par erreur).
        setCell(playerId, index, marker) {
          const cellRef = child(roomRef, `checks/${playerId}/${index}`);
          if (!marker) return reported(remove(cellRef), "Décocher une case");
          return reported(
            runTransaction(cellRef, (current) => (current == null ? marker : current)),
            "Cocher une case"
          );
        },

        setCellText(index, text) {
          return reported(update(child(roomRef, "layout"), { [index]: text }), "Modifier une case");
        },

        newGame({ meta, layout }) {
          return reported(update(roomRef, { meta, layout, checks: null, events: null }), "Nouvelle grille");
        },

        resetCells() {
          return reported(set(child(roomRef, "checks"), null), "Tout décocher");
        },

        setPresence(user) {
          me = user;
          armPresence(user);
        },

        pushEvent(event) {
          return reported(push(child(roomRef, "events"), { ...event, at: serverTimestamp() }), "Journal");
        },

        leave() {
          unsubscribers.forEach((off) => off());
          if (me) remove(child(roomRef, `presence/${me.id}`));
        },
      };
    },
  };
}
