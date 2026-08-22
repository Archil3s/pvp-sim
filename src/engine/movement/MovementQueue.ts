import type { Tile } from '../types';

function sameTile(a: Tile, b: Tile): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Expand a destination into one-tile steps, matching the queue-oriented model
 * used by OSRS servers. Collision/pathfinding will replace this straight-line
 * prototype route builder in a later milestone.
 */
export function buildStraightRoute(start: Tile, destination: Tile): Tile[] {
  const route: Tile[] = [];
  let current = { ...start };

  while (!sameTile(current, destination)) {
    current = {
      x: current.x + Math.sign(destination.x - current.x),
      y: current.y + Math.sign(destination.y - current.y),
    };
    route.push(current);
  }

  return route;
}

export class MovementQueue {
  private steps: Tile[] = [];

  clear(): void {
    this.steps = [];
  }

  setRoute(route: Tile[]): void {
    this.steps = route.map((tile) => ({ ...tile }));
  }

  routeTo(start: Tile, destination: Tile): void {
    this.setRoute(buildStraightRoute(start, destination));
  }

  hasDestination(): boolean {
    return this.steps.length > 0;
  }

  remainingSteps(): number {
    return this.steps.length;
  }

  peekDestination(): Tile | null {
    return this.steps.length > 0 ? { ...this.steps[this.steps.length - 1] } : null;
  }

  /** Consume one true-tile walking step for this game tick. */
  cycle(): Tile | null {
    const next = this.steps.shift();
    return next ? { ...next } : null;
  }
}
