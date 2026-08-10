const readline = require('node:readline');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { StateManager } = require('./core/state');
const { PermissionEngine } = require('./core/permissions');
const { VerificationEngine } = require('./core/verification');
const { ToolRegistry } = require('./core/tool-registry');
const { AgentController } = require('./core/controller');
const { HeuristicPlanner } = require('./planner/heuristic-planner');
const { ModelPlanner } = require('./planner/model-planner');
const { createProvider } = require('./models/providers');
const { createFilesTool } = require('./tools/files');
const { createTerminalTool } = require('./tools/terminal');
const { createGitTool } = require('./tools/git');
const { createHttpTool } = require('./tools/http');
const { createProcessesTool } = require('./tools/processes');
const { createWindowsTool } = require('./tools/windows');
const { createWindowsFilesTool } = require('./tools/windows-files');
const { createDesktopTools } = require('./tools/desktop');

const registryPath = path.join(os.tmpdir(), 'developer-computer-agent-runtime.json');
fs.writeFileSync(registryPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
function clearRegistry() { try { const entry = JSON.parse(fs.readFileSync(registryPath, 'utf8')); if (entry.pid === process.pid) fs.unlinkSync(registryPath); } catch {} }
process.on('exit', clearRegistry);
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
function emit(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
async function build({ objective, workspaceRoot, policy = {}, allowedPermissions = [], modelConfig, plan }) {
  const root = path.resolve(workspaceRoot);
  const tools = new ToolRegistry().register(createFilesTool(root)).register(createTerminalTool()).register(createGitTool()).register(createHttpTool()).register(createProcessesTool()).register(createWindowsTool()).register(createWindowsFilesTool());
  for (const tool of createDesktopTools()) tools.register(tool);
  const state = new StateManager(root);
  let provider;
  try { provider = modelConfig?.model ? createProvider(modelConfig) : undefined; } catch { provider = undefined; }
  const modelPlanner = new ModelPlanner(provider, new HeuristicPlanner(), { timeoutMs: modelConfig?.planningTimeoutMs });
  const planner = plan ? { plan: async () => plan, recover: modelPlanner.recover.bind(modelPlanner) } : modelPlanner;
  const permissions = new PermissionEngine(policy);
  for (const permission of allowedPermissions) permissions.allowOnce(permission);
  return { controller: new AgentController({ state, tools, permissions, verifier: new VerificationEngine(), planner, workspaceRoot: root, emit }), state, planner };
}
async function plan(params) {
  const runtime = await build(params); const steps = await runtime.planner.plan(params.objective, params.workspaceRoot); runtime.state.setPlan(steps); runtime.state.transition('awaiting_plan_approval', { objective: params.objective, planner: runtime.planner.lastResult });
  return { status: 'awaiting_plan_approval', plan: steps, state: runtime.state.snapshot() };
}
async function execute(params) {
  const runtime = await build(params); return runtime.controller.run(params.objective);
}

const lines = readline.createInterface({ input: process.stdin });
lines.on('line', async (line) => {
  try { const request = JSON.parse(line); const result = request.method === 'plan' ? await plan(request.params) : request.method === 'execute' ? await execute(request.params) : await (() => { throw new Error('Unsupported runtime method.'); })(); emit({ id: request.id, type: 'result', result }); }
  catch (error) { emit({ type: 'error', error: error.message }); }
});
