'use strict';
// Preenche APENAS o formulário oficial de autenticação da AT.
// Não contorna SMS/2FA, bloqueios, CAPTCHA, limites nem anti-bot.
const {validCredentials}=require('./at-vault');

function isATLoginURL(raw) {
  try {
    const u=new URL(raw);
    return u.protocol==='https:' &&
      ['www.acesso.gov.pt','acesso.gov.pt'].includes(u.hostname) &&
      u.pathname.startsWith('/v2/loginForm') &&
      (u.searchParams.get('partID')==='PFAP' ||
       u.searchParams.get('partID')===null);
  } catch {return false;}
}
function isChallengeURL(raw) {
  try {
    const u=new URL(raw);
    return u.protocol==='https:' &&
      (u.hostname==='autenticacao.gov.pt' ||
       u.hostname.endsWith('.autenticacao.gov.pt'));
  } catch {return false;}
}

function makeAutoLogin({vault,now=()=>Date.now(),cooldownMs=15*60*1000}={}) {
  let lastAttemptAt=0;
  let inFlight=null;
  async function run(page) {
    if (!isATLoginURL(page.url())) {
      return {phase:isChallengeURL(page.url())?'verification_required':'not_login_page'};
    }
    if (!vault || !vault.available?.() || !vault.has?.()) {
      return {phase:'credentials_missing'};
    }
    // Uma tentativa em curso é partilhada: não executar dois submits.
    if(inFlight)return inFlight;
    if(lastAttemptAt>0 && now()-lastAttemptAt<cooldownMs) {
      return {phase:'cooldown',retryAfterSeconds:Math.ceil((cooldownMs-(now()-lastAttemptAt))/1000)};
    }
    inFlight=(async()=>{
      // Redirecionar para acesso.gov.pt nao significa que o React da pagina
      // ja terminou de montar o formulario; aguardar DOM antes de procurar.
      if(typeof page.waitForLoadState==='function') {
        await page.waitForLoadState('domcontentloaded',{timeout:10000}).catch(()=>{});
      }
      if(!isATLoginURL(page.url()))return {phase:'not_login_page'};
      const creds=await vault.read();
      if(!validCredentials(creds))return {phase:'credentials_missing'};
      const user=page.locator('#username:visible, input[name="username"]:visible, input[name="nif"]:visible, input[autocomplete="username"]:visible').first();
      const pass=page.locator('#password:visible, input[type="password"]:visible').first();
      // A pagina oficial pode ter varios formulários (CMD, NIF, EORI).
      // Preferir sempre o botao da área NIF pelo nome exato, para nunca
      // escolher acidentalmente a opcao Chave Movel Digital.
      const namedSubmit=typeof page.getByRole==='function'
        ? page.getByRole('button',{name:'Autenticar',exact:true}).first() : null;
      const fallbackSubmit=page.locator('#sbmt-btn:visible, button[type="submit"]:visible, input[type="submit"]:visible').first();
      const button=namedSubmit && await namedSubmit.count() ? namedSubmit : fallbackSubmit;
      let [userPresent,passPresent,buttonPresent]=await Promise.all([
        user.count(),pass.count(),button.count()
      ]);
      // A pagina real apresenta inicialmente separadores CC/CMD, NIF e EORI.
      // Apenas selecionar o separador NIF, sem submeter dados nem mudar URL.
      if((!userPresent||!passPresent) && isATLoginURL(page.url())) {
        const nifTab=page.getByRole('tab',{name:'NIF',exact:true}).first();
        if(await nifTab.count()) {
          await nifTab.click({timeout:10000});
          await user.waitFor({state:'visible',timeout:7000}).catch(()=>{});
          [userPresent,passPresent,buttonPresent]=await Promise.all([
            user.count(),pass.count(),button.count()
          ]);
        }
      }
      if(!userPresent||!passPresent||!buttonPresent) {
        return {phase:'form_unrecognized'};
      }
      if(!isATLoginURL(page.url()))return {phase:'not_login_page'};
      // Definir cooldown ANTES de submeter evita repetição involuntária.
      lastAttemptAt=now();
      await user.fill(creds.nif,{timeout:10000});
      await pass.fill(creds.password,{timeout:10000});
      await button.click({timeout:10000});
      await page.waitForURL(url=>!isATLoginURL(String(url)),{timeout:18000}).catch(()=>{});
      if(isChallengeURL(page.url()))return {phase:'verification_required'};
      const challenge=page.locator('input[autocomplete="one-time-code"],input[name*="otp" i],input[id*="otp" i],input[name*="sms" i]');
      if(await challenge.count().catch(()=>0))return {phase:'verification_required'};
      if(isATLoginURL(page.url()))return {phase:'login_unconfirmed'};
      return {phase:'submitted'};
    })().catch(error=>({phase:'technical_error',type:error?.constructor?.name||'Error'}))
      .finally(()=>{inFlight=null;});
    return inFlight;
  }
  // Só a confirmação real de uma consulta autenticada deve libertar
  // o bloqueio. A simples mudança de URL NÃO demonstra que houve login.
  function markAuthenticatedResult(verified) {
    if(verified === true && !inFlight) lastAttemptAt=0;
  }
  return {run,markAuthenticatedResult,isATLoginURL,isChallengeURL};
}
module.exports={makeAutoLogin,isATLoginURL,isChallengeURL};
