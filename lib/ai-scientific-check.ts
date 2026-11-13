/** Brief scientific check outcomes, never private model reasoning or proof of solver success. */
export const aiScientificTools = new Set(['start_discovery', 'edit_canvas', 'prepare_dft', 'save_md', 'modify_structure', 'derive_structure', 'import_structure', 'import_crystal_structure', 'import_md_potential', 'create_figure', 'edit_figure', 'run_workflow', 'run_md', 'run_analysis', 'configure_qe_compute']);
export const aiScientificCheckFields = ['units', 'speciesMapping', 'periodicity', 'convergence'] as const;
export const aiScientificCheckSchema = { type: 'object', additionalProperties: false, required: aiScientificCheckFields, properties: Object.fromEntries(aiScientificCheckFields.map(key => [key, { type: 'object', additionalProperties: false, required: ['status', 'note'], properties: { status: { type: 'string', enum: ['checked', 'not_applicable', 'unknown'] }, note: { type: 'string', minLength: 1, maxLength: 500 } } }])) };
export function aiScientificCheck(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4) return false;
  return aiScientificCheckFields.every(key => { const item = (value as Record<string, unknown>)[key]; if (!item || typeof item !== 'object' || Array.isArray(item)) return false; const row = item as Record<string, unknown>; return Object.keys(row).length === 2 && ['checked', 'not_applicable'].includes(String(row.status)) && typeof row.note === 'string' && row.note.trim().length > 0 && row.note.length <= 500; });
}
