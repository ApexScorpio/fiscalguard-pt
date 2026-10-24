'use strict';
// E2E do GESTOR REAL num Chromium real em GitHub Actions.
// Os tres portais sao integralmente interceptados com paginas sinteticas.
// Nao faz pedidos a AT real, nao guarda nem mostra credenciais verdadeiras.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const {makeManager}=require('../at-managed');
const {makeAutoLogin}=require('../at-auto-login');

const LOGIN='https://www.acesso.gov.pt';
const AT='https://sitfiscal.portaldasfinancas.gov.pt';
const OTP='https://autenticacao.gov.pt';
const FAKE_NIF='123456789';
const FAKE_PASSWORD='SENHA_DE_TESTE_APENAS_CI';

function loginForm(mode){
  const dest=mode==='otp'?OTP+'/autenticar':AT+'/geral?autenticado_teste=1';
  return [
    '<!doctype html><html><body>',
    '<div role="tablist"><button type="button" role="tab" id="nif-tab">NIF</button></div>',
    '<form id="at-mock"><section id="nif-fields" hidden>',
    '<input name="username" />',
    '<input name="password" type="password" />',
    '<button type="submit">Autenticar</button>',
    '</section></form>',
    '<script>',
    'document.querySelector("#nif-tab").addEventListener("click",()=>{',
    'document.querySelector("#nif-fields").hidden=false;',
    '});',
    'document.querySelector("#at-mock").addEventListener("submit",e=>{',
    'e.preventDefault();',
    'if(document.querySelector("[name=username]").value === '+JSON.stringify(FAKE_NIF),
    '&&document.querySelector("[name=password]").value === '+JSON.stringify(FAKE_PASSWORD)+'){',
    'location.assign('+JSON.stringify(dest)+');',
    '}',
    '});',
    '</script></body></html>'
  ].join('');
}
function plainHTML(label){
  return '<!doctype html><html><body><p>'+label+'</p></body></html>';
}
async function runScenario(mode){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fiscalguard-managed-ci-'));
  const profile=path.join(dir,'profile');
  const snapshot=path.join(dir,'official-import.json');
  const observations={launches:0,vaultReads:0,loginPages:0,authedPages:0,requests:0};
  let authorized=false;
  let managed=null;
  const fakeVault={
    has:()=>true,available:()=>true,
    read:async()=>{observations.vaultReads++;return {nif:FAKE_NIF,password:FAKE_PASSWORD};}
  };
  const engine={launchPersistentContext:async(userDataDir,opts)=>{
    observations.launches++;
    assert.equal(opts.headless,true);
    const context=await chromium.launchPersistentContext(userDataDir,{
      ...opts,channel:'chromium',headless:true
    });
    await context.route('**/*',async route=>{
      observations.requests++;
      const req=route.request();
      const u=new URL(req.url());
      if(u.origin===LOGIN && u.pathname==='/v2/loginForm'){
        observations.loginPages++;
        return route.fulfill({status:200,contentType:'text/html',body:loginForm(mode)});
      }
      if(u.origin===OTP){
        return route.fulfill({status:200,contentType:'text/html',
          body:'<!doctype html><input name="otp" autocomplete="one-time-code" />'});
      }
      if(u.origin===AT && u.pathname==='/geral'){
        if(u.searchParams.has('autenticado_teste'))authorized=true;
        if(!authorized) {
          return route.fulfill({status:302,
            headers:{location:LOGIN+'/v2/loginForm?partID=PFAP'},
            contentType:'text/plain',body:'login test redirect'});
        }
        observations.authedPages++;
        return route.fulfill({status:200,contentType:'text/html',
          body:plainHTML('Sessao fiscal do teste')});
      }
      if(u.origin===AT && u.pathname==='/geral/dashboard/mensagens'){
        return route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({listaMensagens:[{id:'TESTE-1'},{id:'TESTE-2'}]})});
      }
      if(u.origin===AT && u.pathname==='/geral/dividas'){
        return route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({dataFromResponseList:[]})});
      }
      if(u.origin===AT && ['/geral/dashboard/alertas','/geral/dashboard/interacoes','/geral/coimas'].includes(u.pathname)){
        return route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({error:'Nao simulado'})});
      }
      // Bloqueio total de destinos externos para evitar trafego real.
      return route.fulfill({status:599,contentType:'text/plain',
        body:'PAGINA_NAO_AUTORIZADA_PELA_SIMULACAO'});
    });
    return context;
  }};
  try{
    const realAuto=makeAutoLogin({vault:fakeVault});
    const observedAuto={
      markAuthenticatedResult:value=>realAuto.markAuthenticatedResult(value),
      run:async page=>{
        const outcome=await realAuto.run(page);
        if(outcome.phase==='form_unrecognized'){
          // Somente presenca de campos e URL publica; nunca valores.
          console.log('E2E_FORM_DIAGNOSTICO',JSON.stringify({
            host:(()=>{try{return new URL(page.url()).hostname;}catch{return 'invalid';}})(),
            nifTabs:await page.getByRole('tab',{name:'NIF',exact:true}).count(),
            nifButtons:await page.getByRole('button',{name:'NIF',exact:true}).count(),
            userInputs:await page.locator('input[name="username"]').count(),
            userVisible:await page.locator('input[name="username"]:visible').count(),
            passInputs:await page.locator('input[name="password"]').count(),
            passVisible:await page.locator('input[name="password"]:visible').count(),
            submitVisible:await page.locator('button[type="submit"]:visible').count()
          }));
        }
        return outcome;
      }
    };
    managed=makeManager({
      engine,dir,profile,snapshot,vault:fakeVault,
      autoLogin:observedAuto
    });
    assert.equal(fs.existsSync(profile),false);
    const result=await managed.refresh();
    if(mode==='otp'){
      assert.equal(result.phase,'verification_required');
      assert.equal(observations.vaultReads,1);
      assert.equal(fs.existsSync(snapshot),false);
      console.log('PASSOU E2E gestor: desafio OTP detetado sem criar dados fiscais');
    }else{
      assert.equal(result.phase,'synced',result.message);
      assert.equal(result.counts.atDebts,0);
      assert.equal(result.counts.atMessages,2);
      assert.equal(observations.vaultReads,1);
      const data=JSON.parse(fs.readFileSync(snapshot,'utf8'));
      assert.equal(data.summary.atMessages,2);
      assert.equal(data.summary.atDebts,0);
      assert.equal(JSON.stringify(data).includes(FAKE_NIF),false);
      assert.equal(JSON.stringify(data).includes(FAKE_PASSWORD),false);
      // Mesmo perfil, sessao expirada: o gestor tem de executar nova autenticao.
      authorized=false;
      const again=await managed.refresh();
      assert.equal(again.phase,'synced',again.message);
      assert.equal(observations.vaultReads,2);
      assert.equal(observations.launches,1);
      assert.equal(observations.authedPages>=2,true);
      console.log('PASSOU E2E gestor: primeira entrada e reentrada AT apos expiracao simulada; consultas JSON validadas');
    }
  }finally{
    if(managed)await managed.closeContext();
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
(async()=>{
  await runScenario('normal');
  await runScenario('otp');
  console.log('Gestor AT E2E: motor real Playwright + Chromium, portais integralmente simulados');
})().catch(error=>{
  console.error('FALHA gestor AT E2E: '+String(error?.message||error).slice(0,1000));
  process.exitCode=1;
});
