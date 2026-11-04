import type { CrystalDatabaseMaterial } from './crystal-database.ts';
import type { WorkflowNode } from './project-workflow.ts';
import type { ParsedStructure } from './structure-parsers.ts';
import { structureFormula } from './structure-formula.ts';

export type CrystalDatabaseInput = ParsedStructure & {
  formula: string;
  source: CrystalDatabaseMaterial['source'];
  externalId: string;
  sourceUrl: string;
  sourceUpdatedAt: string | null;
  sourceData: CrystalDatabaseMaterial['sourceData'];
  provenance: CrystalDatabaseMaterial['provenance'];
  geometryProvenance: Array<{ kind: 'database-import' } & CrystalDatabaseMaterial['provenance']>;
  bandGap?: number;
};

/** Keep the source geometry and evidence together when loading it into an editor. */
export function crystalDatabaseInput(material: CrystalDatabaseMaterial): CrystalDatabaseInput {
  return {
    name: `${material.formula} · ${material.materialId}`,
    formula: material.formula,
    atoms: material.atoms,
    lattice: material.lattice,
    source: material.source,
    externalId: material.materialId,
    sourceUrl: material.sourceUrl,
    sourceUpdatedAt: material.lastUpdated,
    sourceData: material.sourceData,
    provenance: material.provenance,
    geometryProvenance: [{ kind: 'database-import', ...material.provenance }],
    ...(material.bandGap === undefined ? {} : { bandGap: material.bandGap }),
  };
}

/** Replacing an input retains its module and connections, but invalidates old saved input refs. */
export function replaceWorkflowCrystalInput(node: WorkflowNode, structure: ParsedStructure): WorkflowNode {
  if (node.kind !== 'structure') throw new Error('Choose a Crystal structure module before importing a crystal.');
  const input = structure as ParsedStructure & Partial<CrystalDatabaseInput>;
  const configuration: Record<string, unknown> = { ...node.configuration, structure, formula: structureFormula(structure.atoms) };
  delete configuration.savedStructureSignature;
  delete configuration.legacySource;
  const source = {
    ...(typeof input.externalId === 'string' ? { externalId: input.externalId } : {}),
    ...(typeof input.sourceUrl === 'string' ? { sourceUrl: input.sourceUrl } : {}),
    ...(typeof input.bandGap === 'number' && Number.isFinite(input.bandGap) ? { bandGap: input.bandGap } : {}),
  };
  if (Object.keys(source).length) configuration.legacySource = source;
  return { ...node, configuration, resources: node.resources.filter(resource => resource.kind !== 'structure') };
}
