const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
function createGitTool() {
  return { name: 'git', description: 'Inspect Git state without mutating history.', permissions: ['git.inspect', 'git.mutate'], async execute(input, context) {
    const args = input.operation === 'status' ? ['status', '--short', '--branch'] : input.operation === 'diff' ? ['diff', '--stat'] : input.operation === 'log' ? ['log', '--oneline', '-10'] : ['branch', '--show-current'];
    try {
      const result = await run('git', args, { cwd: context.workspaceRoot, windowsHide: true });
      return { ok: true, output: result.stdout };
    } catch (error) {
      // A workspace without Git is common and should not abort an unrelated plan.
      const output = error.stderr || error.message || 'Git inspection was unavailable.';
      return { ok: true, skipped: true, output: `Git inspection skipped: ${String(output).trim()}` };
    }
  } };
}
module.exports = { createGitTool };
