export type PlayerId = 'player' | 'opponent';

export interface Tile {
  x: number;
  y: number;
}

export interface FighterState {
  id: PlayerId;
  tile: Tile;
  hp: number;
  maxHp: number;
  attackCooldown: number;
}

export interface WorldState {
  tick: number;
  player: FighterState;
  opponent: FighterState;
}

export type Command =
  | { type: 'MOVE_TO'; tile: Tile }
  | { type: 'ATTACK'; target: PlayerId };

export type WorldListener = (state: WorldState) => void;
