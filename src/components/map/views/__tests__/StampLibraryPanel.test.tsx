import '@testing-library/jest-dom';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StampLibraryPanel } from '../StampLibraryPanel';
import type { StampLibraryPanelProps } from '../StampLibraryPanel';
import type { MapStamp } from '../../../../types/map';
import { imageLayer, imageState } from '../../../../assets/__tests__/fixtures';

vi.mock('../../../../assets/useAssetUrl', () => ({ useAssetUrl: () => 'blob:stamp' }));
afterEach(cleanup);
const base: MapStamp = {
  id: 'a',
  name: 'Room A',
  assetId: 'asset',
  category: 'room',
  width: 4,
  height: 2,
  placement: 'underlay',
  createdAt: 1,
};
function setup(overrides: Partial<StampLibraryPanelProps> = {}) {
  const props: StampLibraryPanelProps = {
    map: imageState([imageLayer()]).map,
    stamps: [
      base,
      { ...base, id: 'b', name: 'Hall B', category: 'hallway', width: 2, height: 4 },
      { ...base, id: 'c', name: 'Room C', width: 5, height: 5 },
    ],
    measureBox: { col: 1, row: 1, width: 4, height: 2 },
    measuring: false,
    slicingLayerId: null,
    placingStampId: null,
    category: 'all',
    onlyFitting: true,
    onStartMeasure: vi.fn(),
    onClearBox: vi.fn(),
    onSetCategory: vi.fn(),
    onSetOnlyFitting: vi.fn(),
    onPlace: vi.fn(),
    onUpdateStamp: vi.fn(),
    onRemoveStamp: vi.fn(),
    onImportFile: vi.fn(),
    onStampFromLayer: vi.fn(),
    onStartSlice: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  function Harness() {
    const [category, setCategory] = useState(props.category);
    const [onlyFitting, setOnlyFitting] = useState(props.onlyFitting);
    return (
      <StampLibraryPanel
        {...props}
        category={category}
        onlyFitting={onlyFitting}
        onSetCategory={(value) => {
          props.onSetCategory(value);
          setCategory(value);
        }}
        onSetOnlyFitting={(value) => {
          props.onSetOnlyFitting(value);
          setOnlyFitting(value);
        }}
      />
    );
  }
  render(<Harness />);
  return props;
}
describe('StampLibraryPanel', () => {
  it('shows fits and reports the rotated fit to Place', () => {
    const props = setup();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('4 × 2 tiles')).toBeInTheDocument();
    const row = screen.getByRole('listitem', { name: 'Hall B' });
    expect(within(row).getByText('rotated')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Place' }));
    expect(props.onPlace).toHaveBeenCalledWith('b', 90);
    fireEvent.click(
      within(screen.getByRole('listitem', { name: 'Room A' })).getByRole('button', {
        name: 'Place',
      })
    );
    expect(props.onPlace).toHaveBeenCalledWith('a', 0);
  });
  it('shows non-fitting stamps when unchecked and filters by category chip', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Only fitting' }));
    expect(props.onSetOnlyFitting).toHaveBeenCalledWith(false);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Hallway' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('listitem', { name: 'Hall B' })).toBeInTheDocument();
  });
  it('imports a file with the entered tile width', () => {
    const props = setup();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Width in tiles' }), {
      target: { value: '3' },
    });
    const file = new File(['image'], 'room.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Import stamp file'), { target: { files: [file] } });
    expect(props.onImportFile).toHaveBeenCalledExactlyOnceWith(file, 3);
  });
  it('passes row edits, deletion, measure and layer actions through callbacks', () => {
    const props = setup({ placingStampId: 'a' });
    const row = screen.getByRole('listitem', { name: 'Room A' });
    expect(row).toHaveClass('border-accent-500');
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: 'New name' } });
    expect(props.onUpdateStamp).toHaveBeenCalledWith('a', { name: 'New name' });
    fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'stairs' } });
    expect(props.onUpdateStamp).toHaveBeenCalledWith('a', { category: 'stairs' });
    fireEvent.click(within(row).getByRole('button', { name: 'Delete Room A' }));
    expect(props.onRemoveStamp).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    expect(props.onStartMeasure).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(props.onClearBox).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'From layer' }));
    expect(props.onStampFromLayer).toHaveBeenCalledWith('image');
    fireEvent.click(screen.getByRole('button', { name: 'Slice from layer' }));
    expect(props.onStartSlice).toHaveBeenCalledWith('image');
  });
  it('shows every stamp without a box and hides layer imports on an empty map', () => {
    setup({ measureBox: null, map: imageState([]).map });
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'From layer' })).not.toBeInTheDocument();
    expect(screen.queryByText('rotated')).not.toBeInTheDocument();
  });
});
