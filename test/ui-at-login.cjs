'use strict';
// Testes no Chromium REAL do GitHub Actions, com AT integralmente simulada.
// Nunca usa contribuinte, servidor AT, senha real ou segredo do GitHub.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {makeAutoLogin}=require('../at-auto-login');
const LOGIN='https://www.acesso.gov.pt';
const AT='https://sitfiscal.portaldasfinancas.gov.pt';
const SECOND='https://autenticacao.gov.pt';
const NIF='123456789';
const PASSWORD='SENHA_FICTICIA_SO_CI';

function fakeLoginHTML(mode) {
  const destination=mode==='challenge' ? SECOND+'/autenticar' : AT+'/geral';
  const valid='document.querySelector("#username").value === '+JSON.stringify(NIF)+
    ' && document.querySelector("#password").value === '+JSON.stringify(PASSWORD);
  return [
    '<!doctype html><html lang="pt"><body><h1>AT MOCK — CI</h1>',
    '<form id="login" autocomplete="off">',
    '<input id="username" name="username" autocomplete="username" />',
    '<input id="password" name="password" type="password" />',
    '<button id="sbmt-btn" type="submit">Entrar</button>',
    '<p id="login-error"></p></form><script>',
    'document.querySelector("#login").addEventListener("submit", e=>{',
    'e.preventDefault();',
    'if ('+valid+') { location.assign('+JSON.stringify(destination)+'); }',
    'else {document.querySelector("#login-error").textContent="Credenciais rejeitadas";}',
    '});</script></body></html>'
  ].join('');
}
async function scenario(browser,mode) {
  const context=await browser.newContext();
  const seen=[];
  let protectedGets=0,reads=0;
  try {
    await context.route('**/*',route=>{
      const u=new URL(route.request().url());
      seen.push(u.origin);
      if(u.origin===LOGIN&&u.pathname==='/v2/loginForm') {
        return route.fulfill({status:200,contentType:'text/html',body:fakeLoginHTML(mode)});
      }
      if(u.origin===SECOND) {
        return route.fulfill({status:200,contentType:'text/html',
          body:'<!doctype html><input autocomplete="one-time-code" name="otp" />'});
      }
      if(u.origin===AT&&u.pathname==='/geral'){
        protectedGets++;
        return route.fulfill({status:200,contentType:'text/html',
          body:'<!doctype html><p id="authenticated">Area AT simulada</p>'});
      }
      if(u.origin===AT&&u.pathname==='/geral/dashboard/mensagens'){
        return route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({listaMensagens:[{id:'SIM-1'},{id:'SIM-2'}]})});
      }
      return route.fulfill({status:599,contentType:'text/plain',body:'MOCK_UNKNOWN_ROUTE'});
    });
    const vault={
      available:()=>true,has:()=>true,
      read:async()=>{reads++;return {nif:NIF,password:PASSWORD};}
    };
    const engine=makeAutoLogin({vault,cooldownMs:30});
    const page=await context.newPage();
    const visits=mode==='challenge'?1:2;
    for(let i=0;i<visits;i++){
      await page.goto(LOGIN+'/v2/loginForm?partID=PFAP',
        {waitUntil:'domcontentloaded'});
      assert.equal(new URL(page.url()).origin,LOGIN);
      const result=await engine.run(page);
      if(mode==='challenge'){
        assert.equal(result.phase,'verification_required');
        assert.equal(new URL(page.url()).origin,SECOND);
        assert.equal(await page.locator('input[autocomplete="one-time-code"]').count(),1);
      }else{
        assert.equal(result.phase,'submitted');
        assert.equal(new URL(page.url()).origin,AT);
        assert.equal(await page.locator('#authenticated').count(),1);
        const messages=await page.evaluate(async()=>{
          const r=await fetch('/geral/dashboard/mensagens',{credentials:'include'});
          return r.json();
        });
        assert.equal(messages.listaMensagens.length,2);
        engine.markAuthenticatedResult(true);
      }
    }
    assert.equal(reads,visits);
    assert.equal(protectedGets,mode==='challenge'?0:visits);
    assert.ok(seen.every(origin=>[LOGIN,AT,SECOND].includes(origin)));
    assert.ok(!seen.join(',').includes(PASSWORD));
    console.log('PASSOU Chromium '+mode+': tentativas='+reads+
      ', paginas fiscais simuladas='+protectedGets);
  }finally{await context.close();}
}
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    await scenario(browser,'normal');
    await scenario(browser,'challenge');
    console.log('E2E AT simulado: 2 cenarios aprovados, nenhuma visita real');
  }finally{await browser.close();}
})().catch(e=>{
  console.error('FALHA E2E: '+String(e.message||e).slice(0,900));
  process.exitCode=1;
});
