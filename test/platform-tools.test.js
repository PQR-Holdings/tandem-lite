const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWindowsTool } = require('../runtime/tools/windows');
const { createDesktopTools } = require('../runtime/tools/desktop');

test('native path opener uses macOS open with an argument-safe target', async () => {
  let call;
  const spawnImpl = (command, args, options) => {
    call = { command, args, options }; const child = new EventEmitter();
    queueMicrotask(() => child.emit('close', 0)); return child;
  };
  const tool = createWindowsTool({ platform: 'darwin', spawnImpl });
  const result = await tool.execute({ path: '/Users/example/My Folder' });
  assert.deepEqual(call.args, ['/Users/example/My Folder']);
  assert.equal(call.command, '/usr/bin/open');
  assert.equal(result.ok, true);
  assert.equal(tool.getVerification({}, result).type, 'native_path_open');
});

test('macOS desktop tools invoke open and JXA without shell interpolation', async () => {
  const calls = [];
  const runFile = async (command, args) => {
    calls.push({ command, args });
    if (command === '/usr/bin/osascript') return { stdout: JSON.stringify({ ok: true, windows: [], output: 'Found 0 visible window(s).' }) };
    return { stdout: '' };
  };
  const tools = new Map(createDesktopTools({ platform: 'darwin', runFile }).map((tool) => [tool.name, tool]));
  await tools.get('applications.open').execute({ appId: '/Applications/Visual Studio Code.app', kind: 'app' });
  await tools.get('windows.list').execute({ query: 'Code' });
  assert.deepEqual(calls[0], { command: '/usr/bin/open', args: ['/Applications/Visual Studio Code.app'] });
  assert.equal(calls[1].command, '/usr/bin/osascript');
  assert.deepEqual(JSON.parse(calls[1].args.at(-1)), { query: 'Code' });
});

test('desktop tools are omitted on unsupported platforms', () => {
  assert.deepEqual(createDesktopTools({ platform: 'linux' }), []);
});
