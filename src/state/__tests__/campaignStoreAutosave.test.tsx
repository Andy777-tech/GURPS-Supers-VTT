import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { CampaignStoreProvider, useCampaignStore } from '../campaignStore';
import { createCampaignState, type CampaignState } from '../campaignReducer';
import {
  saveCampaignState,
  whenCampaignSavesSettled,
  loadCampaignState,
  acknowledgeCampaignLoadIssue,
  resetRevisionGuard,
  CampaignSaveBlockedError,
  CampaignStateConflictError,
  CAMPAIGN_SAVE_FAILED_EVENT,
  CAMPAIGN_SAVE_OK_EVENT,
} from '../../persistence/campaignStorage';

vi.mock('../../persistence/campaignStorage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../persistence/campaignStorage')>()),
  saveCampaignState: vi.fn(),
  whenCampaignSavesSettled: vi.fn(),
}));

const saveMock = vi.mocked(saveCampaignState);
const settledMock = vi.mocked(whenCampaignSavesSettled);

let actions: ReturnType<typeof useCampaignStore>['actions'];

function ActionsProbe() {
  const store = useCampaignStore();
  useEffect(() => {
    actions = store.actions;
  });
  return null;
}

function renderStore() {
  return render(
    <CampaignStoreProvider initialCampaignState={createCampaignState()}>
      <ActionsProbe />
    </CampaignStoreProvider>
  );
}

/** Let the save promise's then/catch handlers run. */
const settle = () => act(async () => { await Promise.resolve(); });

describe('campaign store autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveMock.mockReset();
    saveMock.mockResolvedValue(undefined);
    settledMock.mockReset();
    settledMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetRevisionGuard();
    localStorage.clear();
  });

  it('debounces saves by 500 ms', () => {
    renderStore();
    act(() => actions.setActiveModule('combat'));
    act(() => actions.setActiveModule('map'));

    act(() => { vi.advanceTimersByTime(499); });
    expect(saveMock).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1); });
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect((saveMock.mock.calls[0][0] as CampaignState).ui.activeModule).toBe('map');
  });

  it('flushes a pending save on unmount instead of dropping it', () => {
    const { unmount } = renderStore();
    act(() => actions.setActiveModule('combat'));

    unmount();

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect((saveMock.mock.calls[0][0] as CampaignState).ui.activeModule).toBe('combat');
    // The cancelled debounce timer must not save a second time.
    vi.advanceTimersByTime(1000);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending save on pagehide', () => {
    renderStore();
    act(() => actions.setActiveModule('combat'));

    window.dispatchEvent(new Event('pagehide'));

    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending save when the page becomes hidden', () => {
    renderStore();
    act(() => actions.setActiveModule('combat'));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    document.dispatchEvent(new Event('visibilitychange'));

    expect(saveMock).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it('does not save on unmount or pagehide when nothing is pending', () => {
    const { unmount } = renderStore();
    window.dispatchEvent(new Event('pagehide'));
    unmount();
    expect(saveMock).not.toHaveBeenCalled();
  });

  describe('save health events', () => {
    const listen = (name: string) => {
      const events: CustomEvent[] = [];
      const listener = (event: Event) => events.push(event as CustomEvent);
      window.addEventListener(name, listener);
      return { events, stop: () => window.removeEventListener(name, listener) };
    };

    async function saveOnce(result: Promise<void>) {
      saveMock.mockReturnValueOnce(result);
      renderStore();
      act(() => actions.setActiveModule('combat'));
      act(() => { vi.advanceTimersByTime(500); });
      await settle();
    }

    it('announces a successful save', async () => {
      const ok = listen(CAMPAIGN_SAVE_OK_EVENT);
      await saveOnce(Promise.resolve());
      ok.stop();
      expect(ok.events).toHaveLength(1);
    });

    it('announces an unexpected failure with its message', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const failed = listen(CAMPAIGN_SAVE_FAILED_EVENT);
      await saveOnce(Promise.reject(new Error('disk full')));
      failed.stop();
      expect(failed.events.map((event) => event.detail)).toEqual([{ message: 'disk full' }]);
    });

    it('stays quiet for a blocked save and a cross-tab conflict', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const failed = listen(CAMPAIGN_SAVE_FAILED_EVENT);
      await saveOnce(Promise.reject(new CampaignSaveBlockedError()));
      await saveOnce(Promise.reject(new CampaignStateConflictError(5, 1)));
      failed.stop();
      expect(failed.events).toHaveLength(0);
    });
  });

  describe('changes made while saving was refused', () => {
    const activeModuleOfCall = (index: number) => (saveMock.mock.calls[index][0] as CampaignState).ui.activeModule;

    it('saves them once the user chooses to start fresh', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      localStorage.setItem('campaignState', 'not-valid-json{{{');
      await loadCampaignState();
      saveMock.mockRejectedValueOnce(new CampaignSaveBlockedError());
      renderStore();
      act(() => actions.setActiveModule('combat'));
      act(() => { vi.advanceTimersByTime(500); });
      await settle();
      expect(saveMock).toHaveBeenCalledTimes(1);

      act(() => acknowledgeCampaignLoadIssue());

      expect(saveMock).toHaveBeenCalledTimes(2);
      expect(activeModuleOfCall(1)).toBe('combat');
    });

    it('does not save on a health change when nothing is pending', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      localStorage.setItem('campaignState', 'not-valid-json{{{');
      await loadCampaignState();
      renderStore();

      act(() => acknowledgeCampaignLoadIssue());

      expect(saveMock).not.toHaveBeenCalled();
    });

    it('retries a failed save on pagehide even with no timer pending', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      saveMock.mockRejectedValueOnce(new Error('disk full'));
      renderStore();
      act(() => actions.setActiveModule('combat'));
      act(() => { vi.advanceTimersByTime(500); });
      await settle();

      window.dispatchEvent(new Event('pagehide'));

      expect(saveMock).toHaveBeenCalledTimes(2);
      expect(activeModuleOfCall(1)).toBe('combat');

      // That save succeeded; nothing is dirty any more.
      await settle();
      window.dispatchEvent(new Event('pagehide'));
      expect(saveMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('Electron close flush', () => {
    afterEach(() => {
      delete window.electronAPI;
    });

    function installElectronBridge() {
      const unregister = vi.fn();
      let handler: (() => Promise<CloseFlushResult>) | null = null;
      window.electronAPI = {
        isElectron: true,
        getAppVersion: () => 'test',
        onFlushRequest: vi.fn((registered: () => Promise<CloseFlushResult>) => {
          handler = registered;
          return unregister;
        }),
      };
      return { unregister, request: () => handler!() };
    }

    /**
     * Same contract as the real save queue: saves run one after another, and
     * whenCampaignSavesSettled() resolves once every queued save has finished,
     * failed ones included. Each save waits for the test to finish it.
     */
    function manualSaveQueue() {
      let tail: Promise<void> = Promise.resolve();
      const saves: Array<{ state: CampaignState; finish: () => void; fail: (error: unknown) => void }> = [];
      saveMock.mockImplementation((state) => {
        const run = tail.then(() => new Promise<void>((finish, fail) => { saves.push({ state, finish, fail }); }));
        tail = run.catch(() => undefined);
        return run;
      });
      settledMock.mockImplementation(() => tail);
      return saves;
    }

    const drain = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });

    it('writes the pending change, waits for it, then reports it saved', async () => {
      const bridge = installElectronBridge();
      const saves = manualSaveQueue();
      const { unmount } = renderStore();
      act(() => actions.setActiveModule('combat'));

      let result: CloseFlushResult | null = null;
      void bridge.request().then((r) => { result = r; });
      await drain();
      expect(saves).toHaveLength(1);
      expect(saves[0].state.ui.activeModule).toBe('combat');
      expect(result).toBeNull();

      saves[0].finish();
      await drain();
      expect(result).toEqual({ unsaved: false });
      expect(saveMock).toHaveBeenCalledTimes(1);

      unmount();
      expect(bridge.unregister).toHaveBeenCalledTimes(1);
    });

    it('also saves a change made while the final save was running', async () => {
      const bridge = installElectronBridge();
      const saves = manualSaveQueue();
      renderStore();
      act(() => actions.setActiveModule('combat'));

      let result: CloseFlushResult | null = null;
      void bridge.request().then((r) => { result = r; });
      await drain();
      act(() => actions.setActiveModule('map'));
      saves[0].finish();
      await drain();

      expect(result).toBeNull();
      expect(saves).toHaveLength(2);
      expect(saves[1].state.ui.activeModule).toBe('map');
      saves[1].finish();
      await drain();
      expect(result).toEqual({ unsaved: false });
    });

    it('reports unsaved changes when the final save fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const bridge = installElectronBridge();
      saveMock.mockRejectedValue(new Error('disk full'));
      renderStore();
      act(() => actions.setActiveModule('combat'));

      const result = await act(() => bridge.request());

      expect(result).toEqual({ unsaved: true });
      expect(saveMock).toHaveBeenCalled();
    });

    it('reports unsaved changes while saving is paused', async () => {
      const bridge = installElectronBridge();
      saveMock.mockRejectedValue(new CampaignSaveBlockedError());
      renderStore();
      act(() => actions.setActiveModule('combat'));

      expect(await act(() => bridge.request())).toEqual({ unsaved: true });
    });

    it('reports nothing unsaved without saving when there were no changes', async () => {
      const bridge = installElectronBridge();
      renderStore();

      expect(await act(() => bridge.request())).toEqual({ unsaved: false });
      expect(saveMock).not.toHaveBeenCalled();
    });
  });
});
