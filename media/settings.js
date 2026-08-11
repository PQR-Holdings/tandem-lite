const vscode = acquireVsCodeApi();
const provider = document.getElementById('provider');
const model = document.getElementById('model');
const endpoint = document.getElementById('endpoint');
const apiKey = document.getElementById('apiKey');
const keyLabel = document.getElementById('keyLabel');
const result = document.getElementById('result');
const visionFallback = document.getElementById('visionFallback');
const statusModel = document.getElementById('statusModel');
const planningTimeoutMs = document.getElementById('planningTimeoutMs');
const executionTimeoutMs = document.getElementById('executionTimeoutMs');
const permissionFields = { terminal: document.getElementById('permissionTerminal'), windows: document.getElementById('permissionWindows'), desktopControl: document.getElementById('permissionDesktopControl'), fileScan: document.getElementById('permissionFileScan'), network: document.getElementById('permissionNetwork') };
let settings;
function showProfile() {
  const profile = settings?.profiles?.[provider.value] || {};
  model.value = profile.model || ''; endpoint.value = profile.endpoint || '';
  keyLabel.hidden = provider.value === 'ollama'; apiKey.value = '';
}
function showAdvanced() {
  const advanced = settings?.advanced || {}; const permissions = advanced.permissions || {};
  visionFallback.value = advanced.visionFallback || ''; statusModel.value = advanced.statusModel || '';
  planningTimeoutMs.value = advanced.planningTimeoutMs || ''; executionTimeoutMs.value = advanced.executionTimeoutMs || '';
  for (const [name, field] of Object.entries(permissionFields)) field.value = permissions[name] || 'ask';
}
provider.addEventListener('change', showProfile);
document.getElementById('settingsForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!model.value.trim()) { result.textContent = 'Enter a model name before saving.'; model.focus(); return; }
  if (!endpoint.value.trim()) { result.textContent = 'Enter a provider endpoint before saving.'; endpoint.focus(); return; }
  const permissions = Object.fromEntries(Object.entries(permissionFields).map(([name, field]) => [name, field.value]));
  vscode.postMessage({ type: 'saveSettings', settings: { provider: provider.value, model: model.value.trim(), endpoint: endpoint.value.trim(), apiKey: apiKey.value, advanced: { visionFallback: visionFallback.value.trim(), statusModel: statusModel.value.trim(), planningTimeoutMs: planningTimeoutMs.value, executionTimeoutMs: executionTimeoutMs.value, permissions } } });
  result.textContent = 'Saving…';
});
document.getElementById('testConnection').addEventListener('click', () => {
  if (!model.value.trim() || !endpoint.value.trim()) { result.textContent = 'Enter a model and endpoint before testing.'; return; }
  result.textContent = 'Testing connection…';
  vscode.postMessage({ type: 'testConnection', settings: { provider: provider.value, model: model.value.trim(), endpoint: endpoint.value.trim(), apiKey: apiKey.value } });
});
window.addEventListener('message', (event) => {
  if (event.data.type === 'connectionResult') { result.textContent = event.data.ok ? 'Connection successful.' : `Connection failed: ${event.data.error}`; return; }
  if (event.data.type === 'settingsError') { result.textContent = `Settings not saved: ${event.data.error}`; return; }
  if (!['settings', 'settingsSaved'].includes(event.data.type)) return;
  settings = event.data.settings; provider.value = settings.provider; showProfile(); showAdvanced();
  if (event.data.type === 'settingsSaved') result.textContent = 'Settings saved.';
});
vscode.postMessage({ type: 'ready' });
