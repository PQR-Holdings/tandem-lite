const test = require('node:test');
const assert = require('node:assert/strict');
const { AnthropicProvider, GeminiProvider, OpenAICompatibleProvider, createProvider } = require('../runtime/models/providers');

async function withFetch(handler, callback) {
  const original = global.fetch; global.fetch = handler;
  try { await callback(); } finally { global.fetch = original; }
}

test('Gemini uses its OpenAI-compatible endpoint and bearer authentication', async () => {
  await withFetch(async (url, request) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    assert.equal(request.headers.authorization, 'Bearer gemini-key');
    assert.deepEqual(JSON.parse(request.body).response_format, { type: 'json_object' });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"steps":[]}' } }] }), { status: 200 });
  }, async () => {
    const provider = createProvider({ provider: 'gemini', apiKey: 'gemini-key', model: 'gemini-3.6-flash' });
    assert.ok(provider instanceof GeminiProvider);
    await provider.generate([{ role: 'user', content: 'plan' }], { json: true });
  });
});

test('generic compatible providers do not force OpenAI JSON mode', async () => {
  await withFetch(async (_url, request) => {
    assert.equal(JSON.parse(request.body).response_format, undefined);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 });
  }, () => new OpenAICompatibleProvider({ endpoint: 'https://example.test/v1', model: 'model' }).generate([], { json: true }));
});

test('Anthropic applies timeouts and includes API error details', async () => {
  await withFetch(async (_url, request) => {
    assert.ok(request.signal);
    return new Response('{"error":{"message":"bad model"}}', { status: 400 });
  }, async () => {
    const provider = new AnthropicProvider({ apiKey: 'key', model: 'claude-sonnet-5' });
    await assert.rejects(provider.generate([{ role: 'user', content: 'plan' }]), /400.*bad model/);
  });
});
