import type { CellVectors } from './crystal-cell';
import type { MdSimulationWorkflowV2 } from './md-simulation-types';

/** Match the runtime's geometry contract without rotating or discarding skew. */
export function mdBerendsenCellIssue(workflow: MdSimulationWorkflowV2, vectors: CellVectors) {
  const steps = workflow.steps.filter(step => step.enabled);
  const raw = workflow.mode === 'manual' ? (workflow.manualBody ?? '').split('\n').map(line => line.split('#')[0]).join('\n').replace(/&\s*\n/g, ' ') : '';
  let berendsen = false;
  let shear = false;
  if (raw.trim()) {
    berendsen = /^\s*fix\s+\S+\s+\S+\s+press\/berendsen\b/im.test(raw);
    shear = /^\s*change_box\s+\S+\s+triclinic\b/im.test(raw) || /^\s*fix\s+\S+\s+\S+\s+deform\b[^\n]*\b(?:xy|xz|yz)\b/im.test(raw);
  } else {
    for (const step of steps) {
      if (workflow.mode === 'manual' && step.directives?.length) {
        for (const block of step.directives.filter(block => block.enabled)) {
          berendsen ||= block.kind === 'barostat' && block.params.style === 'press-berendsen';
          shear ||= block.kind === 'deform' && block.params.mode === 'shear';
        }
      } else {
        berendsen ||= step.kind === 'press-berendsen';
        shear ||= step.kind === 'shear';
      }
    }
  }
  if (!berendsen) return '';
  const orthogonal = vectors.every((vector, axis) => vector.every((value, component) => Number.isFinite(value) && (axis === component ? value > 0 : value === 0)));
  if (!orthogonal || shear) return 'Berendsen pressure control requires an axis-aligned orthogonal cell and cannot be combined with shear. Use NPT/NPH pressure control for this workflow.';
  return '';
}
