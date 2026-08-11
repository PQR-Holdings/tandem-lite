const fs = require('node:fs/promises');
const path = require('node:path');

function insertLargest(items, candidate, limit) {
  items.push(candidate); items.sort((a, b) => b.size - a.size);
  if (items.length > limit) items.pop();
}

async function findLargestFiles(root, limit = 1, onProgress, extensions = []) {
  const pending = [path.resolve(root)]; const largest = []; let scanned = 0;
  while (pending.length) {
    const directory = pending.pop(); let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { pending.push(fullPath); continue; }
      if (!entry.isFile() || (extensions.length && !extensions.includes(path.extname(entry.name).toLowerCase()))) continue;
      try { const stat = await fs.stat(fullPath); insertLargest(largest, { path: fullPath, size: stat.size }, limit); scanned += 1; if (scanned % 1000 === 0) onProgress?.(`Scanned ${scanned.toLocaleString()} files beneath ${root}...\n`); } catch { /* Skip inaccessible or transient files. */ }
    }
  }
  return largest;
}

function createWindowsFilesTool() {
  return {
    name: 'windows.find_files',
    description: 'Search a local directory tree for files, optionally filtered by extensions. Input: { root: "absolute path", extensions: [".jpg"], limit: positive integer }. It returns the largest matching files and skips inaccessible files.',
    permissions: ['files.scan'],
    getVerification(input, result) { return result?.files?.[0] ? { type: 'file_exists', path: result.files[0].path } : undefined; },
    async execute(input = {}, context = {}) {
      if (!input.root || !path.isAbsolute(input.root)) throw new Error('windows.find_files requires an absolute root path.');
      const limit = Math.max(1, Math.min(Number(input.limit) || 1, 20)); const extensions = (input.extensions || []).map((item) => String(item).toLowerCase());
      const filterDescription = extensions.length ? `files matching ${extensions.join(', ')}` : 'readable files';
      context.onOutput?.(`Searching ${input.root} for ${filterDescription}...\n`);
      const files = await findLargestFiles(input.root, limit, context.onOutput, extensions);
      if (!files.length) return { ok: false, output: `No readable files were found beneath ${input.root}.`, files };
      const lines = files.map((file, index) => `${index + 1}. ${file.path} (${file.size} bytes)`);
      return { ok: true, output: `Found matching file(s) beneath ${input.root}:\n${lines.join('\n')}`, files };
    }
  };
}

module.exports = { createWindowsFilesTool, findLargestFiles };
