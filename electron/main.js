// electron/main.js
//
// Process principal Electron : démarre le serveur embarqué puis ouvre une
// fenêtre native qui charge l'app via http://localhost:<port>.
//
// La fenêtre se comporte comme un navigateur classique (chargement HTTP,
// cookies de session, fetch same-origin), donc le code frontend tourne tel
// quel. On garde une posture sécurisée : pas de nodeIntegration, isolation
// du contexte activée — le renderer n'a besoin d'aucun accès Node.

const { app, BrowserWindow, shell } = require("electron");
const { startServer } = require("./server");

let serverHandle = null;

async function createWindow() {
  const { server, port } = await startServer();
  serverHandle = server;

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: "Suivi Suunto",
    backgroundColor: "#0f1115",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Les liens externes (cartes, docs...) s'ouvrent dans le navigateur système
  // plutôt que dans une fenêtre Electron sans barre d'adresse.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://localhost")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(`http://localhost:${port}/`);
}

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (serverHandle) serverHandle.close();
  if (process.platform !== "darwin") app.quit();
});
