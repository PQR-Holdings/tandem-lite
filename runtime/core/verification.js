const fs = require('node:fs/promises');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

async function portListening(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function windowsFolderOpen(target) {
  if (process.platform !== 'win32') return false;
  const script = "$shell = New-Object -ComObject Shell.Application; foreach ($window in @($shell.Windows())) { try { if ($window.Document -and $window.Document.Folder -and $window.Document.Folder.Self.Path -eq $env:DEVELOPER_AGENT_VERIFY_PATH) { exit 0 } } catch {} }; exit 1";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, env: { ...process.env, DEVELOPER_AGENT_VERIFY_PATH: target } });
      return true;
    } catch { await delay(250); }
  }
  return false;
}

class VerificationEngine {
  async verify(expected) {
    if (!expected) return { status: 'unknown', detail: 'No expected state supplied.' };
    if (expected.type === 'file_exists') return { status: await fs.access(expected.path).then(() => 'verified').catch(() => 'failed'), expected };
    if (expected.type === 'command_exit') return { status: expected.actualExitCode === expected.exitCode ? 'verified' : 'failed', expected };
    if (expected.type === 'port_listening') return { status: await portListening(expected.port, expected.host) ? 'verified' : 'failed', expected };
    if (expected.type === 'http_response') {
      try { const response = await fetch(expected.url); return { status: response.status === expected.status ? 'verified' : 'failed', actualStatus: response.status, expected }; }
      catch (error) { return { status: 'failed', error: error.message, expected }; }
    }
    if (expected.type === 'windows_folder_open') {
      const exists = await fs.access(expected.path).then(() => true).catch(() => false);
      const open = exists && await windowsFolderOpen(expected.path);
      return { status: open ? 'verified' : 'inconclusive', expected, detail: open ? 'Explorer is displaying the requested folder.' : 'Explorer launch completed, but the Windows Shell API did not expose a matching folder window for confirmation.' };
    }
    return { status: 'unknown', detail: `Unsupported verifier ${expected.type}`, expected };
  }
}

module.exports = { VerificationEngine, portListening, windowsFolderOpen };
