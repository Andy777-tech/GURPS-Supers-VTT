import { useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { ImageLayerId, MapModel, MapStamp, StampCategory, StampId } from '../../../types/map';
import type { MeasureBox } from '../../../utils/stamps';
import { filterStamps, STAMP_CATEGORIES } from '../../../utils/stamps';
import { useAssetUrl } from '../../../assets/useAssetUrl';

export interface StampLibraryPanelProps {
  map: MapModel;
  stamps: MapStamp[];
  measureBox: MeasureBox | null;
  measuring: boolean;
  slicingLayerId: ImageLayerId | null;
  placingStampId: StampId | null;
  category: StampCategory | 'all';
  onlyFitting: boolean;
  onStartMeasure(): void;
  onClearBox(): void;
  onSetCategory(c: StampCategory | 'all'): void;
  onSetOnlyFitting(v: boolean): void;
  onPlace(stampId: StampId, rotation: 0 | 90): void;
  onUpdateStamp(
    stampId: StampId,
    changes: Partial<Pick<MapStamp, 'name' | 'category' | 'placement'>>
  ): void;
  onRemoveStamp(stampId: StampId): void;
  onImportFile(file: File, widthTiles: number): void;
  onStampFromLayer(layerId: ImageLayerId): void;
  onStartSlice(layerId: ImageLayerId): void;
  onClose(): void;
}

const button =
  'rounded bg-surface-2 px-2 py-1 text-xs text-fg-primary hover:bg-surface-3 disabled:opacity-50';
const input =
  'min-w-0 rounded border border-edge-strong bg-surface-0 px-1.5 py-1 text-xs text-fg-primary';
const labels = {
  all: 'All',
  background: 'Background',
  room: 'Room',
  hallway: 'Hallway',
  stairs: 'Stairs',
};

function StampRow({
  stamp,
  rotation,
  props,
}: {
  stamp: MapStamp;
  rotation: 0 | 90;
  props: StampLibraryPanelProps;
}) {
  const url = useAssetUrl(stamp);
  return (
    <li
      aria-label={stamp.name}
      className={`space-y-2 rounded border p-2 ${props.placingStampId === stamp.id ? 'border-accent-500 bg-accent-900/30' : 'border-edge bg-surface-0/50'}`}
    >
      <div className="flex items-center gap-2">
        <img src={url ?? undefined} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
        <input
          aria-label="Stamp name"
          className={`${input} w-full`}
          value={stamp.name}
          onChange={(event) => props.onUpdateStamp(stamp.id, { name: event.target.value })}
        />
      </div>
      <div className="flex items-center gap-2">
        <select
          aria-label="Stamp category"
          className={input}
          value={stamp.category}
          onChange={(event) => {
            const category = STAMP_CATEGORIES.find((value) => value === event.target.value);
            if (category) props.onUpdateStamp(stamp.id, { category });
          }}
        >
          {STAMP_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {labels[category]}
            </option>
          ))}
        </select>
        <span className="text-xs text-fg-muted">
          {stamp.width}×{stamp.height}
        </span>
        {rotation === 90 && <span className="text-xs text-fg-secondary">rotated</span>}
      </div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="rounded bg-accent-600 px-3 py-1 text-xs text-fg-primary hover:bg-accent-500"
          onClick={() => props.onPlace(stamp.id, rotation)}
        >
          Place
        </button>
        <button
          type="button"
          aria-label={`Delete ${stamp.name}`}
          className="rounded p-1 text-fg-muted hover:bg-surface-2 hover:text-danger-400"
          onClick={() => props.onRemoveStamp(stamp.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

export function StampLibraryPanel(props: StampLibraryPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [widthTiles, setWidthTiles] = useState(4);
  const [fromLayerId, setFromLayerId] = useState('');
  const [sliceLayerId, setSliceLayerId] = useState('');
  const layers = props.map.imageLayers ?? [];
  const fromId = layers.find((layer) => layer.id === fromLayerId)?.id ?? layers[0]?.id ?? '';
  const sliceId = layers.find((layer) => layer.id === sliceLayerId)?.id ?? layers[0]?.id ?? '';
  const rows = filterStamps(props.stamps, {
    box: props.measureBox,
    category: props.category,
    onlyFitting: props.onlyFitting,
  });
  const layerSelect = (label: string, value: string, onChange: (id: string) => void) => (
    <select
      aria-label={label}
      className={`${input} w-full`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {layers.map((layer) => (
        <option key={layer.id} value={layer.id}>
          {layer.name}
        </option>
      ))}
    </select>
  );
  return (
    <aside
      aria-label="Stamp library"
      className="w-72 shrink-0 space-y-4 overflow-y-auto border-l border-edge bg-surface-1 p-3 text-fg-primary"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Stamp library</h2>
        <button
          type="button"
          aria-label="Close stamp library"
          onClick={props.onClose}
          className={button}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <section className="space-y-2">
        <h3 className="text-xs font-semibold">Measure</h3>
        <button type="button" className={button} onClick={props.onStartMeasure}>
          {props.measuring ? 'Drawing… Esc cancels' : 'Draw box'}
        </button>
        {props.measureBox && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span>
                {props.measureBox.width} × {props.measureBox.height} tiles
              </span>
              <button type="button" className={button} onClick={props.onClearBox}>
                Clear
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={props.onlyFitting}
                onChange={(event) => props.onSetOnlyFitting(event.target.checked)}
              />
              Only fitting
            </label>
          </>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-xs font-semibold">Filter</h3>
        <div className="flex flex-wrap gap-1">
          {(['all', ...STAMP_CATEGORIES] as const).map((category) => (
            <button
              key={category}
              type="button"
              aria-pressed={props.category === category}
              className={`${button} ${props.category === category ? 'bg-accent-900/30' : ''}`}
              onClick={() => props.onSetCategory(category)}
            >
              {labels[category]}
            </button>
          ))}
        </div>
      </section>
      <section className="space-y-2">
        <h3 className="text-xs font-semibold">Stamps</h3>
        {rows.length ? (
          <ul className="space-y-2">
            {rows.map(({ stamp, rotation }) => (
              <StampRow key={stamp.id} stamp={stamp} rotation={rotation} props={props} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-fg-muted">
            No stamps match. Import an image or add a layer to get started.
          </p>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-xs font-semibold">Add</h3>
        <label className="flex items-center gap-2 text-xs">
          Width in tiles
          <input
            type="number"
            min={1}
            step={1}
            value={widthTiles}
            className={`${input} w-16`}
            onChange={(event) => {
              if (Number.isFinite(event.target.valueAsNumber))
                setWidthTiles(Math.max(1, Math.round(event.target.valueAsNumber)));
            }}
          />
        </label>
        <input
          ref={fileInput}
          aria-label="Import stamp file"
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) props.onImportFile(file, widthTiles);
            event.target.value = '';
          }}
        />
        <button type="button" className={button} onClick={() => fileInput.current?.click()}>
          Import file…
        </button>
        {layers.length > 0 && (
          <>
            {layerSelect('From layer', fromId, setFromLayerId)}
            <button type="button" className={button} onClick={() => props.onStampFromLayer(fromId)}>
              From layer
            </button>
            {layerSelect('Slice from layer', sliceId, setSliceLayerId)}
            <button type="button" className={button} onClick={() => props.onStartSlice(sliceId)}>
              {props.slicingLayerId
                ? 'Draw the tile box to slice… Esc cancels'
                : 'Slice from layer'}
            </button>
          </>
        )}
      </section>
    </aside>
  );
}
