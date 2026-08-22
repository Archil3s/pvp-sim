import type { Command, Tile, WorldListener, WorldState } from './types';

const GAME_TICK_MS = 600;
const ARENA_MIN = 0;
const ARENA_MAX = 9;

function clampTile(tile: Tile): Tile {
  return {
    x: Math.max(ARENA_MIN, Math.min(ARENA_MAX, Math.round(tile.x))),
    y: Math.max(ARENA_MIN, Math.min(ARENA_MAX, Math.round(tile.y))),
  };
}

function stepToward(current: Tile, target: Tile): Tile {
  const dx = Math.sign(target.x - current.x);
  const dy = Math.sign(target.y - current.y);
  return { x: current.x + dx, y: current.y + dy };
}

export class GameEngine {
  private timer: number | null = null;
  private listeners = new Set<WorldListener>();
  private queue: Command[] = [];
  private moveTarget: Tile | null = null;

  public state: WorldState = {
    tick: 0,
    player: {
      id: 'player',
      tile: { x: 4, y: 7 },
      hp: 99,
      maxHp: 99,
      attackCooldown: 0,
    },
    opponent: {
      id: 'opponent',
      tile: { x: 4, y: 2 },
      hp: 99,
      maxHp: 99,
      attackCooldown: 0,
    },
  };

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), GAME_TICK_MS);
  }

  stop(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  reset(): void {
    this.queue = [];
    this.moveTarget = null;
    this.state = {
      tick: 0,
      player: { id: 'player', tile: { x: 4, y: 7 }, hp: 99, maxHp: 99, attackCooldown: 0 },
      opponent: { id: 'opponent', tile: { x: 4, y: 2 }, hp: 99, maxHp: 99, attackCooldown: 0 },
    };
    this.emit();
  }

  dispatch(command: Command): void {
    this.queue.push(command);
  }

  subscribe(listener: WorldListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private tick(): void {
    this.state.tick += 1;

    for (const command of this.queue.splice(0)) {
      if (command.type === 'MOVE_TO') {
        this.moveTarget = clampTile(command.tile);
      }

      if (command.type === 'ATTACK' && command.target === 'opponent' && this.state.player.attackCooldown === 0) {
        this.state.opponent.hp = Math.max(0, this.state.opponent.hp - 8);
        this.state.player.attackCooldown = 4;
      }
    }

    if (this.moveTarget) {
      const current = this.state.player.tile;
      if (current.x === this.moveTarget.x && current.y === this.moveTarget.y) {
        this.moveTarget = null;
      } else {
        this.state.player.tile = stepToward(current, this.moveTarget);
      }
    }

    this.state.player.attackCooldown = Math.max(0, this.state.player.attackCooldown - 1);
    this.state.opponent.attackCooldown = Math.max(0, this.state.opponent.attackCooldown - 1);

    this.emit();
  }

  private snapshot(): WorldState {
    return structuredClone(this.state);
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export const GAME_TICK_MS_VALUE = GAME_TICK_MS;
