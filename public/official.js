'use strict';

function officialElement(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function officialStat(value, suffix) {
  return Number.isSafeInteger(value) && value >= 0 ? String(value) + suffix : 'Por consultar';
}

function renderOfficialVehicles(vehicles) {
  const host = document.getElementById('official-vehicles-list');
  if (!host) return;
  host.replaceChildren();
  if (!Array.isArray(vehicles) || vehicles.length === 0) {
    const p = document.createElement('p');
    p.className = 'official-muted';
    p.textContent = 'Nenhuma viatura importada. Não significa que não existam viaturas ou IUC.';
    host.append(p);
    return;
  }
  for (const vehicle of vehicles) {
    const row = document.createElement('div');
    row.className = 'official-vehicle-row';
    const fields = [
      vehicle.plate || 'Matrícula por confirmar',
      vehicle.dueDate
        ? 'Vencimento: ' + new Date(vehicle.dueDate + 'T12:00:00').toLocaleDateString('pt-PT')
        : 'Prazo por confirmar',
      vehicle.iucAmountEUR === null || vehicle.iucAmountEUR === undefined
        ? 'Montante por confirmar'
        : Number(vehicle.iucAmountEUR).toLocaleString('pt-PT',{style:'currency',currency:'EUR'}),
      ({ paid:'Pago', pending:'Pendente', unknown:'Estado por confirmar' })[vehicle.paymentStatus] || 'Estado por confirmar'
    ];
    fields.forEach((label, i) => {
      const el = document.createElement(i === 0 ? 'strong' : 'span');
      el.textContent = label;
      row.append(el);
    });
    host.append(row);
  }
}

async function loadOfficialOverview() {
  try {
    const response = await fetch('/api/official/overview', { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (!['imported_unverified','verified_local','browser_reported'].includes(data.status)) {
      officialElement('official-import-state', 'Por importar · Nenhuma consulta oficial comprovada neste módulo');
      officialElement('official-at-debts', 'Por consultar');
      officialElement('official-at-fines', 'Por consultar');
      officialElement('official-at-messages', 'Por consultar');
      officialElement('official-ss-status', 'Por consultar');
      renderOfficialVehicles([]);
      return;
    }
    const time = data.capturedAt ? new Date(data.capturedAt).toLocaleString('pt-PT') : 'desconhecida';
    officialElement('official-import-state',
      (data.status === 'verified_local' ? 'Respostas oficiais verificadas localmente em ' : data.status === 'browser_reported' ? 'Leitura comunicada pelo Chrome existente em ' : 'Importação local de ') + time + (['verified_local','browser_reported'].includes(data.status) ? ' · Outras obrigações por consultar' : ' · Origem por confirmar'));
    const summary = data.summary || {};
    officialElement('official-at-debts', officialStat(summary.atDebts, ' registos'));
    officialElement('official-at-fines', officialStat(summary.atFines, ' registos'));
    officialElement('official-at-messages', officialStat(summary.atMessages, ' mensagens'));
    officialElement('official-ss-status', ({
      regular:'Regularizada (importado)', pending:'Pendente (importado)', unknown:'Por consultar'
    })[summary.ssStatus] || 'Por consultar');
    renderOfficialVehicles(data.vehicles);
  } catch {
    officialElement('official-import-state', 'Não foi possível consultar o serviço web local');
  }
}

// Ponte opcional: reutiliza o Chrome normal sem iniciar outro browser/perfil.
// Apenas contagens agregadas; sem NIF, password, cookies ou respostas completas.
const FG_AT_CHANNEL = 'FiscalGuardATChrome';
let fgChromeBridgeReady = false;
let fgChromeActive = null;
let fgChromePending = false;
let fgChromeCheckAt = 0;

async function fgCheckChromeSession() {
  if (!fgChromeBridgeReady) {
    officialElement('official-at-session',
      'A sessão atual está no Chrome. Falta ligar a extensão local FiscalGuard uma única vez; não será aberto outro login.');
    return;
  }
  if (fgChromePending) return;
  fgChromePending = true;
  fgChromeCheckAt = Date.now();
  const requestId = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
  const timeout = setTimeout(() => {
    if (fgChromePending) {
      fgChromePending = false;
      officialElement('official-at-session',
        'Chrome não respondeu à consulta; sessão não alterada e nenhum login pedido');
    }
  }, 45000);
  window.__fgBridgeTimeout = timeout;
  window.__fgBridgeRequestId = requestId;
  officialElement('official-at-session', 'A verificar a sessão já aberta no Chrome…');
  window.postMessage({channel:FG_AT_CHANNEL,action:'CHECK',requestId},window.location.origin);
}

window.addEventListener('message', async event => {
  if (event.source !== window || event.origin !== window.location.origin ||
      event.data?.channel !== FG_AT_CHANNEL) return;
  if (event.data.action === 'BRIDGE_READY') {
    if (!fgChromeBridgeReady) {
      fgChromeBridgeReady = true;
      void fgCheckChromeSession();
    }
    return;
  }
  if (event.data.action !== 'RESULT' ||
      event.data.requestId !== window.__fgBridgeRequestId) return;
  clearTimeout(window.__fgBridgeTimeout);
  fgChromePending = false;
  const result = event.data.result;
  if (!result || typeof result !== 'object') return;
  if (result.phase !== 'synced') {
    fgChromeActive = null;
    officialElement('official-at-session',
      typeof result.message === 'string' ? result.message :
        'Ligação ao Chrome ainda por confirmar');
    return;
  }
  try {
    const response = await fetch('/api/at/browser-result', {
      method:'POST',headers:{'Content-Type':'application/json'},
      cache:'no-store',body:JSON.stringify(result)
    });
    if (!response.ok) throw new Error('INVALID_AGGREGATE');
    const imported = await response.json();
    fgChromeActive = {timestamp:Date.now(),message:imported.message};
    officialElement('official-at-session',imported.message);
    const label = document.getElementById('at-situation-text');
    if (label) label.textContent = 'AT consultada no Chrome';
    await loadOfficialOverview();
  } catch {
    officialElement('official-at-session',
      'Respostas do Chrome recebidas, mas a importação local falhou');
  }
});

// Separar o estado do login da existência de dados fiscais importados.
async function readATSession() {
  if (fgChromeActive && Date.now()-fgChromeActive.timestamp < 6*60*60*1000) {
    officialElement('official-at-session',fgChromeActive.message);
    const label = document.getElementById('at-situation-text');
    if (label) label.textContent = 'AT consultada no Chrome';
    return {phase:'browser_reported'};
  }
  try {
    const r = await fetch('/api/at/session', { cache: 'no-store' });
    if (!r.ok) throw new Error('API_AT_UNAVAILABLE');
    const session = await r.json();
    const state = document.getElementById('official-at-session');
    if (state) state.textContent = session.message || 'A verificar sessão';
    const label = document.getElementById('at-situation-text');
    const dot = document.getElementById('at-indicator-dot');
    if (session.phase === 'synced') {
      if (label) label.textContent = 'Sessão AT validada';
      if (dot) dot.className = 'status-indicator live-pulse';
    } else if (['waiting_login','opening','verifying'].includes(session.phase)) {
      if (label) label.textContent = 'A confirmar sessão';
      if (dot) dot.className = 'status-indicator dot-warning';
    } else {
      if (label) label.textContent = 'Por verificar';
      if (dot) dot.className = 'status-indicator dot-warning';
    }
    return session;
  } catch {
    officialElement('official-at-session', 'Serviço de autenticação AT indisponível');
    return null;
  }
}

async function atOperation(route) {
  const buttons = ['btn-official-login','btn-official-verify','btn-official-refresh']
    .map(id => document.getElementById(id)).filter(Boolean);
  buttons.forEach(b => { b.disabled = true; });
  try {
    officialElement('official-at-session', 'A contactar o FiscalGuard local…');
    const r = await fetch(route, { method:'POST', cache:'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const state = await r.json();
    officialElement('official-at-session', state.message || 'Sem resposta da AT');
    await Promise.all([readATSession(), loadOfficialOverview()]);
  } catch {
    officialElement('official-at-session', 'Falha ao contactar o servidor local (consulta não confirmada)');
  } finally {
    buttons.forEach(b => { b.disabled = false; });
  }
}

// Sempre que o cofre DPAPI local existir, usar o motor AT integrado.
 // Sem credenciais cifradas, preservar a extensao para sessao Chrome existente.
async function refreshConfiguredAT() {
  try {
    const response=await fetch('/api/vault/credentials',{cache:'no-store'});
    if(response.ok && (await response.json())?.at?.hasPassword===true) {
      window.__fgUsingManagedAT=true;
      return atOperation('/api/at/refresh');
    }
  }catch{/* fallback nao altera a sessao Chrome */}
  window.__fgUsingManagedAT=false;
  return fgCheckChromeSession();
}

document.addEventListener('DOMContentLoaded', () => {
  loadOfficialOverview();
  readATSession();
  const useExistingChrome = () => {void refreshConfiguredAT();};
  document.getElementById('btn-official-login')
    ?.addEventListener('click', useExistingChrome);
  document.getElementById('btn-official-verify')
    ?.addEventListener('click', useExistingChrome);
  document.getElementById('btn-official-refresh')
    ?.addEventListener('click', useExistingChrome);
  // O motor com cofre e preferido. Sem cofre, a extensao usa sessao Chrome.
  void refreshConfiguredAT();
  window.postMessage({channel:FG_AT_CHANNEL,action:'PING'},window.location.origin);
  setTimeout(() => {
    if (!fgChromeBridgeReady && !window.__fgUsingManagedAT) {
      officialElement('official-at-session',
        'Chrome sem extensao FiscalGuard. Guarda credenciais AT no cofre local para ativar consulta automatica.');
    }
  },2500);
  setInterval(() => {
    void readATSession();
    void loadOfficialOverview();
  },10000);
  setInterval(() => {
    if (fgChromeBridgeReady) void fgCheckChromeSession();
  },6*60*60*1000);
});
