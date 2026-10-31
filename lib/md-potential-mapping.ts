import { isMdElement } from './md-workspace.ts';

/** The indexed MEAM model order is supplied from its published parameter file. */
export function meamLibraryOrder(value: string, sourceElements: string[]) {
  const order = value.trim().split(/[\s,]+/).filter(Boolean);
  if (!order.length || order.length > 32 || order.some(element => !isMdElement(element)) || new Set(order).size !== order.length) throw new Error('Enter each MEAM model element once, in its parameter-file index order.');
  if (sourceElements.some(element => !order.includes(element))) throw new Error('The MEAM library order must include every element in the source structure.');
  return order;
}
