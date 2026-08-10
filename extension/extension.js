const vscode = require('vscode');
const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

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
    // On Windows, terminate the full runtime tree so a long-running scan cannot outlive its cancelled Node host.
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
    view.webview.html = this.html(scriptUri, view.webview.cspSource);
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
    return { provider, profiles: { ollama: profile('ollama'), openai: profile('openai'), anthropic: profile('anthropic'), 'openai-compatible': profile('openai-compatible') }, advanced: { visionFallback: config.get('model.visionFallback'), statusModel: config.get('model.statusModel'), planningTimeoutMs: config.get('model.planningTimeoutMs'), executionTimeoutMs: config.get('execution.timeoutMs'), permissions: { terminal: config.get('permissions.terminal'), windows: config.get('permissions.windows'), desktopControl: config.get('permissions.desktopControl'), fileScan: config.get('permissions.fileScan'), network: config.get('permissions.network') } } };
  }
  openSettingsPanel() {
    if (this.settingsPanel) { this.settingsPanel.reveal(vscode.ViewColumn.Active); this.settingsPanel.webview.postMessage({ type: 'settings', settings: this.publicSettings() }); return; }
    const panel = vscode.window.createWebviewPanel('developerAgent.settings', 'Developer Agent Settings', vscode.ViewColumn.Active, { enableScripts: true });
    this.settingsPanel = panel;
    const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'settings.js'));
    panel.webview.html = this.settingsHtml(scriptUri, panel.webview.cspSource);
    panel.onDidDispose(() => { if (this.settingsPanel === panel) this.settingsPanel = undefined; });
    panel.webview.onDidReceiveMessage(async (message) => { if (message.type === 'ready') panel.webview.postMessage({ type: 'settings', settings: this.publicSettings() }); if (message.type === 'saveSettings') await this.saveSettings(message.settings); });
  }
  async saveSettings(settings = {}) {
    const provider = settings.provider;
    if (!['ollama', 'openai', 'anthropic', 'openai-compatible'].includes(provider)) throw new Error('Unsupported provider.');
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
  settingsHtml(scriptUri, cspSource) { return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${cspSource};"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:12px;max-width:560px}h3{margin:28px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--vscode-panel-border)}label{display:block;margin-top:12px}input,select{box-sizing:border-box;width:100%;margin-top:5px;padding:7px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);font:inherit}button{margin-top:18px;padding:7px 12px;border:0;color:white;background:#238636;font:inherit;cursor:pointer}.muted{color:var(--vscode-descriptionForeground)}</style></head><body><h2>Developer Agent Settings</h2><p class="muted">Provider credentials are stored securely by VS Code.</p><label>Provider<select id="provider"><option value="ollama">Ollama</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="openai-compatible">OpenAI-compatible</option></select></label><label>Model<input id="model"></label><label>Endpoint<input id="endpoint"></label><label id="keyLabel">API key<input id="apiKey" type="password" placeholder="Leave blank to keep the stored key"></label><h3>Agent behavior &amp; permissions</h3><label>Vision fallback model<input id="visionFallback"></label><label>Status model <span class="muted">(blank = built-in text)</span><input id="statusModel"></label><label>Planning timeout (ms)<input id="planningTimeoutMs" type="number" min="3000" max="60000"></label><label>Execution timeout (ms)<input id="executionTimeoutMs" type="number" min="30000" max="1800000"></label><label>Terminal commands<select id="permissionTerminal"><option value="ask">Ask</option><option value="allow">Allow</option><option value="deny">Deny</option></select></label><label>Open applications/files/folders<select id="permissionWindows"><option value="ask">Ask</option><option value="allow">Allow</option><option value="deny">Deny</option></select></label><label>Control windows and UI<select id="permissionDesktopControl"><option value="ask">Ask</option><option value="allow">Allow</option><option value="deny">Deny</option></select></label><label>Scan outside workspace<select id="permissionFileScan"><option value="ask">Ask</option><option value="allow">Allow</option><option value="deny">Deny</option></select></label><label>External network<select id="permissionNetwork"><option value="ask">Ask</option><option value="allow">Allow</option><option value="deny">Deny</option></select></label><button id="save">Save Settings</button><div id="result" class="muted"></div><script src="${scriptUri}"></script></body></html>`; }
  setStepState(step, status) { if (!step?.id) return; this.state.stepStates = { ...(this.state.stepStates || {}), [step.id]: status }; this.render(); }
  async narrate(phase, detail) {
    const ticket = ++this.narrationSequence; const entry = { phase, text: `${phase}${detail ? `: ${detail}` : ''}` }; this.state.activity = [...(this.state.activity || []), entry]; this.state.statusText = entry.text; this.render();
    const config = vscode.workspace.getConfiguration('developerAgent'); const text = await this.narrator.describe(phase, detail, { model: config.get('model.statusModel'), endpoint: config.get('model.endpoint') });
    entry.text = text; if (ticket === this.narrationSequence) this.state.statusText = text; this.render();
  }
  stop() { this.runId += 1; this.client.stop(); this.state = { ...this.state, status: 'stopped', error: 'Execution stopped by user.', outputs: [] }; this.status.text = '$(debug-stop) Agent Stopped'; this.render(); this.narrate('Cancelling', 'Stopping the active work'); }
  async modelConfig() {
    const config = vscode.workspace.getConfiguration('developerAgent'); const provider = config.get('model.provider');
    const plannerSetting = config.inspect('model.planner');
    const configuredPlanner = plannerSetting?.workspaceValue ?? plannerSetting?.globalValue ?? plannerSetting?.workspaceFolderValue;
    const profileModel = config.get(`providers.${provider}.model`);
    const profileEndpoint = config.get(`providers.${provider}.endpoint`);
    const legacyModel = configuredPlanner || config.get('model.model');
    const model = profileModel || (provider === 'openai' && (!legacyModel || legacyModel === 'qwen3:4b') ? 'gpt-5-mini' : legacyModel);
    const endpoint = profileEndpoint || (provider === 'openai' ? 'https://api.openai.com/v1' : config.get('model.endpoint'));
    return { provider, model, visionModel: config.get('model.visionFallback'), planningTimeoutMs: config.get('model.planningTimeoutMs'), endpoint, apiKey: provider === 'ollama' ? undefined : await this.context.secrets.get(`developerAgent.${provider}.apiKey`) };
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
  html(scriptUri, cspSource) {
    return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${cspSource};"></head><body>
      <style>body{color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);padding:0 8px}textarea,input,select{box-sizing:border-box;width:100%;min-height:28px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);font:inherit;padding:6px;resize:vertical}label{display:block;margin-top:7px}button{margin-top:6px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;padding:6px 10px;font:inherit;cursor:pointer}button.secondary{margin-left:6px;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}h3{font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin:16px 0 6px;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:4px}.muted{color:var(--vscode-descriptionForeground)}.status-line{display:flex;align-items:center;justify-content:space-between;gap:8px}.status-main{display:flex;align-items:center;gap:7px;min-width:0}.status-spinner{width:12px;height:12px;box-sizing:border-box;border:2px solid color-mix(in srgb,#58a6ff 24%,transparent);border-top-color:#58a6ff;border-right-color:#79c0ff;border-radius:50%;animation:agent-spin .75s linear infinite;filter:drop-shadow(0 0 2px color-mix(in srgb,#58a6ff 45%,transparent))}.stop-square{position:relative;width:26px;height:26px;min-height:26px;margin:0;padding:0;border:1px solid color-mix(in srgb,#f85149 70%,transparent);border-radius:7px;background:color-mix(in srgb,#f85149 10%,transparent);transition:background .15s,border-color .15s,transform .15s}.stop-square::after{content:'';position:absolute;inset:7px;border-radius:2px;background:#f85149}.stop-square:not(:disabled):hover{background:color-mix(in srgb,#f85149 22%,transparent);border-color:#f85149}.stop-square:not(:disabled):active{transform:scale(.93)}.stop-square:not(:disabled):focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}.stop-square:disabled{border-color:var(--vscode-disabledForeground);background:transparent;cursor:not-allowed;opacity:.45}.stop-square:disabled::after{background:var(--vscode-disabledForeground)}#planActions{display:flex;align-items:center;gap:7px;margin-top:10px}#planActions button{margin:0;border-radius:7px;padding:6px 10px;border:1px solid transparent;font-weight:600;letter-spacing:.01em;transition:background .15s,border-color .15s,transform .15s}#planActions button:hover{transform:translateY(-1px)}#planActions button:active{transform:translateY(0)}#planActions button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}#planActions .approve{background:#238636;color:#fff;box-shadow:0 1px 2px color-mix(in srgb,#238636 42%,transparent)}#planActions .approve:hover{background:#2ea043}#planActions .deny{background:transparent;border-color:color-mix(in srgb,#f85149 55%,transparent);color:#ff7b72}#planActions .deny:hover{background:color-mix(in srgb,#f85149 13%,transparent);border-color:#f85149}#planActions .modify{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}#planActions .modify:hover{background:var(--vscode-button-hoverBackground)}ul,ol{padding-left:18px;margin:6px 0}li{margin:4px 0}.plan-step{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.step-icon{display:inline-block;width:16px;font-weight:bold}.step-icon.succeeded{color:#3fb950}.step-icon.failed{color:#f85149}.step-icon.unverified{color:#d29922}.step-icon.pending{color:var(--vscode-descriptionForeground)}.spinning{animation:agent-spin 1s linear infinite}@keyframes agent-spin{to{transform:rotate(360deg)}}pre{white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;padding:6px;background:var(--vscode-textCodeBlock-background);font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size)}</style>
      <textarea id="input" aria-label="Agent objective or editable plan" placeholder="What should the agent do?\n\nRun this application and fix whatever prevents it from starting."></textarea>
      <button id="run">Execute</button><button id="settings" class="secondary">Settings</button>
      <h3>Status</h3><div class="status-line"><div class="status-main"><span id="statusSpinner" class="status-spinner" hidden aria-hidden="true"></span><div id="status" class="muted">Idle</div></div><button id="stop" class="stop-square" disabled aria-label="Stop active work" title="Stop active work"></button></div><ol id="plan" hidden></ol><div id="planActions" hidden><button id="approve" class="approve">Approve</button><button id="deny" class="deny">Deny</button><button id="modify" class="modify">Modify</button></div><textarea id="editor" aria-label="Edit plan JSON" hidden></textarea><div id="editorActions" hidden><button id="savePlan" class="secondary">Save Changes</button><button id="cancelEdit" class="secondary">Cancel</button></div><h3>Activity</h3><ul id="timeline" class="muted"></ul><h3>Details</h3><pre id="details" class="muted">No output yet.</pre>
      <script>const vscode=acquireVsCodeApi(),input=document.getElementById('input'),run=document.getElementById('run'),status=document.getElementById('status'),planEl=document.getElementById('plan'),actions=document.getElementById('planActions'),editor=document.getElementById('editor'),editorActions=document.getElementById('editorActions'),details=document.getElementById('details');let plannedObjective='',currentPlan=[];const esc=v=>String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const hideEditor=()=>{editor.hidden=true;editorActions.hidden=true};run.onclick=()=>{const objective=input.value.trim();if(!objective){status.textContent='Enter an objective above before creating a plan.';return}plannedObjective=objective;status.textContent='Sending plan request...';details.textContent='Waiting for the extension host...';vscode.postMessage({type:'run',objective:plannedObjective})};document.getElementById('approve').onclick=()=>vscode.postMessage({type:'execute',objective:plannedObjective,plan:JSON.stringify(currentPlan)});document.getElementById('deny').onclick=()=>{vscode.postMessage({type:'deny'});plannedObjective='';currentPlan=[];planEl.hidden=true;actions.hidden=true;hideEditor();input.value=''};document.getElementById('modify').onclick=()=>{editor.value=JSON.stringify(currentPlan,null,2);editor.hidden=false;editorActions.hidden=false};document.getElementById('savePlan').onclick=()=>{try{const edited=JSON.parse(editor.value);if(!Array.isArray(edited))throw new Error('Plan must be an array.');currentPlan=edited;planEl.innerHTML=currentPlan.map((step,i)=>'<li class="plan-step">'+(i+1)+'. '+esc(step.intent||step.id||'Untitled step')+'</li>').join('');hideEditor()}catch(error){details.textContent='Plan edit error: '+error.message}};document.getElementById('cancelEdit').onclick=hideEditor;document.getElementById('settings').onclick=()=>vscode.postMessage({type:'settings'});document.getElementById('key').onclick=()=>vscode.postMessage({type:'apiKey'});input.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();run.click()}};window.addEventListener('message',e=>{const s=e.data.state;if(!s)return;const ready=s.status==='awaiting_plan_approval'&&Array.isArray(s.plan)&&s.plan.length>0;status.textContent=s.status||'idle';if(ready){plannedObjective=s.objective||plannedObjective;currentPlan=s.plan;planEl.innerHTML=currentPlan.map((step,i)=>'<li class="plan-step">'+(i+1)+'. '+esc(step.intent||step.id||'Untitled step')+'</li>').join('');planEl.hidden=false;actions.hidden=false}else if(s.status!=='awaiting_plan_approval'){actions.hidden=true;if(s.status==='planning')planEl.hidden=true}const timeline=s.timeline||[];document.getElementById('timeline').innerHTML=timeline.map(x=>'<li>'+esc((x.verification?.status==='verified'?'Verified: ':'')+(x.intent||x.stepId||'Working'))+'</li>').join('')||'<li>Waiting for an objective.</li>';const output=(s.outputs||[]).join('');const errors=[s.error,...(s.errors||[]).map(x=>x.verification?.detail||x.result?.error||JSON.stringify(x))].filter(Boolean).join('\n');const commandOutput=timeline.map(x=>x.result?.output).filter(Boolean).join('\n');details.textContent=[output,errors,commandOutput].filter(Boolean).join('\n\n')||'No output yet.'})</script>
      <script src="${scriptUri}"></script></body></html>`;
  }
}

function activate(context) {
  const output = vscode.window.createOutputChannel('Developer Agent'); const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left); status.text = '$(sparkle) Agent'; status.command = 'developerAgent.showActivity'; status.show();
  const sidebar = new AgentSidebarProvider(context, output, status);
  async function configureProvider() {
    const config = vscode.workspace.getConfiguration('developerAgent');
    const provider = await vscode.window.showQuickPick(['ollama', 'openai', 'anthropic', 'openai-compatible'], { placeHolder: 'Select the model provider' });
    if (!provider) return;
    await config.update('model.provider', provider, vscode.ConfigurationTarget.Global);
    const modelKey = `providers.${provider}.model`; const endpointKey = `providers.${provider}.endpoint`;
    const fallbackModel = provider === 'openai' ? 'gpt-5-mini' : provider === 'ollama' ? 'qwen3:4b' : '';
    const model = await vscode.window.showInputBox({ prompt: `${provider} planner model`, value: config.get(modelKey, fallbackModel), ignoreFocusOut: true });
    if (model !== undefined) await config.update(modelKey, model, vscode.ConfigurationTarget.Global);
    const fallbackEndpoint = provider === 'openai' ? 'https://api.openai.com/v1' : provider === 'ollama' ? 'http://127.0.0.1:11434' : '';
    const endpoint = await vscode.window.showInputBox({ prompt: `${provider} endpoint`, value: config.get(endpointKey, fallbackEndpoint), ignoreFocusOut: true });
    if (endpoint !== undefined) await config.update(endpointKey, endpoint, vscode.ConfigurationTarget.Global);
    if (provider !== 'ollama') await vscode.commands.executeCommand('developerAgent.setApiKey');
    vscode.window.showInformationMessage(`Developer Agent configured for ${provider}.`);
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
