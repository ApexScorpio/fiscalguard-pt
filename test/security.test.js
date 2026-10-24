'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { localOnlyGuard } = require('../security');

function probe(headers) {
  const result = { passed: false, status: null, body: null };
  const res = {
    status(value) { result.status = value; return this; },
    json(value) { result.body = value; return this; }
  };
  localOnlyGuard(4848)({ headers }, res, () => { result.passed = true; });
  return result;
}

test('permite acesso pelo localhost', () => {
  assert.equal(probe({ host: 'localhost:4848' }).passed, true);
  assert.equal(probe({ host: '127.0.0.1:4848' }).passed, true);
});

test('permite pedidos da mesma origem', () => {
  assert.equal(probe({ host: 'localhost:4848', origin: 'http://localhost:4848' }).passed, true);
});

test('bloqueia origem externa e pedidos cross-site', () => {
  assert.equal(probe({ host: 'localhost:4848', origin: 'https://evil.example' }).status, 403);
  assert.equal(probe({ host: 'localhost:4848', 'sec-fetch-site': 'cross-site' }).status, 403);
});

test('bloqueia DNS rebinding e cabeçalhos de host inesperados', () => {
  assert.equal(probe({ host: 'example.com:4848' }).status, 403);
  assert.equal(probe({ host: 'localhost.evil.example:4848' }).status, 403);
  assert.equal(probe({ host: '' }).status, 403);
});

test('bloqueia origens inválidas e com esquema diferente', () => {
  assert.equal(probe({ host: 'localhost:4848', origin: 'not-a-url' }).status, 403);
  assert.equal(probe({ host: 'localhost:4848', origin: 'https://localhost:4848' }).status, 403);
});
