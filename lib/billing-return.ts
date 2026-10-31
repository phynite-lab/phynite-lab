/** Accept only the scientific workspace destinations, never an external URL. */
export function computeReturnPath(value: string | null | undefined): string | null {
  if (!value || /[\\\u0000-\u001f]/.test(value)) return null;
  if (!/^\/(workspace|projects|calculation|md)(?:[/?#]|$)/.test(value) && !/^\/account\/compute(?:[?#]|$)/.test(value)) return null;
  return value;
}
