/* eslint-disable react-hooks/immutability -- Three.js camera and controls are imperative scene objects updated inside the render loop. */
'use client';

import {
  Detailed,
  GizmoHelper,
  Html,
  Line,
  OrbitControls,
  TransformControls,
  useGizmoContext,
} from '@react-three/drei';
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { CustomAtom, LatticeParameters } from '@/components/CrystalViewer';
import {
  appearanceFor,
  atomInstanceId,
  buildCrystalRenderModel,
  crystalRenderBounds,
  type CrystalDisplayStyle,
  type CrystalPoint,
  type EditorAtom,
} from '@/lib/crystal-render-model';
import {
  LAB_CAMERA,
  LAB_VIEWPORT,
  applyLabViewPreset,
  resizeLabCameraViewport,
  updateLabCameraClipping,
  type LabCameraBounds,
  type LabVectorTuple,
} from '@/lib/lab-camera';
import { cellVectorsFromLattice } from '@/lib/structure-parsers';
import { CrystalSceneExport, type CrystalSceneExporter } from './CrystalSceneExport';
import { useResearchShell } from './ResearchShellContext';

type Point = CrystalPoint;
export type { CrystalDisplayStyle } from '@/lib/crystal-render-model';
export type CameraViewRequest = {
  id: number;
  direction: LabVectorTuple;
  up: LabVectorTuple;
};

function Bond({ start, end, radius }: { start: Point; end: Point; radius: number }) {
  const geometry = useMemo(() => {
    const from = new THREE.Vector3(...start);
    const to = new THREE.Vector3(...end);
    const direction = to.clone().sub(from);
    return {
      position: from.clone().add(to).multiplyScalar(0.5),
      length: direction.length(),
      quaternion: new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize(),
      ),
    };
  }, [start, end]);

  return (
    <mesh position={geometry.position} quaternion={geometry.quaternion}>
      <cylinderGeometry args={[radius, radius, geometry.length, 12]} />
      <meshStandardMaterial color="#aab3bc" roughness={0.58} metalness={0.03} />
    </mesh>
  );
}

function Atom({
  atom,
  selected,
  deleteMode,
  measureAnchor,
  directSelect,
  transformTarget,
  displayStyle,
  showLabel,
  color,
  onSelect,
  onTransformTarget,
}: {
  atom: EditorAtom;
  selected: boolean;
  deleteMode: boolean;
  measureAnchor: boolean;
  directSelect: boolean;
  transformTarget: boolean;
  displayStyle: CrystalDisplayStyle;
  showLabel: boolean;
  color?: string;
  onSelect: (id: string, instanceId: string) => void;
  onTransformTarget: (object: THREE.Group | null) => void;
}) {
  const select = (event: ThreeEvent<Event>) => {
    if (event.nativeEvent instanceof MouseEvent && (event.nativeEvent.ctrlKey || event.nativeEvent.metaKey)) {
      return;
    }
    event.stopPropagation();
    onSelect(atom.id, atom.instanceId);
  };
  const appearance = { ...appearanceFor(atom.species), ...(color ? { color } : {}) };

  return (
    <group ref={transformTarget ? onTransformTarget : undefined} position={atom.position}>
      <Detailed distances={[0, 5, 12]}>
        <mesh onPointerDown={directSelect ? select : undefined} onClick={directSelect ? undefined : select}>
          <sphereGeometry args={[atom.radius, 40, 40]} />
          <meshStandardMaterial color={appearance.color} roughness={displayStyle === 'wireframe' ? 0.7 : LAB_VIEWPORT.atomMaterial.roughness} metalness={LAB_VIEWPORT.atomMaterial.metalness} />
        </mesh>
        <mesh onPointerDown={directSelect ? select : undefined} onClick={directSelect ? undefined : select}>
          <sphereGeometry args={[atom.radius, 24, 24]} />
          <meshStandardMaterial color={appearance.color} roughness={LAB_VIEWPORT.atomMaterial.roughness} metalness={LAB_VIEWPORT.atomMaterial.metalness} />
        </mesh>
        <mesh onPointerDown={directSelect ? select : undefined} onClick={directSelect ? undefined : select}>
          <sphereGeometry args={[atom.radius, 12, 12]} />
          <meshStandardMaterial color={appearance.color} roughness={LAB_VIEWPORT.atomMaterial.roughness} metalness={LAB_VIEWPORT.atomMaterial.metalness} />
        </mesh>
      </Detailed>
      {(selected || measureAnchor) && (
        <mesh scale={LAB_VIEWPORT.selection.scale}>
          <sphereGeometry args={[atom.radius, 26, 26]} />
          <meshBasicMaterial color={deleteMode ? '#e5484d' : LAB_VIEWPORT.selection.color} wireframe transparent opacity={LAB_VIEWPORT.selection.opacity} toneMapped={false} />
        </mesh>
      )}
      {showLabel && <Html center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}><span className="rounded-[4px] border border-[#404040] bg-[#171717]/92 px-1 py-0.5 font-mono text-[10px] font-semibold leading-none text-[#f4f4f5] shadow-sm">{atom.species}</span></Html>}
    </group>
  );
}

function ForceArrow({ origin, force, scale }: { origin: Point; force: Point; scale: number }) {
  const geometry = useMemo(() => {
    const start = new THREE.Vector3(...origin);
    const vector = new THREE.Vector3(...force);
    const magnitude = vector.length();
    if (magnitude < 1e-10) return null;
    const length = Math.min(1.8, Math.max(0.28, magnitude * scale));
    const direction = vector.normalize();
    const end = start.clone().add(direction.clone().multiplyScalar(length));
    const shaftEnd = end.clone().add(direction.clone().multiplyScalar(-0.16));
    return { start: start.toArray() as Point, end: end.toArray() as Point, shaftEnd: shaftEnd.toArray() as Point, direction };
  }, [force, origin, scale]);
  if (!geometry) return null;
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), geometry.direction);
  return <group><Line points={[geometry.start, geometry.shaftEnd]} color="#d4575d" lineWidth={2} /><mesh position={geometry.end} quaternion={quaternion}><coneGeometry args={[0.085, 0.18, 12]} /><meshBasicMaterial color="#d4575d" toneMapped={false} /></mesh></group>;
}

function CameraRig({
  controls,
  selectedPosition,
  focusRequest,
  viewRequest,
  fitKey,
  cameraStorageKey,
  bounds,
}: {
  controls: React.RefObject<OrbitControlsImpl | null>;
  selectedPosition?: Point;
  focusRequest: number;
  viewRequest?: CameraViewRequest | null;
  fitKey: string;
  cameraStorageKey?: string;
  bounds: LabCameraBounds;
}) {
  const { camera, invalidate, size } = useThree();
  const desiredPosition = useRef(new THREE.Vector3());
  const desiredTarget = useRef(new THREE.Vector3());
  const desiredZoom = useRef<number | null>(null);
  const focusing = useRef(false);
  const fittedKey = useRef<string | null>(null);

  useEffect(() => {
    const activeControls = controls.current;
    if (!activeControls) return;
    updateLabCameraClipping(camera, bounds);
    if (fittedKey.current === fitKey) {
      camera.updateProjectionMatrix();
      invalidate();
      return;
    }
    const aspect = size.width / Math.max(size.height, 1);
    activeControls.target.copy(bounds.center);
    applyLabViewPreset(camera, bounds, aspect, 'isometric');
    if (cameraStorageKey) try {
      const saved = JSON.parse(localStorage.getItem(cameraStorageKey) ?? 'null');
      if (saved && [saved.position, saved.up, saved.target].every(value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)) && Number.isFinite(saved.zoom) && saved.zoom > 0) {
        camera.position.fromArray(saved.position); camera.up.fromArray(saved.up); activeControls.target.fromArray(saved.target);
        if (camera instanceof THREE.OrthographicCamera) camera.zoom = saved.zoom;
        camera.updateProjectionMatrix();
      }
    } catch { /* Device camera state never alters scientific input. */ }
    activeControls.update();
    fittedKey.current = fitKey;
    focusing.current = false;
    desiredZoom.current = null;
    invalidate();
  }, [bounds, camera, controls, fitKey, cameraStorageKey, invalidate, size.height, size.width]);

  useEffect(() => {
    const activeControls = controls.current;
    if (!cameraStorageKey || !activeControls) return;
    const save = () => { try { localStorage.setItem(cameraStorageKey, JSON.stringify({ position: camera.position.toArray(), up: camera.up.toArray(), target: activeControls.target.toArray(), zoom: camera instanceof THREE.OrthographicCamera ? camera.zoom : 1 })); } catch {} };
    activeControls.addEventListener('end', save);
    return () => { save(); activeControls.removeEventListener('end', save); };
  }, [camera, cameraStorageKey, controls]);

  useEffect(() => {
    const activeControls = controls.current;
    if (!activeControls || fittedKey.current === null) return;
    resizeLabCameraViewport(camera, size.width / Math.max(size.height, 1), activeControls.target);
    activeControls.update();
    invalidate();
  }, [camera, controls, invalidate, size.height, size.width]);

  useEffect(() => {
    if (!focusRequest || !selectedPosition || !controls.current) return;
    const target = new THREE.Vector3(...selectedPosition);
    const distance = Math.max(8, camera.position.distanceTo(controls.current.target));
    const offset = camera.position.clone().sub(controls.current.target).normalize().multiplyScalar(distance);
    desiredTarget.current.copy(target);
    desiredPosition.current.copy(target).add(offset);
    desiredZoom.current = camera instanceof THREE.OrthographicCamera ? Math.max(camera.zoom, 1.75) : null;
    focusing.current = true;
    invalidate();
  }, [camera, controls, focusRequest, invalidate, selectedPosition]);

  useEffect(() => {
    if (!viewRequest || !controls.current) return;
    const target = controls.current.target.clone();
    const distance = Math.max(5.5, camera.position.distanceTo(controls.current.target));
    camera.up.set(...viewRequest.up).normalize();
    desiredTarget.current.copy(target);
    desiredPosition.current.copy(target).add(new THREE.Vector3(...viewRequest.direction).normalize().multiplyScalar(distance));
    desiredZoom.current = null;
    focusing.current = true;
    invalidate();
  }, [camera, controls, invalidate, viewRequest]);

  useFrame((_, delta) => {
    const activeControls = controls.current;
    if (!activeControls) return;
    const previousNear = camera.near;
    const previousFar = camera.far;
    updateLabCameraClipping(camera, bounds);
    if (Math.abs(camera.near - previousNear) > 0.0005 || Math.abs(camera.far - previousFar) > 1) {
      camera.updateProjectionMatrix();
    }
    if (focusing.current) {
      const t = 1 - Math.exp(-delta * 8);
      camera.position.lerp(desiredPosition.current, t);
      activeControls.target.lerp(desiredTarget.current, t);
      if (camera instanceof THREE.OrthographicCamera && desiredZoom.current !== null) {
        camera.zoom = THREE.MathUtils.lerp(camera.zoom, desiredZoom.current, t);
        camera.updateProjectionMatrix();
      }
      const zoomReady = !(camera instanceof THREE.OrthographicCamera)
        || desiredZoom.current === null
        || Math.abs(camera.zoom - desiredZoom.current) < 0.08;
      if (
        camera.position.distanceTo(desiredPosition.current) < 0.008 &&
        activeControls.target.distanceTo(desiredTarget.current) < 0.008 &&
        zoomReady
      ) {
        focusing.current = false;
        desiredZoom.current = null;
      }
      activeControls.update();
    }
  });

  return null;
}

function AxisArrow({ direction, color, label }: { direction: Point; color: string; label: 'a' | 'b' | 'c' }) {
  const { tweenCamera } = useGizmoContext();
  const vector = useMemo(() => new THREE.Vector3(...direction).normalize(), [direction]);
  const quaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector), [vector]);
  const labelTexture = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = color;
    context.font = 'italic 600 38px "Geist Mono", var(--font-code), ui-monospace, SFMono-Regular, Menlo, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, 32, 32);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, [color, label]);
  useEffect(() => () => labelTexture?.dispose(), [labelTexture]);
  return (
    <group onClick={(event) => { event.stopPropagation(); tweenCamera(vector); }}>
      <mesh position={vector.clone().multiplyScalar(0.38)} quaternion={quaternion}>
        <cylinderGeometry args={[0.035, 0.035, 0.68, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={vector.clone().multiplyScalar(0.82)} quaternion={quaternion}>
        <coneGeometry args={[0.12, 0.25, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {labelTexture && <sprite position={vector.clone().multiplyScalar(1.05)} scale={[0.3, 0.3, 0.3]}>
        <spriteMaterial map={labelTexture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
      </sprite>}
    </group>
  );
}

function ArrowNavigationGizmo({ lattice }: { lattice: LatticeParameters }) {
  const [aDirection, bDirection, cDirection] = useMemo(() => cellVectorsFromLattice(lattice).map((vector) => {
    const direction = new THREE.Vector3(...vector);
    return (direction.lengthSq() > 1e-12 ? direction.normalize() : new THREE.Vector3(0, 0, 1)).toArray() as Point;
  }) as [Point, Point, Point], [lattice]);

  return (
    <group scale={54}>
      <mesh><sphereGeometry args={[0.09, 16, 16]} /><meshBasicMaterial color="#d4d4d8" toneMapped={false} /></mesh>
      <AxisArrow direction={aDirection} color="#ff3b30" label="a" />
      <AxisArrow direction={bDirection} color="#32d74b" label="b" />
      <AxisArrow direction={cDirection} color="#0a84ff" label="c" />
    </group>
  );
}

export function CrystalEditorViewport({
  atoms,
  lattice,
  supercell,
  selectedAtomId,
  onSelectAtom,
  focusRequest,
  atomScale = 1,
  bondScale = 1,
  bondCutoff = 0,
  showBonds = true,
  showCell = true,
  showLabels = false,
  showForces = false,
  forceScale = 2.5,
  displayStyle = 'ball-stick',
  objectRotation = [0, 0, 0],
  activeTool = 'select',
  moveSpace = 'world',
  moveConstraint = 'free',
  moveSnap = null,
  measurementInstanceIds,
  showNavigationGizmo = true,
  theme = 'dark',
  onMoveAtom,
  onRotateObject,
  onTransformStart,
  onEmptyClick,
  viewRequest,
  atomColors,
  exportRef,
  fitKey,
  cameraStorageKey,
}: {
  atoms: CustomAtom[];
  lattice: LatticeParameters;
  supercell: [number, number, number];
  selectedAtomId: string | null;
  onSelectAtom: (id: string | null, instanceId?: string) => void;
  focusRequest: number;
  atomScale?: number;
  bondScale?: number;
  bondCutoff?: number;
  showBonds?: boolean;
  showCell?: boolean;
  showLabels?: boolean;
  showForces?: boolean;
  forceScale?: number;
  displayStyle?: CrystalDisplayStyle;
  objectRotation?: [number, number, number];
  activeTool?: 'select' | 'move' | 'rotate' | 'measure' | 'add' | 'delete';
  moveSpace?: 'world' | 'local';
  moveConstraint?: 'free' | 'x' | 'y' | 'z' | 'xy' | 'xz' | 'yz';
  moveSnap?: number | null;
  measurementInstanceIds?: string[];
  showNavigationGizmo?: boolean;
  theme?: 'dark' | 'light';
  onMoveAtom?: (id: string, fractional: Point) => void;
  onRotateObject?: (rotation: [number, number, number]) => void;
  onTransformStart?: () => void;
  onEmptyClick?: () => void;
  viewRequest?: CameraViewRequest | null;
  atomColors?: Map<string, string>;
  exportRef?: React.RefObject<CrystalSceneExporter | null>;
  fitKey: string;
  cameraStorageKey?: string;
}) {
  const lightTheme = theme === 'light';
  const backgrounds = useResearchShell() ? LAB_VIEWPORT.researchBackground : LAB_VIEWPORT.background;
  const canvasBackground = lightTheme ? backgrounds.light : backgrounds.dark;
  const cellColor = lightTheme ? LAB_VIEWPORT.cell.light : LAB_VIEWPORT.cell.dark;
  const wireColor = lightTheme ? '#606a74' : '#7f8993';
  const measurementColor = lightTheme ? '#18181b' : '#f4f4f5';
  const controls = useRef<OrbitControlsImpl>(null);
  const dragging = useRef(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    selectedAtomId ? atomInstanceId(selectedAtomId, [0, 0, 0]) : null,
  );
  const [selectedAtomObject, setSelectedAtomObject] = useState<THREE.Group | null>(null);
  const [crystalObject, setCrystalObject] = useState<THREE.Group | null>(null);
  const model = useMemo(
    () => buildCrystalRenderModel(atoms, lattice, supercell, atomScale, bondCutoff, displayStyle),
    [atoms, atomScale, bondCutoff, displayStyle, lattice, supercell],
  );
  const crystalQuaternion = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(
    ...objectRotation.map((value) => THREE.MathUtils.degToRad(value)) as [number, number, number],
  )), [objectRotation]);
  const cameraBounds = useMemo(() => crystalRenderBounds(model, crystalQuaternion), [crystalQuaternion, model]);
  const effectiveSelectedInstanceId = selectedAtomId && model.atoms.some((atom) => atom.id === selectedAtomId && atom.instanceId === selectedInstanceId)
    ? selectedInstanceId
    : model.atoms.find((atom) => atom.id === selectedAtomId)?.instanceId ?? null;
  const selectedEditorAtom = model.atoms.find((atom) => atom.instanceId === effectiveSelectedInstanceId);
  const selectedLocalPosition = selectedEditorAtom?.position;
  const measurementPoints = (measurementInstanceIds ?? [])
    .map((instanceId) => model.atoms.find((atom) => atom.instanceId === instanceId)?.position)
    .filter(Boolean) as Point[];
  const selectedPosition = useMemo(() => selectedLocalPosition
    ? new THREE.Vector3(...selectedLocalPosition).applyQuaternion(crystalQuaternion).toArray() as Point
    : undefined, [crystalQuaternion, selectedLocalPosition]);
  const visibleMoveAxes = useMemo(() => ({
    x: moveConstraint === 'free' || moveConstraint.includes('x'),
    y: moveConstraint === 'free' || moveConstraint.includes('y'),
    z: moveConstraint === 'free' || moveConstraint.includes('z'),
  }), [moveConstraint]);

  const registerSelectedAtom = useCallback((object: THREE.Group | null) => {
    setSelectedAtomObject((current) => current === object ? current : object);
  }, []);

  const registerCrystal = useCallback((object: THREE.Group | null) => {
    setCrystalObject((current) => current === object ? current : object);
  }, []);

  const selectAtom = useCallback((id: string, instanceId: string) => {
    setSelectedInstanceId(instanceId);
    onSelectAtom(id, instanceId);
  }, [onSelectAtom]);

  const clearSelection = useCallback(() => {
    setSelectedInstanceId(null);
    onSelectAtom(null);
  }, [onSelectAtom]);

  const crystal = (
    <group ref={registerCrystal} rotation={objectRotation.map((value) => THREE.MathUtils.degToRad(value)) as [number, number, number]}>
      {showCell && model.edges.map(([start, end], index) => (
        <Line key={`cell-${index}`} points={[start, end]} color={cellColor} lineWidth={0.8} transparent opacity={lightTheme ? LAB_VIEWPORT.cell.lightOpacity : LAB_VIEWPORT.cell.darkOpacity} />
      ))}
      {showBonds && displayStyle !== 'spacefill' && model.bonds.map(([start, end], index) => displayStyle === 'wireframe'
        ? <Line key={`bond-${index}`} points={[start, end]} color={wireColor} lineWidth={1.1} transparent opacity={0.78} />
        : <Bond key={`bond-${index}`} start={start} end={end} radius={0.034 * bondScale} />)}
      {showForces && model.atoms.map((atom) => atom.force && <ForceArrow key={`force-${atom.instanceId}`} origin={atom.position} force={atom.force} scale={forceScale} />)}
      {measurementPoints.length >= 2 && <Line points={measurementPoints} color={measurementColor} lineWidth={2} dashed dashSize={0.12} gapSize={0.07} transparent opacity={0.95} />}
      {model.atoms.map((atom) => (
        <Atom
          key={atom.instanceId}
          atom={atom}
          color={atomColors?.get(atom.id)}
          selected={atom.instanceId === effectiveSelectedInstanceId}
          deleteMode={activeTool === 'delete'}
          measureAnchor={(measurementInstanceIds ?? []).includes(atom.instanceId)}
          directSelect={activeTool === 'measure' || activeTool === 'delete'}
          transformTarget={atom.instanceId === effectiveSelectedInstanceId}
          displayStyle={displayStyle}
          showLabel={showLabels && model.atoms.length <= 160}
          onSelect={selectAtom}
          onTransformTarget={registerSelectedAtom}
        />
      ))}
    </group>
  );

  return (
    <Canvas
      // Defer measured-size commits beyond ResizeObserver delivery while split panes resize.
      resize={{ debounce: { resize: 16, scroll: 50 } }}
      orthographic
      frameloop="demand"
      camera={{ position: [0.528, -0.727, 0.438], up: [0, 0, 1], zoom: 1, near: 0.01, far: 2000 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      onPointerMissed={(event) => {
        if (event instanceof MouseEvent && (event.ctrlKey || event.metaKey)) return;
        if (activeTool === 'add') {
          onEmptyClick?.();
        } else {
          clearSelection();
        }
      }}
      style={{ background: canvasBackground, cursor: activeTool === 'measure' || activeTool === 'delete' ? 'crosshair' : 'default' }}
    >
      <color attach="background" args={[canvasBackground]} />
      <ambientLight intensity={LAB_VIEWPORT.ambientLight} />
      <directionalLight position={LAB_VIEWPORT.keyLight.position} intensity={LAB_VIEWPORT.keyLight.intensity} color={LAB_VIEWPORT.keyLight.color} />
      <directionalLight position={LAB_VIEWPORT.fillLight.position} intensity={LAB_VIEWPORT.fillLight.intensity} color={LAB_VIEWPORT.fillLight.color} />

      {crystal}
      <CrystalSceneExport exportRef={exportRef} model={model} colors={atomColors} showBonds={showBonds} showCell={showCell} bondScale={bondScale} displayStyle={displayStyle} rotation={objectRotation} />

      {activeTool === 'rotate' && crystalObject && (
        <TransformControls
          object={crystalObject}
          mode="rotate"
          space="world"
          size={0.8}
          onMouseDown={() => { dragging.current = true; onTransformStart?.(); }}
          onMouseUp={() => {
            dragging.current = false;
            const rotation = crystalObject.rotation;
            if (rotation) onRotateObject?.([
              THREE.MathUtils.radToDeg(rotation.x),
              THREE.MathUtils.radToDeg(rotation.y),
              THREE.MathUtils.radToDeg(rotation.z),
            ]);
          }}
        />
      )}

      {activeTool === 'move' && selectedAtomId && selectedEditorAtom && selectedAtomObject && (
        <TransformControls
          object={selectedAtomObject}
          mode="translate"
          space={moveSpace}
          size={0.72}
          translationSnap={moveSnap ?? undefined}
          showX={visibleMoveAxes.x}
          showY={visibleMoveAxes.y}
          showZ={visibleMoveAxes.z}
          onMouseDown={() => { dragging.current = true; onTransformStart?.(); }}
          onMouseUp={() => {
            dragging.current = false;
            const fractional = model.worldToFractional(selectedAtomObject.position.clone());
            onMoveAtom?.(selectedAtomId, [
              fractional[0] - selectedEditorAtom.cellOffset[0],
              fractional[1] - selectedEditorAtom.cellOffset[1],
              fractional[2] - selectedEditorAtom.cellOffset[2],
            ]);
          }}
        />
      )}

      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={LAB_CAMERA.dampingFactor}
        rotateSpeed={LAB_CAMERA.rotateSpeed}
        panSpeed={LAB_CAMERA.panSpeed}
        zoomSpeed={LAB_CAMERA.zoomSpeed}
        zoomToCursor={false}
        screenSpacePanning
        minZoom={LAB_CAMERA.minZoom}
        maxZoom={LAB_CAMERA.maxZoom}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
      <CameraRig controls={controls} selectedPosition={selectedPosition} focusRequest={focusRequest} viewRequest={viewRequest} fitKey={fitKey} cameraStorageKey={cameraStorageKey} bounds={cameraBounds} />

      {showNavigationGizmo && <GizmoHelper alignment="bottom-right" margin={[74, 72]}>
        <ArrowNavigationGizmo lattice={lattice} />
      </GizmoHelper>}
    </Canvas>
  );
}
