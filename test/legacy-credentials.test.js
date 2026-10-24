'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {saveCredentials}=require('../sync');

test('caminho legado não pode voltar a gravar credenciais em JSON',()=>{
  assert.throws(()=>saveCredentials({
    at:{nif:'123456789',password:'SENHA_FICTICIA_NAO_GRAVAR'},
    ss:{niss:'00000000000',password:'SENHA_FICTICIA_NAO_GRAVAR'}
  }),/DPAPI/);
});
