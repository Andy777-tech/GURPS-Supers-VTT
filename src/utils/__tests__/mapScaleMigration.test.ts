import { describe, expect, it } from 'vitest';
import { migrateData, migrateTo1_6_4 } from '../dataMigrations';

// Legacy keys are intentionally plain string literals for migration honesty.
const fixture = () => ({
  schemaVersion: '1.6.3',
  entities: { characters: { ada: { name: 'Ada' } } },
  maps: {
    activeMapId: 'local',
    mapsById: {
      local: { name: 'Local', scaleMilesPerTile: 12 },
      region: { name: 'Region', scaleMilesPerTile: 50 },
      world: { name: 'World', scaleMilesPerTile: 457 },
      bogus: { name: 'Bogus', scaleMilesPerTile: 7 },
    },
  },
});

describe('map scale schema migration', () => {
  it('rewrites numeric scales, drops legacy keys and preserves unrelated state', () => {
    const input = fixture();
    const result = migrateData(input, '1.6.3', '1.6.4');
    expect(result.schemaVersion).toBe('1.6.4');
    expect(result.maps).toEqual({
      activeMapId: 'local',
      mapsById: {
        local: { name: 'Local', scale: '12mi' },
        region: { name: 'Region', scale: '50mi' },
        world: { name: 'World', scale: '457mi' },
        bogus: { name: 'Bogus', scale: '12mi' },
      },
    });
    expect(result.entities).toBe(input.entities);
    expect(input.maps.mapsById.region.scaleMilesPerTile).toBe(50);
    expect(migrateData(result, '1.6.3', '1.6.4')).toEqual(result);
    expect(migrateTo1_6_4(result)).toBe(result);
  });

  it('retains valid map references, defaults missing/invalid scales and leaves non-records alone', () => {
    const tactical = { scale: '1yd' };
    const input = { maps: { mapsById: {
      tactical, region: { scale: '50mi' }, absent: {}, invalid: { scale: '7mi' },
      numeric: { scale: 50 }, legacy: { scale: '1yd', scaleMilesPerTile: 457 },
      nullMap: null, arrayMap: [], stringMap: 'broken',
    } } };
    const result = migrateTo1_6_4(input);
    expect(result.maps).toEqual({ mapsById: {
      tactical, region: { scale: '50mi' }, absent: { scale: '12mi' }, invalid: { scale: '12mi' },
      numeric: { scale: '50mi' }, legacy: { scale: '1yd' },
      nullMap: null, arrayMap: [], stringMap: 'broken',
    } });
    const maps = result.maps;
    if (!maps || typeof maps !== 'object' || !('mapsById' in maps)) throw new Error('Expected maps');
    const entries = maps.mapsById;
    if (!entries || typeof entries !== 'object' || !('tactical' in entries)) throw new Error('Expected tactical map');
    expect(entries.tactical).toBe(tactical);
    expect(migrateTo1_6_4(result)).toBe(result);
  });

  it.each([{}, { maps: null }, { maps: [] }, { maps: { mapsById: [] } }, { maps: { mapsById: null } }])(
    'returns incomplete map state by reference: %j', (input) => {
      expect(migrateTo1_6_4(input)).toBe(input);
    },
  );

  it('migrates checkpoint snapshots even without live maps and preserves untouched entries', () => {
    const clean = { id: 'clean', snapshot: { maps: { mapsById: { a: { scale: '1yd' } } } } };
    const legacy = { id: 'legacy', snapshot: { maps: { mapsById: { a: { scaleMilesPerTile: 50 } } } } };
    const malformed = [null, [], 'broken', {}, { snapshot: null }, { snapshot: [] },
      { snapshot: {} }, { snapshot: { maps: null } }, { snapshot: { maps: [] } },
      { snapshot: { maps: { mapsById: [] } } }];
    const input = { checkpoints: { entries: [legacy, clean, ...malformed] } };
    const result = migrateData(input, '1.6.3', '1.6.4');
    const checkpoints = result.checkpoints as typeof input.checkpoints;
    expect(checkpoints.entries[0]).toEqual({
      id: 'legacy', snapshot: { maps: { mapsById: { a: { scale: '50mi' } } } },
    });
    expect(checkpoints.entries[1]).toBe(clean);
    malformed.forEach((entry, index) => expect(checkpoints.entries[index + 2]).toBe(entry));
    expect(legacy.snapshot.maps.mapsById.a).toHaveProperty('scaleMilesPerTile', 50);
    expect(migrateData(result, '1.6.3', '1.6.4')).toEqual(result);
    expect(migrateTo1_6_4(result)).toBe(result);
  });

  it('returns already migrated data by reference for all valid rungs', () => {
    const input = { maps: { mapsById: {
      a: { scale: '1yd' }, b: { scale: '12mi' }, c: { scale: '50mi' }, d: { scale: '457mi' },
    } } };
    expect(migrateTo1_6_4(input)).toBe(input);
  });
});
