'use strict';
const HOME = 'https://sitfiscal.portaldasfinancas.gov.pt/geral';
const ALLOWED_APP = 'http://127.0.0.1:4848/';
let running = null;

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function authorizedSender(sender) {
  try {
    const url = new URL(sender.url);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
      url.port === '4848';
  } catch { return false; }
}
function safeStatus(raw) {
  const phase = ['synced','unverified','login_required','error'].includes(raw?.phase)
    ? raw.phase : 'error';
  const counts = {};
  for (const field of ['atMessages','atDebts','atFines']) {
    const value = raw?.counts?.[field];
    counts[field] = Number.isSafeInteger(value) && value >= 0 && value < 10000000
      ? value : null;
  }
  return {
    phase,
    message: typeof raw?.message === 'string' ? raw.message.slice(0,150)
      : 'Sem resposta confirmada',
    capturedAt: phase === 'synced' && Number.isFinite(Date.parse(raw.capturedAt))
      ? new Date(raw.capturedAt).toISOString() : null,
    verifiedEndpoints: Number.isSafeInteger(raw?.verifiedEndpoints)
      ? Math.min(5,Math.max(0,raw.verifiedEndpoints)) : 0,
    counts
  };
}

async function checkExistingChrome() {
  let tab;
  const existing = await chrome.tabs.query({
    url: 'https://sitfiscal.portaldasfinancas.gov.pt/*'
  });
  if (existing.length) {
    tab = existing[0];
  } else {
    // A aba é INATIVA e pertence ao Chrome já utilizado pelo contribuinte;
    // nunca cria perfil, nem abre outro processo com cookies distintos.
    tab = await chrome.tabs.create({url:HOME,active:false});
  }
  for (let attempt=0;attempt<10;attempt++) {
    const current = await chrome.tabs.get(tab.id).catch(() => null);
    if (!current) {
      return {phase:'error',message:'A aba AT foi fechada durante a consulta'};
    }
    const url = current.url || '';
    if (/^https:\/\/(www\.)?(acesso|autenticacao)\.gov\.pt\//i.test(url)) {
      return {phase:'login_required',message:'A AT exige nova autenticação. A sessão atual não foi alterada'};
    }
    if (/^https:\/\/sitfiscal\.portaldasfinancas\.gov\.pt\//i.test(url) &&
        current.status === 'complete') {
      try {
        const result = await chrome.tabs.sendMessage(tab.id,{type:'FG_PROBE_AT'});
        if (result) return safeStatus(result);
      } catch {
        // A página ainda está a carregar ou a preparar o content script.
      }
    }
    await wait(900);
  }
  return {phase:'unverified',message:'A consulta da sessão existente não ficou concluída; não foi pedido novo login'};
}

chrome.runtime.onMessage.addListener((request,sender,sendResponse) => {
  if (!authorizedSender(sender) ||
      request?.type !== 'FG_CHECK_EXISTING_AT') return false;
  if (!running) {
    running = checkExistingChrome().finally(() => {running=null;});
  }
  running.then(sendResponse).catch(() => {
    sendResponse({phase:'error',message:'Erro ao consultar Chrome autenticado'});
  });
  return true;
});
