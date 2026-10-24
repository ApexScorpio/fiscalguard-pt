'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {isATLoginURL,makeAutoLogin}=require('../at-auto-login');
const {validCredentials}=require('../at-vault');

test('rejeita dominios falsos e nao se autentica noutros portais',()=>{
  assert.equal(isATLoginURL('https://www.acesso.gov.pt/v2/loginForm?partID=PFAP'),true);
  assert.equal(isATLoginURL('https://acesso.gov.pt/v2/loginForm?partID=PFAP'),true);
  assert.equal(isATLoginURL('http://www.acesso.gov.pt/v2/loginForm?partID=PFAP'),false);
  assert.equal(isATLoginURL('https://www.acesso.gov.pt.evil.test/v2/loginForm?partID=PFAP'),false);
  assert.equal(isATLoginURL('https://www.acesso.gov.pt/v2/loginForm?partID=OTHER'),false);
});

test('valida nif e senha mas nao devolve os valores',()=>{
  assert.equal(validCredentials({nif:'123456789',password:'SENHA_DE_TESTE'}),true);
  assert.equal(validCredentials({nif:'123',password:'SENHA_DE_TESTE'}),false);
  assert.equal(validCredentials({nif:'123456789',password:''}),false);
});

function fakePage(){
  let url='https://www.acesso.gov.pt/v2/loginForm?partID=PFAP';
  const fills=[], clicks=[];
  const field=key=>({
    count:async()=>1,
    fill:async v=>fills.push({key,val:v}),
    click:async()=>{clicks.push(key);url='https://sitfiscal.portaldasfinancas.gov.pt/geral';}
  });
  return {
    url:()=>url,
    locator:selector=>({first:()=>field(selector),count:async()=>0}),
    waitForURL:async()=>{},
    fills,clicks
  };
}

test('um login simulado usa credenciais de cofre local e respeita cooldown',async()=>{
  let reads=0;
  let now=1000000;
  const vault={
    available:()=>true,has:()=>true,
    read:async()=>{reads++;return {nif:'123456789',password:'SENHA_DE_TESTE'};}
  };
  const login=makeAutoLogin({vault,now:()=>now});
  const page=fakePage();
  const result=await login.run(page);
  assert.equal(result.phase,'submitted');
  assert.equal(page.clicks.length,1);
  assert.equal(reads,1);
  assert.equal(page.fills.length,2);
  assert.equal(page.fills[0].val,'123456789');
  assert.equal(page.fills[1].val,'SENHA_DE_TESTE');
  const other=fakePage();
  assert.equal((await login.run(other)).phase,'cooldown');
  assert.equal(reads,1);
  now+=16*60*1000;
  assert.equal((await login.run(other)).phase,'submitted');
  assert.equal(reads,2);
});

test('sem cofre não tenta fazer login, não envia identificadores',async()=>{
  const page=fakePage();
  const login=makeAutoLogin({vault:{available:()=>false,has:()=>false}});
  assert.equal((await login.run(page)).phase,'credentials_missing');
  assert.equal(page.clicks.length,0);
});
