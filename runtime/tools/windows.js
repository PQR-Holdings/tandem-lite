const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function knownFolder(name) {
  const home = os.homedir();
  const folders = {
    desktop: path.join(home, 'Desktop'),
    documents: path.join(home, 'Documents'),
    downloads: path.join(home, 'Downloads'),
    pictures: path.join(home, 'Pictures'),
    home
  };
  return folders[String(name || '').trim().toLowerCase()];
}

function createWindowsTool() {
  return {
    name: 'windows.open',
    description: 'Open a Windows folder or application-visible location. Input: { knownFolder: "desktop|documents|downloads|pictures|home" } or { path: "absolute path" }.',
    permissions: ['windows.open'],
    getVerification(input, result) { return result?.target ? { type: 'windows_folder_open', path: result.target } : undefined; },
    execute(input = {}) {
      const target = input.path || knownFolder(input.knownFolder);
      if (!target || !path.isAbsolute(target)) throw new Error('windows.open requires a knownFolder or an absolute path.');
      // Start-Process hands the target to the Windows shell and then exits immediately.
      // Unlike cmd's `start`, it does not wait for the existing Explorer shell process.
      const command = 'Start-Process -FilePath explorer.exe -ArgumentList $env:DEVELOPER_AGENT_OPEN_PATH';
      return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: 'ignore', env: { ...process.env, DEVELOPER_AGENT_OPEN_PATH: target } });
        child.once('error', reject);
        child.once('close', (exitCode) => {
          if (exitCode === 0) resolve({ ok: true, output: `Opened ${target}`, target });
          else resolve({ ok: false, output: `Windows Explorer launch failed for ${target}`, exitCode, target });
        });
      });
    }
  };
}

module.exports = { createWindowsTool };
