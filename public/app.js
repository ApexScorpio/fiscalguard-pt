/**
 * FiscalGuard PRO — No-Scroll Executive Sentinel Controller
 */

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initBudgetSimulator();
    loadDashboardData();
    initActionButtons();
    initCronTimer();
    setInterval(loadDashboardData, 20000);
});

function initTabs() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            const targetPaneId = tab.dataset.tab;
            const targetPane = document.getElementById(targetPaneId);
            if (targetPane) {
                targetPane.classList.add('active');
            }
        });
    });
}

function switchTab(tabPaneId) {
    const targetTabBtn = document.querySelector(`.nav-tab[data-tab="${tabPaneId}"]`);
    if (targetTabBtn) {
        targetTabBtn.click();
    }
}

async function loadDashboardData() {
    try {
        const [resStatus, resIuc, resCalendar, resInvoices] = await Promise.all([
            fetch('/api/status').then(r => r.json()),
            fetch('/api/iuc').then(r => r.json()),
            fetch('/api/calendar').then(r => r.json()),
            fetch('/api/invoices').then(r => r.json())
        ]);

        renderHeader(resStatus);
        renderIucHeroAndList(resIuc);
        renderIrsForecast(resStatus);
        renderEfaturaSummary(resStatus);
        renderReservesAndAgenda(resStatus, resCalendar, resIuc);
        renderDetailedTabs(resStatus, resIuc, resInvoices, resCalendar);
        loadTelegramSettings();

    } catch (err) {
        console.error('[FiscalGuard] Erro ao carregar dados:', err);
    }
}

function renderHeader(data) {
    const at = data.atData || {};
    const contrib = at.contribuinte || {};

    if (contrib.nome) document.getElementById('user-display-name').textContent = contrib.nome;
    if (contrib.nif) document.getElementById('user-display-nif').textContent = contrib.nif;
    if (contrib.iban_reembolsos) {
        const cleanIban = contrib.iban_reembolsos.split(' ')[0] + ' ... ' + contrib.iban_reembolsos.slice(-6);
        document.getElementById('user-display-iban').textContent = cleanIban;
    }
}

/**
 * Renderiza a parte do IUC com todas as matrículas ordenadas do mais próximo ao mais distante
 */
function renderIucHeroAndList(iucData) {
    const todos = iucData.todosVeiculos || [];
    const proximo = iucData.proximoIuc || (todos.length > 0 ? todos[0] : {});

    // Sumário no topo da Frota
    const elSumTotal = document.getElementById('iuc-fleet-total-val');
    const elSumNext = document.getElementById('iuc-fleet-next-val');
    if (elSumTotal && todos.length > 0) {
        const total = todos.reduce((acc, v) => acc + (Number(v.valorEstimado) || 0), 0);
        elSumTotal.textContent = `${formatMoney(total)} €`;
    }
    if (elSumNext && proximo.matricula) {
        elSumNext.textContent = `${proximo.matricula} (${proximo.daysRemaining} dias)`;
    }

    // Renderizar TODAS AS 4 VIATURAS ordenadas do mais próximo ao mais distante
    const listContainer = document.getElementById('dashboard-vehicles-container');
    if (listContainer) {
        listContainer.innerHTML = todos.map((v, idx) => {
            const isFirst = idx === 0;
            const pct = Math.min(100, Math.max(0, v.progressPercent || 35));
            return `
                <div class="fleet-vehicle-item ${isFirst ? 'is-next-due' : ''}" title="${v.nome} - Limite ${v.deadlineFormatted}">
                    <div class="fv-main-row">
                        <div class="pt-license-plate">
                            <span class="pt-eu-flag">P</span>
                            <span class="pt-plate-num">${v.matricula}</span>
                        </div>
                        <div class="fv-details">
                            <div class="fv-title-line">
                                <strong class="fv-name">${v.nome}</strong>
                                <span class="fv-cat">${v.categoria}</span>
                            </div>
                            <div class="fv-deadline-line">
                                Prazo: <strong>${v.deadlineFormatted || v.deadlineDate}</strong> (${v.mesNome})
                            </div>
                        </div>
                        <div class="fv-amount-block">
                            <div class="fv-price">${formatMoney(v.valorEstimado)} €</div>
                            <span class="fv-days-pill ${isFirst ? 'pill-alert-amber' : 'pill-calm-slate'}">
                                ${isFirst ? '⚡ ' : ''}${v.daysRemaining} dias
                            </span>
                        </div>
                    </div>
                    <div class="fv-progress-row">
                        <div class="fv-progress-track">
                            <div class="fv-progress-fill ${isFirst ? 'fill-gold' : 'fill-cyan'}" style="width: ${pct}%;"></div>
                        </div>
                        <span class="fv-pct-tag">${pct}% ciclo</span>
                    </div>
                </div>
            `;
        }).join('');
    }
}

/**
 * Renderiza o card do IRS focado na PREVISÃO DE 2026
 */
function renderIrsForecast(statusData) {
    const at = statusData.atData || {};
    const irs = at.irs || {};
    const prev = irs.previsao_2026 || {};
    const efatura = at.efatura_2026 || {};

    const deducoes = efatura.total_deducoes_provisorias || "210,39 €";
    
    const elBalance = document.getElementById('forecast-irs-balance');
    const elDeductions = document.getElementById('forecast-irs-deductions');
    const elSavings = document.getElementById('forecast-irs-savings');
    const elPotential = document.getElementById('forecast-irs-potential');
    const elRef2025 = document.getElementById('ref-irs-2025');

    if (elBalance) elBalance.textContent = prev.saldo_previsto_a_pagar || "~1.709,83 €";
    if (elDeductions) elDeductions.textContent = deducoes;
    if (elSavings) elSavings.textContent = prev.poupanca_mensal_sugerida ? `${prev.poupanca_mensal_sugerida}/mês` : "160,00 €/mês";
    if (elPotential) elPotential.textContent = prev.potencial_recuperacao ? `+${prev.potencial_recuperacao}` : "+250,00 €";
    if (elRef2025) elRef2025.textContent = (irs.declaracao_recente && irs.declaracao_recente.montante_liquidado) ? `-${irs.declaracao_recente.montante_liquidado}` : "-1.920,22 €";

    const tabBal = document.getElementById('irs-tab-balance');
    const tabTot = document.getElementById('irs-tab-total');
    if (tabBal) tabBal.textContent = prev.saldo_previsto_a_pagar || "~1.709,83 €";
    if (tabTot) tabTot.textContent = prev.saldo_previsto_a_pagar || "~1.709,83 €";
}

function renderEfaturaSummary(statusData) {
    const at = statusData.atData || {};
    const efatura = at.efatura_2026 || {};
    const count = efatura.faturas_pendentes_validacao !== undefined ? efatura.faturas_pendentes_validacao : 167;
    const deducoes = efatura.total_deducoes_provisorias || "210,39 €";

    const elAmount = document.getElementById('hero-efatura-amount');
    const elBadge = document.getElementById('hero-efatura-badge');
    const elNavBadge = document.getElementById('nav-efatura-badge');

    if (elAmount) elAmount.textContent = deducoes;
    if (elBadge) {
        elBadge.textContent = count > 0 ? `${count} Pendentes` : '✓ Todas Validadas';
        elBadge.className = count > 0 ? 'badge-status badge-warning' : 'badge-status badge-success';
    }
    if (elNavBadge) {
        elNavBadge.textContent = count;
        elNavBadge.style.display = count > 0 ? 'inline-block' : 'none';
    }
}

function renderReservesAndAgenda(statusData, calendarData, iucData) {
    const stats = statusData.stats || {};
    const at = statusData.atData || {};
    const ativ = at.atividade || {};
    const fat = ativ.faturacao_2026 || {};

    const elNet = document.getElementById('overview-net-amount');
    const elVat = document.getElementById('overview-vat-reserve');
    const elSS = document.getElementById('overview-ss-reserve');
    const elIrs = document.getElementById('overview-irs-reserve');

    if (elNet) elNet.textContent = fat.total_rendimentos || `${formatMoney(stats.totalIssued || 7320)} €`;
    if (elVat) elVat.textContent = fat.total_iva_liquidado || `${formatMoney(stats.totalVatCollected || 73.6)} €`;
    if (elSS) elSS.textContent = fat.total_irs_retido || '805,00 €';
    if (elIrs) elIrs.textContent = `160,00 €/mês`;

    // WIDGET AGENDA FISCAL DINÂMICA COM PRAZOS OFICIAIS
    const elAgenda = document.getElementById('overview-obligations-container');
    if (elAgenda && calendarData && calendarData.length) {
        elAgenda.innerHTML = calendarData.slice(0, 4).map(item => `
            <div class="agenda-item-mini" title="${item.title}: ${item.deadline}">
                <span class="ag-icon">${item.type === 'IUC' ? '🚗' : (item.type.includes('IRS') ? '📑' : '🏛️')}</span>
                <span class="ag-title">${item.title}</span>
                <span class="ag-badge ${item.daysRemaining <= 60 ? 'badge-warn' : 'badge-info'}">${item.daysRemaining}d</span>
            </div>
        `).join('');
    }
}

function renderDetailedTabs(statusData, iucData, invoicesData, calendarData) {
    // ABA IUC DETALHADA: Grade com todos os veículos
    const gridVehicles = document.getElementById('all-vehicles-grid-container');
    if (gridVehicles && iucData.todosVeiculos) {
        gridVehicles.innerHTML = iucData.todosVeiculos.map((v, idx) => `
            <div class="vehicle-detail-card ${idx === 0 ? 'closest-vehicle' : ''}">
                <div class="v-card-top">
                    <div>
                        <div class="pt-license-plate">${v.matricula}</div>
                        <div style="font-weight: 800; color: #fff; font-size: 15px; margin-top: 6px;">${v.nome}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${v.categoria || 'Ligeiro de Passageiros'} • Mês: ${v.mesNome}</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-family: 'JetBrains Mono'; font-weight: 800; font-size: 22px; color: var(--accent-amber);">${formatMoney(v.valorEstimado)} €</div>
                        <span class="badge-status ${idx === 0 ? 'badge-warning' : 'badge-success'}">${v.daysRemaining} dias restantes</span>
                    </div>
                </div>

                <div class="v-card-middle">
                    <div class="v-progress-text">
                        <span>Prazo: <strong>${v.deadlineFormatted}</strong></span>
                        <strong class="text-amber">${v.progressPercent}%</strong>
                    </div>
                    <div class="progress-bar-track">
                        <div class="progress-bar-fill fill-gradient-iuc" style="width: ${v.progressPercent}%;"></div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    // Histórico de IUC
    const elHist = document.getElementById('iuc-history-container');
    if (elHist && iucData.historico) {
        elHist.innerHTML = iucData.historico.map(h => `
            <div class="v-item-row" style="padding: 8px 12px;">
                <div>
                    <div style="font-weight: 700; color: #fff; font-size: 12px;">${h.evento}</div>
                    <div style="font-size: 10px; color: var(--text-muted);">Processado pela AT</div>
                </div>
                <div style="text-align: right;">
                    <div style="font-family: 'JetBrains Mono'; font-weight: 700; color: var(--accent-emerald); font-size: 12px;">${h.data}</div>
                    <div style="font-size: 10px; color: var(--accent-amber);">${h.valor || 'Pago'}</div>
                </div>
            </div>
        `).join('');
    }

    // ABA E-FATURA: Setores & Tabela
    const at = statusData.atData || {};
    const setores = (at.efatura_2026 && at.efatura_2026.detalhe_setores) || {};
    const sectorsGrid = document.getElementById('efatura-sectors-grid');
    if (sectorsGrid) {
        const sectorNames = {
            despesas_gerais_familiares: { title: "Despesas Gerais", icon: "🛒", max: 250 },
            reparacao_automoveis: { title: "Reparação Automóvel", icon: "🔧", max: 250 },
            ginasios: { title: "Ginásios", icon: "🏋️", max: 250 },
            restauracao_e_alojamento: { title: "Restauração", icon: "☕", max: 250 },
            saude: { title: "Saúde", icon: "💊", max: 1000 },
            educacao: { title: "Educação", icon: "📚", max: 800 },
            habitacao: { title: "Habitação", icon: "🏠", max: 502 }
        };

        sectorsGrid.innerHTML = Object.keys(sectorNames).map(k => {
            const info = sectorNames[k];
            const data = setores[k] || { deducao: "0,00 €", limite: `${info.max},00 €` };
            const numDed = parseFloat(data.deducao.replace('€', '').replace(',', '.').trim()) || 0;
            const pct = Math.min(100, Math.round((numDed / info.max) * 100));

            return `
                <div class="sector-card">
                    <div style="font-size: 12px; font-weight: 700; color: #fff; margin-bottom: 4px;">${info.icon} ${info.title}</div>
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
                        <span class="text-emerald font-bold">${data.deducao}</span>
                        <span class="text-muted">${data.limite || info.max + ' €'}</span>
                    </div>
                    <div class="progress-bar-track">
                        <div class="progress-bar-fill fill-gradient-iuc" style="width: ${pct}%;"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    const tbody = document.getElementById('invoices-table-body');
    if (tbody && invoicesData && invoicesData.invoices) {
        tbody.innerHTML = invoicesData.invoices.slice(0, 30).map(i => `
            <tr>
                <td style="font-family: 'JetBrains Mono';">${i.date}</td>
                <td style="font-weight: 600; color: #fff;">${i.entity || i.supplierName}</td>
                <td style="font-family: 'JetBrains Mono';">${i.supplierNif || '--'}</td>
                <td style="font-family: 'JetBrains Mono'; font-weight: 700; color: #fff;">${formatMoney(i.total)} €</td>
                <td style="font-family: 'JetBrains Mono'; color: var(--text-muted);">${formatMoney(i.vatAmount)} €</td>
                <td><span class="badge-status badge-info">${i.category || 'Pendente'}</span></td>
                <td><span class="badge-status ${i.efaturaStatus === 'pending' ? 'badge-warning' : 'badge-success'}">${i.efaturaStatus === 'pending' ? 'Pendente' : 'Validada'}</span></td>
            </tr>
        `).join('');
    }

    // ABA ATIVIDADE: OTIMIZADOR DE DESPESAS AFETAS (CAE 43210)
    const expContainer = document.getElementById('activity-eligible-expenses-list');
    if (expContainer && invoicesData && invoicesData.invoices) {
        const expenses = invoicesData.invoices.filter(i => i.type === 'expense');
        const badgeCount = document.getElementById('act-expenses-count-badge');
        if (badgeCount) badgeCount.textContent = `${expenses.length} Faturas Analisadas`;

        expContainer.innerHTML = expenses.slice(0, 6).map(inv => `
            <div class="exp-detect-item">
                <div>
                    <div style="font-weight: 700; color: #fff; font-size: 13px;">${inv.entity || inv.supplierName}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">${inv.date} • Total: <strong style="color: #fff;">${formatMoney(inv.total)} €</strong> (IVA: ${formatMoney(inv.vatAmount)} €)</div>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <button class="btn-toggle-activity ${inv.isActivity ? 'active' : ''}" data-id="${inv.id}">
                        ${inv.isActivity ? '✓ Afeta à Atividade (IVA Dedutível)' : '+ Afetar à Atividade (CAE 43210)'}
                    </button>
                </div>
            </div>
        `).join('');

        expContainer.querySelectorAll('.btn-toggle-activity').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-id');
                const isCurrently = btn.classList.contains('active');
                btn.textContent = 'A atualizar...';
                await fetch('/api/activity/expenses/toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, isActivity: !isCurrently })
                });
                await loadDashboardData();
            });
        });
    }

    // ABA CALENDÁRIO COMPLETA
    const calFull = document.getElementById('calendar-full-container');
    if (calFull && calendarData) {
        calFull.innerHTML = calendarData.map(item => `
            <div class="v-item-row" style="padding: 12px; margin-bottom: 8px;">
                <div style="display: flex; gap: 12px; align-items: center;">
                    <span style="font-size: 20px;">${item.category === 'IUC' ? '🚗' : (item.category === 'IRS' ? '📑' : '🏛️')}</span>
                    <div>
                        <div style="font-weight: 700; color: #fff;">${item.title}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${item.description} • Limite: ${item.deadline}</div>
                    </div>
                </div>
                <div>
                    <span class="v-days-badge ${item.daysRemaining <= 7 ? 'v-days-near' : 'v-days-far'}">
                        ${item.daysRemaining < 0 ? 'Concluída' : `${item.daysRemaining} dias`}
                    </span>
                </div>
            </div>
        `).join('');
    }
}

function initActionButtons() {
    const btnSync = document.getElementById('btn-sync-now');
    if (btnSync) {
        btnSync.addEventListener('click', async () => {
            btnSync.disabled = true;
            btnSync.innerHTML = '<span>⚡</span> <span>A sincronizar...</span>';
            try {
                await fetch('/api/sync/run', { method: 'POST' });
                alert("✓ Sincronização concluída com sucesso!");
                await loadDashboardData();
            } catch (e) {
                alert("Aviso: " + e.message);
            } finally {
                btnSync.disabled = false;
                btnSync.innerHTML = '<span class="icon-refresh">⚡</span> <span>Sincronizar AT</span>';
            }
        });
    }

    const setupClassify = (btnId) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                btn.textContent = 'A classificar...';
                try {
                    const res = await fetch('/api/efatura/auto-classify', { method: 'POST' }).then(r => r.json());
                    alert("✓ " + res.message);
                    await loadDashboardData();
                } catch (e) {
                    alert("Erro: " + e.message);
                } finally {
                    btn.disabled = false;
                }
            });
        }
    };
    setupClassify('btn-auto-classify-hero');
    setupClassify('btn-auto-classify-efatura');

    // BOTÃO EXPORTAR PDF OFICIAL
    const btnExport = document.getElementById('btn-export-pdf');
    if (btnExport) {
        btnExport.addEventListener('click', () => {
            window.open('/report/print', '_blank');
        });
    }

    // TELEGRAM CONFIG & TEST
    const btnSaveTg = document.getElementById('btn-save-tg-config');
    if (btnSaveTg) {
        btnSaveTg.addEventListener('click', async () => {
            const botToken = document.getElementById('cfg-tg-token').value.trim();
            const chatId = document.getElementById('cfg-tg-chatid').value.trim();
            await fetch('/api/notifications/telegram-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ botToken, chatId, enabled: !!(botToken && chatId) })
            });
            alert("✓ Configurações do Telegram guardadas!");
        });
    }

    const btnTestTg = document.getElementById('btn-test-tg-alert');
    const tgStatus = document.getElementById('tg-test-status');
    if (btnTestTg) {
        btnTestTg.addEventListener('click', async () => {
            const botToken = document.getElementById('cfg-tg-token').value.trim();
            const chatId = document.getElementById('cfg-tg-chatid').value.trim();
            btnTestTg.disabled = true;
            btnTestTg.textContent = 'A enviar...';
            if (tgStatus) tgStatus.innerHTML = '<span class="text-muted">A comunicar com o Telegram Bot API...</span>';
            try {
                const res = await fetch('/api/notifications/telegram-test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ botToken, chatId })
                }).then(r => r.json());
                if (res.success) {
                    if (tgStatus) tgStatus.innerHTML = '<span class="text-emerald font-bold">✅ Alerta de teste enviado com sucesso para o teu Telegram!</span>';
                } else {
                    if (tgStatus) tgStatus.innerHTML = `<span class="text-amber font-bold">❌ Falha: ${res.error || 'Verifica o Bot Token e Chat ID.'}</span>`;
                }
            } catch (e) {
                if (tgStatus) tgStatus.innerHTML = `<span class="text-amber">Erro: ${e.message}</span>`;
            } finally {
                btnTestTg.disabled = false;
                btnTestTg.textContent = '🔔 Testar Alerta';
            }
        });
    }

    const btnSaveIuc = document.getElementById('btn-save-iuc-config');
    if (btnSaveIuc) {
        btnSaveIuc.addEventListener('click', async () => {
            const body = {
                id: document.getElementById('cfg-select-vehicle').value,
                nome: document.getElementById('cfg-iuc-name').value,
                matricula: document.getElementById('cfg-iuc-plate').value,
                mesRegisto: document.getElementById('cfg-iuc-month').value,
                valorEstimado: document.getElementById('cfg-iuc-val').value
            };
            await fetch('/api/iuc/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            alert("✓ Viatura atualizada com sucesso!");
            await loadDashboardData();
        });
    }

    const selectVeh = document.getElementById('cfg-select-vehicle');
    if (selectVeh) {
        selectVeh.addEventListener('change', async () => {
            const iucData = await fetch('/api/iuc').then(r => r.json());
            const veh = (iucData.todosVeiculos || []).find(v => v.id === selectVeh.value);
            if (veh) {
                document.getElementById('cfg-iuc-name').value = veh.nome;
                document.getElementById('cfg-iuc-plate').value = veh.matricula;
                document.getElementById('cfg-iuc-month').value = veh.mesRegisto;
                document.getElementById('cfg-iuc-val').value = veh.valorEstimado;
            }
        });
    }
}


async function loadTelegramSettings() {
    try {
        const res = await fetch('/api/settings').then(r => r.json());
        const tg = (res.settings && res.settings.telegram) || {};
        const elToken = document.getElementById('cfg-tg-token');
        const elChat = document.getElementById('cfg-tg-chatid');
        if (elToken && tg.botToken) elToken.value = tg.botToken;
        if (elChat && tg.chatId) elChat.value = tg.chatId;
    } catch (e) {}
}

function initBudgetSimulator() {
    const elAmount = document.getElementById('calc-budget-amount');
    const elClient = document.getElementById('calc-client-type');
    const elVat = document.getElementById('calc-vat-mode');
    const elMat = document.getElementById('calc-materials-cost');

    if (!elAmount || !elClient || !elVat || !elMat) return;

    function recalculate() {
        const base = Math.max(0, parseFloat(elAmount.value) || 0);
        const materials = Math.max(0, parseFloat(elMat.value) || 0);
        const isVat23 = elVat.value === 'normal-23';
        const clientMode = elClient.value;

        // IVA cobrado ao cliente
        const vatRate = isVat23 ? 0.23 : 0;
        const vatCharged = Math.round(base * vatRate * 100) / 100;
        const billedTotal = base + vatCharged;

        // Retenção na fonte
        let retRate = 0;
        if (clientMode === 'company-25') retRate = 0.25;
        else if (clientMode === 'company-115') retRate = 0.115;
        const withheld = Math.round(base * retRate * 100) / 100;

        // Dinheiro imediato que entra na conta
        const immediateCash = billedTotal - withheld;

        // IVA suportado nos materiais (dedutível)
        const materialsVatDeductible = Math.round((materials * 0.23 / 1.23) * 100) / 100;
        const netMaterialsCost = materials - materialsVatDeductible;

        // Provisão de IVA a entregar à AT
        const netVatToPay = Math.max(0, vatCharged - materialsVatDeductible);

        // Previsão de IRS adicional (75% coef simplificado * 22% taxa marginal - retenção)
        const taxableIncome = base * 0.75;
        const totalIrsLiability = Math.round(taxableIncome * 0.22 * 100) / 100;
        const extraIrsToSave = Math.max(0, totalIrsLiability - withheld);

        // Líquido final livre no bolso
        const finalNet = Math.max(0, Math.round((immediateCash - netVatToPay - materials - extraIrsToSave) * 100) / 100);

        // Atualizar interface
        document.getElementById('calc-result-net').textContent = `${formatMoney(finalNet)} €`;
        document.getElementById('calc-result-billed').textContent = `${formatMoney(billedTotal)} €`;
        document.getElementById('calc-result-vat').textContent = `${formatMoney(netVatToPay)} €`;
        document.getElementById('calc-result-withheld').textContent = `${formatMoney(withheld)} €`;
        document.getElementById('calc-result-immediate').textContent = `${formatMoney(immediateCash)} €`;
        document.getElementById('calc-result-materials').textContent = `${formatMoney(netMaterialsCost)} €`;
    }

    elAmount.addEventListener('input', recalculate);
    elClient.addEventListener('change', recalculate);
    elVat.addEventListener('change', recalculate);
    elMat.addEventListener('input', recalculate);

    recalculate();
}

function initCronTimer() {
    let nextCheck = new Date(Date.now() + 4 * 3600 * 1000 + 28 * 60 * 1000);
    setInterval(() => {
        const diff = nextCheck - new Date();
        if (diff <= 0) {
            nextCheck = new Date(Date.now() + 5 * 3600 * 1000);
            return;
        }
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const el = document.getElementById('cron-countdown-text');
        if (el) el.textContent = `Ciclo 5h: Ativo (${hours}h ${mins}m)`;
    }, 1000);
}

function formatDatePt(dStr) {
    if (!dStr) return '--';
    const parts = dStr.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return dStr;
}

function formatMoney(num) {
    if (num === undefined || num === null) return '0,00';
    return Number(num).toFixed(2).replace('.', ',');
}
