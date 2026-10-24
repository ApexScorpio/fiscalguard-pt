'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('servidor web local responde e nunca inventa dados fiscais', async () => {
  process.env.PORT = '49123';
  const app = require('../server');
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(49123, '127.0.0.1', () => resolve(s));
    s.once('error', reject);
  });

  try {
    const base = 'http://127.0.0.1:49123';
    const overview = await fetch(base + '/api/official/overview');
    assert.equal(overview.status, 200);
    const data = await overview.json();
    assert.ok(['not_imported', 'imported_unverified'].includes(data.status));
    if (data.status === 'not_imported') {
      assert.equal(data.summary.atDebts, null);
      assert.equal(data.summary.atFines, null);
      assert.deepEqual(data.vehicles, []);
    }

    const html = await fetch(base + '/');
    assert.equal(html.status, 200);
    const body = await html.text();
    assert.match(body, /Viaturas e próximos IUC/);
    assert.match(body, /official\.js/);

    const crossSite = await fetch(base + '/api/official/overview', {
      headers: { Origin: 'https://example.org' }
    });
    assert.equal(crossSite.status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
