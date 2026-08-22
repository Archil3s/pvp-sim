import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GameEngine, GAME_TICK_MS_VALUE, WEAPON_DEFINITIONS } from './engine/GameEngine';
import type { Prayer, WeaponId, WorldState } from './engine/types';

const engine = new GameEngine();

function hpPercent(hp: number, maxHp: number) {
  return `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%`;
}

function prayerLabel(prayer: Prayer) {
  if (!prayer) return 'None';
  if (prayer === 'protect_melee') return 'Melee';
  if (prayer === 'protect_ranged') return 'Range';
  return 'Magic';
}

const inventory: Array<{ kind: 'weapon' | 'shield' | 'food'; label: string; short: string; weapon?: WeaponId }> = [
  { kind: 'weapon', label: 'Dragon knives', short: 'KN', weapon: 'dragon_knives' },
  { kind: 'weapon', label: 'Dragon darts', short: 'DT', weapon: 'dragon_darts' },
  { kind: 'shield', label: "Black d'hide shield", short: 'SH' },
  { kind: 'weapon', label: 'KO weapon', short: 'KO', weapon: 'ko_weapon' },
  ...Array.from({ length: 6 }, () => ({ kind: 'food' as const, label: 'Food (+20)', short: 'FO' })),
];

export function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [world, setWorld] = useState<WorldState>(structuredClone(engine.state));

  useEffect(() => engine.subscribe(setWorld), []);

  useEffect(() => {
    engine.start();
    return () => engine.stop();
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090b10);
    scene.fog = new THREE.Fog(0x090b10, 14, 28);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(10, 13, 14);
    camera.lookAt(4.5, 0, 4.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xc8d6ff, 0x28180c, 1.35));
    const key = new THREE.DirectionalLight(0xffd6a1, 2.1);
    key.position.set(3, 12, 7);
    key.castShadow = true;
    scene.add(key);

    const arena = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.35, 10),
      new THREE.MeshStandardMaterial({ color: 0x3b3030, roughness: 0.95 }),
    );
    arena.position.set(4.5, -0.2, 4.5);
    arena.receiveShadow = true;
    scene.add(arena);

    const grid = new THREE.GridHelper(10, 10, 0x76675a, 0x50463f);
    grid.position.set(4.5, 0.01, 4.5);
    scene.add(grid);

    const borderMat = new THREE.MeshStandardMaterial({ color: 0x5f321f, emissive: 0x1b0700 });
    const borderGeo = new THREE.BoxGeometry(0.65, 0.45, 10.9);
    for (const x of [-0.45, 9.45]) {
      const wall = new THREE.Mesh(borderGeo, borderMat);
      wall.position.set(x, 0, 4.5);
      scene.add(wall);
    }
    const borderGeo2 = new THREE.BoxGeometry(10.9, 0.45, 0.65);
    for (const z of [-0.45, 9.45]) {
      const wall = new THREE.Mesh(borderGeo2, borderMat);
      wall.position.set(4.5, 0, z);
      scene.add(wall);
    }

    const makeFighter = (color: number, markerColor: number) => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.28, 0.72, 5, 10),
        new THREE.MeshStandardMaterial({ color, roughness: 0.75 }),
      );
      body.position.y = 0.72;
      body.castShadow = true;
      group.add(body);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 12, 8),
        new THREE.MeshStandardMaterial({ color: 0xd3b18a, roughness: 0.9 }),
      );
      head.position.y = 1.42;
      head.castShadow = true;
      group.add(head);

      const markerMaterial = new THREE.LineBasicMaterial({ color: markerColor });
      const marker = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(0.9, 0.05, 0.9)),
        markerMaterial,
      );
      marker.position.y = 0.06;
      group.add(marker);
      scene.add(group);
      return { group, markerMaterial };
    };

    const player = makeFighter(0x4ea3ff, 0x49d7ff);
    const opponent = makeFighter(0xb94040, 0xff5b5b);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const clickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    clickPlane.rotation.x = -Math.PI / 2;
    clickPlane.position.set(4.5, 0.08, 4.5);
    scene.add(clickPlane);

    const clickMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.28, 4),
      new THREE.MeshBasicMaterial({ color: 0xffd24a, side: THREE.DoubleSide }),
    );
    clickMarker.rotation.x = -Math.PI / 2;
    clickMarker.rotation.z = Math.PI / 4;
    clickMarker.position.y = 0.09;
    clickMarker.visible = false;
    scene.add(clickMarker);

    const onPointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(clickPlane)[0];
      if (!hit) return;
      const tile = { x: Math.round(hit.point.x), y: Math.round(hit.point.z) };
      clickMarker.position.set(tile.x, 0.09, tile.y);
      clickMarker.visible = true;
      engine.dispatch({ type: 'MOVE_TO', tile });
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    let latest = world;
    const unsubscribe = engine.subscribe((state) => {
      latest = state;
    });

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      player.group.position.lerp(new THREE.Vector3(latest.player.tile.x, 0, latest.player.tile.y), 0.18);
      opponent.group.position.lerp(new THREE.Vector3(latest.opponent.tile.x, 0, latest.opponent.tile.y), 0.18);
      opponent.markerMaterial.color.set(latest.opponent.activePrayer === 'protect_ranged' ? 0x77c9ff : latest.opponent.activePrayer === 'protect_melee' ? 0xffd36a : 0xff5b5b);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  const clickInventory = (item: (typeof inventory)[number]) => {
    if (item.kind === 'weapon' && item.weapon) engine.dispatch({ type: 'EQUIP_WEAPON', weapon: item.weapon });
    if (item.kind === 'shield') engine.dispatch({ type: 'TOGGLE_SHIELD' });
    if (item.kind === 'food') engine.dispatch({ type: 'EAT' });
  };

  const prayerButton = (prayer: Exclude<Prayer, null>, label: string) => (
    <button
      className={world.player.activePrayer === prayer ? 'prayer active' : 'prayer'}
      onClick={() => engine.dispatch({ type: 'SET_PRAYER', prayer })}
    >
      <span>{label}</span>
      <small>{world.player.activePrayer === prayer ? 'ON' : 'OFF'}</small>
    </button>
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">OSRS PvP TRAINING LAB · PROTOTYPE 0.2</span>
          <h1>PvP Sim</h1>
        </div>
        <div className="tick-pill"><span className="pulse" /> Tick {world.tick} · {GAME_TICK_MS_VALUE} ms</div>
      </header>

      <section className="workspace">
        <aside className="left-panel panel">
          <button className="nav-active">Arena</button>
          <button>Loadouts</button>
          <button>Training</button>
          <button>Replays</button>
          <button>Settings</button>

          <div className="combat-log">
            <div className="inventory-title">COMBAT EVENTS</div>
            {world.events.length === 0 && <span className="empty-log">Fight starts automatically.</span>}
            {world.events.map((event) => (
              <div key={event.id} className={`event ${event.tone}`}>
                <span>T{event.tick}</span>
                <p>{event.text}</p>
              </div>
            ))}
          </div>

          <div className="panel-note">
            <strong>Prototype rules</strong>
            <span>Combat values are placeholders while the engine is being validated.</span>
          </div>
        </aside>

        <section className="viewport-wrap">
          <div className="opponent-hud panel">
            <div className="hud-row"><strong>Opponent</strong><span>{world.opponent.hp}/{world.opponent.maxHp}</span></div>
            <div className="hp-track"><div className="hp-fill enemy" style={{ width: hpPercent(world.opponent.hp, world.opponent.maxHp) }} /></div>
            <div className="opponent-meta">
              <span>Prayer: <b>{prayerLabel(world.opponent.activePrayer)}</b></span>
              <span>CD: <b>{world.opponent.attackCooldown}</b></span>
            </div>
          </div>

          {world.player.lastDamageTaken > 0 && <div className="hitsplat player-hit">-{world.player.lastDamageTaken}</div>}
          {world.opponent.lastDamageTaken > 0 && <div className="hitsplat opponent-hit">-{world.opponent.lastDamageTaken}</div>}
          {world.winner && <div className={`result-banner ${world.winner === 'player' ? 'win' : 'loss'}`}>{world.winner === 'player' ? 'KO — YOU WIN' : 'YOU WERE KO\'D'}</div>}

          <div ref={mountRef} className="viewport" />
          <div className="arena-help">CLICK FLOOR TO MOVE · SWITCH GEAR · PRAY · ATTACK</div>
        </section>

        <aside className="right-panel panel">
          <div className="stat-block">
            <div className="hud-row"><strong>You</strong><span>{world.player.hp}/{world.player.maxHp}</span></div>
            <div className="hp-track"><div className="hp-fill" style={{ width: hpPercent(world.player.hp, world.player.maxHp) }} /></div>
            <div className="resource-row"><span>Prayer</span><strong>{world.player.prayerPoints}</strong></div>
            <div className="prayer-track"><div style={{ width: hpPercent(world.player.prayerPoints, world.player.maxPrayer) }} /></div>
          </div>

          <div className="inventory-title">PROTECTION PRAYERS</div>
          <div className="prayer-grid">
            {prayerButton('protect_melee', 'Melee')}
            {prayerButton('protect_ranged', 'Range')}
            {prayerButton('protect_magic', 'Magic')}
          </div>

          <div className="inventory-title">INVENTORY</div>
          <div className="inventory-grid">
            {Array.from({ length: 28 }, (_, i) => {
              const item = inventory[i];
              const selected = item?.kind === 'weapon' && item.weapon === world.player.weapon;
              const shieldActive = item?.kind === 'shield' && world.player.shieldEquipped;
              const foodEmpty = item?.kind === 'food' && i - 4 >= world.player.food;
              return (
                <button
                  key={i}
                  className={`slot ${item && !foodEmpty ? 'filled' : ''} ${selected || shieldActive ? 'selected' : ''}`}
                  aria-label={item?.label ?? `Empty inventory slot ${i + 1}`}
                  title={item?.label}
                  disabled={!item || foodEmpty || Boolean(world.winner)}
                  onClick={() => item && !foodEmpty && clickInventory(item)}
                >
                  {item && !foodEmpty ? item.short : ''}
                </button>
              );
            })}
          </div>

          <div className="loadout-readout">
            <span>Weapon</span><strong>{WEAPON_DEFINITIONS[world.player.weapon].name}</strong>
            <span>Speed</span><strong>{WEAPON_DEFINITIONS[world.player.weapon].speed}t</strong>
            <span>Style</span><strong>{WEAPON_DEFINITIONS[world.player.weapon].style}</strong>
            <span>Shield</span><strong>{world.player.shieldEquipped ? 'On' : 'Off'}</strong>
            <span>Food</span><strong>{world.player.food}</strong>
          </div>

          <div className="actions">
            <button
              className="attack-button"
              disabled={world.opponent.hp <= 0 || world.player.hp <= 0}
              onClick={() => engine.dispatch({ type: 'ATTACK', target: 'opponent' })}
            >
              Attack opponent {world.player.attackCooldown > 0 ? `(${world.player.attackCooldown}t)` : ''}
            </button>
            <button onClick={() => engine.reset()}>Reset fight</button>
          </div>

          <div className="debug-card">
            <span>Attack cooldown</span><strong>{world.player.attackCooldown}</strong>
            <span>Eat cooldown</span><strong>{world.player.eatCooldown}</strong>
            <span>True tile</span><strong>{world.player.tile.x}, {world.player.tile.y}</strong>
            <span>Prayer</span><strong>{prayerLabel(world.player.activePrayer)}</strong>
          </div>
        </aside>
      </section>
    </main>
  );
}
