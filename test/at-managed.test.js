'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeManager, officialHost, fiscalHost, countFromPayload } = require('../at-managed');

test('só URLs oficiais HTTPS, não subdomínios forjados', () => {
  assert.equal(officialHost('https://sitfiscal.portaldasfinancas.gov.pt/geral'), true);
  assert.equal(officialHost('https://www.portaldasfinancas.gov.pt/pt/home.action'), true);
  assert.equal(officialHost('https://portaldasfinancas.gov.pt.evil.org/login'), false);
  assert.equal(officialHost('http://sitfiscal.portaldasfinancas.gov.pt/geral'), false);
  assert.equal(fiscalHost('https://www.portaldasfinancas.gov.pt'), false);
});

test('só contar arrays comprovados, nunca assumir dívida zero por ausência', () => {
  assert.equal(countFromPayload('atDebts', { dataFromResponseList: [] }), 0);
  assert.equal(countFromPayload('atMessages', [{ id: 1 }, { id: 2 }]), 2);
  assert.equal(countFromPayload('atDebts', {error:'unauthorized'}), null);
  assert.equal(countFromPayload('atDebts', {other:[]}), null);
  assert.equal(countFromPayload('atFines', {listaCoimas:[{id:1}]}), 1);
});

function fakeEngine({authorized = false, recognized = 0} = {}) {
  let mainUrl = 'https://www.acesso.gov.pt/v2/loginForm';
  let closed = 0;
  let launched = 0;
  const main = {
    goto: async() => {},
    url: () => mainUrl,
    isClosed: () => false,
    bringToFront: async () => {}
  };
  const verify = {
    goto: async() => {},
    url: () => authorized ? 'https://sitfiscal.portaldasfinancas.gov.pt/geral' :
      'https://www.acesso.gov.pt/v2/loginForm',
    evaluate: async() => ({
      verifiedEndpoints: recognized,
      counts: {atMessages:0,atDebts:1,atFines:null}
    }),
    isClosed: () => false,
    close: async () => {}
  };
  const context = {
    pages: () => [main],
    newPage: async () => verify,
    on: () => {},
    close: async () => {closed++;},
  };
  return {
    browser: {launchPersistentContext: async () => { launched++; return context; }},
    launches: () => launched,
    setLoggedIn: () => {mainUrl='https://www.portaldasfinancas.gov.pt/pt/home.action';},
    closed: () => closed
  };
}

test('sem perfil e sem navegador, não afirma login nem recolha', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fiscalguard-test-'));
  try {
    const m = makeManager({engine:{launchPersistentContext:()=>{throw Error('must not launch');}},
      dir,profile:path.join(dir,'profile'),snapshot:path.join(dir,'overview.json')});
    assert.equal((await m.refresh()).phase, 'login_required');
    assert.equal((await m.confirmLogin()).phase, 'login_required');
    assert.equal(fs.existsSync(path.join(dir,'overview.json')), false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('login real simulado: só importa depois de resposta autenticada e validada', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'fiscalguard-test-'));
  const f=fakeEngine({authorized:true,recognized:3});
  try {
    const m=makeManager({engine:f.browser,dir,profile:path.join(dir,'profile'),
      snapshot:path.join(dir,'overview.json')});
    const login=await m.startLogin();
    assert.ok(['waiting_login','verifying'].includes(login.phase));
    assert.equal(fs.existsSync(path.join(dir,'overview.json')), false);
    f.setLoggedIn();
    const result=await m.confirmLogin();
    assert.equal(result.phase,'synced');
    assert.equal(result.verifiedEndpoints,3);
    assert.equal(result.counts.atDebts,1);
    const data=JSON.parse(fs.readFileSync(path.join(dir,'overview.json'),'utf8'));
    assert.equal(data.verifiedBy,'authenticated-json-endpoint');
    assert.equal(data.summary.atMessages,0);
    assert.equal(data.summary.atFines,null);
    // Uma recolha com sucesso NUNCA deve terminar a sessao no browser.
    assert.equal(f.closed(),0);
    assert.equal(f.launches(),1);
    assert.equal(JSON.stringify(data).includes('password'),false);
    const next=await m.refresh();
    assert.equal(next.phase,'synced');
    assert.equal(f.closed(),0);
    assert.equal(f.launches(),1);
    await m.startLogin();
    assert.equal(f.launches(),1);
    await m.closeContext();
    assert.equal(f.closed(),1);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('portal não confirmado: não criar ficheiro fiscal nem fingir sucesso', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fiscalguard-test-'));
  const f=fakeEngine({authorized:false,recognized:0});
  try {
    const m=makeManager({engine:f.browser,dir,profile:path.join(dir,'profile'),
      snapshot:path.join(dir,'overview.json')});
    await m.startLogin();
    f.setLoggedIn();
    const result=await m.confirmLogin();
    assert.equal(result.phase,'login_required');
    assert.equal(fs.existsSync(path.join(dir,'overview.json')),false);
    await m.closeContext();
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('JSON inesperado não pode validar sessão nem ser convertido em número zero', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fiscalguard-test-'));
  const f=fakeEngine({authorized:true,recognized:0});
  try {
    const m=makeManager({engine:f.browser,dir,profile:path.join(dir,'profile'),
      snapshot:path.join(dir,'overview.json')});
    await m.startLogin();
    f.setLoggedIn();
    const result=await m.confirmLogin();
    assert.equal(result.phase,'unverified');
    assert.equal(fs.existsSync(path.join(dir,'overview.json')),false);
    await m.closeContext();
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('dez atualizacoes sobre a mesma sessão não provocam dez novos logins', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fiscalguard-test-'));
  const fake=fakeEngine({authorized:true,recognized:2});
  try {
    const m=makeManager({engine:fake.browser,dir,profile:path.join(dir,'profile'),
      snapshot:path.join(dir,'overview.json')});
    await m.startLogin();
    fake.setLoggedIn();
    assert.equal((await m.confirmLogin()).phase,'synced');
    for (let i=0; i<10; i++) {
      assert.equal((await m.refresh()).phase,'synced');
    }
    assert.equal(fake.launches(),1);
    assert.equal(fake.closed(),0);
    await m.closeContext();
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
