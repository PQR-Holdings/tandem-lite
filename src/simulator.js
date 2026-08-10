class SimulatedComputerTask {
  constructor() { this.state = { tick: 0, terminal: false }; }
  observe() { return { ...this.state, objective: 'Wait once, then verify completion.' }; }
  apply(action) {
    const before = this.observe();
    this.state.tick += 1;
    if (action === 'WAIT') this.state.terminal = true;
    return { status: JSON.stringify(before) === JSON.stringify(this.observe()) ? 'no_change' : 'applied', observation: this.observe() };
  }
}
module.exports = { SimulatedComputerTask };
