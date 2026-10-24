'use strict';
// Sonda PUBLICA, SEM AUTENTICACAO: utiliza o portal AT real apenas para
// confirmar o endereco/formulario. Nunca introduz nem submete credenciais.
// A falha deste teste NAO prova que o login em browser normal falha.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {isATLoginURL}=require('../at-auto-login');
const ENTRY='https://www.acesso.gov.pt/v2/loginForm?partID=PFAP';
const safeURL=raw=>{
  try {
    const u=new URL(raw);
    return u.protocol+'//'+u.hostname+u.pathname;
  }catch{return 'INVALID_URL';}
};
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({acceptDownloads:false});
    const page=await context.newPage();
    const response=await page.goto(ENTRY,{waitUntil:'domcontentloaded',timeout:35000});
    await page.waitForTimeout(1800);
    const nifOption=page.getByRole('tab',{name:'NIF',exact:true}).first();
    const nifTabPresent=(await nifOption.count())>0;
    if(nifTabPresent){
      await nifOption.click({timeout:8000}); // Apenas selecao visual, NUNCA submeter
      await page.waitForTimeout(400);
    }
    const target=page.url();
    const publicForm=page.locator('#username, input[name="username"], input[name="nif"], input[autocomplete="username"]').first();
    const publicPassword=page.locator('#password, input[type="password"]').first();
    const publicSubmit=page.getByRole('button',{name:'Autenticar',exact:true}).first();
    const nifSubmitCount=await publicSubmit.count();
    const nifSubmitVisible=nifSubmitCount ? await publicSubmit.isVisible() : false;
    const nifUserVisible=(await publicForm.count())>0 && await publicForm.isVisible();
    const nifPassVisible=(await publicPassword.count())>0 && await publicPassword.isVisible();
    const found={
      loginUrl:isATLoginURL(target),
      userInput:nifUserVisible,
      passInput:nifPassVisible,
      submitButton:nifSubmitVisible,
      frameCount:page.frames().length
    };
    // A estrutura publica e segura; nunca ler .value nem cookies/tokens.
    const structure=await page.evaluate(()=>({
      forms:[...document.querySelectorAll('form')].slice(0,6).map(e=>({
        id:e.id,method:e.getAttribute('method'),action:(()=>{
          try {return new URL(e.getAttribute('action')||location.href).pathname;}
          catch{return 'invalid';}
        })()
      })),
      inputs:[...document.querySelectorAll('input')].slice(0,30).map(e=>({
        id:e.id,name:e.getAttribute('name'),type:e.getAttribute('type'),
        autocomplete:e.getAttribute('autocomplete'),hidden:e.hidden,
        rendered:!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length)
      })),
      buttons:[...document.querySelectorAll('button')].slice(0,18).map(e=>({
        id:e.id,name:e.getAttribute('name'),type:e.getAttribute('type'),
        label:(e.innerText||'').trim().slice(0,45)
      })),
      headings:[...document.querySelectorAll('h1,h2,h3')].slice(0,8).map(e=>(e.innerText||'').trim().slice(0,70)),
      frames:[...document.querySelectorAll('iframe')].slice(0,6).map(e=>({
        id:e.id,src:(()=>{try{return new URL(e.src).hostname;}catch{return null;}})()
      }))
    }));
    console.log('AT_PUBLICA:',JSON.stringify({
      page:safeURL(target),status:response?.status()??null,nifTabPresent,found,structure
    }));
    assert.equal(found.loginUrl,true,
      'Redirecionamento nao corresponde a URL de login reconhecida; necessita revisao de dominios');
    assert.ok(found.userInput && found.passInput && found.submitButton,
      'Nao encontrou formulario no DOM publico AT; investigar estrutura dinamica ou protecao anti-bot');
    console.log('AT_PUBLICA: CONFIRMADA pagina real sem submissao/segredos');
    await context.close();
  }finally{await browser.close();}
})().catch(e=>{
  console.error('AT_PUBLICA: FALHA DE INSPECAO SEM LOGIN: '+String(e.message||e).slice(0,500));
  process.exitCode=1;
});
