import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CampaignStoreProvider, useCampaignStore } from '../../../state/campaignStore';
import { createCampaignState } from '../../../state/campaignReducer';
import { createNewMap } from '../../../utils/mapUtils';
import { CombatTab } from '../../CombatTab';
import { ToastProvider } from '../../ui/Toast';

vi.mock('../../../hooks/useEffectiveRole', () => ({ useEffectiveRole: () => ({ isGM: true, canEdit: true }) }));
vi.mock('../CharacterLibrary', () => ({ default: () => <div>Library content</div> }));
vi.mock('../CombatTracker', () => ({ default: () => <div>Tracker content</div> }));
vi.mock('../CombatHistory', () => ({ default: () => null }));
vi.mock('../CombatRulesSettings', () => ({ default: () => null }));

let store: ReturnType<typeof useCampaignStore>;
function Probe() { store = useCampaignStore(); return null; }
afterEach(cleanup);

it('keeps fresh combat navigation on populated map setup after consuming its intent', async () => {
  const state = createCampaignState();
  const map = createNewMap({ name: 'Staged room', scale: '1yd', startTerrainId: 'terrain-plains' });
  map.tokens.guard = { id: 'guard', label: 'Staged guard', libraryId: 'guard', position: { col: 2, row: 2 }, facing: 0, footprint: [[0, 0]] };
  state.maps = { ...state.maps, mapsById: { [map.id]: map }, activeMapId: map.id };
  state.entities.combatCharacters.guard = { id: 'guard', name: 'Guard', category: 'enemy', isNPC: true, maxHP: 10, skills: {}, weapons: [], st: 10, dx: 10, iq: 10, ht: 10, hp: 10, fp: 10, mp: 0, basicSpeed: 5, basicMove: 5, dodge: 8, dr: 0 };
  state.ui.gmModeEnabled = true;
  state.ui.pendingIntent = { kind: 'encounter', templateId: null, mapId: map.id };
  render(<CampaignStoreProvider initialCampaignState={state}><ToastProvider><Probe /><CombatTab /></ToastProvider></CampaignStoreProvider>);
  await waitFor(() => expect(store.state.ui.pendingIntent).toBeNull());
  expect(screen.getByRole('heading', { name: 'Encounter Setup' })).toBeInTheDocument();
  expect(screen.getByLabelText('Combat map')).toHaveValue(map.id);
  expect(screen.getAllByText('Staged guard').length).toBeGreaterThan(0);
  const start = screen.getByRole('button', { name: 'Start Combat' });
  expect(start).toBeEnabled();
  fireEvent.click(start);
  expect(store.state.combat.activeSession?.mapId).toBe(map.id);
  expect(store.state.combat.activeSession?.participants[0].tokenRef).toEqual({ mapId: map.id, tokenId: 'guard' });
});
