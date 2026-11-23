import { parseMdText } from './md-parser';
import { analyzeMdFrame } from './md-analysis';

self.onmessage = async (event) => {
  const { id, operation, text, blob, name, frame, modifiers } = event.data;
  try {
    const result = operation === 'parse' ? parseMdText(blob instanceof Blob ? await blob.text() : text, name) : analyzeMdFrame(frame, { modifiers });
    self.postMessage({ id, result });
  }
  catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : 'Trajectory operation failed.' }); }
};

// Signal only after the parser imports and request handler are ready.
self.postMessage({ type: 'ready' });
