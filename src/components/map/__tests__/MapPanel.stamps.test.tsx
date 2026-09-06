import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapPanel } from '../MapPanel';
import { CampaignStoreProvider, useCampaignStore } from '../../../state/campaignStore';
import { imageLayer, imageState } from '../../../assets/__tests__/fixtures';
import type { Map3DViewProps } from '../views/Map3DView';
import { uploadAssetToPeers } from '../../../assets/uploadAssetToPeers';
import { sliceLayerImage } from '../../../assets/sliceLayerImage';
import { importImage } from '../../../assets/importImage';

let view: Map3DViewProps;
let store: ReturnType<typeof useCampaignStore>;
vi.mock('../views/Map3DView', () => ({
  Map3DView: (props: Map3DViewProps) => {
    view = props;
    // Match MapScene's paint pointer-down and non-paint pointer-up routing.
    return <div data-testid="map-view"
      onPointerDown={() => {
        if (props.paintModeActive) props.onTilePaintStart?.(props.map.grid[3][3], 3, 3);
      }}
      onPointerUp={() => {
        if (!props.paintModeActive) props.onTileClick?.(props.map.grid[3][3], 3, 3);
      }} />;
  },
}));
vi.mock('../../../assets/useAssetUrl', () => ({ useAssetUrl: () => 'blob:asset' }));
vi.mock('../../../assets/uploadAssetToPeers', () => ({
  uploadAssetToPeers: vi.fn(async () => {}),
}));
vi.mock('../../../assets/sliceLayerImage', () => ({ sliceLayerImage: vi.fn() }));
vi.mock('../../../assets/importImage', () => ({ importImage: vi.fn() }));
function Observe() {
  store = useCampaignStore();
  return null;
}
function setup(gm = true) {
  const { state, map } = imageState([imageLayer({ assetId: 'asset', x: 2, y: 1 })]);
  state.ui.gmModeEnabled = gm;
  state.maps.stamps = {
    room: {
      id: 'room',
      name: 'Test room',
      category: 'room',
      assetId: 'offline-asset',
      width: 2,
      height: 4,
      placement: 'underlay',
      createdAt: 1,
    },
  };
  render(
    <CampaignStoreProvider initialCampaignState={state}>
      <Observe />
      <MapPanel />
    </CampaignStoreProvider>
  );
  if (gm) fireEvent.click(screen.getByRole('button', { name: 'Stamps' }));
  return { map };
}
const draw = () => act(() => view.onAlignBoxComplete?.({ x: 2, y: 2, width: 4, height: 2 }));
const escape = () => fireEvent.keyDown(window, { key: 'Escape' });
const place = () =>
  fireEvent.click(
    within(screen.getByRole('listitem', { name: 'Test room' })).getByRole('button', {
      name: 'Place',
    })
  );
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MapPanel stamp workflow', () => {
  it('places exactly once through the tile pointer sequence while terrain paint mode is selected', () => {
    const { map } = setup();
    fireEvent.click(screen.getByText('Plains'));
    fireEvent.click(screen.getByTitle('Paint mode'));
    expect(view.paintModeActive).toBe(true);
    const placeSpy = vi.spyOn(store.actions, 'mapPlaceStamp');
    const paintSpy = vi.spyOn(store.actions, 'mapSetTileTerrain');
    const stampTerrainSpy = vi.spyOn(store.actions, 'mapStampTerrain');
    const originalTiles = store.state.maps.mapsById[map.id].tilesById;
    place();
    fireEvent.pointerDown(screen.getByTestId('map-view'), { button: 0, pointerId: 1 });
    fireEvent.pointerUp(screen.getByTestId('map-view'), { button: 0, pointerId: 1 });
    expect(placeSpy).toHaveBeenCalledExactlyOnceWith(map.id, 'room', { col: 3, row: 3 }, 0);
    expect(paintSpy).not.toHaveBeenCalled();
    expect(stampTerrainSpy).not.toHaveBeenCalled();
    expect(store.state.maps.mapsById[map.id].tilesById).toEqual(originalTiles);
  });
  it.each(['draw', 'escape', 'gm-off'] as const)('handles a pending import followed by %s', async (action) => {
    setup();
    let resolveImport: (value: Awaited<ReturnType<typeof importImage>>) => void = () => {};
    vi.mocked(importImage).mockReturnValue(new Promise((resolve) => { resolveImport = resolve; }));
    fireEvent.change(screen.getByLabelText('Import stamp file'), {
      target: { files: [new File(['bytes'], 'Room.png', { type: 'image/png' })] },
    });
    expect(importImage).toHaveBeenCalledOnce();
    if (action === 'draw') fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    else if (action === 'escape') escape();
    else act(() => store.actions.setGmMode(false));
    await act(async () => resolveImport({ assetId: 'pending-import', mime: 'image/jpeg', aspect: 0.5 }));
    const imported = Object.values(store.state.maps.stamps ?? {}).find((stamp) => stamp.assetId === 'pending-import');
    if (action === 'gm-off') expect(imported).toBeUndefined();
    else expect(imported).toMatchObject({ name: 'Room', width: 4, height: 2 });
    if (action === 'draw') {
      expect(view.alignMode).toEqual({ elevation: 1 });
      expect(view.alignPrompt).toContain('measure');
    }
  });
  it('retains the measure box on input Esc and clears it on body Esc', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    draw();
    const input = screen.getByRole('textbox', { name: 'Stamp name' });
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByText('4 × 2 tiles')).toBeInTheDocument();
    input.blur();
    document.body.focus();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByText('4 × 2 tiles')).not.toBeInTheDocument();
    expect(view.measureBox).toBeNull();
  });
  it('retains the measure box when an image alignment handles Esc', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Map images' }));
    fireEvent.click(screen.getByRole('button', { name: /Align 3×3/ }));
    escape();
    expect(view.alignMode).toBeNull();
    expect(screen.getByText('4 × 2 tiles')).toBeInTheDocument();
  });
  it('cancels stamp tools when the header closes the library', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stamps' }));
    expect(view.measureBox).toBeNull();
    expect(view.alignMode).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Stamp library' })).not.toBeInTheDocument();
  });
  it('retains a previous box after a sub-minimum measure drag', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    act(() => view.onAlignBoxComplete?.({ x: 2, y: 2, width: 0.1, height: 0.1 }));
    expect(screen.getByText('4 × 2 tiles')).toBeInTheDocument();
    expect(view.alignMode).toBeNull();
  });
  it('clips a partial slice for pixels and metadata while retaining an unrelated measure box', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    draw();
    vi.mocked(sliceLayerImage).mockResolvedValue({ assetId: 'clipped', mime: 'image/jpeg' });
    fireEvent.click(screen.getByRole('button', { name: 'Slice from layer' }));
    act(() => view.onAlignBoxComplete?.({ x: 4, y: 0, width: 4, height: 5 }));
    await waitFor(() => expect(sliceLayerImage).toHaveBeenCalledWith(
      expect.objectContaining({ x: 2, y: 1, width: 4, height: 3 }),
      { col: 4, row: 1, width: 2, height: 3 }
    ));
    await waitFor(() => expect(Object.values(store.state.maps.stamps ?? {})).toContainEqual(
      expect.objectContaining({ assetId: 'clipped', width: 2, height: 3 })
    ));
    expect(screen.getByText('4 × 2 tiles')).toBeInTheDocument();
  });
  it('reports a disjoint slice without calling the image slicer', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Slice from layer' }));
    act(() => view.onAlignBoxComplete?.({ x: 7, y: 7, width: 2, height: 2 }));
    expect(sliceLayerImage).not.toHaveBeenCalled();
    expect(screen.getByText('The box does not intersect an available layer image.')).toBeInTheDocument();
  });

  it('reuses align drag for one measure, places its rotated fit, uploads, and clears the box', async () => {
    const { map } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    expect(view.alignMode).toEqual({ elevation: 1 });
    expect(view.alignPrompt).toContain('measure');
    draw();
    expect(view.alignMode).toBeNull();
    expect(view.measureBox).toEqual({ col: 2, row: 2, width: 4, height: 2 });
    place();
    expect(view.measureBox).toBeNull();
    expect(store.state.maps.mapsById[map.id].imageLayers?.slice(-1)[0]).toMatchObject({
      x: 2,
      y: 2,
      width: 4,
      height: 2,
      rotation: 90,
    });
    expect(store.state.maps.mapsById[map.id].imageLayers?.slice(-1)[0]?.id).toMatch(/^img_/);
    await waitFor(() => expect(uploadAssetToPeers).toHaveBeenCalledWith('offline-asset'));
  });
  it('arms tile placement ahead of selection and Esc cancels', () => {
    const { map } = setup();
    fireEvent.click(screen.getByTitle('Select mode'));
    place();
    expect(view.paintModeActive).toBe(false);
    expect(screen.getByText('Click a tile to place Test room · Esc cancels')).toBeInTheDocument();
    escape();
    expect(
      screen.queryByText('Click a tile to place Test room · Esc cancels')
    ).not.toBeInTheDocument();
    place();
    act(() => view.onTileClick?.(map.grid[3][3], 3, 3));
    expect(store.state.maps.mapsById[map.id].imageLayers?.slice(-1)[0]).toMatchObject({
      x: 3,
      y: 3,
      rotation: 0,
    });
    expect(view.selectedTileIds).toBeUndefined();
    expect(
      screen.queryByText('Click a tile to place Test room · Esc cancels')
    ).not.toBeInTheDocument();
  });
  it('Esc and changing maps clear the retained highlight and drawing mode', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    escape();
    expect(view.alignMode).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    draw();
    escape();
    expect(view.measureBox).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    draw();
    act(() =>
      store.actions.mapCreateMap({
        name: 'Second',
        scaleMilesPerTile: 12,
        startTerrainId: 'terrain-plains',
        climate: 'temperate',
      })
    );
    const other = Object.values(store.state.maps.mapsById).find((map) => map.name === 'Second');
    act(() => store.actions.mapSetActiveMap(other!.id));
    expect(view.measureBox).toBeNull();
    expect(view.alignMode).toBeNull();
  });
  it('keeps the previous measure highlight while drawing its replacement', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    draw();
    const previous = view.measureBox;
    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    expect(view.measureBox).toBe(previous);
    act(() => view.onAlignBoxComplete?.({ x: 3, y: 3, width: 2, height: 2 }));
    expect(view.measureBox).toEqual({ col: 3, row: 3, width: 2, height: 2 });
  });

  it('preserves image alignment and its Esc handler while the library is open', () => {
    const { map } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Map images' }));
    expect(screen.getByRole('complementary', { name: 'Stamp library' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Align 3×3/ }));
    expect(view.alignMode).toEqual({ elevation: 1 });
    expect(view.alignPrompt).toBeUndefined();
    draw();
    expect(view.measureBox).toBeNull();
    expect(store.state.maps.mapsById[map.id].imageLayers?.[0].width).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: /Align 3×3/ }));
    escape();
    expect(view.alignMode).toBeNull();
  });
  it('imports, copies a shared layer asset, and slices through the drag channel', async () => {
    setup();
    vi.mocked(importImage).mockResolvedValue({
      assetId: 'imported',
      mime: 'image/jpeg',
      aspect: 0.5,
    });
    const file = new File(['bytes'], 'Room.png', { type: 'image/png' });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Width in tiles' }), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText('Import stamp file'), { target: { files: [file] } });
    await waitFor(() =>
      expect(Object.values(store.state.maps.stamps ?? {})).toContainEqual(
        expect.objectContaining({ name: 'Room', width: 3, height: 2, assetId: 'imported' })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'From layer' }));
    expect(Object.values(store.state.maps.stamps ?? {})).toContainEqual(
      expect.objectContaining({ assetId: 'asset', width: 4, height: 3 })
    );
    vi.mocked(sliceLayerImage).mockResolvedValue({ assetId: 'slice', mime: 'image/jpeg' });
    fireEvent.click(screen.getByRole('button', { name: 'Slice from layer' }));
    expect(view.alignPrompt).toContain('slice');
    draw();
    expect(view.alignMode).toBeNull();
    await waitFor(() =>
      expect(Object.values(store.state.maps.stamps ?? {})).toContainEqual(
        expect.objectContaining({
          assetId: 'slice',
          width: 4,
          height: 2,
          footprint: expect.any(Array),
        })
      )
    );
    expect(uploadAssetToPeers).toHaveBeenCalledWith('slice');
  });
  it('finishes an in-flight slice after Esc cancels tools', async () => {
    setup();
    let resolveSlice: (value: { assetId: string; mime: string }) => void = () => {};
    vi.mocked(sliceLayerImage).mockReturnValue(
      new Promise((resolve) => {
        resolveSlice = resolve;
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Slice from layer' }));
    draw();
    escape();
    await act(async () => resolveSlice({ assetId: 'cancelled', mime: 'image/jpeg' }));
    expect(Object.values(store.state.maps.stamps ?? {})).toContainEqual(
      expect.objectContaining({ assetId: 'cancelled' })
    );
  });
  it('hides every stamp tool for players and clears tools when GM mode ends', () => {
    setup();
    place();
    act(() => store.actions.setGmMode(false));
    expect(screen.queryByRole('button', { name: 'Stamps' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Stamp library' })).not.toBeInTheDocument();
    expect(
      screen.queryByText('Click a tile to place Test room · Esc cancels')
    ).not.toBeInTheDocument();
    expect(view.measureBox).toBeNull();
    expect(view.alignMode).toBeNull();
  });
});
