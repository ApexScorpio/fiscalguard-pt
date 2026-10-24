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


test('ACEITACAO: gestor deve acionar o motor automatico quando AT redireciona para login',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fiscalguard-test-'));
  const fake=fakeEngine({authorized:false,recognized:0});
  let calls=0;
  const autoLogin={
    run:async()=>{calls++;return {phase:'verification_required'};},
    markAuthenticatedResult:()=>{}
  };
  try{
    const m=makeManager({
      engine:fake.browser,dir,profile:path.join(dir,'profile'),
      snapshot:path.join(dir,'overview.json'),autoLogin
    });
    await m.startLogin();
    const result=await m.confirmLogin();
    assert.equal(calls,1,'O motor de login automatico tem de ser chamado no redirecionamento');
    assert.equal(result.phase,'verification_required');
    assert.equal(fs.existsSync(path.join(dir,'overview.json')),false);
    await m.closeContext();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});


test('ACEITACAO: primeira sincronizacao autonoma funciona sem perfil se o cofre cifrado existir',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fiscalguard-test-'));
  let authenticated=false, attempts=0, launches=0, confirmed=0;
  const main={
    url:()=>'https://www.acesso.gov.pt/v2/loginForm?partID=PFAP',
    isClosed:()=>false,bringToFront:async()=>{},goto:async()=>{}
  };
  const verificationPage={
    url:()=>authenticated?'https://sitfiscal.portaldasfinancas.gov.pt/geral':
      'https://www.acesso.gov.pt/v2/loginForm?partID=PFAP',
    goto:async()=>{},
    isClosed:()=>false,
    close:async()=>{},
    evaluate:async()=>({verifiedEndpoints:2,counts:{atMessages:0,atDebts:0,atFines:null}})
  };
  const context={
    pages:()=>[main],
    newPage:async()=>verificationPage,
    on:()=>{},
    close:async()=>{}
  };
  const engine={launchPersistentContext:async(_profile,options)=>{
    launches++;
    assert.equal(options.headless,true);
    return context;
  }};
  const vault={has:()=>true,available:()=>true};
  const autoLogin={
    run:async page=>{
      assert.equal(page,verificationPage);
      attempts++;
      authenticated=true;
      return {phase:'submitted'};
    },
    markAuthenticatedResult:verified=>{if(verified)confirmed++;}
  };
  try{
    const profile=path.join(dir,'first-ever-profile');
    const snapshot=path.join(dir,'official.json');
    assert.equal(fs.existsSync(profile),false);
    const manager=makeManager({engine,dir,profile,snapshot,vault,autoLogin});
    // No arranque, painel e agendador podem pedir refresh em simultaneo.
    // Isso NUNCA pode criar multiplos Chromes com o mesmo perfil.
    const results=await Promise.all(Array.from({length:6},()=>manager.refresh()));
    const result=results[0];
    for(const entry of results)assert.equal(entry.phase,'synced');
    assert.equal(result.phase,'synced');
    assert.equal(result.counts.atDebts,0);
    assert.equal(launches,1);
    assert.equal(attempts,1);
    assert.equal(confirmed,1);
    assert.equal(JSON.parse(fs.readFileSync(snapshot,'utf8')).summary.atMessages,0);
    await manager.closeContext();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('ACEITACAO: codigo OTP permanece visivel e a aba nao e fechada pelo gestor',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fiscalguard-test-'));
  let challenge=false,closed=0,shown=0;
  const main={
    url:()=> 'https://www.acesso.gov.pt/v2/loginForm?partID=PFAP',
    isClosed:()=>false,bringToFront:async()=>{},goto:async()=>{}
  };
  const verification={
    url:()=>challenge?'https://autenticacao.gov.pt/autenticar':
      'https://www.acesso.gov.pt/v2/loginForm?partID=PFAP',
    goto:async()=>{},isClosed:()=>false,
    close:async()=>{closed++;},
    bringToFront:async()=>{shown++;}
  };
  const context={
    pages:()=>[main],newPage:async()=>verification,on:()=>{},
    close:async()=>{}
  };
  const manager=makeManager({
    engine:{launchPersistentContext:async()=>context},dir,
    profile:path.join(dir,'profile'),snapshot:path.join(dir,'snapshot.json'),
    vault:{has:()=>true,available:()=>true},
    autoLogin:{
      run:async()=>{challenge=true;return {phase:'verification_required'};},
      markAuthenticatedResult:()=>{}
    }
  });
  try{
    await manager.startLogin();
    // O temporizador de leitura iniciou o teste ao abrir o navegador.
    const result=await manager.confirmLogin();
    assert.equal(result.phase,'verification_required');
    assert.equal(closed,0,'nunca fechar a aba que contem o desafio OTP');
    assert.ok(shown>=1,'deixar o desafio visivel para o titular');
    assert.equal(fs.existsSync(path.join(dir,'snapshot.json')),false);
  }finally{
    await manager.closeContext();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
