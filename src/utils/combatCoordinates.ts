const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function migrateLegacyPosition(value: unknown): unknown {
  if (!isRecord(value) || (!Object.prototype.hasOwnProperty.call(value, 'q') && !Object.prototype.hasOwnProperty.call(value, 'r'))) return value;
  const { q, r, ...rest } = value;
  return { ...rest, col: value.col ?? q, row: value.row ?? r };
}

/** Only known movement coordinate fields change; extensions and unchanged branches retain identity. */
export function migrateCombatCoordinates<T>(value: T): T {
  if (Array.isArray(value)) {
    const entries = value.map(migrateCombatCoordinates);
    return (entries.some((entry, i) => entry !== value[i]) ? entries : value) as T;
  }
  if (!isRecord(value)) return value;
  let changed = false;
  const entries = Object.entries(value).map(([key, child]) => {
    const next = key === 'fromPosition' || key === 'toPosition' ? migrateLegacyPosition(child) : migrateCombatCoordinates(child);
    changed ||= next !== child;
    return [key, next];
  });
  return (changed ? Object.fromEntries(entries) : value) as T;
}
