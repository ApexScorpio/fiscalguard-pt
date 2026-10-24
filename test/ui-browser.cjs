'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless:true });
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    let imported=false;
    let legacyLoginCalls=0;
    let bridgeImports=0;
    await page.route('**/api/at/session',route=>route.fulfill({
      contentType:'application/json',
      body:JSON.stringify({phase:'not_checked',message:'Sessão AT por verificar'})
    }));
    await page.route('**/api/official/overview',route=>route.fulfill({
      contentType:'application/json',
      body:JSON.stringify(imported?{
        status:'browser_reported',capturedAt:new Date().toISOString(),
        summary:{atDebts:0,atFines:null,atMessages:3,ssStatus:'unknown'},vehicles:[]
      }:{
        status:'not_imported',capturedAt:null,
        summary:{atDebts:null,atFines:null,atMessages:null,ssStatus:'unknown'},vehicles:[]
      })
    }));
    await page.route('**/api/at/browser-result',route=>{
      const report=route.request().postDataJSON();
      assert.equal(report.phase,'synced');
      assert.equal(report.counts.atDebts,0);
      assert.equal(report.counts.atMessages,3);
      imported=true;bridgeImports++;
      return route.fulfill({
        contentType:'application/json',
        body:JSON.stringify({
          success:true,phase:'synced',
          message:'Contagens da AT recolhidas na sessao existente do Chrome',
          capturedAt:report.capturedAt,verifiedEndpoints:2,counts:report.counts
        })
      });
    });
    await page.route('**/api/at/login',route=>{
      legacyLoginCalls++;
      return route.fulfill({status:500,body:'Not allowed in browser-bridge test'});
    });

    await page.goto('http://127.0.0.1:4848/',{waitUntil:'domcontentloaded',timeout:25000});
    await page.locator('#official-at-session').waitFor();
    await page.locator('#official-at-debts').getByText('Por consultar').waitFor();

    // Simular a ponte instalada no MESMO Chrome. Nenhuma janela de login nova.
    await page.evaluate(()=>{
      const CHANNEL='FiscalGuardATChrome';
      window.__testBridgeChecks=0;
      window.addEventListener('message',event=>{
        if(event.source!==window || event.data?.channel!==CHANNEL)return;
        if(event.data.action!=='CHECK')return;
        window.__testBridgeChecks++;
        window.postMessage({
          channel:CHANNEL,action:'RESULT',requestId:event.data.requestId,
          result:{
            phase:'synced',verifiedEndpoints:2,
            capturedAt:new Date().toISOString(),
            counts:{atDebts:0,atMessages:3,atFines:null}
          }
        },location.origin);
      });
      window.postMessage({channel:CHANNEL,action:'BRIDGE_READY'},location.origin);
    });

    await page.locator('#official-at-debts').getByText('0 registos').waitFor();
    assert.equal((await page.locator('#official-at-messages').textContent()).trim(),'3 mensagens');
    assert.match(await page.locator('#official-at-session').textContent(),/Chrome/i);
    assert.equal((await page.locator('#official-ss-status').textContent()).trim(),'Por consultar');
    await page.locator('#btn-official-refresh').click();
    await page.waitForFunction(()=>window.__testBridgeChecks>=2);
    assert.equal(legacyLoginCalls,0);
    assert.ok(bridgeImports>=1);
    console.log('UI: PASSOU — reutiliza sessao simulada do Chrome, sem abrir login novo');

    // Passar agora ao cofre DPAPI simulado: o botao deve chamar o
    // gestor automatizado, NAO repetir a consulta da extensao Chrome.
    let managedRefreshes=0;
    await page.route('**/api/vault/credentials',route=>route.fulfill({
      contentType:'application/json',
      body:JSON.stringify({at:{hasPassword:true},ss:{hasPassword:false}})
    }));
    await page.route('**/api/at/refresh',route=>{
      managedRefreshes++;
      return route.fulfill({
        contentType:'application/json',
        body:JSON.stringify({phase:'synced',message:'AT autenticada (mock)',
          lastVerifiedAt:new Date().toISOString(),verifiedEndpoints:2,
          counts:{atMessages:2,atDebts:0,atFines:null}})
      });
    });
    await page.evaluate(()=>refreshConfiguredAT());
    assert.equal(managedRefreshes,1);
    assert.equal(await page.evaluate(()=>window.__fgUsingManagedAT),true);
    const chromeBefore=await page.evaluate(()=>window.__testBridgeChecks);
    await Promise.all([
      page.waitForResponse(r=>r.url().endsWith('/api/at/refresh'),{timeout:12000}),
      page.locator('#btn-official-refresh').click()
    ]);
    assert.equal(managedRefreshes,2);
    assert.equal(await page.evaluate(()=>window.__testBridgeChecks),chromeBefore);

    // Regressao: botão principal de sincronização antes ignorava
    // completamente o cofre e insistia sempre na extensão Chrome.
    await Promise.all([
      page.waitForResponse(r=>r.url().endsWith('/api/at/refresh'),{timeout:12000}),
      page.locator('#btn-sync-all').click()
    ]);
    assert.equal(managedRefreshes,3);
    assert.equal(await page.evaluate(()=>window.__testBridgeChecks),chromeBefore);
    console.log('UI: PASSOU — botoes principais e painel usam o mesmo gestor AT com cofre');
    console.log('IMPORTANTE: testes de interface NAO provam consulta autenticada real');
  } finally {
    await browser.close();
  }
})().catch(err=>{
  console.error('UI: FALHOU — '+String(err.message||err).slice(0,800));
  process.exitCode=1;
});
