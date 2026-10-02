/**
 * Electron main process — embeds the Express + Socket.IO server
 * and opens the GURPS VTT in a BrowserWindow.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import * as path from 'path';
import * as net from 'net';
import * as os from 'os';

// Set app name for userData path in dev mode
if (!app.isPackaged) {
  app.setName('gurps-vtt');
}

// Resolve paths relative to the packaged app
const IS_DEV = !app.isPackaged;
const ROOT = IS_DEV
  ? path.join(import.meta.dirname, '..')
  : path.join(process.resourcesPath, 'app');

const SERVER_DIST = path.join(ROOT, 'server', 'dist', 'server', 'src', 'index.js');
const CLIENT_DIST = path.join(ROOT, 'dist');
const DATA_DIR = path.join(app.getPath('userData'), 'data');

let mainWindow: BrowserWindow | null = null;
let serverHandle: { port: number; close: () => Promise<void> } | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find a free port by briefly listening on port 0. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      if (addr && typeof addr !== 'string') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('Could not determine port')));
      }
    });
    srv.on('error', reject);
  });
}

/** Get the machine's LAN IP for multiplayer display. */
function getLanIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// ---------------------------------------------------------------------------
// Application menu
// ---------------------------------------------------------------------------

function buildMenu(serverPort: number): void {
  const lanIP = getLanIP();
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: `Server: http://${lanIP}:${serverPort}`,
          enabled: false,
        },
        { type: 'separator' },
        {
          label: 'Open in Browser',
          click: () => shell.openExternal(`http://localhost:${serverPort}`),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

async function createWindow(port: number): Promise<void> {
  const lanIP = getLanIP();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#111827',
    darkTheme: true,
    title: `GURPS VTT — http://${lanIP}:${port}`,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  holdCloseUntilSaved(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Upper bound on how long a close waits for the renderer's final save. */
const CLOSE_FLUSH_TIMEOUT_MS = 5000;

/**
 * Autosave is debounced and IndexedDB writes are asynchronous, so closing the
 * window straight away can drop the last change or abort a write in flight.
 * The first close is held while the renderer writes pending changes and
 * waits for its save queue (preload answers 'campaign:flush-done' with
 * `{ unsaved }`). If the renderer confirms everything is saved, the window
 * really closes. If changes are still unsaved (a save failed or was refused)
 * or the renderer does not answer in time, the user chooses between keeping
 * the window open and closing without saving; keeping it open re-arms this
 * handshake for the next close. app.quit() goes through here too: it closes
 * windows first, and window-all-closed quits again once this one is gone.
 */
function holdCloseUntilSaved(win: BrowserWindow): void {
  let closing = false;
  let waiting = false;

  win.on('close', (event) => {
    if (closing) return;
    event.preventDefault();
    if (waiting) return;
    waiting = true;

    // Stop listening; `waiting` stays set until the user decides, so a
    // second close attempt while the dialog is up does not stack another.
    const stopWaiting = () => {
      clearTimeout(timer);
      ipcMain.removeListener('campaign:flush-done', onDone);
    };
    const closeNow = () => {
      closing = true;
      if (!win.isDestroyed()) win.close();
    };
    const askBeforeClosing = async (reason: string) => {
      if (win.isDestroyed()) return;
      let response = 0;
      try {
        ({ response } = await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: ['Keep the window open', 'Close without saving'],
          defaultId: 0,
          cancelId: 0,
          title: 'Unsaved changes',
          message: 'Your latest campaign changes are not saved.',
          detail: `${reason} Closing now loses those changes.`,
        }));
      } catch (error) {
        console.error('[Electron] Could not ask about unsaved changes; keeping the window open', error);
      }
      if (response === 1) closeNow();
      else waiting = false;
    };
    const onDone = (doneEvent: Electron.IpcMainEvent, result?: { unsaved?: boolean }) => {
      if (doneEvent.sender !== win.webContents) return;
      stopWaiting();
      if (result?.unsaved === false) {
        closeNow();
      } else {
        void askBeforeClosing('The last save failed or was refused; the banner in the app says why.');
      }
    };
    const timer = setTimeout(() => {
      console.warn('[Electron] Renderer did not confirm its final save in time');
      stopWaiting();
      void askBeforeClosing('The app did not confirm its final save in time.');
    }, CLOSE_FLUSH_TIMEOUT_MS);
    ipcMain.on('campaign:flush-done', onDone);

    if (win.webContents.isDestroyed() || win.webContents.isCrashed()) {
      // Nothing left that could save; there is nobody to ask on its behalf.
      stopWaiting();
      closeNow();
      return;
    }
    win.webContents.send('campaign:flush-request');
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const port = await findFreePort();
      console.log(`[Electron] Starting server on port ${port}...`);
      console.log(`[Electron] Data directory: ${DATA_DIR}`);

      // Dynamically import the ESM server module from CJS context
      const { startServer } = await import(
        /* webpackIgnore: true */
        `file://${SERVER_DIST.replace(/\\/g, '/')}`
      );

      const handle = await startServer({
        port,
        dbDir: DATA_DIR,
        clientDist: CLIENT_DIST,
      });
      serverHandle = handle;

      console.log(`[Electron] Server running on port ${handle.port}`);

      buildMenu(handle.port);
      await createWindow(handle.port);
    } catch (err) {
      console.error('[Electron] Failed to start:', err);
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  // will-quit, not before-quit: a window close can still cancel the quit
  // (holdCloseUntilSaved), and the server must keep running if it does.
  app.on('will-quit', async () => {
    if (serverHandle) {
      console.log('[Electron] Shutting down server...');
      await serverHandle.close();
    }
  });
}
