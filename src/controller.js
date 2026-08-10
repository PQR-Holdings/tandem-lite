class DryRunController {
  constructor(adapter) { this.adapter = adapter; }
  async execute(action) { return this.adapter.apply(action); }
}

class PreviewController {
  async execute(action) { return { status: 'sent', observation: { preview: true, action } }; }
}

class RealInputController {
  constructor(inputAdapter, { confirmActions = [] } = {}) { this.inputAdapter = inputAdapter; this.confirmActions = new Set(confirmActions); }
  async execute(action, decision) {
    if (process.env.COMPUTER_AGENT_ALLOW_REAL_INPUT !== 'true') {
      throw new Error('Real input is disabled. Enable COMPUTER_AGENT_ALLOW_REAL_INPUT only for permitted tasks.');
    }
    const destructiveText = decision.text && /\b(remove-item|del\s|rmdir|rm\s|format\s|shutdown|restart-computer)\b/i.test(decision.text);
    if ((this.confirmActions.has(action) || destructiveText) && process.env.COMPUTER_AGENT_AUTO_CONFIRM !== 'true') return { status: 'needs_confirmation', observation: { action, reason: destructiveText ? 'sensitive text input' : 'profile confirmation rule' } };
    return this.inputAdapter.apply(action, decision);
  }
  setTarget(window) {
    if (window && window.pid && typeof this.inputAdapter.setProcessId === 'function') this.inputAdapter.setProcessId(window.pid);
  }
}

module.exports = { DryRunController, PreviewController, RealInputController };
