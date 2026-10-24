'use strict';
(() => {
  if (location.origin !== 'https://sitfiscal.portaldasfinancas.gov.pt') return;
  const ROUTES = Object.freeze({
    atMessages: '/geral/dashboard/mensagens',
    atAlerts: '/geral/dashboard/alertas',
    atInteractions: '/geral/dashboard/interacoes',
    atDebts: '/geral/dividas',
    atFines: '/geral/coimas'
  });
  const SHAPES = Object.freeze({
    atMessages: ['listaMensagens','mensagens','messages','dataFromResponseList'],
    atAlerts: ['listaAlertas','alertas','alerts','dataFromResponseList'],
    atInteractions: ['listaInteracoes','interacoes','interactions','dataFromResponseList'],
    atDebts: ['dataFromResponseList','listaDividas','dividas','debts'],
    atFines: ['dataFromResponseList','listaCoimas','coimas','fines']
  });

  function safeCount(kind, data) {
    if (Array.isArray(data)) return data.length;
    if (!data || typeof data !== 'object' || data.error ||
        data.errors || data.unauthorized) return null;
    for (const field of SHAPES[kind] || []) {
      if (Array.isArray(data[field])) return data[field].length;
    }
    return null;
  }

  async function inspect() {
    const counts = {atMessages:null,atDebts:null,atFines:null};
    let verifiedEndpoints = 0;
    for (const [kind, endpoint] of Object.entries(ROUTES)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(endpoint, {
          method: 'GET', credentials: 'include', redirect:'follow',
          cache:'no-store', signal:controller.signal
        });
        if (!response.ok ||
            new URL(response.url).origin !== location.origin ||
            !/json/i.test(response.headers.get('content-type') || '')) continue;
        const count = safeCount(kind, await response.json());
        if (count !== null) {
          verifiedEndpoints++;
          if (Object.hasOwn(counts,kind)) counts[kind] = count;
        }
      } catch {
        // Timeout/erro de consulta não significa logout.
      } finally {
        clearTimeout(timeout);
      }
    }
    return {
      phase: verifiedEndpoints > 0 ? 'synced' : 'unverified',
      message: verifiedEndpoints > 0
        ? 'Respostas oficiais lidas no Chrome já autenticado'
        : 'A sessão existe no Chrome, mas nenhum endpoint fiscal foi confirmado',
      capturedAt: verifiedEndpoints > 0 ? new Date().toISOString() : null,
      verifiedEndpoints,counts
    };
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.type !== 'FG_PROBE_AT') return false;
    inspect().then(sendResponse).catch(() => {
      sendResponse({phase:'error',message:'Falha técnica ao consultar respostas AT'});
    });
    return true;
  });
})();
