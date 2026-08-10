const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs');
const execFileAsync = promisify(execFile);

function systemApplicationHints(goal = '') {
  if (/\b(background|wallpaper|personalization|theme|display settings)\b/i.test(goal)) return ['Windows Settings'];
  return [];
}

const script = (name) => path.join(__dirname, '..', 'scripts', name);

async function powershell(scriptName, args) {
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script(scriptName), ...args], { windowsHide: true, maxBuffer: 1024 * 1024 });
  return result.stdout.trim();
}

class WindowComputerAdapter {
  constructor({ title, objective, artifactDir = path.join(process.cwd(), 'artifacts'), maxWidth = 1280, availableActions = [] }) {
    this.title = title;
    this.objective = objective || 'Complete the requested computer task safely.';
    this.artifactDir = artifactDir;
    this.maxWidth = Number(maxWidth);
    this.availableActions = availableActions;
    this.applications = null;
    this.tick = 0;
  }
  async capture() {
    fs.mkdirSync(this.artifactDir, { recursive: true });
    const inspectArgs = ['-Goal', this.objective]; if (this.title) inspectArgs.push('-WindowTitle', this.title);
    let ui = null;
    try { ui = JSON.parse(await powershell('inspect-ui.ps1', inspectArgs)); } catch { ui = null; }
    const framePath = path.join(this.artifactDir, 'latest-frame.png');
    let info;
    if (ui?.usable) info = ui.window;
    else {
      const args = ['-OutputPath', framePath, '-MaxWidth', String(this.maxWidth), '-Goal', this.objective];
      if (this.title) args.push('-WindowTitle', this.title);
      info = JSON.parse(await powershell('capture-window.ps1', args));
    }
    if (!this.applications) {
      try { this.applications = JSON.parse(await powershell('discover-applications.ps1', ['-Query', this.objective])); }
      catch { this.applications = []; }
      this.applications = [...new Set([...systemApplicationHints(this.objective), ...this.applications])];
    }
    if (!ui?.usable && !fs.existsSync(framePath)) throw new Error(`Window capture reported success but did not create ${framePath}.`);
    const frameHash = ui?.usable ? require('node:crypto').createHash('sha256').update(JSON.stringify(ui.controls)).digest('hex').slice(0, 12) : require('node:crypto').createHash('sha256').update(fs.readFileSync(framePath)).digest('hex').slice(0, 12);
    let wallpaper;
    if (/\b(background|wallpaper)\b/i.test(this.objective)) {
      try { wallpaper = JSON.parse(await powershell('get-wallpaper.ps1', [])); } catch { wallpaper = undefined; }
    }
    this.latest = { tick: this.tick, terminal: false, objective: this.objective, framePath: ui?.usable ? undefined : framePath, frameHash, window: info, ui: ui?.usable ? { controls: ui.controls } : undefined, wallpaper, availableActions: this.availableActions, applications: this.applications };
    return this.latest;
  }
  observe() { return this.latest || { tick: this.tick, terminal: false, objective: this.objective }; }
  async refresh() { this.tick += 1; return this.capture(); }
}

class WindowsInputAdapter {
  constructor({ title, processId, bindings = {} }) { this.title = title; this.processId = processId; this.bindings = bindings; }
  setProcessId(processId) { this.processId = processId; }
  async apply(action, decision = {}) {
    if (action === 'OPEN_SYSTEM_SETTINGS') {
      try {
        await powershell('open-settings-page.ps1', ['-Page', decision.page]);
        return { status: 'sent', observation: { action, page: decision.page } };
      } catch (error) { return { status: 'failed', observation: { action, page: decision.page, error: error.message } }; }
    }
    if (['UIA_INVOKE', 'UIA_SET_VALUE', 'UIA_FOCUS'].includes(action)) {
      try {
        const operation = action.replace('UIA_', '');
        const args = ['-ProcessId', String(this.processId), '-Action', operation, '-Element', decision.element];
        if (action === 'UIA_SET_VALUE') args.push('-Value', decision.value);
        await powershell('uia-action.ps1', args);
        return { status: 'sent', observation: { action, element: decision.element } };
      } catch (error) { return { status: 'failed', observation: { action, element: decision.element, error: error.message } }; }
    }
    if (action === 'OPEN_APPLICATION') {
      try {
        await powershell('open-application.ps1', ['-Application', decision.application]);
        return { status: 'sent', observation: { action, launched: decision.application } };
      } catch (error) {
        return { status: 'failed', observation: { action, application: decision.application, error: error.message } };
      }
    }
    if (action === 'OPEN_TERMINAL') {
      await powershell('open-terminal.ps1', []);
      return { status: 'sent', observation: { action, launched: 'terminal' } };
    }
    if (action === 'OPEN_BROWSER') {
      await powershell('open-browser.ps1', ['-Url', decision.url]);
      return { status: 'sent', observation: { action, launched: 'browser', url: decision.url } };
    }
    if (action === 'WAIT') {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { status: 'sent', observation: { action } };
    }
    if (['CLICK', 'DOUBLE_CLICK', 'DRAG', 'SCROLL'].includes(action)) {
      const args = ['-Action', action, '-ProcessId', String(this.processId)];
      if (decision.target) args.push('-X', String(decision.target.x), '-Y', String(decision.target.y));
      if (decision.to) args.push('-X2', String(decision.to.x), '-Y2', String(decision.to.y));
      if (decision.delta) args.push('-Delta', String(decision.delta));
      await powershell('send-input.ps1', args);
      return { status: 'sent', observation: { action, target: decision.target } };
    }
    const binding = this.bindings[action];
    if (!binding) return { status: 'no_change', observation: { error: `No binding configured for ${action}` } };
    const args = ['-HoldMs', String(binding.holdMs || 120)];
    if (this.processId) args.push('-ProcessId', String(this.processId));
    else if (this.title) args.push('-WindowTitle', this.title);
    else throw new Error('No selected process is available for input.');
    if (action === 'TYPE_TEXT') args.push('-Text', decision.text);
    else if (binding.sequence) args.push('-Sequence', binding.sequence.join('+'));
    else args.push('-Key', binding.key);
    await powershell('send-input.ps1', args);
    return { status: 'sent', observation: { action, binding } };
  }
}

module.exports = { WindowComputerAdapter, WindowsInputAdapter, powershell, systemApplicationHints };
