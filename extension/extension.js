const vscode = require('vscode');
const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createProvider } = require('../runtime/models/providers');

const PROVIDERS = {
  ollama: { model: 'qwen3:4b', endpoint: 'http://127.0.0.1:11434', requiresKey: false },
  openai: { model: 'gpt-5.6-terra', endpoint: 'https://api.openai.com/v1', requiresKey: true },
  anthropic: { model: 'claude-sonnet-5', endpoint: 'https://api.anthropic.com/v1', requiresKey: true },
  gemini: { model: 'gemini-3.6-flash', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', requiresKey: true },
  'openai-compatible': { model: '', endpoint: '', requiresKey: true }
};

class StatusNarrator {
  async describe(phase, detail, config) {
    const fallback = `${phase}${detail ? `: ${detail}` : ''}`;
    if (!config.model) return fallback;
    try {
      const response = await fetch(`${config.endpoint.replace(/\/$/, '')}/api/chat`, { signal: AbortSignal.timeout(4000), method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: config.model, stream: false, think: false, format: 'json', options: { temperature: 0 }, messages: [{ role: 'user', content: `In 3 to 7 plain words, describe this computer-agent event. Return JSON only: {"text":"..."}. Event: ${phase}. Detail: ${detail || 'none'}.` }] }) });
      if (!response.ok) throw new Error(String(response.status));
      const parsed = JSON.parse((await response.json()).message?.content || '{}');
      return typeof parsed.text === 'string' && parsed.text.trim() ? parsed.text.trim().slice(0, 100) : fallback;
    } catch { return fallback; }
  }
}

class RuntimeClient {
  constructor(context, output) { this.context = context; this.output = output; this.active = undefined; this.registryPath = path.join(os.tmpdir(), 'developer-computer-agent-runtime.json'); }
  stopOrphanedRuntime() {
    try {
      const entry = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
      if (entry.pid && entry.pid !== process.pid && process.platform === 'win32') cp.spawnSync('taskkill.exe', ['/PID', String(entry.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch { /* No active or readable registry. */ }
  }
  stop() {
    const active = this.active;
    if (!active) return;
    // On Windows, terminate the full runtime tree so a long-running task cannot outlive its cancelled Node host.
    if (process.platform === 'win32' && active.child.pid) {
      const killer = cp.spawn('taskkill.exe', ['/PID', String(active.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.unref();
    }
    active.cancel();
  }
  request(method, params, onEvent) {
    return new Promise((resolve, reject) => {
      this.stop();
      this.stopOrphanedRuntime();
      const child = cp.spawn(process.execPath, [path.join(this.context.extensionPath, 'runtime', 'server.js')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let buffer = ''; let settled = false; let timeout;
      const timeoutMs = method === 'plan' ? Math.max(25000, Number(params.modelConfig?.planningTimeoutMs || 30000) + 5000) : Number(params.executionTimeoutMs || 600000);
      const finish = (callback, value) => { if (settled) return; settled = true; clearTimeout(timeout); if (this.active?.child === child) this.active = undefined; callback(value); };
      timeout = setTimeout(() => { child.kill(); const detail = method === 'plan' ? 'The model did not return a plan in time.' : 'The runtime did not complete the approved action in time.'; finish(reject, new Error(`${method} timed out. ${detail}`)); }, timeoutMs);
      this.active = { child, cancel: () => { child.kill(); finish(reject, new Error('Execution stopped by user.')); } };
      child.stdout.on('data', (data) => {
        buffer += data; const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) { if (!line) continue; const event = JSON.parse(line); if (event.type === 'result') { child.kill(); finish(resolve, event.result); } else if (event.type === 'error') { child.kill(); finish(reject, new Error(event.error)); } else onEvent(event); }
      });
      child.stderr.on('data', (data) => this.output.append(String(data)));
      child.once('error', (error) => finish(reject, error));
      child.once('close', (code) => { if (!settled) finish(reject, new Error(`Agent runtime exited unexpectedly (code ${code}).`)); });
      child.stdin.write(`${JSON.stringify({ id: method, method, params })}\n`);
    });
  }
}

class AgentSidebarProvider {
  constructor(context, output, status) { this.context = context; this.output = output; this.status = status; this.client = new RuntimeClient(context, output); this.narrator = new StatusNarrator(); this.narrationSequence = 0; this.runId = 0; this.view = undefined; this.state = { status: 'idle', objective: '', timeline: [], activity: [] }; }
  resolveWebviewView(view) {
    this.view = view; view.webview.options = { enableScripts: true };
    const scriptUri = view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.js'));
    const styleUri = view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.css'));
    const iconUri = view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon.png'));
    view.webview.html = this.html(scriptUri, styleUri, iconUri, view.webview.cspSource);
    view.webview.onDidReceiveMessage(async (message) => {
      this.output.appendLine(`Sidebar message received: ${message.type}`);
      try {
        if (message.type === 'run') await this.plan(message.objective);
        if (message.type === 'execute') await this.execute(message.objective, message.plan);
        if (message.type === 'deny') { this.state = { status: 'idle', objective: '', timeline: [] }; this.status.text = '$(circle-slash) Agent Plan Denied'; this.render(); }
        if (message.type === 'stop') this.stop();
        if (message.type === 'settings') this.openSettingsPanel();
      } catch (error) {
        this.state = { ...this.state, status: 'failed', error: error.message };
        this.status.text = '$(error) Agent'; this.render(); this.output.appendLine(error.stack || error.message);
      }
    });
    this.render();
  }
  render() { this.view?.webview.postMessage({ type: 'state', state: this.state }); }
  publicSettings() {
    const config = vscode.workspace.getConfiguration('developerAgent');
    const provider = config.get('model.provider');
    const profile = (name) => ({ model: config.get(`providers.${name}.model`, ''), endpoint: config.get(`providers.${name}.endpoint`, '') });
    return { provider, profiles: Object.fromEntries(Object.keys(PROVIDERS).map((name) => [name, profile(name)])), advanced: { visionFallback: config.get('model.visionFallback'), statusModel: config.get('model.statusModel'), planningTimeoutMs: config.get('model.planningTimeoutMs'), executionTimeoutMs: config.get('execution.timeoutMs'), permissions: { terminal: config.get('permissions.terminal'), windows: config.get('permissions.windows'), desktopControl: config.get('permissions.desktopControl'), fileScan: config.get('permissions.fileScan'), network: config.get('permissions.network') } } };
  }
  openSettingsPanel() {
    if (this.settingsPanel) { this.settingsPanel.reveal(vscode.ViewColumn.Active); this.settingsPanel.webview.postMessage({ type: 'settings', settings: this.publicSettings() }); return; }
    const panel = vscode.window.createWebviewPanel('developerAgent.settings', 'Tandem Lite Settings', vscode.ViewColumn.Active, { enableScripts: true });
    this.settingsPanel = panel;
    const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'settings.js'));
    const styleUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'settings.css'));
    const iconUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon.png'));
    panel.webview.html = this.settingsHtml(scriptUri, styleUri, iconUri, panel.webview.cspSource);
    panel.onDidDispose(() => { if (this.settingsPanel === panel) this.settingsPanel = undefined; });
    panel.webview.onDidReceiveMessage(async (message) => {
      try {
        if (message.type === 'ready') panel.webview.postMessage({ type: 'settings', settings: this.publicSettings() });
        if (message.type === 'saveSettings') await this.saveSettings(message.settings);
        if (message.type === 'testConnection') await this.testConnection(message.settings);
      } catch (error) { panel.webview.postMessage({ type: 'settingsError', error: error.message }); }
    });
  }
  async saveSettings(settings = {}) {
    const provider = settings.provider;
    if (!PROVIDERS[provider]) throw new Error('Unsupported provider.');
    if (!settings.model?.trim() || !settings.endpoint?.trim()) throw new Error('A model and endpoint are required.');
    if (PROVIDERS[provider].requiresKey && !settings.apiKey?.trim() && !await this.context.secrets.get(`developerAgent.${provider}.apiKey`)) throw new Error(`Enter an API key for ${provider}.`);
    const config = vscode.workspace.getConfiguration('developerAgent');
    await config.update('model.provider', provider, vscode.ConfigurationTarget.Global);
    await config.update(`providers.${provider}.model`, settings.model || '', vscode.ConfigurationTarget.Global);
    await config.update(`providers.${provider}.endpoint`, settings.endpoint || '', vscode.ConfigurationTarget.Global);
    const advanced = settings.advanced || {};
    if (advanced.visionFallback !== undefined) await config.update('model.visionFallback', advanced.visionFallback, vscode.ConfigurationTarget.Global);
    if (advanced.statusModel !== undefined) await config.update('model.statusModel', advanced.statusModel, vscode.ConfigurationTarget.Global);
    if (String(advanced.planningTimeoutMs || '').trim()) await config.update('model.planningTimeoutMs', Number(advanced.planningTimeoutMs), vscode.ConfigurationTarget.Global);
    if (String(advanced.executionTimeoutMs || '').trim()) await config.update('execution.timeoutMs', Number(advanced.executionTimeoutMs), vscode.ConfigurationTarget.Global);
    for (const name of ['terminal', 'windows', 'desktopControl', 'fileScan', 'network']) if (advanced.permissions?.[name]) await config.update(`permissions.${name}`, advanced.permissions[name], vscode.ConfigurationTarget.Global);
    if (provider !== 'ollama' && settings.apiKey?.trim()) await this.context.secrets.store(`developerAgent.${provider}.apiKey`, settings.apiKey.trim());
    this.settingsPanel?.webview.postMessage({ type: 'settingsSaved', settings: this.publicSettings() });
  }
  async testConnection(settings = {}) {
    try {
      if (!PROVIDERS[settings.provider]) throw new Error('Unsupported provider.');
      const apiKey = settings.provider === 'ollama' ? undefined : settings.apiKey?.trim() || await this.context.secrets.get(`developerAgent.${settings.provider}.apiKey`);
      if (PROVIDERS[settings.provider].requiresKey && !apiKey) throw new Error('Enter an API key or save one first.');
      const adapter = createProvider({ provider: settings.provider, model: settings.model, endpoint: settings.endpoint, apiKey });
      await adapter.generate([{ role: 'user', content: 'Reply with OK.' }], { timeoutMs: 10000, maxTokens: 8 });
      this.settingsPanel?.webview.postMessage({ type: 'connectionResult', ok: true });
    } catch (error) { this.settingsPanel?.webview.postMessage({ type: 'connectionResult', ok: false, error: error.message }); }
  }
  settingsHtml(scriptUri, styleUri, iconUri, cspSource) { return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src ${cspSource}; script-src ${cspSource};">
<link rel="stylesheet" href="${styleUri}"><title>Tandem Lite Settings</title></head><body><main>
<header class="hero"><img class="mark" src="${iconUri}" alt=""><div><h1>Tandem Lite</h1><p>Agent settings</p></div></header>
<form id="settingsForm">
<section class="card"><div class="section-heading"><h2>Model provider</h2><p>Choose where Tandem creates plans.</p></div>
<label>Provider<select id="provider"><option value="ollama">Ollama</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Google Gemini</option><option value="openai-compatible">OpenAI-compatible</option></select></label>
<label>Model<input id="model" autocomplete="off"><span class="hint">The model used to create reviewable plans.</span></label>
<label>Endpoint<input id="endpoint" inputmode="url" autocomplete="url"></label>
<label id="keyLabel">API key<input id="apiKey" type="password" autocomplete="off" placeholder="Leave blank to keep the stored key"><span class="hint">Stored securely by VS Code SecretStorage.</span></label></section>
<section class="card"><div class="section-heading"><h2>Agent behavior</h2><p>Control fallback models and runtime limits.</p></div>
<label>Vision fallback model<input id="visionFallback" autocomplete="off"></label>
<label>Ollama status model<input id="statusModel" autocomplete="off"><span class="hint">Used only with Ollama. Other providers use built-in status text.</span></label>
<div class="field-grid"><label>Planning timeout (ms)<input id="planningTimeoutMs" type="number" min="3000" max="60000"></label><label>Execution timeout (ms)<input id="executionTimeoutMs" type="number" min="30000" max="1800000"></label></div></section>
<section class="card"><div class="section-heading"><h2>Permissions</h2><p>Choose whether each capability is allowed, denied, or asks first.</p></div>
${[['Terminal commands','permissionTerminal','Run commands in the workspace.'],['Open apps and paths','permissionWindows','Open applications, files, and folders.'],['Control windows and UI','permissionDesktopControl','Interact with accessible desktop controls.'],['Scan outside workspace','permissionFileScan','Read directories beyond the open workspace.'],['External network','permissionNetwork','Make requests to external services.']].map(([label,id,hint]) => `<label class="permission"><span><strong>${label}</strong><small>${hint}</small></span><select id="${id}" aria-label="${label}"><option value="ask">Ask</option><option value="allow">Allow</option><option value="deny">Deny</option></select></label>`).join('')}</section>
<div class="save-row"><button id="save" type="submit">Save settings</button><button id="testConnection" class="secondary" type="button">Test connection</button><div id="result" role="status" aria-live="polite"></div></div>
</form></main><script src="${scriptUri}"></script></body></html>`; }
  setStepState(step, status) { if (!step?.id) return; this.state.stepStates = { ...(this.state.stepStates || {}), [step.id]: status }; this.render(); }
  async narrate(phase, detail) {
    const ticket = ++this.narrationSequence; const entry = { phase, text: `${phase}${detail ? `: ${detail}` : ''}` }; this.state.activity = [...(this.state.activity || []), entry]; this.state.statusText = entry.text; this.render();
    const config = vscode.workspace.getConfiguration('developerAgent'); const isOllama = config.get('model.provider') === 'ollama'; const text = await this.narrator.describe(phase, detail, { model: isOllama ? config.get('model.statusModel') : '', endpoint: config.get('providers.ollama.endpoint') });
    entry.text = text; if (ticket === this.narrationSequence) this.state.statusText = text; this.render();
  }
  stop() { this.runId += 1; this.client.stop(); this.state = { ...this.state, status: 'stopped', error: 'Execution stopped by user.', outputs: [] }; this.status.text = '$(debug-stop) Agent Stopped'; this.render(); this.narrate('Cancelling', 'Stopping the active work'); }
  async modelConfig() {
    const config = vscode.workspace.getConfiguration('developerAgent'); const provider = config.get('model.provider');
    const defaults = PROVIDERS[provider];
    if (!defaults) throw new Error(`Unsupported model provider: ${provider}`);
    const model = config.get(`providers.${provider}.model`) || defaults.model;
    const endpoint = config.get(`providers.${provider}.endpoint`) || defaults.endpoint;
    const apiKey = defaults.requiresKey ? await this.context.secrets.get(`developerAgent.${provider}.apiKey`) : undefined;
    if (!model) throw new Error(`Configure a model for ${provider}.`);
    if (!endpoint) throw new Error(`Configure an endpoint for ${provider}.`);
    if (defaults.requiresKey && !apiKey) throw new Error(`Set an API key for ${provider} before planning.`);
    return { provider, model, visionModel: config.get('model.visionFallback'), planningTimeoutMs: config.get('model.planningTimeoutMs'), endpoint, apiKey };
  }
  async plan(objective) {
    if (!objective?.trim()) return;
    const runId = ++this.runId;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return vscode.window.showWarningMessage('Open a workspace before running the agent.');
    this.state = { status: 'planning', objective, timeline: [], activity: [], plan: [], stepStates: {}, outputs: [], errors: [], error: undefined, planner: undefined, freshPlan: true }; this.status.text = '$(sync~spin) Agent'; this.render(); this.narrate('Planning', objective); this.output.appendLine(`${new Date().toLocaleTimeString()} Objective started: ${objective}`);
    try {
      const config = vscode.workspace.getConfiguration('developerAgent'); const modelConfig = await this.modelConfig();
      const result = await this.client.request('plan', { objective, workspaceRoot: root, policy: { 'terminal.execute': config.get('permissions.terminal', 'ask'), 'windows.open': config.get('permissions.windows', 'ask'), 'files.scan': config.get('permissions.fileScan', 'ask'), 'desktop.control': config.get('permissions.desktopControl', 'ask'), 'http.external': config.get('permissions.network', 'ask') }, modelConfig }, (event) => { if (runId === this.runId && event.type === 'state') { this.state = { ...event.state, activity: this.state.activity || [] }; this.render(); } });
      if (runId !== this.runId) return;
      this.state = { ...(result.state || { status: result.status, objective, timeline: [] }), activity: this.state.activity || [], stepStates: Object.fromEntries((result.plan || []).map((step) => [step.id, 'pending'])) };
      this.state.plan = result.plan; this.status.text = '$(warning) Agent Plan Ready'; this.render();
    } catch (error) { if (runId !== this.runId || error.message === 'Execution stopped by user.') return; this.state = { ...this.state, status: 'failed', error: error.message }; this.status.text = '$(error) Agent'; this.render(); this.output.appendLine(error.stack || error.message); }
  }
  async execute(objective, planText, allowedPermissions = []) {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; if (!root) return;
    const runId = this.runId;
    let plan; try { plan = JSON.parse(planText); if (!Array.isArray(plan)) throw new Error('Plan must be a JSON array.'); } catch (error) { return vscode.window.showErrorMessage(`Invalid edited plan: ${error.message}`); }
    const config = vscode.workspace.getConfiguration('developerAgent'); this.state.status = 'running'; this.state.outputs = []; this.state.stepStates = Object.fromEntries(plan.map((step) => [step.id, 'pending'])); this.render(); this.narrate('Executing', 'Starting the approved plan'); this.status.text = '$(sync~spin) Agent';
    try {
      const result = await this.client.request('execute', { objective, plan, workspaceRoot: root, executionTimeoutMs: config.get('execution.timeoutMs', 600000), policy: { 'terminal.execute': config.get('permissions.terminal', 'ask'), 'windows.open': config.get('permissions.windows', 'ask'), 'files.scan': config.get('permissions.fileScan', 'ask'), 'desktop.control': config.get('permissions.desktopControl', 'ask'), 'http.external': config.get('permissions.network', 'ask') }, allowedPermissions, modelConfig: await this.modelConfig() }, (event) => {
        if (runId !== this.runId) return;
        if (event.type === 'state') { this.state = { ...event.state, outputs: this.state.outputs || [], activity: this.state.activity || [], stepStates: this.state.stepStates || {} }; this.render(); }
        if (event.type === 'output') { this.output.append(event.text); this.state.outputs = [...(this.state.outputs || []), event.text]; this.render(); }
        const planStep = event.planStepId ? { ...event.step, id: event.planStepId } : event.step;
        if (event.type === 'step_started') { this.setStepState(planStep, 'executing'); this.narrate('Executing', event.step?.intent); }
        if (event.type === 'step_verifying') { this.setStepState(planStep, 'executing'); this.narrate('Verifying', event.step?.intent); }
        if (event.type === 'step_retrying') { this.setStepState(planStep, 'retrying'); this.narrate('Troubleshooting and retrying', event.step?.intent); }
        if (event.type === 'step_finished') this.setStepState(planStep, event.verification?.status === 'verified' ? 'succeeded' : event.verification?.status === 'inconclusive' ? 'unverified' : 'failed');
      });
      if (runId !== this.runId) return;
      this.state = { ...(result.state || this.state), outputs: this.state.outputs || [], activity: this.state.activity || [], stepStates: this.state.stepStates || {} }; this.status.text = result.status === 'completed' ? '$(check) Agent' : result.status === 'failed' ? '$(error) Agent' : '$(warning) Agent Approval'; this.render(); this.narrate(result.status === 'completed' ? 'Completed' : result.status === 'failed' ? 'Failed' : 'Awaiting approval', result.state?.errors?.[0]?.verification?.detail || '');
      if (result.status === 'waiting_for_approval') {
        const allow = await vscode.window.showWarningMessage(`Approval required: ${result.approval.permission}`, 'Allow Once', 'Deny');
        if (allow === 'Allow Once') return this.execute(objective, planText, [...allowedPermissions, result.approval.permission]);
      }
    } catch (error) { if (runId !== this.runId || error.message === 'Execution stopped by user.') return; this.state = { ...this.state, status: 'failed', error: error.message }; this.status.text = '$(error) Agent'; this.render(); this.output.appendLine(error.stack || error.message); }
  }
  html(scriptUri, styleUri, iconUri, cspSource) {
    return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src ${cspSource}; script-src ${cspSource};">
      <link rel="stylesheet" href="${styleUri}"><title>Tandem Lite</title></head><body>
      <main><section class="hero"><div class="brand"><img class="mark" src="${iconUri}" alt=""><div class="brand-copy"><h1>Tandem Lite</h1><div class="eyebrow">Your execution companion</div></div><button id="settings" class="icon-button" aria-label="Open settings" title="Open settings">&#9881;</button></div>
      <label class="sr-only" for="input">Objective</label><textarea id="input" placeholder="Describe what you want Tandem to do…"></textarea>
      <button id="run" class="primary"><span aria-hidden="true">&#10022;</span><span>Create plan</span></button><div class="shortcut">Ctrl/&#8984; + Enter</div></section>
      <section class="status-card" aria-live="polite"><div class="status-top"><span id="statusDot" class="status-dot neutral"></span><div class="status-copy"><strong id="statusTitle">Ready for an objective</strong><span id="status">Describe a task to create a reviewable plan.</span></div><button id="stop" class="stop-button" hidden aria-label="Stop active work" title="Stop active work"><span></span></button></div><div id="progress" class="progress" hidden><span></span></div></section>
      <section id="planSection" hidden><div class="section-head"><h2>Plan</h2><span id="planCount" class="count">0</span></div><div class="card plan-card"><ol id="plan"></ol><p id="reviewNote" class="review-note" hidden>Review commands, paths, applications, and UI actions before approving.</p><div id="planActions" hidden><button id="approve" class="primary">Approve and run</button><div class="button-row"><button id="modify" class="secondary">Edit plan</button><button id="deny" class="quiet danger">Deny</button></div></div><textarea id="editor" class="plan-editor" aria-label="Edit plan JSON" hidden></textarea><div id="editorActions" class="button-row" hidden><button id="savePlan" class="secondary">Save changes</button><button id="cancelEdit" class="quiet">Cancel</button></div></div></section>
      <section id="activitySection" hidden><div class="section-head"><h2>Activity</h2></div><div id="timeline" class="card timeline"></div></section>
      <details id="detailsSection" class="card details-card" hidden><summary><span>Details</span><span id="detailsCount" class="count">0</span><span class="chevron">&#8250;</span></summary><pre id="details">No output yet.</pre></details>
      </main><script src="${scriptUri}"></script></body></html>`;
  }
}

function activate(context) {
  const output = vscode.window.createOutputChannel('Tandem Lite'); const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left); status.text = '$(sparkle) Tandem Lite'; status.command = 'developerAgent.showActivity'; status.show();
  const sidebar = new AgentSidebarProvider(context, output, status);
  async function configureProvider() {
    const config = vscode.workspace.getConfiguration('developerAgent');
    const provider = await vscode.window.showQuickPick(Object.keys(PROVIDERS), { placeHolder: 'Select the model provider' });
    if (!provider) return;
    await config.update('model.provider', provider, vscode.ConfigurationTarget.Global);
    const modelKey = `providers.${provider}.model`; const endpointKey = `providers.${provider}.endpoint`;
    const fallbackModel = PROVIDERS[provider].model;
    const model = await vscode.window.showInputBox({ prompt: `${provider} planner model`, value: config.get(modelKey, fallbackModel), ignoreFocusOut: true });
    if (model !== undefined) await config.update(modelKey, model, vscode.ConfigurationTarget.Global);
    const fallbackEndpoint = PROVIDERS[provider].endpoint;
    const endpoint = await vscode.window.showInputBox({ prompt: `${provider} endpoint`, value: config.get(endpointKey, fallbackEndpoint), ignoreFocusOut: true });
    if (endpoint !== undefined) await config.update(endpointKey, endpoint, vscode.ConfigurationTarget.Global);
    if (provider !== 'ollama') await vscode.commands.executeCommand('developerAgent.setApiKey');
    vscode.window.showInformationMessage(`Tandem Lite configured for ${provider}.`);
  }
  async function askAndRun() { const objective = await vscode.window.showInputBox({ prompt: 'What should the agent do?' }); if (objective) sidebar.plan(objective); }
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('developerAgent.sidebar', sidebar), output, status,
    vscode.commands.registerCommand('developerAgent.runObjective', askAndRun), vscode.commands.registerCommand('developerAgent.showActivity', () => vscode.commands.executeCommand('workbench.view.extension.developerAgent')),
    vscode.commands.registerCommand('developerAgent.pause', () => vscode.window.showInformationMessage('Pause will be available for long-running jobs in the next runtime increment.')),
    vscode.commands.registerCommand('developerAgent.resume', askAndRun), vscode.commands.registerCommand('developerAgent.stop', () => sidebar.stop()),
    vscode.commands.registerCommand('developerAgent.configureModel', () => sidebar.openSettingsPanel()),
    vscode.commands.registerCommand('developerAgent.managePermissions', () => vscode.commands.executeCommand('workbench.action.openSettings', 'developerAgent.permissions')),
    vscode.commands.registerCommand('developerAgent.setApiKey', async () => { const provider = vscode.workspace.getConfiguration('developerAgent').get('model.provider'); if (provider === 'ollama') return vscode.window.showInformationMessage('Ollama does not require an API key.'); const key = await vscode.window.showInputBox({ prompt: `API key for ${provider}`, password: true, ignoreFocusOut: true }); if (key) await context.secrets.store(`developerAgent.${provider}.apiKey`, key); }));
}
function deactivate() {}
module.exports = { activate, deactivate };
