const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionEngine, Permission } = require('../runtime/core/permissions');
const { VerificationEngine } = require('../runtime/core/verification');
const { StateManager } = require('../runtime/core/state');
const { HeuristicPlanner } = require('../runtime/planner/heuristic-planner');

test('permissions default to ask for terminal commands', () => {
  assert.equal(new PermissionEngine().check('terminal.execute'), Permission.ASK);
});
test('state records plan lifecycle', () => {
  const state = new StateManager(process.cwd()); state.transition('planning', { objective: 'test' }); state.setPlan([{ id: 'one' }]);
  assert.equal(state.snapshot().plan.length, 1);
});
test('planner creates a verification-bearing test step', async () => {
  const plan = await new HeuristicPlanner().plan('Fix the failing tests', process.cwd());
  assert.equal(plan.at(-1).expected.type, 'command_exit');
});
test('command verification uses expected exit code', async () => {
  assert.equal((await new VerificationEngine().verify({ type: 'command_exit', exitCode: 0, actualExitCode: 0 })).status, 'verified');
});
