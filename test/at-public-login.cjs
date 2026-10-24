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
    const target=page.url();
    const publicForm=page.locator('#username, input[name="username"], input[name="nif"], input[autocomplete="username"]').first();
    const publicPassword=page.locator('#password, input[type="password"]').first();
    const publicSubmit=page.locator('#sbmt-btn, button[type="submit"], input[type="submit"]').first();
    const found={
      loginUrl:isATLoginURL(target),
      userInput:(await publicForm.count())>0,
      passInput:(await publicPassword.count())>0,
      submitButton:(await publicSubmit.count())>0,
      frameCount:page.frames().length
    };
    console.log('AT_PUBLICA:',JSON.stringify({
      page:safeURL(target),status:response?.status()??null,found
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
