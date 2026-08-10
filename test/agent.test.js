const test = require('node:test');
const assert = require('node:assert/strict');
const { ComputerAgent } = require('../src/agent');
const { SimulatedComputerTask } = require('../src/simulator');
const { RulePlanner, OllamaPlanner } = require('../src/planner');
const { DryRunController } = require('../src/controller');

test('the rule agent completes the simulated computer task', async () => {
  const task = new SimulatedComputerTask();
  const result = await new ComputerAgent({ adapter: task, planner: new RulePlanner(), controller: new DryRunController(task) }).run();
  assert.equal(result.status, 'complete');
  assert.equal(result.observation.terminal, true);
});

test('ollama planner accepts structured model decisions', async () => {
  const planner = new OllamaPlanner({ model: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ response: '{"action":"WAIT","reason":"observe"}' }) }) });
  assert.deepEqual(await planner.decide({ tick: 1 }, { summary: () => '' }), { action: 'WAIT', reason: 'observe' });
});

test('ollama planner accepts structured decisions returned in the thinking field', async () => {
  const planner = new OllamaPlanner({ model: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ response: '', thinking: '{"action":"CLOSE_WINDOW","reason":"goal complete"}' }) }) });
  assert.deepEqual(await planner.decide({ tick: 1 }, { summary: () => '' }), { action: 'CLOSE_WINDOW', reason: 'goal complete' });
});

test('ollama planner derives an omitted browser URL from the goal', async () => {
  const planner = new OllamaPlanner({ model: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ response: '{"action":"OPEN_BROWSER","reason":"open it"}' }) }) });
  const decision = await planner.decide({ objective: 'open a browser and navigate to google.com', availableActions: ['OPEN_BROWSER'] }, { summary: () => '' });
  assert.equal(decision.url, 'https://google.com');
});

test('ollama planner ignores whitespace response before reading thinking', async () => {
  const planner = new OllamaPlanner({ model: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ response: '  \n', thinking: '{"action":"CLOSE_WINDOW","reason":"goal complete"}' }) }) });
  assert.equal((await planner.decide({ tick: 1 }, { summary: () => '' })).action, 'CLOSE_WINDOW');
});

test('ollama planner rejects a model action missing from the enabled profile', async () => {
  const planner = new OllamaPlanner({ model: 'test', fallback: { decide: async () => ({ action: 'STOP', reason: 'invalid action' }) }, fetchImpl: async () => ({ ok: true, json: async () => ({ response: '{"action":"OPEN_MAP","reason":"wrong profile"}' }) }) });
  const decision = await planner.decide({ tick: 1, availableActions: ['TYPE_TEXT'] }, { summary: () => '' });
  assert.equal(decision.action, 'STOP');
});

test('screenshot mode does not present UI Automation actions to the model', async () => {
  let request;
  const planner = new OllamaPlanner({ model: 'test', fetchImpl: async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ response: '{"action":"WAIT","reason":"test"}' }) };
  } });
  await planner.decide({ availableActions: ['UIA_INVOKE', 'WAIT'], framePath: undefined }, { summary: () => '' });
  assert.doesNotMatch(request.prompt, /Enabled actions: UIA_INVOKE/);
});

test('ollama planner falls back after malformed output', async () => {
  const planner = new OllamaPlanner({ model: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ response: 'not json' }) }) });
  const decision = await planner.decide({ terminal: false, hp: 100, potions: 0, enemyDistance: 2, position: 0, goal: 3 }, { summary: () => '' });
  assert.equal(decision.action, 'WAIT');
  assert.match(decision.reason, /Fallback/);
});

test('the agent refreshes a live adapter after an input is sent', async () => {
  let refreshed = 0;
  const adapter = {
    observe: () => ({ terminal: false, tick: refreshed }),
    refresh: async () => ({ terminal: false, tick: ++refreshed })
  };
  const result = await new ComputerAgent({
    adapter,
    planner: { decide: async () => ({ action: 'WAIT', reason: 'test' }) },
    controller: { execute: async () => ({ status: 'sent', observation: {} }) },
    maxSteps: 1
  }).run();
  assert.equal(result.status, 'step_limit');
  assert.equal(refreshed, 1);
});

test('a STOP decision marked complete finishes the computer task', async () => {
  const result = await new ComputerAgent({
    adapter: { observe: () => ({ terminal: false, tick: 0 }) },
    planner: { decide: async () => ({ action: 'STOP', complete: true, reason: 'visible confirmation' }) },
    controller: { execute: async () => ({}) }
  }).run();
  assert.equal(result.status, 'complete');
});

test('a claimed completion is rejected when the screen did not change', async () => {
  let calls = 0;
  const observation = { terminal: false, tick: 0, frameHash: 'same' };
  const result = await new ComputerAgent({
    adapter: { observe: () => observation, refresh: async () => observation },
    planner: { decide: async () => (++calls === 1 ? { action: 'WAIT', reason: 'wait' } : { action: 'STOP', complete: true, reason: 'done' }) },
    controller: { execute: async () => ({ status: 'sent' }) },
    maxSteps: 2
  }).run();
  assert.equal(result.status, 'unverified_completion');
});

test('a failed controller action returns a structured failure', async () => {
  const result = await new ComputerAgent({
    adapter: { observe: () => ({ terminal: false, tick: 0 }) },
    planner: { decide: async () => ({ action: 'WAIT', reason: 'test' }) },
    controller: { execute: async () => ({ status: 'failed', observation: { error: 'launch failed' } }) }
  }).run();
  assert.equal(result.status, 'action_failed');
});

test('a changed Windows wallpaper completes a one-shot wallpaper task', async () => {
  const before = { terminal: false, tick: 0, objective: 'change my background to a local image', frameHash: 'before', wallpaper: { path: 'old.jpg' }, window: { title: 'Settings' } };
  const after = { ...before, tick: 1, frameHash: 'after', wallpaper: { path: 'new.jpg' } };
  const result = await new ComputerAgent({
    adapter: { observe: () => before, refresh: async () => after },
    planner: { decide: async () => ({ action: 'CLICK', target: { x: 0.5, y: 0.5 }, reason: 'select image' }) },
    controller: { execute: async () => ({ status: 'sent' }) }
  }).run();
  assert.equal(result.status, 'complete');
});

test('uses the text model when no screenshot is supplied', async () => {
  let request;
  const planner = new OllamaPlanner({ textModel: 'qwen3:4b', visionModel: 'qwen3-vl:4b', fetchImpl: async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ response: '{"action":"WAIT","reason":"test"}' }) };
  } });
  await planner.decide({ availableActions: ['WAIT'], ui: { controls: [{ key: 'button' }] } }, { summary: () => '' });
  assert.equal(request.model, 'qwen3:4b');
  assert.equal(request.images, undefined);
});

