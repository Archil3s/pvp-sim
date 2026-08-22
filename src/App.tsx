import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GameEngine, GAME_TICK_MS_VALUE } from './engine/GameEngine';
import type { WorldState } from './engine/types';

const engine = new GameEngine();

function hpPercent(hp: number, maxHp: number) {
  return `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%`;
}

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

    const makeFighter = (color: number) => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.28, 0.72, 5, 10),
        new THREE.MeshStandardMaterial({ color, roughness: 0.75 }),
      );
      body.position.y = 0.72;
      body.castShadow = true;
      group.add(body);

      const marker = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(0.9, 0.05, 0.9)),
        new THREE.LineBasicMaterial({ color: color === 0x4ea3ff ? 0x49d7ff : 0xff5b5b }),
      );
      marker.position.y = 0.06;
      group.add(marker);
      scene.add(group);
      return group;
    };

    const player = makeFighter(0x4ea3ff);
    const opponent = makeFighter(0xb94040);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const clickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    clickPlane.rotation.x = -Math.PI / 2;
    clickPlane.position.set(4.5, 0.08, 4.5);
    scene.add(clickPlane);

    const onPointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(clickPlane)[0];
      if (!hit) return;
      engine.dispatch({
        type: 'MOVE_TO',
        tile: { x: Math.round(hit.point.x), y: Math.round(hit.point.z) },
      });
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
      player.position.lerp(new THREE.Vector3(latest.player.tile.x, 0, latest.player.tile.y), 0.18);
      opponent.position.lerp(new THREE.Vector3(latest.opponent.tile.x, 0, latest.opponent.tile.y), 0.18);
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">OSRS PvP TRAINING LAB</span>
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
          <div className="panel-note">
            <strong>Prototype 0.1</strong>
            <span>Click a tile to move.</span>
          </div>
        </aside>

        <section className="viewport-wrap">
          <div className="opponent-hud panel">
            <div className="hud-row"><strong>Opponent</strong><span>{world.opponent.hp}/{world.opponent.maxHp}</span></div>
            <div className="hp-track"><div className="hp-fill enemy" style={{ width: hpPercent(world.opponent.hp, world.opponent.maxHp) }} /></div>
          </div>
          <div ref={mountRef} className="viewport" />
          <div className="arena-help">CLICK FLOOR TO MOVE · TRUE TILE GRID</div>
        </section>

        <aside className="right-panel panel">
          <div className="stat-block">
            <div className="hud-row"><strong>You</strong><span>{world.player.hp}/{world.player.maxHp}</span></div>
            <div className="hp-track"><div className="hp-fill" style={{ width: hpPercent(world.player.hp, world.player.maxHp) }} /></div>
          </div>

          <div className="inventory-title">INVENTORY</div>
          <div className="inventory-grid">
            {Array.from({ length: 28 }, (_, i) => (
              <button key={i} className={`slot ${i < 6 ? 'filled' : ''}`} aria-label={`Inventory slot ${i + 1}`}>
                {i === 0 ? 'KN' : i === 1 ? 'DT' : i === 2 ? 'SH' : i === 3 ? 'KO' : i === 4 ? 'FO' : i === 5 ? 'FO' : ''}
              </button>
            ))}
          </div>

          <div className="actions">
            <button
              className="attack-button"
              disabled={world.opponent.hp <= 0}
              onClick={() => engine.dispatch({ type: 'ATTACK', target: 'opponent' })}
            >
              Attack opponent
            </button>
            <button onClick={() => engine.reset()}>Reset fight</button>
          </div>

          <div className="debug-card">
            <span>Attack cooldown</span><strong>{world.player.attackCooldown}</strong>
            <span>True tile</span><strong>{world.player.tile.x}, {world.player.tile.y}</strong>
          </div>
        </aside>
      </section>
    </main>
  );
}
