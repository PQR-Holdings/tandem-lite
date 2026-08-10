const { validateDecision } = require('./actions');
const { Memory } = require('./memory');

class ComputerAgent {
  constructor({ adapter, planner, controller, maxSteps = 30, memory = new Memory() }) {
    Object.assign(this, { adapter, planner, controller, maxSteps, memory });
  }
  async run() {
    for (let step = 0; step < this.maxSteps; step += 1) {
      const observation = this.adapter.observe();
      if (observation.terminal) return { status: 'complete', steps: step, observation, history: this.memory.events };
      const decision = validateDecision(await this.planner.decide(observation, this.memory));
      if (decision.action === 'STOP') {
        const previous = this.memory.events.at(-1)?.result?.observation;
        if (decision.complete && previous?.frameHash && previous.frameHash === observation.frameHash) {
          return { status: 'unverified_completion', steps: step, observation, decision, reason: 'The screen did not change after the prior action.', history: this.memory.events };
        }
        return { status: decision.complete ? 'complete' : 'stopped', steps: step, observation, decision, history: this.memory.events };
      }
      const result = await this.controller.execute(decision.action, decision);
      if (result.status === 'needs_confirmation') return { status: 'awaiting_confirmation', steps: step, observation, decision, confirmation: result.observation, history: this.memory.events };
      if (result.status === 'failed') return { status: 'action_failed', steps: step, observation, decision, error: result.observation, history: this.memory.events };
      if (typeof this.adapter.refresh === 'function' && result.status === 'sent') {
        result.observation = await this.adapter.refresh();
        if (typeof this.controller.setTarget === 'function') this.controller.setTarget(result.observation.window);
      }
      this.memory.record(observation, decision, result);
      if (this.isOneShotWallpaperComplete(observation, decision, result.observation)) {
        return { status: 'complete', steps: step + 1, observation: result.observation, decision, reason: 'Wallpaper selection visibly changed the Settings page.', history: this.memory.events };
      }
      if (result.status === 'no_change') return { status: 'stalled', steps: step + 1, observation: result.observation, history: this.memory.events };
    }
    return { status: 'step_limit', steps: this.maxSteps, observation: this.adapter.observe(), history: this.memory.events };
  }
  isOneShotWallpaperComplete(before, decision, after) {
    if (!/\b(background|wallpaper)\b/i.test(before.objective || '') || !['CLICK', 'DOUBLE_CLICK'].includes(decision.action)) return false;
    if (!after?.window?.title || !/settings/i.test(after.window.title)) return false;
    return Boolean(before.wallpaper?.path && after.wallpaper?.path && before.wallpaper.path !== after.wallpaper.path);
  }
}
module.exports = { ComputerAgent };
