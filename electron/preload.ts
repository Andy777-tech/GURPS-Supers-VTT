/**
 * Electron preload script — minimal contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

/** Mirrors CloseFlushResult in src/types/electronApi.d.ts. */
interface CloseFlushResult {
  unsaved: boolean;
}

/** Set by the renderer's campaign store; null before it mounts. */
let flushHandler: (() => Promise<CloseFlushResult>) | null = null;

// Always answer, so the main process never waits out its timeout just
// because no campaign is loaded (startup, migration error screen). A
// handler that throws counts as unsaved: main then asks before closing.
ipcRenderer.on('campaign:flush-request', async () => {
  let result: CloseFlushResult = { unsaved: false };
  try {
    if (flushHandler) result = { unsaved: (await flushHandler()).unsaved === true };
  } catch (error) {
    console.error('[preload] Campaign flush before close failed', error);
    result = { unsaved: true };
  } finally {
    ipcRenderer.send('campaign:flush-done', result);
  }
});

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getAppVersion: () => process.versions.electron,
  onFlushRequest: (handler: () => Promise<CloseFlushResult>) => {
    flushHandler = handler;
    return () => {
      if (flushHandler === handler) flushHandler = null;
    };
  },
});
