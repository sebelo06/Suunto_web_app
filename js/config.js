// js/config.js
//
// URL du backend. Configurable sans toucher au JS : édite le
// <meta name="api-base" content="..."> dans index.html (utile pour
// déployer le frontend ailleurs qu'en local). Fallback sur localhost:3000
// si la meta est absente.
const metaApiBase = document.querySelector('meta[name="api-base"]');
export const API_BASE = (metaApiBase && metaApiBase.content) || "http://localhost:3000";
