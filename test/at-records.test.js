'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  recordsFromPayload,bundleFromInspection,displayRows,validateBundle,makeRecordStore
}=require('../at-records');

test('recolhe registos integrais de mensagens e interacoes, sem reduzir a contagens',()=>{
  const raw={
    recordPayloads:{
      atMessages:{listaMensagens:[{assunto:'Ato de teste',corpo:'Conteudo completo',data:'2026-10-24',referencia:'REF-01'}]},
      atInteractions:{dataFromResponseList:[{titulo:'Interacao teste',descricao:'Pedido submetido'}]},
      atDebts:{listaDividas:[]},
      atFines:{listaCoimas:[]},
      atAlerts:{listaAlertas:[]}
    }
  };
  const bundle=bundleFromInspection(raw,'2026-10-24T16:00:00Z');
  assert.equal(bundle.sections.atMessages.count,1);
  assert.equal(bundle.sections.atMessages.records[0].corpo,'Conteudo completo');
  assert.equal(bundle.sections.atInteractions.records[0].descricao,'Pedido submetido');
  assert.equal(bundle.sections.atDebts.status,'empty');
  const screen=displayRows(validateBundle(bundle));
  assert.equal(screen.sections.atMessages.items[0].fields.find(x=>x.label==='corpo').value,'Conteudo completo');
  assert.equal(screen.sections.atDebts.count,0);
});
test('perda de resposta nao pode inventar ausencia de dividas',()=>{
  const bundle=bundleFromInspection({recordPayloads:{atMessages:[]}});
  const output=validateBundle(bundle);
  assert.equal(output.sections.atDebts.status,'unverified');
  assert.equal(output.sections.atDebts.count,null);
  assert.equal(displayRows(output).sections.atDebts.count,null);
});
test('remove campos de credenciais e tokens em qualquer profundidade',()=>{
  const datum={
    assunto:'Consulta oficial',
    senha:'FICTICIO_SECRETO',cookie:'FICTICIO_COOKIE',NIF:'123456789',
    details:{token:'FICTICIO_TOKEN',mensagem:'Texto valido'},
    items:[{password:'FICTICIO_PW',valor:25}]
  };
  const captured=recordsFromPayload('atMessages',{messages:[datum]});
  const json=JSON.stringify(captured);
  assert.equal(captured.count,1);
  assert.ok(!json.includes('FICTICIO_SECRETO'));
  assert.ok(!json.includes('FICTICIO_COOKIE'));
  assert.ok(!json.includes('FICTICIO_TOKEN'));
  assert.ok(!json.includes('FICTICIO_PW'));
  assert.ok(json.includes('Texto valido'));
  assert.ok(json.includes('"valor":25'));
});
test('conserva contagem original mesmo com lote limitado pelo navegador',()=>{
  const out=recordsFromPayload('atInteractions',{
    dataFromResponseList:[{titulo:'TESTE'}],_captureTotal:2300
  });
  assert.equal(out.count,2300);
  assert.equal(out.records.length,1);
  assert.equal(out.truncated,true);
});
test('recusa importacoes sem proveniencia e escrita no disco C',()=>{
  assert.throws(()=>validateBundle({version:1,source:'fake',capturedAt:new Date().toISOString(),sections:{}}));
  assert.throws(()=>makeRecordStore({filename:'C:\\temp\\dados.dpapi'}));
  assert.equal(makeRecordStore({platform:'linux'}).available(),false);
});
