export type PlayerId = 'player' | 'opponent';
export type CombatStyle = 'melee' | 'ranged' | 'magic';
export type Prayer = 'protect_melee' | 'protect_ranged' | 'protect_magic' | null;
export type WeaponId = 'dragon_knives' | 'dragon_darts' | 'ko_weapon';

export interface Tile {
  x: number;
  y: number;
}

export interface FighterState {
  id: PlayerId;
  tile: Tile;
  hp: number;
  maxHp: number;
  prayerPoints: number;
  maxPrayer: number;
  activePrayer: Prayer;
  weapon: WeaponId;
  shieldEquipped: boolean;
  food: number;
  attackCooldown: number;
  eatCooldown: number;
  lastDamageTaken: number;
}

export interface ProjectileState {
  id: number;
  source: PlayerId;
  target: PlayerId;
  style: CombatStyle;
  from: Tile;
  to: Tile;
  launchedTick: number;
  impactTick: number;
}

export interface CombatEvent {
  id: number;
  tick: number;
  text: string;
  tone: 'neutral' | 'good' | 'danger';
}

export interface WorldState {
  tick: number;
  player: FighterState;
  opponent: FighterState;
  projectiles: ProjectileState[];
  events: CombatEvent[];
  winner: PlayerId | null;
}

export type Command =
  | { type: 'MOVE_TO'; tile: Tile }
  | { type: 'ATTACK'; target: PlayerId }
  | { type: 'EQUIP_WEAPON'; weapon: WeaponId }
  | { type: 'TOGGLE_SHIELD' }
  | { type: 'SET_PRAYER'; prayer: Prayer }
  | { type: 'EAT' };

export type WorldListener = (state: WorldState) => void;
