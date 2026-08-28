// Génération de grille + détection des bingos.
import { PHRASES, FREE_CELL_TEXT } from "./phrases.js";

// PRNG déterministe (mulberry32) : une même graine donne toujours la même
// grille. Utile pour rejouer une partie à l'identique, et pour que le tirage
// soit reproductible côté tests.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

export function centerIndex(size) {
  return size % 2 === 1 ? (size * size - 1) / 2 : -1;
}

// Tire `size * size` phrases distinctes et les place dans la grille.
// La case centrale des grilles impaires est offerte (déjà cochée).
export function buildLayout({ size = 5, seed = randomSeed(), pool = PHRASES, freeCell = true } = {}) {
  const total = size * size;
  const rng = makeRng(seed);
  const bag = pool.slice();

  // Mélange de Fisher-Yates avec notre PRNG.
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }

  const free = freeCell ? centerIndex(size) : -1;
  const layout = [];
  let cursor = 0;
  for (let i = 0; i < total; i++) {
    if (i === free) {
      layout.push(FREE_CELL_TEXT);
      continue;
    }
    // Si la banque est plus petite que la grille, on repasse dessus.
    layout.push(bag[cursor % bag.length]);
    cursor++;
  }
  return layout;
}

// Toutes les lignes gagnantes : rangées, colonnes, deux diagonales.
export function winningLines(size) {
  const lines = [];
  for (let r = 0; r < size; r++) {
    lines.push({
      id: `ligne-${r + 1}`,
      label: `ligne ${r + 1}`,
      cells: Array.from({ length: size }, (_, c) => r * size + c),
    });
  }
  for (let c = 0; c < size; c++) {
    lines.push({
      id: `colonne-${c + 1}`,
      label: `colonne ${c + 1}`,
      cells: Array.from({ length: size }, (_, r) => r * size + c),
    });
  }
  lines.push({
    id: "diagonale-1",
    label: "diagonale",
    cells: Array.from({ length: size }, (_, i) => i * size + i),
  });
  lines.push({
    id: "diagonale-2",
    label: "diagonale",
    cells: Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)),
  });
  return lines;
}

// Une disposition personnelle par participant : les mêmes phrases pour tout
// le monde, mais rangées différemment sur chaque grille — comme des cartons
// de loto. La graine combine la graine de la partie et l'identifiant du
// navigateur, donc la disposition de chacun reste stable d'une visite à
// l'autre, mais change forcément d'une personne à l'autre.
// Renvoie une table telle que table[position visuelle] = case du fond commun.
export function personalPermutation(size, freeCell, roomSeed, clientId) {
  const total = size * size;
  const free = freeCell ? centerIndex(size) : -1;

  let seed = (roomSeed ?? 0) >>> 0;
  for (const char of String(clientId)) seed = (Math.imul(seed, 31) + char.codePointAt(0)) >>> 0;
  const rng = makeRng(seed);

  const movable = [];
  for (let i = 0; i < total; i++) if (i !== free) movable.push(i);
  for (let i = movable.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [movable[i], movable[j]] = [movable[j], movable[i]];
  }

  const table = new Array(total);
  if (free >= 0) table[free] = free;
  let cursor = 0;
  for (let i = 0; i < total; i++) {
    if (i !== free) table[i] = movable[cursor++];
  }
  return table;
}

// Renvoie les lignes complètes et l'ensemble des cases qui en font partie.
export function findBingos(size, isChecked) {
  const lines = winningLines(size).filter((line) => line.cells.every(isChecked));
  const cells = new Set();
  lines.forEach((line) => line.cells.forEach((i) => cells.add(i)));
  const total = size * size;
  let checked = 0;
  for (let i = 0; i < total; i++) if (isChecked(i)) checked++;
  return { lines, cells, fullHouse: checked === total, checked, total };
}
