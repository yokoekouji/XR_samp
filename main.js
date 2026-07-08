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

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.01, 80);
camera.position.set(0, 1.18, 4.15);
camera.lookAt(0, -0.08, 0);

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
const scaleRoot = new THREE.Group();
const beamPivot = new THREE.Group();
const draggableWeights = [];
const dropTargets = [];
const panState = { left: [], right: [] };
const handCursors = [handCursor, createHandCursor('handCursor2')];
const handState = {
  enabled: false,
  loading: false,
  hands: createHandControllers(),
  lastVideoTime: -1,
  landmarker: null,
  useSimpleTracker: false,
  stream: null
};

let activeWeight = null;
let targetTilt = 0;
let currentTilt = 0;
let xrSession = null;

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
    activeWeight: null,
    dragPlane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
    dragOffset: new THREE.Vector3()
  }));
}

const mats = {
  brass: new THREE.MeshStandardMaterial({ color: 0xc99d49, metalness: 0.85, roughness: 0.28 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x2e3941, metalness: 0.7, roughness: 0.34 }),
  plate: new THREE.MeshStandardMaterial({ color: 0x95a7a7, metalness: 0.76, roughness: 0.22 }),
  enamel: new THREE.MeshStandardMaterial({ color: 0x2f6f5b, metalness: 0.16, roughness: 0.48 }),
  enamelDark: new THREE.MeshStandardMaterial({ color: 0x1f4f42, metalness: 0.18, roughness: 0.52 }),
  lightMetal: new THREE.MeshStandardMaterial({ color: 0xd6d8d6, metalness: 0.55, roughness: 0.28 }),
  redNeedle: new THREE.MeshStandardMaterial({ color: 0xb40000, metalness: 0.18, roughness: 0.22 }),
  string: new THREE.MeshStandardMaterial({ color: 0x262d31, metalness: 0.2, roughness: 0.65 }),
  shadow: new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.22 })
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
updateMassReadout();
renderer.setAnimationLoop(render);

function initScene() {
  scene.add(new THREE.HemisphereLight(0xeef6ff, 0x3e3325, 1.25));

  const key = new THREE.DirectionalLight(0xfff4df, 2.4);
  key.position.set(-2.5, 4, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);

  const fill = new THREE.PointLight(0x57c4b0, 1.1, 6);
  fill.position.set(2, 1.5, 2.5);
  scene.add(fill);

  scene.add(scaleRoot);
  scaleRoot.position.set(0, -0.12, 0);
  buildBalanceScale();
  buildWeights();

  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.4, 80), mats.shadow);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.72;
  floor.receiveShadow = true;
  scaleRoot.add(floor);
}

function buildBalanceScale() {
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.36, 0.16, 0.72), mats.enamel);
  base.position.y = -0.62;
  base.castShadow = true;
  base.receiveShadow = true;
  scaleRoot.add(base);

  const frontLip = new THREE.Mesh(new THREE.BoxGeometry(2.16, 0.12, 0.08), mats.enamelDark);
  frontLip.position.set(0, -0.72, 0.39);
  frontLip.rotation.x = -0.2;
  frontLip.castShadow = true;
  scaleRoot.add(frontLip);

  for (const x of [-0.92, 0.92]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.12, 0.14), mats.enamelDark);
    foot.position.set(x, -0.73, 0.36);
    foot.rotation.z = x < 0 ? -0.12 : 0.12;
    foot.castShadow = true;
    scaleRoot.add(foot);
  }

  const centerPost = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.74, 32), mats.enamel);
  centerPost.position.y = -0.2;
  centerPost.castShadow = true;
  scaleRoot.add(centerPost);

  const centerTower = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 0.82, 32), mats.lightMetal);
  centerTower.position.y = 0.12;
  centerTower.castShadow = true;
  scaleRoot.add(centerTower);

  const gaugeTexture = new THREE.CanvasTexture(createGaugeCanvas());
  const gauge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.54, 0.34),
    new THREE.MeshStandardMaterial({ map: gaugeTexture, transparent: true, roughness: 0.38, metalness: 0.08 })
  );
  gauge.position.set(0, 0.64, -0.035);
  gauge.castShadow = true;
  scaleRoot.add(gauge);

  const gaugeRing = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 16, 64), mats.lightMetal);
  gaugeRing.position.set(0, 0.36, 0);
  gaugeRing.castShadow = true;
  scaleRoot.add(gaugeRing);

  const fixedBackNeedle = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.36, 0.018), mats.darkMetal);
  fixedBackNeedle.position.set(0, 0.5, -0.02);
  fixedBackNeedle.castShadow = true;
  scaleRoot.add(fixedBackNeedle);

  beamPivot.position.y = 0.02;
  scaleRoot.add(beamPivot);

  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.085, 0.07), mats.lightMetal);
  leftArm.position.set(-0.48, -0.02, 0);
  leftArm.rotation.z = -0.1;
  leftArm.castShadow = true;
  beamPivot.add(leftArm);

  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.085, 0.07), mats.lightMetal);
  rightArm.position.set(0.48, -0.02, 0);
  rightArm.rotation.z = 0.1;
  rightArm.castShadow = true;
  beamPivot.add(rightArm);

  const redNeedle = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.52, 0.026), mats.redNeedle);
  redNeedle.position.set(0, 0.42, 0.04);
  redNeedle.castShadow = true;
  beamPivot.add(redNeedle);

  const needleTip = new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.11, 24), mats.redNeedle);
  needleTip.position.set(0, 0.72, 0.04);
  needleTip.castShadow = true;
  beamPivot.add(needleTip);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 48), mats.lightMetal);
  hub.rotation.x = Math.PI / 2;
  hub.position.set(0, 0, 0.04);
  hub.castShadow = true;
  beamPivot.add(hub);

  const hubCap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 32, 16), mats.lightMetal);
  hubCap.position.set(0, 0, 0.11);
  hubCap.castShadow = true;
  beamPivot.add(hubCap);

  createPan('left', -0.93);
  createPan('right', 0.93);
}

function createPan(side, x) {
  const panGroup = new THREE.Group();
  panGroup.name = `${side}-pan`;
  panGroup.position.set(x, 0.22, 0);
  beamPivot.add(panGroup);

  const supportRod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.52, 24), mats.lightMetal);
  supportRod.position.y = -0.24;
  supportRod.castShadow = true;
  panGroup.add(supportRod);

  const supportCup = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.18, 32), mats.lightMetal);
  supportCup.position.y = -0.03;
  supportCup.castShadow = true;
  panGroup.add(supportCup);

  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.36, 0.105, 80), mats.lightMetal);
  bowl.position.y = 0.22;
  bowl.castShadow = true;
  bowl.receiveShadow = true;
  panGroup.add(bowl);

  const dropTarget = new THREE.Mesh(
    new THREE.CylinderGeometry(0.43, 0.43, 0.08, 48),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  dropTarget.scale.set(1.12, 1, 1.12);
  dropTarget.position.y = 0.28;
  dropTarget.userData = { side };
  panGroup.add(dropTarget);
  dropTargets.push(dropTarget);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.018, 14, 80), mats.plate);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.28;
  rim.castShadow = true;
  panGroup.add(rim);

  const sideRod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.46, 18), mats.lightMetal);
  sideRod.rotation.z = Math.PI / 2;
  sideRod.position.set(side === 'left' ? -0.28 : 0.28, 0.02, 0);
  sideRod.castShadow = true;
  panGroup.add(sideRod);

  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 24), mats.lightMetal);
  knob.rotation.x = Math.PI / 2;
  knob.position.set(side === 'left' ? -0.52 : 0.52, 0.02, 0);
  knob.castShadow = true;
  panGroup.add(knob);
}

function buildWeights() {
  const weights = [
    { mass: 50, x: -0.7, z: 1.0, color: 0xe66f51, scale: 0.9 },
    { mass: 100, x: -0.28, z: 1.05, color: 0xf0b54d, scale: 1.0 },
    { mass: 200, x: 0.18, z: 1.04, color: 0x58bd9b, scale: 1.12 },
    { mass: 500, x: 0.65, z: 0.98, color: 0x6d8ed6, scale: 1.34 }
  ];

  for (const item of weights) {
    const group = new THREE.Group();
    group.position.set(item.x, -0.54, item.z);
    group.userData = {
      mass: item.mass,
      home: group.position.clone(),
      pan: null,
      panLift: 0.34
    };

    const labelTexture = new THREE.CanvasTexture(createWeightTexture(`${item.mass}g`, item.color));
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({
      color: item.color,
      map: labelTexture,
      metalness: 0.28,
      roughness: 0.32
    });

    const radius = (0.105 + Math.min(item.mass, 500) / 5600) * item.scale;
    const bodyHeight = 0.2 * item.scale;
    group.userData.panLift = 0.265 + bodyHeight * 0.5;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.02, bodyHeight, 72), material);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const pickArea = new THREE.Mesh(
      new THREE.SphereGeometry(radius + 0.18, 24, 16),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    pickArea.position.y = 0.04;
    pickArea.userData.pickArea = true;
    group.add(pickArea);

    const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.74, bodyHeight * 0.34, 48), material);
    shoulder.position.y = bodyHeight * 0.64;
    shoulder.castShadow = true;
    group.add(shoulder);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.29, radius * 0.36, bodyHeight * 0.36, 40), mats.lightMetal);
    neck.position.y = bodyHeight * 0.98;
    neck.castShadow = true;
    group.add(neck);

    const knob = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.38, 32, 16), mats.lightMetal);
    knob.scale.y = 0.48;
    knob.position.y = bodyHeight * 1.24;
    knob.castShadow = true;
    group.add(knob);

    const topCap = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.32, 0.012 * item.scale, 12, 48), mats.darkMetal);
    topCap.rotation.x = Math.PI / 2;
    topCap.position.y = bodyHeight * 1.28;
    topCap.castShadow = true;
    group.add(topCap);

    scaleRoot.add(group);
    draggableWeights.push(group);
  }
}

function createWeightTexture(text, color) {
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 512;
  labelCanvas.height = 256;
  const ctx = labelCanvas.getContext('2d');
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
  const grad = ctx.createLinearGradient(0, 0, labelCanvas.width, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.22)');
  grad.addColorStop(0.42, 'rgba(255,255,255,0.02)');
  grad.addColorStop(0.58, 'rgba(0,0,0,0.08)');
  grad.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const x of [64, 192, 320, 448]) {
    ctx.fillStyle = 'rgba(8, 13, 16, 0.48)';
    ctx.roundRect(x - 54, 122, 108, 44, 14);
    ctx.fill();
    ctx.fillStyle = '#fffdf2';
    ctx.font = '800 28px Segoe UI, sans-serif';
    ctx.fillText(text, x, 144);
  }
  return labelCanvas;
}

function createGaugeCanvas() {
  const gaugeCanvas = document.createElement('canvas');
  gaugeCanvas.width = 512;
  gaugeCanvas.height = 320;
  const ctx = gaugeCanvas.getContext('2d');
  ctx.clearRect(0, 0, gaugeCanvas.width, gaugeCanvas.height);

  ctx.fillStyle = 'rgba(214, 216, 214, 0.96)';
  ctx.strokeStyle = 'rgba(130, 134, 132, 0.88)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(80, 260);
  ctx.lineTo(70, 88);
  ctx.quadraticCurveTo(256, 18, 442, 88);
  ctx.lineTo(432, 260);
  ctx.quadraticCurveTo(256, 220, 80, 260);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.translate(256, 230);
  for (let i = -5; i <= 5; i += 1) {
    const angle = i * 0.13;
    const inner = i === 0 ? 118 : 136;
    const outer = 188;
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -inner);
    ctx.lineTo(0, -outer);
    ctx.strokeStyle = i === 0 ? '#9b0000' : '#2f3436';
    ctx.lineWidth = i === 0 ? 8 : 5;
    ctx.stroke();
    ctx.rotate(-angle);
  }
  ctx.restore();

  ctx.fillStyle = 'rgba(70, 74, 74, 0.9)';
  ctx.font = '700 32px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('0', 256, 86);
  return gaugeCanvas;
}

function initAR() {
  if (!navigator.xr) {
    arButton.disabled = true;
    arButton.textContent = 'AR非対応';
    modeText.textContent = '3Dモード';
    return;
  }

  navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
    if (!supported) {
      arButton.disabled = true;
      arButton.textContent = 'AR非対応';
      modeText.textContent = '3Dモード';
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
    modeText.textContent = 'ARモード';
    scaleRoot.position.set(0, -0.38, -1.9);
    scaleRoot.scale.setScalar(0.7);
    xrSession.addEventListener('end', () => {
      xrSession = null;
      document.body.classList.remove('xr-active');
      modeText.textContent = '3Dモード';
      scaleRoot.position.set(0, -0.12, 0);
      scaleRoot.scale.setScalar(1);
    }, { once: true });
  });
}
function attachEvents() {
  window.addEventListener('resize', onResize);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  resetButton.addEventListener('click', resetWeights);
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
  if (!grabbed) return;
  canvas.setPointerCapture(event.pointerId);
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
  const hits = raycaster.intersectObjects(draggableWeights, true);
  const fallbackWeight = options.allowNearest ? findNearestWeightAtClient(clientX, clientY, options.radius ?? 110) : null;
  if (!hits.length && !fallbackWeight) return false;

  const weight = hits.length ? findWeightRoot(hits[0].object) : fallbackWeight;
  const existingHand = handState.hands.find((hand) => hand.activeWeight === weight);
  if (existingHand && existingHand !== dragState) return false;
  if (!dragState && handState.hands.some((hand) => hand.activeWeight === weight)) return false;

  setDragWeight(dragState, weight);
  releaseFromPan(weight);
  weight.userData.dragging = true;
  getDragPlane(dragState).setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), weight.getWorldPosition(tempWorld));
  raycaster.ray.intersectPlane(getDragPlane(dragState), dragPoint);
  getDragOffset(dragState).copy(weight.position).sub(scaleRoot.worldToLocal(dragPoint.clone()));
  hint.textContent = '逧ｿ縺ｮ荳翫∪縺ｧ驕九ｓ縺ｧ髮｢縺励※縺上□縺輔＞';
  return true;
}

function moveDragAtClient(clientX, clientY, depth = null, dragState = null) {
  const weight = getDragWeight(dragState);
  if (!weight) return;
  setPointerFromClient(clientX, clientY);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(getDragPlane(dragState), dragPoint)) return;
  const localPoint = scaleRoot.worldToLocal(dragPoint.clone());
  weight.position.copy(localPoint.add(getDragOffset(dragState)));
  if (depth !== null) {
    const targetZ = THREE.MathUtils.lerp(1.12, -0.08, THREE.MathUtils.clamp(depth, 0, 1));
    weight.position.z = THREE.MathUtils.lerp(weight.position.z, targetZ, 0.45);
  }
  weight.position.y = Math.max(weight.position.y, -0.18);
}

function endDragAtClient(clientX, clientY, dragState = null) {
  const weight = getDragWeight(dragState);
  if (!weight) return;
  setPointerFromClient(clientX, clientY);
  placeOrReturn(weight, getDropSideFromPointer());
  weight.userData.dragging = false;
  setDragWeight(dragState, null);
  hint.textContent = handState.enabled
    ? '謖・・繧ｫ繝ｼ繧ｽ繝ｫ縺ｧ驥阪ｊ繧偵▽縺ｾ繧薙〒逧ｿ縺ｸ驕九ｓ縺ｧ縺上□縺輔＞'
    : '驥阪ｊ繧偵ラ繝ｩ繝・げ縺励※逧ｿ縺ｮ荳翫〒髮｢縺励※縺上□縺輔＞';
}

function getDragWeight(dragState) {
  return dragState ? dragState.activeWeight : activeWeight;
}

function setDragWeight(dragState, weight) {
  if (dragState) {
    dragState.activeWeight = weight;
  } else {
    activeWeight = weight;
  }
}

function getDragPlane(dragState) {
  return dragState ? dragState.dragPlane : dragPlane;
}

function getDragOffset(dragState) {
  return dragState ? dragState.dragOffset : dragOffset;
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
    hint.textContent = 'ブラウザのカメラ許可を確認してください';
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
    hand.activeWeight = null;
  });
  resizeHandRig();
  document.body.classList.add('hand-active');
  handButton.textContent = '手操作停止';
  modeText.textContent = handState.useSimpleTracker ? '簡易手検出モード' : '手認識モード';
  handStatus.textContent = handState.useSimpleTracker ? '手を明るく映してください' : '両手対応: 親指と人差し指でつまむ';
  hint.textContent = '左右の手で別々の重りをつかめます';
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
    if (hand.activeWeight) endDragAtClient(hand.x, hand.y, hand);
    hand.pinching = false;
    hand.wasPinching = false;
    hand.depth = 0;
    hand.activeWeight = null;
  });
  activeWeight = null;
  handState.enabled = false;
  handState.useSimpleTracker = false;
  handButton.textContent = '手で操作';
  handStatus.textContent = 'カメラ待機中';
  modeText.textContent = '3Dモード';
  document.body.classList.remove('hand-active', 'hand-pinching', 'hand-searching');
  handCursors.forEach((cursor) => {
    cursor.style.opacity = '0';
    cursor.classList.remove('pinching');
  });
  overlayCtx.clearRect(0, 0, handOverlay.width, handOverlay.height);
  clearViewportRig();

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
    drawSearchRig();
    handState.hands.forEach((hand) => {
      hand.depth += (0 - hand.depth) * 0.12;
      if (hand.activeWeight) endDragAtClient(hand.x, hand.y, hand);
      hand.pinching = false;
      hand.wasPinching = false;
    });
    document.body.classList.remove('hand-pinching', 'hand-tracked');
    document.body.classList.add('hand-searching');
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
      if (hand.activeWeight) endDragAtClient(hand.x, hand.y, hand);
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

    const pinchDistance = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
    hand.pinching = hand.pinching ? pinchDistance < 0.085 : pinchDistance < 0.055;

    cursor.style.left = `${hand.x}px`;
    cursor.style.top = `${hand.y}px`;
    cursor.style.opacity = '1';
    cursor.classList.toggle('pinching', hand.pinching);

    if (hand.pinching && (!hand.wasPinching || !hand.activeWeight)) {
      const grabbed = beginDragAtClient(hand.x, hand.y, { allowNearest: true, radius: 150, dragState: hand });
      if (grabbed) moveDragAtClient(hand.x, hand.y, hand.depth, hand);
    } else if (hand.pinching && hand.activeWeight) {
      moveDragAtClient(hand.x, hand.y, hand.depth, hand);
    } else if (!hand.pinching && hand.wasPinching) {
      endDragAtClient(hand.x, hand.y, hand);
    }

    hand.wasPinching = hand.pinching;
  });

  const activeHands = handState.hands.filter((hand) => hand.pinching).length;
  document.body.classList.toggle('hand-pinching', activeHands > 0);
  if (handState.useSimpleTracker) {
    handStatus.textContent = activeHands ? '簡易検出: つかんでいます' : '簡易検出: 手の中心を追跡中';
  } else {
    handStatus.textContent = activeHands ? `認識中: ${activeHands}手でつかんでいます` : `認識中: ${detectedHands.length}手を認識中`;
  }
}
function estimateHandDepth(landmarks) {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of landmarks) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const span = Math.max(maxX - minX, maxY - minY);
  return THREE.MathUtils.smoothstep(span, 0.24, 0.62);
}

function processSimpleHandFromVideo() {
  const width = simpleTrackerCanvas.width;
  const height = simpleTrackerCanvas.height;
  if (!width || !height) return { landmarks: [] };

  simpleTrackerCtx.drawImage(handVideo, 0, 0, width, height);
  const image = simpleTrackerCtx.getImageData(0, 0, width, height);
  const data = image.data;
  const step = Math.max(4, Math.floor(width / 120));
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const skinLike = r > 70 && g > 35 && b > 20 && r > g * 1.04 && r > b * 1.18 && max - min > 18;
      const warmBright = r > 105 && g > 70 && b > 45 && r > b * 1.12 && g > b * 1.04 && max - min > 14;
      if (!skinLike && !warmBright) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;
      count += 1;
    }
  }

  if (count < 55) return { landmarks: [] };

  const cx = sumX / count;
  const cy = sumY / count;
  const boxWidth = Math.max(70, maxX - minX);
  const boxHeight = Math.max(95, maxY - minY);
  if (boxWidth * boxHeight < width * height * 0.01) return { landmarks: [] };

  const landmarks = createSimpleHandLandmarks(cx / width, cy / height, boxWidth / width, boxHeight / height);
  return { landmarks: [landmarks] };
}

function createSimpleHandLandmarks(cx, cy, boxWidth, boxHeight) {
  const wristY = cy + boxHeight * 0.42;
  const palmY = cy + boxHeight * 0.1;
  const knuckleY = cy - boxHeight * 0.08;
  const tipY = cy - boxHeight * 0.48;
  const spread = boxWidth * 0.55;
  const landmarks = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));

  landmarks[0] = { x: cx, y: wristY, z: 0 };
  const fingerBases = [
    { ids: [1, 2, 3, 4], x: cx - spread * 0.55, tip: tipY + boxHeight * 0.2 },
    { ids: [5, 6, 7, 8], x: cx - spread * 0.25, tip: tipY },
    { ids: [9, 10, 11, 12], x: cx, tip: tipY - boxHeight * 0.05 },
    { ids: [13, 14, 15, 16], x: cx + spread * 0.24, tip: tipY + boxHeight * 0.04 },
    { ids: [17, 18, 19, 20], x: cx + spread * 0.48, tip: tipY + boxHeight * 0.16 }
  ];

  for (const finger of fingerBases) {
    const [a, b, c, d] = finger.ids;
    landmarks[a] = { x: finger.x, y: palmY, z: 0 };
    landmarks[b] = { x: finger.x, y: knuckleY, z: 0 };
    landmarks[c] = { x: finger.x, y: (knuckleY + finger.tip) / 2, z: 0 };
    landmarks[d] = { x: finger.x, y: finger.tip, z: 0 };
  }

  return landmarks.map((point) => ({
    x: THREE.MathUtils.clamp(point.x, 0.02, 0.98),
    y: THREE.MathUtils.clamp(point.y, 0.02, 0.98),
    z: 0
  }));
}

function drawHandSkeleton(landmarks) {
  const width = handOverlay.width;
  const height = handOverlay.height;
  overlayCtx.lineWidth = 4;
  overlayCtx.strokeStyle = 'rgba(80, 190, 168, 0.95)';
  overlayCtx.fillStyle = '#f0b54d';

  for (const [a, b] of handConnections) {
    overlayCtx.beginPath();
    overlayCtx.moveTo(landmarks[a].x * width, landmarks[a].y * height);
    overlayCtx.lineTo(landmarks[b].x * width, landmarks[b].y * height);
    overlayCtx.stroke();
  }

  for (const point of landmarks) {
    overlayCtx.beginPath();
    overlayCtx.arc(point.x * width, point.y * height, 4, 0, Math.PI * 2);
    overlayCtx.fill();
  }
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
  const points = [
    [0, 0, 118], [1, -78, 60], [2, -112, 20], [3, -130, -24], [4, -142, -66],
    [5, -46, 42], [6, -58, -16], [7, -66, -76], [8, -72, -134],
    [9, -6, 34], [10, -8, -34], [11, -10, -98], [12, -12, -162],
    [13, 34, 46], [14, 48, -12], [15, 60, -70], [16, 70, -126],
    [17, 72, 68], [18, 94, 20], [19, 110, -28], [20, 124, -76]
  ].map(([, x, y]) => ({ x: cx + x * scale, y: cy + y * scale }));

  rigCtx.save();
  rigCtx.lineCap = 'round';
  rigCtx.lineJoin = 'round';
  drawHandSurface(points, 0.34, true);
  rigCtx.setLineDash([10, 9]);
  rigCtx.lineWidth = 4;
  rigCtx.strokeStyle = 'rgba(247, 244, 236, 0.56)';
  drawRigLines(points);
  rigCtx.setLineDash([]);
  for (const point of points) {
    rigCtx.beginPath();
    rigCtx.fillStyle = 'rgba(80, 190, 168, 0.72)';
    rigCtx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    rigCtx.fill();
  }
  rigCtx.fillStyle = 'rgba(12, 15, 20, 0.72)';
  roundRect(rigCtx, cx - 96, cy + 150 * scale, 192, 34, 8);
  rigCtx.fill();
  rigCtx.fillStyle = '#f7f4ec';
  rigCtx.font = '700 14px Segoe UI, sans-serif';
  rigCtx.textAlign = 'center';
  rigCtx.textBaseline = 'middle';
  rigCtx.fillText('謇九ｒ繧ｫ繝｡繝ｩ縺ｫ譏縺励※縺上□縺輔＞', cx, cy + 167 * scale);
  rigCtx.restore();
  document.body.classList.add('hand-searching');
  document.body.classList.remove('hand-tracked');
}

function drawViewportRig(landmarkSets) {
  rigCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  const sets = Array.isArray(landmarkSets?.[0]) ? landmarkSets : [landmarkSets];
  sets.forEach((landmarks, index) => drawSingleViewportRig(landmarks, index));
}

function drawSingleViewportRig(landmarks, handIndex) {
  const points = landmarks.map((point) => ({
    x: (1 - point.x) * window.innerWidth,
    y: point.y * window.innerHeight
  }));
  const mainColor = handIndex === 0 ? '80, 190, 168' : '109, 142, 214';
  const accentColor = handIndex === 0 ? '#f0b54d' : '#ff7f6e';

  rigCtx.save();
  rigCtx.lineCap = 'round';
  rigCtx.lineJoin = 'round';
  drawHandSurface(points, 0.32, false, mainColor);
  rigCtx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  rigCtx.shadowBlur = 10;
  rigCtx.lineWidth = 9;
  rigCtx.strokeStyle = 'rgba(6, 14, 17, 0.72)';
  drawRigLines(points);

  rigCtx.shadowBlur = 0;
  rigCtx.lineWidth = 4;
  rigCtx.strokeStyle = `rgba(${mainColor}, 0.92)`;
  drawRigLines(points);

  for (let i = 0; i < points.length; i += 1) {
    const radius = i === 4 || i === 8 ? 9 : 6;
    rigCtx.beginPath();
    rigCtx.fillStyle = i === 4 || i === 8 ? accentColor : '#f7f4ec';
    rigCtx.strokeStyle = 'rgba(6, 14, 17, 0.8)';
    rigCtx.lineWidth = 2;
    rigCtx.arc(points[i].x, points[i].y, radius, 0, Math.PI * 2);
    rigCtx.fill();
    rigCtx.stroke();
  }
  rigCtx.restore();
}
function drawRigLines(points) {
  for (const [a, b] of handConnections) {
    rigCtx.beginPath();
    rigCtx.moveTo(points[a].x, points[a].y);
    rigCtx.lineTo(points[b].x, points[b].y);
    rigCtx.stroke();
  }
}

function drawHandSurface(points, alpha, guideMode, colorOverride = null) {
  const palm = [points[0], points[1], points[5], points[9], points[13], points[17], points[0]];
  const fingerChains = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20]
  ];
  const baseHue = colorOverride ?? (guideMode ? '247, 244, 236' : '80, 190, 168');
  const accentHue = guideMode ? '80, 190, 168' : '240, 181, 77';

  rigCtx.save();
  rigCtx.globalCompositeOperation = 'source-over';
  rigCtx.shadowColor = guideMode ? 'rgba(0, 0, 0, 0.24)' : 'rgba(80, 190, 168, 0.28)';
  rigCtx.shadowBlur = guideMode ? 8 : 18;

  rigCtx.beginPath();
  rigCtx.moveTo(palm[0].x, palm[0].y);
  for (let i = 1; i < palm.length; i += 1) {
    const prev = palm[i - 1];
    const current = palm[i];
    const midX = (prev.x + current.x) / 2;
    const midY = (prev.y + current.y) / 2;
    rigCtx.quadraticCurveTo(prev.x, prev.y, midX, midY);
  }
  rigCtx.closePath();
  rigCtx.fillStyle = `rgba(${baseHue}, ${alpha})`;
  rigCtx.fill();
  rigCtx.lineWidth = guideMode ? 2 : 3;
  rigCtx.strokeStyle = `rgba(${baseHue}, ${Math.min(alpha + 0.22, 0.72)})`;
  rigCtx.stroke();

  for (const chain of fingerChains) {
    const [a, b, c, d] = chain;
    const width = Math.max(14, distance(points[a], points[0]) * 0.12);
    rigCtx.beginPath();
    rigCtx.moveTo(points[a].x, points[a].y);
    rigCtx.bezierCurveTo(points[b].x, points[b].y, points[c].x, points[c].y, points[d].x, points[d].y);
    rigCtx.lineCap = 'round';
    rigCtx.lineWidth = width;
    rigCtx.strokeStyle = `rgba(${baseHue}, ${alpha * 0.9})`;
    rigCtx.stroke();

    rigCtx.beginPath();
    rigCtx.arc(points[d].x, points[d].y, width * 0.48, 0, Math.PI * 2);
    rigCtx.fillStyle = `rgba(${baseHue}, ${alpha * 0.82})`;
    rigCtx.fill();
  }

  for (const id of [4, 8]) {
    rigCtx.beginPath();
    rigCtx.arc(points[id].x, points[id].y, guideMode ? 12 : 15, 0, Math.PI * 2);
    rigCtx.fillStyle = `rgba(${accentHue}, ${guideMode ? 0.42 : 0.52})`;
    rigCtx.fill();
  }

  rigCtx.restore();
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function findWeightRoot(object) {
  let current = object;
  while (current.parent && !draggableWeights.includes(current)) current = current.parent;
  return current;
}

function findNearestWeightAtClient(clientX, clientY, radius) {
  let nearest = null;
  const screenPoint = new THREE.Vector3();
  for (const weight of draggableWeights) {
    if (weight.userData.pan) continue;
    weight.getWorldPosition(screenPoint);
    screenPoint.project(camera);
    const x = (screenPoint.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-screenPoint.y * 0.5 + 0.5) * window.innerHeight;
    const distance = Math.hypot(clientX - x, clientY - y);
    if (distance <= radius && (!nearest || distance < nearest.distance)) {
      nearest = { weight, distance };
    }
  }
  return nearest?.weight || null;
}

function getDropSideFromPointer() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(dropTargets, false);
  return hits[0]?.object.userData.side || null;
}

function placeOrReturn(weight, preferredSide = null) {
  const leftPan = beamPivot.children.find((child) => child.name === 'left-pan');
  const rightPan = beamPivot.children.find((child) => child.name === 'right-pan');
  const candidates = [
    { side: 'left', pan: leftPan },
    { side: 'right', pan: rightPan }
  ];

  if (preferredSide) {
    const pan = preferredSide === 'left' ? leftPan : rightPan;
    const local = scaleRoot.worldToLocal(pan.getWorldPosition(new THREE.Vector3()));
    placeOnPan(weight, preferredSide, local);
    updateMassReadout();
    return;
  }

  let nearest = null;
  for (const candidate of candidates) {
    const world = candidate.pan.getWorldPosition(new THREE.Vector3());
    const local = scaleRoot.worldToLocal(world);
    const distance = new THREE.Vector2(weight.position.x - local.x, weight.position.z - local.z).length();
    if (!nearest || distance < nearest.distance) nearest = { ...candidate, distance, local };
  }

  if (nearest && nearest.distance < 0.68) {
    placeOnPan(weight, nearest.side, nearest.local);
  } else {
    weight.userData.pan = null;
    weight.position.copy(weight.userData.home);
  }

  updateMassReadout();
}

function placeOnPan(weight, side, local) {
  weight.userData.pan = side;
  panState[side].push(weight);
  weight.rotation.set(0, 0, 0);
  restackPan(side);
}

function releaseFromPan(weight) {
  const pan = weight.userData.pan;
  if (!pan) return;
  panState[pan] = panState[pan].filter((item) => item !== weight);
  weight.userData.pan = null;
  restackPan(pan);
  updateMassReadout();
}

function restackPan(side) {
  const pan = beamPivot.children.find((child) => child.name === `${side}-pan`);
  const local = scaleRoot.worldToLocal(pan.getWorldPosition(new THREE.Vector3()));
  panState[side].forEach((weight, index) => {
    const slot = getPanSlot(index);
    weight.position.set(local.x + slot.x, local.y + weight.userData.panLift, local.z + slot.z);
  });
}

function getPanSlot(index) {
  const slots = [
    { x: 0, z: 0 },
    { x: -0.15, z: 0.04 },
    { x: 0.15, z: -0.04 },
    { x: -0.06, z: -0.14 },
    { x: 0.06, z: 0.14 }
  ];
  return slots[index % slots.length];
}

function resetWeights() {
  panState.left.length = 0;
  panState.right.length = 0;
  draggableWeights.forEach((weight) => {
    weight.userData.pan = null;
    weight.userData.dragging = false;
    weight.position.copy(weight.userData.home);
    weight.rotation.set(0, 0, 0);
  });
  updateMassReadout();
}

function updateMassReadout() {
  const left = panState.left.reduce((sum, weight) => sum + weight.userData.mass, 0);
  const right = panState.right.reduce((sum, weight) => sum + weight.userData.mass, 0);
  const difference = left - right;
  targetTilt = THREE.MathUtils.clamp(difference / 600, -0.34, 0.34);
  leftMassEl.textContent = `${left}g`;
  rightMassEl.textContent = `${right}g`;
  tiltValueEl.textContent = `${THREE.MathUtils.radToDeg(targetTilt).toFixed(1)}ﾂｰ`;
}

function updatePanWeightPositions() {
  for (const side of ['left', 'right']) {
    const pan = beamPivot.children.find((child) => child.name === `${side}-pan`);
    const local = scaleRoot.worldToLocal(pan.getWorldPosition(new THREE.Vector3()));
    panState[side].forEach((weight, index) => {
      if (weight.userData.dragging) return;
      const slot = getPanSlot(index);
      const target = new THREE.Vector3(local.x + slot.x, local.y + weight.userData.panLift, local.z + slot.z);
      weight.position.lerp(target, 0.28);
    });
  }
}

function keepPansLevel() {
  for (const side of ['left', 'right']) {
    const pan = beamPivot.children.find((child) => child.name === `${side}-pan`);
    if (pan) pan.rotation.z = -currentTilt;
  }
}

function render() {
  const delta = clock.getDelta();
  currentTilt = THREE.MathUtils.damp(currentTilt, targetTilt, 6, delta);
  beamPivot.rotation.z = currentTilt;
  keepPansLevel();
  updatePanWeightPositions();
  draggableWeights.forEach((weight) => {
    if (!weight.userData.pan && !weight.userData.dragging) {
      weight.rotation.y += delta * 0.25;
    }
  });
  renderer.render(scene, camera);
}


