'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');
const extensionPath=path.join(__dirname,'../chrome-bridge');

(async()=>{
  const context=await chromium.launchPersistentContext('',{
    channel:'chromium',headless:true,
    args:[
      '--disable-extensions-except='+extensionPath,
      '--load-extension='+extensionPath
    ]
  });
  try {
    let sw=context.serviceWorkers()[0];
    if(!sw) sw=await context.waitForEvent('serviceworker',{timeout:15000});
    assert.ok(sw.url().startsWith('chrome-extension://'));
    let cookiesSeen=0;
    await context.addCookies([{
      name:'FG_AT_SESSION_TEST',value:'TEST_COOKIE_NOT_REAL',
      domain:'sitfiscal.portaldasfinancas.gov.pt',path:'/',
      secure:true,httpOnly:true,sameSite:'Lax'
    }]);
    await context.route('https://sitfiscal.portaldasfinancas.gov.pt/**',route=>{
      const u=new URL(route.request().url());
      const cookie=route.request().headers()['cookie']||'';
      if(cookie.includes('FG_AT_SESSION_TEST=TEST_COOKIE_NOT_REAL'))cookiesSeen++;
      if(u.pathname==='/geral') {
        return route.fulfill({
          status:200,contentType:'text/html',
          body:'<!doctype html><html><title>AT CI simulada</title><body>Teste local sem login real</body></html>'
        });
      }
      if(u.pathname==='/geral/dashboard/mensagens') {
        return route.fulfill({
          status:200,contentType:'application/json',
          body:JSON.stringify([{id:'fake-1'},{id:'fake-2'}])
        });
      }
      if(u.pathname==='/geral/dividas') {
        return route.fulfill({
          status:200,contentType:'application/json',
          body:JSON.stringify({dataFromResponseList:[]})
        });
      }
      return route.fulfill({
        status:200,contentType:'application/json',
        body:JSON.stringify({error:'endpoint nao implementado na simulacao'})
      });
    });
    const page=await context.newPage();
    await page.goto('http://127.0.0.1:4848/',{waitUntil:'domcontentloaded'});
    try {
      await page.locator('#official-at-debts').getByText('0 registos').waitFor({timeout:45000});
    } catch (error) {
      // Apenas informacao sintetica dos testes; nenhum dado de contribuintes.
      const state=await page.evaluate(()=>({
        session:document.querySelector('#official-at-session')?.textContent,
        debts:document.querySelector('#official-at-debts')?.textContent,
        importState:document.querySelector('#official-import-state')?.textContent,
        status:document.querySelector('#at-situation-text')?.textContent
      }));
      console.log('DIAGNOSTICO_EXTENSAO_CI:',JSON.stringify({
        state,openTabs:context.pages().map(p=>p.url()),cookiesSeen,
        serviceWorker:sw.url()
      }));
      throw error;
    }
    assert.equal((await page.locator('#official-at-messages').textContent()).trim(),'2 mensagens');
    assert.ok(cookiesSeen>0,'o Chrome deve enviar cookies no MESMO perfil e dominio');
    assert.match(await page.locator('#official-at-session').textContent(),/Chrome/i);
    const status=await page.evaluate(async()=>{
      const r=await fetch('/api/official/overview',{cache:'no-store'});
      return r.json();
    });
    assert.equal(status.status,'browser_reported');
    assert.equal(status.summary.atDebts,0);
    assert.equal(status.summary.atMessages,2);
    assert.deepEqual(status.vehicles,[]);
    console.log('PASSOU — extensao REAL ativa no Chromium e cookies do MESMO perfil reutilizadas');
    console.log('AT simulada via intercetacao; nao testa credenciais nem portal verdadeiro');
  }finally{await context.close();}
})().catch(error=>{
  console.error('EXTENSAO: FALHOU — '+String(error.message||error).slice(0,1500));
  process.exitCode=1;
});
