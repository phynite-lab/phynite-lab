/** One native bridge, two inference processes, FIFO capacity and abortable waiting. */
export class InferenceAdmission {
  constructor({ limit = 2, timeoutMs = 600000 } = {}) { this.limit = limit; this.timeoutMs = timeoutMs; this.active = 0; this.queue = []; }
  acquire(signal) {
    return new Promise((resolve, reject) => {
      const item = { start: null, cancel: null };
      const remove = () => { this.queue = this.queue.filter(entry => entry !== item); clearTimeout(timer); signal?.removeEventListener('abort', item.cancel); };
      item.cancel = () => { remove(); reject(signal?.reason ?? new Error('Inference cancelled while waiting.')); this.drain(); };
      item.start = () => { remove(); this.active++; let released = false; resolve(() => { if (!released) { released = true; this.active--; this.drain(); } }); };
      const timer = setTimeout(() => { remove(); reject(Object.assign(new Error('Native provider capacity wait exceeded ten minutes.'), { code: 'AI_QUEUE_TIMEOUT' })); this.drain(); }, this.timeoutMs);
      this.queue.push(item); signal?.addEventListener('abort', item.cancel, { once: true });
      if (signal?.aborted) item.cancel(); else this.drain();
    });
  }
  drain() { while (this.active < this.limit && this.queue.length) this.queue[0].start(); }
}
export const nativeInferenceAdmission = new InferenceAdmission();
