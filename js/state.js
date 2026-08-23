// js/state.js
//
// État mutable partagé entre modules (cartes Leaflet actives, thème,
// dernière position connue). Regroupé ici plutôt qu'en variables globales
// éparpillées, pour que chaque module sache exactement ce qu'il partage.
export const state = {
  currentTheme: "dark",

  currentMap: null,
  currentTileLayer: null,

  editorMap: null,
  editorTileLayer: null,
  editorInitialized: false,
  editorMapRecentered: false,

  overviewMap: null,
  overviewTileLayer: null,
  overviewInitialized: false,

  lastKnownWorkoutPosition: null,
};
