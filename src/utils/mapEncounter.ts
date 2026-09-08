import type { Character as PartyCharacter } from '../types/campaign';
import type { ConditionInstance, Participant } from '../types/combatTracker';
import type { MapModel } from '../types/map';
import type { CampaignState } from '../state/campaignReducer';
import { DEFAULT_HIT_LOCATION_PROFILE } from '../types/characterSheet';
import { calculateCharacterEncumbrance, calculateLocationDR } from './encumbrance';
import { seedParticipantFromStatus } from './injuryPersistence';
import { createNumberedEnemies } from './combatHelpers';
import { tokenFitsMap } from './mapTokenSpatial';
interface Attack {
  name: string;
  skill: number;
  damage?: string;
  notes?: string;
}

export interface CombatSetupCharacter {
  id: string;
  name: string;
  category: string;
  st: number;
  dx: number;
  iq: number;
  ht: number;
  hp: number;
  fp?: number;
  mp?: number;
  basicSpeed?: number;
  basicMove?: number;
  dodge: number;
  parry?: number;
  block?: number;
  dr: number;
  hitLocationProfileId?: string;
  drByLocation?: Record<string, number>;
  attacks?: Attack[];
  notes?: string;
  // Party character integration
  isFromParty?: boolean;
  partyCharacterId?: string;
  // Phase 12a: images and encumbrance
  tokenImage?: string;
  armorByLocation?: Array<{ location: string; dr: number }>;
  encumbranceDodge?: number;
  encumbranceMove?: number;
  crippled?: string[];
  conditions?: ConditionInstance[];
}

/**
 * Convert a party character (with gcsData) to combat character format
 */
export function partyCharacterToCombat(partyChar: PartyCharacter): CombatSetupCharacter {
  const gcs = partyChar.gcsData;
  const attrs = gcs?.attributes || { ST: 10, DX: 10, IQ: 10, HT: 10 };
  const pools = gcs?.pools || { HP: { current: 10, max: 10 }, FP: { current: 10, max: 10 } };
  const secondary = gcs?.secondaryAttributes;
  const equipment = gcs?.equipment || [];

  // Calculate derived stats
  const basicSpeed = secondary?.basicSpeed?.value ?? (attrs.DX + attrs.HT) / 4;
  const basicMove = secondary?.basicMove?.value ?? Math.floor(basicSpeed);
  const baseDodge = Math.floor(basicSpeed) + 3;

  // Phase 12a: Calculate encumbrance-adjusted move and dodge
  let adjustedMove = basicMove;
  let adjustedDodge = baseDodge;
  let armorByLocation: Array<{ location: string; dr: number }> | undefined;

  if (secondary) {
    const encumbrance = calculateCharacterEncumbrance(attrs, secondary, equipment);
    adjustedMove = encumbrance.adjustedMove;
    adjustedDodge = encumbrance.adjustedDodge;
  }

  // Phase 12a: Calculate per-location DR from equipped armor
  const locationDR = calculateLocationDR(equipment);
  if (locationDR.length > 0) {
    armorByLocation = locationDR.map(({ location, dr }) => ({ location, dr }));
  }

  // Phase 12a: Token image for initiative timeline
  const tokenImage = partyChar.images?.token;
  const seededStatus = seedParticipantFromStatus(partyChar.status);

  return {
    id: partyChar.id,
    name: partyChar.name,
    category: 'player',
    st: attrs.ST,
    dx: attrs.DX,
    iq: attrs.IQ,
    ht: attrs.HT,
    hp: pools.HP.max,
    fp: pools.FP.max,
    mp: 0,
    basicSpeed,
    basicMove: adjustedMove,
    dodge: adjustedDodge,
    parry: 0,
    block: 0,
    dr: 0,
    hitLocationProfileId: partyChar.hitLocationProfileId || DEFAULT_HIT_LOCATION_PROFILE,
    attacks: [],
    notes: gcs?.notes || '',
    isFromParty: true,
    partyCharacterId: partyChar.id,
    tokenImage,
    armorByLocation,
    encumbranceDodge: adjustedDodge !== baseDodge ? adjustedDodge : undefined,
    encumbranceMove: adjustedMove !== basicMove ? adjustedMove : undefined,
    conditions: seededStatus.conditions,
    crippled: seededStatus.crippled,
  };
}


/** Each placed token creates an independent participant, even for a shared NPC template. */
export function participantsFromMap(state: CampaignState, map: MapModel): Participant[] {
  return Object.values(map.tokens ?? {}).flatMap(token => {
    if (!tokenFitsMap(map, token)) return [];
    const party = token.partyCharacterId ? state.entities.characters[token.partyCharacterId] : undefined;
    const template = party ? partyCharacterToCombat(party) : token.libraryId ? state.entities.combatCharacters[token.libraryId] : undefined;
    if (!template) return [];
    const participant = createNumberedEnemies(token.label, 1, template)[0];
    if (!participant) return [];
    const seeded = party ? seedParticipantFromStatus(party.status) : undefined;
    return [{ ...participant, name: token.label, tokenRef: { mapId: map.id, tokenId: token.id },
      ...(party ? { partyCharacterId: party.id, isFromParty: true, conditions: seeded?.conditions ?? [], crippled: seeded?.crippled ?? [] } : { libraryId: token.libraryId }),
    }];
  });
}
