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

function createWindowsTool({ platform = process.platform, spawnImpl = spawn } = {}) {
  return {
    name: 'windows.open',
    description: 'Open a folder or file in the native file manager (Finder on macOS, Explorer on Windows). Input: { knownFolder: "desktop|documents|downloads|pictures|home" } or { path: "absolute path" }.',
    permissions: ['windows.open'],
    getVerification(input, result) { return result?.target ? { type: 'native_path_open', path: result.target } : undefined; },
    execute(input = {}) {
      const target = input.path || knownFolder(input.knownFolder);
      if (!target || !path.isAbsolute(target)) throw new Error('windows.open requires a knownFolder or an absolute path.');
      const mac = platform === 'darwin';
      if (!mac && platform !== 'win32') throw new Error(`windows.open is not supported on ${platform}.`);
      return new Promise((resolve, reject) => {
        const child = mac
          ? spawnImpl('/usr/bin/open', [target], { stdio: 'ignore' })
          : spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath explorer.exe -ArgumentList $env:DEVELOPER_AGENT_OPEN_PATH'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, DEVELOPER_AGENT_OPEN_PATH: target } });
        child.once('error', reject);
        child.once('close', (exitCode) => {
          if (exitCode === 0) resolve({ ok: true, output: `Opened ${target}`, target });
          else resolve({ ok: false, output: `${mac ? 'Finder' : 'Windows Explorer'} launch failed for ${target}`, exitCode, target });
        });
      });
    }
  };
}

module.exports = { createWindowsTool };
