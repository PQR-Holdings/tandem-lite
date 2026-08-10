const fs = require('node:fs/promises');
const path = require('node:path');

function inWorkspace(root, candidate) {
  const resolved = path.resolve(root, candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('Path is outside the active workspace.');
  return resolved;
}

function createFilesTool(workspaceRoot) {
  return {
    name: 'files', description: 'Read, list, search, and write files inside the active workspace.', permissions: ['files.read', 'files.write', 'files.delete'],
    getVerification(input, result) {
      if (['write', 'mkdir'].includes(input.operation) && result?.path) return { type: 'file_exists', path: result.path };
      return undefined;
    },
    async execute(input) {
      const target = inWorkspace(workspaceRoot, input.path || '.');
      if (input.operation === 'read') return { ok: true, content: await fs.readFile(target, 'utf8'), path: target };
      if (input.operation === 'list') return { ok: true, entries: await fs.readdir(target, { withFileTypes: true }).then((items) => items.map((item) => ({ name: item.name, type: item.isDirectory() ? 'directory' : 'file' }))) };
      if (input.operation === 'write') { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, input.content || '', 'utf8'); return { ok: true, path: target }; }
      if (input.operation === 'mkdir') { await fs.mkdir(target, { recursive: true }); return { ok: true, path: target }; }
      throw new Error(`Unsupported file operation: ${input.operation}`);
    }
  };
}
module.exports = { createFilesTool, inWorkspace };
