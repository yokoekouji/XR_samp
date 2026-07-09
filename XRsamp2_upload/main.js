import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

const canvas = document.querySelector('#scene');
const handVideo = document.querySelector('#handVideo');
const handOverlay = document.querySelector('#handOverlay');
const handStatus = document.querySelector('#handStatus');
const handCursor = document.querySelector('#handCursor');
const handRig = document.querySelector('#handRig');
const leftMassEl = document.querySelector('#leftMass');
const rightMassEl = document.querySelector('#rightMass');
const tiltValueEl = document.querySelector('#tiltValue');
const resetButton = document.querySelector('#resetButton');
const arButton = document.querySelector('#arButton');
const handButton = document.querySelector('#handButton');
const modeText = document.querySelector('#modeText');
const hint = document.querySelector('#hint');
const overlayCtx = handOverlay.getContext('2d');
const rigCtx = handRig.getContext('2d');
const simpleTrackerCanvas = document.createElement('canvas');
const simpleTrackerCtx = simpleTrackerCanvas.getContext('2d', { willReadFrequently: true });
const rippleCanvas = document.createElement('canvas');
rippleCanvas.width = 512;
rippleCanvas.height = 512;
const rippleCtx = rippleCanvas.getContext('2d');
const rippleTexture = new THREE.CanvasTexture(rippleCanvas);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.01, 80);
camera.position.set(0, 1.15, 4.25);
camera.lookAt(0, 0.05, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;

const clock = new THREE.Clock();
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const dragPoint = new THREE.Vector3();
const dragOffset = new THREE.Vector3();
const tempWorld = new THREE.Vector3();
const labRoot = new THREE.Group();
const draggableBeakers = [];
const beakers = [];
const handModels = [];
const pourFx = {
  group: null,
  core: null,
  highlight: null,
  lipSheet: null,
  droplets: [],
  splashRing: null,
  splashFoam: null
};
const handCursors = [handCursor, createHandCursor('handCursor2')];

const liquidState = {
  left: 200,
  right: 0,
  capacity: 250
};

const handState = {
  enabled: false,
  loading: false,
  hands: createHandControllers(),
  lastVideoTime: -1,
  landmarker: null,
  useSimpleTracker: false,
  stream: null
};

let activeBeaker = null;
let xrSession = null;
let pouring = false;
const mouseGrabClient = new THREE.Vector2();
let mouseGrabRotation = 0;

const mats = {
  glass: new THREE.MeshPhysicalMaterial({
    color: 0xdff8ff,
    metalness: 0,
    roughness: 0.03,
    transmission: 0.58,
    transparent: true,
    opacity: 0.34,
    thickness: 0.08,
    side: THREE.DoubleSide
  }),
  glassEdge: new THREE.MeshStandardMaterial({ color: 0xeafcff, metalness: 0.18, roughness: 0.08, transparent: true, opacity: 0.58 }),
  liquid: new THREE.MeshPhysicalMaterial({
    color: 0x1faee7,
    roughness: 0.18,
    transparent: true,
    opacity: 0.78,
    transmission: 0.12,
    thickness: 0.18
  }),
  stream: new THREE.MeshPhysicalMaterial({
    color: 0x0ea6da,
    roughness: 0.08,
    transparent: true,
    opacity: 0.86,
    transmission: 0.18,
    thickness: 0.08
  }),
  streamHighlight: new THREE.MeshBasicMaterial({ color: 0xb7f7ff, transparent: true, opacity: 0.52 }),
  foam: new THREE.MeshBasicMaterial({ color: 0xd9fbff, transparent: true, opacity: 0.58, depthWrite: false }),
  handSkin: new THREE.MeshPhysicalMaterial({
    color: 0x9be7ff,
    roughness: 0.18,
    transparent: true,
    opacity: 0.28,
    transmission: 0.35,
    thickness: 0.06,
    depthWrite: false
  }),
  handBone: new THREE.MeshBasicMaterial({ color: 0xcff8ff, transparent: true, opacity: 0.46, depthWrite: false }),
  handPinch: new THREE.MeshBasicMaterial({ color: 0xffd58a, transparent: true, opacity: 0.62, depthWrite: false }),
  table: new THREE.MeshStandardMaterial({ color: 0x53626a, metalness: 0.18, roughness: 0.46 }),
  ceramic: new THREE.MeshStandardMaterial({ color: 0xe8eef0, metalness: 0.04, roughness: 0.36 }),
  ink: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.62 }),
  shadow: new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.24 })
};

const handConnections = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];

initScene();
initAR();
attachEvents();
resizeHandRig();
updateReadout(0);
renderer.setAnimationLoop(render);

function createHandCursor(id) {
  const cursor = handCursor.cloneNode(false);
  cursor.id = id;
  cursor.classList.add('hand-cursor');
  document.body.appendChild(cursor);
  return cursor;
}

function createHandControllers() {
  return [0, 1].map((index) => ({
    index,
    pinching: false,
    wasPinching: false,
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    depth: 0,
    activeBeaker: null,
    dragPlane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
    dragOffset: new THREE.Vector3(),
    grabClient: new THREE.Vector2(),
    grabRotation: 0
  }));
}

function initScene() {
  scene.add(new THREE.HemisphereLight(0xf4fbff, 0x35424a, 1.35));

  const key = new THREE.DirectionalLight(0xfff6df, 2.6);
  key.position.set(-2.7, 4.2, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);

  const fill = new THREE.PointLight(0x6ed8ff, 1.2, 6);
  fill.position.set(2.4, 1.7, 2.4);
  scene.add(fill);

  scene.add(labRoot);
  labRoot.position.set(0, -0.18, 0);
  buildLabBench();
  buildBeakers();
  buildPourStream();
  buildHandModels();
}

function buildHandModels() {
  for (let handIndex = 0; handIndex < 2; handIndex += 1) {
    const group = new THREE.Group();
    group.visible = false;
    group.renderOrder = 20;

    const joints = Array.from({ length: 21 }, (_, index) => {
      const joint = new THREE.Mesh(
        new THREE.SphereGeometry(index === 0 ? 0.045 : 0.028, 18, 12),
        index === 4 || index === 8 ? mats.handPinch.clone() : mats.handSkin.clone()
      );
      joint.renderOrder = 21;
      joint.material.depthTest = false;
      group.add(joint);
      return joint;
    });

    const bones = handConnections.map(([a, b]) => {
      const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 1, 14), mats.handBone.clone());
      bone.userData = { a, b };
      bone.renderOrder = 20;
      bone.material.depthTest = false;
      group.add(bone);
      return bone;
    });

    const palm = new THREE.Mesh(
      new THREE.CircleGeometry(0.18, 48),
      new THREE.MeshBasicMaterial({
        color: handIndex === 0 ? 0x68d8c8 : 0x86a8ff,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide
      })
    );
    palm.renderOrder = 19;
    group.add(palm);

    scene.add(group);
    handModels.push({ group, joints, bones, palm, points: Array.from({ length: 21 }, () => new THREE.Vector3()) });
  }
}

function hideHandModels() {
  handModels.forEach((model) => {
    model.group.visible = false;
  });
}

function updateHandModel(handIndex, landmarks, depth, pinching) {
  const model = handModels[handIndex];
  if (!model) return;

  const distanceFromCamera = THREE.MathUtils.lerp(1.85, 1.08, THREE.MathUtils.clamp(depth, 0, 1));
  landmarks.forEach((landmark, index) => {
    const ndc = new THREE.Vector3((1 - landmark.x) * 2 - 1, 1 - landmark.y * 2, 0.18);
    const world = ndc.unproject(camera);
    const direction = world.sub(camera.position).normalize();
    const zOffset = THREE.MathUtils.clamp(-(landmark.z || 0) * 0.85, -0.16, 0.18);
    model.points[index].copy(camera.position).add(direction.multiplyScalar(distanceFromCamera + zOffset));
    model.joints[index].position.copy(model.points[index]);
    model.joints[index].scale.setScalar(index === 4 || index === 8 ? (pinching ? 1.35 : 1.05) : 1);
  });

  model.bones.forEach((bone) => {
    const a = model.points[bone.userData.a];
    const b = model.points[bone.userData.b];
    const mid = a.clone().lerp(b, 0.5);
    const length = a.distanceTo(b);
    bone.position.copy(mid);
    bone.scale.set(1, Math.max(length, 0.001), 1);
    bone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  });

  const palmCenter = model.points[0].clone()
    .add(model.points[5])
    .add(model.points[9])
    .add(model.points[13])
    .add(model.points[17])
    .multiplyScalar(0.2);
  const palmWidth = model.points[5].distanceTo(model.points[17]);
  const palmHeight = model.points[0].distanceTo(model.points[9]);
  const palmNormal = model.points[5].clone().sub(model.points[17]).cross(model.points[0].clone().sub(model.points[9])).normalize();
  model.palm.position.copy(palmCenter);
  model.palm.scale.set(Math.max(palmWidth * 2.1, 0.12), Math.max(palmHeight * 1.8, 0.12), 1);
  model.palm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), palmNormal.lengthSq() > 0 ? palmNormal : new THREE.Vector3(0, 0, 1));
  model.group.visible = true;
}

function buildLabBench() {
  const table = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.12, 1.8), mats.table);
  table.position.set(0, -0.72, 0.02);
  table.castShadow = true;
  table.receiveShadow = true;
  labRoot.add(table);

  const tray = new THREE.Mesh(new THREE.BoxGeometry(2.95, 0.035, 1.18), mats.ceramic);
  tray.position.set(0, -0.635, 0.03);
  tray.castShadow = true;
  tray.receiveShadow = true;
  labRoot.add(tray);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.6, 80), mats.shadow);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.78;
  floor.receiveShadow = true;
  labRoot.add(floor);
}

function buildBeakers() {
  beakers.push(createBeaker('left', -0.72, 200));
  beakers.push(createBeaker('right', 0.78, 0));
  beakers.forEach((beaker) => labRoot.add(beaker.group));
}

function buildPourStream() {
  pourFx.group = new THREE.Group();
  pourFx.group.visible = false;

  pourFx.core = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(0, -1, 0)), 4, 0.028, 12), mats.stream.clone());
  pourFx.core.castShadow = true;
  pourFx.group.add(pourFx.core);

  pourFx.highlight = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(0, -1, 0)), 4, 0.007, 8), mats.streamHighlight.clone());
  pourFx.group.add(pourFx.highlight);

  pourFx.lipSheet = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.18, 3), mats.stream.clone());
  pourFx.lipSheet.castShadow = true;
  pourFx.group.add(pourFx.lipSheet);

  for (let i = 0; i < 16; i += 1) {
    const droplet = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), mats.stream.clone());
    droplet.userData.phase = i / 16;
    pourFx.droplets.push(droplet);
    pourFx.group.add(droplet);
  }

  pourFx.splashRing = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.005, 8, 56), mats.foam.clone());
  pourFx.splashRing.rotation.x = Math.PI / 2;
  pourFx.group.add(pourFx.splashRing);

  pourFx.splashFoam = new THREE.Mesh(new THREE.CircleGeometry(0.08, 40), mats.foam.clone());
  pourFx.splashFoam.rotation.x = -Math.PI / 2;
  pourFx.group.add(pourFx.splashFoam);

  labRoot.add(pourFx.group);
}

function createBeaker(id, x, volume) {
  const group = new THREE.Group();
  group.name = `${id}-beaker`;
  group.position.set(x, -0.12, 0.18);
  group.userData = {
    id,
    home: group.position.clone(),
    dragging: false,
    pourTilt: 0,
    targetTilt: 0,
    settleTilt: 0,
    fillVolume: volume,
    rippleStrength: 0
  };

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.9, 96, 1, true), mats.glass);
  body.position.y = 0.04;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.28, 0.035, 96), mats.glassEdge);
  bottom.position.y = -0.425;
  bottom.castShadow = true;
  group.add(bottom);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.018, 14, 96), mats.glassEdge);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.49;
  rim.castShadow = true;
  group.add(rim);

  const lip = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.12, 3), mats.glassEdge);
  lip.rotation.set(Math.PI / 2, 0, Math.PI / 6);
  lip.position.set(0.34, 0.49, 0);
  lip.scale.set(1.55, 0.55, 0.45);
  lip.castShadow = true;
  group.add(lip);

  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.292, 0.265, 1, 96), mats.liquid.clone());
  liquid.position.y = -0.39;
  liquid.castShadow = true;
  liquid.receiveShadow = true;
  group.add(liquid);

  const surfaceMat = mats.liquid.clone();
  surfaceMat.map = rippleTexture;
  surfaceMat.needsUpdate = true;
  const surface = new THREE.Mesh(new THREE.CircleGeometry(0.292, 96), surfaceMat);
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = -0.39;
  group.add(surface);

  const tiltedSurfaceMat = mats.liquid.clone();
  tiltedSurfaceMat.map = rippleTexture;
  tiltedSurfaceMat.needsUpdate = true;
  const tiltedSurface = new THREE.Mesh(new THREE.CircleGeometry(0.292, 96), tiltedSurfaceMat);
  tiltedSurface.rotation.x = -Math.PI / 2;
  tiltedSurface.position.y = -0.39;
  tiltedSurface.visible = false;
  group.add(tiltedSurface);

  const lipPool = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 16), mats.stream.clone());
  lipPool.position.set(0.23, 0.34, 0.01);
  lipPool.scale.set(1.3, 0.18, 0.62);
  lipPool.visible = false;
  lipPool.castShadow = true;
  group.add(lipPool);

  const innerRunoff = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.44), mats.stream.clone());
  innerRunoff.position.set(0.24, 0.14, 0.018);
  innerRunoff.rotation.set(-0.34, 0.05, -0.12);
  innerRunoff.scale.set(0.8, 1, 1);
  innerRunoff.visible = false;
  group.add(innerRunoff);

  const markings = new THREE.Mesh(
    new THREE.PlaneGeometry(0.23, 0.52),
    new THREE.MeshBasicMaterial({ map: createBeakerMarkTexture(), transparent: true, depthWrite: false })
  );
  markings.position.set(-0.235, 0.04, 0.245);
  markings.rotation.y = -0.38;
  group.add(markings);

  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.16),
    new THREE.MeshBasicMaterial({ map: createLabelTexture(id === 'left' ? 'A' : 'B'), transparent: true, depthWrite: false })
  );
  label.position.set(-0.12, 0.05, 0.31);
  label.rotation.y = -0.22;
  group.add(label);

  const pickArea = new THREE.Mesh(
    new THREE.SphereGeometry(0.58, 24, 16),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  pickArea.position.y = 0.05;
  pickArea.userData.pickArea = true;
  group.add(pickArea);

  const beaker = { id, group, liquid, surface, tiltedSurface, lipPool, innerRunoff };
  draggableBeakers.push(group);
  updateBeakerLiquid(beaker);
  return beaker;
}

function createBeakerMarkTexture() {
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 256;
  labelCanvas.height = 512;
  const ctx = labelCanvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 512);
  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 4;
  ctx.font = '700 34px Segoe UI, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('200', 116, 110);
  ctx.fillText('150', 116, 230);
  ctx.fillText('100', 116, 350);
  ctx.fillText('50', 105, 468);
  [84, 144, 204, 264, 324, 384, 444].forEach((y, index) => {
    ctx.beginPath();
    ctx.moveTo(132, y);
    ctx.lineTo(index % 2 === 0 ? 220 : 190, y);
    ctx.stroke();
  });
  return new THREE.CanvasTexture(labelCanvas);
}

function createLabelTexture(text) {
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 256;
  labelCanvas.height = 160;
  const ctx = labelCanvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 160);
  ctx.fillStyle = 'rgba(255,255,255,0.74)';
  ctx.beginPath();
  ctx.roundRect(34, 28, 188, 104, 26);
  ctx.fill();
  ctx.fillStyle = 'rgba(26, 47, 58, 0.84)';
  ctx.font = '800 64px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 82);
  return new THREE.CanvasTexture(labelCanvas);
}

function updateRippleTexture(time, strength) {
  rippleCtx.clearRect(0, 0, rippleCanvas.width, rippleCanvas.height);

  const cx = rippleCanvas.width / 2;
  const cy = rippleCanvas.height / 2;
  const base = rippleCtx.createRadialGradient(cx, cy, 8, cx, cy, 252);
  base.addColorStop(0, 'rgba(100, 225, 255, 0.18)');
  base.addColorStop(0.65, 'rgba(31, 174, 231, 0.24)');
  base.addColorStop(1, 'rgba(10, 119, 166, 0.16)');
  rippleCtx.fillStyle = base;
  rippleCtx.fillRect(0, 0, rippleCanvas.width, rippleCanvas.height);

  const waveAlpha = 0.16 + strength * 0.46;
  rippleCtx.lineCap = 'round';
  for (let i = 0; i < 12; i += 1) {
    const phase = (time * (52 + strength * 28) + i * 29) % 220;
    const radius = 18 + phase;
    const fade = 1 - radius / 250;
    if (fade <= 0) continue;
    rippleCtx.beginPath();
    rippleCtx.ellipse(cx, cy, radius * 1.08, radius * 0.78, 0, 0, Math.PI * 2);
    rippleCtx.strokeStyle = `rgba(205, 248, 255, ${waveAlpha * fade})`;
    rippleCtx.lineWidth = 2.5 + strength * 2;
    rippleCtx.stroke();

    rippleCtx.beginPath();
    rippleCtx.ellipse(cx + 2, cy + 1, radius * 0.82, radius * 0.58, 0, 0, Math.PI * 2);
    rippleCtx.strokeStyle = `rgba(11, 111, 165, ${0.12 * strength * fade})`;
    rippleCtx.lineWidth = 1.6;
    rippleCtx.stroke();
  }

  const center = rippleCtx.createRadialGradient(cx, cy, 0, cx, cy, 56 + strength * 20);
  center.addColorStop(0, `rgba(235, 255, 255, ${0.34 + strength * 0.28})`);
  center.addColorStop(0.48, `rgba(87, 214, 247, ${0.18 + strength * 0.2})`);
  center.addColorStop(1, 'rgba(87, 214, 247, 0)');
  rippleCtx.fillStyle = center;
  rippleCtx.fillRect(0, 0, rippleCanvas.width, rippleCanvas.height);

  rippleTexture.needsUpdate = true;
}

function updateBeakerLiquid(beaker) {
  const volume = liquidState[beaker.id];
  beaker.group.userData.fillVolume = volume;
  const height = THREE.MathUtils.mapLinear(volume, 0, liquidState.capacity, 0.012, 0.78);
  beaker.liquid.visible = volume > 1;
  beaker.surface.visible = volume > 1;
  beaker.tiltedSurface.visible = false;
  beaker.lipPool.visible = false;
  beaker.innerRunoff.visible = false;
  beaker.liquid.scale.y = height;
  beaker.liquid.position.y = -0.405 + height / 2;
  beaker.surface.position.y = -0.405 + height;
  beaker.tiltedSurface.position.y = beaker.surface.position.y;
  beaker.surface.scale.setScalar(THREE.MathUtils.mapLinear(height, 0, 0.78, 0.92, 1));
  beaker.tiltedSurface.scale.copy(beaker.surface.scale);
  updateBeakerLiquidPose(beaker);
}

function updateBeakerLiquidPose(beaker) {
  const volume = liquidState[beaker.id];
  if (volume <= 1) return;

  const target = findNearestOtherBeaker(beaker.group);
  const direction = target ? Math.sign(target.position.x - beaker.group.position.x) || 1 : 1;
  const tilt = beaker.group.rotation.z;
  const pourAngle = Math.max(0, -tilt * direction);
  const slosh = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(pourAngle, 0.12, 0.82, 0, 1), 0, 1);
  const height = THREE.MathUtils.mapLinear(volume, 0, liquidState.capacity, 0.012, 0.78);
  const surfaceY = -0.405 + height;
  const rippleStrength = beaker.group.userData.rippleStrength || 0;
  const rippleLift = Math.sin(clock.elapsedTime * 14) * 0.006 * rippleStrength;

  beaker.surface.visible = volume > 1 && slosh < 0.16;
  beaker.tiltedSurface.visible = volume > 1 && slosh >= 0.06;
  beaker.surface.position.y = surfaceY + rippleLift;
  beaker.tiltedSurface.position.set(0.025 * direction * slosh, surfaceY + 0.018 * slosh + rippleLift, 0.005);
  beaker.tiltedSurface.rotation.set(-Math.PI / 2, 0, -tilt * 0.38);
  beaker.tiltedSurface.scale.set(
    THREE.MathUtils.mapLinear(height, 0, 0.78, 0.76, 0.9) * (1 + slosh * 0.04),
    THREE.MathUtils.mapLinear(height, 0, 0.78, 0.76, 0.88) * (1 - slosh * 0.12),
    1
  );

  beaker.liquid.rotation.z = 0;
  beaker.liquid.position.x = 0.012 * direction * slosh;
  beaker.liquid.scale.x = 0.94 + slosh * 0.02;
  beaker.liquid.scale.z = 0.96 - slosh * 0.03;

  beaker.lipPool.visible = false;
  beaker.innerRunoff.visible = false;
}

function initAR() {
  if (!navigator.xr) {
    arButton.disabled = true;
    arButton.textContent = 'AR非対応';
    modeText.textContent = '3D実験モード';
    return;
  }

  navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
    if (!supported) {
      arButton.disabled = true;
      arButton.textContent = 'AR非対応';
      modeText.textContent = '3D実験モード';
      return;
    }

    arButton.addEventListener('click', async () => {
      if (xrSession) {
        await xrSession.end();
        return;
      }

      const button = ARButton.createButton(renderer, {
        requiredFeatures: [],
        optionalFeatures: ['dom-overlay', 'hit-test'],
        domOverlay: { root: document.body }
      });
      button.click();
    });
  });

  renderer.xr.addEventListener('sessionstart', () => {
    xrSession = renderer.xr.getSession();
    document.body.classList.add('xr-active');
    modeText.textContent = 'AR実験モード';
    labRoot.position.set(0, -0.42, -1.85);
    labRoot.scale.setScalar(0.72);
    xrSession.addEventListener('end', () => {
      xrSession = null;
      document.body.classList.remove('xr-active');
      modeText.textContent = '3D実験モード';
      labRoot.position.set(0, -0.18, 0);
      labRoot.scale.setScalar(1);
    }, { once: true });
  });
}

function attachEvents() {
  window.addEventListener('resize', onResize);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  resetButton.addEventListener('click', resetExperiment);
  handButton.addEventListener('click', toggleHandControl);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeHandRig();
}

function resizeHandRig() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  handRig.width = Math.floor(window.innerWidth * ratio);
  handRig.height = Math.floor(window.innerHeight * ratio);
  handRig.style.width = `${window.innerWidth}px`;
  handRig.style.height = `${window.innerHeight}px`;
  rigCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function setPointerFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
}

function onPointerDown(event) {
  const grabbed = beginDragAtClient(event.clientX, event.clientY);
  if (grabbed) canvas.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  moveDragAtClient(event.clientX, event.clientY);
}

function onPointerUp(event) {
  endDragAtClient(event.clientX, event.clientY);
}

function beginDragAtClient(clientX, clientY, options = {}) {
  const dragState = options.dragState ?? null;
  setPointerFromClient(clientX, clientY);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(draggableBeakers, true);
  const fallbackBeaker = options.allowNearest ? findNearestBeakerAtClient(clientX, clientY, options.radius ?? 150) : null;
  if (!hits.length && !fallbackBeaker) return false;

  const beaker = hits.length ? findBeakerRoot(hits[0].object) : fallbackBeaker;
  const existingHand = handState.hands.find((hand) => hand.activeBeaker === beaker);
  if (existingHand && existingHand !== dragState) return false;
  if (!dragState && handState.hands.some((hand) => hand.activeBeaker === beaker)) return false;

  setDragBeaker(dragState, beaker);
  beaker.userData.dragging = true;
  beaker.userData.targetTilt = beaker.rotation.z;
  getGrabClient(dragState).set(clientX, clientY);
  setGrabRotation(dragState, beaker.rotation.z);
  getDragPlane(dragState).setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), beaker.getWorldPosition(tempWorld));
  raycaster.ray.intersectPlane(getDragPlane(dragState), dragPoint);
  getDragOffset(dragState).copy(beaker.position).sub(labRoot.worldToLocal(dragPoint.clone()));
  hint.textContent = 'ビーカーを傾けると、近くのビーカーへ青い液体が流れます。';
  return true;
}

function moveDragAtClient(clientX, clientY, depth = null, dragState = null) {
  const beaker = getDragBeaker(dragState);
  if (!beaker) return;
  setPointerFromClient(clientX, clientY);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(getDragPlane(dragState), dragPoint)) return;
  const localPoint = labRoot.worldToLocal(dragPoint.clone());
  beaker.position.copy(localPoint.add(getDragOffset(dragState)));
  if (depth !== null) {
    const targetZ = THREE.MathUtils.lerp(0.9, -0.12, THREE.MathUtils.clamp(depth, 0, 1));
    beaker.position.z = THREE.MathUtils.lerp(beaker.position.z, targetZ, 0.42);
  }
  beaker.position.y = THREE.MathUtils.clamp(beaker.position.y, -0.16, 0.64);

  const grabClient = getGrabClient(dragState);
  const dx = clientX - grabClient.x;
  const dy = clientY - grabClient.y;
  const nearest = findNearestOtherBeaker(beaker);
  const direction = nearest ? Math.sign(nearest.position.x - beaker.position.x) || 1 : 1;
  const intendedTilt = getGrabRotation(dragState) - direction * THREE.MathUtils.clamp((Math.abs(dx) + Math.max(0, -dy) * 0.7) / 240, 0, 1.05);
  beaker.userData.targetTilt = THREE.MathUtils.clamp(intendedTilt, -1.1, 1.1);
}

function endDragAtClient(clientX, clientY, dragState = null) {
  const beaker = getDragBeaker(dragState);
  if (!beaker) return;
  setPointerFromClient(clientX, clientY);
  commitPourOnRelease(beaker);
  beaker.userData.dragging = false;
  beaker.userData.targetTilt = 0;
  setDragBeaker(dragState, null);
  hint.textContent = handState.enabled
    ? '親指と人差し指でビーカーをつかみ、少し持ち上げて傾けてください。'
    : '青い液体入りのビーカーをつかみ、傾けて右のビーカーへ注いでください。';
}

function getDragBeaker(dragState) {
  return dragState ? dragState.activeBeaker : activeBeaker;
}

function setDragBeaker(dragState, beaker) {
  if (dragState) {
    dragState.activeBeaker = beaker;
  } else {
    activeBeaker = beaker;
  }
}

function getDragPlane(dragState) {
  return dragState ? dragState.dragPlane : dragPlane;
}

function getDragOffset(dragState) {
  return dragState ? dragState.dragOffset : dragOffset;
}

function getGrabClient(dragState) {
  return dragState ? dragState.grabClient : mouseGrabClient;
}

function getGrabRotation(dragState) {
  return dragState ? dragState.grabRotation : mouseGrabRotation;
}

function setGrabRotation(dragState, value) {
  if (dragState) {
    dragState.grabRotation = value;
  } else {
    mouseGrabRotation = value;
  }
}

async function toggleHandControl() {
  if (handState.enabled) {
    stopHandControl();
    return;
  }

  if (handState.loading) return;
  handState.loading = true;
  handButton.disabled = true;
  handButton.textContent = '準備中';
  handStatus.textContent = 'カメラを準備中';

  try {
    await startHandControl();
  } catch (error) {
    console.error(error);
    handStatus.textContent = 'カメラを開始できません';
    hint.textContent = 'ブラウザのカメラ許可を確認してください。';
    stopHandControl();
  } finally {
    handState.loading = false;
    handButton.disabled = false;
  }
}

async function startHandControl() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API is not available.');
  }

  handState.stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  });
  handVideo.srcObject = handState.stream;
  await handVideo.play();

  if (!handState.landmarker && !handState.useSimpleTracker) {
    try {
      handState.landmarker = await createHandLandmarker();
    } catch (error) {
      console.warn('MediaPipe failed. Using simple camera hand tracker.', error);
      handState.useSimpleTracker = true;
    }
  }
  handOverlay.width = handVideo.videoWidth || 640;
  handOverlay.height = handVideo.videoHeight || 480;
  simpleTrackerCanvas.width = handOverlay.width;
  simpleTrackerCanvas.height = handOverlay.height;
  handState.enabled = true;
  handState.lastVideoTime = -1;
  handState.hands.forEach((hand, index) => {
    hand.pinching = false;
    hand.wasPinching = false;
    hand.x = window.innerWidth * (index === 0 ? 0.45 : 0.55);
    hand.y = window.innerHeight / 2;
    hand.depth = 0;
    hand.activeBeaker = null;
  });
  resizeHandRig();
  document.body.classList.add('hand-active');
  handButton.textContent = '手操作停止';
  modeText.textContent = handState.useSimpleTracker ? '簡易手検出モード' : '手認識モード';
  handStatus.textContent = handState.useSimpleTracker ? '手を明るく映してください' : '親指と人差し指でビーカーをつかむ';
  hint.textContent = '親指と人差し指でビーカーをつかみ、少し持ち上げて傾けてください。';
  drawSearchRig();
  requestAnimationFrame(updateHandControl);
}

async function createHandLandmarker() {
  const sources = [
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20',
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14',
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3',
    'https://unpkg.com/@mediapipe/tasks-vision@0.10.20',
    'https://unpkg.com/@mediapipe/tasks-vision@0.10.14'
  ];
  let lastError = null;
  for (const source of sources) {
    try {
      const { FilesetResolver, HandLandmarker } = await import(source);
      const vision = await FilesetResolver.forVisionTasks(`${source}/wasm`);
      return await createLandmarkerWithDelegate(HandLandmarker, vision, 'GPU');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('MediaPipe could not be loaded.');
}

async function createLandmarkerWithDelegate(HandLandmarker, vision, delegate) {
  const options = {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
      delegate
    },
    runningMode: 'VIDEO',
    numHands: 2
  };

  try {
    return await HandLandmarker.createFromOptions(vision, options);
  } catch {
    return await HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: 'CPU' }
    });
  }
}

function stopHandControl() {
  handState.hands.forEach((hand) => {
    if (hand.activeBeaker) endDragAtClient(hand.x, hand.y, hand);
    hand.pinching = false;
    hand.wasPinching = false;
    hand.depth = 0;
    hand.activeBeaker = null;
  });
  activeBeaker = null;
  handState.enabled = false;
  handState.useSimpleTracker = false;
  handButton.textContent = '手で操作';
  handStatus.textContent = 'カメラ待機中';
  modeText.textContent = '3D実験モード';
  document.body.classList.remove('hand-active', 'hand-pinching', 'hand-searching');
  handCursors.forEach((cursor) => {
    cursor.style.opacity = '0';
    cursor.classList.remove('pinching');
  });
  overlayCtx.clearRect(0, 0, handOverlay.width, handOverlay.height);
  clearViewportRig();
  hideHandModels();

  if (handState.stream) {
    handState.stream.getTracks().forEach((track) => track.stop());
    handState.stream = null;
  }
  handVideo.srcObject = null;
}

function updateHandControl() {
  if (!handState.enabled) return;

  if (handVideo.currentTime !== handState.lastVideoTime) {
    handState.lastVideoTime = handVideo.currentTime;
    const result = handState.landmarker
      ? handState.landmarker.detectForVideo(handVideo, performance.now())
      : processSimpleHandFromVideo();
    processHandResult(result);
  }

  requestAnimationFrame(updateHandControl);
}

function processHandResult(result) {
  overlayCtx.clearRect(0, 0, handOverlay.width, handOverlay.height);

  const detectedHands = (result.landmarks ?? []).slice(0, handState.hands.length);
  if (!detectedHands.length) {
    handStatus.textContent = handState.useSimpleTracker
      ? '未検出: 明るい場所で手を大きく映してください'
      : '未検出: 手をカメラに映してください';
    handCursors.forEach((cursor) => {
      cursor.style.opacity = '0';
      cursor.classList.remove('pinching');
    });
    handState.hands.forEach((hand) => {
      hand.depth += (0 - hand.depth) * 0.12;
      if (hand.activeBeaker) endDragAtClient(hand.x, hand.y, hand);
      hand.pinching = false;
      hand.wasPinching = false;
    });
    hideHandModels();
    document.body.classList.remove('hand-pinching', 'hand-tracked');
    document.body.classList.add('hand-searching');
    drawSearchRig();
    return;
  }

  detectedHands.forEach((landmarks) => drawHandSkeleton(landmarks));
  drawViewportRig(detectedHands);
  document.body.classList.add('hand-tracked');
  document.body.classList.remove('hand-searching');

  handState.hands.forEach((hand, index) => {
    const landmarks = detectedHands[index];
    const cursor = handCursors[index];
    if (!landmarks) {
      cursor.style.opacity = '0';
      cursor.classList.remove('pinching');
      if (handModels[index]) handModels[index].group.visible = false;
      if (hand.activeBeaker) endDragAtClient(hand.x, hand.y, hand);
      hand.pinching = false;
      hand.wasPinching = false;
      return;
    }

    const estimatedDepth = estimateHandDepth(landmarks);
    hand.depth += (estimatedDepth - hand.depth) * 0.22;
    const indexTip = landmarks[8];
    const thumbTip = landmarks[4];
    const rawX = (1 - indexTip.x) * window.innerWidth;
    const rawY = indexTip.y * window.innerHeight;
    hand.x += (rawX - hand.x) * 0.35;
    hand.y += (rawY - hand.y) * 0.35;

    const pinchDistance = distance(indexTip, thumbTip);
    hand.pinching = hand.pinching ? pinchDistance < 0.085 : pinchDistance < 0.055;
    if (handModels[index]) handModels[index].group.visible = false;
    cursor.style.left = `${hand.x}px`;
    cursor.style.top = `${hand.y}px`;
    cursor.style.opacity = '1';
    cursor.classList.toggle('pinching', hand.pinching);

    if (hand.pinching && (!hand.wasPinching || !hand.activeBeaker)) {
      const grabbed = beginDragAtClient(hand.x, hand.y, { allowNearest: true, radius: 160, dragState: hand });
      if (grabbed) moveDragAtClient(hand.x, hand.y, hand.depth, hand);
    } else if (hand.pinching && hand.activeBeaker) {
      moveDragAtClient(hand.x, hand.y, hand.depth, hand);
    } else if (!hand.pinching && hand.wasPinching) {
      endDragAtClient(hand.x, hand.y, hand);
    }

    hand.wasPinching = hand.pinching;
  });

  const activeHands = handState.hands.filter((hand) => hand.pinching).length;
  document.body.classList.toggle('hand-pinching', activeHands > 0);
  handStatus.textContent = activeHands
    ? `認識中: ${activeHands}手でつかんでいます`
    : `認識中: ${detectedHands.length}手を認識中`;
}

function estimateHandDepth(landmarks) {
  const xs = landmarks.map((point) => point.x);
  const ys = landmarks.map((point) => point.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return THREE.MathUtils.smoothstep(span, 0.24, 0.62);
}

function processSimpleHandFromVideo() {
  const width = simpleTrackerCanvas.width;
  const height = simpleTrackerCanvas.height;
  simpleTrackerCtx.drawImage(handVideo, 0, 0, width, height);
  const image = simpleTrackerCtx.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;

  for (let i = 0; i < image.data.length; i += 16) {
    const r = image.data[i];
    const g = image.data[i + 1];
    const b = image.data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (r > 90 && g > 52 && b > 38 && max - min > 22 && r > b * 1.08) {
      const pixel = i / 4;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count += 1;
    }
  }

  if (count < 180) return { landmarks: [] };
  const boxWidth = Math.max(40, maxX - minX);
  const boxHeight = Math.max(40, maxY - minY);
  return { landmarks: [createSimpleHandLandmarks((minX + maxX) / 2 / width, (minY + maxY) / 2 / height, boxWidth / width, boxHeight / height)] };
}

function createSimpleHandLandmarks(cx, cy, boxWidth, boxHeight) {
  const points = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  const spread = Math.max(boxWidth, boxHeight) * 0.38;
  const thumb = { x: cx - spread * 0.58, y: cy + spread * 0.08, z: 0 };
  const index = { x: cx + spread * 0.45, y: cy - spread * 0.24, z: 0 };
  points[0] = { x: cx, y: cy + spread * 0.45, z: 0 };
  points[4] = thumb;
  points[8] = index;
  points[5] = { x: cx + spread * 0.18, y: cy - spread * 0.02, z: 0 };
  points[9] = { x: cx + spread * 0.02, y: cy - spread * 0.08, z: 0 };
  points[13] = { x: cx - spread * 0.12, y: cy, z: 0 };
  points[17] = { x: cx - spread * 0.28, y: cy + spread * 0.12, z: 0 };
  return points.map((point) => ({
    x: THREE.MathUtils.clamp(point.x, 0.02, 0.98),
    y: THREE.MathUtils.clamp(point.y, 0.02, 0.98),
    z: 0
  }));
}

function drawHandSkeleton(landmarks) {
  const width = handOverlay.width;
  const height = handOverlay.height;
  overlayCtx.lineWidth = 3;
  overlayCtx.strokeStyle = 'rgba(80, 190, 168, 0.9)';
  overlayCtx.fillStyle = 'rgba(240, 181, 77, 0.9)';
  for (const [a, b] of handConnections) {
    overlayCtx.beginPath();
    overlayCtx.moveTo(landmarks[a].x * width, landmarks[a].y * height);
    overlayCtx.lineTo(landmarks[b].x * width, landmarks[b].y * height);
    overlayCtx.stroke();
  }
  [4, 8].forEach((index) => {
    overlayCtx.beginPath();
    overlayCtx.arc(landmarks[index].x * width, landmarks[index].y * height, 7, 0, Math.PI * 2);
    overlayCtx.fill();
  });
}

function clearViewportRig() {
  rigCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  document.body.classList.remove('hand-tracked', 'hand-searching');
}

function drawSearchRig() {
  rigCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const scale = Math.min(window.innerWidth, window.innerHeight) / 520;
  rigCtx.strokeStyle = 'rgba(80, 190, 168, 0.62)';
  rigCtx.lineWidth = 4;
  rigCtx.beginPath();
  rigCtx.arc(cx, cy, 88 * scale, 0, Math.PI * 2);
  rigCtx.stroke();
  rigCtx.fillStyle = 'rgba(247,244,236,0.78)';
  rigCtx.font = `${14 * scale}px Segoe UI, sans-serif`;
  rigCtx.textAlign = 'center';
  rigCtx.fillText('手をカメラに映してください', cx, cy + 126 * scale);
  document.body.classList.add('hand-searching');
  document.body.classList.remove('hand-tracked');
}

function drawViewportRig(landmarkSets) {
  rigCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  landmarkSets.forEach((landmarks, handIndex) => {
    const points = landmarks.map((point) => ({
      x: (1 - point.x) * window.innerWidth,
      y: point.y * window.innerHeight
    }));
    const pinchDistance = Math.hypot(points[4].x - points[8].x, points[4].y - points[8].y);
    drawHandSurface(points, handIndex);
    drawHandBoneLines(points, handIndex);
    drawHandJointDots(points, pinchDistance < 54);
  });
}

function drawHandSurface(points, handIndex) {
  const surface = handIndex === 0 ? 'rgba(70, 188, 162, 0.26)' : 'rgba(96, 144, 214, 0.24)';
  const glow = handIndex === 0 ? 'rgba(91, 221, 195, 0.12)' : 'rgba(130, 171, 235, 0.11)';
  const fingerChains = [
    [0, 1, 2, 3, 4],
    [0, 5, 6, 7, 8],
    [0, 9, 10, 11, 12],
    [0, 13, 14, 15, 16],
    [0, 17, 18, 19, 20]
  ];

  rigCtx.save();
  rigCtx.lineCap = 'round';
  rigCtx.lineJoin = 'round';
  fingerChains.forEach((chain) => {
    drawSmoothHandPath(points, chain);
    rigCtx.strokeStyle = glow;
    rigCtx.lineWidth = 58;
    rigCtx.stroke();
    drawSmoothHandPath(points, chain);
    rigCtx.strokeStyle = surface;
    rigCtx.lineWidth = 38;
    rigCtx.stroke();
  });

  const wrist = points[0];
  rigCtx.beginPath();
  rigCtx.moveTo(wrist.x, wrist.y);
  [1, 5, 9, 13, 17].forEach((index) => {
    const point = points[index];
    rigCtx.lineTo(point.x, point.y);
  });
  rigCtx.closePath();
  rigCtx.fillStyle = surface;
  rigCtx.fill();
  rigCtx.restore();
}

function drawHandBoneLines(points, handIndex) {
  const core = handIndex === 0 ? 'rgba(117, 238, 218, 0.94)' : 'rgba(148, 184, 246, 0.92)';
  rigCtx.save();
  rigCtx.lineCap = 'round';
  rigCtx.lineJoin = 'round';
  handConnections.forEach(([a, b]) => {
    rigCtx.beginPath();
    rigCtx.moveTo(points[a].x, points[a].y);
    rigCtx.lineTo(points[b].x, points[b].y);
    rigCtx.strokeStyle = 'rgba(2, 17, 19, 0.92)';
    rigCtx.lineWidth = 7;
    rigCtx.stroke();
    rigCtx.strokeStyle = core;
    rigCtx.lineWidth = 3;
    rigCtx.stroke();
  });
  rigCtx.restore();
}

function drawHandJointDots(points, pinching) {
  rigCtx.save();
  points.forEach((point, index) => {
    const isPinchPoint = index === 4 || index === 8;
    const radius = isPinchPoint ? 7 : 5;
    if (isPinchPoint) {
      rigCtx.beginPath();
      rigCtx.arc(point.x, point.y, pinching ? 18 : 14, 0, Math.PI * 2);
      rigCtx.fillStyle = pinching ? 'rgba(240, 181, 77, 0.32)' : 'rgba(240, 181, 77, 0.18)';
      rigCtx.fill();
      rigCtx.beginPath();
      rigCtx.arc(point.x, point.y, pinching ? 10 : 8, 0, Math.PI * 2);
      rigCtx.fillStyle = 'rgba(240, 181, 77, 0.95)';
      rigCtx.fill();
    }
    rigCtx.beginPath();
    rigCtx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    rigCtx.fillStyle = isPinchPoint ? 'rgba(240, 181, 77, 0.95)' : 'rgba(247, 252, 248, 0.98)';
    rigCtx.fill();
    rigCtx.lineWidth = 2.5;
    rigCtx.strokeStyle = 'rgba(3, 18, 20, 0.9)';
    rigCtx.stroke();
  });
  rigCtx.restore();
}

function drawSmoothHandPath(points, indices) {
  rigCtx.beginPath();
  const first = points[indices[0]];
  rigCtx.moveTo(first.x, first.y);
  for (let i = 1; i < indices.length - 1; i += 1) {
    const current = points[indices[i]];
    const next = points[indices[i + 1]];
    rigCtx.quadraticCurveTo(current.x, current.y, (current.x + next.x) * 0.5, (current.y + next.y) * 0.5);
  }
  const last = points[indices[indices.length - 1]];
  rigCtx.lineTo(last.x, last.y);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function findBeakerRoot(object) {
  let current = object;
  while (current.parent && !draggableBeakers.includes(current)) current = current.parent;
  return current;
}

function findNearestBeakerAtClient(clientX, clientY, radius) {
  let nearest = null;
  const screenPoint = new THREE.Vector3();
  for (const beaker of draggableBeakers) {
    beaker.getWorldPosition(screenPoint);
    screenPoint.project(camera);
    const x = (screenPoint.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-screenPoint.y * 0.5 + 0.5) * window.innerHeight;
    const dist = Math.hypot(clientX - x, clientY - y);
    if (dist <= radius && (!nearest || dist < nearest.distance)) {
      nearest = { beaker, distance: dist };
    }
  }
  return nearest?.beaker || null;
}

function findNearestOtherBeaker(beaker) {
  let nearest = null;
  for (const candidate of draggableBeakers) {
    if (candidate === beaker) continue;
    const dist = beaker.position.distanceTo(candidate.position);
    if (!nearest || dist < nearest.distance) nearest = { beaker: candidate, distance: dist };
  }
  return nearest?.beaker || null;
}

function findBeakerModel(id) {
  return beakers.find((beaker) => beaker.id === id);
}

function getPourInfo(source, useTargetTilt = false) {
  const sourceId = source.userData.id;
  if (liquidState[sourceId] <= 0.5) return null;
  const target = findNearestOtherBeaker(source);
  if (!target) return null;
  const direction = Math.sign(target.position.x - source.position.x) || 1;
  const tilt = useTargetTilt ? source.userData.targetTilt : source.rotation.z;
  const pourAngle = -tilt * direction;
  const closeEnough = source.position.distanceTo(target.position) < 1.42;
  const lifted = source.position.y > -0.14;
  const targetId = target.userData.id;
  const space = liquidState.capacity - liquidState[targetId];
  if (pourAngle < 0.5 || !closeEnough || !lifted || space <= 0.5) return null;
  return { sourceId, target, targetId, pourAngle, space };
}

function commitPourOnRelease(source) {
  const info = getPourInfo(source, true);
  if (!info) return;
  const amount = Math.min(info.space, liquidState[info.sourceId], THREE.MathUtils.mapLinear(info.pourAngle, 0.5, 1.1, 18, 58));
  liquidState[info.sourceId] -= amount;
  liquidState[info.targetId] += amount;
  beakers.forEach(updateBeakerLiquid);
  hint.textContent = '液体が移りました。もう一度傾けると続けて注げます。';
}

function updatePourStream(source, target, pourAngle) {
  if (!pourFx.group) return;
  const time = clock.elapsedTime;
  const direction = Math.sign(target.position.x - source.position.x) || 1;
  const strength = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(pourAngle, 0.5, 1.1, 0, 1), 0, 1);
  const pulse = Math.sin(time * 18) * 0.004 + Math.sin(time * 31) * 0.002;
  const start = source.position.clone().add(new THREE.Vector3(0.29 * direction, 0.4, 0.015));
  const end = target.position.clone().add(new THREE.Vector3(-0.05 * direction, 0.29, 0.03));
  const fall = Math.max(0.28, start.y - end.y);
  const reach = end.clone().sub(start);
  const controlA = start.clone().add(new THREE.Vector3(0.12 * direction, -0.08 - strength * 0.08, 0.015));
  const controlB = start.clone().add(reach.multiplyScalar(0.66)).add(new THREE.Vector3(0.04 * direction, -fall * 0.34 - strength * 0.04, -0.01));
  const curve = new THREE.CatmullRomCurve3([start, controlA, controlB, end], false, 'centripetal');
  const highlightCurve = new THREE.CatmullRomCurve3(
    [start, controlA, controlB, end].map((point) => point.clone().add(new THREE.Vector3(-0.014 * direction, 0.012, 0.018))),
    false,
    'centripetal'
  );

  replaceTubeGeometry(pourFx.core, curve, 0.024 + strength * 0.016 + pulse, 18);
  replaceTubeGeometry(pourFx.highlight, highlightCurve, 0.005 + strength * 0.003, 10);
  pourFx.group.visible = true;

  pourFx.lipSheet.visible = false;

  pourFx.droplets.forEach((droplet, index) => {
    const t = (time * (0.55 + strength * 0.55) + droplet.userData.phase) % 1;
    const point = curve.getPointAt(t);
    const sideDrift = Math.sin((time * 9) + index * 1.7) * 0.018 * (1 - Math.abs(t - 0.5));
    droplet.visible = t > 0.14 && t < 0.96 && index % 3 !== 0;
    droplet.position.copy(point).add(new THREE.Vector3(sideDrift, 0, Math.cos(index * 2.1 + time * 7) * 0.01));
    const size = 0.55 + strength * 0.55 + Math.sin(time * 14 + index) * 0.14;
    droplet.scale.setScalar(size);
  });

  const ripple = 0.82 + Math.sin(time * 15) * 0.16;
  pourFx.splashRing.visible = true;
  pourFx.splashRing.position.copy(end).add(new THREE.Vector3(0, 0.01, 0));
  pourFx.splashRing.scale.setScalar(ripple + strength * 0.42);
  pourFx.splashRing.material.opacity = 0.28 + strength * 0.34;

  pourFx.splashFoam.visible = true;
  pourFx.splashFoam.position.copy(end).add(new THREE.Vector3(0, 0.012, 0));
  pourFx.splashFoam.scale.set(0.78 + strength * 0.52, 0.42 + strength * 0.22, 1);
  pourFx.splashFoam.material.opacity = 0.22 + strength * 0.22;
}

function replaceTubeGeometry(mesh, curve, radius, radialSegments) {
  mesh.geometry.dispose();
  mesh.geometry = new THREE.TubeGeometry(curve, 28, radius, radialSegments, false);
}

function updatePouring(delta) {
  pouring = false;
  if (pourFx.group) pourFx.group.visible = false;
  beakers.forEach((beaker) => {
    beaker.group.userData.rippleStrength *= 0.9;
  });
  draggableBeakers.forEach((source) => {
    const info = getPourInfo(source);
    if (!info) return;
    const flow = Math.min(info.space, liquidState[info.sourceId], delta * THREE.MathUtils.mapLinear(info.pourAngle, 0.5, 1.1, 34, 110));
    liquidState[info.sourceId] -= flow;
    liquidState[info.targetId] += flow;
    updatePourStream(source, info.target, info.pourAngle);
    const targetModel = findBeakerModel(info.targetId);
    if (targetModel) targetModel.group.userData.rippleStrength = THREE.MathUtils.clamp(targetModel.group.userData.rippleStrength + delta * 5.5, 0, 1);
    pouring = true;
    hint.textContent = '液体が移っています。角度をゆるめると流れが止まります。';
  });

  beakers.forEach(updateBeakerLiquid);
}

function resetExperiment() {
  liquidState.left = 200;
  liquidState.right = 0;
  draggableBeakers.forEach((beaker) => {
    beaker.userData.dragging = false;
    beaker.userData.targetTilt = 0;
    beaker.position.copy(beaker.userData.home);
    beaker.rotation.set(0, 0, 0);
  });
  updateReadout(0);
  beakers.forEach(updateBeakerLiquid);
  hint.textContent = '青い液体入りのビーカーをつかみ、傾けて右のビーカーへ注いでください。';
}

function updateReadout(angle) {
  leftMassEl.textContent = `${Math.round(liquidState.left)} mL`;
  rightMassEl.textContent = `${Math.round(liquidState.right)} mL`;
  tiltValueEl.textContent = `${THREE.MathUtils.radToDeg(angle).toFixed(1)}°`;
}

function render() {
  const delta = clock.getDelta();
  const maxRipple = beakers.reduce((max, beaker) => Math.max(max, beaker.group.userData.rippleStrength || 0), 0);
  updateRippleTexture(clock.elapsedTime, maxRipple);

  draggableBeakers.forEach((beaker) => {
    const targetTilt = beaker.userData.dragging ? beaker.userData.targetTilt : 0;
    beaker.rotation.z = THREE.MathUtils.damp(beaker.rotation.z, targetTilt, 9, delta);
    if (!beaker.userData.dragging) {
      beaker.position.lerp(beaker.userData.home, 0.025);
    }
  });

  updatePouring(delta);
  beakers.forEach(updateBeakerLiquidPose);
  const maxAngle = draggableBeakers.reduce((max, beaker) => Math.abs(beaker.rotation.z) > Math.abs(max) ? beaker.rotation.z : max, 0);
  updateReadout(maxAngle);
  renderer.render(scene, camera);
}
