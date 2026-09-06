import '@testing-library/jest-dom';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageLayersDialog } from '../ImageLayersDialog';
import { defaultFootprint } from '../../../../utils/footprints';
import { createNewMap } from '../../../../utils/mapUtils';
import type { MapImageLayer } from '../../../../types/map';
import * as imageImport from '../../../../assets/importImage';
import * as assetStore from '../../../../assets/assetStore';
import { connectionManager } from '../../../../net/ConnectionManager';
import { Role } from '../../../../../shared/session';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const makeLayer = (overrides: Partial<MapImageLayer> = {}): MapImageLayer => ({
  id: 'img-1',
  name: 'Battlemap',
  src: 'data:image/jpeg;base64,xyz',
  placement: 'underlay',
  opacity: 1,
  visible: true,
  gmOnly: false,
  x: 1.4,
  y: 2.6,
  width: 8.3,
  height: 5.7,
  elevation: 1,
  ...overrides,
});

describe('ImageLayersDialog asset upload', () => {
  it.each([
    ['connected', Role.GM, true],
    ['offline', Role.GM, false],
    ['connected', Role.Player, false],
  ] as const)('uploads after import for status %s and role %s: %s', async (status, role, shouldUpload) => {
    const id = 'a'.repeat(64);
    const bytes = new Uint8Array([1, 2, 3]);
    vi.spyOn(imageImport, 'importImage').mockResolvedValue({ assetId: id, mime: 'image/png', aspect: 1 });
    const store = assetStore.createMemoryAssetStore();
    vi.spyOn(store, 'get').mockResolvedValue({ id, bytes, mime: 'image/png', size: 3, createdAt: 1 });
    vi.spyOn(assetStore, 'getAssetStore').mockReturnValue(store);
    vi.spyOn(connectionManager, 'status', 'get').mockReturnValue(status);
    vi.spyOn(connectionManager, 'role', 'get').mockReturnValue(role);
    const upload = vi.spyOn(connectionManager, 'uploadAsset').mockRejectedValue(new Error('offline'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onAddLayer = vi.fn();
    const map = createNewMap({ name: 'M', scaleMilesPerTile: 12, startTerrainId: 'terrain-plains' });
    render(<ImageLayersDialog map={map} onAddLayer={onAddLayer} onUpdateLayer={vi.fn()} onRemoveLayer={vi.fn()} onRotateLayer={vi.fn()} onStartAlign={vi.fn()} onSetFootprint={vi.fn()} onEditFootprint={vi.fn()} onClose={vi.fn()} />);
    const input = document.querySelector('input[type="file"]');
    if (!input) throw new Error('Missing file input');
    fireEvent.change(input, { target: { files: [new File([bytes], 'map.png', { type: 'image/png' })] } });
    await waitFor(() => expect(onAddLayer).toHaveBeenCalledOnce());
    if (shouldUpload) {
      await waitFor(() => expect(log).toHaveBeenCalledWith('[ImageLayersDialog] Failed to upload map image:', expect.any(Error)));
      expect(upload).toHaveBeenCalledExactlyOnceWith(id, bytes, 'image/png');
    } else {
      expect(upload).not.toHaveBeenCalled();
    }
    expect(onAddLayer.mock.calls[0][0]).toMatchObject({ assetId: id, mime: 'image/png' });
    expect(screen.queryByText('offline')).not.toBeInTheDocument();
  });
});

function mount(layer: MapImageLayer) {
  const map = createNewMap({ name: 'M', scaleMilesPerTile: 12, startTerrainId: 'terrain-plains' });
  map.imageLayers = [layer];
  const onUpdateLayer = vi.fn();
  const onStartAlign = vi.fn();
  const onRemoveLayer = vi.fn();
  const onRotateLayer = vi.fn();
  const onSetFootprint = vi.fn();
  const onEditFootprint = vi.fn();
  render(
    <ImageLayersDialog
      map={map}
      onAddLayer={vi.fn()}
      onUpdateLayer={onUpdateLayer}
      onRemoveLayer={onRemoveLayer}
      onRotateLayer={onRotateLayer}
      onSetFootprint={onSetFootprint}
      onEditFootprint={onEditFootprint}
      onStartAlign={onStartAlign}
      onClose={vi.fn()}
    />
  );
  return { map, onUpdateLayer, onStartAlign, onRemoveLayer, onRotateLayer, onSetFootprint, onEditFootprint };
}

describe('ImageLayersDialog size-to-grid', () => {
  it('applies the entered grid dimensions and snaps the corner to a tile', () => {
    const { onUpdateLayer } = mount(makeLayer());

    fireEvent.change(screen.getByLabelText(/grid cols/i), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText(/grid rows/i), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: /size to grid/i }));

    expect(onUpdateLayer).toHaveBeenCalledWith('img-1', {
      width: 30,
      height: 20,
      x: 1,
      y: 3,
    });
  });

  it('snap rounds position and size to whole tiles', () => {
    const { onUpdateLayer } = mount(makeLayer());

    fireEvent.click(screen.getByRole('button', { name: /snap/i }));

    expect(onUpdateLayer).toHaveBeenCalledWith('img-1', {
      x: 1,
      y: 3,
      width: 8,
      height: 6,
    });
  });

  it('fit map stretches the layer across the whole grid', () => {
    const { map, onUpdateLayer } = mount(makeLayer());

    fireEvent.click(screen.getByRole('button', { name: /fit map/i }));

    expect(onUpdateLayer).toHaveBeenCalledWith('img-1', {
      x: 0,
      y: 0,
      width: map.cols,
      height: map.rows,
    });
  });

  it('prefills the grid inputs from the layer size', () => {
    mount(makeLayer({ width: 12, height: 9 }));
    expect(screen.getByLabelText(/grid cols/i)).toHaveValue(12);
    expect(screen.getByLabelText(/grid rows/i)).toHaveValue(9);
  });

  it('width edits resize around the center: x shifts by half the width change', () => {
    const { onUpdateLayer } = mount(makeLayer({ x: 1.4, width: 8.3 }));

    fireEvent.change(screen.getByLabelText(/^width$/i), { target: { value: '10.3' } });

    expect(onUpdateLayer).toHaveBeenCalledWith('img-1', { width: 10.3, x: 0.4 });
  });

  it('height edits resize around the center: y shifts by half the height change', () => {
    const { onUpdateLayer } = mount(makeLayer({ y: 2.6, height: 5.7 }));

    fireEvent.change(screen.getByLabelText(/^height$/i), { target: { value: '3.7' } });

    expect(onUpdateLayer).toHaveBeenCalledWith('img-1', { height: 3.7, y: 3.6 });
  });

  it('starts align mode for the layer when Align 3×3 is clicked', () => {
    const { onStartAlign } = mount(makeLayer());

    fireEvent.click(screen.getByRole('button', { name: /align 3×3/i }));

    expect(onStartAlign).toHaveBeenCalledWith('img-1');
  });
});

describe('ImageLayersDialog transforms and locking', () => {
  it('disables geometry and deletion while locked, and allows unlocking', () => {
    const { onRemoveLayer, onUpdateLayer, onRotateLayer, onStartAlign } = mount(makeLayer({ locked: true }));
    expect(screen.getByText('Locked')).toBeInTheDocument();
    for (const label of ['X (col)', 'Y (row)', 'Width', 'Height', 'Elev', 'Grid cols', 'Grid rows']) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    for (const name of ['Delete image', 'Align 3×3', 'Size to grid', 'Snap', 'Fit map', 'Rotate clockwise', 'Rotate counter-clockwise', 'Mirror horizontally', 'Mirror vertically']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(screen.getByRole('button', { name: 'Delete image' })).toHaveAttribute('title', 'Unlock to delete');
    expect(onRemoveLayer).not.toHaveBeenCalled();
    expect(onRotateLayer).not.toHaveBeenCalled();
    expect(onStartAlign).not.toHaveBeenCalled();
    expect(onUpdateLayer).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(screen.getByLabelText('Placement')).toBeEnabled();
    expect(screen.getByRole('slider')).toBeEnabled();
    expect(screen.getByLabelText('GM only')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Hide image' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Unlock image' }));
    expect(onUpdateLayer).toHaveBeenCalledWith('img-1', { locked: false });
  });

  it('dispatches rotation, mirror, and lock changes for an unlocked layer', () => {
    const { onRotateLayer, onUpdateLayer } = mount(makeLayer());
    fireEvent.click(screen.getByRole('button', { name: 'Rotate clockwise' }));
    expect(onRotateLayer).toHaveBeenCalledWith('img-1', 'cw');
    fireEvent.click(screen.getByRole('button', { name: 'Rotate counter-clockwise' }));
    expect(onRotateLayer).toHaveBeenCalledWith('img-1', 'ccw');
    fireEvent.click(screen.getByRole('button', { name: 'Mirror horizontally' }));
    expect(onUpdateLayer).toHaveBeenCalledWith('img-1', { mirrorX: true });
    fireEvent.click(screen.getByRole('button', { name: 'Mirror vertically' }));
    expect(onUpdateLayer).toHaveBeenCalledWith('img-1', { mirrorY: true });
    fireEvent.click(screen.getByRole('button', { name: 'Lock image' }));
    expect(onUpdateLayer).toHaveBeenCalledWith('img-1', { locked: true });
  });

  it('shows rotation and active mirror toggles', () => {
    const { onUpdateLayer } = mount(makeLayer({ rotation: 90, mirrorX: true, mirrorY: true }));
    expect(screen.getByText('90°')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mirror horizontally' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mirror vertically' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Mirror horizontally' }));
    expect(onUpdateLayer).toHaveBeenCalledWith('img-1', { mirrorX: false });
  });
});

describe('ImageLayersDialog footprints', () => {
  it('enables a whole-box footprint', () => {
    const { onSetFootprint } = mount(makeLayer({ width: 4, height: 3 }));
    const enable = screen.getByRole('button', { name: 'Enable footprint' });
    expect(enable).toHaveAttribute('title', 'Give this image a tile footprint (snaps it to whole tiles)');
    fireEvent.click(enable);
    expect(onSetFootprint).toHaveBeenCalledWith('img-1', defaultFootprint(4, 3));
  });

  it('shows the cell count, enters editing, resets, and removes the footprint', () => {
    const { onSetFootprint, onEditFootprint } = mount(makeLayer({ width: 4, height: 3, footprint: defaultFootprint(4, 3) }));
    expect(screen.getByText('12 tiles')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit shape' }));
    expect(onEditFootprint).toHaveBeenCalledWith('img-1');
    fireEvent.click(screen.getByRole('button', { name: 'Reset to box' }));
    expect(onSetFootprint).toHaveBeenLastCalledWith('img-1', defaultFootprint(4, 3));
    fireEvent.click(screen.getByRole('button', { name: 'Remove footprint' }));
    expect(onSetFootprint).toHaveBeenLastCalledWith('img-1', undefined);
  });

  it.each([false, true])('disables footprint controls while locked (enabled=%s)', (enabled) => {
    const { onSetFootprint, onEditFootprint } = mount(makeLayer({ locked: true, footprint: enabled ? defaultFootprint(4, 3) : undefined }));
    for (const name of enabled ? ['Edit shape', 'Reset to box', 'Remove footprint'] : ['Enable footprint']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(onSetFootprint).not.toHaveBeenCalled();
    expect(onEditFootprint).not.toHaveBeenCalled();
  });
});
