import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  LAB_CAMERA,
  LAB_VIEW_PRESETS,
  LabCameraController,
  applyLabViewPreset,
  configureLabOrbitControls,
  fitLabCameraToBounds,
  labCameraBounds,
  orientLabCameraToPreset,
  resizeLabCameraViewport,
  transferLabCameraView,
  updateLabCameraClipping,
} from '../lib/lab-camera.ts';

test('Lab camera exposes the same seven named views to DFT and MD', () => {
  assert.deepEqual(
    LAB_VIEW_PRESETS.map((preset) => preset.id),
    ['top', 'bottom', 'left', 'right', 'front', 'back', 'isometric'],
  );
  assert.equal(LAB_VIEW_PRESETS.at(-1)?.label, 'Isometric');
  assert.deepEqual(LAB_VIEW_PRESETS.at(-1)?.up, [0, 0, 1]);
  assert.ok(LAB_CAMERA.isometricDirection.distanceTo(new THREE.Vector3(0.528, -0.727, 0.438).normalize()) < 1e-12);
});

test('camera bounds include cell corners and displayed atom radii', () => {
  const bounds = labCameraBounds([
    { position: [0, 0, 0] },
    { position: [2, 2, 2] },
    { position: [5, 1, 1], radius: 1 },
  ]);
  assert.deepEqual(bounds.center.toArray(), [3, 1, 1]);
  assert.ok(Math.abs(bounds.radius - Math.sqrt(11)) < 1e-12);
});

test('view presets set canonical orientation while fitting an orthographic camera', () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 5000);
  const bounds = { center: new THREE.Vector3(2, 3, 4), radius: 4 };
  applyLabViewPreset(camera, bounds, 2, 'top');
  assert.deepEqual(camera.up.toArray(), [0, 1, 0]);
  assert.equal(camera.position.x, 2);
  assert.equal(camera.position.y, 3);
  assert.ok(camera.position.z > 4);
  assert.equal(camera.zoom, 1);
});

test('orientation-only presets preserve orthographic zoom, distance, and framing', () => {
  const camera = new THREE.OrthographicCamera(-8, 8, 4, -4, 0.01, 5000);
  const target = new THREE.Vector3(1, 2, 3);
  camera.position.set(4, 8, 15);
  camera.zoom = 3.25;
  const distance = camera.position.distanceTo(target);
  const frustum = [camera.left, camera.right, camera.top, camera.bottom];

  orientLabCameraToPreset(camera, target, 'isometric', distance);

  assert.equal(camera.zoom, 3.25);
  assert.deepEqual([camera.left, camera.right, camera.top, camera.bottom], frustum);
  assert.deepEqual(camera.up.toArray(), [0, 0, 1]);
  assert.ok(Math.abs(camera.position.distanceTo(target) - distance) < 1e-12);
  assert.ok(camera.position.clone().sub(target).normalize().distanceTo(LAB_CAMERA.isometricDirection) < 1e-12);
});

test('orthographic resize keeps user zoom and fits the limiting viewport axis', () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 5000);
  fitLabCameraToBounds(camera, { center: new THREE.Vector3(), radius: 3 }, 2);
  camera.zoom = 2.25;
  resizeLabCameraViewport(camera, 0.5);
  const paddedRadius = 3 * LAB_CAMERA.padding;
  assert.ok(Math.abs(camera.top - paddedRadius / 0.5) < 1e-12);
  assert.ok(Math.abs(camera.right - paddedRadius) < 1e-12);
  assert.equal(camera.zoom, 2.25);
});

test('perspective resize retains the user dolly ratio without cumulative drift', () => {
  const camera = new THREE.PerspectiveCamera(45, 2, 0.01, 5000);
  const target = new THREE.Vector3();
  fitLabCameraToBounds(camera, { center: target, radius: 3 }, 2);
  camera.position.multiplyScalar(0.5);
  resizeLabCameraViewport(camera, 0.5, target);
  const distanceAfterResize = camera.position.length();
  resizeLabCameraViewport(camera, 0.5, target);
  assert.ok(Math.abs(camera.position.length() - distanceAfterResize) < 1e-12);
});

test('projection changes preserve target, direction, and visible vertical scale', () => {
  const target = new THREE.Vector3(1, 2, 3);
  const bounds = { center: target.clone(), radius: 3 };
  const orthographic = new THREE.OrthographicCamera(-8, 8, 4, -4, 0.01, 5000);
  orthographic.position.set(6, 7, 8);
  orthographic.zoom = 2;
  orthographic.lookAt(target);
  const perspective = new THREE.PerspectiveCamera(45, 2, 0.01, 5000);
  transferLabCameraView(orthographic, perspective, target, bounds, 2);
  const expectedDirection = orthographic.position.clone().sub(target).normalize();
  assert.ok(perspective.position.clone().sub(target).normalize().distanceTo(expectedDirection) < 1e-12);
  assert.ok(Math.abs(perspective.position.distanceTo(target) * Math.tan(THREE.MathUtils.degToRad(22.5)) - 2) < 1e-12);

  const restored = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 5000);
  transferLabCameraView(perspective, restored, target, bounds, 2);
  assert.ok(Math.abs(restored.top - 2) < 1e-12);
  assert.ok(restored.position.clone().sub(target).normalize().distanceTo(expectedDirection) < 1e-12);
});

test('camera fitting remains finite for a collapsed direction or invalid viewport aspect', () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
  const bounds = { center: new THREE.Vector3(2, 3, 4), radius: 2 };
  fitLabCameraToBounds(camera, bounds, Number.NaN, new THREE.Vector3());
  assert.ok(camera.position.toArray().every(Number.isFinite));
  assert.equal(camera.aspect, 1);
  assert.ok(camera.position.distanceTo(bounds.center) > 0);
});

test('clipping follows moved content bounds even when the orbit target stays behind', () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
  camera.position.set(0, 0, 0);
  updateLabCameraClipping(camera, { center: new THREE.Vector3(10_000, 0, 0), radius: 100 });
  assert.ok(camera.near > 9_000);
  assert.ok(camera.far > 10_000);
});

test('shared OrbitControls settings are applied through one primitive', () => {
  const controls = {
    enableDamping: false,
    dampingFactor: 0,
    rotateSpeed: 0,
    panSpeed: 0,
    zoomSpeed: 0,
    zoomToCursor: false,
    screenSpacePanning: false,
  };
  configureLabOrbitControls(controls);
  assert.deepEqual(controls, {
    enableDamping: true,
    dampingFactor: LAB_CAMERA.dampingFactor,
    rotateSpeed: LAB_CAMERA.rotateSpeed,
    panSpeed: LAB_CAMERA.panSpeed,
    zoomSpeed: LAB_CAMERA.zoomSpeed,
    zoomToCursor: false,
    screenSpacePanning: true,
  });
});

test('LabCameraController encapsulates projection, target, presets, fit, and projection transfer', () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 5000);
  const bounds = { center: new THREE.Vector3(1, 2, 3), radius: 5 };
  const controller = new LabCameraController({ camera, bounds, aspect: 1.5 });

  assert.equal(controller.projection, 'orthographic');
  assert.equal(controller.aspect, 1.5);
  assert.deepEqual(controller.target.toArray(), [1, 2, 3]);

  controller.fit();
  assert.ok(controller.camera.position.distanceTo(bounds.center) > 5);

  controller.applyPreset('top');
  assert.deepEqual(controller.camera.up.toArray(), [0, 1, 0]);
  assert.equal(controller.camera.position.x, 1);
  assert.equal(controller.camera.position.y, 2);
  assert.ok(controller.camera.position.z > 3);

  controller.resize(2.0);
  assert.equal(controller.aspect, 2.0);

  const perspectiveCamera = new THREE.PerspectiveCamera(45, 2.0, 0.01, 5000);
  const switched = controller.switchProjection(perspectiveCamera);
  assert.equal(switched, perspectiveCamera);
  assert.equal(controller.projection, 'perspective');
  assert.ok(controller.camera.position.distanceTo(controller.target) > 0);

  controller.updateClipping();
  assert.ok(controller.camera.near > 0);
  assert.ok(controller.camera.far > controller.camera.near);

  const controls = {
    enableDamping: false,
    dampingFactor: 0,
    rotateSpeed: 0,
    panSpeed: 0,
    zoomSpeed: 0,
    zoomToCursor: false,
    screenSpacePanning: false,
  };
  controller.configureControls(controls);
  assert.equal(controls.enableDamping, true);
  assert.equal(controls.zoomToCursor, false);
});

test('LAB_CAMERA defines zoom limits that safely span normalized base zoom 1.0', () => {
  assert.ok(LAB_CAMERA.minZoom < 1.0, 'minZoom must be less than 1.0 so normal view can be restored');
  assert.ok(LAB_CAMERA.minZoom <= 0.1, 'minZoom should allow zooming out to at least 0.1x');
  assert.ok(LAB_CAMERA.maxZoom >= 10, 'maxZoom should allow close-up inspection');
  // At base zoom 1.0, zooming in with zoomSpeed should never snap or clamp at minZoom
  const initialZoom = 1.0;
  const zoomInStep = initialZoom / Math.pow(0.95, LAB_CAMERA.zoomSpeed);
  const clampedZoomIn = Math.max(LAB_CAMERA.minZoom, Math.min(LAB_CAMERA.maxZoom, zoomInStep));
  assert.ok(Math.abs(clampedZoomIn - zoomInStep) < 1e-6, 'First zoom in step should remain continuous without snapping');
  const zoomOutStep = initialZoom * Math.pow(0.95, LAB_CAMERA.zoomSpeed);
  const clampedZoomOut = Math.max(LAB_CAMERA.minZoom, Math.min(LAB_CAMERA.maxZoom, zoomOutStep));
  assert.ok(Math.abs(clampedZoomOut - zoomOutStep) < 1e-6, 'Zoom out step below 1.0 should not be clamped by minZoom');
});
