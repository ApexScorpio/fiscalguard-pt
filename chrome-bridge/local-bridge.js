'use strict';
(() => {
  const ALLOWED = 'http://127.0.0.1:4848';
  if (location.origin !== ALLOWED) return;
  const CHANNEL = 'FiscalGuardATChrome';
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== ALLOWED ||
        event.data?.channel !== CHANNEL) return;
    const { action, requestId } = event.data;
    if (action === 'PING') {
      window.postMessage({channel:CHANNEL,action:'BRIDGE_READY'},ALLOWED);
      return;
    }
    if (action !== 'CHECK' || typeof requestId !== 'string' ||
        requestId.length < 5 || requestId.length > 100) return;
    chrome.runtime.sendMessage({type:'FG_CHECK_EXISTING_AT'}, (result) => {
      const runtimeError = chrome.runtime.lastError;
      const safe = runtimeError
        ? {phase:'error',message:'Extensão FiscalGuard indisponível'}
        : result || {phase:'error',message:'Nenhuma resposta da extensão'};
      window.postMessage({
        channel:CHANNEL,action:'RESULT',requestId,
        result: {
          phase: safe.phase,
          message: safe.message,
          capturedAt: safe.capturedAt,
          verifiedEndpoints: safe.verifiedEndpoints,
          counts: safe.counts
        }
      }, ALLOWED);
    });
  });
  window.postMessage({channel:CHANNEL,action:'BRIDGE_READY'},ALLOWED);
})();
