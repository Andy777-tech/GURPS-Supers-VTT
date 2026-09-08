import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CampaignStoreProvider, useCampaignStore } from '../../../state/campaignStore';
import { createCampaignState } from '../../../state/campaignReducer';
import { createNewMap, findTileGridPos } from '../../../utils/mapUtils';
import { useTacticalTokenEditor } from '../TokenEditor';
import { useCombatHistory } from '../../../hooks/useCombatHistory';
import { commitTokenMove } from '../../../utils/commitTokenMove';
import { createSetResourceAction } from '../../../utils/combatActions';
import type { Participant } from '../../../types/combatTracker';

const role = vi.hoisted(() => ({ isGM: true, canEdit: true }));
vi.mock('../../../hooks/useEffectiveRole', () => ({ useEffectiveRole: () => role }));
let editor: ReturnType<typeof useTacticalTokenEditor>;
let store: ReturnType<typeof useCampaignStore>;
let history: ReturnType<typeof useCombatHistory>;
let otherHistory: ReturnType<typeof useCombatHistory>;
function Harness() {
  store = useCampaignStore();
  const map = Object.values(store.state.maps.mapsById)[0];
  editor = useTacticalTokenEditor(map);
  history = useCombatHistory(); otherHistory = useCombatHistory();
  return <>{editor.editor}</>;
}
function setup(combat = false, unplaced = false) {
  role.isGM = true; role.canEdit = true;
  const state = createCampaignState();
  const map = createNewMap({ name: 'Room', scale: '1yd', startTerrainId: 'terrain-plains' });
  state.maps = { ...state.maps, mapsById: { [map.id]: map }, activeMapId: map.id };
  state.ui.gmModeEnabled = true;
  if (combat) {
    map.tokens.pc = { id: 'pc', label: 'Hero', position: { col: 2, row: 2 }, facing: 0, footprint: [[0, 0]] };
    const participant: Participant = { instanceId: 'hero', name: 'Hero', category: 'player', st: 10, dx: 10, iq: 10, ht: 10, hp: 10, fp: 10, mp: 0, basicSpeed: 5, basicMove: 5, tokenRef: { mapId: map.id, tokenId: 'pc' } };
    if (unplaced) { map.tokens = {}; delete participant.tokenRef; }
    state.combat.activeSession = { id: 'fight', name: 'Fight', mapId: map.id, startTime: 1, participants: [participant],
      turnOrder: ['hero'], currentRound: 1, currentTurnIndex: 0, turnDecisions: { '1_0_hero': { maneuverId: 'move' } }, log: [] };
  }
  render(<CampaignStoreProvider initialCampaignState={state}><Harness /></CampaignStoreProvider>);
  return map;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('tactical token authoring', () => {
  it('places a labeled rectangular token, edits facing, and preserves its shape on a label-only save', () => {
    const map = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Place token' }));
    fireEvent.change(screen.getByLabelText('Token label'), { target: { value: 'Ogre' } });
    fireEvent.change(screen.getByLabelText('Token width'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Token height'), { target: { value: '3' } });
    expect(Object.values(store.state.maps.mapsById[map.id].tokens)).toHaveLength(0);
    act(() => { editor.click(map.grid[4][4], 4, 4); });
    let token = Object.values(store.state.maps.mapsById[map.id].tokens)[0];
    expect(token).toMatchObject({ label: 'Ogre', position: { col: 4, row: 4 } }); expect(token.footprint).toHaveLength(6);
    fireEvent.change(screen.getByLabelText('Token label'), { target: { value: 'Large ogre' } });
    fireEvent.change(screen.getByLabelText('Token facing'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save token' }));
    token = store.state.maps.mapsById[map.id].tokens[token.id];
    expect(token.label).toBe('Large ogre'); expect(token.facing).toBe(5); expect(token.footprint).toHaveLength(6);
  });
  it('rejects edge overflow, cancels armed placement, and removes a token', () => {
    const map = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Place token' }));
    fireEvent.change(screen.getByLabelText('Token width'), { target: { value: '2' } });
    act(() => { editor.click(map.grid[0][map.cols - 1], 0, map.cols - 1); });
    expect(screen.getByRole('alert')).toHaveTextContent('inside the map');
    expect(Object.values(store.state.maps.mapsById[map.id].tokens)).toHaveLength(0);
    fireEvent.keyDown(window, { key: 'Escape' }); expect(editor.placing).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Place token' }));
    act(() => { editor.click(map.grid[3][3], 3, 3); });
    fireEvent.click(screen.getByRole('button', { name: 'Remove token' }));
    expect(Object.values(store.state.maps.mapsById[map.id].tokens)).toHaveLength(0);
  });
  it('keeps colliding placement armed without persisting a token, then places a valid retry', () => {
    const map = setup();
    act(() => store.actions.dispatchTokenAction({ type: 'map/addToken', payload: { mapId: map.id,
      token: { id: 'blocker', label: 'Blocker', position: { col: 4, row: 3 }, facing: 0, footprint: [[0, 0], [0, 1], [0, 2]] } } }));
    const before = store.state.maps.mapsById[map.id].tokens;
    fireEvent.click(screen.getByRole('button', { name: 'Place token' }));
    fireEvent.change(screen.getByLabelText('Token label'), { target: { value: 'Ogre' } });
    fireEvent.change(screen.getByLabelText('Token width'), { target: { value: '2' } });
    // The draft's second cell hits the blocker's interior; neither anchor collides.
    act(() => { expect(editor.click(map.grid[4][3], 4, 3)).toBe(true); });
    expect(screen.getByRole('alert')).toHaveTextContent('overlap');
    expect(editor.placing).toBe(true);
    expect(editor.editing).toBe(true);
    expect(screen.getByText('Click a cell to place. Esc cancels.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save token' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select token')).toHaveValue('');
    expect(screen.getByLabelText('Token label')).toHaveValue('Ogre');
    expect(screen.getByLabelText('Token width')).toHaveValue(2);
    expect(store.state.maps.mapsById[map.id].tokens).toEqual(before);
    expect(Object.values(store.state.maps.mapsById[map.id].tokens)).toHaveLength(1);

    act(() => { expect(editor.click(map.grid[6][3], 6, 3)).toBe(true); });
    const tokens = store.state.maps.mapsById[map.id].tokens;
    expect(Object.values(tokens)).toHaveLength(2);
    const placed = Object.values(tokens).find(token => token.id !== 'blocker')!;
    expect(placed).toMatchObject({ label: 'Ogre', position: { col: 3, row: 6 }, footprint: [[0, 0], [1, 0]] });
    expect(tokens.blocker).toEqual(before.blocker);
    expect(editor.placing).toBe(false);
    expect(editor.editing).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Click a cell to place. Esc cancels.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select token')).toHaveValue(placed.id);
    expect(screen.getByRole('button', { name: 'Save token' })).toBeInTheDocument();
  });
  it('retains a rejected resize draft and selection, then saves a valid retry', () => {
    const map = setup(true);
    act(() => store.actions.dispatchTokenAction({ type: 'map/addToken', payload: { mapId: map.id,
      token: { id: 'blocker', label: 'Blocker', position: { col: 4, row: 1 }, facing: 0, footprint: [[0, 0], [0, 1], [0, 2]] } } }));
    act(() => { editor.click(map.grid[2][2], 2, 2); });
    const before = store.state.maps.mapsById[map.id].tokens;
    fireEvent.change(screen.getByLabelText('Token label'), { target: { value: 'Larger hero' } });
    fireEvent.change(screen.getByLabelText('Token width'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save token' }));
    expect(screen.getByRole('alert')).toHaveTextContent('overlap');
    expect(editor.editing).toBe(true);
    expect(editor.placing).toBe(false);
    expect(screen.getByLabelText('Select token')).toHaveValue('pc');
    expect(screen.getByLabelText('Token label')).toHaveValue('Larger hero');
    expect(screen.getByLabelText('Token width')).toHaveValue(3);
    expect(screen.getByRole('button', { name: 'Save token' })).toBeInTheDocument();
    expect(store.state.maps.mapsById[map.id].tokens).toEqual(before);
    expect(Object.values(store.state.maps.mapsById[map.id].tokens)).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('Token width'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save token' }));
    const tokens = store.state.maps.mapsById[map.id].tokens;
    expect(Object.values(tokens)).toHaveLength(2);
    expect(tokens.pc).toMatchObject({ label: 'Larger hero', position: { col: 2, row: 2 }, footprint: [[0, 0], [1, 0]] });
    expect(tokens.blocker).toEqual(before.blocker);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select token')).toHaveValue('pc');
    expect(screen.getByLabelText('Token width')).toHaveValue(2);
    expect(editor.editing).toBe(true);
    expect(editor.placing).toBe(false);
  });
  it('dispatches only a valid changed drop from an occupied interior cell', () => {
    const map = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Place token' }));
    fireEvent.change(screen.getByLabelText('Token width'), { target: { value: '2' } });
    act(() => { editor.click(map.grid[3][3], 3, 3); });
    const dispatch = vi.spyOn(store.actions, 'dispatchTokenAction');
    const before = store.state;
    act(() => { expect(editor.dragStart(map.grid[3][4], 3, 4)).toBe(true); });
    expect(store.state).toBe(before); expect(dispatch).not.toHaveBeenCalled();
    act(() => editor.drop({ tileId: map.grid[3][4], row: 3, col: 4 }, { tileId: map.grid[5][6], row: 5, col: 6 }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(Object.values(store.state.maps.mapsById[map.id].tokens)[0].position).toEqual({ col: 5, row: 5 });
  });
  it('opens existing encounter setup with the exact map intent', () => {
    const map = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Start combat' }));
    expect(store.state.ui.pendingIntent).toEqual({ kind: 'encounter', templateId: null, mapId: map.id });
    expect(store.state.ui.activeModule).toBe('combat');
  });
  it('leaves state and shared history unchanged when a drag hits another footprint interior', () => {
    const map = setup(true);
    act(() => store.actions.dispatchTokenAction({ type: 'map/addToken', payload: { mapId: map.id,
      token: { id: 'blocker', label: 'Blocker', position: { col: 4, row: 3 }, facing: 0, footprint: [[0, 0], [0, 1], [0, 2]] } } }));
    act(() => { editor.dragStart(map.grid[2][2], 2, 2); });
    const before = store.state;
    const beforeHistory = history.history;
    const dispatch = vi.spyOn(store.actions, 'dispatchTokenAction');
    act(() => editor.drop({ tileId: map.grid[2][2], row: 2, col: 2 }, { tileId: map.grid[4][4], row: 4, col: 4 }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(store.state).toBe(before);
    expect(history.history).toBe(beforeHistory);
    expect(otherHistory.history).toBe(beforeHistory);
  });

  it('leaves token, bookkeeping, and history cursor unchanged when another token blocks undo', () => {
    const map = setup(true);
    act(() => { commitTokenMove(store.state, store.actions.dispatchTokenAction, history.recordAction, { type: 'map/moveToken', payload: {
      mapId: map.id, participantId: 'hero', position: { col: 4, row: 4 }, mode: 'combat', costYards: 2, path: [map.grid[4][4]],
    } }); });
    act(() => store.actions.dispatchTokenAction({ type: 'map/addToken', payload: { mapId: map.id,
      token: { id: 'blocker', label: 'Blocker', position: { col: 2, row: 1 }, facing: 0, footprint: [[0, 0], [0, 1], [0, 2]] } } }));
    const before = store.state;
    const beforeHistory = history.history;
    act(() => history.handleUndo());
    expect(history.history).toBe(beforeHistory);
    expect(history.history.cursor).toBe(1);
    expect(store.state).toBe(before);
    expect(store.state.combat.activeSession?.turnDecisions['1_0_hero'].movement).toBeDefined();
  });
  it('hides editing controls in player view and rejects direct drag callbacks', () => {
    const map = setup(true);
    act(() => store.actions.setGmMode(false));
    expect(screen.queryByRole('button', { name: 'Place token' })).not.toBeInTheDocument();
    act(() => { expect(editor.dragStart(map.grid[2][2], 2, 2)).toBe(false); });
    const before = store.state;
    act(() => editor.drop({ tileId: map.grid[2][2], row: 2, col: 2 }, { tileId: map.grid[3][3], row: 3, col: 3 }));
    expect(store.state).toBe(before);
  });
  it('shares movement history between independent hook callers and restores live tokens with decisions', () => {
    const map = setup(true);
    act(() => { commitTokenMove(store.state, store.actions.dispatchTokenAction, history.recordAction, { type: 'map/moveToken', payload: {
      mapId: map.id, participantId: 'hero', position: { col: 3, row: 4 }, mode: 'combat', costYards: 1, path: [map.grid[4][3]],
    } }); });
    expect(otherHistory.history.cursor).toBe(1);
    expect(store.state.combat.activeSession?.turnDecisions['1_0_hero'].movement).toBeDefined();
    act(() => otherHistory.handleUndo());
    expect(store.state.maps.mapsById[map.id].tokens.pc.position).toEqual({ col: 2, row: 2 });
    expect(store.state.combat.activeSession?.turnDecisions['1_0_hero'].movement).toBeUndefined();
    act(() => history.handleRedo());
    expect(store.state.maps.mapsById[map.id].tokens.pc.position).toEqual({ col: 3, row: 4 });
    expect(store.state.combat.activeSession?.turnDecisions['1_0_hero'].movement).toBeDefined();
  });

  it('undoes and redoes initial participant placement without leaving a duplicate token', () => {
    const map = setup(true, true);
    act(() => { commitTokenMove(store.state, store.actions.dispatchTokenAction, history.recordAction, { type: 'map/moveToken', payload: {
      mapId: map.id, participantId: 'hero', position: { col: 3, row: 4 }, mode: 'gm',
    } }); });
    const tokenId = store.state.combat.activeSession?.participants[0].tokenRef?.tokenId;
    expect(Object.keys(store.state.maps.mapsById[map.id].tokens)).toEqual([tokenId]);
    act(() => history.handleUndo());
    expect(store.state.maps.mapsById[map.id].tokens).toEqual({});
    expect(store.state.combat.activeSession?.participants[0].tokenRef).toBeUndefined();
    act(() => history.handleRedo());
    expect(Object.keys(store.state.maps.mapsById[map.id].tokens)).toEqual([tokenId]);
    expect(store.state.combat.activeSession?.participants[0].tokenRef?.tokenId).toBe(tokenId);
  });

  it('keeps history on the same terrain cells after top/left expansion', () => {
    const map = setup(true);
    act(() => { commitTokenMove(store.state, store.actions.dispatchTokenAction, history.recordAction, { type: 'map/moveToken', payload: {
      mapId: map.id, participantId: 'hero', position: { col: 3, row: 4 }, mode: 'combat', costYards: 1, path: [map.grid[4][3]],
    } }); });
    act(() => store.actions.mapSetTileTerrain(map.id, map.grid[0][0], 'terrain-plains'));
    act(() => history.handleUndo());
    let live = store.state.maps.mapsById[map.id];
    expect(live.tokens.pc.position).toEqual(findTileGridPos(live, map.grid[2][2]));
    act(() => history.handleRedo());
    live = store.state.maps.mapsById[map.id];
    expect(live.tokens.pc.position).toEqual(findTileGridPos(live, map.grid[4][3]));
    expect(store.state.combat.activeSession?.turnDecisions['1_0_hero'].movement?.toPosition).toEqual(live.tokens.pc.position);
  });

  it('does not advance history or change bookkeeping when an edited footprint prevents undo', () => {
    const map = setup(true);
    // First move to the edge, then inward; a wider footprint makes the second undo invalid.
    act(() => { commitTokenMove(store.state, store.actions.dispatchTokenAction, history.recordAction, { type: 'map/moveToken', payload: {
      mapId: map.id, participantId: 'hero', position: { col: map.cols - 1, row: 2 }, mode: 'gm',
    } }); });
    act(() => { commitTokenMove(store.state, store.actions.dispatchTokenAction, history.recordAction, { type: 'map/moveToken', payload: {
      mapId: map.id, participantId: 'hero', position: { col: map.cols - 2, row: 2 }, mode: 'combat', costYards: 1, path: [map.grid[2][map.cols - 2]],
    } }); });
    act(() => store.actions.dispatchTokenAction({ type: 'map/updateToken', payload: { mapId: map.id, tokenId: 'pc', changes: { footprint: [[0, 0], [1, 0]] } } }));
    const before = store.state;
    act(() => history.handleUndo());
    expect(history.history.cursor).toBe(2);
    expect(store.state).toBe(before);
    expect(store.state.combat.activeSession?.turnDecisions['1_0_hero'].movement).toBeDefined();
  });

  it('rebases movement when undoing an unrelated combat action after map expansion', () => {
    const map = setup(true);
    act(() => { commitTokenMove(store.state, store.actions.dispatchTokenAction, history.recordAction, { type: 'map/moveToken', payload: {
      mapId: map.id, participantId: 'hero', position: { col: 3, row: 4 }, mode: 'combat', costYards: 1, path: [map.grid[4][3]],
    } }); });
    act(() => {
      history.recordAction(createSetResourceAction('hero', 'HP', 10, 7));
      const combat = store.state.combat.activeSession!;
      store.actions.setCombatActive({ ...combat, participants: combat.participants.map(p => ({ ...p, currentHP: 7 })) });
    });
    act(() => store.actions.mapSetTileTerrain(map.id, map.grid[0][0], 'terrain-plains'));
    act(() => history.handleUndo());
    const live = store.state.maps.mapsById[map.id];
    expect(store.state.combat.activeSession?.participants[0].currentHP).toBe(10);
    expect(store.state.combat.activeSession?.turnDecisions['1_0_hero'].movement?.toPosition).toEqual(findTileGridPos(live, map.grid[4][3]));
    expect(live.tokens.pc.position).toEqual(findTileGridPos(live, map.grid[4][3]));
  });
});
