const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDecision } = require('../src/actions');
const { normalizeScreenshotPoint } = require('../src/planner');
const { systemApplicationHints } = require('../src/window-computer');

test('validates browser URLs and normalized click targets', () => {
  assert.equal(validateDecision({ action: 'OPEN_BROWSER', url: 'https://google.com' }).url, 'https://google.com');
  assert.deepEqual(validateDecision({ action: 'CLICK', target: { x: 0.5, y: 0.25 } }).target, { x: 0.5, y: 0.25 });
  assert.throws(() => validateDecision({ action: 'OPEN_BROWSER', url: 'google.com' }));
  assert.equal(validateDecision({ action: 'OPEN_APPLICATION', application: 'Calculator' }).application, 'Calculator');
  assert.equal(validateDecision({ action: 'UIA_INVOKE', element: 'SaveButton' }).element, 'SaveButton');
  assert.equal(validateDecision({ action: 'OPEN_SYSTEM_SETTINGS', page: 'personalization-background' }).page, 'personalization-background');
  assert.deepEqual(normalizeScreenshotPoint({ x: 80, y: 14 }, { width: 160, height: 28 }), { x: 0.5, y: 0.5 });
  assert.deepEqual(systemApplicationHints('change my background to a local image'), ['Windows Settings']);
});
