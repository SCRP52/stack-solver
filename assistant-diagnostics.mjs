export const assistantBuild = '45';

export function createScanLog({ now = () => Date.now(), maxEntries = 220 } = {}) {
  const started = now();
  const entries = [];
  let discardedEntries = 0;
  let frames = 0;
  let processingTotal = 0;
  let processingMax = 0;
  let phases = {};
  let previousFlush = started;

  function event(name, details = {}) {
    if (entries.length >= maxEntries) {
      // Preserve the first event so camera startup is still available after a long scan.
      entries.splice(1, 1);
      discardedEntries++;
    }
    entries.push({ elapsedMs: now() - started, event: name, ...details });
  }

  function flush() {
    if (!frames) return;
    event('scan.summary', {
      intervalMs: now() - previousFlush,
      frames,
      averageProcessingMs: Math.round(processingTotal / frames),
      slowestProcessingMs: Math.round(processingMax),
      outcomes: phases,
    });
    frames = 0;
    processingTotal = 0;
    processingMax = 0;
    phases = {};
    previousFlush = now();
  }

  return {
    event,
    frame(phase, processingMs) {
      frames++;
      phases[phase] = (phases[phase] ?? 0) + 1;
      processingTotal += processingMs;
      processingMax = Math.max(processingMax, processingMs);
      if (now() - previousFlush >= 1000) flush();
    },
    flush,
    serialize() {
      flush();
      return JSON.stringify({
        format: 'thisdeck-assistant-diagnostics',
        build: assistantBuild,
        startedAt: new Date(started).toISOString(),
        discardedEntries,
        entries,
      }, null, 2);
    },
  };
}
