import { parseMdText } from './md-parser';
import { analyzeMdFrame } from './md-analysis';
import { loadMdWasm } from './md-wasm';

let desktopParser: ReturnType<typeof loadMdWasm> | undefined;

self.onmessage = async (event) => {
  const { id, operation, text, blob, name, frame, modifiers, useNative } = event.data;
  try {
    let result;
    if (operation === 'parse') {
      const [source, parser] = await Promise.all([
        blob instanceof Blob ? blob.text() : text,
        useNative ? desktopParser ??= loadMdWasm() : undefined,
      ]);
      result = parseMdText(source, name, parser);
    } else {
      result = analyzeMdFrame(frame, { modifiers });
    }
    self.postMessage({ id, result });
  }
  catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : 'Trajectory operation failed.' }); }
};

// Signal only after the parser imports and request handler are ready.
self.postMessage({ type: 'ready' });
