import { workflowKinds, workflowModules, type WorkflowKind } from './project-workflow.ts';

export type AiCommandToken = { start: number; end: number; query: string };
export type AiModuleCommand = { kind: WorkflowKind; command: string; label: { en: string; id: string } };

/** Aliases are display commands only; saved workflow kinds remain unchanged. */
export const aiModuleCommands: AiModuleCommand[] = workflowKinds.map(kind => ({
  kind,
  command: kind === 'structure' ? 'crystal_structure' : kind.replaceAll('-', '_'),
  label: { en: workflowModules[kind].en, id: workflowModules[kind].id },
}));

export function aiModuleKindForCommand(query: string): WorkflowKind | undefined {
  const normalized = query.toLowerCase();
  return aiModuleCommands.find(item => item.command === normalized || item.kind === normalized)?.kind;
}

/** Keep code examples, URL paths and filesystem paths ordinary prompt text. */
function inMarkdownCode(prefix: string): boolean {
  let fence: string | undefined, inlineLength = 0;
  for (const line of prefix.split('\n')) {
    const fenced = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenced && !inlineLength) {
      if (!fence) fence = fenced[1];
      else if (fenced[1][0] === fence[0] && fenced[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;
    for (const run of line.matchAll(/(?<!\\)`+/g)) {
      if (!inlineLength) inlineLength = run[0].length;
      else if (run[0].length === inlineLength) inlineLength = 0;
    }
  }
  return Boolean(fence || inlineLength);
}

export function findAiCommandToken(text: string, caret: number, composing = false): AiCommandToken | null {
  if (composing || !Number.isInteger(caret) || caret < 0 || caret > text.length) return null;
  const prefix = text.slice(0, caret), match = /(?:^|\s)(\/([A-Za-z0-9_-]*))$/.exec(prefix);
  if (!match || inMarkdownCode(prefix)) return null;
  const start = caret - match[1].length;
  const suffix = /^[A-Za-z0-9_-]*/.exec(text.slice(caret))![0];
  const end = caret + suffix.length;
  // A slash within the same word identifies a path rather than a command.
  if (text[end] && !/[\s.,!?;:()\]}]/.test(text[end])) return null;
  return { start, end, query: text.slice(start + 1, end) };
}

/** Remove only the command token, never text on either side of the selection. */
export function replaceAiCommandToken(text: string, token: AiCommandToken): { text: string; caret: number } {
  if (token.start < 0 || token.end < token.start || token.end > text.length || text.slice(token.start, token.end) !== `/${token.query}`) return { text, caret: Math.max(0, Math.min(text.length, token.start)) };
  return { text: text.slice(0, token.start) + text.slice(token.end), caret: token.start };
}

export function aiCommandMatches(query: string, ...values: (string | undefined)[]): boolean {
  const needle = query.toLowerCase().replace(/^\//, '').replaceAll('-', '_');
  return values.some(value => value?.toLowerCase().replaceAll('-', '_').includes(needle));
}
