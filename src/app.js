import { DEFAULTS } from "./config.js";
import { buildLayout, findBingos, centerIndex, randomSeed, personalPermutation } from "./grid.js";
import { PHRASES, FREE_CELL_TEXT } from "./phrases.js";
import {
  chooseBackend, resolveFirebaseConfig, readConfigOverride,
  saveConfigOverride, encodeBase64Url,
} from "./sync/index.js";

const $ = (id) => document.getElementById(id);

const COLORS = [
  "#e8543f", "#1f6feb", "#0f9d58", "#b3479f", "#e08a12",
  "#0f9b9b", "#7b53d6", "#d1417a", "#4a7c1f", "#2f6b8f",
];

const state = {
  roomId: readRoomFromUrl(),
  user: loadUser(),
  room: null,
  presence: [],
  events: [],
  status: { state: "connecting" },
  editing: false,
  celebrated: new Set(),
  fullHouse: false,
  primed: false,
  editingIndex: null,
};

let conn = null;
let backend = null;

/* ------------------------------------------------------------- identité */

function loadUser() {
  let id = localStorage.getItem("bingo:client");
  if (!id) {
    id = (crypto.randomUUID?.() || `c${Date.now()}${Math.random()}`).replace(/[.#$/[\]]/g, "");
    localStorage.setItem("bingo:client", id);
  }
  const name = localStorage.getItem("bingo:name") || "";
  return { id, name, color: colorFor(name || id) };
}

function saveUser(name) {
  state.user.name = name.trim().slice(0, 24);
  state.user.color = colorFor(state.user.name);
  localStorage.setItem("bingo:name", state.user.name);
}

function colorFor(seed) {
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

function initials(name) {
  const words = String(name).trim().split(/[\s-]+/).filter(Boolean);
  if (!words.length) return "?";
  return (words[0][0] + (words[1]?.[0] || "")).toUpperCase();
}

/* ----------------------------------------------------------- salle & url */

function slugify(text) {
  return String(text)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 48) || DEFAULTS.room;
}

function readRoomFromUrl() {
  return slugify(new URLSearchParams(location.search).get("salle") || DEFAULTS.room);
}

function shareUrl() {
  const url = new URL(location.href);
  url.search = new URLSearchParams({ salle: state.roomId }).toString();
  url.hash = "";
  // Si la configuration ne vient pas du code déployé mais de ce navigateur,
  // on l'embarque dans le lien pour que les collègues soient connectés aussi.
  const override = readConfigOverride();
  if (override && backend?.id === "firebase") {
    url.hash = `config=${encodeBase64Url(JSON.stringify(override))}`;
  }
  return url.toString();
}

/* ------------------------------------------------------- grille par défaut */

function freshRoom({ size = currentSize(), freeCell = state.room?.meta?.freeCell ?? DEFAULTS.freeCell } = {}) {
  const seed = randomSeed();
  const layout = buildLayout({ size, seed, freeCell });
  return { meta: { size, seed, freeCell, createdAt: Date.now() }, layout };
}

function currentSize() {
  return state.room?.meta?.size || DEFAULTS.size;
}

function currentLayout() {
  return state.room?.layout || [];
}

// La case offerte n'est jamais stockée : c'est une constante de la grille
// (toujours au centre), pas un événement qui arrive pendant la réunion.
function freeCanonicalIndex() {
  return state.room?.meta?.freeCell ? centerIndex(currentSize()) : -1;
}

// Ce que CE participant a coché sur SA grille — jamais celle d'un collègue.
function myChecks() {
  return state.room?.checks?.[state.user.id] || {};
}

function isCheckedFor(perm, checks, free) {
  return (visualIndex) => {
    const canonical = perm[visualIndex];
    return canonical === free || Boolean(checks[canonical]);
  };
}

function uniquePeople() {
  const others = state.presence.filter((p) => p.id !== state.user.id);
  return [{ ...state.user }, ...others];
}

// La disposition visuelle de CE participant : mêmes phrases pour tout le
// monde (currentLayout), mais rangées différemment sur chaque écran, comme
// des cartons de loto. `perm[position visuelle] = case du fond commun`.
let permCache = null;
function permutation() {
  const meta = state.room?.meta;
  if (!meta) return [];
  const key = `${meta.seed}:${meta.size}:${meta.freeCell}`;
  if (permCache?.key !== key) {
    permCache = { key, table: personalPermutation(meta.size, meta.freeCell, meta.seed, state.user.id) };
  }
  return permCache.table;
}

/* ---------------------------------------------------------------- rendu */

const gridEl = $("grid");

function render() {
  renderIdentity();
  renderStatus();
  renderPresence();
  renderGrid();
  renderProgress();
  renderFeed();
  renderStandings();
}

function renderIdentity() {
  $("me-button").innerHTML =
    `<span class="dot" style="background:${state.user.color}">${escapeHtml(initials(state.user.name))}</span>` +
    `<span>${escapeHtml(state.user.name || "Choisir un pseudo")}</span>`;
  $("room-name").textContent = state.roomId;
}

function renderStatus() {
  const el = $("status");
  const labels = {
    online: "Synchronisé",
    connecting: "Connexion…",
    offline: "Hors ligne",
    local: "Mode local",
    error: "Erreur",
  };
  el.dataset.state = state.status.state;
  el.textContent = labels[state.status.state] || state.status.state;
  el.title = state.status.message || "";

  if (state.status.state === "error" && state.status.message) {
    $("hint").textContent = `⚠️ ${state.status.message}`;
  } else if (state.status.state === "local") {
    $("hint").textContent =
      "Mode local : la grille reste sur cet appareil. Ouvre ⚙️ pour la partager avec les collègues.";
  } else if (state.editing) {
    $("hint").textContent = "Mode modification : touche une case pour réécrire son texte — le changement peut apparaître ailleurs sur la grille des collègues, chacun a son propre mélange.";
  } else {
    $("hint").textContent = "Touche une case pour la cocher sur TA grille (re-touche pour décocher). Regarde « Qui avance ? » pour suivre les collègues.";
  }
}

function renderPresence() {
  const list = $("presence");
  const shown = uniquePeople().slice(0, 6);
  list.innerHTML = shown
    .map((p) => `<li style="background:${p.color || "#888"}" title="${escapeHtml(p.name || "…")}">${escapeHtml(initials(p.name))}</li>`)
    .join("");
  const extra = uniquePeople().length - shown.length;
  if (extra > 0) list.insertAdjacentHTML("beforeend", `<li style="background:var(--ink-faint)">+${extra}</li>`);
}

function renderGrid() {
  const layout = currentLayout();
  const size = currentSize();
  if (!layout.length) return;

  gridEl.style.setProperty("--size", size);
  gridEl.dataset.editing = String(state.editing);

  if (gridEl.childElementCount !== layout.length) {
    gridEl.replaceChildren(
      ...layout.map((_, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cell";
        button.dataset.index = index;
        button.innerHTML = `<span class="cell__text"></span>`;
        button.addEventListener("click", () => onCellActivate(index));
        return button;
      })
    );
  }

  const perm = permutation();
  const free = freeCanonicalIndex();
  const mine = myChecks();
  const bingo = findBingos(size, isCheckedFor(perm, mine, free));

  [...gridEl.children].forEach((button, index) => {
    const canonical = perm[index];
    const isFree = canonical === free;
    const checked = isFree || Boolean(mine[canonical]);
    const text = layout[canonical] ?? "";
    button.querySelector(".cell__text").textContent = text;
    button.dataset.checked = String(checked);
    button.dataset.free = String(isFree);
    button.dataset.winning = String(bingo.cells.has(index));
    button.setAttribute("aria-pressed", String(checked));
    button.setAttribute(
      "aria-label",
      isFree ? `${text} — offerte` : checked ? `${text} — cochée, touche à nouveau pour décocher` : text
    );
  });

  announce(bingo);
}

function renderProgress() {
  const size = currentSize();
  const total = size * size;
  const done = Object.keys(myChecks()).length + (freeCanonicalIndex() >= 0 ? 1 : 0);
  $("progress-fill").style.width = `${total ? (done / total) * 100 : 0}%`;
  $("progress-text").textContent = `${done} / ${total}`;
  $("progress-label").setAttribute("aria-label", `${done} cases cochées sur ${total}`);
}

// Le tableau « qui avance ? » : la progression de chaque collègue connecté,
// recalculée à partir de SA propre disposition (déterministe, donc pas besoin
// que son navigateur nous l'envoie) et de ses propres cases cochées.
function renderStandings() {
  const el = $("standings");
  if (!el) return;
  const meta = state.room?.meta;
  if (!meta) { el.innerHTML = ""; return; }

  const size = meta.size;
  const free = meta.freeCell ? centerIndex(size) : -1;
  const checks = state.room.checks || {};

  const rows = uniquePeople().map((p) => {
    const perm = personalPermutation(size, meta.freeCell, meta.seed, p.id);
    const bingo = findBingos(size, isCheckedFor(perm, checks[p.id] || {}, free));
    return { ...p, checked: bingo.checked, total: bingo.total, lines: bingo.lines.length, fullHouse: bingo.fullHouse };
  });
  rows.sort((a, b) => b.checked - a.checked || b.lines - a.lines);

  el.innerHTML = rows.map((r) => {
    const pct = r.total ? Math.round((r.checked / r.total) * 100) : 0;
    const count = r.fullHouse ? "🏆 carton plein" : r.lines ? `🎉 ${r.lines} ligne${r.lines > 1 ? "s" : ""}` : `${r.checked}/${r.total}`;
    // On ne peut pas se retirer soi-même : ça reviendrait à la prochaine
    // présence. Utile surtout pour un doublon (vieil onglet, autre appareil).
    const remove = r.id === state.user.id ? "" :
      `<button type="button" class="standing__remove" data-remove="${escapeHtml(r.id)}" data-name="${escapeHtml(r.name || "ce participant")}" title="Retirer ${escapeHtml(r.name || "ce participant")} de la liste" aria-label="Retirer ${escapeHtml(r.name || "ce participant")} de la liste">✕</button>`;
    return `
      <li>
        <div class="standing__head">
          <span class="standing__dot" style="background:${r.color || "#888"}"></span>
          <span class="standing__name">${escapeHtml(r.name || "…")}${r.id === state.user.id ? " (toi)" : ""}</span>
          <span class="standing__count">${count}</span>
          ${remove}
        </div>
        <div class="standing__bar"><span style="width:${pct}%;background:${r.color || "#888"}"></span></div>
      </li>`;
  }).join("");
}

function renderFeed() {
  const feed = $("feed");
  if (!state.events.length) {
    feed.innerHTML = `<li class="feed__empty">Rien pour l'instant. La journée commence à peine…</li>`;
    return;
  }
  feed.innerHTML = state.events
    .slice(-20).reverse()
    .map((event) => {
      const who = `<span class="feed__who" style="color:${event.color || "inherit"}">${escapeHtml(event.name || "Quelqu'un")}</span>`;
      const when = event.at ? `<span style="opacity:.6"> · ${ago(event.at)}</span>` : "";
      return `<li>${who}<span class="feed__what">${describeEvent(event)}${when}</span></li>`;
    })
    .join("");
}

function describeEvent(event) {
  const quote = event.text ? ` « ${escapeHtml(event.text)} »` : "";
  switch (event.type) {
    case "check": return `a coché${quote}`;
    case "uncheck": return `a décoché${quote}`;
    case "bingo": return `a fait un <strong>BINGO</strong> 🎉`;
    case "fullhouse": return `a rempli toute la grille 🏆`;
    case "newgame": return `a lancé une nouvelle grille`;
    case "clear": return `a tout décoché`;
    default: return escapeHtml(event.type || "");
  }
}

function ago(timestamp) {
  const seconds = (Date.now() - timestamp) / 1000;
  if (seconds < 60) return "à l'instant";
  if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)} min`;
  return `il y a ${Math.floor(seconds / 3600)} h`;
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/* ------------------------------------------------------------ bingo ! */

// Le bandeau et les confettis se déclenchent sur ce que l'on observe, pas sur
// ce que l'on a cliqué : tout le monde voit la fête en même temps.
function announce(bingo) {
  const ids = new Set(bingo.lines.map((line) => line.id));
  for (const id of [...state.celebrated]) if (!ids.has(id)) state.celebrated.delete(id);

  const fresh = bingo.lines.filter((line) => !state.celebrated.has(line.id));
  fresh.forEach((line) => state.celebrated.add(line.id));

  if (!bingo.fullHouse) state.fullHouse = false;

  if (!state.primed) return; // premier rendu : on ne fête pas l'existant

  if (bingo.fullHouse && !state.fullHouse) {
    state.fullHouse = true;
    banner("🏆 CARTON PLEIN ! Toute la grille y est passée.");
    confetti(3);
  } else if (fresh.length) {
    banner(fresh.length > 1 ? `🎉 ${fresh.length} lignes complètes !` : `🎉 BINGO — ${fresh[0].label} complète !`);
    confetti(1);
  }
}

let bannerTimer = null;
function banner(text, tone = "win") {
  const el = $("banner");
  el.textContent = text;
  el.dataset.tone = tone;
  el.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

/* ------------------------------------------------------------- confettis */

const canvas = $("confetti");
const ctx = canvas.getContext("2d");
let particles = [];
let raf = null;

function confetti(intensity = 1) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * ratio;
  canvas.height = innerHeight * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  for (let i = 0; i < 90 * intensity; i++) {
    particles.push({
      x: Math.random() * innerWidth,
      y: -20 - Math.random() * innerHeight * 0.4,
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 4,
      size: 4 + Math.random() * 6,
      spin: (Math.random() - 0.5) * 0.3,
      angle: Math.random() * Math.PI,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
  }
  if (!raf) raf = requestAnimationFrame(tick);
}

function tick() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  particles = particles.filter((p) => p.y < innerHeight + 30);
  particles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.05;
    p.angle += p.spin;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    ctx.restore();
  });
  raf = particles.length ? requestAnimationFrame(tick) : null;
  if (!raf) ctx.clearRect(0, 0, innerWidth, innerHeight);
}

/* ---------------------------------------------------------- interactions */

function onCellActivate(index) {
  if (state.editing) return openCellEditor(index);

  const perm = permutation();
  const canonical = perm[index];
  const free = freeCanonicalIndex();

  if (canonical === free) {
    banner("Celle-là est offerte 🎁", "info");
    return;
  }

  const mine = myChecks();
  const text = currentLayout()[canonical] || "";

  // C'est ta grille : tu coches, et tu peux décocher toi-même si tu t'es
  // trompé. Personne d'autre ne peut toucher tes cases de toute façon.
  if (mine[canonical]) {
    conn.setCell(state.user.id, canonical, null);
    conn.pushEvent({ type: "uncheck", name: state.user.name, color: state.user.color, text });
    return;
  }

  conn.setCell(state.user.id, canonical, { at: Date.now() });
  conn.pushEvent({ type: "check", name: state.user.name, color: state.user.color, text });

  // Cette case fait-elle une ligne sur TA grille ? Chacun a sa propre
  // disposition, donc chacun peut compléter une ligne à un moment différent.
  const size = currentSize();
  const before = findBingos(size, isCheckedFor(perm, mine, free));
  const after = findBingos(size, (i) => i === index || isCheckedFor(perm, mine, free)(i));
  if (after.lines.length > before.lines.length) {
    conn.pushEvent({ type: "bingo", name: state.user.name, color: state.user.color });
  }
  if (after.fullHouse && !before.fullHouse) {
    conn.pushEvent({ type: "fullhouse", name: state.user.name, color: state.user.color });
  }
}

function openCellEditor(index) {
  const canonical = permutation()[index];
  state.editingIndex = canonical;
  $("input-cell").value = currentLayout()[canonical] || "";
  $("modal-cell").showModal();
}

/* ------------------------------------------------------------ démarrage */

async function boot() {
  wireUi();
  render();

  if (!state.user.name) await askName();

  backend = chooseBackend();

  try {
    conn = await backend.connect(state.roomId, {
      onRoom(room) {
        state.room = room;
        // Peut arriver avant la fin de `connect` : la salle sera créée juste après.
        if (!room) { if (conn) ensure(); return; }
        render();
        state.primed = true;
      },
      onPresence(list) { state.presence = list; renderPresence(); renderStandings(); },
      onEvent(list) { state.events = list; renderFeed(); },
      onStatus(status) { state.status = status; renderStatus(); },
    });
  } catch (error) {
    state.status = { state: "error", message: error?.message || String(error) };
    renderStatus();
    return;
  }

  await ensure();
  conn.setPresence(state.user);
  setInterval(() => conn.setPresence(state.user), 20000);
  window.addEventListener("beforeunload", () => conn.leave());
}

let ensuring = false;
async function ensure() {
  if (ensuring) return;
  ensuring = true;
  try {
    await conn.ensureRoom(freshRoom({ size: DEFAULTS.size }));
  } finally {
    ensuring = false;
  }
}

function askName() {
  return new Promise((resolve) => {
    const modal = $("modal-name");
    $("input-name").value = state.user.name;
    modal.showModal();
    $("form-name").addEventListener("submit", function once() {
      $("form-name").removeEventListener("submit", once);
      saveUser($("input-name").value || "Anonyme");
      renderIdentity();
      conn?.setPresence(state.user);
      resolve();
    });
  });
}

/* ------------------------------------------------------------------- ui */

function wireUi() {
  $("me-button").addEventListener("click", () => askName());
  $("room-button").addEventListener("click", () => openSettings());
  $("settings").addEventListener("click", () => openSettings());

  $("standings").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    const id = button.dataset.remove;
    const name = button.dataset.name || "ce participant";
    if (confirm(`Retirer ${name} de la liste ? Sa progression est conservée : il réapparaîtra s'il rouvre le bingo.`)) {
      conn.removePresence(id);
    }
  });

  $("edit-toggle").addEventListener("click", (event) => {
    state.editing = !state.editing;
    event.currentTarget.setAttribute("aria-pressed", String(state.editing));
    event.currentTarget.textContent = state.editing ? "✅ Terminé" : "✏️ Modifier";
    renderGrid();
    renderStatus();
  });

  $("share").addEventListener("click", async () => {
    const url = shareUrl();
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: "Bingo de la pré-rentrée", url });
      } else {
        await navigator.clipboard.writeText(url);
        banner("Lien copié — envoie-le aux collègues 📋", "info");
      }
    } catch {
      prompt("Copie ce lien et envoie-le aux collègues :", url);
    }
  });

  $("clear").addEventListener("click", () => {
    if (!confirm("Décocher toutes les grilles, y compris celles des collègues ?")) return;
    conn.resetCells();
    conn.pushEvent({ type: "clear", name: state.user.name, color: state.user.color });
    state.celebrated.clear();
    state.fullHouse = false;
  });

  $("newgame").addEventListener("click", () => {
    if (!confirm("Tirer une nouvelle grille ? Elle remplacera celle de tout le monde.")) return;
    conn.newGame(freshRoom());
    conn.pushEvent({ type: "newgame", name: state.user.name, color: state.user.color });
    state.celebrated.clear();
    state.fullHouse = false;
  });

  // --- modification d'une case
  $("cell-cancel").addEventListener("click", () => $("modal-cell").close());
  $("cell-random").addEventListener("click", () => {
    const used = new Set(currentLayout());
    const pool = PHRASES.filter((p) => !used.has(p));
    const source = pool.length ? pool : PHRASES;
    $("input-cell").value = source[Math.floor(Math.random() * source.length)];
  });
  $("form-cell").addEventListener("submit", () => {
    const index = state.editingIndex;
    const text = $("input-cell").value.trim();
    if (index != null && text) conn.setCellText(index, text);
  });

  // --- réglages
  $("settings-cancel").addEventListener("click", () => $("modal-settings").close());
  $("form-settings").addEventListener("submit", () => applySettings());
}

function openSettings() {
  $("input-room").value = state.roomId;

  $("input-size").innerHTML = [3, 4, 5]
    .map((n) => {
      const checked = n === currentSize() ? "checked" : "";
      return `<label><input type="radio" name="size" value="${n}" ${checked}> ${n}×${n}</label>`;
    })
    .join("");

  const override = readConfigOverride();
  $("input-firebase").value = override ? JSON.stringify(override, null, 2) : "";
  $("backend-state").textContent =
    backend?.id === "firebase"
      ? "✅ Connecté à une base Firebase : les grilles sont partagées."
      : "⚠️ Aucune base configurée : la grille reste sur cet appareil.";
  if (backend?.id !== "firebase") $("advanced").open = true;

  $("modal-settings").showModal();
}

function applySettings() {
  const raw = $("input-firebase").value.trim();
  let reload = false;

  if (raw) {
    const parsed = parseFirebaseConfig(raw);
    if (parsed) {
      saveConfigOverride(parsed);
      reload = true;
    } else {
      alert("Je n'arrive pas à lire cette configuration. Colle le bloc firebaseConfig donné par Firebase, accolades comprises.");
      return;
    }
  } else if (readConfigOverride()) {
    saveConfigOverride(null);
    reload = true;
  }

  const room = slugify($("input-room").value || state.roomId);
  if (room !== state.roomId) {
    const url = new URL(location.href);
    url.search = new URLSearchParams({ salle: room }).toString();
    location.href = url.toString();
    return;
  }

  if (reload) { location.reload(); return; }

  const size = Number($("input-size").querySelector("input:checked")?.value) || currentSize();
  if (size !== currentSize()) {
    conn.newGame(freshRoom({ size }));
    conn.pushEvent({ type: "newgame", name: state.user.name, color: state.user.color });
    state.celebrated.clear();
    state.fullHouse = false;
  }
}

// Firebase donne un objet JavaScript (clés sans guillemets). On accepte les
// deux formes plutôt que d'obliger à reformater à la main.
export function parseFirebaseConfig(text) {
  const body = text.replace(/^[^{]*/, "").replace(/[^}]*$/, "");
  try {
    const parsed = JSON.parse(body);
    if (parsed?.apiKey && parsed?.databaseURL) return parsed;
  } catch { /* on tente la lecture tolérante ci-dessous */ }

  const config = {};
  for (const [, key, value] of body.matchAll(/["']?([A-Za-z]+)["']?\s*:\s*["']([^"']*)["']/g)) {
    config[key] = value;
  }
  return config.apiKey && config.databaseURL ? config : null;
}

if (typeof document !== "undefined" && document.getElementById("grid")) boot();
