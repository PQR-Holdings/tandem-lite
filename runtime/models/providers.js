class OpenAICompatibleProvider {
  constructor({ id = 'openai-compatible', endpoint, apiKey, model, headers = {} }) { Object.assign(this, { id, endpoint: endpoint?.replace(/\/$/, ''), apiKey, model, headers }); this.supportsTools = true; this.supportsVision = true; }
  async generate(messages, options = {}) {
    const response = await fetch(`${this.endpoint}/chat/completions`, { signal: AbortSignal.timeout(options.timeoutMs || 30000), method: 'POST', headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}), ...this.headers }, body: JSON.stringify({ model: options.model || this.model, messages, temperature: options.temperature, tools: options.tools, ...(options.json ? { response_format: { type: 'json_object' } } : {}) }) });
    if (!response.ok) throw new Error(`Model provider returned ${response.status}: ${(await response.text()).slice(0, 600)}`); const json = await response.json(); return { text: json.choices?.[0]?.message?.content || '', raw: json };
  }
}
class OllamaProvider {
  constructor({ endpoint = 'http://127.0.0.1:11434', model }) { this.id = 'ollama'; this.endpoint = endpoint.replace(/\/$/, ''); this.model = model; this.supportsTools = true; this.supportsVision = true; }
  async generate(messages, options = {}) { const response = await fetch(`${this.endpoint}/api/chat`, { signal: AbortSignal.timeout(options.timeoutMs || 30000), method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: options.model || this.model, messages, stream: false, format: 'json', think: false, keep_alive: '5m', options: { temperature: options.temperature } }) }); if (!response.ok) throw new Error(`Ollama returned ${response.status}`); const raw = await response.json(); const content = raw.message?.content?.trim(); const thinking = raw.message?.thinking?.trim(); return { text: content || thinking || '', raw }; }
}
class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(config) { super({ ...config, id: 'openai', endpoint: config.endpoint || 'https://api.openai.com/v1' }); }
  async generate(messages, options = {}) { const { temperature, ...supported } = options; return super.generate(messages, supported); }
}
class AnthropicProvider {
  constructor({ endpoint = 'https://api.anthropic.com/v1', apiKey, model }) { Object.assign(this, { id: 'anthropic', endpoint: endpoint.replace(/\/$/, ''), apiKey, model, supportsTools: true, supportsVision: true }); }
  async generate(messages, options = {}) { const response = await fetch(`${this.endpoint}/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: options.model || this.model, max_tokens: options.maxTokens || 2048, messages }) }); if (!response.ok) throw new Error(`Anthropic returned ${response.status}`); const raw = await response.json(); return { text: raw.content?.map((part) => part.text || '').join('') || '', raw }; }
}
function createProvider(config) { if (config.provider === 'ollama') return new OllamaProvider(config); if (config.provider === 'openai') return new OpenAIProvider(config); if (config.provider === 'anthropic') return new AnthropicProvider(config); return new OpenAICompatibleProvider(config); }
module.exports = { createProvider, OpenAICompatibleProvider, OllamaProvider, OpenAIProvider, AnthropicProvider };
