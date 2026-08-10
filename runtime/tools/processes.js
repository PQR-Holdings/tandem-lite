function createProcessesTool() {
  return { name: 'processes', description: 'Inspect local processes. Start/stop are future Phase 1 operations.', permissions: ['process.inspect', 'process.stop'], async execute(input) {
    if (input.operation !== 'inspect') throw new Error(`Unsupported process operation: ${input.operation}`);
    return { ok: true, process: process.platform === 'win32' ? { pid: input.pid || process.pid, state: 'running' } : { pid: input.pid || process.pid, state: 'running' } };
  } };
}
module.exports = { createProcessesTool };
