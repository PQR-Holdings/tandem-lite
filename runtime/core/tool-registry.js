class ToolRegistry {
  constructor() { this.tools = new Map(); }
  register(tool) { if (!tool?.name || typeof tool.execute !== 'function') throw new Error('Invalid AgentTool.'); this.tools.set(tool.name, tool); return this; }
  get(name) { return this.tools.get(name); }
  list() { return [...this.tools.values()].map(({ name, description, permissions }) => ({ name, description, permissions })); }
}
module.exports = { ToolRegistry };
