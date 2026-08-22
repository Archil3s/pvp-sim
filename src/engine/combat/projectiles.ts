import type { Tile } from '../types';

export function chebyshevDistance(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Prototype port of Alter's ranged hit-delay shape: nearby ranged attacks land
 * after two ticks and gain additional delay with distance.
 */
export function getRangedHitDelay(start: Tile, target: Tile): number {
  const distance = chebyshevDistance(start, target);
  return 2 + Math.floor((3 + distance) / 6);
}

export function isWithinRange(source: Tile, target: Tile, range: number): boolean {
  return chebyshevDistance(source, target) <= range;
}
