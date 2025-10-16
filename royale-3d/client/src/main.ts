import { Engine, HemisphericLight, MeshBuilder, Scene, Vector3, ArcRotateCamera, Color3, StandardMaterial, TransformNode, Mesh, Ray, SceneLoader } from '@babylonjs/core';
import '@babylonjs/loaders';

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true);

let scene: Scene;
let socket: WebSocket | null = null;
let myId = '';
const others = new Map<string, Mesh>();

function createTerrain(scene: Scene) {
  const ground = MeshBuilder.CreateGround('ground', { width: 4000, height: 4000, subdivisions: 32 }, scene);
  const mat = new StandardMaterial('groundMat', scene);
  mat.diffuseColor = new Color3(0.12, 0.16, 0.20);
  ground.material = mat;
  ground.checkCollisions = true;
}

function createPlayer(scene: Scene) {
  const capsule = MeshBuilder.CreateCapsule('player', { height: 2, radius: 0.4 }, scene);
  capsule.position = new Vector3(0, 1, 0);
  capsule.checkCollisions = true;
  return capsule;
}

function setupThirdPersonCamera(scene: Scene, target: TransformNode) {
  const camera = new ArcRotateCamera('cam', Math.PI/2, Math.PI/3, 12, target.position, scene);
  camera.lowerRadiusLimit = 6;
  camera.upperRadiusLimit = 24;
  camera.attachControl(canvas, true);
  return camera;
}

function createScene() {
  scene = new Scene(engine);
  scene.collisionsEnabled = true;
  new HemisphericLight('light', new Vector3(0.2, 1, 0.2), scene);

  createTerrain(scene);
  const player = createPlayer(scene);
  const camera = setupThirdPersonCamera(scene, player);

  const inputState = { fwd: false, back: false, left: false, right: false, sprint: false };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') inputState.fwd = true;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') inputState.back = true;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') inputState.left = true;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') inputState.right = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inputState.sprint = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') inputState.fwd = false;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') inputState.back = false;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') inputState.left = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') inputState.right = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inputState.sprint = false;
  });

  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    const moveSpeed = (inputState.sprint ? 9 : 6) * dt;

    let dir = new Vector3(0, 0, 0);
    if (inputState.fwd) dir.z += 1;
    if (inputState.back) dir.z -= 1;
    if (inputState.left) dir.x -= 1;
    if (inputState.right) dir.x += 1;
    if (dir.lengthSquared() > 0) {
      dir = dir.normalize();
      // Move relative to camera facing
      const forward = camera.getForwardRay().direction;
      const right = Vector3.Cross(forward, Vector3.Up()).normalize();
      const move = right.scale(dir.x).add(forward.scale(dir.z));
      move.y = 0;
      player.moveWithCollisions(move.normalize().scale(moveSpeed));
      // Smoothly face movement direction
      player.rotation.y = Math.atan2(move.x, move.z);
    }
  });

  // --- Shooting ---
  window.addEventListener('mousedown', () => {
    const forward = camera.getForwardRay().direction.clone();
    const origin = player.position.add(new Vector3(0, 1, 0));
    const ray = new Ray(origin, forward, 1000);
    const s = MeshBuilder.CreateSphere('shot', { diameter: 0.2 }, scene);
    s.position = origin.clone();
    const vel = forward.scale(120);
    const born = performance.now();
    scene.onBeforeRenderObservable.add(() => {
      const dt = engine.getDeltaTime() / 1000;
      s.position.addInPlace(vel.scale(dt));
      if (performance.now() - born > 1500) s.dispose();
    });
    if (socket && myId) socket.send(JSON.stringify({ t: 'shot', from: origin.asArray(), dir: forward.asArray() }));
  });

  // --- Networking ---
  const url = (location.hostname === 'localhost' ? 'ws://localhost:8080' : `ws://${location.hostname}:8080`);
  socket = new WebSocket(url);
  socket.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.t === 'welcome') {
      myId = msg.id;
    } else if (msg.t === 'join') {
      if (msg.id !== myId && !others.has(msg.id)) {
        const m = MeshBuilder.CreateCapsule(`p-${msg.id}`, { height: 2, radius: 0.4 }, scene);
        m.position.y = 1;
        others.set(msg.id, m);
      }
    } else if (msg.t === 'leave') {
      const m = others.get(msg.id);
      if (m) { m.dispose(); others.delete(msg.id); }
    } else if (msg.t === 'state') {
      if (msg.id !== myId) {
        let m = others.get(msg.id);
        if (!m) {
          m = MeshBuilder.CreateCapsule(`p-${msg.id}`, { height: 2, radius: 0.4 }, scene);
          m.position.y = 1;
          others.set(msg.id, m);
        }
        const [x, y, z] = msg.p as number[];
        m.position.set(x, y, z);
        if (msg.r) m.rotation.y = msg.r;
      }
    } else if (msg.t === 'shot') {
      if (msg.id !== myId) {
        const from = Vector3.FromArray(msg.from as number[]);
        const dir = Vector3.FromArray(msg.dir as number[]);
        const s = MeshBuilder.CreateSphere('shot', { diameter: 0.2 }, scene);
        s.position = from;
        const vel = dir.normalize().scale(120);
        const born = performance.now();
        scene.onBeforeRenderObservable.add(() => {
          const dt = engine.getDeltaTime() / 1000;
          s.position.addInPlace(vel.scale(dt));
          if (performance.now() - born > 1500) s.dispose();
        });
      }
    }
  };

  // Send state at 15 Hz
  setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN || !myId) return;
    socket.send(JSON.stringify({ t: 'state', p: player.position.asArray(), r: player.rotation.y }));
  }, 66);

  return scene;
}

createScene();
engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
