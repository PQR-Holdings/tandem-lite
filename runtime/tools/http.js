function createHttpTool() {
  return { name: 'http.request', description: 'Verify HTTP services, especially localhost development servers.', permissions: ['http.local', 'http.external'], async execute(input) {
    const started = Date.now(); const response = await fetch(input.url, { method: input.method || 'GET', body: input.body }); const body = await response.text();
    return { ok: response.ok, status: response.status, body: body.slice(0, 10000), latencyMs: Date.now() - started };
  } };
}
module.exports = { createHttpTool };
