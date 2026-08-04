const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown } = require('./helpers').createTestContext('project_tracker_test_health');

test('GET /health 返回 200', async (t) => {
  const { baseUrl } = await setup();
  t.after(() => teardown());

  const resp = await fetch(`${baseUrl}/health`);
  assert.strictEqual(resp.status, 200);
});
