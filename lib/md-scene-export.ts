import * as THREE from 'three';

export type MdSceneExport = (format: 'png' | 'glb') => Promise<Blob>;
export async function exportMdScene(format: 'png' | 'glb', renderer: THREE.WebGLRenderer, source: THREE.InstancedMesh, objects: Array<THREE.Object3D | null>, frame: number) {
  if (format === 'png') return new Promise<Blob>((resolve, reject) => renderer.domElement.toBlob(blob => blob ? resolve(blob) : reject(new Error('Snapshot failed.')), 'image/png'));
  if (source.count > 20_000) throw new Error('GLB export supports up to 20,000 atoms. Apply a Slice modifier or export coordinates.');
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const root = new THREE.Group(); root.name = 'Phynite MD frame'; root.userData = { coordinates: 'angstrom', frame };
  const matrix = new THREE.Matrix4(), color = new THREE.Color(), scale = new THREE.Vector3();
  const materials: THREE.Material[] = [];
  for (let i = 0; i < source.count; i++) {
    source.getMatrixAt(i, matrix); scale.setFromMatrixScale(matrix);
    if (!scale.lengthSq()) continue;
    source.getColorAt(i, color);
    const material = new THREE.MeshStandardMaterial({ color: color.clone() }); materials.push(material);
    const atom = new THREE.Mesh(source.geometry, material); atom.applyMatrix4(matrix); root.add(atom);
  }
  objects.forEach(object => { if (object?.visible) root.add(object.clone()); });
  try {
    const binary = await new GLTFExporter().parseAsync(root, { binary: true });
    if (!(binary instanceof ArrayBuffer)) throw new Error('Scene export did not produce a GLB file.');
    return new Blob([binary], { type: 'model/gltf-binary' });
  } finally { materials.forEach(material => material.dispose()); }
}
