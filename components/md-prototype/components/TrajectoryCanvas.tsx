'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import {
  Ruler,
  Scissors,
  X,
} from 'lucide-react';
import type { FrameData } from '../types/trajectory';
import { activeViewports, viewportChecksum } from '@/lib/ai-viewport';
import { useAiViewportScope } from '@/components/AiViewportScope';
import { exportMdScene, type MdSceneExport } from '@/lib/md-scene-export';
import { CanvasToolbar, type CanvasToolId } from './CanvasToolbar';
import { colormapGradient, sampleColormap } from '../utils/colormaps';
import { LabSlider } from '@/components/LabControls';
import {
  LAB_CAMERA,
  LAB_VIEWPORT,
  applyLabViewPreset,
  configureLabOrbitControls,
  getLabViewPreset,
  labCameraBounds,
  orientLabCameraToPreset,
  resizeLabCameraViewport,
  updateLabCameraClipping,
  type LabBoundedPoint,
  type LabCameraBounds,
  type LabViewPresetId,
} from '@/lib/lab-camera';
import { cn } from '@/lib/utils';
import { useResearchShell } from '@/components/ResearchShellContext';

type ViewId = 'main' | 'top' | 'front' | 'left';
type ViewLayout = 'single' | 'quad';
type MeasureMode = 'atom' | 'distance' | 'angle';

type StudioCamera = THREE.OrthographicCamera;

interface PickedAtomInfo {
  configuration: number[];
  sourceId?: string;
  index: number;
  position: [number, number, number];
  typeId: number;
  element: string;
  colorHex: string;
  structureType: string;
  scalarValue?: number | null;
  scalarProperty?: string | null;
}

interface MeasurePoint {
  configuration: number[];
  sourceId?: string;
  index: number;
  idLabel: string;
  position: [number, number, number];
  fractional: [number, number, number];
  element: string;
  colorHex: string;
}

function computeFractionalCoordinates(
  pos: [number, number, number],
  cellMatrix?: number[][],
): [number, number, number] {
  if (cellMatrix && cellMatrix.length >= 3) {
    const origin = new THREE.Vector3(cellMatrix[0][3] || 0, cellMatrix[1][3] || 0, cellMatrix[2][3] || 0);
    const a = new THREE.Vector3(cellMatrix[0][0], cellMatrix[1][0], cellMatrix[2][0]);
    const b = new THREE.Vector3(cellMatrix[0][1], cellMatrix[1][1], cellMatrix[2][1]);
    const c = new THREE.Vector3(cellMatrix[0][2], cellMatrix[1][2], cellMatrix[2][2]);
    const basis = new THREE.Matrix3().set(
      a.x, b.x, c.x,
      a.y, b.y, c.y,
      a.z, b.z, c.z,
    );
    if (Math.abs(basis.determinant()) > 1e-8) {
      basis.invert();
      const frac = new THREE.Vector3(...pos).sub(origin).applyMatrix3(basis);
      if ([frac.x, frac.y, frac.z].every(Number.isFinite)) {
        return [frac.x, frac.y, frac.z];
      }
    }
  }
  return pos;
}

function makeLabelSprite(text: string) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = 'rgba(18, 18, 18, 0.82)';
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(14, 12, 100, 40, 8);
  } else {
    ctx.rect(14, 12, 100, 40);
  }
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#383838';
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(14, 12, 100, 40, 8);
  } else {
    ctx.rect(14, 12, 100, 40);
  }
  ctx.stroke();
  ctx.font = 'bold 24px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ededed';
  ctx.fillText(text, 64, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.4, 0.7, 1);
  return sprite;
}

interface TrajectoryCanvasProps {
  cameraStorageKey?: string;
  frameData: FrameData | null;
  theme?: 'light' | 'dark';
  exportRef?: React.RefObject<MdSceneExport | null>;
  onSelectionChange?: (ids: string[]) => void;
  selectedTrajId?: string;
  hideBulkCrystal?: boolean;
  showDislocations?: boolean;
  showSurfaceMesh?: boolean;
  showCellBox?: boolean;
  showBonds?: boolean;
  atomScale?: number;
}

function syncClipping(material: THREE.Material, planes: THREE.Plane[]) {
  const current = material.clippingPlanes ?? [];
  const changed = current.length !== planes.length || current.some((plane, index) => plane !== planes[index]);
  if (!changed) return;
  material.clippingPlanes = planes;
  material.clipShadows = planes.length > 0;
  material.needsUpdate = true;
}

export const TrajectoryCanvas: React.FC<TrajectoryCanvasProps> = ({
  frameData,
  cameraStorageKey,
  selectedTrajId,
  hideBulkCrystal = false,
  showDislocations = true,
  showSurfaceMesh = true,
  showCellBox = true,
  showBonds = true,
  atomScale = 1.0, theme = 'dark', exportRef, onSelectionChange,
}) => {
  const backgrounds = useResearchShell() ? LAB_VIEWPORT.researchBackground : LAB_VIEWPORT.background;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // Active Tool state: 'select' | 'pan' | 'focus' | 'measure' | 'delete'
  const [error, setError] = useState('');
  const visibleAtoms = useRef<boolean[]>([]);
  const dragStart = useRef<[number, number]>([0, 0]);
  const [activeTool, setActiveTool] = useState<CanvasToolId>('select');

  const [activeViewPreset, setActiveViewPreset] = useState<LabViewPresetId>('isometric');
  const [viewLayout, setViewLayout] = useState<ViewLayout>('single');

  // Interactive Atom Picking state
  const [pickedAtom, setPickedAtom] = useState<PickedAtomInfo | null>(null);
  const selectionMarkerRef = useRef<THREE.Mesh | null>(null);

  // Interactive 3D Measurement Mode (Bond Distance & Angle Ruler)
  const [isMeasureMode, setIsMeasureMode] = useState<boolean>(false);
  const [measureMode, setMeasureMode] = useState<MeasureMode>('distance');
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const measureGroupRef = useRef<THREE.Group | null>(null);
  const measureDragControls = useDragControls();


  // Viewport Display Local Overrides
  const [localAtomScale, setLocalAtomScale] = useState<number | null>(null);
  const [localShowBonds, setLocalShowBonds] = useState<boolean | null>(null);
  const [localShowCellBox, setLocalShowCellBox] = useState<boolean | null>(null);
  const [showLabels, setShowLabels] = useState<boolean>(false);

  const effectiveAtomScale = localAtomScale ?? atomScale ?? 1.0;
  const effectiveShowBonds = localShowBonds ?? showBonds ?? true;
  const effectiveShowCellBox = localShowCellBox ?? showCellBox ?? true;
  const activePickedAtom = useMemo(() => {
    if (!pickedAtom || pickedAtom.sourceId !== selectedTrajId || !frameData?.positions) return null;
    const offset = pickedAtom.index * 3;
    if (offset + 2 >= frameData.positions.length) return null;
    const px = frameData.positions[offset];
    const py = frameData.positions[offset + 1];
    const pz = frameData.positions[offset + 2];
    const stId = frameData.structureTypes?.[pickedAtom.index] ?? 0;
    const ptmNames: Record<number, string> = {
      0: "Other / Disordered",
      1: "FCC",
      2: "HCP (Stacking Fault)",
      3: "BCC",
      4: "Icosahedral",
    };
    return {
      ...pickedAtom,
      configuration: frameData.positions,
      position: [px, py, pz] as [number, number, number],
      structureType: frameData.structureTypes?.length
        ? frameData.phaseLabels?.[stId] ?? ptmNames[stId] ?? "Unclassified"
        : "Not classified",
      scalarValue: Number.isFinite(frameData.scalarValues?.[pickedAtom.index])
        ? Number(frameData.scalarValues![pickedAtom.index].toFixed(4))
        : null,
      scalarProperty: frameData.scalarRange?.property || null,
    };
  }, [pickedAtom, frameData, selectedTrajId]);

  const activeMeasurePoints = useMemo(() => {
    if (!measurePoints.length || !frameData?.positions) return [];
    if (measurePoints[0].sourceId !== selectedTrajId) return [];
    const pos = frameData.positions;
    const cellMatrix = frameData.cell?.matrix;
    return measurePoints.map((pt) => {
      const offset = pt.index * 3;
      if (offset + 2 < pos.length) {
        const cart: [number, number, number] = [pos[offset], pos[offset + 1], pos[offset + 2]];
        const frac = computeFractionalCoordinates(cart, cellMatrix);
        return {
          ...pt,
          configuration: pos,
          position: cart,
          fractional: frac,
        };
      }
      return pt;
    });
  }, [measurePoints, frameData, selectedTrajId]);

  const hasStructure = Boolean(frameData && frameData.numParticles > 0);

  // Dynamic Tripod Projection state (angles for X, Y, Z axes)
  const [tripodVectors, setTripodVectors] = useState<{
    x: [number, number];
    y: [number, number];
    z: [number, number];
  }>({ x: [20, 0], y: [0, -20], z: [-14, 14] });

  // Slice Plane state (Cross-Section Slicer)
  const [sliceActive, setSliceActive] = useState<boolean>(false);
  const [sliceAxis, setSliceAxis] = useState<'x' | 'y' | 'z'>('x');
  const [sliceDistance, setSliceDistance] = useState<number>(0);
  const [sliceInvert, setSliceInvert] = useState<boolean>(false);
  const clippingPlaneRef = useRef<THREE.Plane>(new THREE.Plane());
  const sliceHelperMeshRef = useRef<THREE.Mesh | null>(null);

  // Colormap Range Clamping state
  const [clampedRange, setClampedRange] = useState<{ min: number; max: number; property: string } | null>(null);
  const activeScalarProperty = frameData?.scalarRange?.property;
  const effectiveClampedRange = clampedRange?.property === activeScalarProperty ? clampedRange : null;

  // MD and DFT intentionally use one orthographic camera and one controller.
  const camerasRef = useRef<Record<ViewId, StudioCamera> | null>(null);
  const controlsRef = useRef<Record<ViewId, OrbitControls> | null>(null);
  const cameraKeyRef = useRef(cameraStorageKey);
  const restoredCameraRef = useRef(false);
  useEffect(() => { cameraKeyRef.current = cameraStorageKey; restoredCameraRef.current = false; }, [cameraStorageKey]);
  const captureScope = useAiViewportScope();
  const persistCameras = useCallback(() => {
    if (!cameraKeyRef.current || !restoredCameraRef.current) return;
    try {
      const cameras = camerasRef.current, controls = controlsRef.current;
      if (cameras && controls) localStorage.setItem(cameraKeyRef.current, JSON.stringify(Object.fromEntries((['main', 'top', 'front', 'left'] as const).map(id => [id, { position: cameras[id].position.toArray(), up: cameras[id].up.toArray(), target: controls[id].target.toArray(), zoom: cameras[id].zoom }]))));
    } catch { /* Camera state is device-local and does not change input geometry. */ }
  }, []);
  const requestRenderRef = useRef<() => void>(() => undefined);
  const renderNowRef = useRef<() => void>(() => undefined);

  const viewportDomRefs = useRef<Record<ViewId, HTMLDivElement | null>>({
    main: null,
    top: null,
    front: null,
    left: null,
  });
  const viewLayoutRef = useRef<ViewLayout>('single');

  // The scene is translated so the current content bounds stay centered at the origin.
  const cellExtentRef = useRef<number>(20);
  const cameraBoundsRef = useRef<LabCameraBounds>({ center: new THREE.Vector3(), radius: 20 });
  const cameraPresetRef = useRef<Record<ViewId, LabViewPresetId>>({
    main: 'isometric',
    top: 'top',
    front: 'front',
    left: 'left',
  });
  const lastDataKeyRef = useRef<string | null>(null);
  const contentOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3());

  // Object group references
  const sceneRootGroupRef = useRef<THREE.Group | null>(null);
  const sceneContentGroupRef = useRef<THREE.Group | null>(null);
  const instancedMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const cellBoxRef = useRef<THREE.LineSegments | null>(null);
  const dislocationsGroupRef = useRef<THREE.Group | null>(null);
  const surfaceMeshRef = useRef<THREE.Mesh | null>(null);
  const bondsMeshRef = useRef<THREE.LineSegments | null>(null);
  const labelsGroupRef = useRef<THREE.Group | null>(null);

  const disposeObject = (object: THREE.Object3D | null) => {
    object?.traverse(child => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
      } else if (child instanceof THREE.Sprite) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
  };
  // Fit one camera using the same framing and named presets as DFT Lab.
  const resetCamera = useCallback((id: ViewId, requestedPreset?: LabViewPresetId) => {
    const camera = camerasRef.current?.[id];
    const controls = controlsRef.current?.[id];
    if (!camera || !controls) return;
    const preset = requestedPreset ?? cameraPresetRef.current[id];
    cameraPresetRef.current[id] = preset;
    const bounds = cameraBoundsRef.current;
    const isQuad = viewLayoutRef.current === 'quad';
    const w = (containerRef.current?.clientWidth || 800) / (isQuad ? 2 : 1);
    const h = (containerRef.current?.clientHeight || 600) / (isQuad ? 2 : 1);
    const aspect = w / h;
    controls.target.copy(bounds.center);
    applyLabViewPreset(camera, bounds, aspect, preset);
    controls.update();
    requestRenderRef.current();
  }, []);

  // A new trajectory is fitted once; changing a frame preserves the current pose.
  const resetAllCameras = useCallback(() => {
    (['main', 'top', 'front', 'left'] as const).forEach((id) => resetCamera(id));
  }, [resetCamera]);

  // Match DFT Lab angle selection: reorient around the stable scene origin
  // without refitting the current frame or changing orthographic zoom.
  const selectCameraPreset = useCallback((id: ViewId, preset: LabViewPresetId) => {
    const camera = camerasRef.current?.[id];
    const controls = controlsRef.current?.[id];
    if (!camera || !controls) return;
    const distance = Math.max(5.5, camera.position.distanceTo(controls.target));
    cameraPresetRef.current[id] = preset;
    controls.target.set(0, 0, 0);
    orientLabCameraToPreset(camera, controls.target, preset, distance);
    controls.update();
    requestRenderRef.current();
  }, []);

  // OrbitControls is an imperative Three.js object, separate from React state.
  useEffect(() => {
    Object.entries(controlsRef.current ?? {}).forEach(([id, ctrl]) => {
      if (id !== "main") {
        Object.assign(ctrl.mouseButtons, {
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        });
      } else {
        Object.assign(ctrl.mouseButtons, {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        });
      }
    });
  }, []);

  useEffect(() => {
    const prev = viewLayoutRef.current;
    viewLayoutRef.current = viewLayout;
    if (viewLayout === "quad" && prev !== "quad") {
      (["top", "front", "left"] as const).forEach((id) => resetCamera(id));
    }
    requestRenderRef.current();
  }, [resetCamera, viewLayout]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName)) return;

      if (event.altKey && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        setViewLayout((layout) => layout === 'single' ? 'quad' : 'single');
        return;
      }

      if (event.key === 'v' || event.key === 'V') {
        setActiveTool('select');
        setIsMeasureMode(false);
      } else if (event.key === 'm' || event.key === 'M') {
        setActiveTool((prev) => {
          if (prev === 'measure') {
            setIsMeasureMode(false);
            return 'select';
          }
          setIsMeasureMode(true);
          setPickedAtom(null);
          return 'measure';
        });
      } else if (event.key === 's' || event.key === 'S') {
        setSliceActive((prev) => !prev);
      } else if (event.key === 'f' || event.key === 'F') {
        if (viewLayout === 'quad') {
          resetAllCameras();
        } else {
          resetCamera('main');
        }
      } else if (event.key === 'Escape') {
        setMeasurePoints([]);
        setPickedAtom(null);
        onSelectionChange?.([]);
        if (selectionMarkerRef.current) {
          selectionMarkerRef.current.visible = false;
          requestRenderRef.current();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelectionChange, resetAllCameras, resetCamera, viewLayout]);

  // Raycaster atom picking on the single shared viewport.
  const handleQuadrantClick = (e: React.MouseEvent<HTMLDivElement>, viewId: ViewId) => {
    if (Math.hypot(e.clientX - dragStart.current[0], e.clientY - dragStart.current[1]) > 4) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const camera = camerasRef.current?.[viewId];
    const instanced = instancedMeshRef.current;
    if (!camera || !instanced || !frameData) return;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera);
    const intersects = raycaster.intersectObject(instanced).filter(hit => hit.instanceId !== undefined && visibleAtoms.current[hit.instanceId]);

    let validHit: THREE.Intersection | undefined;
    if (sliceActive) {
      validHit = intersects.find((hit) => clippingPlaneRef.current.distanceToPoint(hit.point) >= 0);
    } else {
      validHit = intersects[0];
    }

    if (validHit && validHit.instanceId !== undefined) {
      const idx = validHit.instanceId;
      const px = frameData.positions[idx * 3];
      const py = frameData.positions[idx * 3 + 1];
      const pz = frameData.positions[idx * 3 + 2];
      const r = Math.round((frameData.colors[idx * 3] ?? 0.5) * 255);
      const g = Math.round((frameData.colors[idx * 3 + 1] ?? 0.5) * 255);
      const b = Math.round((frameData.colors[idx * 3 + 2] ?? 0.5) * 255);
      const hexColor = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;

      const typeId = frameData.types[idx] ?? 1;

      if (isMeasureMode) {
        const targetCount = measureMode === 'atom' ? 1 : measureMode === 'distance' ? 2 : 3;
        const ptFrac = computeFractionalCoordinates([px, py, pz], frameData.cell?.matrix);
        const idLabel = frameData.ids?.[idx] ? `#${frameData.ids[idx]}` : `#${idx + 1}`;
        const newPoint: MeasurePoint = {
          configuration: frameData.positions,
          sourceId: selectedTrajId,
          index: idx,
          idLabel,
          position: [px, py, pz],
          fractional: ptFrac,
          element: frameData.species[idx] ?? `Type ${typeId}`,
          colorHex: hexColor,
        };

        setMeasurePoints((prev) => {
          const current = prev[0]?.configuration === frameData.positions
            && prev[0]?.sourceId === selectedTrajId
            ? prev
            : [];
          if (current.length > 0 && current[current.length - 1].index === idx) {
            return current;
          }
          if (current.length >= targetCount) {
            return [newPoint];
          }
          return [...current, newPoint];
        });
        return;
      }

      const stId = frameData.structureTypes?.[idx] ?? 0;
      const ptmNames: Record<number, string> = {
        0: 'Other / Disordered',
        1: 'FCC',
        2: 'HCP (Stacking Fault)',
        3: 'BCC',
        4: 'Icosahedral',
      };

      setPickedAtom({
        configuration: frameData.positions,
        sourceId: selectedTrajId,
        index: idx,
        position: [px, py, pz],
        typeId,
        element: frameData.species[idx] ?? `Type ${typeId}`,
        colorHex: hexColor,
        structureType: frameData.structureTypes.length ? frameData.phaseLabels[stId] ?? ptmNames[stId] ?? 'Unclassified' : 'Not classified',
        scalarValue:
          Number.isFinite(frameData.scalarValues?.[idx])
            ? Number(frameData.scalarValues![idx].toFixed(4))
            : null,
        scalarProperty: frameData.scalarRange?.property || null,
      });

      // Move selection marker to atom position inside sceneRootGroup
      if (selectionMarkerRef.current) {
        selectionMarkerRef.current.position.set(px, py, pz);
        const atomRadius = (frameData.radii?.[idx] ?? 1.2) * effectiveAtomScale * LAB_VIEWPORT.selection.scale;
        selectionMarkerRef.current.scale.set(atomRadius, atomRadius, atomRadius);
        selectionMarkerRef.current.visible = true;
        requestRenderRef.current();
      }
    } else {
      // Clicked empty space
      if (isMeasureMode) {
        setMeasurePoints([]);
      } else {
        setPickedAtom(null);
        onSelectionChange?.([]);
        if (selectionMarkerRef.current) {
          selectionMarkerRef.current.visible = false;
          requestRenderRef.current();
        }
      }
    }
  };

  // Initialize the DFT-parity orthographic viewport and MD-only Quad views.
  useEffect(() => {
    if (!containerRef.current || !canvasContainerRef.current) return;
    const container = containerRef.current;
    const canvasContainer = canvasContainerRef.current;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // 1. Scene & Background (Obsidian Stage matching Phynite-Lab #343434)
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(LAB_VIEWPORT.background.dark);
    sceneRef.current = scene;

    // 2. Every view uses the shared orthographic camera configuration. The main
    // camera stays interactive in single mode; Quad adds three named projections.
    const aspect = width / height;
    const frustumH = 40;
    const halfH = frustumH / 2;
    const halfW = halfH * aspect;
    const createOrthoCamera = () => {
      const next = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, LAB_CAMERA.near, LAB_CAMERA.far);
      next.up.set(...getLabViewPreset('isometric').up);
      next.position.copy(LAB_CAMERA.isometricDirection).multiplyScalar(40);
      return next;
    };
    const cameras: Record<ViewId, StudioCamera> = {
      main: createOrthoCamera(),
      top: createOrthoCamera(),
      front: createOrthoCamera(),
      left: createOrthoCamera(),
    };
    camerasRef.current = cameras;

    // 3. WebGL renderer. PNG export explicitly renders immediately before capture,
    // so the expensive persistent drawing buffer is unnecessary.
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    }); } catch { queueMicrotask(() => setError('WebGL is unavailable. Enable hardware acceleration to use the viewport.')); return; }
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.localClippingEnabled = true;
    canvasContainer.innerHTML = '';
    canvasContainer.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Each interaction plane owns OrbitControls while sharing the same policy.
    const createControls = (id: ViewId) => {
      const control = new OrbitControls(cameras[id], viewportDomRefs.current[id] || renderer.domElement);
      configureLabOrbitControls(control);
      if (id !== "main") {
        control.enableRotate = false;
      }
      return control;
    };
    const controls: Record<ViewId, OrbitControls> = {
      main: createControls('main'),
      top: createControls('top'),
      front: createControls('front'),
      left: createControls('left'),
    };
    controlsRef.current = controls;

    // 5. Lighting shared with DFT Lab.
    const ambientLight = new THREE.AmbientLight(0xffffff, LAB_VIEWPORT.ambientLight);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(LAB_VIEWPORT.keyLight.color, LAB_VIEWPORT.keyLight.intensity);
    dirLight1.position.set(...LAB_VIEWPORT.keyLight.position);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(LAB_VIEWPORT.fillLight.color, LAB_VIEWPORT.fillLight.intensity);
    dirLight2.position.set(...LAB_VIEWPORT.fillLight.position);
    scene.add(dirLight2);

    // Root group for all simulation objects (atoms, cell box, dislocations, surface, bonds)
    const rootGroup = new THREE.Group();
    scene.add(rootGroup);
    sceneRootGroupRef.current = rootGroup;

    // Simulation content may receive one stable periodic display translation so
    // the particle cloud sits symmetrically inside the cell. The cell itself
    // remains in the source coordinate system.
    const contentGroup = new THREE.Group();
    rootGroup.add(contentGroup);
    sceneContentGroupRef.current = contentGroup;

    // Groups for dislocations & surfaces
    const dislocationsGroup = new THREE.Group();
    contentGroup.add(dislocationsGroup);
    dislocationsGroupRef.current = dislocationsGroup;

    // Group for 3D measurement ruler & angle
    const measureGroup = new THREE.Group();
    contentGroup.add(measureGroup);
    measureGroupRef.current = measureGroup;

    // Group for atom text labels
    const labelsGroup = new THREE.Group();
    contentGroup.add(labelsGroup);
    labelsGroupRef.current = labelsGroup;

    // Selection Marker Sphere (pulsing wireframe halo around picked atom)
    const selGeo = new THREE.SphereGeometry(1.0, 16, 12);
    const selMat = new THREE.MeshBasicMaterial({
      color: LAB_VIEWPORT.selection.color,
      wireframe: true,
      transparent: true,
      opacity: LAB_VIEWPORT.selection.opacity,
    });
    const selMesh = new THREE.Mesh(selGeo, selMat);
    selMesh.visible = false;
    contentGroup.add(selMesh);
    selectionMarkerRef.current = selMesh;

    // Slice plane visual guide helper mesh (semi-transparent guide plane in 3D)
    const sliceGeo = new THREE.PlaneGeometry(1, 1);
    const sliceMat = new THREE.MeshBasicMaterial({
      color: 0x356ae6,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const sliceMesh = new THREE.Mesh(sliceGeo, sliceMat);
    const edgesGeo = new THREE.EdgesGeometry(sliceGeo);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x60a5fa, linewidth: 2 });
    const edges = new THREE.LineSegments(edgesGeo, edgesMat);
    sliceMesh.add(edges);
    sliceMesh.visible = false;
    scene.add(sliceMesh);
    sliceHelperMeshRef.current = sliceMesh;

    resetAllCameras();

    // 6. Render only while data, layout, or camera motion changes.
    let animationId = 0;
    let renderPending = false;
    const updateTripod = () => {
      const matrix = new THREE.Matrix3().setFromMatrix4(cameras.main.matrixWorldInverse);
      const vx = new THREE.Vector3(1, 0, 0).applyMatrix3(matrix);
      const vy = new THREE.Vector3(0, 1, 0).applyMatrix3(matrix);
      const vz = new THREE.Vector3(0, 0, 1).applyMatrix3(matrix);
      setTripodVectors(previous => {
        const next = {
          x: [vx.x * 20, -vx.y * 20],
          y: [vy.x * 20, -vy.y * 20],
          z: [vz.x * 20, -vz.y * 20],
        } as typeof previous;
        const stable = (['x', 'y', 'z'] as const).every(axis =>
          Math.abs(previous[axis][0] - next[axis][0]) < 0.02
          && Math.abs(previous[axis][1] - next[axis][1]) < 0.02);
        return stable ? previous : next;
      });
    };
    const renderFrame = () => {
      renderPending = false;
      if (!containerRef.current || !rendererRef.current || !sceneRef.current) return;
      const widthNow = containerRef.current.clientWidth;
      const heightNow = containerRef.current.clientHeight;
      if (widthNow <= 0 || heightNow <= 0) return;
      let moving = false;
      Object.values(controls).forEach((control) => {
        moving = control.update() || moving;
      });
      if (viewLayoutRef.current === 'single') {
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, widthNow, heightNow);
        resizeLabCameraViewport(cameras.main, widthNow / heightNow, controls.main.target);
        renderer.render(scene, cameras.main);
      } else {
        const leftWidth = Math.floor(widthNow / 2);
        const rightWidth = widthNow - leftWidth;
        const bottomHeight = Math.floor(heightNow / 2);
        const topHeight = heightNow - bottomHeight;
        const quadrants: Array<{ id: ViewId; x: number; y: number; width: number; height: number }> = [
          { id: 'top', x: 0, y: bottomHeight, width: leftWidth, height: topHeight },
          { id: 'front', x: leftWidth, y: bottomHeight, width: rightWidth, height: topHeight },
          { id: 'left', x: 0, y: 0, width: leftWidth, height: bottomHeight },
          { id: 'main', x: leftWidth, y: 0, width: rightWidth, height: bottomHeight },
        ];
        renderer.setScissorTest(true);
        for (const quadrant of quadrants) {
          renderer.setViewport(quadrant.x, quadrant.y, quadrant.width, quadrant.height);
          renderer.setScissor(quadrant.x, quadrant.y, quadrant.width, quadrant.height);
          resizeLabCameraViewport(cameras[quadrant.id], quadrant.width / quadrant.height, controls[quadrant.id].target);
          renderer.render(scene, cameras[quadrant.id]);
        }
        renderer.setScissorTest(false);
      }
      updateTripod();
      if (moving) requestRenderRef.current();
    };
    renderNowRef.current = renderFrame;
    requestRenderRef.current = () => {
      if (renderPending) return;
      renderPending = true;
      animationId = requestAnimationFrame(renderFrame);
    };
    Object.values(controls).forEach((control) => { control.addEventListener('change', requestRenderRef.current); control.addEventListener('end', persistCameras); });
    requestRenderRef.current();

    // 7. Resize Observer for dynamic panel resizing
    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w <= 0 || h <= 0) return;
      rendererRef.current.setSize(w, h);
      requestRenderRef.current();
    });
    resizeObserver.observe(container);

    return () => {
      persistCameras();
      Object.values(controls).forEach(control => control.removeEventListener('end', persistCameras));
      resizeObserver.disconnect();
      cancelAnimationFrame(animationId);
      Object.values(controls).forEach((control) => control.removeEventListener('change', requestRenderRef.current));
      disposeObject(scene);
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      instancedMeshRef.current = null;
      cellBoxRef.current = null;
      dislocationsGroupRef.current = null;
      surfaceMeshRef.current = null;
      bondsMeshRef.current = null;
      sceneRootGroupRef.current = null;
      sceneContentGroupRef.current = null;
      selectionMarkerRef.current = null;
      measureGroupRef.current = null;
      sliceHelperMeshRef.current = null;
      const currentControls = controlsRef.current;
      Object.values(currentControls ?? {}).forEach((control) => control.dispose());
      camerasRef.current = null;
      controlsRef.current = null;
      requestRenderRef.current = () => undefined;
      renderNowRef.current = () => undefined;
      lastDataKeyRef.current = null;
      canvasContainer.innerHTML = '';
    };
  }, [resetAllCameras, persistCameras]);

  /* eslint-disable react-hooks/immutability -- This effect mutates Three.js scene objects held in refs, never React state or input frame data. */
  // Update 3D scene elements whenever frameData or visibility options change
  useEffect(() => {
    const contentGroup = sceneContentGroupRef.current;
    if (!sceneRef.current || !contentGroup || !frameData) return;
    const nParticles = frameData.numParticles;
    const positions = frameData.positions;
    const colors = frameData.colors;
    const structureTypes = frameData.structureTypes || [];
    const selection = frameData.selection;

    // --- A. ATOMS INSTANCED MESH ---
    let instanced = instancedMeshRef.current;
    if (!instanced || instanced.parent !== contentGroup || instanced.instanceMatrix.count < nParticles) {
      if (instanced?.parent) { instanced.parent.remove(instanced); disposeObject(instanced); }

      const sphereGeo = new THREE.SphereGeometry(1.0, nParticles > 20000 ? 10 : 24, nParticles > 20000 ? 8 : 18);
      const material = new THREE.MeshStandardMaterial({
        roughness: LAB_VIEWPORT.atomMaterial.roughness,
        metalness: LAB_VIEWPORT.atomMaterial.metalness,
      });
      instanced = new THREE.InstancedMesh(sphereGeo, material, Math.max(nParticles, 1));
      instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      instanced.frustumCulled = false;
      contentGroup.add(instanced);
      instancedMeshRef.current = instanced;
    }

    const dummy = new THREE.Object3D();
    const colorHelper = new THREE.Color();
    const radii = frameData.radii;
    const scalarValues = frameData.scalarValues;
    const scalarColormap = frameData.scalarRange?.colormap || 'viridis';
    const clampMin = effectiveClampedRange?.min;
    const clampSpan = effectiveClampedRange ? Math.max(Number.EPSILON, effectiveClampedRange.max - effectiveClampedRange.min) : 1;
    const particleMin = new THREE.Vector3(Infinity, Infinity, Infinity);
    const particleMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    let visibleCount = 0;
    let maximumAtomRadius = 0;

    for (let i = 0; i < nParticles; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];

      const r = colors[i * 3] ?? 0.5;
      const g = colors[i * 3 + 1] ?? 0.5;
      const b = colors[i * 3 + 2] ?? 0.5;

      const st = structureTypes[i] ?? 0;
      const isSelected = !selection || selection[i] === 1;

      // If hideBulkCrystal is enabled, hide perfect FCC (1) or BCC (3) atoms
      const isBulk = frameData.bulkStructureType !== undefined && st === frameData.bulkStructureType;
      const visible = isSelected && !(hideBulkCrystal && isBulk);

      visibleAtoms.current[i] = visible;
      dummy.position.set(x, y, z);
      if (visible) {
        const baseRadius = radii && radii[i] !== undefined ? radii[i] : 0.75;
        const atomRadius = baseRadius * effectiveAtomScale;
        maximumAtomRadius = Math.max(maximumAtomRadius, atomRadius);
        dummy.scale.set(atomRadius, atomRadius, atomRadius);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          particleMin.min(dummy.position);
          particleMax.max(dummy.position);
          visibleCount++;
        }
      } else {
        dummy.scale.set(0, 0, 0); // Hide in GPU
      }
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);

      if (effectiveClampedRange && scalarValues && Number.isFinite(scalarValues[i])) {
        const sampled = sampleColormap((scalarValues[i] - (clampMin ?? 0)) / clampSpan, scalarColormap);
        colorHelper.setRGB(sampled[0], sampled[1], sampled[2]);
      } else {
        colorHelper.setRGB(r, g, b);
      }
      instanced.setColorAt(i, colorHelper);
    }

    instanced.count = nParticles;
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;

    // --- B. SIMULATION CELL GEOMETRY, CENTER & WIREFRAME BOX ---
    let center = new THREE.Vector3(0, 0, 0);
    let extent = 20.0;
    let a = new THREE.Vector3(20, 0, 0);
    let b = new THREE.Vector3(0, 20, 0);
    let c = new THREE.Vector3(0, 0, 20);
    let origin = new THREE.Vector3(0, 0, 0);
    let cellCorners: THREE.Vector3[] = [];
    const particleCenter = visibleCount > 0
      ? particleMin.clone().add(particleMax).multiplyScalar(0.5)
      : new THREE.Vector3();
    const dataKey = selectedTrajId || (frameData.attributes?.SourceFile as string) || 'default';
    const isNewData = lastDataKeyRef.current === null || lastDataKeyRef.current !== dataKey;

    if (frameData.cell?.matrix && frameData.cell.matrix.length >= 3) {
      const m = frameData.cell.matrix;
      origin = new THREE.Vector3(m[0][3] || 0, m[1][3] || 0, m[2][3] || 0);
      a = new THREE.Vector3(m[0][0], m[1][0], m[2][0]);
      b = new THREE.Vector3(m[0][1], m[1][1], m[2][1]);
      c = new THREE.Vector3(m[0][2], m[1][2], m[2][2]);

      // Geometric center of the simulation cell
      center = origin.clone().add(a.clone().add(b).add(c).multiplyScalar(0.5));

      cellCorners = [
        origin,
        origin.clone().add(a),
        origin.clone().add(b),
        origin.clone().add(a).add(b),
        origin.clone().add(c),
        origin.clone().add(a).add(c),
        origin.clone().add(b).add(c),
        origin.clone().add(a).add(b).add(c),
      ];
      let maxDist = 0;
      for (const pt of cellCorners) {
        const d = pt.distanceTo(center);
        if (d > maxDist) maxDist = d;
      }
      extent = Math.max(maxDist, 6.0);

      // Unit cell and particles are centered via sceneRootGroupRef at (0, 0, 0).
      // Keep contentOffset at origin so atom positions strictly correspond to cell basis coordinates.
      if (isNewData) {
        contentOffsetRef.current.set(0, 0, 0);
      }
      if (visibleCount > 0) {
        const shiftedMin = particleMin.clone().add(contentOffsetRef.current);
        const shiftedMax = particleMax.clone().add(contentOffsetRef.current);
        for (const x of [shiftedMin.x, shiftedMax.x]) {
          for (const y of [shiftedMin.y, shiftedMax.y]) {
            for (const z of [shiftedMin.z, shiftedMax.z]) {
              extent = Math.max(extent, new THREE.Vector3(x, y, z).distanceTo(center) + maximumAtomRadius);
            }
          }
        }
      }
    } else if (nParticles > 0) {
      center.copy(particleCenter);
      const halfDiag = particleMax.clone().sub(particleMin).length() * 0.5 + maximumAtomRadius;
      extent = Math.max(halfDiag, 6.0);
      if (isNewData) contentOffsetRef.current.set(0, 0, 0);
    }

    // Build one shared content sphere from every rendered extent: the full
    // (possibly triclinic) cell plus the visible particle cloud including its
    // displayed radius. Periodic images and atoms outside the cell are already
    // part of the particle positions, so they cannot be clipped by fitting.
    const boundsPoints: LabBoundedPoint[] = cellCorners.map((position) => ({ position }));
    if (visibleCount > 0) {
      const shiftedMin = particleMin.clone().add(contentOffsetRef.current);
      const shiftedMax = particleMax.clone().add(contentOffsetRef.current);
      for (const x of [shiftedMin.x, shiftedMax.x]) {
        for (const y of [shiftedMin.y, shiftedMax.y]) {
          for (const z of [shiftedMin.z, shiftedMax.z]) {
            boundsPoints.push({ position: new THREE.Vector3(x, y, z), radius: maximumAtomRadius });
          }
        }
      }
    }
    const rawCameraBounds = labCameraBounds(boundsPoints);
    const hasCameraContent = boundsPoints.length > 0;
    cameraBoundsRef.current = {
      center: rawCameraBounds.center.clone().sub(center),
      radius: rawCameraBounds.radius,
    };
    extent = rawCameraBounds.radius;
    cellExtentRef.current = extent;

    // Shift root group so the unit cell's center is precisely at world (0, 0, 0)
    if (sceneRootGroupRef.current) {
      sceneRootGroupRef.current.position.set(-center.x, -center.y, -center.z);
    }
    contentGroup.position.copy(contentOffsetRef.current);

    // Frame changes may alter the cell volume. Keep the user's camera pose and
    // update clipping only; a new trajectory is the only automatic re-fit.
    if (camerasRef.current) {
      Object.values(camerasRef.current).forEach((camera) => {
        updateLabCameraClipping(camera, cameraBoundsRef.current);
        camera.updateProjectionMatrix();
      });
    }

    // Auto-frame all 4 cameras whenever a new trajectory / material is selected or on first load
    if (isNewData && hasCameraContent) {
      lastDataKeyRef.current = dataKey;
      resetAllCameras();
      if (!restoredCameraRef.current && cameraKeyRef.current) {
        try {
          const saved = JSON.parse(localStorage.getItem(cameraKeyRef.current) ?? 'null');
          for (const id of ['main', 'top', 'front', 'left'] as const) {
            const pose = saved?.[id], camera = camerasRef.current?.[id], control = controlsRef.current?.[id];
            if (pose && camera && control && [pose.position, pose.up, pose.target].every(value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)) && Number.isFinite(pose.zoom) && pose.zoom > 0) {
              camera.position.fromArray(pose.position); camera.up.fromArray(pose.up); camera.zoom = pose.zoom; control.target.fromArray(pose.target);
              updateLabCameraClipping(camera, cameraBoundsRef.current); camera.updateProjectionMatrix(); control.update();
            }
          }
        } catch { /* Invalid device camera data falls back to the shared preset. */ }
        restoredCameraRef.current = true;
      }
    }

    // --- C. CELL WIREFRAME BOX ---
    if (!effectiveShowCellBox && cellBoxRef.current && sceneRootGroupRef.current) {
      sceneRootGroupRef.current.remove(cellBoxRef.current);
      disposeObject(cellBoxRef.current); cellBoxRef.current = null;
    }
    if (effectiveShowCellBox && frameData.cell?.matrix) {
      const p0 = origin;
      const p1 = p0.clone().add(a);
      const p2 = p0.clone().add(b);
      const p3 = p1.clone().add(b);
      const p4 = p0.clone().add(c);
      const p5 = p1.clone().add(c);
      const p6 = p2.clone().add(c);
      const p7 = p3.clone().add(c);

      const boxPoints = [
        p0, p1,  p1, p3,  p3, p2,  p2, p0, // Bottom face
        p4, p5,  p5, p7,  p7, p6,  p6, p4, // Top face
        p0, p4,  p1, p5,  p2, p6,  p3, p7, // Vertical edges
      ];

      if (cellBoxRef.current) {
        const attribute = cellBoxRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
        boxPoints.forEach((point, index) => attribute.setXYZ(index, point.x, point.y, point.z));
        attribute.needsUpdate = true;
        cellBoxRef.current.geometry.computeBoundingSphere();
        const material = cellBoxRef.current.material as THREE.LineBasicMaterial;
        material.color.set(theme === 'dark' ? LAB_VIEWPORT.cell.dark : LAB_VIEWPORT.cell.light);
        material.opacity = theme === 'dark' ? LAB_VIEWPORT.cell.darkOpacity : LAB_VIEWPORT.cell.lightOpacity;
      } else {
        const boxGeo = new THREE.BufferGeometry().setFromPoints(boxPoints);
        const boxMat = new THREE.LineBasicMaterial({
          color: theme === 'dark' ? LAB_VIEWPORT.cell.dark : LAB_VIEWPORT.cell.light,
          transparent: true,
          opacity: theme === 'dark' ? LAB_VIEWPORT.cell.darkOpacity : LAB_VIEWPORT.cell.lightOpacity,
        });
        const cellBox = new THREE.LineSegments(boxGeo, boxMat);
        sceneRootGroupRef.current?.add(cellBox);
        cellBoxRef.current = cellBox;
      }
    }

    // --- D. DISLOCATIONS (DXA) ---
    if (dislocationsGroupRef.current) {
      const dGroup = dislocationsGroupRef.current;
      disposeObject(dGroup); dGroup.clear();

      if (showDislocations && frameData.dislocations?.lines) {
        frameData.dislocations.lines.forEach((line) => {
          if (line.points.length < 2) return;
          const linePts = line.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
          const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
          const lineMat = new THREE.LineBasicMaterial({
            color: new THREE.Color(line.color[0], line.color[1], line.color[2]),
            linewidth: 3,
          });
          const lineSegment = new THREE.Line(lineGeo, lineMat);
          dGroup.add(lineSegment);
        });
      }
    }

    // --- E. SURFACE / VOID MESH ---
    if (surfaceMeshRef.current) {
      surfaceMeshRef.current.parent?.remove(surfaceMeshRef.current);
      disposeObject(surfaceMeshRef.current); surfaceMeshRef.current = null;
    }
    if (showSurfaceMesh && frameData.surface && frameData.surface.vertices.length > 0) {
      const surf = frameData.surface;
      const surfGeo = new THREE.BufferGeometry();

      const vArr = new Float32Array(surf.vertices.flat());
      const fArr = new Uint32Array(surf.faces.flat());
      surfGeo.setAttribute('position', new THREE.BufferAttribute(vArr, 3));
      surfGeo.setIndex(new THREE.BufferAttribute(fArr, 1));
      surfGeo.computeVertexNormals();

      const surfMat = new THREE.MeshPhysicalMaterial({
        color: 0x356ae6,
        transparent: true,
        opacity: 0.32,
        roughness: 0.2,
        transmission: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const sMesh = new THREE.Mesh(surfGeo, surfMat);
      contentGroup.add(sMesh);
      surfaceMeshRef.current = sMesh;
    }

    // --- F. CHEMICAL BONDS 3D RENDERING ---
    if (bondsMeshRef.current) {
      bondsMeshRef.current.parent?.remove(bondsMeshRef.current);
      disposeObject(bondsMeshRef.current);
      bondsMeshRef.current = null;
    }
    if (effectiveShowBonds && frameData.bonds && frameData.bonds.length > 0) {
      const bList = frameData.bonds;
      const pos = frameData.positions;
      const bondPts: THREE.Vector3[] = [];

      for (let i = 0; i < bList.length; i++) {
        const i0 = bList[i][0];
        const i1 = bList[i][1];
        if (visibleAtoms.current[i0] && visibleAtoms.current[i1] && i0 * 3 + 2 < pos.length && i1 * 3 + 2 < pos.length) {
          bondPts.push(new THREE.Vector3(pos[i0 * 3], pos[i0 * 3 + 1], pos[i0 * 3 + 2]));
          bondPts.push(new THREE.Vector3(pos[i1 * 3], pos[i1 * 3 + 1], pos[i1 * 3 + 2]));
        }
      }

      if (bondPts.length > 0) {
        const bondsGeo = new THREE.BufferGeometry().setFromPoints(bondPts);
        const bondsMat = new THREE.LineBasicMaterial({
          color: 0xa1b8d6,
          linewidth: 2,
          transparent: true,
          opacity: 0.75,
        });
        const bondsMesh = new THREE.LineSegments(bondsGeo, bondsMat);
        contentGroup.add(bondsMesh);
        bondsMeshRef.current = bondsMesh;
      }
    }

    // --- G. ATOM LABELS ---
    if (labelsGroupRef.current) {
      const lGroup = labelsGroupRef.current;
      disposeObject(lGroup);
      lGroup.clear();

      if (showLabels && visibleCount <= 200) {
        for (let i = 0; i < nParticles; i++) {
          if (!visibleAtoms.current[i]) continue;
          const x = positions[i * 3];
          const y = positions[i * 3 + 1];
          const z = positions[i * 3 + 2];
          const element = frameData.species?.[i] || 'X';
          const sprite = makeLabelSprite(element);
          if (sprite) {
            const baseR = radii && radii[i] !== undefined ? radii[i] : 0.75;
            const aR = baseR * effectiveAtomScale;
            sprite.position.set(x, y + aR + 0.35, z);
            lGroup.add(sprite);
          }
        }
      }
    }

    // Attach clipping planes if slice is active
    const activePlanes = sliceActive ? [clippingPlaneRef.current] : [];
    if (instanced) {
      syncClipping(instanced.material as THREE.Material, activePlanes);
    }
    if (bondsMeshRef.current) {
      syncClipping(bondsMeshRef.current.material as THREE.Material, activePlanes);
    }
    if (surfaceMeshRef.current) {
      syncClipping(surfaceMeshRef.current.material as THREE.Material, activePlanes);
    }
    if (dislocationsGroupRef.current) {
      dislocationsGroupRef.current.children.forEach((c) => {
        if (c instanceof THREE.Line && !Array.isArray(c.material)) syncClipping(c.material, activePlanes);
      });
    }
    if (labelsGroupRef.current) {
      labelsGroupRef.current.children.forEach((c) => {
        if (c instanceof THREE.Sprite) syncClipping(c.material, activePlanes);
      });
    }
    requestRenderRef.current();
  }, [
    frameData,
    selectedTrajId, resetAllCameras,
    hideBulkCrystal,
    showDislocations,
    showSurfaceMesh,
    effectiveShowCellBox,
    effectiveShowBonds,
    effectiveAtomScale,
    showLabels,
    sliceActive, theme, effectiveClampedRange,
  ]);
  /* eslint-enable react-hooks/immutability */

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.background = new THREE.Color(theme === 'dark' ? backgrounds.dark : backgrounds.light);
    requestRenderRef.current();
  }, [theme, backgrounds]);
  useEffect(() => {
    if (!exportRef) return;
    exportRef.current = async format => {
      if (!rendererRef.current || !instancedMeshRef.current) throw new Error('Viewport is not ready.');
      if (format === 'glb' && sliceActive) throw new Error('Apply a Slice modifier before GLB export. The interactive cross-section is a display control.');
      if (format === 'png') renderNowRef.current();
      return exportMdScene(format, rendererRef.current, instancedMeshRef.current, [cellBoxRef.current, dislocationsGroupRef.current, surfaceMeshRef.current, bondsMeshRef.current], frameData?.frame ?? 0);
    };
    return () => { exportRef.current = null; };
  }, [exportRef, frameData, sliceActive]);
  useEffect(() => {
    const element = containerRef.current;
    if (!captureScope || !element || !frameData) return;
    return activeViewports.register({ scope: captureScope, element, capture: async signal => {
      signal.throwIfAborted();
      const renderer = rendererRef.current, atoms = instancedMeshRef.current;
      if (!renderer || !atoms) throw new Error('The trajectory viewport is not ready.');
      const cameras = Object.fromEntries(Object.entries(camerasRef.current ?? {}).map(([id, camera]) => [id, { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), projectionMatrix: camera.projectionMatrix.toArray(), near: camera.near, far: camera.far, zoom: camera.zoom }]));
      renderNowRef.current();
      const blob = await exportMdScene('png', renderer, atoms, [], frameData.frame ?? 0);
      return { blob, metadata: { kind: 'trajectory', camera: cameras, projection: 'orthographic', layout: viewLayout, selection: pickedAtom ? [pickedAtom] : [], periodicImages: { repeats: [1, 1, 1], pbc: frameData.cell.pbc, cell: frameData.cell.matrix }, axes: ['x', 'y', 'z'], units: 'angstrom', energyReference: null, frame: frameData.frame, scientificRunId: captureScope.runId ?? null, slice: { active: sliceActive, axis: sliceAxis, distance: sliceDistance, invert: sliceInvert }, displaySha256: await viewportChecksum(frameData) } };
    } });
  }, [captureScope, frameData, viewLayout, pickedAtom, sliceActive, sliceAxis, sliceDistance, sliceInvert]);
  const frameIds = frameData?.ids;
  useEffect(() => {
    const ids = isMeasureMode ? activeMeasurePoints.map(point => frameIds?.[point.index]).filter((id): id is string => !!id) : activePickedAtom && frameIds?.[activePickedAtom.index] ? [frameIds[activePickedAtom.index]] : [];
    onSelectionChange?.(ids);
    if (!activePickedAtom) {
      if (selectionMarkerRef.current) selectionMarkerRef.current.visible = false;
    } else if (selectionMarkerRef.current) {
      selectionMarkerRef.current.position.set(
        activePickedAtom.position[0],
        activePickedAtom.position[1],
        activePickedAtom.position[2],
      );
      selectionMarkerRef.current.visible = true;
    }
    requestRenderRef.current();
  }, [isMeasureMode, activeMeasurePoints, activePickedAtom, frameIds, onSelectionChange]);

  // Update Slice Plane geometry & material clipping planes in real time
  useEffect(() => {
    const normal = new THREE.Vector3(
      sliceAxis === 'x' ? (sliceInvert ? -1 : 1) : 0,
      sliceAxis === 'y' ? (sliceInvert ? -1 : 1) : 0,
      sliceAxis === 'z' ? (sliceInvert ? -1 : 1) : 0
    );
    const point = new THREE.Vector3(
      sliceAxis === 'x' ? sliceDistance : 0,
      sliceAxis === 'y' ? sliceDistance : 0,
      sliceAxis === 'z' ? sliceDistance : 0
    );
    clippingPlaneRef.current.setFromNormalAndCoplanarPoint(normal, point);

    const planes = sliceActive ? [clippingPlaneRef.current] : [];

    if (instancedMeshRef.current) {
      syncClipping(instancedMeshRef.current.material as THREE.Material, planes);
    }
    if (bondsMeshRef.current) {
      syncClipping(bondsMeshRef.current.material as THREE.Material, planes);
    }
    if (surfaceMeshRef.current) {
      syncClipping(surfaceMeshRef.current.material as THREE.Material, planes);
    }
    if (dislocationsGroupRef.current) {
      dislocationsGroupRef.current.children.forEach((c) => {
        if (c instanceof THREE.Line && !Array.isArray(c.material)) syncClipping(c.material, planes);
      });
    }
    if (labelsGroupRef.current) {
      labelsGroupRef.current.children.forEach((c) => {
        if (c instanceof THREE.Sprite) syncClipping(c.material, planes);
      });
    }

    if (sliceHelperMeshRef.current) {
      if (sliceActive) {
        sliceHelperMeshRef.current.visible = true;
        sliceHelperMeshRef.current.position.set(
          sliceAxis === 'x' ? sliceDistance : 0,
          sliceAxis === 'y' ? sliceDistance : 0,
          sliceAxis === 'z' ? sliceDistance : 0
        );
        if (sliceAxis === 'x') {
          sliceHelperMeshRef.current.rotation.set(0, Math.PI / 2, 0);
        } else if (sliceAxis === 'y') {
          sliceHelperMeshRef.current.rotation.set(Math.PI / 2, 0, 0);
        } else {
          sliceHelperMeshRef.current.rotation.set(0, 0, 0);
        }
        const ext = (cellExtentRef.current || 20) * 2.5;
        sliceHelperMeshRef.current.scale.set(ext, ext, 1);
      } else {
        sliceHelperMeshRef.current.visible = false;
      }
    }
    requestRenderRef.current();
  }, [sliceActive, sliceAxis, sliceDistance, sliceInvert]);

  // Synchronize 3D Measurement Ruler visuals (lines, markers, angle arc)
  useEffect(() => {
    const group = measureGroupRef.current;
    if (!group) return;

    // Clear previous measurement graphics
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      disposeObject(child);
    }

    if (!isMeasureMode || activeMeasurePoints.length === 0) {
      requestRenderRef.current();
      return;
    }

    const targetCount = measureMode === 'atom' ? 1 : measureMode === 'distance' ? 2 : 3;
    const pointsToRender = activeMeasurePoints.slice(0, targetCount);

    // Sphere markers at clicked points
    pointsToRender.forEach((pt, i) => {
      const markerColor = i === 0 ? 0x38bdf8 : i === 1 ? 0x34d399 : 0xfbbf24;
      const atomR = (frameData?.radii?.[pt.index] ?? 1.2) * effectiveAtomScale * 1.25;
      const sGeom = new THREE.SphereGeometry(atomR, 16, 12);
      const sMat = new THREE.MeshBasicMaterial({
        color: markerColor,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
      });
      const sMesh = new THREE.Mesh(sGeom, sMat);
      sMesh.position.set(pt.position[0], pt.position[1], pt.position[2]);
      group.add(sMesh);
    });

    // Distance Line: P1 -> P2
    if (measureMode !== 'atom' && pointsToRender.length >= 2) {
      const p1 = new THREE.Vector3(...pointsToRender[0].position);
      const p2 = new THREE.Vector3(...pointsToRender[1].position);
      const geom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const mat = new THREE.LineDashedMaterial({
        color: 0x38bdf8,
        dashSize: 0.5,
        gapSize: 0.25,
      });
      const line = new THREE.Line(geom, mat);
      line.computeLineDistances();
      group.add(line);
    }

    // Distance Line: P2 -> P3 & Angle Arc (only in angle mode)
    if (measureMode === 'angle' && pointsToRender.length >= 3) {
      const p2 = new THREE.Vector3(...pointsToRender[1].position);
      const p3 = new THREE.Vector3(...pointsToRender[2].position);
      const geom2 = new THREE.BufferGeometry().setFromPoints([p2, p3]);
      const mat2 = new THREE.LineDashedMaterial({
        color: 0xfbbf24,
        dashSize: 0.5,
        gapSize: 0.25,
      });
      const line2 = new THREE.Line(geom2, mat2);
      line2.computeLineDistances();
      group.add(line2);

      // 3D Angle Arc at vertex P2
      const v21 = new THREE.Vector3().subVectors(new THREE.Vector3(...pointsToRender[0].position), p2);
      const v23 = new THREE.Vector3().subVectors(p3, p2);
      const len1 = v21.length();
      const len3 = v23.length();
      if (len1 > 0.01 && len3 > 0.01) {
        const u1 = v21.clone().normalize();
        const u3 = v23.clone().normalize();
        const dot = Math.max(-1, Math.min(1, u1.dot(u3)));
        const theta = Math.acos(dot);
        const normal = new THREE.Vector3().crossVectors(u1, u3);
        if (normal.lengthSq() > 1e-6) {
          normal.normalize();
          const perp = new THREE.Vector3().crossVectors(normal, u1).normalize();
          const arcRadius = Math.min(len1, len3) * 0.4;
          const arcPoints: THREE.Vector3[] = [];
          const numSegments = 24;
          for (let s = 0; s <= numSegments; s++) {
            const angle = (s / numSegments) * theta;
            const pt = p2
              .clone()
              .add(u1.clone().multiplyScalar(arcRadius * Math.cos(angle)))
              .add(perp.clone().multiplyScalar(arcRadius * Math.sin(angle)));
            arcPoints.push(pt);
          }
          const arcGeom = new THREE.BufferGeometry().setFromPoints(arcPoints);
          const arcMat = new THREE.LineBasicMaterial({ color: 0xfde047, linewidth: 2 });
          const arcLine = new THREE.Line(arcGeom, arcMat);
          group.add(arcLine);
        }
      }
    }
    requestRenderRef.current();
  }, [activeMeasurePoints, isMeasureMode, measureMode, frameData, effectiveAtomScale]);

  // Single dynamic navigation gizmo, matching the DFT viewport.
  const renderTripodGizmo = () => {
    return (
      <div className="pointer-events-none w-16 h-16 select-none" aria-label="X, Y, Z orientation">
        <svg viewBox="0 0 64 64" className="w-full h-full overflow-visible">
          {/* Origin central sphere */}
          <circle cx="32" cy="32" r="3.5" fill="#d4d4d8" stroke="#18181b" strokeWidth="1" />

          {/* a Axis (Red #ff3b30) */}
          <line
            x1="32"
            y1="32"
            x2={32 + tripodVectors.x[0]}
            y2={32 + tripodVectors.x[1]}
            stroke="#ff3b30"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle
            cx={32 + tripodVectors.x[0]}
            cy={32 + tripodVectors.x[1]}
            r="2"
            fill="#ff3b30"
          />
          <text
            x={32 + tripodVectors.x[0] * 1.35}
            y={32 + tripodVectors.x[1] * 1.35 + 4}
            fill="#ff3b30"
            fontSize="11"
            fontWeight="bold"
            fontStyle="italic"
            textAnchor="middle"
            fontFamily="var(--font-code, monospace)"
          >
            X
          </text>

          {/* b Axis (Green #32d74b) */}
          <line
            x1="32"
            y1="32"
            x2={32 + tripodVectors.y[0]}
            y2={32 + tripodVectors.y[1]}
            stroke="#32d74b"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle
            cx={32 + tripodVectors.y[0]}
            cy={32 + tripodVectors.y[1]}
            r="2"
            fill="#32d74b"
          />
          <text
            x={32 + tripodVectors.y[0] * 1.35}
            y={32 + tripodVectors.y[1] * 1.35 + 4}
            fill="#32d74b"
            fontSize="11"
            fontWeight="bold"
            fontStyle="italic"
            textAnchor="middle"
            fontFamily="var(--font-code, monospace)"
          >
            Y
          </text>

          {/* c Axis (Blue #0a84ff) */}
          <line
            x1="32"
            y1="32"
            x2={32 + tripodVectors.z[0]}
            y2={32 + tripodVectors.z[1]}
            stroke="#0a84ff"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle
            cx={32 + tripodVectors.z[0]}
            cy={32 + tripodVectors.z[1]}
            r="2"
            fill="#0a84ff"
          />
          <text
            x={32 + tripodVectors.z[0] * 1.35}
            y={32 + tripodVectors.z[1] * 1.35 + 4}
            fill="#0a84ff"
            fontSize="11"
            fontWeight="bold"
            fontStyle="italic"
            textAnchor="middle"
            fontFamily="var(--font-code, monospace)"
          >
            Z
          </text>
        </svg>
      </div>
    );
  };

  // 3D Measurement calculations
  const measureTargetCount = measureMode === 'atom' ? 1 : measureMode === 'distance' ? 2 : 3;

  const measurementResult = useMemo(() => {
    if (measureMode === 'atom') {
      if (activeMeasurePoints.length >= 1) {
        return {
          mode: 'atom' as const,
          point: activeMeasurePoints[0],
        };
      }
      return null;
    }
    if (measureMode === 'distance') {
      if (activeMeasurePoints.length >= 2) {
        const pt1 = activeMeasurePoints[0];
        const pt2 = activeMeasurePoints[1];
        const dx = pt2.position[0] - pt1.position[0];
        const dy = pt2.position[1] - pt1.position[1];
        const dz = pt2.position[2] - pt1.position[2];
        const dist = Math.hypot(dx, dy, dz);
        const delta: [number, number, number] = [Math.abs(dx), Math.abs(dy), Math.abs(dz)];
        return {
          mode: 'distance' as const,
          species: [pt1.element, pt2.element],
          value: dist,
          delta,
        };
      }
      return null;
    }
    if (measureMode === 'angle') {
      if (activeMeasurePoints.length >= 3) {
        const pt1 = activeMeasurePoints[0];
        const pt2 = activeMeasurePoints[1];
        const pt3 = activeMeasurePoints[2];
        const v21 = new THREE.Vector3(
          pt1.position[0] - pt2.position[0],
          pt1.position[1] - pt2.position[1],
          pt1.position[2] - pt2.position[2]
        );
        const v23 = new THREE.Vector3(
          pt3.position[0] - pt2.position[0],
          pt3.position[1] - pt2.position[1],
          pt3.position[2] - pt2.position[2]
        );
        const lenProd = v21.length() * v23.length();
        let angleDeg = 0;
        if (lenProd > 1e-6) {
          const cosTheta = Math.max(-1, Math.min(1, v21.dot(v23) / lenProd));
          angleDeg = (Math.acos(cosTheta) * 180) / Math.PI;
        }
        return {
          mode: 'angle' as const,
          species: [pt1.element, pt2.element, pt3.element],
          value: angleDeg,
        };
      }
      return null;
    }
    return null;
  }, [activeMeasurePoints, measureMode]);

  // Viewport Snapshot Capture (PNG)
  const handleSnapshot = useCallback(async () => {
    if (!rendererRef.current || !instancedMeshRef.current) return;
    try {
      const blob = await exportMdScene(
        'png',
        rendererRef.current,
        instancedMeshRef.current,
        [cellBoxRef.current, dislocationsGroupRef.current, surfaceMeshRef.current, bondsMeshRef.current],
        frameData?.frame ?? 0
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const baseName = (frameData?.attributes?.SourceFile as string) || selectedTrajId || 'trajectory';
      a.download = `${baseName.replace(/\.[^/.]+$/, '')}-frame-${frameData?.frame ?? 0}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to capture snapshot:', err);
    }
  }, [frameData, selectedTrajId]);

  const sliceExtent = Math.ceil(Math.max(1, Math.sqrt([0, 1, 2].reduce((sum, axis) => sum + ((frameData?.cell.matrix[axis]?.slice(0, 3).reduce((total, value) => total + Math.abs(value), 0) ?? 40) / 2) ** 2, 0))));
  const cursorClass = isMeasureMode
    ? 'cursor-crosshair active:cursor-crosshair'
    : 'cursor-grab active:cursor-grabbing';

  return (
    <div
      ref={containerRef}
      className="md-prototype-canvas relative w-full h-full overflow-hidden select-none"
      onPointerDown={e => { dragStart.current = [e.clientX, e.clientY]; }}
    >
      {error && <div role="alert" className="md-analysis-error">{error}<button onClick={() => setError('')} aria-label="Dismiss viewport error"><X size={14} /></button></div>}
      {/* 1. Underlying Canvas Container */}
      <div ref={canvasContainerRef} className="absolute inset-0 pointer-events-none" />
      {/* 2. Single interaction surface by default; MD can expand to four shared-camera views. */}
      <div className={`md-view-overlays z-10 ${viewLayout === 'quad' ? 'is-quad' : 'is-single'}`}>
        {([
          ['top', 'Top'],
          ['front', 'Front'],
          ['left', 'Left'],
          ['main', viewLayout === 'quad' ? 'Isometric' : ''],
        ] as const).map(([viewId, label]) => (
          <div
            key={viewId}
            ref={(node) => { viewportDomRefs.current[viewId] = node; }}
            className={`${viewId === 'main' ? 'is-main ' : ''}${cursorClass}`}
            onClick={(event) => handleQuadrantClick(event, viewId)}
          >
            {label && <span className="md-view-name">{label}</span>}
          </div>
        ))}
      </div>

      {/* 3. Floating Vertical Canvas Toolbar Dock on Left (Phynite-Lab CanvasToolbar) */}
      {hasStructure && (
        <CanvasToolbar
          activeTool={activeTool}
          onSelectTool={(tool) => {
            setActiveTool(tool);
            if (tool === 'measure') {
              setIsMeasureMode(true);
              setPickedAtom(null);
            } else {
              setIsMeasureMode(false);
            }
            if (tool === 'slice') {
              setSliceActive(true);
            }
          }}
          onResetView={() => viewLayout === 'quad' ? resetAllCameras() : resetCamera('main')}
          onSnapshot={handleSnapshot}
          activeViewAngle={activeViewPreset}
          onSelectViewAngle={(angle) => {
            setActiveViewPreset(angle);
            setViewLayout('single');
            selectCameraPreset('main', angle);
          }}
          viewLayout={viewLayout}
          onToggleViewLayout={() => setViewLayout((layout) => layout === 'single' ? 'quad' : 'single')}
          isMeasureActive={isMeasureMode}
          isSliceActive={sliceActive}
          atomScale={effectiveAtomScale}
          onAtomScaleChange={(scale) => setLocalAtomScale(scale)}
          showBonds={effectiveShowBonds}
          onToggleBonds={() => setLocalShowBonds((prev) => !(prev ?? showBonds ?? true))}
          showCellBox={effectiveShowCellBox}
          onToggleCellBox={() => setLocalShowCellBox((prev) => !(prev ?? showCellBox ?? true))}
          showLabels={showLabels}
          onToggleLabels={() => setShowLabels((prev) => !prev)}
        />
      )}

      {/* 3b. Slice Plane / Cross-Section Slicer Control HUD */}
      {hasStructure && (activeTool === 'slice' || sliceActive) && (
        <div className="md-canvas-slice-card workspace-dark-surface absolute top-3 left-16 z-30 flex flex-col gap-2.5 rounded-[9px] border border-[#303030] bg-[#111111]/97 p-3 text-xs shadow-[0_14px_40px_rgba(0,0,0,.34)] backdrop-blur select-none pointer-events-auto w-[320px]">
          <div className="flex items-center justify-between border-b border-[#262626] pb-2">
            <div className="flex items-center gap-2">
              <Scissors className="h-4 w-4 text-[#ededed]" />
              <span className="text-xs font-semibold text-[#ededed]">Cross-Section Slicer</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSliceActive(!sliceActive)}
                className={cn(
                  'text-[10px] font-mono px-2 py-0.5 rounded border transition-colors',
                  sliceActive
                    ? 'bg-[#2e3b59] border-[#384b6f] text-[#9bc2ff]'
                    : 'bg-[#1a1a1a] border-[#303030] text-[#8d8d95] hover:text-[#ededed]'
                )}
              >
                {sliceActive ? 'ACTIVE' : 'MUTED'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTool('select');
                  setSliceActive(false);
                }}
                className="grid h-6 w-6 place-items-center rounded text-[#8d8d95] hover:bg-[#202020] hover:text-[#ededed]"
                title="Close Slice HUD"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-[#8d8d95] mr-1">Axis:</span>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <button
                  key={axis}
                  type="button"
                  onClick={() => setSliceAxis(axis)}
                  className={cn(
                    'w-7 h-6 rounded text-[11px] font-mono uppercase font-semibold transition-colors',
                    sliceAxis === axis
                      ? 'bg-[#2e3b59] text-[#9bc2ff] border border-[#384b6f]'
                      : 'bg-[#1a1a1a] text-[#8d8d95] border border-[#303030] hover:text-[#ededed]'
                  )}
                >
                  {axis}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setSliceInvert(!sliceInvert)}
              className={cn(
                'px-2.5 h-6 rounded text-[11px] font-mono transition-colors border',
                sliceInvert
                  ? 'bg-[#2e3b59] text-[#9bc2ff] border-[#384b6f]'
                  : 'bg-[#1a1a1a] text-[#8d8d95] border-[#303030] hover:text-[#ededed]'
              )}
            >
              ⇄ Invert
            </button>
          </div>

          {/* Distance slider & numeric value */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[11px] font-mono text-[var(--md-muted)]">
              <span>Plane Offset:</span>
              <span className="text-[#9bc2ff] font-semibold">{sliceDistance.toFixed(2)} Å</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-[var(--md-muted)]">
                -{sliceExtent.toFixed(0)}
              </span>
              <LabSlider
                aria-label="Slice plane offset"
                min={-sliceExtent}
                max={sliceExtent}
                step={0.1}
                value={sliceDistance}
                onValueChange={setSliceDistance}
                className="flex-1"
              />
              <span className="text-[10px] font-mono text-[var(--md-muted)]">
                +{sliceExtent.toFixed(0)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 4. One shared navigation gizmo in the DFT Lab position. */}
      {hasStructure && (
        <div className="absolute bottom-5 right-5 pointer-events-none z-20">
          {renderTripodGizmo()}
        </div>
      )}

      {/* 5. Continuous Color Legend Bar with Range Clamping (Bottom-Left next to Toolbar dock) */}
      {hasStructure && frameData?.scalarRange && (
        <div className="md-canvas-legend-card absolute bottom-5 left-16 bg-[var(--md-panel)] border border-[var(--md-border)] p-2.5 rounded-[6px] text-xs z-20 flex flex-col gap-2 w-60 pointer-events-auto select-none">
          <div className="flex items-center justify-between text-[11px] font-medium">
            <span className="truncate max-w-[130px] font-semibold text-[var(--md-text)]">
              {frameData.scalarRange.property}
            </span>
            <span className="text-[10px] text-[var(--md-muted)] font-mono capitalize">
              {frameData.scalarRange.colormap || 'viridis'}
            </span>
          </div>

          {/* Quick Clamping Actions: Auto & 2%-98% */}
          <div className="flex items-center justify-between gap-1 text-[10px] font-mono">
            <span className="text-[var(--md-muted)]">Range:</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setClampedRange(null)}
                className={`px-1.5 py-0.5 rounded border transition-colors ${
                  !effectiveClampedRange
                    ? 'bg-[var(--md-hover)] border-[#384b6f] text-[#9bc2ff]'
                    : 'bg-[var(--md-raised)] border-[var(--md-border)] text-[var(--md-muted)] hover:text-[var(--md-text)]'
                }`}
                title="Reset to Full Dataset Min/Max"
              >
                Auto
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!frameData.scalarValues || frameData.scalarValues.length === 0) return;
                  const sorted = frameData.scalarValues.filter(Number.isFinite).sort((a, b) => a - b);
                  if (!sorted.length) return;
                  const p2 = sorted[Math.floor(sorted.length * 0.02)];
                  const p98 = sorted[Math.floor(sorted.length * 0.98)];
                  setClampedRange({
                    min: p2,
                    max: p98,
                    property: frameData.scalarRange!.property,
                  });
                }}
                className={`px-1.5 py-0.5 rounded border transition-colors ${
                  effectiveClampedRange
                    ? 'bg-[var(--md-hover)] border-[#384b6f] text-[#9bc2ff]'
                    : 'bg-[var(--md-raised)] border-[var(--md-border)] text-[var(--md-muted)] hover:text-[var(--md-text)]'
                }`}
                title="Clamp Outliers to 2% - 98% Percentiles"
              >
                2%-98%
              </button>
            </div>
          </div>

          {/* Gradient bar preview */}
          <div
            className="h-2 w-full rounded-sm border border-[var(--md-border)] shadow-inner"
            style={{
              background: colormapGradient(frameData.scalarRange.colormap || 'viridis'),
            }}
          />

          {/* Min and Max input limits */}
          <div className="flex items-center justify-between text-[10px] font-mono gap-2">
            <div className="flex items-center gap-1">
              <span className="text-[var(--md-muted)]">min</span>
              <input
                aria-label="Color range minimum" type="number"
                step="any"
                value={effectiveClampedRange ? effectiveClampedRange.min : Number(frameData.scalarRange.min.toFixed(3))}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    setClampedRange({
                      min: Math.min(val, effectiveClampedRange ? effectiveClampedRange.max : frameData.scalarRange!.max),
                      max: effectiveClampedRange ? effectiveClampedRange.max : frameData.scalarRange!.max,
                      property: frameData.scalarRange!.property,
                    });
                  }
                }}
                className="w-16 bg-[var(--md-raised)] border border-[var(--md-border)] rounded px-1 py-0.5 text-[10px] font-mono text-[var(--md-text)] text-right focus:outline-none focus:border-[var(--field-focus-border)]"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[var(--md-muted)]">max</span>
              <input
                aria-label="Color range maximum" type="number"
                step="any"
                value={effectiveClampedRange ? effectiveClampedRange.max : Number(frameData.scalarRange.max.toFixed(3))}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    setClampedRange({
                      min: effectiveClampedRange ? effectiveClampedRange.min : frameData.scalarRange!.min,
                      max: Math.max(val, effectiveClampedRange ? effectiveClampedRange.min : frameData.scalarRange!.min),
                      property: frameData.scalarRange!.property,
                    });
                  }
                }}
                className="w-16 bg-[var(--md-raised)] border border-[var(--md-border)] rounded px-1 py-0.5 text-[10px] font-mono text-[var(--md-text)] text-right focus:outline-none focus:border-[var(--field-focus-border)]"
              />
            </div>
          </div>
        </div>
      )}


      {/* 7. Interactive Draggable 3D Measurement HUD */}
      <AnimatePresence>
        {hasStructure && isMeasureMode && (
          <motion.div
            drag
            dragListener={false}
            dragControls={measureDragControls}
            dragConstraints={containerRef}
            dragMomentum={false}
            dragElastic={0.05}
            initial={{ opacity: 0, x: -5, y: -2, scale: 0.99 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: -4, scale: 0.99 }}
            transition={{ duration: 0.13, ease: 'easeOut' }}
            className="md-canvas-measure-card workspace-dark-surface absolute left-16 top-3 w-[360px] max-w-[calc(100%-80px)] overflow-hidden rounded-[6px] border border-[#303030] bg-[#111111]/97 shadow-[0_14px_40px_rgba(0,0,0,.34)] backdrop-blur z-30 pointer-events-auto select-none"
          >
            {/* Draggable Title Header */}
            <div
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('button, a, input')) return;
                measureDragControls.start(e);
              }}
              className="flex h-10 cursor-grab active:cursor-grabbing items-center gap-2 border-b border-[#2d2d2d] px-3 select-none"
            >
              <Ruler className="h-3.5 w-3.5 text-[#ededed]" />
              <span className="text-[12px] font-medium text-[#ededed]">Measure</span>
              <span className="ml-auto text-[10.5px] tabular-nums text-[#8d8d95]">
                {activeMeasurePoints.length}/{measureTargetCount}
              </span>
              <button
                type="button"
                aria-label="Close measure"
                onClick={() => {
                  setIsMeasureMode(false);
                  setActiveTool('select');
                  setMeasurePoints([]);
                }}
                className="grid h-6 w-6 place-items-center rounded-[5px] text-[#85858d] hover:bg-[#242424] hover:text-[#ededed]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="p-3">
              {/* Segmented Mode Selector: [ Atom | Distance | Angle ] */}
              <div className="grid grid-cols-3 gap-1 rounded-[7px] bg-[#0d0d0d] p-1">
                {(['atom', 'distance', 'angle'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={measureMode === mode}
                    onClick={() => {
                      setMeasureMode(mode);
                      setMeasurePoints([]);
                    }}
                    className={cn(
                      'h-7 rounded-[5px] text-[11px] font-medium capitalize text-[#85858d] transition-colors hover:bg-[#1b1b1b] hover:text-[#d4d4d8]',
                      measureMode === mode && 'bg-[#242424] text-[#ededed]'
                    )}
                  >
                    {mode === 'atom' ? 'Atom' : mode}
                  </button>
                ))}
              </div>

              {/* Status and Measurement Content Box */}
              <div className="mt-3 rounded-[7px] border border-[#303030] bg-[#151515] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#8e8e93]">
                    {measureMode === 'atom' ? 'Atom info' : measureMode === 'angle' ? 'Angle' : 'Distance'}
                  </p>
                </div>

                <AnimatePresence mode="wait">
                  {/* Distance or Angle Result */}
                  {measurementResult && measurementResult.mode !== 'atom' ? (
                    <motion.div
                      key={`${measurementResult.mode}-${measurementResult.value}`}
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -2 }}
                      transition={{ duration: 0.12 }}
                      className="mt-2 rounded-[6px] border border-[#303030] bg-[#111111] p-2.5"
                    >
                      <div className="flex items-end justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block text-[10px] font-semibold uppercase tracking-[.08em] text-[#8e8e93]">Atoms</span>
                          <span className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden">
                            {measurementResult.species.map((species, index) => (
                              <span key={`${species}-${index}`} className="contents">
                                <span className="shrink-0 font-mono text-[11px] font-medium text-[#ededed]">
                                  {index + 1} · {species}
                                </span>
                                {index < measurementResult.species.length - 1 && (
                                  <span className="text-[10px] text-[#71717a]">—</span>
                                )}
                              </span>
                            ))}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[10px] font-semibold uppercase tracking-[.08em] text-[#8e8e93]">
                            {measurementResult.mode === 'distance' ? 'Distance' : 'Angle'}
                          </span>
                          <span className="mt-0.5 block font-mono text-[18px] font-semibold tabular-nums text-[#ededed]">
                            {measurementResult.value?.toFixed(3)}
                            <span className="ml-1 text-[11px] text-[#a1a1aa]">
                              {measurementResult.mode === 'distance' ? 'Å' : '°'}
                            </span>
                          </span>
                        </span>
                      </div>
                      {measurementResult.mode === 'angle' && (
                        <div className="mt-2 border-t border-[#262626] pt-1.5 text-[10px] text-[#8e8e93]">
                          Vertex · <span className="font-mono text-[#ededed]">2 · {measurementResult.species[1]}</span>
                        </div>
                      )}
                    </motion.div>
                  ) : (!measurementResult && measureMode !== 'atom') || (measureMode === 'atom' && activeMeasurePoints.length === 0) ? (
                    <motion.div
                      key={`${measureMode}-${activeMeasurePoints.length}`}
                      initial={{ opacity: 0, y: 2 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -2 }}
                      transition={{ duration: 0.1 }}
                    >
                      <p className="mt-2 text-[11px] text-[#a1a1aa]">
                        Select atom {Math.min(activeMeasurePoints.length + 1, measureTargetCount)} of {measureTargetCount}
                      </p>
                      {activeMeasurePoints.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {activeMeasurePoints.map((pt, index) => (
                            <span key={`${pt.index}-${index}`} className="rounded bg-[#1a1a1a] px-1.5 py-0.5 font-mono text-[10px] text-[#d4d4d8] border border-[#2a2a2a]">
                              {index + 1} · {pt.element}
                            </span>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                {/* Atom Mode Result: Dual Fractional & Cartesian Table */}
                {measureMode === 'atom' && activeMeasurePoints[0] && (() => {
                  const pt = activeMeasurePoints[0];
                  const idMatch = pt.idLabel?.match(/(?:imported-atom-)?(\d+)/i);
                  const atomName = idMatch ? `${pt.element}${idMatch[1]}` : (pt.idLabel?.replace(/^#/, '') || pt.element);
                  return (
                    <div className="mt-2 overflow-hidden rounded-[6px] border border-[#303030] bg-[#111111]">
                      <div className="flex h-8 items-center justify-between border-b border-[#2a2a2a] px-2.5">
                        <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#8e8e93]">Atom information</span>
                        <span className="font-mono text-[12px] font-semibold text-[#ededed]">{atomName}</span>
                      </div>
                      <div className="flex items-center justify-between border-b border-[#242424] px-2.5 py-1.5">
                        <span className="text-[11px] text-[#8e8e93]">Element</span>
                        <span className="font-mono text-[11px] font-medium text-[#ededed]">{pt.element}</span>
                      </div>
                      <div className="px-2.5 py-2">
                        <div className="grid grid-cols-[68px_repeat(3,minmax(0,1fr))] items-center gap-x-2 font-mono text-[10.5px] tabular-nums">
                          <span /><span className="text-right font-sans text-[10px] font-semibold text-[#8e8e93]">X</span><span className="text-right font-sans text-[10px] font-semibold text-[#8e8e93]">Y</span><span className="text-right font-sans text-[10px] font-semibold text-[#8e8e93]">Z</span>
                          <span className="font-sans text-[10px] text-[#8e8e93]">Fractional</span>
                          {pt.fractional.map((val, i) => (
                            <span key={`frac-${i}`} className="text-right text-[#c7c7cc]">{val.toFixed(4)}</span>
                          ))}
                          <span className="font-sans text-[10px] text-[#8e8e93]">Cartesian</span>
                          {pt.position.map((val, i) => (
                            <span key={`cart-${i}`} className="text-right text-[#c7c7cc]">{val.toFixed(3)}</span>
                          ))}
                        </div>
                      </div>
                      <div className="border-t border-[#242424] px-2.5 py-1.5 text-right font-mono text-[9px] text-[#71717a]">
                        Fractional · crystal&nbsp;&nbsp; Cartesian · Å
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Bottom Clear Button */}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setMeasurePoints([])}
                  className="h-7 rounded-[5px] border border-[#343434] px-3 text-[10.5px] font-medium text-[#a1a1aa] hover:bg-[#202020] hover:text-[#ededed]"
                >
                  Clear
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
