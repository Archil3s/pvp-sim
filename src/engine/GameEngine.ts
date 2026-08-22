import { getRangedHitDelay, isWithinRange } from './combat/projectiles';
import { WEAPON_DEFINITIONS } from './data/weapons';
import { buildStraightRoute, MovementQueue } from './movement/MovementQueue';
import type {
  CombatEvent,
  CombatStyle,
  Command,
  FighterState,
  PlayerId,
  Prayer,
  ProjectileState,
  Tile,
  WorldListener,
  WorldState,
} from './types';

const GAME_TICK_MS = 600;
const ARENA_MIN = 0;
const ARENA_MAX = 9;
const PVP_PRAYER_REDUCTION = 0.4;
const DETERMINISTIC_SEED = 0x5c1f2026;

interface ScheduledHit {
  id: number;
  source: PlayerId;
  target: PlayerId;
  style: CombatStyle;
  damage: number;
  impactTick: number;
  label: string;
}

function makeFighter(id: PlayerId, tile: Tile): FighterState {
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
    projectiles: [],
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

  reset(seed: number): void {
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
  private commandQueue: Command[] = [];
  private playerMovement = new MovementQueue();
  private scheduledHits: ScheduledHit[] = [];
  private eventId = 0;
  private projectileId = 0;
  private opponentAttackCount = 0;
  private playerAttackIntent = false;
  private rng = new SeededRng(DETERMINISTIC_SEED);

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
    this.commandQueue = [];
    this.playerMovement.clear();
    this.scheduledHits = [];
    this.eventId = 0;
    this.projectileId = 0;
    this.opponentAttackCount = 0;
    this.playerAttackIntent = false;
    this.rng.reset(DETERMINISTIC_SEED);
    this.state = makeInitialState();
    this.addEvent('Fight reset. Deterministic seed restored.', 'neutral');
    this.emit();
  }

  dispatch(command: Command): void {
    this.commandQueue.push(command);
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
    this.processPlayerAttackIntent();
    this.resolveScheduledHits();
    this.processPrayerDrain();
    this.processOpponentPrayer();
    this.processOpponentAttack();
    this.checkWinner();
    this.emit();
  }

  private cooldowns(): void {
    for (const fighter of [this.state.player, this.state.opponent]) {
      fighter.attackCooldown = Math.max(0, fighter.attackCooldown - 1);
      fighter.eatCooldown = Math.max(0, fighter.eatCooldown - 1);
    }
  }

  private processCommands(): void {
    if (this.state.winner) {
      this.commandQueue = [];
      return;
    }

    for (const command of this.commandQueue.splice(0)) {
      if (command.type === 'MOVE_TO') {
        const destination = clampTile(command.tile);
        this.playerAttackIntent = false;
        this.playerMovement.routeTo(this.state.player.tile, destination);
        this.addEvent(`Move queued to ${destination.x},${destination.y}.`, 'neutral');
      }

      if (command.type === 'EQUIP_WEAPON') {
        this.state.player.weapon = command.weapon;
        this.addEvent(`Equipped ${WEAPON_DEFINITIONS[command.weapon].name}.`, 'neutral');
      }

      if (command.type === 'TOGGLE_SHIELD') {
        this.state.player.shieldEquipped = !this.state.player.shieldEquipped;
        this.addEvent(this.state.player.shieldEquipped ? 'Black d\'hide shield equipped.' : 'Shield unequipped.', 'neutral');
      }

      if (command.type === 'SET_PRAYER') {
        if (command.prayer && this.state.player.prayerPoints <= 0) continue;
        this.state.player.activePrayer = this.state.player.activePrayer === command.prayer ? null : command.prayer;
        this.addEvent(
          this.state.player.activePrayer
            ? `Prayer: ${this.state.player.activePrayer.replace('protect_', 'Protect ')}`
            : 'Protection prayer off.',
          'neutral',
        );
      }

      if (command.type === 'EAT') {
        this.eat();
      }

      if (command.type === 'ATTACK' && command.target === 'opponent') {
        this.playerAttackIntent = true;
        this.queueTowardPlayerAttackRange();
      }
    }
  }

  private processMovement(): void {
    if (this.state.winner || !this.playerMovement.hasDestination()) return;
    const next = this.playerMovement.cycle();
    if (next) this.state.player.tile = next;
  }

  private queueTowardPlayerAttackRange(): void {
    const player = this.state.player;
    const opponent = this.state.opponent;
    const weapon = WEAPON_DEFINITIONS[player.weapon];

    if (isWithinRange(player.tile, opponent.tile, weapon.range)) {
      return;
    }

    const route = buildStraightRoute(player.tile, opponent.tile);
    const firstInRange = route.findIndex((tile) => isWithinRange(tile, opponent.tile, weapon.range));
    if (firstInRange >= 0) {
      this.playerMovement.setRoute(route.slice(0, firstInRange + 1));
      this.addEvent(`Closing to ${weapon.range}-tile ${weapon.style} range.`, 'neutral');
    }
  }

  private processPlayerAttackIntent(): void {
    if (!this.playerAttackIntent || this.state.winner) return;

    const player = this.state.player;
    const opponent = this.state.opponent;
    const weapon = WEAPON_DEFINITIONS[player.weapon];

    if (opponent.hp <= 0 || player.attackCooldown > 0) return;

    if (!isWithinRange(player.tile, opponent.tile, weapon.range)) {
      if (!this.playerMovement.hasDestination()) this.queueTowardPlayerAttackRange();
      return;
    }

    this.launchPlayerAttack();
  }

  private launchPlayerAttack(): void {
    const player = this.state.player;
    const opponent = this.state.opponent;
    const weapon = WEAPON_DEFINITIONS[player.weapon];

    let damage = this.rng.int(weapon.maxHit);
    if (opponent.activePrayer === prayerForStyle(weapon.style)) {
      damage = Math.floor(damage * (1 - PVP_PRAYER_REDUCTION));
    }

    player.attackCooldown = weapon.speed;

    if (weapon.style === 'melee') {
      this.applyHit({
        id: ++this.projectileId,
        source: 'player',
        target: 'opponent',
        style: weapon.style,
        damage,
        impactTick: this.state.tick,
        label: weapon.name,
      });
      return;
    }

    const delay = getRangedHitDelay(player.tile, opponent.tile);
    this.scheduleHit({
      source: 'player',
      target: 'opponent',
      style: weapon.style,
      damage,
      delay,
      label: weapon.name,
      from: player.tile,
      to: opponent.tile,
    });
  }

  private processPrayerDrain(): void {
    if (this.state.player.activePrayer && this.state.tick % 5 === 0) {
      this.state.player.prayerPoints = Math.max(0, this.state.player.prayerPoints - 1);
      if (this.state.player.prayerPoints === 0) {
        this.state.player.activePrayer = null;
        this.addEvent('Prayer depleted.', 'danger');
      }
    }
  }

  private processOpponentPrayer(): void {
    if (this.state.winner) return;
    const phase = Math.floor(this.state.tick / 5) % 3;
    this.state.opponent.activePrayer = phase === 0 ? 'protect_ranged' : phase === 1 ? 'protect_melee' : null;
  }

  private processOpponentAttack(): void {
    const player = this.state.player;
    const opponent = this.state.opponent;
    if (this.state.winner || opponent.hp <= 0 || opponent.attackCooldown > 0) return;

    let style: CombatStyle = this.opponentAttackCount % 3 === 2 ? 'magic' : this.opponentAttackCount % 2 === 0 ? 'ranged' : 'melee';
    if (style === 'melee' && !isWithinRange(opponent.tile, player.tile, 1)) {
      style = 'ranged';
    }

    const maxHit = style === 'melee' ? 19 : style === 'ranged' ? 16 : 17;
    let damage = this.rng.int(maxHit);

    if (player.activePrayer === prayerForStyle(style)) {
      damage = Math.floor(damage * (1 - PVP_PRAYER_REDUCTION));
    }
    if (player.shieldEquipped && style === 'ranged') {
      damage = Math.max(0, damage - 2);
    }

    opponent.attackCooldown = 4;
    this.opponentAttackCount += 1;

    if (style === 'melee') {
      this.applyHit({
        id: ++this.projectileId,
        source: 'opponent',
        target: 'player',
        style,
        damage,
        impactTick: this.state.tick,
        label: 'Opponent melee',
      });
      return;
    }

    this.scheduleHit({
      source: 'opponent',
      target: 'player',
      style,
      damage,
      delay: getRangedHitDelay(opponent.tile, player.tile),
      label: `Opponent ${style}`,
      from: opponent.tile,
      to: player.tile,
    });
  }

  private scheduleHit(input: {
    source: PlayerId;
    target: PlayerId;
    style: CombatStyle;
    damage: number;
    delay: number;
    label: string;
    from: Tile;
    to: Tile;
  }): void {
    const id = ++this.projectileId;
    const impactTick = this.state.tick + input.delay;
    const scheduled: ScheduledHit = {
      id,
      source: input.source,
      target: input.target,
      style: input.style,
      damage: input.damage,
      impactTick,
      label: input.label,
    };
    this.scheduledHits.push(scheduled);

    const projectile: ProjectileState = {
      id,
      source: input.source,
      target: input.target,
      style: input.style,
      from: { ...input.from },
      to: { ...input.to },
      launchedTick: this.state.tick,
      impactTick,
    };
    this.state.projectiles.push(projectile);
    this.addEvent(`${input.label} launched → impact T${impactTick}.`, 'neutral');
  }

  private resolveScheduledHits(): void {
    if (this.scheduledHits.length === 0) return;

    const ready = this.scheduledHits.filter((hit) => hit.impactTick <= this.state.tick);
    this.scheduledHits = this.scheduledHits.filter((hit) => hit.impactTick > this.state.tick);

    for (const hit of ready) {
      this.applyHit(hit);
      this.state.projectiles = this.state.projectiles.filter((projectile) => projectile.id !== hit.id);
    }
  }

  private applyHit(hit: ScheduledHit): void {
    if (this.state.winner) return;

    const target = hit.target === 'player' ? this.state.player : this.state.opponent;
    if (target.hp <= 0) return;

    target.hp = Math.max(0, target.hp - hit.damage);
    target.lastDamageTaken = hit.damage;

    const dangerous = hit.target === 'player' && hit.damage >= 15;
    const good = hit.target === 'opponent' && hit.damage >= 20;
    this.addEvent(`${hit.label} impacts for ${hit.damage}.`, dangerous ? 'danger' : good ? 'good' : 'neutral');
    this.checkWinner();
  }

  private eat(): void {
    const player = this.state.player;
    if (player.food <= 0 || player.eatCooldown > 0 || player.hp >= player.maxHp) return;
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + 20);
    player.food -= 1;
    player.eatCooldown = 3;
    player.attackCooldown = Math.max(player.attackCooldown, 3);
    this.addEvent(`Food heals ${player.hp - before} HP.`, 'good');
  }

  private checkWinner(): void {
    if (this.state.opponent.hp <= 0 && !this.state.winner) {
      this.state.winner = 'player';
      this.playerAttackIntent = false;
      this.playerMovement.clear();
      this.addEvent('KO — you win.', 'good');
    } else if (this.state.player.hp <= 0 && !this.state.winner) {
      this.state.winner = 'opponent';
      this.playerAttackIntent = false;
      this.playerMovement.clear();
      this.addEvent('You were KO\'d.', 'danger');
    }
  }

  private addEvent(text: string, tone: CombatEvent['tone']): void {
    this.state.events.unshift({ id: ++this.eventId, tick: this.state.tick, text, tone });
    this.state.events = this.state.events.slice(0, 10);
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
export { WEAPON_DEFINITIONS };
