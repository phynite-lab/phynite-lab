import type { AiAction, AiStateLedger } from './ai-contract.ts';
import type { AiOrchestrationState } from './ai-orchestration.ts';
import { workflowModules, type WorkflowKind } from './project-workflow.ts';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const internalId = /\b(?:node|aim|air|ait|aia)_[a-z\d_-]+\b/gi;

/** Names come from the saved proposal, including the original node for removals. */
export function aiModuleDescription(change: unknown, locale: 'en' | 'id') {
  const value = record(change), after = record(value.after), before = record(value.before);
  const node = Object.keys(after).length ? after : before;
  const kind = workflowModules[node.kind as WorkflowKind]?.[locale];
  const name = [value.name, node.name].find(name => typeof name === 'string' && name.trim() && !/\b(?:node|aim|air|ait|aia)_[a-z\d_-]+\b/i.test(name));
  return { name: typeof name === 'string' ? name : kind ?? (locale === 'id' ? 'Modul Kanvas' : 'Canvas module'), kind };
}

/** Compatibility presentation only: immutable historical messages are not rewritten. */
export function aiMessageText(text: string, locale: 'en' | 'id', ledger?: AiStateLedger, actions: AiAction[] = []): string {
  return text.replace(/(?:\n\n)?Verification limits: ([^\n]+)\. These requirements or actions are not verified complete\./g, (original, limits: string) => {
    if (!/\b(?:aim|aia)_/.test(limits)) return original;
    const parts: string[] = [];
    for (const issue of limits.split('; ')) {
      const match = /^(aim_[\w-]+): (unknown|unmet)$/.exec(issue);
      if (match) {
        const requirement = ledger?.constraints.find(item => item.messageId === match[1]);
        if (match[2] === 'unmet') parts.push(requirement?.text ?? (locale === 'id' ? 'Permintaan sebelumnya belum selesai' : 'An earlier request is incomplete'));
        continue; // An old unassessed message is not a failed action.
      }
      const actionMatch = /^(aia_[\w-]+): (\w+)$/.exec(issue);
      if (actionMatch) {
        const action = actions.find(item => item.id === actionMatch[1]);
        if (['pending', 'executing', 'failed'].includes(actionMatch[2])) parts.push(action?.title ?? (locale === 'id' ? 'Aksi sebelumnya belum selesai' : 'An earlier action is incomplete'));
      } else parts.push(issue.replace(internalId, locale === 'id' ? 'modul terkait' : 'the related module'));
    }
    return parts.length ? `\n\n${locale === 'id' ? 'Belum selesai atau terverifikasi' : 'Still incomplete or unverified'}: ${[...new Set(parts)].join('; ')}.` : '';
  }).trim();
}

/** Describe recorded work, never invented progress or private model reasoning. */
export function aiActivityText(state: AiOrchestrationState | null, activity: string, writing: boolean, awaitingApproval: boolean, locale: 'en' | 'id') {
  const choose = (en: string, id: string) => locale === 'id' ? id : en;
  if (awaitingApproval || state?.parent?.status === 'awaiting_approval') return choose('Waiting for your approval', 'Menunggu persetujuan Anda');
  const running = state?.tasks.filter(task => task.status === 'running') ?? [];
  if (running.length) return choose(`Working on ${running.length} ${running.length === 1 ? 'task' : 'tasks'}`, `Mengerjakan ${running.length} tugas`);
  if (writing) return choose('Writing a response…', 'Menulis jawaban…');
  if (activity) {
    const labels: Record<string, [string, string]> = {
      'get context': ['Reading project data…', 'Membaca data proyek…'],
      'read canvas': ['Reading Canvas modules…', 'Membaca modul Kanvas…'],
      'edit canvas': ['Preparing Canvas changes…', 'Menyiapkan perubahan Kanvas…'],
      'read resource': ['Reading the selected source…', 'Membaca sumber pilihan…'],
      'read attachment': ['Reading the attached file…', 'Membaca file terlampir…'],
      'search attachment': ['Searching the attached file…', 'Menelusuri file terlampir…'],
      'search papers': ['Searching the literature…', 'Menelusuri literatur…'],
      'lookup paper': ['Checking a paper…', 'Memeriksa paper…'],
      'record progress': ['Saving progress…', 'Menyimpan progres…'],
    };
    const label = labels[activity];
    if (label) return choose(...label);
    if (/checkpoint|Scientific check/i.test(activity)) return choose('Checking saved evidence…', 'Memeriksa bukti tersimpan…');
  }
  if (state?.tasks.length && state.tasks.every(task => !['queued', 'running'].includes(task.status))) return choose('Putting the findings together…', 'Merangkum hasil tugas…');
  if (state?.parent && !state.parent.planReady && state.parent.strategy !== 'solo' && state.teamQualified) return choose('Planning the work…', 'Menyiapkan langkah kerja…');
  return choose('Thinking…', 'Sedang berpikir…');
}
