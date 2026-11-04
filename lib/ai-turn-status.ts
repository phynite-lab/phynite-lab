import type { AiDetail, AiFailure, AiRun } from './ai-contract.ts';

export type AiTurnSummary = { status: AiRun['status']; failure?: AiFailure };

/** Public API errors keep their diagnostics separate from the message shown in the UI. */
export function aiOperationFailure(value: unknown): AiFailure {
  if (typeof value === 'string') return { code: 'AI_REQUEST_FAILED', message: value };
  const error = value && typeof value === 'object' ? value as { code?: unknown; message?: unknown; requestId?: unknown; issues?: AiFailure['issues'] } : {};
  return {
    code: typeof error.code === 'string' ? error.code : 'AI_REQUEST_FAILED',
    message: typeof error.message === 'string' ? error.message : 'The request could not be completed. Try again.',
    ...(typeof error.requestId === 'string' ? { requestId: error.requestId } : {}),
    ...(Array.isArray(error.issues) ? { issues: error.issues } : {}),
  };
}

export function aiTurnSummary(detail: AiDetail | null, runId: string): AiTurnSummary | undefined {
  const run = detail?.run;
  const saved = detail?.turns?.[runId];
  return run?.id === runId ? { ...saved, status: run.status, ...(run.failure ? { failure: run.failure } : {}) } : saved;
}

/** Retry repeats the latest failed queued input as a new turn; it never resumes an approval. */
export function aiRetryRunId(detail: AiDetail | null): string | undefined {
  return detail?.conversation.queuePaused && detail.run?.status === 'failed' && detail.run.queueId ? detail.run.id : undefined;
}

/** Polling must retain pages already loaded by the reader. Messages are append-only. */
export function mergeAiHistory(previous: AiDetail | null, next: AiDetail): AiDetail {
  if (!previous || previous.conversation.id !== next.conversation.id) return next;
  return {
    ...next,
    messages: [...new Map([...previous.messages, ...next.messages].map(message => [message.id, message])).values()],
    actions: [...new Map([...previous.actions, ...next.actions].map(action => [action.id, action])).values()],
    turns: { ...previous.turns, ...next.turns },
    ...(previous.before && next.before && previous.before < next.before ? { before: previous.before, hasOlderMessages: previous.hasOlderMessages } : {}),
  };
}

/** An error event reports a problem, but only the saved run determines its final state. */
export function aiNeedsTurnStatus(detail: AiDetail | null, runId: string): boolean {
  if (!detail || detail.conversation.activeRunId !== runId) return false;
  const status = aiTurnSummary(detail, runId)?.status;
  return !status || status === 'running' || status === 'awaiting_approval';
}

export function aiFailureReason(failure: AiFailure | undefined, locale: 'en' | 'id'): string {
  const choose = (en: string, id: string) => locale === 'id' ? id : en;
  const code = failure?.code ?? '';
  if (code === 'AUTH_REQUIRED' || code === 'NOT_CONNECTED' || code === 'LOGIN_FAILED') return choose('Sign in to the official AI CLI, then reconnect this provider.', 'Login ke CLI AI resmi, lalu hubungkan kembali provider ini.');
  if (code === 'CLI_MISSING') return choose('The official AI CLI is missing from PATH. Install it, then restart Phynite Lab.', 'CLI AI resmi tidak ditemukan di PATH. Instal CLI tersebut, lalu mulai ulang Phynite Lab.');
  if (code === 'UNVERIFIED_VERSION') return choose('This AI CLI version is not verified for the local connector. Update to a supported version, then reconnect.', 'Versi CLI AI ini belum diverifikasi untuk konektor lokal. Perbarui ke versi yang didukung, lalu hubungkan kembali.');
  if (code === 'UNSAFE_CONFIGURATION' || code === 'UNSAFE_TOOLS' || code === 'INVALID_PROTOCOL') return choose('The AI CLI did not confirm the restricted local session. Update the CLI and reconnect; no project action was run.', 'CLI AI tidak mengonfirmasi sesi lokal terbatas. Perbarui CLI lalu hubungkan kembali; tidak ada aksi project yang dijalankan.');
  if (code === 'INCOMPLETE_RESPONSE' || code === 'INFERENCE_FAILED') return choose('The local AI CLI did not complete this response. Check its account, model availability, and CLI log, then retry.', 'CLI AI lokal tidak menyelesaikan respons ini. Periksa akun, ketersediaan model, dan log CLI, lalu coba lagi.');
  if (/AI_(?:PROVIDER_STREAM|STREAM_|RESPONSE_EMPTY|RESPONSE_INCOMPLETE)/.test(code)) return choose('The AI response was interrupted before it finished. Any partial response is kept.', 'Respons AI terputus sebelum selesai. Jika ada respons parsial, isinya tetap tersimpan.');
  if (/AI_(?:ROUTER_UNREACHABLE|PROVIDER_CONNECTION_FAILED|CONNECTION_CLOSED|TURN_TIMEOUT)/.test(code)) return choose('The AI source could not be reached. Try again or choose another model.', 'Sumber AI belum dapat dijangkau. Coba lagi atau pilih model lain.');
  if (/AI_(?:PROVIDER_AUTH_FAILED|CONFIGURATION_INVALID|NOT_CONFIGURED|CAPABILITIES_INVALID)/.test(code)) return choose('The selected AI source is unavailable. Choose another connected model.', 'Sumber AI terpilih belum tersedia. Pilih model lain yang sudah terhubung.');
  if (/AI_(?:MODEL_INVALID|MODEL_UNVERIFIED|PROVIDER_UNAVAILABLE)/.test(code)) return choose('The selected model is unavailable. Choose another model or try again later.', 'Model terpilih belum tersedia. Pilih model lain atau coba lagi nanti.');
  if (code === 'AI_EFFORT_UNSUPPORTED') return choose('This effort is unavailable for the selected model. Choose Auto or another available level.', 'Tingkat effort ini belum tersedia untuk model terpilih. Pilih Auto atau tingkat lain yang tersedia.');
  if (/AI_(?:PDF|IMAGE)_UNSUPPORTED/.test(code)) return choose('This model cannot read the attached source. Choose a compatible model or attach extracted text.', 'Model ini belum dapat membaca sumber terlampir. Pilih model yang sesuai atau lampirkan teks hasil ekstraksi.');
  if (/AI_ATTACHMENT_/.test(code)) return choose('The attached source could not be read. Check the file and attach it again before continuing.', 'Sumber terlampir belum dapat dibaca. Periksa file dan lampirkan kembali sebelum melanjutkan.');
  if (/AI_(?:OUTPUT|REQUEST|STEP)_LIMIT/.test(code)) return choose('This turn reached a processing limit. Review the partial response and send a smaller follow-up.', 'Giliran ini mencapai batas pemrosesan. Tinjau respons parsial dan kirim pesan lanjutan yang lebih singkat.');
  if (/AI_TOOL_/.test(code)) return choose('An action could not finish. Review the recorded actions and inputs before continuing.', 'Salah satu aksi belum selesai. Tinjau aksi tercatat dan input sebelum melanjutkan.');
  if (code === 'AI_PERMISSION_DENIED') return choose('This action is not allowed with the current permissions. Review the requested action and permission setting.', 'Aksi ini belum diizinkan dengan pengaturan saat ini. Tinjau aksi yang diminta dan pengaturan izin.');
  if (/AI_(?:RUN_|CONFLICT|STEER_PENDING)/.test(code)) return choose('The saved turn changed. Refresh the conversation before continuing.', 'Giliran tersimpan sudah berubah. Muat ulang percakapan sebelum melanjutkan.');
  if (locale === 'en' && failure?.message) return failure.message;
  return choose('This turn did not finish. Send a follow-up or retry the turn when available.', 'Giliran ini belum selesai. Kirim pesan lanjutan atau ulangi giliran jika tersedia.');
}
