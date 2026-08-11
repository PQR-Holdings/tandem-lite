const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const extension = fs.readFileSync(path.join(root, 'extension', 'extension.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'media', 'sidebar.js'), 'utf8');

test('sidebar uses the redesigned semantic regions and external assets', () => {
  for (const id of ['planSection', 'activitySection', 'detailsSection', 'statusTitle', 'reviewNote']) {
    assert.match(extension, new RegExp(`id="${id}"`));
  }
  assert.match(extension, /media', 'sidebar\.css'/);
  assert.doesNotMatch(extension, /style-src 'unsafe-inline'/);
  assert.doesNotMatch(extension, /document\.getElementById\('key'\)/);
});

test('sidebar rendering escapes dynamic plan and activity content', () => {
  assert.match(sidebar, /escapeHtml\(step\.intent/);
  assert.match(sidebar, /escapeHtml\(item\.intent/);
  assert.match(extension, /aria-live="polite"/);
});
