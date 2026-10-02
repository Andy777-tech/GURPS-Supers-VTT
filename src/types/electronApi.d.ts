/** What the renderer reports back before the window closes. */
interface CloseFlushResult {
  /** True when the latest changes are not confirmed saved. */
  unsaved: boolean;
}

/** Bridge exposed by electron/preload.ts; absent in the browser build. */
interface ElectronAPI {
  isElectron: true;
  getAppVersion: () => string;
  /**
   * Run `handler` when the window is about to close; the window stays open
   * until it settles (or a timeout passes). If it reports unsaved changes,
   * or throws, the user is asked before the window closes. Returns an
   * unregister function.
   */
  onFlushRequest?: (handler: () => Promise<CloseFlushResult>) => () => void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
