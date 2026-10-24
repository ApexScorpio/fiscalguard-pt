'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeSync } = require('../sync-status');

test('ambos os portais com sucesso', () => {
  assert.deepEqual(summarizeSync({success:true}, {success:true}), {
    success:true, partialSuccess:false, requiresLogin:false,
    portals:{financas:'succeeded', segurancaSocial:'succeeded'}
  });
});
test('falha da AT nao pode ser comunicada como sucesso global', () => {
  const x = summarizeSync({success:false,requiresLogin:true}, {success:true});
  assert.equal(x.success,false);
  assert.equal(x.partialSuccess,true);
  assert.equal(x.requiresLogin,true);
  assert.equal(x.portals.financas,'login_required');
});
test('nenhuma resposta confirmada não equivale a sincronizacao', () => {
  const x = summarizeSync({},null);
  assert.equal(x.success,false);
  assert.equal(x.partialSuccess,false);
  assert.equal(x.requiresLogin,false);
});
