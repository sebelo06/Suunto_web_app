// js/api.js
import { API_BASE } from "./config.js";

export async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    credentials: "include", // indispensable : envoie le cookie de session
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Erreur ${res.status}`);
  }
  return res.json();
}
