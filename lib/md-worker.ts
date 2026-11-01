import { parseMdText } from './md-parser';
import { analyzeMdFrame } from './md-analysis';

self.onmessage = (event) => {
  const { id, operation, text, name, frame, modifiers } = event.data;
  try { self.postMessage({ id, result: operation === 'parse' ? parseMdText(text, name) : analyzeMdFrame(frame, { modifiers }) }); }
  catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : 'Trajectory operation failed.' }); }
};

// Signal only after the parser imports and request handler are ready.
self.postMessage({ type: 'ready' });
