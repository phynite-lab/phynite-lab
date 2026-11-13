'use client';

import { useThree } from '@react-three/fiber';
import { useEffect, type RefObject } from 'react';
import * as THREE from 'three';
import { appearanceFor, type buildCrystalRenderModel, type CrystalDisplayStyle } from '@/lib/crystal-render-model';
import { activeViewports, viewportChecksum } from '@/lib/ai-viewport';
import { useAiViewportScope } from './AiViewportScope';
import { LAB_VIEWPORT } from '@/lib/lab-camera';

export type CrystalSceneExporter = (format: 'png' | 'glb') => Promise<Blob>;

export function CrystalSceneExport({ exportRef, model, colors, showBonds, showCell, bondScale, displayStyle, rotation, captureMetadata }: {
  captureMetadata: Record<string, unknown>;
  exportRef?: RefObject<CrystalSceneExporter | null>;
  model: ReturnType<typeof buildCrystalRenderModel>;
  colors?: Map<string, string>;
  showBonds: boolean; showCell: boolean; bondScale: number;
  displayStyle: CrystalDisplayStyle; rotation: [number, number, number];
}) {
  const { gl, scene, camera } = useThree();
  const scope = useAiViewportScope();
  useEffect(() => {
    if (!scope) return;
    return activeViewports.register({ scope, element: gl.domElement, capture: async signal => {
      signal.throwIfAborted();
      const cameraMetadata = { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), projectionMatrix: camera.projectionMatrix.toArray(), matrixWorld: camera.matrixWorld.toArray(), near: camera.near, far: camera.far, zoom: 'zoom' in camera ? camera.zoom : null };
      gl.render(scene, camera);
      const blob = await new Promise<Blob>((resolve, reject) => gl.domElement.toBlob(b => b ? resolve(b) : reject(new Error('Viewport capture failed.')), 'image/png'));
      return { blob, metadata: { kind: 'crystal', camera: cameraMetadata, projection: camera.type, axes: ['a', 'b', 'c'], units: 'angstrom', energyReference: null, scientificRunId: scope.runId ?? null, ...captureMetadata, displaySha256: await viewportChecksum(captureMetadata) } };
    } });
  }, [scope, gl, scene, camera, captureMetadata]);
  useEffect(() => {
    if (!exportRef) return;
    exportRef.current = async (format) => {
      if (format === 'png') {
        gl.render(scene, camera);
        return new Promise<Blob>((resolve, reject) => gl.domElement.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image capture failed. Try again.')), 'image/png'));
      }
      const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
      // Export one sphere per atom, without LOD duplicates, gizmos, or selection halos.
      const root = new THREE.Group();
      root.name = 'Phynite crystal';
      root.userData = { representation: 'Normalized visualization; use CIF/XYZ/POSCAR/XSF for physical coordinates.' };
      root.rotation.set(...rotation.map(THREE.MathUtils.degToRad) as [number, number, number]);
      const sphere = new THREE.SphereGeometry(1, 24, 16);
      const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
      const materials = new Map<string, THREE.MeshStandardMaterial>();
      const material = (color: string) => {
        if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: LAB_VIEWPORT.atomMaterial.roughness, metalness: LAB_VIEWPORT.atomMaterial.metalness }));
        return materials.get(color)!;
      };
      const lines: THREE.LineSegments[] = [];
      try {
        for (const atom of model.atoms) {
          const mesh = new THREE.Mesh(sphere, material(colors?.get(atom.id) ?? appearanceFor(atom.species).color));
          mesh.name = `${atom.species} ${atom.instanceId}`;
          mesh.position.set(...atom.position);
          mesh.scale.setScalar(atom.radius);
          root.add(mesh);
        }
        const addLines = (segments: typeof model.edges, color: string) => {
          const geometry = new THREE.BufferGeometry().setFromPoints(segments.flat().map((point) => new THREE.Vector3(...point)));
          const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
          lines.push(line);
          root.add(line);
        };
        if (showCell) addLines(model.edges, '#9dacb7');
        if (showBonds && displayStyle === 'wireframe') addLines(model.bonds, '#7f8993');
        if (showBonds && displayStyle === 'ball-stick') for (const [start, end] of model.bonds) {
          const from = new THREE.Vector3(...start), to = new THREE.Vector3(...end), delta = to.clone().sub(from);
          const mesh = new THREE.Mesh(cylinder, material('#aab3bc'));
          mesh.position.copy(from).add(to).multiplyScalar(0.5);
          mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
          mesh.scale.set(0.034 * bondScale, delta.length(), 0.034 * bondScale);
          root.add(mesh);
        }
        const data = await new GLTFExporter().parseAsync(root, { binary: true });
        if (!(data instanceof ArrayBuffer)) throw new Error('Could not create a binary 3D scene.');
        return new Blob([data], { type: 'model/gltf-binary' });
      } finally {
        sphere.dispose(); cylinder.dispose();
        materials.forEach((entry) => entry.dispose());
        lines.forEach((line) => { line.geometry.dispose(); (line.material as THREE.Material).dispose(); });
      }
    };
    return () => { exportRef.current = null; };
  }, [exportRef, model, colors, showBonds, showCell, bondScale, displayStyle, rotation, gl, scene, camera]);
  return null;
}
