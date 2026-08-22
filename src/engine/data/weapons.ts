import type { CombatStyle, WeaponId } from '../types';

export interface WeaponDefinition {
  id: WeaponId;
  name: string;
  style: CombatStyle;
  /** Game ticks between attacks. */
  speed: number;
  /** Maximum Chebyshev tile distance for this prototype ruleset. */
  range: number;
  /** Placeholder until the real OSRS max-hit formula is wired in. */
  maxHit: number;
  /** Base impact delay in game ticks for non-melee attacks. */
  baseImpactDelay: number;
}

/**
 * Range/speed structure follows the OSRS/Alter combat model: weapon data drives
 * attack delay and combat range. Max-hit values are still prototype placeholders.
 */
export const WEAPON_DEFINITIONS: Record<WeaponId, WeaponDefinition> = {
  dragon_knives: {
    id: 'dragon_knives',
    name: 'Dragon knives',
    style: 'ranged',
    speed: 3,
    range: 6,
    maxHit: 12,
    baseImpactDelay: 2,
  },
  dragon_darts: {
    id: 'dragon_darts',
    name: 'Dragon darts',
    style: 'ranged',
    speed: 3,
    range: 3,
    maxHit: 9,
    baseImpactDelay: 2,
  },
  ko_weapon: {
    id: 'ko_weapon',
    name: 'KO weapon',
    style: 'melee',
    speed: 5,
    range: 1,
    maxHit: 32,
    baseImpactDelay: 0,
  },
};
