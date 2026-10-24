'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {validateReport,importChromeReport}=require('../chrome-bridge-import');
const manifest=require('../chrome-bridge/manifest.json');

test('extensao usa somente Financas e FiscalGuard local sem permissoes de cookies',()=>{
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.permissions,['tabs']);
  assert.ok(manifest.host_permissions.includes('https://sitfiscal.portaldasfinancas.gov.pt/*'));
  assert.ok(manifest.host_permissions.includes('http://127.0.0.1/*'));
  assert.equal(manifest.host_permissions.some(s=>s.includes('github.com')),false);
  assert.equal(manifest.permissions.includes('cookies'),false);
});

test('importacao recusa contagens nao verificadas e timestamps inventados',()=>{
  const date='2026-10-24T10:00:00.000Z';
  const baseline={phase:'synced',capturedAt:date,verifiedEndpoints:2,
    counts:{atMessages:0,atDebts:null,atFines:1}};
  const now=Date.parse(date);
  assert.equal(validateReport({...baseline,phase:'login_required'},now),null);
  assert.equal(validateReport({...baseline,verifiedEndpoints:0},now),null);
  assert.equal(validateReport({...baseline,capturedAt:'2025-10-24T10:00:00.000Z'},now),null);
  assert.equal(validateReport({...baseline,counts:{atMessages:-1,atFines:1}},now)?.counts?.atMessages,null);
  assert.equal(validateReport({...baseline,verifiedEndpoints:1},now),null);
  assert.equal(validateReport(baseline,now).counts.atDebts,null);
  assert.equal(validateReport(baseline,now).counts.atMessages,0);
});

test('importador grava somente contagens, nunca identificadores ou credenciais',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fg-bridge-'));
  try {
    const filename=path.join(dir,'snapshot.json');
    const date='2026-10-24T10:00:00.000Z';
    const response=importChromeReport({
      phase:'synced',capturedAt:date,verifiedEndpoints:3,
      counts:{atDebts:2,atMessages:0,atFines:null},
      password:'SEGREDO_DE_TESTE', nif:'123456789',
      cookies:'SEGREDO_DE_TESTE', ssStatus:'regular'
    },{filename,now:Date.parse(date)});
    assert.equal(response.success,true);
    assert.equal(response.counts.atDebts,2);
    const raw=fs.readFileSync(filename,'utf8');
    assert.equal(raw.includes('123456789'),false);
    assert.equal(raw.includes('SEGREDO_DE_TESTE'),false);
    const stored=JSON.parse(raw);
    assert.equal(stored.verifiedBy,'chrome-extension-same-origin');
    assert.equal(stored.summary.atDebts,2);
    assert.equal(stored.summary.atFines,null);
    assert.deepEqual(stored.vehicles,[]);
    assert.equal(stored.summary.ssStatus,'unknown');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('conteudo AT consulta o site ja autenticado e devolve apenas contagens',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../chrome-bridge/at-probe.js'),'utf8');
  let callback;
  const calls=[];
  const context={
    location:{origin:'https://sitfiscal.portaldasfinancas.gov.pt'},
    chrome:{runtime:{onMessage:{addListener:(fn)=>{callback=fn;}}}},
    fetch:async(url,opts)=>{
      calls.push({url,credentials:opts.credentials});
      return {
        ok:true,url:'https://sitfiscal.portaldasfinancas.gov.pt'+url,
        headers:{get:()=> 'application/json'},
        json:async()=> url.includes('mensagens')
          ? [{nif:'123456789',password:'SEGREDO_TESTE'}]
          : url.includes('dividas') ? {dataFromResponseList:[]} :
            {errors:['not available']}
      };
    },
    AbortController,URL,Date,Object,Promise,setTimeout,clearTimeout
  };
  vm.runInNewContext(source,context);
  assert.equal(typeof callback,'function');
  const result=await new Promise(resolve=>{
    assert.equal(callback({type:'FG_PROBE_AT'},null,resolve),true);
  });
  assert.equal(result.phase,'synced');
  assert.equal(result.counts.atMessages,1);
  assert.equal(result.counts.atDebts,0);
  assert.equal(result.counts.atFines,null);
  assert.ok(calls.every(c=>c.credentials==='include'));
  assert.equal(JSON.stringify(result).includes('123456789'),false);
  assert.equal(JSON.stringify(result).includes('SEGREDO_TESTE'),false);
});

test('redirecionamento de consultas para login não é contado como sucesso',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../chrome-bridge/at-probe.js'),'utf8');
  let callback;
  const context={
    location:{origin:'https://sitfiscal.portaldasfinancas.gov.pt'},
    chrome:{runtime:{onMessage:{addListener:(fn)=>{callback=fn;}}}},
    fetch:async()=>({
      ok:true,url:'https://www.acesso.gov.pt/v2/loginForm',
      headers:{get:()=> 'application/json'},
      json:async()=>[{id:1}]
    }),
    AbortController,URL,Date,Object,Promise,setTimeout,clearTimeout
  };
  vm.runInNewContext(source,context);
  const result=await new Promise(resolve=>callback({type:'FG_PROBE_AT'},null,resolve));
  assert.equal(result.phase,'unverified');
  assert.equal(result.verifiedEndpoints,0);
  assert.equal(result.counts.atDebts,null);
});
