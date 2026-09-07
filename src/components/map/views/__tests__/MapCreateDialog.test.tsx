import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MapCreateDialog } from '../MapCreateDialog';
import { MAP_SCALES } from '../../../../constants/map';

afterEach(cleanup);
const sourceMap = { id: 'world', name: 'Desert', climate: 'arid' as const, weatherTableId: 'desert-weather', selectedTileId: 'tile' };

function setup(source: typeof sourceMap | (Omit<typeof sourceMap, 'selectedTileId'> & { selectedTileId: null }) | undefined = sourceMap) {
  const onConfirm = vi.fn();
  render(<MapCreateDialog sourceMap={source} onConfirm={onConfirm} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: /Map Name/ }), { target: { value: 'Room' } });
  return onConfirm;
}
const chooseTactical = () => fireEvent.click(screen.getByRole('radio', { name: /^Tactical —/ }));
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Create Map' }));

describe('tactical map creation dialog', () => {
  it('shows all four rungs in their definition order and defaults to Local', () => {
    setup();
    const options = within(screen.getByRole('radiogroup', { name: 'Scale' })).getAllByRole('radio');
    expect(options).toHaveLength(4);
    options.forEach((option, index) => {
      expect(option).toHaveAccessibleName(`${MAP_SCALES[index].label} — ${MAP_SCALES[index].description}`);
      expect(option).toHaveAttribute('aria-checked', index === 1 ? 'true' : 'false');
    });
  });

  it('copies climate once on rung change and emits the link and weather override', () => {
    const onConfirm = setup();
    chooseTactical();
    expect(screen.getByLabelText('Climate')).toHaveValue('arid');
    expect(screen.getByRole('checkbox', { name: 'Link from Desert at the selected tile' })).toBeChecked();
    fireEvent.change(screen.getByLabelText('Climate'), { target: { value: 'arctic' } });
    chooseTactical();
    expect(screen.getByLabelText('Climate')).toHaveValue('arctic');
    confirm();
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Room', scale: '1yd', climate: 'arctic',
      linkFrom: { mapId: 'world', tileId: 'tile' }, weatherTableId: 'desert-weather',
    }));
  });

  it('hides and clears the link when switching back to an overland rung', () => {
    const onConfirm = setup();
    chooseTactical();
    fireEvent.click(screen.getByRole('radio', { name: /^Local/ }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    confirm();
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ scale: '12mi' });
    expect(onConfirm.mock.calls[0][0]).not.toHaveProperty('linkFrom');
    expect(onConfirm.mock.calls[0][0]).not.toHaveProperty('weatherTableId');
  });

  it('supports standalone authoring without a source map', () => {
    const onConfirm = vi.fn();
    render(<MapCreateDialog onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: /Map Name/ }), { target: { value: 'Room' } });
    chooseTactical();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Climate')).toHaveValue('temperate');
    confirm();
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ scale: '1yd' });
    expect(onConfirm.mock.calls[0][0]).not.toHaveProperty('linkFrom');
  });

  it('disables linking with a helpful prompt when no sole tile is selected', () => {
    const onConfirm = setup({ ...sourceMap, selectedTileId: null });
    chooseTactical();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('Select a tile on Desert first')).toBeInTheDocument();
    confirm();
    expect(onConfirm.mock.calls[0][0]).not.toHaveProperty('linkFrom');
  });

  it('allows opting out of the link while retaining the copied climate', () => {
    const onConfirm = setup();
    chooseTactical();
    fireEvent.click(screen.getByRole('checkbox'));
    confirm();
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ scale: '1yd', climate: 'arid' });
    expect(onConfirm.mock.calls[0][0]).not.toHaveProperty('linkFrom');
  });
});
