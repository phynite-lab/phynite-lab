type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  abort?: () => void;
};

type WorkerReply = { type: 'ready' } | { id: number; result?: unknown; error?: string };
type MdWorkerRunOptions = { signal?: AbortSignal; transfer?: Transferable[] };

/**
 * Restartable request client for MD parser/analysis workers.
 *
 * A malformed input only rejects its own request. A crash, deserialization
 * failure, or timeout restarts the worker so a later trajectory can still be
 * opened without reloading MD Lab.
 */
export function createMdWorkerClient(
  createWorker: () => Worker,
  { startupTimeoutMs = 15_000, requestTimeoutMs = 60_000 } = {},
) {
  let worker: Worker | null = null;
  let disposed = false;
  let nextId = 0;
  let generation = 0;
  let started = false;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let readyPromise: Promise<void> | null = null;
  let resolveReady: (() => void) | null = null;
  let rejectReady: ((error: Error) => void) | null = null;
  const requests = new Map<number, PendingRequest>();

  const settleOutstanding = (error: Error) => {
    requests.forEach(request => {
      clearTimeout(request.timer);
      request.abort?.();
      request.reject(error);
    });
    requests.clear();
  };

  const stopWorker = (error: Error) => {
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;
    rejectReady?.(error);
    rejectReady = null;
    resolveReady = null;
    settleOutstanding(error);
    worker?.terminate();
    worker = null;
    readyPromise = null;
    started = false;
    generation += 1;
  };

  const startWorker = () => {
    if (disposed) return Promise.reject(new Error('MD Lab closed.'));
    if (readyPromise) return readyPromise;

    const currentGeneration = generation;
    readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    // A worker may fail before any caller awaits startup.
    void readyPromise.catch(() => undefined);

    try {
      const instance = createWorker();
      worker = instance;
      startupTimer = setTimeout(() => {
        if (generation === currentGeneration) {
          stopWorker(new Error('Trajectory reader did not start. Try opening the file again.'));
        }
      }, startupTimeoutMs);

      instance.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
        if (generation !== currentGeneration || instance !== worker) return;
        const message = event.data;
        if (!message || typeof message !== 'object') return;
        if ('type' in message && message.type === 'ready') {
          if (startupTimer) clearTimeout(startupTimer);
          startupTimer = null;
          started = true;
          resolveReady?.();
          resolveReady = null;
          rejectReady = null;
          return;
        }
        if (!('id' in message)) return;
        const request = requests.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        request.abort?.();
        requests.delete(message.id);
        if (message.error) request.reject(new Error(message.error));
        else request.resolve(message.result);
      });
      instance.addEventListener('error', event => {
        event.preventDefault();
        if (generation === currentGeneration) {
          stopWorker(new Error('Trajectory reader stopped unexpectedly. It will restart on the next request.'));
        }
      });
      instance.addEventListener('messageerror', () => {
        if (generation === currentGeneration) {
          stopWorker(new Error('The trajectory reader could not return its result. It will restart on the next request.'));
        }
      });
    } catch {
      stopWorker(new Error('Trajectory reader could not start. Try opening the file again.'));
    }
    return readyPromise ?? Promise.reject(new Error('Trajectory reader could not start.'));
  };

  // Preserve eager startup so the first visible open does not pay worker boot time.
  void startWorker().catch(() => undefined);

  return {
    async run<T>(payload: Record<string, unknown>, options: MdWorkerRunOptions = {}): Promise<T> {
      if (disposed) throw new Error('MD Lab closed.');
      if (options.signal?.aborted) throw new DOMException('The operation was cancelled.', 'AbortError');
      const ready = startWorker();
      if (!started) await ready;
      if (disposed) throw new Error('MD Lab closed.');
      if (!worker) throw new Error('Trajectory reader could not start. Try opening the file again.');

      return new Promise<T>((resolve, reject) => {
        const id = ++nextId;
        const onAbort = () => {
          const request = requests.get(id);
          if (!request) return;
          clearTimeout(request.timer);
          request.abort?.();
          requests.delete(id);
          reject(new DOMException('The operation was cancelled.', 'AbortError'));
        };
        const timer = setTimeout(() => {
          if (!requests.has(id)) return;
          stopWorker(new Error('Trajectory processing timed out. The reader was restarted; try the file again or use personal compute.'));
        }, requestTimeoutMs);
        const abort = options.signal
          ? () => options.signal?.removeEventListener('abort', onAbort)
          : undefined;
        requests.set(id, { resolve: value => resolve(value as T), reject, timer, abort });
        options.signal?.addEventListener('abort', onAbort, { once: true });
        try {
          worker!.postMessage({ ...payload, id }, options.transfer ?? []);
        } catch {
          clearTimeout(timer);
          abort?.();
          requests.delete(id);
          reject(new Error('Could not send this trajectory to the reader.'));
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopWorker(new Error('MD Lab closed.'));
    },
  };
}

export type MdWorkerClient = ReturnType<typeof createMdWorkerClient>;
