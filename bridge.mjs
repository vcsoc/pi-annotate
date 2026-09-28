// Compatibility facade for existing callers. The extension imports the new
// factory directly so Pi reload cannot reuse the legacy, cached bridge factory.
export { MAX_BODY, MAX_ITEMS, validateBatch } from './batch.mjs';
export { createBridge } from './session-bridge.mjs';
