import { FIREBASE_CONFIG, USE_ANONYMOUS_AUTH } from "../config.js";
import { createFirebaseBackend, isConfigured } from "./firebase.js";
import { createLocalBackend } from "./local.js";

const OVERRIDE_KEY = "bingo:firebase-config";

// La configuration peut venir de trois endroits, dans cet ordre :
//   1. src/config.js (le cas normal, déployé avec le site)
//   2. le lien d'invitation (#config=… ), pour dépanner un collègue
//   3. le panneau « Réglages » de l'application, stocké dans ce navigateur
export function resolveFirebaseConfig() {
  if (isConfigured(FIREBASE_CONFIG)) return FIREBASE_CONFIG;

  const fromLink = readConfigFromHash();
  if (fromLink) {
    saveConfigOverride(fromLink);
    return fromLink;
  }

  const stored = readConfigOverride();
  return isConfigured(stored) ? stored : null;
}

function readConfigFromHash() {
  const match = /(?:^|[#&])config=([^&]+)/.exec(location.hash || "");
  if (!match) return null;
  try {
    const parsed = JSON.parse(decodeBase64Url(match[1]));
    return isConfigured(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readConfigOverride() {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDE_KEY) || "null");
  } catch {
    return null;
  }
}

export function saveConfigOverride(config) {
  try {
    if (config) localStorage.setItem(OVERRIDE_KEY, JSON.stringify(config));
    else localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    /* navigation privée : tant pis, la config vaudra pour cette session */
  }
}

export function encodeBase64Url(text) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeBase64Url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function chooseBackend() {
  const config = resolveFirebaseConfig();
  if (config) return createFirebaseBackend(config, { useAnonymousAuth: USE_ANONYMOUS_AUTH });
  return createLocalBackend();
}
