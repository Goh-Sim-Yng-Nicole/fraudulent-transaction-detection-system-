import Module, { createRequire } from 'node:module';
import path from 'node:path';

const rootRequire = createRequire(import.meta.url);

export function loadCommonJsWithMocks(modulePath, mocks = {}) {
  const absoluteModulePath = path.resolve(process.cwd(), modulePath);
  delete rootRequire.cache[absoluteModulePath];

  const scopedRequire = createRequire(absoluteModulePath);
  const originalLoad = Module._load;
  const resolvedMocks = new Map();

  for (const [request, mockValue] of Object.entries(mocks)) {
    resolvedMocks.set(request, mockValue);

    try {
      resolvedMocks.set(scopedRequire.resolve(request), mockValue);
    } catch {
      // Some mocks intentionally target optional or virtual modules.
    }
  }

  Module._load = function patchedLoad(request, parent, isMain) {
    if (resolvedMocks.has(request)) {
      return resolvedMocks.get(request);
    }

    try {
      const resolved = Module._resolveFilename(request, parent, isMain);
      if (resolvedMocks.has(resolved)) {
        return resolvedMocks.get(resolved);
      }
    } catch {
      // Let Node surface the original resolution error below.
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    return rootRequire(absoluteModulePath);
  } finally {
    Module._load = originalLoad;
  }
}
