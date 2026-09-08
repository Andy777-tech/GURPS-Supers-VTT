import { useCombatHistory } from '../../hooks/useCombatHistory';
import { commitTokenMove } from '../../utils/commitTokenMove';
import { useEffect, useState } from 'react';
import type { MapModel, MapTokenModel } from '../../types/map';
import { useCampaignStore } from '../../state/campaignStore';
import { campaignReducer } from '../../state/campaignReducer';
import { useEffectiveRole } from '../../hooks/useEffectiveRole';
import { defaultFootprint } from '../../utils/footprints';
import { tokenAtCell, tokenFitsMap } from '../../utils/mapTokenSpatial';
import { buildTacticalTokens } from '../../utils/mapTokens';
import type { TokenDragTile } from './three/MapScene';

const newToken = (): MapTokenModel => ({ id: crypto.randomUUID(), label: 'Token', position: { col: 0, row: 0 }, facing: 0, footprint: defaultFootprint(1, 1) });

/** Tactical authoring state is local; only Save, place, remove, and a changed drop dispatch. */
export function useTacticalTokenEditor(map: MapModel | null | undefined) {
  const { state, actions } = useCampaignStore();
  const { isGM, canEdit } = useEffectiveRole();
  const { history, recordAction, handleUndo, handleRedo } = useCombatHistory();
  const enabled = !!map && map.scale === '1yd' && isGM && canEdit && state.ui.gmModeEnabled;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState<MapTokenModel>(newToken);
  const [error, setError] = useState('');
  useEffect(() => { setSelectedId(null); setPlacing(false); setError(''); }, [map?.id, enabled]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPlacing(false); setSelectedId(null); } };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  const select = (id: string) => {
    const token = map?.tokens?.[id];
    if (token) { setSelectedId(id); setDraft(token); setPlacing(false); setError(''); }
  };
  const click = (_tileId: string, row: number, col: number): boolean => {
    if (!enabled || !map) return false;
    if (placing) {
      const token = { ...draft, position: { row, col } };
      if (!tokenFitsMap(map, token)) { setError('Every occupied cell must be inside the map.'); return true; }
      const action = { type: 'map/addToken', payload: { mapId: map.id, token } } as const;
      // Use the reducer's acceptance rules before changing local editor state.
      if (campaignReducer(state, action) === state) { setError('Cannot place token: its footprint must not overlap another token.'); return true; }
      actions.dispatchTokenAction(action);
      setSelectedId(token.id); setDraft(token); setPlacing(false); setError('');
      return true;
    }
    const token = tokenAtCell(map, row, col, selectedId);
    if (!token) return false;
    select(token.id);
    return true;
  };
  const dragStart = (_tileId: string, row: number, col: number): boolean => {
    if (!enabled || !map || placing) return false;
    const token = tokenAtCell(map, row, col, selectedId);
    if (!token) return false;
    select(token.id);
    return true;
  };
  const drop = (from: TokenDragTile, to: TokenDragTile) => {
    if (!enabled || !map) return;
    const token = tokenAtCell(map, from.row, from.col, selectedId);
    if (!token) return;
    const position = { col: token.position.col + to.col - from.col, row: token.position.row + to.row - from.row };
    if (!tokenFitsMap(map, { ...token, position }) || (position.col === token.position.col && position.row === token.position.row)) return;
    const participant = state.combat.activeSession?.participants.find(p => p.tokenRef?.mapId === map.id && p.tokenRef.tokenId === token.id);
    if (commitTokenMove(state, actions.dispatchTokenAction, recordAction, { type: 'map/moveToken', payload: { mapId: map.id, tokenId: token.id, participantId: participant?.instanceId, position, mode: 'gm' } })) {
      setDraft({ ...token, position });
    }
  };
  const save = () => {
    if (!enabled || !map || !selectedId) return;
    const live = map.tokens[selectedId];
    if (!live || !tokenFitsMap(map, { ...draft, position: live.position })) { setError('Invalid token or footprint outside the map.'); return; }
    const action = { type: 'map/updateToken', payload: { mapId: map.id, tokenId: selectedId,
      changes: { label: draft.label, facing: draft.facing, footprint: draft.footprint, partyCharacterId: draft.partyCharacterId, libraryId: draft.libraryId } } } as const;
    if (campaignReducer(state, action) === state) { setError('Cannot save token: its footprint must not overlap another token.'); return; }
    actions.dispatchTokenAction(action);
    setError('');
  };
  const editor = enabled && map ? <div className="absolute right-3 top-14 z-20 max-h-[calc(100%-4.25rem)] w-60 overflow-y-auto rounded border border-edge bg-surface-0/95 p-3 text-xs text-fg-primary shadow">
    <div className="flex gap-2">
      <button type="button" className="rounded bg-surface-2 p-2" onClick={() => { setDraft(newToken()); setSelectedId(null); setPlacing(true); setError(''); }}>Place token</button>
      <button type="button" className="rounded bg-accent-600 p-2 text-fg-primary" onClick={() => {
        actions.setPendingIntent({ kind: 'encounter', mapId: map.id, templateId: null }); actions.setActiveModule('combat');
      }}>Start combat</button>
    </div>
    {state.combat.activeSession?.mapId === map.id && <div className="mt-2 flex gap-2">
      <button type="button" className="rounded bg-surface-2 p-1 disabled:opacity-40" disabled={history.cursor === 0} onClick={handleUndo}>Undo</button>
      <button type="button" className="rounded bg-surface-2 p-1 disabled:opacity-40" disabled={history.cursor >= history.actions.length} onClick={handleRedo}>Redo</button>
    </div>}
    <label className="mt-2 block">Token<select aria-label="Select token" className="w-full bg-surface-2 p-1" value={selectedId ?? ''} onChange={e => select(e.target.value)}>
      <option value="">Select a token</option>{Object.values(map.tokens ?? {}).map(token => <option key={token.id} value={token.id}>{token.label}</option>)}
    </select></label>
    {(placing || selectedId) && <TokenEditor token={draft} onChange={setDraft}
      links={[...Object.values(state.entities.characters).map(c => ({ value: `party:${c.id}`, label: c.name })),
        ...Object.values(state.entities.combatCharacters).map(c => ({ value: `npc:${c.id}`, label: `${c.name} (NPC template)` }))]} />}
    {placing && <p className="mt-2 text-fg-secondary">Click a cell to place. Esc cancels.</p>}
    {selectedId && <p className="mt-2 text-fg-secondary">Drag to move · Esc leaves token editing.</p>}
    {selectedId && <div className="mt-2 flex gap-2">
      <button type="button" className="rounded bg-accent-600 p-2" onClick={save}>Save token</button>
      <button type="button" className="rounded bg-danger-600 p-2" onClick={() => { actions.dispatchTokenAction({ type: 'map/removeToken', payload: { mapId: map.id, tokenId: selectedId } }); setSelectedId(null); }}>Remove token</button>
    </div>}
    {error && <p role="alert" className="mt-2 text-danger-400">{error}</p>}
  </div> : null;
  const tokens = map ? buildTacticalTokens(state, map.id, isGM && state.ui.gmModeEnabled).map(t => ({ ...t, isSelected: t.id === selectedId })) : [];
  return { editor, tokens, editing: enabled && (placing || selectedId !== null), placing: enabled && placing, click, dragStart, drop };
}

function TokenEditor({ token, onChange, links }: { token: MapTokenModel; onChange: (token: MapTokenModel) => void; links: { value: string; label: string }[] }) {
  const width = Math.max(...token.footprint.map(([x]) => x)) - Math.min(...token.footprint.map(([x]) => x)) + 1;
  const height = Math.max(...token.footprint.map(([, y]) => y)) - Math.min(...token.footprint.map(([, y]) => y)) + 1;
  const resize = (w: number, h: number) => {
    if (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 100 && h <= 100) onChange({ ...token, footprint: defaultFootprint(w, h) });
  };
  return <div className="mt-2 space-y-2">
    <label className="block">Label<input aria-label="Token label" className="w-full bg-surface-2 p-1" value={token.label} onChange={e => onChange({ ...token, label: e.target.value })} /></label>
    <label className="block">Link<select aria-label="Token link" className="w-full bg-surface-2 p-1" value={token.partyCharacterId ? `party:${token.partyCharacterId}` : token.libraryId ? `npc:${token.libraryId}` : ''} onChange={e => {
      const value = e.target.value;
      onChange({ ...token, partyCharacterId: value.startsWith('party:') ? value.slice(6) : undefined, libraryId: value.startsWith('npc:') ? value.slice(4) : undefined });
    }}><option value="">Unlinked</option>{links.map(link => <option key={link.value} value={link.value}>{link.label}</option>)}</select></label>
    <label className="block">Facing<select aria-label="Token facing" className="w-full bg-surface-2 p-1" value={token.facing} onChange={e => onChange({ ...token, facing: Number(e.target.value) })}>
      {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((label, i) => <option key={label} value={i}>{label}</option>)}
    </select></label>
    <div className="flex gap-2"><label>Width<input aria-label="Token width" className="w-full bg-surface-2 p-1" type="number" min="1" max="100" value={width} onChange={e => resize(Number(e.target.value), height)} /></label>
      <label>Height<input aria-label="Token height" className="w-full bg-surface-2 p-1" type="number" min="1" max="100" value={height} onChange={e => resize(width, Number(e.target.value))} /></label></div>
    <p className="text-fg-muted">Changing size replaces the shape with a rectangle.</p>
  </div>;
}
