function providerError(name, response, body) {
  const detail = String(body || '').trim().slice(0, 600);
  return new Error(`${name} returned ${response.status}${detail ? `: ${detail}` : ''}`);
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

class OpenAICompatibleProvider {
  constructor({ id = 'openai-compatible', endpoint, apiKey, model, headers = {}, supportsJsonMode = false }) {
    Object.assign(this, { id, endpoint: endpoint?.replace(/\/$/, ''), apiKey, model, headers, supportsJsonMode });
    this.supportsTools = true;
    this.supportsVision = true;
  }
  async generate(messages, options = {}) {
    const body = compactObject({
      model: options.model || this.model,
      messages,
      temperature: options.temperature,
      tools: options.tools,
      ...(options.json && this.supportsJsonMode ? { response_format: { type: 'json_object' } } : {})
    });
    const response = await fetch(`${this.endpoint}/chat/completions`, {
      signal: AbortSignal.timeout(options.timeoutMs || 30000),
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}), ...this.headers },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw providerError(this.id, response, await response.text());
    const raw = await response.json();
    return { text: raw.choices?.[0]?.message?.content || '', raw };
  }
}

class OllamaProvider {
  constructor({ endpoint = 'http://127.0.0.1:11434', model }) { this.id = 'ollama'; this.endpoint = endpoint.replace(/\/$/, ''); this.model = model; this.supportsTools = true; this.supportsVision = true; }
  async generate(messages, options = {}) {
    const response = await fetch(`${this.endpoint}/api/chat`, { signal: AbortSignal.timeout(options.timeoutMs || 30000), method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: options.model || this.model, messages, stream: false, format: 'json', think: false, keep_alive: '5m', options: compactObject({ temperature: options.temperature }) }) });
    if (!response.ok) throw providerError('Ollama', response, await response.text());
    const raw = await response.json(); const content = raw.message?.content?.trim(); const thinking = raw.message?.thinking?.trim(); return { text: content || thinking || '', raw };
  }
}

class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(config) { super({ ...config, id: 'openai', endpoint: config.endpoint || 'https://api.openai.com/v1', supportsJsonMode: true }); }
  async generate(messages, options = {}) { const { temperature, ...supported } = options; return super.generate(messages, supported); }
}

class GeminiProvider extends OpenAICompatibleProvider {
  constructor(config) { super({ ...config, id: 'gemini', endpoint: config.endpoint || 'https://generativelanguage.googleapis.com/v1beta/openai', supportsJsonMode: true }); }
}

class AnthropicProvider {
  constructor({ endpoint = 'https://api.anthropic.com/v1', apiKey, model }) { Object.assign(this, { id: 'anthropic', endpoint: endpoint.replace(/\/$/, ''), apiKey, model, supportsTools: true, supportsVision: true }); }
  async generate(messages, options = {}) {
    const response = await fetch(`${this.endpoint}/messages`, {
      signal: AbortSignal.timeout(options.timeoutMs || 30000),
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: options.model || this.model, max_tokens: options.maxTokens || 2048, messages })
    });
    if (!response.ok) throw providerError('Anthropic', response, await response.text());
    const raw = await response.json(); return { text: raw.content?.map((part) => part.text || '').join('') || '', raw };
  }
}

function createProvider(config) {
  if (config.provider === 'ollama') return new OllamaProvider(config);
  if (config.provider === 'openai') return new OpenAIProvider(config);
  if (config.provider === 'anthropic') return new AnthropicProvider(config);
  if (config.provider === 'gemini') return new GeminiProvider(config);
  return new OpenAICompatibleProvider(config);
}

module.exports = { createProvider, OpenAICompatibleProvider, OllamaProvider, OpenAIProvider, AnthropicProvider, GeminiProvider };
