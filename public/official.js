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
    if (data.status !== 'imported_unverified') {
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
      'Importação local de ' + time + ' · Autenticidade e atualização por confirmar');
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

document.addEventListener('DOMContentLoaded', () => {
  loadOfficialOverview();
  document.getElementById('btn-official-refresh')
    ?.addEventListener('click', loadOfficialOverview);
  document.getElementById('btn-official-login')
    ?.addEventListener('click', () => {
      if (typeof openPortalLoginModal === 'function') openPortalLoginModal('financas');
    });
  setInterval(loadOfficialOverview, 30000);
});
