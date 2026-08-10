const vscode = acquireVsCodeApi();
const input = document.getElementById('input');
const run = document.getElementById('run');
const status = document.getElementById('status');
const planEl = document.getElementById('plan');
const actions = document.getElementById('planActions');
const editor = document.getElementById('editor');
const editorActions = document.getElementById('editorActions');
const details = document.getElementById('details');
const stop = document.getElementById('stop');
const statusSpinner = document.getElementById('statusSpinner');
let plannedObjective = '';
let currentPlan = [];
let currentStepStates = {};

const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const hideEditor = () => { editor.hidden = true; editorActions.hidden = true; };
const renderPlan = () => {
  const icon = (state) => state === 'succeeded' ? '<span class="step-icon succeeded">✓</span>' : state === 'failed' ? '<span class="step-icon failed">✕</span>' : state === 'executing' ? '<span class="step-icon spinning">◌</span>' : state === 'retrying' ? '<span class="step-icon spinning">↻</span>' : state === 'unverified' ? '<span class="step-icon unverified">?</span>' : '<span class="step-icon pending">○</span>';
  planEl.innerHTML = currentPlan.map((step, index) => `<li class="plan-step">${icon(currentStepStates[step.id])}${index + 1}. ${escapeHtml(step.intent || step.id || 'Untitled step')}</li>`).join('');
};

run.addEventListener('click', () => {
  const objective = input.value.trim();
  if (!objective) { status.textContent = 'Enter an objective above before executing.'; return; }
  plannedObjective = objective;
  status.textContent = 'Sending plan request...';
  details.textContent = 'Waiting for the extension host...';
  vscode.postMessage({ type: 'run', objective });
});
document.getElementById('approve').addEventListener('click', () => vscode.postMessage({ type: 'execute', objective: plannedObjective, plan: JSON.stringify(currentPlan) }));
document.getElementById('deny').addEventListener('click', () => {
  vscode.postMessage({ type: 'deny' }); plannedObjective = ''; currentPlan = [];
  planEl.hidden = true; actions.hidden = true; hideEditor(); input.value = '';
});
document.getElementById('modify').addEventListener('click', () => { editor.value = JSON.stringify(currentPlan, null, 2); editor.hidden = false; editorActions.hidden = false; });
document.getElementById('savePlan').addEventListener('click', () => {
  try {
    const edited = JSON.parse(editor.value);
    if (!Array.isArray(edited)) throw new Error('Plan must be an array.');
    currentPlan = edited; renderPlan(); hideEditor();
  } catch (error) { details.textContent = `Plan edit error: ${error.message}`; }
});
document.getElementById('cancelEdit').addEventListener('click', hideEditor);
document.getElementById('settings').addEventListener('click', () => vscode.postMessage({ type: 'settings' }));
stop.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
input.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); run.click(); }
});
window.addEventListener('message', (event) => {
  const state = event.data.state;
  if (!state) return;
  if (state.freshPlan) { currentPlan = []; currentStepStates = {}; planEl.hidden = true; actions.hidden = true; hideEditor(); details.textContent = 'No output yet.'; }
  const hasPlan = Array.isArray(state.plan) && state.plan.length > 0;
  const ready = state.status === 'awaiting_plan_approval' && hasPlan;
  status.textContent = state.statusText || state.status || 'idle';
  const active = ['planning', 'running', 'waiting_for_approval'].includes(state.status);
  stop.disabled = !active;
  statusSpinner.hidden = !active;
  if (hasPlan) {
    plannedObjective = state.objective || plannedObjective;
    currentPlan = state.plan; currentStepStates = state.stepStates || currentStepStates; renderPlan(); planEl.hidden = false;
  } else if (state.status === 'planning' && !currentPlan.length) {
    planEl.hidden = true;
  }
  actions.hidden = !ready;
  const activity = state.activity || [];
  const timeline = state.timeline || [];
  const latestTimeline = [...new Map(timeline.map((item) => [item.stepId, item])).values()];
  const messages = activity.map((item) => item.text).concat(latestTimeline.map((item) => { const prefix = item.verification?.status === 'verified' ? 'Verified: ' : item.verification?.status === 'failed' ? 'Failed: ' : item.verification?.status === 'inconclusive' ? 'Unverified: ' : ''; return `${prefix}${item.intent || item.stepId || 'Working'}`; }));
  document.getElementById('timeline').innerHTML = messages.map((message) => `<li>${escapeHtml(message)}</li>`).join('') || '<li>Waiting for an objective.</li>';
  const output = (state.outputs || []).join('');
  const planner = state.planner ? `Planner: ${state.planner.source}${state.planner.model ? ` (${state.planner.model})` : ''}${state.planner.reason ? ` — ${state.planner.reason}` : ''}` : '';
  const errors = [state.error, ...(state.errors || []).map((item) => item.verification?.detail || item.result?.error || JSON.stringify(item))].filter(Boolean).join('\n');
  const commandOutput = timeline.map((item) => item.result?.output).filter(Boolean).join('\n');
  details.textContent = [planner, output, errors, commandOutput].filter(Boolean).join('\n\n') || 'No output yet.';
  details.scrollTop = details.scrollHeight;
});
