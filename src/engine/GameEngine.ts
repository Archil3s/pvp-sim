import type {
  CombatEvent,
  CombatStyle,
  Command,
  FighterState,
  Prayer,
  Tile,
  WeaponId,
  WorldListener,
  WorldState,
} from './types';

const GAME_TICK_MS = 600;
const ARENA_MIN = 0;
const ARENA_MAX = 9;
const PVP_PRAYER_REDUCTION = 0.4;

const WEAPONS: Record<WeaponId, { name: string; style: CombatStyle; speed: number; maxHit: number }> = {
  dragon_knives: { name: 'Dragon knives', style: 'ranged', speed: 3, maxHit: 12 },
  dragon_darts: { name: 'Dragon darts', style: 'ranged', speed: 3, maxHit: 9 },
  ko_weapon: { name: 'KO weapon', style: 'melee', speed: 5, maxHit: 32 },
};

function makeFighter(id: 'player' | 'opponent', tile: Tile): FighterState {
  return {
    id,
    tile,
    hp: 99,
    maxHp: 99,
    prayerPoints: 99,
    maxPrayer: 99,
    activePrayer: null,
    weapon: id === 'player' ? 'dragon_knives' : 'ko_weapon',
    shieldEquipped: false,
    food: id === 'player' ? 6 : 0,
    attackCooldown: 0,
    eatCooldown: 0,
    lastDamageTaken: 0,
  };
}

function makeInitialState(): WorldState {
  return {
    tick: 0,
    player: makeFighter('player', { x: 4, y: 7 }),
    opponent: makeFighter('opponent', { x: 4, y: 2 }),
    events: [],
    winner: null,
  };
}

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

function prayerForStyle(style: CombatStyle): Exclude<Prayer, null> {
  if (style === 'melee') return 'protect_melee';
  if (style === 'ranged') return 'protect_ranged';
  return 'protect_magic';
}

class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  reset(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0x100000000;
  }

  int(maxInclusive: number): number {
    return Math.floor(this.next() * (maxInclusive + 1));
  }
}

export class GameEngine {
  private timer: number | null = null;
  private listeners = new Set<WorldListener>();
  private queue: Command[] = [];
  private moveTarget: Tile | null = null;
  private eventId = 0;
  private opponentAttackCount = 0;
  private rng = new SeededRng(0x5c1f2026);

  public state: WorldState = makeInitialState();

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
    this.eventId = 0;
    this.opponentAttackCount = 0;
    this.rng.reset(0x5c1f2026);
    this.state = makeInitialState();
    this.addEvent('Fight reset. Deterministic seed restored.', 'neutral');
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
    this.state.player.lastDamageTaken = 0;
    this.state.opponent.lastDamageTaken = 0;

    this.cooldowns();
    this.processCommands();
    this.processMovement();
    this.processPrayerDrain();
    this.processOpponentPrayer();
    this.processOpponentAttack();
    this.checkWinner();
    this.emit();
  }

  private cooldowns() {
    for (const fighter of [this.state.player, this.state.opponent]) {
      fighter.attackCooldown = Math.max(0, fighter.attackCooldown - 1);
      fighter.eatCooldown = Math.max(0, fighter.eatCooldown - 1);
    }
  }

  private processCommands() {
    if (this.state.winner) {
      this.queue = [];
      return;
    }

    for (const command of this.queue.splice(0)) {
      if (command.type === 'MOVE_TO') {
        this.moveTarget = clampTile(command.tile);
      }

      if (command.type === 'EQUIP_WEAPON') {
        this.state.player.weapon = command.weapon;
        this.addEvent(`Equipped ${WEAPONS[command.weapon].name}.`, 'neutral');
      }

      if (command.type === 'TOGGLE_SHIELD') {
        this.state.player.shieldEquipped = !this.state.player.shieldEquipped;
        this.addEvent(this.state.player.shieldEquipped ? 'Black d\'hide shield equipped.' : 'Shield unequipped.', 'neutral');
      }

      if (command.type === 'SET_PRAYER') {
        if (command.prayer && this.state.player.prayerPoints <= 0) continue;
        this.state.player.activePrayer = this.state.player.activePrayer === command.prayer ? null : command.prayer;
        this.addEvent(this.state.player.activePrayer ? `Prayer: ${this.state.player.activePrayer.replace('protect_', 'Protect ')}` : 'Protection prayer off.', 'neutral');
      }

      if (command.type === 'EAT') {
        this.eat();
      }

      if (command.type === 'ATTACK' && command.target === 'opponent') {
        this.playerAttack();
      }
    }
  }

  private processMovement() {
    if (!this.moveTarget || this.state.winner) return;
    const current = this.state.player.tile;
    if (current.x === this.moveTarget.x && current.y === this.moveTarget.y) {
      this.moveTarget = null;
      return;
    }
    this.state.player.tile = stepToward(current, this.moveTarget);
  }

  private processPrayerDrain() {
    if (this.state.player.activePrayer && this.state.tick % 5 === 0) {
      this.state.player.prayerPoints = Math.max(0, this.state.player.prayerPoints - 1);
      if (this.state.player.prayerPoints === 0) {
        this.state.player.activePrayer = null;
        this.addEvent('Prayer depleted.', 'danger');
      }
    }
  }

  private processOpponentPrayer() {
    if (this.state.winner) return;
    const phase = Math.floor(this.state.tick / 5) % 3;
    const next: Prayer = phase === 0 ? 'protect_ranged' : phase === 1 ? 'protect_melee' : null;
    this.state.opponent.activePrayer = next;
  }

  private playerAttack() {
    const player = this.state.player;
    const opponent = this.state.opponent;
    if (player.attackCooldown > 0 || opponent.hp <= 0) return;

    const weapon = WEAPONS[player.weapon];
    let damage = this.rng.int(weapon.maxHit);
    if (opponent.activePrayer === prayerForStyle(weapon.style)) {
      damage = Math.floor(damage * (1 - PVP_PRAYER_REDUCTION));
    }

    opponent.hp = Math.max(0, opponent.hp - damage);
    opponent.lastDamageTaken = damage;
    player.attackCooldown = weapon.speed;
    this.addEvent(`${weapon.name} hits ${damage}.`, damage >= 20 ? 'good' : 'neutral');
    this.checkWinner();
  }

  private processOpponentAttack() {
    const player = this.state.player;
    const opponent = this.state.opponent;
    if (this.state.winner || opponent.hp <= 0 || opponent.attackCooldown > 0) return;

    const style: CombatStyle = this.opponentAttackCount % 3 === 2 ? 'magic' : this.opponentAttackCount % 2 === 0 ? 'ranged' : 'melee';
    const maxHit = style === 'melee' ? 19 : style === 'ranged' ? 16 : 17;
    let damage = this.rng.int(maxHit);

    if (player.activePrayer === prayerForStyle(style)) {
      damage = Math.floor(damage * (1 - PVP_PRAYER_REDUCTION));
    }

    if (player.shieldEquipped && style === 'ranged') {
      damage = Math.max(0, damage - 2);
    }

    player.hp = Math.max(0, player.hp - damage);
    player.lastDamageTaken = damage;
    opponent.attackCooldown = 4;
    this.opponentAttackCount += 1;
    this.addEvent(`Opponent ${style} attack hits ${damage}.`, damage >= 15 ? 'danger' : 'neutral');
  }

  private eat() {
    const player = this.state.player;
    if (player.food <= 0 || player.eatCooldown > 0 || player.hp >= player.maxHp) return;
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + 20);
    player.food -= 1;
    player.eatCooldown = 3;
    player.attackCooldown = Math.max(player.attackCooldown, 3);
    this.addEvent(`Food heals ${player.hp - before} HP.`, 'good');
  }

  private checkWinner() {
    if (this.state.opponent.hp <= 0 && !this.state.winner) {
      this.state.winner = 'player';
      this.addEvent('KO — you win.', 'good');
    } else if (this.state.player.hp <= 0 && !this.state.winner) {
      this.state.winner = 'opponent';
      this.addEvent('You were KO\'d.', 'danger');
    }
  }

  private addEvent(text: string, tone: CombatEvent['tone']) {
    this.state.events.unshift({ id: ++this.eventId, tick: this.state.tick, text, tone });
    this.state.events = this.state.events.slice(0, 8);
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
export const WEAPON_DEFINITIONS = WEAPONS;
