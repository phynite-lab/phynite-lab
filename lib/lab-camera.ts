import * as THREE from 'three';

export type LabCameraProjection = 'orthographic' | 'perspective';
export type LabViewPresetId = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'isometric';
export type LabVectorTuple = readonly [number, number, number];
export type LabCameraBounds = { center: THREE.Vector3; radius: number };
export type LabBoundedPoint = {
  position: THREE.Vector3 | LabVectorTuple;
  radius?: number;
};
export type LabViewPreset = {
  id: LabViewPresetId;
  label: string;
  axis: string;
  direction: LabVectorTuple;
  up: LabVectorTuple;
};

export const LAB_VIEW_PRESETS: readonly LabViewPreset[] = Object.freeze([
  { id: 'top', label: 'Top', axis: '+Z', direction: [0, 0, 1], up: [0, 1, 0] },
  { id: 'bottom', label: 'Bottom', axis: '-Z', direction: [0, 0, -1], up: [0, 1, 0] },
  { id: 'left', label: 'Left', axis: '-X', direction: [-1, 0, 0], up: [0, 0, 1] },
  { id: 'right', label: 'Right', axis: '+X', direction: [1, 0, 0], up: [0, 0, 1] },
  { id: 'front', label: 'Front', axis: '-Y', direction: [0, -1, 0], up: [0, 0, 1] },
  { id: 'back', label: 'Back', axis: '+Y', direction: [0, 1, 0], up: [0, 0, 1] },
  { id: 'isometric', label: 'Isometric', axis: 'XYZ', direction: [0.528, -0.727, 0.438], up: [0, 0, 1] },
] satisfies LabViewPreset[]);

const presetsById = new Map(LAB_VIEW_PRESETS.map((preset) => [preset.id, preset]));

export function getLabViewPreset(id: LabViewPresetId): LabViewPreset {
  return presetsById.get(id) ?? LAB_VIEW_PRESETS[LAB_VIEW_PRESETS.length - 1];
}

export const LAB_CAMERA = Object.freeze({
  isometricDirection: new THREE.Vector3(...getLabViewPreset('isometric').direction).normalize(),
  dampingFactor: 0.075,
  rotateSpeed: 0.58,
  panSpeed: 0.72,
  zoomSpeed: 1.05,
  minZoom: 0.05,
  maxZoom: 50,
  near: 0.01,
  far: 5000,
  padding: 1.18,
});

/** Visual constants shared by the DFT and MD scientific viewports. */
export const LAB_VIEWPORT = Object.freeze({
  background: Object.freeze({ light: '#e9ebee', dark: '#343434' }),
  researchBackground: Object.freeze({ light: '#fcfcfc', dark: '#0f0f0f' }),
  cell: Object.freeze({
    light: '#68737e',
    dark: '#9dacb7',
    lightOpacity: 0.62,
    darkOpacity: 0.52,
  }),
  ambientLight: 0.85,
  keyLight: Object.freeze({ position: [7, 10, 8] as LabVectorTuple, intensity: 1.75, color: '#ffffff' }),
  fillLight: Object.freeze({ position: [-8, 2, -5] as LabVectorTuple, intensity: 0.45, color: '#dbe6f0' }),
  atomMaterial: Object.freeze({ roughness: 0.28, metalness: 0.08 }),
  selection: Object.freeze({ color: '#356ae6', opacity: 0.82, scale: 1.24 }),
});

function normalizeAspect(aspect: number) {
  return Number.isFinite(aspect) && aspect > Number.EPSILON ? aspect : 1;
}

function pointVector(point: THREE.Vector3 | LabVectorTuple) {
  return point instanceof THREE.Vector3 ? point : new THREE.Vector3(...point);
}

/** Returns a sphere enclosing atom radii, periodic images, and cell corners. */
export function labCameraBounds(points: Iterable<LabBoundedPoint>): LabCameraBounds {
  const box = new THREE.Box3();
  let populated = false;
  for (const item of points) {
    const position = pointVector(item.position);
    if (![position.x, position.y, position.z].every(Number.isFinite)) continue;
    const radius = Number.isFinite(item.radius) ? Math.max(0, item.radius ?? 0) : 0;
    box.expandByPoint(new THREE.Vector3(position.x - radius, position.y - radius, position.z - radius));
    box.expandByPoint(new THREE.Vector3(position.x + radius, position.y + radius, position.z + radius));
    populated = true;
  }
  if (!populated) return { center: new THREE.Vector3(), radius: 0.5 };
  const center = box.getCenter(new THREE.Vector3());
  return { center, radius: Math.max(0.5, box.max.distanceTo(center)) };
}

export function updateLabCameraClipping(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  bounds: LabCameraBounds,
) {
  // Use the content sphere itself instead of the orbit target. A user can pan
  // away from the fitted center, and trajectories can move or change volume
  // between frames while the requested camera pose remains untouched.
  const distance = camera.position.distanceTo(bounds.center);
  const radius = Math.max(bounds.radius * LAB_CAMERA.padding, 0.5);
  camera.near = Math.max(LAB_CAMERA.near, distance - radius * 2.5);
  camera.far = Math.max(LAB_CAMERA.far, distance + radius * 3);
}

export function fitLabCameraToBounds(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  bounds: LabCameraBounds,
  aspect: number,
  direction = LAB_CAMERA.isometricDirection,
) {
  const safeAspect = normalizeAspect(aspect);
  const radius = Math.max(bounds.radius, 0.5) * LAB_CAMERA.padding;
  const normalizedDirection = direction.lengthSq() > Number.EPSILON
    ? direction.clone().normalize()
    : LAB_CAMERA.isometricDirection.clone();
  if (camera instanceof THREE.PerspectiveCamera) {
    const vertical = THREE.MathUtils.degToRad(camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * safeAspect);
    const distance = radius / Math.sin(Math.max(0.05, Math.min(vertical, horizontal) / 2));
    camera.position.copy(bounds.center).addScaledVector(normalizedDirection, distance);
    camera.aspect = safeAspect;
    camera.userData.labFitDistance = distance;
  } else {
    const halfHeight = radius / Math.min(1, safeAspect);
    const halfWidth = halfHeight * safeAspect;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.zoom = 1;
    camera.position.copy(bounds.center).addScaledVector(normalizedDirection, Math.max(radius * 3, 12));
  }
  camera.userData.labFitRadius = radius;
  camera.userData.labFitAspect = safeAspect;
  updateLabCameraClipping(camera, bounds);
  camera.lookAt(bounds.center);
  camera.updateProjectionMatrix();
}

export function applyLabViewPreset(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  bounds: LabCameraBounds,
  aspect: number,
  presetId: LabViewPresetId,
) {
  const preset = getLabViewPreset(presetId);
  camera.up.set(...preset.up).normalize();
  fitLabCameraToBounds(camera, bounds, aspect, new THREE.Vector3(...preset.direction));
}

/** Change only the viewing angle, preserving the current distance and visible scale. */
export function orientLabCameraToPreset(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  target: THREE.Vector3,
  presetId: LabViewPresetId,
  distance = camera.position.distanceTo(target),
) {
  const preset = getLabViewPreset(presetId);
  const safeDistance = Number.isFinite(distance) && distance > Number.EPSILON ? distance : 0.5;
  const direction = new THREE.Vector3(...preset.direction).normalize();
  camera.up.set(...preset.up).normalize();
  camera.position.copy(target).addScaledVector(direction, safeDistance);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

/** Change projection without discarding the user's orbit target, direction, or visible scale. */
export function transferLabCameraView(
  source: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  destination: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  target: THREE.Vector3,
  bounds: LabCameraBounds,
  aspect: number,
) {
  const safeAspect = normalizeAspect(aspect);
  const offset = source.position.clone().sub(target);
  const direction = offset.lengthSq() > Number.EPSILON
    ? offset.normalize()
    : LAB_CAMERA.isometricDirection.clone();
  const sourceDistance = Math.max(source.position.distanceTo(target), 0.5);
  const halfHeight = source instanceof THREE.PerspectiveCamera
    ? sourceDistance * Math.tan(THREE.MathUtils.degToRad(source.fov) / 2)
    : Math.max(Math.abs(source.top - source.bottom) / (2 * Math.max(source.zoom, Number.EPSILON)), 0.01);

  destination.up.copy(source.up).normalize();
  destination.userData = { ...source.userData, labFitAspect: safeAspect };
  if (destination instanceof THREE.PerspectiveCamera) {
    const distance = halfHeight / Math.tan(THREE.MathUtils.degToRad(destination.fov) / 2);
    destination.aspect = safeAspect;
    destination.position.copy(target).addScaledVector(direction, Math.max(distance, 0.5));
    destination.userData.labFitDistance = Math.max(distance, 0.5);
  } else {
    destination.top = halfHeight;
    destination.bottom = -halfHeight;
    destination.left = -halfHeight * safeAspect;
    destination.right = halfHeight * safeAspect;
    destination.zoom = 1;
    destination.position.copy(target).addScaledVector(direction, sourceDistance);
  }
  updateLabCameraClipping(destination, bounds);
  destination.lookAt(target);
  destination.updateProjectionMatrix();
}

/** Preserve the current zoom and target while adapting a camera to a new viewport. */
export function resizeLabCameraViewport(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  aspect: number,
  target?: THREE.Vector3,
) {
  const safeAspect = normalizeAspect(aspect);
  if (camera instanceof THREE.PerspectiveCamera) {
    const radius = Number(camera.userData.labFitRadius);
    const previousFit = Number(camera.userData.labFitDistance);
    const previousAspect = Number(camera.userData.labFitAspect);
    if (target && Math.abs(previousAspect - safeAspect) > 1e-6 && Number.isFinite(radius) && radius > 0 && Number.isFinite(previousFit) && previousFit > 0) {
      const vertical = THREE.MathUtils.degToRad(camera.fov);
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * safeAspect);
      const nextFit = radius / Math.sin(Math.max(0.05, Math.min(vertical, horizontal) / 2));
      const offset = camera.position.clone().sub(target);
      if (offset.lengthSq() > Number.EPSILON) {
        camera.position.copy(target).add(offset.multiplyScalar(nextFit / previousFit));
      }
      camera.userData.labFitDistance = nextFit;
    }
    camera.aspect = safeAspect;
  } else {
    const fittedRadius = Number(camera.userData.labFitRadius);
    const halfHeight = Number.isFinite(fittedRadius) && fittedRadius > 0
      ? fittedRadius / Math.min(1, safeAspect)
      : Math.max(Math.abs(camera.top - camera.bottom) / 2, Number.EPSILON);
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.left = -halfHeight * safeAspect;
    camera.right = halfHeight * safeAspect;
  }
  camera.userData.labFitAspect = safeAspect;
  camera.updateProjectionMatrix();
}

type LabOrbitControls = {
  enableDamping: boolean;
  dampingFactor: number;
  rotateSpeed: number;
  panSpeed: number;
  zoomSpeed: number;
  zoomToCursor: boolean;
  screenSpacePanning: boolean;
};

export function configureLabOrbitControls(controls: LabOrbitControls) {
  controls.enableDamping = true;
  controls.dampingFactor = LAB_CAMERA.dampingFactor;
  controls.rotateSpeed = LAB_CAMERA.rotateSpeed;
  controls.panSpeed = LAB_CAMERA.panSpeed;
  controls.zoomSpeed = LAB_CAMERA.zoomSpeed;
  controls.zoomToCursor = false;
  controls.screenSpacePanning = true;
}

export type LabCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

export interface LabCameraControllerOptions {
  camera: LabCamera;
  aspect?: number;
  bounds?: LabCameraBounds;
  target?: THREE.Vector3;
  direction?: THREE.Vector3;
}

/** Unified camera controller shared between DFT and MD scientific viewports. */
export class LabCameraController {
  camera: LabCamera;
  target: THREE.Vector3;
  bounds: LabCameraBounds;
  aspect: number;

  constructor(options: LabCameraControllerOptions) {
    this.camera = options.camera;
    this.target = options.target ? options.target.clone() : (options.bounds?.center.clone() ?? new THREE.Vector3());
    this.bounds = options.bounds ? { center: options.bounds.center.clone(), radius: options.bounds.radius } : { center: this.target.clone(), radius: 0.5 };
    this.aspect = options.aspect ?? (this.camera instanceof THREE.PerspectiveCamera ? this.camera.aspect : 1);
  }

  get projection(): LabCameraProjection {
    return this.camera instanceof THREE.PerspectiveCamera ? 'perspective' : 'orthographic';
  }

  fit(bounds?: LabCameraBounds, direction?: THREE.Vector3) {
    if (bounds) this.bounds = bounds;
    this.target.copy(this.bounds.center);
    fitLabCameraToBounds(this.camera, this.bounds, this.aspect, direction);
  }

  applyPreset(presetId: LabViewPresetId, bounds?: LabCameraBounds) {
    if (bounds) this.bounds = bounds;
    this.target.copy(this.bounds.center);
    applyLabViewPreset(this.camera, this.bounds, this.aspect, presetId);
  }

  updateClipping(bounds?: LabCameraBounds) {
    if (bounds) this.bounds = bounds;
    updateLabCameraClipping(this.camera, this.bounds);
  }

  resize(aspect: number, target?: THREE.Vector3) {
    this.aspect = aspect;
    if (target) this.target.copy(target);
    resizeLabCameraViewport(this.camera, aspect, this.target);
  }

  switchProjection(
    destination: LabCamera,
    target?: THREE.Vector3,
    bounds?: LabCameraBounds,
  ): LabCamera {
    if (bounds) this.bounds = bounds;
    if (target) this.target.copy(target);
    transferLabCameraView(this.camera, destination, this.target, this.bounds, this.aspect);
    this.camera = destination;
    return this.camera;
  }

  configureControls(controls: Parameters<typeof configureLabOrbitControls>[0]) {
    configureLabOrbitControls(controls);
  }
}
