/**
 * FiscalGuard PRO — Frontend Controller & Realtime Sentinel Engine
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Inicializar Navegação por Abas
    initTabs();

    // 2. Carregar Dados Iniciais
    loadDashboardData();

    // 3. Inicializar Listeners de Ações Rápidas
    initActionButtons();

    // 4. Polling Automático a cada 20 segundos
    setInterval(loadDashboardData, 20000);

    // 5. Atualizar temporizador do cron a cada segundo
    initCronTimer();
});

/* ==========================================================================
   NAVEGAÇÃO POR ABAS
   ========================================================================== */
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
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

/* ==========================================================================
   CARREGAMENTO & RENDERIZAÇÃO DE DADOS
   ========================================================================== */
async function loadDashboardData() {
    try {
        const [resStatus, resIuc, resCalendar, resInvoices] = await Promise.all([
            fetch('/api/status').then(r => r.json()),
            fetch('/api/iuc').then(r => r.json()),
            fetch('/api/calendar').then(r => r.json()),
            fetch('/api/invoices').then(r => r.json())
        ]);

        renderHeader(resStatus);
        renderHeroMetrics(resStatus, resIuc);
        renderIucTab(resIuc);
        renderEfaturaTab(resStatus, resInvoices);
        renderCalendar(resCalendar);
        renderSecondaryReserves(resStatus);

    } catch (err) {
        console.error('[FiscalGuard] Erro ao carregar dados do dashboard:', err);
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

function renderHeroMetrics(statusData, iucData) {
    const at = statusData.atData || {};
    const proximo = iucData.proximoIuc || {};

    // 1. CARD HERO IUC
    const iucNameEl = document.getElementById('iuc-vehicle-name');
    const iucPlateEl = document.getElementById('iuc-vehicle-plate');
    const iucAmountEl = document.getElementById('iuc-hero-amount');
    const iucDeadlineEl = document.getElementById('iuc-hero-deadline');
    const iucDaysEl = document.getElementById('iuc-hero-days');
    const iucProgressEl = document.getElementById('iuc-progress-bar');
    const iucPercentEl = document.getElementById('iuc-progress-percent');
    const iucBadgeEl = document.getElementById('iuc-hero-badge');

    if (iucNameEl) iucNameEl.textContent = proximo.nome || 'Viatura Principal';
    if (iucPlateEl) iucPlateEl.textContent = `Matrícula: ${proximo.matricula || 'XX-XX-XX'} • Mês: ${proximo.mesNome || 'Abril'}`;
    if (iucAmountEl) iucAmountEl.textContent = formatMoney(proximo.valorEstimado || 45.80);
    if (iucDeadlineEl) iucDeadlineEl.textContent = proximo.deadlineFormatted || '30 de Abril de 2027';
    if (iucDaysEl) iucDaysEl.textContent = `Faltam ${proximo.daysRemaining} dias`;
    
    const pct = Math.min(100, Math.max(0, proximo.progressPercent || 52));
    if (iucProgressEl) iucProgressEl.style.width = `${pct}%`;
    if (iucPercentEl) iucPercentEl.textContent = `${pct}% do ciclo anual percorrido`;
    if (iucBadgeEl) {
        iucBadgeEl.textContent = proximo.daysRemaining > 30 ? '✓ Ciclo Atual Pago' : '⚠️ Vencimento Próximo';
        iucBadgeEl.className = proximo.daysRemaining > 30 ? 'badge-status badge-success' : 'badge-status badge-warning';
    }

    // 2. CARD IRS
    const irs = at.irs || {};
    const dec = irs.declaracao_recente || {};
    if (dec.montante_liquidado) document.getElementById('irs-hero-amount').textContent = `-${dec.montante_liquidado}`;
    if (irs.rendimento_global_2025) document.getElementById('irs-rendimento-global').textContent = irs.rendimento_global_2025;
    if (irs.coleta_liquida_2025) document.getElementById('irs-coleta-liquida').textContent = irs.coleta_liquida_2025;
    if (irs.retencao_fonte_2025) document.getElementById('irs-retencao-fonte').textContent = irs.retencao_fonte_2025;

    // 3. CARD E-FATURA
    const efatura = at.efatura_2026 || {};
    const pendentesCount = efatura.faturas_pendentes_validacao !== undefined ? efatura.faturas_pendentes_validacao : 167;
    const deducoesTotal = efatura.total_deducoes_provisorias || "210,39 €";

    document.getElementById('efatura-hero-amount').textContent = deducoesTotal;
    const heroBadge = document.getElementById('efatura-hero-pending-badge');
    if (heroBadge) {
        heroBadge.textContent = pendentesCount > 0 ? `${pendentesCount} Pendentes` : '✓ Todas Validadas';
        heroBadge.className = pendentesCount > 0 ? 'badge-status badge-warning' : 'badge-status badge-success';
    }

    const navBadge = document.getElementById('nav-efatura-badge');
    if (navBadge) {
        navBadge.textContent = pendentesCount;
        navBadge.style.display = pendentesCount > 0 ? 'inline-block' : 'none';
    }

    const btnHeroClassify = document.getElementById('btn-auto-classify-hero');
    if (btnHeroClassify) {
        if (pendentesCount === 0) {
            btnHeroClassify.textContent = '✓ 100% das Faturas Validadas no e-Fatura';
            btnHeroClassify.disabled = true;
            btnHeroClassify.style.opacity = '0.6';
        } else {
            btnHeroClassify.textContent = `⚡ Classificar ${pendentesCount} Faturas com IA`;
            btnHeroClassify.disabled = false;
        }
    }
}

function renderIucTab(iucData) {
    const proximo = iucData.proximoIuc || {};

    document.getElementById('iuc-detail-name').textContent = `${proximo.nome || 'Viatura Principal'} (Matrícula de ${proximo.mesNome || 'Abril'})`;
    document.getElementById('iuc-detail-specs').textContent = `Matrícula: ${proximo.matricula || 'XX-XX-XX'} • Mês de Matrícula: ${proximo.mesNome || 'Abril'} • Prazo legal no último dia do mês`;
    document.getElementById('iuc-detail-amount').textContent = `${formatMoney(proximo.valorEstimado || 45.80)} €`;
    document.getElementById('iuc-detail-deadline').textContent = proximo.deadlineFormatted || '30 de Abril de 2027';
    document.getElementById('iuc-detail-days-remaining').textContent = `${proximo.daysRemaining} dias restantes`;
    
    const pct = Math.min(100, Math.max(0, proximo.progressPercent || 52));
    document.getElementById('iuc-detail-progress-bar').style.width = `${pct}%`;
    document.getElementById('iuc-detail-percent-text').textContent = `${pct}% do ciclo`;

    // Lista de Veículos
    const vehContainer = document.getElementById('vehicles-list-container');
    if (vehContainer && iucData.todosVeiculos) {
        vehContainer.innerHTML = iucData.todosVeiculos.map(v => `
            <div class="vehicle-card-row">
                <div>
                    <div style="font-weight: 700; color: #fff;">${v.nome}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">Matrícula: ${v.matricula} • Mês: ${v.mesNome}</div>
                </div>
                <div style="text-align: right;">
                    <div style="font-family: 'JetBrains Mono'; font-weight: 700; color: var(--accent-amber);">${formatMoney(v.valorEstimado)} €</div>
                    <span class="badge-status badge-success" style="font-size: 10px;">${v.daysRemaining} dias</span>
                </div>
            </div>
        `).join('');
    }

    // Histórico de Pagamentos
    const histContainer = document.getElementById('iuc-history-container');
    if (histContainer && iucData.historico) {
        histContainer.innerHTML = iucData.historico.map(h => `
            <div class="history-card-row">
                <div>
                    <div style="font-weight: 600; color: #fff; font-size: 12px;">${h.evento}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">Processado pela AT</div>
                </div>
                <div style="font-family: 'JetBrains Mono'; font-size: 12px; color: var(--accent-emerald); font-weight: 700;">
                    ${h.data}
                </div>
            </div>
        `).join('');
    }
}

function renderEfaturaTab(statusData, invoicesData) {
    const at = statusData.atData || {};
    const setores = (at.efatura_2026 && at.efatura_2026.detalhe_setores) || {};

    const sectorsGrid = document.getElementById('efatura-sectors-grid');
    if (sectorsGrid) {
        const sectorNames = {
            despesas_gerais_familiares: { title: "Despesas Gerais Familiares", icon: "🛒", max: 250 },
            reparacao_automoveis: { title: "Reparação de Automóveis", icon: "🔧", max: 250 },
            ginasios: { title: "Ginásios & Desporto", icon: "🏋️", max: 250 },
            restauracao_e_alojamento: { title: "Restauração & Alojamento", icon: "☕", max: 250 },
            saude: { title: "Saúde & Medicamentos", icon: "💊", max: 1000 },
            educacao: { title: "Educação & Manuais", icon: "📚", max: 800 },
            habitacao: { title: "Habitação / Rendas", icon: "🏠", max: 502 }
        };

        sectorsGrid.innerHTML = Object.keys(sectorNames).map(k => {
            const info = sectorNames[k];
            const data = setores[k] || { deducao: "0,00 €", limite: `${info.max},00 €` };
            const numDed = parseFloat(data.deducao.replace('€', '').replace(',', '.').trim()) || 0;
            const pct = Math.min(100, Math.round((numDed / info.max) * 100));

            return `
                <div class="sector-card">
                    <div class="sector-name">${info.icon} ${info.title}</div>
                    <div class="sector-val-row">
                        <span style="color: var(--accent-emerald); font-weight: 700; font-family: 'JetBrains Mono';">${data.deducao}</span>
                        <span style="color: var(--text-muted); font-size: 11px;">Teto: ${data.limite || info.max + ' €'}</span>
                    </div>
                    <div class="progress-bar-track">
                        <div class="progress-bar-fill fill-gradient-iuc" style="width: ${pct}%;"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Tabela de Faturas
    const tbody = document.getElementById('invoices-table-body');
    if (tbody && invoicesData && invoicesData.invoices) {
        tbody.innerHTML = invoicesData.invoices.slice(0, 50).map(i => `
            <tr>
                <td style="font-family: 'JetBrains Mono';">${i.date}</td>
                <td style="font-weight: 600; color: #fff;">${i.entity || i.supplierName}</td>
                <td style="font-family: 'JetBrains Mono';">${i.supplierNif || '--'}</td>
                <td style="font-family: 'JetBrains Mono'; font-weight: 700; color: #fff;">${formatMoney(i.total)} €</td>
                <td style="font-family: 'JetBrains Mono'; color: var(--text-muted);">${formatMoney(i.vatAmount)} €</td>
                <td><span class="badge-status badge-info">${i.category || 'Pendente'}</span></td>
                <td>
                    <span class="badge-status ${i.efaturaStatus === 'pending' ? 'badge-warning' : 'badge-success'}">
                        ${i.efaturaStatus === 'pending' ? 'Pendente' : 'Validada'}
                    </span>
                </td>
            </tr>
        `).join('');
    }
}

function renderCalendar(calendar) {
    const listOverview = document.getElementById('overview-obligations-container');
    const listFull = document.getElementById('calendar-full-container');

    const html = calendar.slice(0, 4).map(item => `
        <div class="obligation-item">
            <div class="ob-left">
                <div class="ob-icon-badge">${item.category === 'IUC' ? '🚗' : (item.category === 'IRS' ? '📑' : '🏛️')}</div>
                <div>
                    <div class="ob-title">${item.title}</div>
                    <div class="ob-sub">${item.description} • Limite: ${item.deadline}</div>
                </div>
            </div>
            <div class="ob-right">
                <span class="ob-days ${item.daysRemaining <= 7 ? 'text-rose' : 'text-amber'}">
                    ${item.daysRemaining < 0 ? 'Concluída' : (item.daysRemaining === 0 ? 'Hoje' : `${item.daysRemaining} dias`)}
                </span>
                <span class="badge-status ${item.completed ? 'badge-success' : 'badge-info'}">
                    ${item.completed ? 'Cumprido' : 'Em Curso'}
                </span>
            </div>
        </div>
    `).join('');

    if (listOverview) listOverview.innerHTML = html;
    if (listFull) listFull.innerHTML = html;
}

function renderSecondaryReserves(statusData) {
    const stats = statusData.stats || {};
    const reserves = stats.recommendedReserves || {};

    document.getElementById('overview-net-amount').textContent = `${formatMoney(reserves.netTakeHome || 0)} €`;
    document.getElementById('overview-vat-reserve').textContent = `${formatMoney(reserves.vat || 0)} €`;
    document.getElementById('overview-ss-reserve').textContent = `${formatMoney(reserves.ss || 0)} €`;
    document.getElementById('overview-irs-reserve').textContent = `${formatMoney(reserves.irs || 0)} €`;
}

/* ==========================================================================
   LISTENERS DE AÇÕES
   ========================================================================== */
function initActionButtons() {
    // Botão Sincronizar Agora
    const btnSync = document.getElementById('btn-sync-now');
    if (btnSync) {
        btnSync.addEventListener('click', async () => {
            btnSync.disabled = true;
            btnSync.innerHTML = '<span class="icon-refresh spinning">⚡</span> <span>A sincronizar com AT...</span>';
            
            try {
                const res = await fetch('/api/sync/run', { method: 'POST' }).then(r => r.json());
                alert("✓ Sincronização concluída com sucesso! Os valores mais recentes do Portal das Finanças foram atualizados.");
                await loadDashboardData();
            } catch (e) {
                alert("Aviso na sincronização: " + e.message);
            } finally {
                btnSync.disabled = false;
                btnSync.innerHTML = '<span class="icon-refresh">⚡</span> <span class="btn-text">Sincronizar com AT</span>';
            }
        });
    }

    // Botões de Classificar e-Fatura
    const setupClassify = (btnId) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                btn.textContent = 'A classificar com regras inteligentes...';
                try {
                    const res = await fetch('/api/efatura/auto-classify', { method: 'POST' }).then(r => r.json());
                    alert("✓ " + res.message);
                    await loadDashboardData();
                } catch (e) {
                    alert("Erro ao classificar: " + e.message);
                } finally {
                    btn.disabled = false;
                }
            });
        }
    };
    setupClassify('btn-auto-classify-hero');
    setupClassify('btn-auto-classify-efatura');

    // Guardar Configuração de IUC
    const btnSaveIuc = document.getElementById('btn-save-iuc-config');
    if (btnSaveIuc) {
        btnSaveIuc.addEventListener('click', async () => {
            const body = {
                id: 'v-abril-1',
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
            alert("✓ Configuração de IUC atualizada com sucesso!");
            await loadDashboardData();
        });
    }
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
        if (el) el.textContent = `⏱️ Ciclo 5h: Ativo • Próxima verificação em ${hours}h ${mins}m`;
    }, 1000);
}

function formatMoney(num) {
    if (num === undefined || num === null) return '0,00';
    return Number(num).toFixed(2).replace('.', ',');
}
