'use strict';
// Diagnóstico público de login da AT. NÃO preenche nem envia quaisquer dados.
// Apenas contagens de controlos, HTTP e tipos de redirecionamento.
const {chromium}=require('playwright');
const LOGIN='https://www.acesso.gov.pt/v2/loginForm?partID=PFAP';
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
   const page=await browser.newPage({acceptDownloads:false});
   const response=await page.goto(LOGIN,{waitUntil:'domcontentloaded',timeout:25000});
   const at=new URL(page.url());
   const allowed=at.protocol==='https:' &&
     ['acesso.gov.pt','www.acesso.gov.pt','autenticacao.gov.pt',
       'www.autenticacao.gov.pt'].includes(at.hostname);
   if(!allowed)throw Error('Redirecionamento para origem inesperada');
   const fields=await page.evaluate(()=>{
     const count=selector=>document.querySelectorAll(selector).length;
     return {
       forms:count('form'),
       nif:count('#username, input[name="username"], input[name="nif"], input[autocomplete="username"]'),
       password:count('#password, input[type="password"]'),
       submit:count('#sbmt-btn,button[type="submit"],input[type="submit"]'),
       inputs:count('input'),
       buttons:count('button')
     };
   });
   console.log('AT_PUBLIC_LOGIN:',JSON.stringify({
     http:response?.status()||null,origin:at.origin,
     path:at.pathname,fields
   }));
   if(!fields.nif||!fields.password||!fields.submit){
     console.log('AT_FORM_INCOMPATIBLE: selectors need update after inspecting current public form');
     process.exitCode=2;
   }
 }finally{await browser.close();}
})().catch(err=>{
 console.error('AT_PUBLIC_LOGIN_ERROR:',String(err.name||'Error').slice(0,80));
 process.exitCode=3;
});
