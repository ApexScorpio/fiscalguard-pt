'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {makeRecordStore,bundleFromInspection,validateBundle}=require('../at-records');

(async()=>{
  assert.equal(process.platform,'win32');
  const folder=path.win32.join('D:\\AssistenteFiscal','Temporarios',
    'FG_CI_REGISTOS_'+crypto.randomUUID());
  const file=path.win32.join(folder,'at-records.dpapi');
  fs.mkdirSync(folder,{recursive:true});
  try{
    const store=makeRecordStore({filename:file});
    const bundle=bundleFromInspection({recordPayloads:{
      atMessages:{mensagens:[{assunto:'MENSAGEM_CI',descricao:'DOCUMENTO_FICTICIO_PRIVADO'}]},
      atInteractions:{listaInteracoes:[{descricao:'INTERACAO_CI'}]},
      atDebts:{listaDividas:[]},
      atFines:{listaCoimas:[]},
      atAlerts:{listaAlertas:[]}
    }},'2026-10-24T14:00:00Z');
    assert.equal(store.available(),true);
    assert.equal(store.has(),false);
    const saved=await store.save(bundle);
    assert.equal(saved.saved,true);
    assert.equal(store.has(),true);
    const disk=fs.readFileSync(file);
    assert.ok(disk.length>32);
    assert.equal(disk.includes(Buffer.from('DOCUMENTO_FICTICIO_PRIVADO')),false);
    assert.equal(disk.includes(Buffer.from('MENSAGEM_CI')),false);
    const read=await makeRecordStore({filename:file}).read();
    assert.deepEqual(read,validateBundle(bundle));
    console.log('AT_REGISTOS_DPAPI=PASSOU_DADOS_FICTICIOS');
  }finally{fs.rmSync(folder,{force:true,recursive:true});}
})().catch(err=>{
  console.error('AT_REGISTOS_DPAPI=FALHOU_'+(err?.constructor?.name||'Error'));
  process.exitCode=1;
});
