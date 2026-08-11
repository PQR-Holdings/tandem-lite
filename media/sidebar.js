const vscode = acquireVsCodeApi();
const input = document.getElementById('input');
const run = document.getElementById('run');
const status = document.getElementById('status');
const statusTitle = document.getElementById('statusTitle');
const statusDot = document.getElementById('statusDot');
const progress = document.getElementById('progress');
const planSection = document.getElementById('planSection');
const planEl = document.getElementById('plan');
const planCount = document.getElementById('planCount');
const actions = document.getElementById('planActions');
const reviewNote = document.getElementById('reviewNote');
const editor = document.getElementById('editor');
const editorActions = document.getElementById('editorActions');
const activitySection = document.getElementById('activitySection');
const timelineEl = document.getElementById('timeline');
const detailsSection = document.getElementById('detailsSection');
const details = document.getElementById('details');
const detailsCount = document.getElementById('detailsCount');
const stop = document.getElementById('stop');
let plannedObjective = '';
let currentPlan = [];
let currentStepStates = {};

const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const hideEditor = () => { editor.hidden = true; editorActions.hidden = true; };
const stepIcon = (state) => ({ succeeded: '✓', failed: '×', executing: '•', retrying: '↻', unverified: '?', pending: '' }[state] || '');
const semanticState = (state) => state === 'succeeded' ? 'success' : state === 'failed' ? 'error' : state === 'unverified' ? 'warning' : state;

function renderPlan() {
  planCount.textContent = currentPlan.length;
  planEl.innerHTML = currentPlan.map((step, index) => {
    const state = currentStepStates[step.id] || 'pending';
    return `<li class="plan-step"><span class="step-icon ${escapeHtml(state)}" aria-label="${escapeHtml(state)}">${stepIcon(state)}</span><span>${index + 1}. ${escapeHtml(step.intent || step.id || 'Untitled step')}</span></li>`;
  }).join('');
  planSection.hidden = currentPlan.length === 0;
}

function statusView(state) {
  const active = ['planning', 'running', 'waiting_for_approval'].includes(state.status);
  const views = {
    idle: ['Ready for an objective', 'Describe a task to create a reviewable plan.', 'neutral'],
    planning: ['Creating a plan', state.statusText || 'Reviewing the objective and available tools…', 'running'],
    awaiting_plan_approval: ['Plan ready for review', 'Check every step before approving execution.', 'warning'],
    running: ['Executing approved plan', state.statusText || 'Working through the approved steps…', 'running'],
    waiting_for_approval: ['Approval required', state.statusText || 'An action needs permission before work can continue.', 'warning'],
    completed: ['Objective completed', state.statusText || 'All planned work has finished.', 'success'],
    failed: ['Execution failed', state.error || state.statusText || 'Open details for more information.', 'error'],
    stopped: ['Execution stopped', 'The active work was cancelled.', 'warning']
  };
  const view = views[state.status] || [String(state.status || 'Idle'), state.statusText || '', 'neutral'];
  statusTitle.textContent = view[0];
  status.textContent = view[1];
  statusDot.className = `status-dot ${view[2]}`;
  stop.hidden = !active;
  stop.disabled = !active;
  progress.hidden = !active;
  run.disabled = active;
}

function renderActivity(state) {
  const timeline = state.timeline || [];
  const latest = [...new Map(timeline.map((item) => [item.stepId || item.intent, item])).values()];
  const rows = latest.map((item) => {
    const verification = item.verification?.status;
    const tone = verification === 'verified' ? 'success' : verification === 'failed' ? 'error' : verification === 'inconclusive' ? 'warning' : 'neutral';
    const detail = verification ? verification.charAt(0).toUpperCase() + verification.slice(1) : (item.result?.status || 'In progress');
    return `<div class="activity-row ${tone}"><span class="activity-dot"></span><div><div class="activity-title">${escapeHtml(item.intent || item.stepId || 'Working')}</div><div class="activity-detail">${escapeHtml(detail)}</div></div></div>`;
  });
  if (!rows.length && state.activity?.length) {
    const item = state.activity.at(-1);
    rows.push(`<div class="activity-row neutral"><span class="activity-dot"></span><div><div class="activity-title">${escapeHtml(item.text)}</div></div></div>`);
  }
  timelineEl.innerHTML = rows.join('');
  activitySection.hidden = rows.length === 0;
}

function renderDetails(state) {
  const timeline = state.timeline || [];
  const output = (state.outputs || []).join('');
  const planner = state.planner ? `Planner: ${state.planner.source}${state.planner.model ? ` (${state.planner.model})` : ''}${state.planner.reason ? ` — ${state.planner.reason}` : ''}` : '';
  const errors = [state.error, ...(state.errors || []).map((item) => item.verification?.detail || item.result?.error || JSON.stringify(item))].filter(Boolean);
  const commandOutput = timeline.map((item) => item.result?.output).filter(Boolean).join('\n');
  const sections = [planner, output, errors.join('\n'), commandOutput].filter(Boolean);
  details.textContent = sections.join('\n\n') || 'No output yet.';
  detailsCount.textContent = sections.length;
  detailsSection.hidden = sections.length === 0;
  if (detailsSection.open && details.scrollHeight - details.scrollTop - details.clientHeight < 40) details.scrollTop = details.scrollHeight;
}

run.addEventListener('click', () => {
  const objective = input.value.trim();
  if (!objective) { statusTitle.textContent = 'Add an objective first'; status.textContent = 'Describe what Tandem should do, then create a plan.'; statusDot.className = 'status-dot warning'; input.focus(); return; }
  plannedObjective = objective;
  statusTitle.textContent = 'Creating a plan';
  status.textContent = 'Sending the objective to the planner…';
  vscode.postMessage({ type: 'run', objective });
});
document.getElementById('approve').addEventListener('click', () => vscode.postMessage({ type: 'execute', objective: plannedObjective, plan: JSON.stringify(currentPlan) }));
document.getElementById('deny').addEventListener('click', () => {
  vscode.postMessage({ type: 'deny' }); plannedObjective = ''; currentPlan = []; currentStepStates = {};
  renderPlan(); actions.hidden = true; reviewNote.hidden = true; hideEditor(); input.value = '';
});
document.getElementById('modify').addEventListener('click', () => { editor.value = JSON.stringify(currentPlan, null, 2); editor.hidden = false; editorActions.hidden = false; editor.focus(); });
document.getElementById('savePlan').addEventListener('click', () => {
  try {
    const edited = JSON.parse(editor.value);
    if (!Array.isArray(edited)) throw new Error('Plan must be an array.');
    currentPlan = edited; renderPlan(); hideEditor();
  } catch (error) { detailsSection.hidden = false; detailsSection.open = true; details.textContent = `Plan edit error: ${error.message}`; }
});
document.getElementById('cancelEdit').addEventListener('click', hideEditor);
document.getElementById('settings').addEventListener('click', () => vscode.postMessage({ type: 'settings' }));
stop.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
input.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); run.click(); } });

window.addEventListener('message', (event) => {
  const state = event.data.state;
  if (!state) return;
  if (state.freshPlan) { currentPlan = []; currentStepStates = {}; actions.hidden = true; reviewNote.hidden = true; hideEditor(); detailsSection.open = false; }
  const hasPlan = Array.isArray(state.plan) && state.plan.length > 0;
  const ready = state.status === 'awaiting_plan_approval' && hasPlan;
  if (hasPlan) { plannedObjective = state.objective || plannedObjective; currentPlan = state.plan; currentStepStates = state.stepStates || currentStepStates; }
  renderPlan();
  actions.hidden = !ready;
  reviewNote.hidden = !ready;
  statusView(state);
  renderActivity(state);
  renderDetails(state);
});
