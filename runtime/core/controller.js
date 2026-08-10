const { Permission } = require('./permissions');
class AgentController {
  constructor({ state, tools, permissions, verifier, planner, workspaceRoot, emit = () => {}, maxRetries = 5 }) { Object.assign(this, { state, tools, permissions, verifier, planner, workspaceRoot, emit, maxRetries }); }
  resolveInput(input, results) {
    if (!input) return input;
    const resolved = { ...input };
    if (resolved.pathFromStep) { const found = results.get(resolved.pathFromStep)?.files?.[0]?.path; if (!found) throw new Error(`No file result is available from step '${resolved.pathFromStep}'.`); resolved.path = found; delete resolved.pathFromStep; }
    for (const [reference, collection, field] of [['appFromStep', 'apps', 'appId'], ['windowFromStep', 'windows', 'handle'], ['controlFromStep', 'controls', 'selector']]) {
      if (!resolved[reference]) continue;
      const item = results.get(resolved[reference])?.[collection]?.[resolved.index || 0];
      if (!item) throw new Error(`No ${collection} result is available from step '${resolved[reference]}'.`);
      if (field === 'appId') { resolved.appId = item.id; resolved.kind = item.kind; } else resolved[field] = item[field];
      delete resolved[reference]; delete resolved.index;
    }
    return resolved;
  }
  async run(objective) {
    this.state.transition('planning', { objective }); this.emit({ type: 'state', state: this.state.snapshot() });
    const plan = await this.planner.plan(objective, this.workspaceRoot); this.state.setPlan(plan); this.state.transition('running');
    const results = new Map();
    for (const originalStep of plan) {
      let step = originalStep; let lastFailure;
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        this.state.transition('running', { activeStep: originalStep.id, attempt: attempt + 1 }); this.emit({ type: 'step_started', step, planStepId: originalStep.id, attempt: attempt + 1, state: this.state.snapshot() });
        const tool = this.tools.get(step.action.tool);
        if (!tool) { lastFailure = { error: `Unknown tool ${step.action.tool}` }; }
        else {
          const permission = tool.permissions?.[0] || 'terminal.execute'; const decision = this.permissions.check(permission);
          if (decision === Permission.DENY) throw new Error(`Permission denied: ${permission}`);
          if (decision === Permission.ASK) { this.state.transition('waiting_for_approval'); return { status: 'waiting_for_approval', approval: { permission, step }, state: this.state.snapshot() }; }
          let result;
          let input;
          try { input = this.resolveInput(step.action.input, results); result = await tool.execute(input, { workspaceRoot: this.workspaceRoot, onOutput: (text) => this.emit({ type: 'output', text }) }); }
          catch (error) { result = { ok: false, error: error.message }; }
          const expected = step.expected || tool.getVerification?.(input || step.action.input, result);
          this.emit({ type: 'step_verifying', step, planStepId: originalStep.id, expected, attempt: attempt + 1, state: this.state.snapshot() });
          const verification = result.ok === false ? { status: 'failed', detail: result.error || result.output || 'Tool reported failure.' } : expected ? await this.verifier.verify({ ...expected, actualExitCode: result.exitCode }) : { status: 'verified', detail: 'Tool completed successfully; no additional postcondition was needed.' };
          if (verification.status !== 'failed') { results.set(originalStep.id, result); results.set(step.id, result); this.state.addTimeline({ stepId: originalStep.id, intent: step.intent, attempt: attempt + 1, result, verification }); this.emit({ type: 'step_finished', step, planStepId: originalStep.id, result, verification }); break; }
          lastFailure = { result, verification };
        }
        this.state.addTimeline({ stepId: originalStep.id, intent: step.intent, attempt: attempt + 1, result: lastFailure?.result || { ok: false, error: lastFailure?.error }, verification: lastFailure?.verification || { status: 'failed', detail: lastFailure?.error } });
        if (attempt === this.maxRetries) { this.emit({ type: 'step_finished', step, planStepId: originalStep.id, result: lastFailure?.result, verification: lastFailure?.verification || { status: 'failed', detail: lastFailure?.error } }); this.state.transition('failed', { errors: [...this.state.state.errors, { step: originalStep.id, ...lastFailure }] }); return { status: 'failed', state: this.state.snapshot() }; }
        this.emit({ type: 'step_retrying', step, planStepId: originalStep.id, attempt: attempt + 1, failure: lastFailure, state: this.state.snapshot() });
        const recovery = await this.planner.recover?.({ objective, step, failure: lastFailure, workspaceRoot: this.workspaceRoot, attempt: attempt + 1 });
        step = recovery || originalStep;
      }
    }
    this.state.transition('completed'); return { status: 'completed', state: this.state.snapshot() };
  }
}
module.exports = { AgentController };
