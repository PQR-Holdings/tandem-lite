const STATES = Object.freeze(['idle', 'planning', 'awaiting_plan_approval', 'running', 'waiting_for_approval', 'paused', 'stopped', 'failed', 'completed']);

class StateManager {
  constructor(workspaceRoot) {
    this.state = { objective: '', workspace: { root: workspaceRoot }, plan: [], processes: [], errors: [], timeline: [], status: 'idle' };
  }
  snapshot() { return JSON.parse(JSON.stringify(this.state)); }
  transition(status, patch = {}) {
    if (!STATES.includes(status)) throw new Error(`Unknown agent status: ${status}`);
    this.state = { ...this.state, ...patch, status };
    return this.snapshot();
  }
  addTimeline(entry) { this.state.timeline.push({ at: new Date().toISOString(), ...entry }); return this.snapshot(); }
  setPlan(plan) { this.state.plan = plan; return this.snapshot(); }
}

module.exports = { StateManager, STATES };
