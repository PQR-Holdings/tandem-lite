const { spawn } = require('node:child_process');

function createTerminalTool() {
  return {
    name: 'terminal.execute', description: 'Run a command in the workspace and capture streamed output.', permissions: ['terminal.execute'],
    getVerification(input, result) { return { type: 'command_exit', exitCode: 0, actualExitCode: result?.exitCode }; },
    execute(input, context) {
      return new Promise((resolve) => {
        const child = spawn(input.command, input.args || [], { cwd: input.cwd || context.workspaceRoot, shell: true, windowsHide: true, env: { ...process.env, ...(input.env || {}) } });
        let output = ''; const timer = setTimeout(() => child.kill(), input.timeoutMs || 120000);
        child.stdout.on('data', (data) => { output += data; context.onOutput?.(String(data)); });
        child.stderr.on('data', (data) => { output += data; context.onOutput?.(String(data)); });
        child.once('close', (exitCode) => { clearTimeout(timer); resolve({ ok: exitCode === 0, exitCode, output, pid: child.pid }); });
      });
    }
  };
}
module.exports = { createTerminalTool };
