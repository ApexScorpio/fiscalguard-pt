'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {makeVault,validCredentials}=require('../at-vault');

(async()=>{
  assert.equal(process.platform,'win32');
  const root=path.win32.join('D:\\AssistenteFiscal','Temporarios',
    'FG_CI_VAULT_'+crypto.randomUUID());
  const file=path.win32.join(root,'credentials.dpapi');
  fs.mkdirSync(root,{recursive:true});
  try {
    const vault=makeVault({filename:file});
    const credentials={nif:'123456789',password:'SENHA_FICTICIA_APENAS_TESTE'};
    assert.equal(validCredentials(credentials),true);
    assert.equal(vault.available(),true);
    assert.equal(vault.has(),false);
    console.log('DPAPI_ETAPA: PROTEGER');
    const saved=await vault.save(credentials);
    assert.equal(saved.saved,true);
    assert.equal(vault.has(),true);
    const bytes=fs.readFileSync(file);
    assert.ok(bytes.length>10);
    assert.ok(!bytes.includes(Buffer.from(credentials.password)));
    assert.ok(!bytes.includes(Buffer.from(credentials.nif)));
    const reopened=makeVault({filename:file});
    console.log('DPAPI_ETAPA: DESPROTEGER');
    const values=await reopened.read();
    assert.deepEqual(values,credentials);
    console.log('DPAPI Windows: APROVADO — cifrar e decifrar com dados fictícios');
  } finally {
    fs.rmSync(root,{force:true,recursive:true});
  }
})().catch(err=>{
  console.error('DPAPI Windows: FALHOU —',err?.constructor?.name, String(err?.message || '').slice(0,180));
  process.exitCode=1;
});
