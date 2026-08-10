const { ComputerAgent } = require('./agent');
const { SimulatedComputerTask } = require('./simulator');
const { RulePlanner, OllamaPlanner } = require('./planner');
const { DryRunController } = require('./controller');
const { RealInputController } = require('./controller');
const { PreviewController } = require('./controller');
const { WindowComputerAdapter, WindowsInputAdapter } = require('./window-computer');
const fs = require('node:fs');
const path = require('node:path');

function loadDotEnv(file = path.join(process.cwd(), '.env')) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function readProfile(profilePath = 'computer-profile.json') {
  return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
}

async function main() {
  if (process.env.COMPUTER_AGENT_MODE !== 'simulator') {
    const profile = readProfile(process.env.COMPUTER_AGENT_PROFILE || 'computer-profile.json');
    const enabledActions = profile.actions || Object.keys(profile.bindings || {});
    const adapter = new WindowComputerAdapter({ title: process.env.COMPUTER_AGENT_WINDOW_TITLE, objective: process.env.COMPUTER_AGENT_GOAL || profile.objective, maxWidth: process.env.COMPUTER_AGENT_CAPTURE_MAX_WIDTH || 1280, availableActions: enabledActions });
    await adapter.capture();
    const planner = new OllamaPlanner({
      model: process.env.OLLAMA_MODEL || 'qwen3-vl:8b',
      textModel: process.env.COMPUTER_AGENT_TEXT_MODEL || 'qwen3:4b',
      visionModel: process.env.COMPUTER_AGENT_VISION_MODEL || process.env.OLLAMA_MODEL || 'qwen3-vl:8b',
      fallback: { decide: async () => ({ action: 'STOP', reason: 'The planner was unavailable.' }) }
    });
    const input = new WindowsInputAdapter({ title: process.env.COMPUTER_AGENT_WINDOW_TITLE, processId: adapter.latest.window.pid, bindings: profile.bindings });
    const enabled = process.env.COMPUTER_AGENT_ALLOW_REAL_INPUT === 'true';
    const controller = enabled ? new RealInputController(input, { confirmActions: profile.confirmActions }) : new PreviewController();
    const result = await new ComputerAgent({ adapter, planner, controller, maxSteps: Number(process.env.COMPUTER_AGENT_MAX_STEPS || 50) }).run();
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const adapter = new SimulatedComputerTask();
  const planner = process.env.COMPUTER_AGENT_PLANNER === 'ollama'
    ? new OllamaPlanner({ model: process.env.OLLAMA_MODEL || 'llama3.2' }) : new RulePlanner();
  const result = await new ComputerAgent({ adapter, planner, controller: new DryRunController(adapter) }).run();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'complete' ? 0 : 1;
}
loadDotEnv();
main();
