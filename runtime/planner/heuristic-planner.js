class HeuristicPlanner {
  async plan(objective, workspaceRoot) {
    const lower = objective.toLowerCase();
    const steps = [];
    const developerTask = /test|failing|bug|fix|build|run|start|application|package|dependency|workspace|repository|git|code/.test(lower);
    if (developerTask) steps.push({ id: 'inspect-workspace', intent: 'Inspect workspace structure', action: { tool: 'files', input: { operation: 'list', path: '.' } } });
    if (/test|failing|bug|fix|build|run|start|application|package/.test(lower)) steps.push({ id: 'inspect-git', intent: 'Inspect Git status', action: { tool: 'git', input: { operation: 'status' } } });
    if (/test|failing/.test(lower)) steps.push({ id: 'run-tests', intent: 'Run the project test command', action: { tool: 'terminal.execute', input: { command: 'npm test' } }, expected: { type: 'command_exit', exitCode: 0 } });
    else if (/run|start|application/.test(lower)) steps.push({ id: 'inspect-package', intent: 'Inspect package startup scripts', action: { tool: 'files', input: { operation: 'read', path: 'package.json' } } });
    if (!steps.length) steps.push({ id: 'inspect-workspace', intent: 'Inspect workspace structure relevant to the request', action: { tool: 'files', input: { operation: 'list', path: '.' } } });
    return steps;
  }
}
module.exports = { HeuristicPlanner };
