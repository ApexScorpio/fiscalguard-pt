'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validDate, normalizeSnapshot } = require('../official-overview');

test('no capture means unknown, never zero obligations', () => {
  const result = normalizeSnapshot(null);
  assert.equal(result.status, 'not_imported');
  assert.equal(result.summary.atDebts, null);
  assert.equal(result.summary.atFines, null);
  assert.equal(result.summary.atMessages, null);
  assert.deepEqual(result.vehicles, []);
});

test('rejects malformed captures, including missing source evidence', () => {
  assert.equal(normalizeSnapshot({ version: 1, capturedAt: '2026-10-24' }).status, 'not_imported');
  assert.equal(normalizeSnapshot({ source: 'local-official-capture', version: 1, capturedAt: 'not-date' }).status, 'not_imported');
});

test('preserves only official supplied amounts and sorts by due date', () => {
  const result = normalizeSnapshot({
    version: 1,
    source: 'local-official-capture',
    capturedAt: '2026-10-24T10:00:00Z',
    summary: { atDebts: 0, atMessages: 4, atFines: -1 },
    vehicles: [
      { plate: 'AA-11-BB', dueDate: '2027-08-30', iucAmountEUR: 123.47, paymentStatus: 'pending' },
      { plate: 'CC-22-DD', dueDate: '2027-01-31', iucAmountEUR: null, paymentStatus: 'unknown' },
      { plate: 'secret', dueDate: '2027-01-02', iucAmountEUR: 22 },
      { plate: 'EE-33-FF', dueDate: 'invalid', iucAmountEUR: -1 }
    ]
  });
  assert.deepEqual(result.vehicles.map(v => v.plate), ['CC-22-DD', 'AA-11-BB', 'EE-33-FF']);
  assert.equal(result.vehicles[0].iucAmountEUR, null);
  assert.equal(result.vehicles[1].iucAmountEUR, 123.47);
  assert.equal(result.vehicles[2].iucAmountEUR, null);
  assert.equal(result.summary.atDebts, 0);
  assert.equal(result.summary.atFines, null);
  assert.equal(result.summary.atMessages, 4);
  assert.equal(result.status, 'imported_unverified');
});

test('rejects invalid dates rather than inventing a due date', () => {
  assert.equal(validDate('2027-02-30'), null);
  assert.equal(validDate('2027-02-28'), '2027-02-28');
  assert.equal(validDate('28/02/2027'), null);
});
