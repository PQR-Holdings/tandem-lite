class ModelPlanner {
  constructor(provider, fallback, { timeoutMs = 30000 } = {}) { this.provider = provider; this.fallback = fallback; this.timeoutMs = timeoutMs; this.lastResult = { source: 'uninitialized' }; }
  async plan(objective, workspaceRoot) {
    if (!this.provider) { this.lastResult = { source: 'fallback', reason: 'No model is configured.' }; return this.fallback.plan(objective, workspaceRoot); }
    const userHome = require('node:os').homedir();
    const platform = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : process.platform;
    const prompt = `Create a concise executable plan for ${platform}. Return JSON only: {"steps":[{"id":"short-id","intent":"user-facing description","action":{"tool":"tool-name","input":{}}}]}. Tools: files (workspace-only), git, terminal.execute, processes, http.request, windows.open, windows.find_files, applications.search, applications.open, windows.list, windows.focus, windows.close, ui.inspect, ui.focus, ui.invoke, ui.set_value. The legacy windows.* tool names work on both Windows and macOS. For apps: applications.search {query}, then applications.open {appFromStep:"search-id"}. For existing windows: windows.list {query}, then focus/close {windowFromStep:"list-id"}. For UI: windows.list, ui.inspect {windowFromStep:"list-id"}, then ui.invoke/set_value with {windowFromStep:"list-id",controlFromStep:"inspect-id",index:0,value:"..."}. *FromStep fields resolve live execution results. For files use windows.find_files and windows.open {pathFromStep:"find-id"}. Personal files/Desktop/Pictures should use ${userHome}, not workspace ${workspaceRoot}, unless workspace is requested. Include only relevant steps; never add workspace/Git inspection by default. Objective: ${objective}`;
    try {
      // The model enhances plans but must never leave the UI indefinitely planning.
      const response = await this.provider.generate([{ role: 'user', content: prompt }], { temperature: 0, timeoutMs: this.timeoutMs, json: true });
      const parsed = JSON.parse(response.text.replace(/^```json\s*|```$/g, '').trim());
      if (!Array.isArray(parsed.steps) || !parsed.steps.length) throw new Error('Model supplied no plan steps.');
      const steps = parsed.steps.map((step, index) => ({ id: step.id || `step-${index + 1}`, intent: String(step.intent || 'Perform task step'), action: step.action, expected: step.expected }));
      this.lastResult = { source: 'model', model: this.provider.model };
      return steps;
    } catch (error) { this.lastResult = { source: 'failed', reason: error.message, model: this.provider.model }; throw new Error(`Configured model planning failed (${this.provider.id}/${this.provider.model}): ${error.message}`); }
  }
  async recover({ objective, step, failure, workspaceRoot, attempt }) {
    if (!this.provider) return undefined;
    const prompt = `An action failed. Return one distinct recovery step as JSON only: {"id":"recovery-${attempt}","intent":"description","action":{"tool":"tool-name","input":{}}}. Available tools: files, git, terminal.execute, processes, http.request, windows.open, windows.find_files, applications.search, applications.open, windows.list, windows.focus, windows.close, ui.inspect, ui.focus, ui.invoke, ui.set_value. Use *FromStep references to live prior results when useful. Objective: ${objective}. Failed step: ${JSON.stringify(step)}. Failure: ${JSON.stringify(failure)}. Workspace: ${workspaceRoot}`;
    try {
      const response = await this.provider.generate([{ role: 'user', content: prompt }], { temperature: 0, timeoutMs: this.timeoutMs });
      const parsed = JSON.parse(response.text.replace(/^```json\s*|```$/g, '').trim());
      if (!parsed.action?.tool) throw new Error('Recovery plan is missing an action.');
      const intent = String(parsed.intent || '').trim();
      return { id: parsed.id || `recovery-${attempt}`, intent: !intent || /^informative( user-facing)? description$/i.test(intent) ? `Retry: ${step.intent}` : intent, action: parsed.action, expected: parsed.expected };
    } catch { return undefined; }
  }
}
module.exports = { ModelPlanner };
