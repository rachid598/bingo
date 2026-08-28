// Moteur de secours : aucune base de données.
// La partie vit dans le localStorage du navigateur et se synchronise entre les
// onglets ouverts sur le même appareil (BroadcastChannel). Pratique pour tester
// l'application avant de brancher Firebase.

const PRESENCE_TTL = 20000;

const key = (roomId) => `bingo:room:${roomId}`;

function read(roomId) {
  try {
    return JSON.parse(localStorage.getItem(key(roomId)) || "null");
  } catch {
    return null;
  }
}

function write(roomId, room) {
  try {
    localStorage.setItem(key(roomId), JSON.stringify(room));
  } catch {
    /* quota plein ou navigation privée : on continue en mémoire */
  }
}

export function createLocalBackend() {
  return {
    id: "local",
    label: "Mode local",

    async connect(roomId, handlers) {
      let room = read(roomId);
      const channel = "BroadcastChannel" in window ? new BroadcastChannel(`bingo:${roomId}`) : null;
      let me = null;

      const emit = () => {
        handlers.onRoom?.(room);
        handlers.onPresence?.(livePresence());
        handlers.onEvent?.(room?.events || []);
      };

      const livePresence = () => {
        const now = Date.now();
        const all = room?.presence || {};
        return Object.entries(all)
          .filter(([, p]) => now - (p.ts || 0) < PRESENCE_TTL)
          .map(([id, p]) => ({ id, ...p }));
      };

      const commit = (mutate) => {
        room = read(roomId) || room || {};
        mutate(room);
        write(roomId, room);
        channel?.postMessage({ type: "sync" });
        emit();
      };

      channel?.addEventListener("message", () => {
        room = read(roomId);
        emit();
      });

      // Un autre onglet peut aussi écrire sans BroadcastChannel (vieux Safari).
      const onStorage = (e) => {
        if (e.key === key(roomId)) {
          room = read(roomId);
          emit();
        }
      };
      window.addEventListener("storage", onStorage);

      const prune = setInterval(() => handlers.onPresence?.(livePresence()), 5000);

      handlers.onStatus?.({ state: "local" });
      emit();

      return {
        mode: "local",

        ensureRoom(defaults) {
          if (room && room.layout) return;
          commit((r) => {
            r.meta = defaults.meta;
            r.layout = defaults.layout;
            r.cells = defaults.cells || {};
            r.presence = r.presence || {};
            r.events = [];
          });
        },

        setCell(index, marker) {
          commit((r) => {
            r.cells = r.cells || {};
            if (marker) { if (!r.cells[index]) r.cells[index] = marker; }
            else delete r.cells[index];
          });
        },

        setCellText(index, text) {
          commit((r) => {
            r.layout = r.layout.slice();
            r.layout[index] = text;
          });
        },

        newGame({ meta, layout, cells }) {
          commit((r) => {
            r.meta = meta;
            r.layout = layout;
            r.cells = cells || {};
            r.events = [];
          });
        },

        resetCells(cells) {
          commit((r) => {
            r.cells = cells || {};
          });
        },

        setPresence(user) {
          me = user.id;
          commit((r) => {
            r.presence = r.presence || {};
            r.presence[user.id] = { name: user.name, color: user.color, ts: Date.now() };
          });
        },

        pushEvent(event) {
          commit((r) => {
            r.events = [...(r.events || []), { id: `${Date.now()}-${Math.random()}`, ...event }].slice(-30);
          });
        },

        leave() {
          clearInterval(prune);
          window.removeEventListener("storage", onStorage);
          if (me) {
            commit((r) => {
              if (r.presence) delete r.presence[me];
            });
          }
          channel?.close();
        },
      };
    },
  };
}
