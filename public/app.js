/**
 * FiscalGuard PT — Frontend Controller & Realtime Sync Engine
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Inicializar Navegação por Abas
    initTabs();

    // 2. Carregar Dados Iniciais da API Local
    loadAllData();

    // 3. Inicializar Listeners de Eventos e Simuladores
    initEventListeners();
    initSimulators();
    initAssistant();

    // 4. Polling Automático de Atualização (a cada 30 segundos)
    setInterval(() => {
        loadStatus();
        loadCalendar();
    }, 30000);
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

    // Botão de atalho do banner para ver detalhes
    const bannerBtn = document.getElementById('btn-banner-action');
    if (bannerBtn) {
        bannerBtn.addEventListener('click', () => {
            switchTab('tab-overview');
        });
    }

    // Botão de atalho do header para gerir o portátil
    const openDevicesBtn = document.getElementById('btn-open-devices');
    if (openDevicesBtn) {
        openDevicesBtn.addEventListener('click', () => {
            switchTab('tab-devices');
        });
    }
}

function switchTab(tabPaneId) {
    const targetTabBtn = document.querySelector(`.nav-tab[data-tab="${tabPaneId}"]`);
    if (targetTabBtn) {
        targetTabBtn.click();
    }
}

/* ==========================================================================
   CARREGAMENTO DE DADOS (REST API)
   ========================================================================== */
async function loadAllData() {
    await Promise.all([
        loadStatus(),
        loadCalendar(),
        loadInvoices(),
        loadSyncStatus(),
        loadSettings()
    ]);
}

async function loadStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();

        // Atualizar Semáforo
        const atTextEl = document.getElementById('at-situation-text');
        const atDotEl = document.getElementById('at-indicator-dot');
        if (data.status.financas.situation === 'regularizada') {
            atTextEl.textContent = 'Regularizada (OK)';
            if (atDotEl) atDotEl.className = 'status-indicator live-pulse';
        } else if (data.status.financas.situation === 'divida') {
            atTextEl.textContent = 'Atenção / Dívida';
            if (atDotEl) atDotEl.className = 'status-indicator live-pulse dot-critical';
        } else {
            atTextEl.textContent = 'A Aguardar Login';
            if (atDotEl) atDotEl.className = 'status-indicator dot-warning';
        }

        const ssTextEl = document.getElementById('ss-situation-text');
        const ssDotEl = document.getElementById('ss-indicator-dot');
        if (data.status.segurancaSocial.situation === 'regularizada') {
            ssTextEl.textContent = 'Regularizada (OK)';
            if (ssDotEl) ssDotEl.className = 'status-indicator live-pulse';
        } else if (data.status.segurancaSocial.situation === 'pendente') {
            ssTextEl.textContent = 'Pendente';
            if (ssDotEl) ssDotEl.className = 'status-indicator live-pulse dot-critical';
        } else {
            ssTextEl.textContent = 'A Aguardar Login';
            if (ssDotEl) ssDotEl.className = 'status-indicator dot-warning';
        }

        // Atualizar Métricas Principais
        const isFresh = !data.isSynced && (data.stats.totalIssued === 0 && data.stats.totalExpenses === 0);
        if (isFresh) {
            document.getElementById('overview-net-amount').textContent = '-- €';
            document.getElementById('overview-vat-reserve').textContent = '-- €';
            document.getElementById('overview-ss-reserve').textContent = '-- €';
            document.getElementById('overview-irs-reserve').textContent = '-- €';
            const subtext = document.getElementById('overview-net-subtext');
            if (subtext) subtext.textContent = 'A aguardar primeiro início de sessão nos portais';
        } else {
            document.getElementById('overview-net-amount').textContent = formatCurrency(data.stats.recommendedReserves.netTakeHome);
            document.getElementById('overview-vat-reserve').textContent = formatCurrency(data.stats.recommendedReserves.vat);
            document.getElementById('overview-ss-reserve').textContent = formatCurrency(data.stats.recommendedReserves.ss);
            document.getElementById('overview-irs-reserve').textContent = formatCurrency(data.stats.recommendedReserves.irs);
            const subtext = document.getElementById('overview-net-subtext');
            if (subtext) subtext.textContent = 'Dinheiro 100% limpo e livre de impostos para gastar';
        }

        // Contador de e-fatura
        const efaturaCounter = document.getElementById('efatura-counter');
        if (efaturaCounter) {
            efaturaCounter.textContent = data.stats.pendingEfaturaCount;
            efaturaCounter.style.display = data.stats.pendingEfaturaCount > 0 ? 'inline-block' : 'none';
        }

        // Atualizar Banner
        const urgentBanner = document.getElementById('urgent-alert-banner');
        const bannerText = document.getElementById('urgent-banner-text');
        const alertBadge = document.querySelector('.alert-badge');
        const bannerBtn = document.getElementById('btn-banner-action');

        if (isFresh) {
            urgentBanner.style.display = 'flex';
            if (alertBadge) {
                alertBadge.textContent = "🔑 AUTENTICAÇÃO NOS PORTAIS";
                alertBadge.style.background = "rgba(16, 185, 129, 0.2)";
                alertBadge.style.borderColor = "rgba(16, 185, 129, 0.4)";
                alertBadge.style.color = "#34d399";
            }
            bannerText.innerHTML = `<strong>Nenhum dado sincronizado ainda:</strong> Como não vais registar nada à mão, inicia sessão no Portal das Finanças e Segurança Social para ler os teus dados reais.`;
            if (bannerBtn) {
                bannerBtn.textContent = "Iniciar Sessão Oficial";
                bannerBtn.onclick = () => openPortalLoginModal();
            }
        } else if (data.nextUrgent) {
            urgentBanner.style.display = 'flex';
            if (bannerBtn) {
                bannerBtn.textContent = "Ver Detalhes";
                bannerBtn.onclick = () => switchTab('tab-overview');
            }
            const days = data.nextUrgent.daysRemaining;
            let timePhrase = "";

            if (days < 0) {
                if (alertBadge) alertBadge.textContent = "🚨 OBRIGAÇÃO PASSADA";
                timePhrase = `<span style="color:#f43f5e;font-weight:700;">Terminou há ${Math.abs(days)} dia(s)</span>`;
            } else if (days === 0) {
                if (alertBadge) alertBadge.textContent = "⚠️ LIMITE HOJE";
                timePhrase = `<span style="color:#f59e0b;font-weight:700;">TERMINA HOJE!</span>`;
            } else if (days <= 2) {
                if (alertBadge) alertBadge.textContent = `🚨 URGENTE (Faltam ${days}d)`;
                timePhrase = `Faltam apenas <strong>${days} dia(s)</strong> (Prazo: ${data.nextUrgent.deadline})`;
            } else {
                if (alertBadge) alertBadge.textContent = "📅 PRÓXIMA OBRIGAÇÃO";
                timePhrase = `Faltam <strong>${days} dia(s)</strong> (Prazo: ${data.nextUrgent.deadline})`;
            }

            let overdueNotice = data.overdueCount > 0 
                ? ` <span style="color:var(--text-muted);font-size:12px;">(${data.overdueCount} de meses anteriores por arquivar)</span>` 
                : "";

            bannerText.innerHTML = `<strong>${data.nextUrgent.title}</strong> &mdash; ${timePhrase}. ${data.nextUrgent.description}${overdueNotice}`;
        } else {
            urgentBanner.style.display = 'none';
        }

    } catch (e) {
        console.error("Erro ao carregar /api/status:", e);
    }
}

let currentCalFilter = 'upcoming';

async function loadCalendar(filter = currentCalFilter) {
    currentCalFilter = filter;
    try {
        const res = await fetch('/api/calendar');
        const list = await res.json();
        const container = document.getElementById('obligations-container');
        if (!container) return;

        // Atualizar contador de anteriores
        const overdueCount = list.filter(i => !i.completed && i.daysRemaining < 0).length;
        const overdueEl = document.getElementById('cal-overdue-count');
        if (overdueEl) overdueEl.textContent = overdueCount;

        const filteredList = list.filter(item => {
            if (filter === 'upcoming') return !item.completed && item.daysRemaining >= 0;
            if (filter === 'overdue') return !item.completed && item.daysRemaining < 0;
            if (filter === 'completed') return item.completed;
            return true; // 'all'
        });

        container.innerHTML = '';

        if (filteredList.length === 0) {
            container.innerHTML = `
                <div style="text-align:center;padding:32px;color:var(--text-muted);">
                    <div style="font-size:32px;margin-bottom:8px;">✓</div>
                    <strong>Nenhuma obrigação nesta categoria.</strong>
                    <p style="font-size:13px;margin-top:4px;">Todas as obrigações deste filtro estão em dia ou concluídas.</p>
                </div>
            `;
            return;
        }

        filteredList.forEach(item => {
            const card = document.createElement('div');
            card.className = `obligation-card ${item.statusColor}`;

            let countdownBadgeClass = 'badge-normal';
            let countdownText = `${item.daysRemaining}d`;

            if (item.completed) {
                countdownBadgeClass = 'badge-completed';
                countdownText = '✓ Concluído';
            } else if (item.daysRemaining < 0) {
                countdownBadgeClass = 'badge-critical';
                countdownText = `ATRASO (${Math.abs(item.daysRemaining)}d)`;
            } else if (item.daysRemaining <= 2) {
                countdownBadgeClass = 'badge-critical';
                countdownText = `URGENTE (${item.daysRemaining}d)`;
            } else if (item.daysRemaining <= 7) {
                countdownBadgeClass = 'badge-warning';
                countdownText = `Faltam ${item.daysRemaining}d`;
            }

            card.innerHTML = `
                <div class="ob-left">
                    <div class="ob-badge-countdown ${countdownBadgeClass}">${countdownText}</div>
                    <div class="ob-details">
                        <h4>${item.title}</h4>
                        <p>${item.description}</p>
                        <small style="color:var(--text-muted);">Prazo: <strong>${item.deadline}</strong> | Entidade: <strong>${item.entity}</strong></small>
                    </div>
                </div>
                <div class="ob-right">
                    <button class="btn btn-small ${item.completed ? 'btn-outline' : 'btn-emerald'}" onclick="toggleObligation('${item.id}', ${!item.completed})">
                        ${item.completed ? 'Reabrir' : '✓ Marcar Pago / Concluído'}
                    </button>
                    ${item.actionUrl ? `<a href="${item.actionUrl}" target="_blank" class="btn btn-small btn-secondary" title="Abrir portal oficial">↗ Portal</a>` : ''}
                </div>
            `;

            container.appendChild(card);
        });

    } catch (e) {
        console.error("Erro ao carregar /api/calendar:", e);
    }
}

window.toggleObligation = async function(id, completed) {
    try {
        await fetch(`/api/calendar/toggle/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completed })
        });
        loadCalendar();
        loadStatus();
    } catch (e) {
        alert("Erro ao atualizar estado: " + e.message);
    }
};

async function loadInvoices(filter = 'all') {
    try {
        const res = await fetch('/api/invoices');
        const data = await res.json();
        const tbody = document.getElementById('invoices-tbody');
        if (!tbody) return;

        tbody.innerHTML = '';

        const invoices = data.invoices.filter(inv => {
            if (filter === 'pending') return inv.type === 'expense' && inv.efaturaStatus === 'pending';
            if (filter === 'issued') return inv.type === 'issued';
            if (filter === 'expense') return inv.type === 'expense';
            return true;
        });

        if (invoices.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align:center;padding:48px 16px;color:var(--text-muted);">
                        <div style="font-size:32px;margin-bottom:10px;">🔐</div>
                        <h4 style="color:var(--text-primary);margin-bottom:6px;font-size:16px;">Nenhuma fatura carregada ainda</h4>
                        <p style="font-size:13px;max-width:540px;margin:0 auto 16px auto;line-height:1.5;">
                            Como definiste, <strong>não tens de registar faturas manualmente</strong>. O robô vai ler todas as tuas despesas do <strong>e-fatura</strong> e <strong>faturas emitidas</strong> diretamente do Portal das Finanças assim que iniciares sessão.
                        </p>
                        <button class="btn btn-emerald" onclick="openPortalLoginModal()">
                            <span class="btn-icon">🔑</span> Iniciar Sessão Oficial no Portal das Finanças
                        </button>
                    </td>
                </tr>
            `;
            return;
        }

        invoices.forEach(inv => {
            const tr = document.createElement('tr');
            
            const isExpense = inv.type === 'expense';
            const entityName = isExpense ? inv.supplierName : inv.clientName;
            const nif = isExpense ? inv.supplierNif : inv.clientNif;
            const total = inv.totalAmount || (inv.baseAmount + (inv.vatAmount || 0));

            let statusBadge = '';
            let actionBtn = '';

            if (isExpense) {
                if (inv.efaturaStatus === 'pending') {
                    statusBadge = `<span class="badge badge-pending">⚠️ Pendente e-fatura</span>`;
                    actionBtn = `
                        <button class="btn btn-small btn-emerald" onclick="classifySingleInvoice('${inv.id}', '${inv.suggestedCategory || 'geral'}')">
                            Classificar como "${getCategoryName(inv.suggestedCategory)}"
                        </button>
                    `;
                } else {
                    statusBadge = `<span class="badge badge-validated">✓ ${getCategoryName(inv.category)}</span>`;
                    actionBtn = `<span style="color:var(--text-muted);font-size:12px;">Validado na AT</span>`;
                }
            } else {
                statusBadge = `<span class="badge badge-info">Fatura Emitida</span>`;
                actionBtn = `<span style="color:var(--text-muted);font-size:12px;">Comunicada AT</span>`;
            }

            tr.innerHTML = `
                <td>${inv.date}</td>
                <td><strong>${entityName}</strong></td>
                <td>${nif || 'Consumidor'}</td>
                <td>${isExpense ? 'Despesa' : 'Rendimento'}</td>
                <td>${formatCurrency(inv.baseAmount)}</td>
                <td>${formatCurrency(inv.vatAmount)}</td>
                <td style="font-weight:700;">${formatCurrency(total)}</td>
                <td>${statusBadge}</td>
                <td>${actionBtn}</td>
            `;

            tbody.appendChild(tr);
        });

    } catch (e) {
        console.error("Erro ao carregar faturas:", e);
    }
}

window.classifySingleInvoice = async function(id, category) {
    try {
        await fetch(`/api/invoices/classify/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category })
        });
        loadInvoices();
        loadStatus();
    } catch (e) {
        alert("Erro ao classificar: " + e.message);
    }
};

async function loadSyncStatus() {
    try {
        const res = await fetch('/api/sync/status');
        const sync = await res.json();

        // Mostrar código de emparelhamento
        const pairingCodeDisplay = document.getElementById('display-pairing-code');
        if (pairingCodeDisplay) pairingCodeDisplay.textContent = sync.pairingCode;

        // Mostrar caminho da pasta partilhada
        const syncPathDisplay = document.getElementById('display-sync-path');
        if (syncPathDisplay) syncPathDisplay.textContent = sync.sharedFolderPath;

        // Dispositivos emparelhados
        const devicesContainer = document.getElementById('paired-devices-container');
        if (devicesContainer) {
            devicesContainer.innerHTML = '';
            sync.pairedDevices.forEach(dev => {
                const item = document.createElement('div');
                item.className = 'device-item';
                const isCurrent = dev.type === 'current';
                item.innerHTML = `
                    <div class="device-icon">${isCurrent ? '💻' : '💻'}</div>
                    <div>
                        <div class="device-name">${dev.name} ${isCurrent ? '<span style="color:var(--accent-emerald);font-size:11px;">(Este Dispositivo)</span>' : ''}</div>
                        <div class="device-meta">Última Sincronização: ${new Date(dev.lastSync).toLocaleTimeString()} | Status: <strong style="color:var(--accent-emerald);">${dev.status}</strong></div>
                    </div>
                `;
                devicesContainer.appendChild(item);
            });
        }

    } catch (e) {
        console.error("Erro ao carregar /api/sync/status:", e);
    }
}

async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        const p = data.profile;

        document.getElementById('setting-nif').value = p.nif || '';
        document.getElementById('setting-niss').value = p.niss || '';
        document.getElementById('setting-activity').value = p.activityType || 'independent';
        document.getElementById('setting-vat').value = p.vatRegime || 'normal';
        document.getElementById('setting-plate').value = p.vehiclePlate || '';
        document.getElementById('setting-reg-month').value = p.vehicleRegMonth || '9';

        await loadVaultStatus();

    } catch (e) {
        console.error("Erro ao carregar /api/settings:", e);
    }
}

async function loadVaultStatus() {
    try {
        const res = await fetch('/api/vault/credentials');
        const creds = await res.json();

        const atBadge = document.getElementById('badge-at-status');
        if (atBadge) {
            if (creds.at.hasPassword) {
                atBadge.className = "badge badge-success";
                atBadge.textContent = "🟢 Senha Guardada no Cofre";
            } else {
                atBadge.className = "badge badge-pending";
                atBadge.textContent = "🔴 Senha Por Configurar";
            }
        }

        const ssBadge = document.getElementById('badge-ss-status');
        if (ssBadge) {
            if (creds.ss.hasPassword) {
                ssBadge.className = "badge badge-success";
                ssBadge.textContent = "🟢 Senha Guardada no Cofre";
            } else {
                ssBadge.className = "badge badge-pending";
                ssBadge.textContent = "🔴 Senha Por Configurar";
            }
        }
    } catch (e) {
        console.error("Erro ao carregar status do cofre:", e);
    }
}

/**
 * Executa a sincronização e extração direta dos portais com terminal ao vivo
 */
async function runPortalSync(options = {}) {
    const consoleModal = document.getElementById('modal-sync-console');
    const logsEl = document.getElementById('sync-terminal-logs');
    if (consoleModal && logsEl) {
        consoleModal.classList.add('active');
        logsEl.innerHTML = `[${new Date().toLocaleTimeString()}] A iniciar robô de extração do FiscalGuard PT...\n`;
    }

    const appendLog = (msg) => {
        if (logsEl) {
            logsEl.innerHTML += `${msg}\n`;
            logsEl.scrollTop = logsEl.scrollHeight;
        }
    };

    try {
        appendLog(`[${new Date().toLocaleTimeString()}] Modo: ${options.headed ? 'Navegador Visível (Headed)' : 'Segundo Plano Silencioso (Headless)'}`);
        appendLog(`[${new Date().toLocaleTimeString()}] A ligar aos portais oficiais com credenciais locais do cofre...`);

        const res = await fetch('/api/sync/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ headless: !options.headed })
        });
        const data = await res.json();

        if (data.at && data.at.log) {
            data.at.log.forEach(l => appendLog(l));
        }
        if (data.ss && data.ss.log) {
            data.ss.log.forEach(l => appendLog(l));
        }

        appendLog(`[${new Date().toLocaleTimeString()}] ✓ Leitura dos Portais 100% Concluída com Sucesso.`);
        await loadAllData();

    } catch (err) {
        appendLog(`[${new Date().toLocaleTimeString()}] ❌ Erro durante a leitura: ${err.message}`);
    }
}

window.openPortalLoginModal = function(portal = null) {
    const modal = document.getElementById('modal-portal-login');
    if (modal) modal.classList.add('active');
};

async function runInteractiveLogin(portal = 'financas') {
    const consoleModal = document.getElementById('modal-sync-console');
    const logsEl = document.getElementById('sync-terminal-logs');
    if (consoleModal && logsEl) {
        consoleModal.classList.add('active');
        logsEl.innerHTML = `[${new Date().toLocaleTimeString()}] A abrir o Microsoft Edge para autenticação no ${portal === 'financas' ? 'Portal das Finanças (AT)' : 'Segurança Social Direta'}...\n`;
    }

    const appendLog = (msg) => {
        if (logsEl) {
            logsEl.innerHTML += `${msg}\n`;
            logsEl.scrollTop = logsEl.scrollHeight;
        }
    };

    try {
        appendLog(`[${new Date().toLocaleTimeString()}] Uma janela do Microsoft Edge vai abrir-se. Por favor introduz os teus dados ou usa Chave Móvel Digital.`);
        const res = await fetch('/api/auth/open-portal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ portal })
        });
        const data = await res.json();
        if (data.log) {
            data.log.forEach(l => appendLog(l));
        }
        await loadAllData();
    } catch (err) {
        appendLog(`[${new Date().toLocaleTimeString()}] ❌ Erro: ${err.message}`);
    }
}

/* ==========================================================================
   EVENT LISTENERS & AÇÕES DO UTILIZADOR
   ========================================================================== */
function initEventListeners() {
    // 0. Botão de Iniciar Sessão Oficial nos Portais
    const btnOpenPortalLogin = document.getElementById('btn-open-portal-login');
    if (btnOpenPortalLogin) {
        btnOpenPortalLogin.addEventListener('click', () => openPortalLoginModal());
    }

    const btnClosePortalModal = document.getElementById('btn-close-portal-modal');
    const btnDismissPortalModal = document.getElementById('btn-dismiss-portal-modal');
    const modalPortalLogin = document.getElementById('modal-portal-login');

    if (btnClosePortalModal && modalPortalLogin) {
        btnClosePortalModal.addEventListener('click', () => modalPortalLogin.classList.remove('active'));
    }
    if (btnDismissPortalModal && modalPortalLogin) {
        btnDismissPortalModal.addEventListener('click', () => modalPortalLogin.classList.remove('active'));
    }

    const btnLoginAtEdge = document.getElementById('btn-login-at-edge');
    if (btnLoginAtEdge && modalPortalLogin) {
        btnLoginAtEdge.addEventListener('click', () => {
            modalPortalLogin.classList.remove('active');
            runInteractiveLogin('financas');
        });
    }

    const btnLoginSsEdge = document.getElementById('btn-login-ss-edge');
    if (btnLoginSsEdge && modalPortalLogin) {
        btnLoginSsEdge.addEventListener('click', () => {
            modalPortalLogin.classList.remove('active');
            runInteractiveLogin('seg_social');
        });
    }

    const linkGotoVault = document.getElementById('link-goto-vault');
    if (linkGotoVault && modalPortalLogin) {
        linkGotoVault.addEventListener('click', (e) => {
            e.preventDefault();
            modalPortalLogin.classList.remove('active');
            switchTab('tab-settings');
        });
    }

    // Gestão de Dados (Demo & Reset)
    const btnDemoClear = document.getElementById('btn-demo-clear');
    if (btnDemoClear) {
        btnDemoClear.addEventListener('click', async () => {
            if (!confirm("Tens a certeza que desejas limpar todos os dados e repor o sistema a 100% vazio?")) return;
            try {
                await fetch('/api/demo/clear', { method: 'POST' });
                await loadAllData();
                alert("✓ O sistema está agora 100% vazio e sem dados fictícios, pronto para a tua primeira autenticação oficial.");
            } catch (e) {
                alert("Erro ao limpar dados: " + e.message);
            }
        });
    }

    const btnDemoLoad = document.getElementById('btn-demo-load');
    if (btnDemoLoad) {
        btnDemoLoad.addEventListener('click', async () => {
            if (!confirm("Desejas carregar dados de exemplo apenas para demonstração visual das funcionalidades?")) return;
            try {
                await fetch('/api/demo/load', { method: 'POST' });
                await loadAllData();
                alert("✓ Dados de exemplo carregados para fins de demonstração.");
            } catch (e) {
                alert("Erro ao carregar demonstração: " + e.message);
            }
        });
    }

    // 1. Sincronização 100% Automática nos botões do topo e das abas
    const syncAllBtn = document.getElementById('btn-sync-all');
    if (syncAllBtn) {
        syncAllBtn.addEventListener('click', () => runPortalSync({ headed: false }));
    }

    const syncEfaturaDirect = document.getElementById('btn-sync-efatura-direct');
    if (syncEfaturaDirect) {
        syncEfaturaDirect.addEventListener('click', () => runPortalSync({ headed: false }));
    }

    const testScrapeNowBtn = document.getElementById('btn-test-scrape-now');
    if (testScrapeNowBtn) {
        testScrapeNowBtn.addEventListener('click', () => {
            const isHeaded = document.getElementById('vault-headed-mode')?.checked || false;
            runPortalSync({ headed: isHeaded });
        });
    }

    // Modal de Telemetria fechar
    const closeConsoleBtn = document.getElementById('btn-close-sync-console');
    const dismissConsoleBtn = document.getElementById('btn-dismiss-sync-console');
    const consoleModal = document.getElementById('modal-sync-console');
    if (closeConsoleBtn && consoleModal) {
        closeConsoleBtn.addEventListener('click', () => consoleModal.classList.remove('active'));
    }
    if (dismissConsoleBtn && consoleModal) {
        dismissConsoleBtn.addEventListener('click', () => consoleModal.classList.remove('active'));
    }

    // Formulário do Cofre de Credenciais
    const vaultForm = document.getElementById('vault-form');
    if (vaultForm) {
        vaultForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const atPassword = document.getElementById('vault-at-password').value;
            const ssPassword = document.getElementById('vault-ss-password').value;

            try {
                const res = await fetch('/api/vault/credentials', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ atPassword, ssPassword })
                });
                const result = await res.json();
                alert("✓ Senhas dos portais guardadas com sucesso no Cofre Local em S:\\fiscalguard-pt!\nA app agora consegue aceder e ler os teus dados diretamente.");
                await loadVaultStatus();
                document.getElementById('vault-at-password').value = '';
                document.getElementById('vault-ss-password').value = '';
            } catch (err) {
                alert("Erro ao guardar senhas no cofre: " + err.message);
            }
        });
    }

    // 2. Disparar Notificação Nativa do Windows
    const notifyBtn = document.getElementById('btn-notify-test');
    if (notifyBtn) {
        notifyBtn.addEventListener('click', async () => {
            try {
                await fetch('/api/notify/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: "FiscalGuard PT — Notificação Nativa",
                        message: "O teu assistente fiscal e contabilista está ativo e a vigiar Finanças e Segurança Social no PC e Portátil!"
                    })
                });
            } catch (e) {
                alert("Falha ao disparar notificação: " + e.message);
            }
        });
    }

    // 3. Auto-Classificar Todas as Pendentes no e-fatura
    const autoClassifyBtn = document.getElementById('btn-auto-classify');
    if (autoClassifyBtn) {
        autoClassifyBtn.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/invoices/classify-all', { method: 'POST' });
                const data = await res.json();
                alert(`✓ Sucesso! ${data.count} fatura(s) pendente(s) foram classificadas automaticamente de acordo com o CAE/NIF.`);
                loadInvoices();
                loadStatus();
            } catch (e) {
                alert("Erro ao auto-classificar: " + e.message);
            }
        });
    }

    // 3.1. Filtros de Obrigações do Calendário Fiscal
    const calFilterBtns = document.querySelectorAll('.btn-filter-cal');
    calFilterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            calFilterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadCalendar(btn.dataset.calFilter);
        });
    });

    // 3.2. Botão de Arquivar / Concluir Obrigações Anteriores
    const completePastBtn = document.getElementById('btn-complete-all-past');
    if (completePastBtn) {
        completePastBtn.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/calendar/complete-past', { method: 'POST' });
                const data = await res.json();
                loadCalendar();
                loadStatus();
            } catch (e) {
                alert("Erro ao arquivar obrigações anteriores: " + e.message);
            }
        });
    }

    // 4. Filtros de Tabela de Faturas
    const filterBtns = document.querySelectorAll('.btn-filter');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadInvoices(btn.dataset.filter);
        });
    });

    // 5. Modal de Nova Fatura
    const openModalBtn = document.getElementById('btn-add-invoice-modal');
    const modal = document.getElementById('modal-new-invoice');
    const closeModalBtn = document.getElementById('btn-close-invoice-modal');
    const cancelModalBtn = document.getElementById('btn-cancel-invoice');

    if (openModalBtn && modal) {
        openModalBtn.addEventListener('click', () => modal.classList.add('active'));
        closeModalBtn.addEventListener('click', () => modal.classList.remove('active'));
        cancelModalBtn.addEventListener('click', () => modal.classList.remove('active'));
    }

    const modalBase = document.getElementById('modal-inv-base');
    const modalVatRate = document.getElementById('modal-inv-vat-rate');
    const modalVat = document.getElementById('modal-inv-vat');

    const updateModalVat = () => {
        if (!modalBase || !modalVatRate || !modalVat) return;
        const b = parseFloat(modalBase.value) || 0;
        const r = parseFloat(modalVatRate.value) || 0;
        modalVat.value = (Math.round(b * r * 100) / 100).toFixed(2);
    };

    if (modalBase && modalVatRate) {
        modalBase.addEventListener('input', updateModalVat);
        modalVatRate.addEventListener('change', updateModalVat);
    }

    const formNewInvoice = document.getElementById('form-new-invoice');
    if (formNewInvoice) {
        formNewInvoice.addEventListener('submit', async (e) => {
            e.preventDefault();
            const type = document.getElementById('modal-inv-type').value;
            const entity = document.getElementById('modal-inv-entity').value;
            const nif = document.getElementById('modal-inv-nif').value;
            const base = parseFloat(document.getElementById('modal-inv-base').value) || 0;
            const vat = parseFloat(document.getElementById('modal-inv-vat').value) || 0;

            const payload = {
                type,
                baseAmount: base,
                vatAmount: vat,
                totalAmount: base + vat
            };

            if (type === 'expense') {
                payload.supplierName = entity;
                payload.supplierNif = nif;
            } else {
                payload.clientName = entity;
                payload.clientNif = nif;
                payload.number = "FR " + new Date().getFullYear() + "/" + Math.floor(10 + Math.random()*90);
            }

            try {
                await fetch('/api/invoices', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                modal.classList.remove('active');
                formNewInvoice.reset();
                loadInvoices();
                loadStatus();
            } catch (err) {
                alert("Erro ao adicionar fatura: " + err.message);
            }
        });
    }

    // 6. Emparelhar Dispositivo
    const btnPair = document.getElementById('btn-pair-device');
    if (btnPair) {
        btnPair.addEventListener('click', async () => {
            const inputCode = document.getElementById('input-remote-code').value.trim();
            if (!inputCode) return alert("Por favor introduz o código de emparelhamento.");

            try {
                const res = await fetch('/api/sync/pair', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        deviceName: "Portátil Conectado",
                        code: inputCode
                    })
                });
                const result = await res.json();
                if (result.error) throw new Error(result.error);

                alert("✓ Dispositivo emparelhado com sucesso! Sincronização em tempo real ativa.");
                loadSyncStatus();
            } catch (e) {
                alert("Falha no emparelhamento: " + e.message);
            }
        });
    }

    // 7. Sincronizar Pasta Partilhada
    const btnSyncFolder = document.getElementById('btn-sync-folder-action');
    if (btnSyncFolder) {
        btnSyncFolder.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/sync/shared-folder', { method: 'POST' });
                const data = await res.json();
                alert(`✓ Sincronização por Pasta: Estado atualizado (${data.action || 'OK'}).`);
                loadSyncStatus();
            } catch (e) {
                alert("Erro ao sincronizar pasta: " + e.message);
            }
        });
    }

    // 8. Formulário de Definições
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const updates = {
                nif: document.getElementById('setting-nif').value,
                niss: document.getElementById('setting-niss').value,
                activityType: document.getElementById('setting-activity').value,
                vatRegime: document.getElementById('setting-vat').value,
                vehiclePlate: document.getElementById('setting-plate').value,
                vehicleRegMonth: parseInt(document.getElementById('setting-reg-month').value, 10)
            };

            try {
                await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updates)
                });
                alert("✓ Definições guardadas com sucesso em S:\\fiscalguard-pt!");
                loadStatus();
            } catch (err) {
                alert("Erro ao guardar definições: " + err.message);
            }
        });
    }
}

/* ==========================================================================
   SIMULADORES (SEGURANÇA SOCIAL E LUCRO REAL)
   ========================================================================== */
function initSimulators() {
    // Simulador da Segurança Social (Declaração Trimestral)
    const ssIncomeInput = document.getElementById('ss-quarter-income');
    const ssSlider = document.getElementById('ss-variation-slider');
    const variationDisplay = document.getElementById('variation-display-value');

    const updateSSSim = async () => {
        const amount = parseFloat(ssIncomeInput.value) || 0;
        const variation = parseInt(ssSlider.value, 10) || 0;

        variationDisplay.textContent = `Variação: ${variation > 0 ? '+' : ''}${variation}%`;

        try {
            const res = await fetch('/api/ss/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, variation })
            });
            const data = await res.json();

            document.getElementById('ss-sim-relevant').textContent = formatCurrency(data.relevantIncome);
            document.getElementById('ss-sim-base').textContent = formatCurrency(data.adjustedMonthlyBase);
            document.getElementById('ss-sim-monthly').textContent = `${formatCurrency(data.monthlyContribution)} / mês`;
            document.getElementById('ss-sim-explanation').textContent = data.explanation;
        } catch (e) {
            console.error("Erro na simulação SS:", e);
        }
    };

    if (ssIncomeInput && ssSlider) {
        ssIncomeInput.addEventListener('input', updateSSSim);
        ssSlider.addEventListener('input', updateSSSim);
    }

    // Simulador de Lucro Real no Bolso (Avançado: IVA, SS e IRS variáveis)
    const profitInput = document.getElementById('sim-invoice-amount');
    const vatRateSelect = document.getElementById('sim-vat-rate');
    const ssModeSelect = document.getElementById('sim-ss-mode');
    const irsRetentionSelect = document.getElementById('sim-irs-retention');

    const customRatesRow = document.getElementById('custom-rates-row');
    const customVatGroup = document.getElementById('custom-vat-group');
    const customSsGroup = document.getElementById('custom-ss-group');
    const customVatInput = document.getElementById('sim-custom-vat');
    const customSsInput = document.getElementById('sim-custom-ss');

    const updateProfitSim = async () => {
        const amount = parseFloat(profitInput.value) || 0;
        const vatVal = vatRateSelect.value;
        const ssMode = ssModeSelect.value;
        const irsRetentionRate = parseFloat(irsRetentionSelect.value) || 0;

        let vatRate = 0.23;
        let vatExemptReason = "none";

        if (vatVal.startsWith("exempt_")) {
            vatRate = 0;
            vatExemptReason = vatVal.replace("exempt_", "");
        } else if (vatVal === "reverse_charge") {
            vatRate = 0;
            vatExemptReason = "reverse_charge";
        } else if (vatVal === "custom") {
            vatRate = (parseFloat(customVatInput.value) || 0) / 100;
        } else {
            vatRate = parseFloat(vatVal) || 0;
        }

        let customSSRate = 0;
        if (ssMode === "custom") {
            customSSRate = (parseFloat(customSsInput.value) || 0) / 100;
        }

        // Mostrar / Esconder campos personalizados
        const isCustomVat = vatVal === "custom";
        const isCustomSs = ssMode === "custom";
        if (customRatesRow) {
            customRatesRow.style.display = (isCustomVat || isCustomSs) ? 'flex' : 'none';
            if (customVatGroup) customVatGroup.style.display = isCustomVat ? 'block' : 'none';
            if (customSsGroup) customSsGroup.style.display = isCustomSs ? 'block' : 'none';
        }

        try {
            const res = await fetch('/api/simulator/profit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    amount, 
                    vatRate, 
                    vatExemptReason, 
                    ssMode, 
                    customSSRate,
                    irsRetentionRate 
                })
            });
            const data = await res.json();

            document.getElementById('profit-calc-net').textContent = formatCurrency(data.netTakeHome);
            document.getElementById('profit-calc-vat').textContent = formatCurrency(data.vatAmount);
            document.getElementById('profit-calc-ss').textContent = formatCurrency(data.ssReserve);
            document.getElementById('profit-calc-irs').textContent = formatCurrency(data.irsReserve);

            document.getElementById('profit-percent-net').textContent = `${data.breakdownPercentages.net}% do rendimento`;
            
            let vatBadgeText = `${Math.round(data.effectiveVatRate * 100)}% de IVA`;
            if (data.isVatExempt) {
                if (data.vatExemptReason === "53" || data.vatExemptReason === "art53") vatBadgeText = "Isento (Art. 53.º)";
                else if (data.vatExemptReason === "9" || data.vatExemptReason === "art9") vatBadgeText = "Isento (Art. 9.º)";
                else if (data.vatExemptReason === "reverse_charge") vatBadgeText = "Autoliquidação";
                else vatBadgeText = "Isento de IVA";
            }
            document.getElementById('profit-percent-vat').textContent = vatBadgeText;

            let ssBadgeText = `~${data.ssEffectivePercent}% efetivo`;
            if (data.ssMode === "exempt_tco") ssBadgeText = "Isento por TCO (0€)";
            document.getElementById('profit-percent-ss').textContent = ssBadgeText;

            let irsBadgeText = `Retenção: ${Math.round(data.irsRetentionRate * 100)}%`;
            document.getElementById('profit-percent-irs').textContent = irsBadgeText;

            const adviceBox = document.getElementById('profit-advice-text');
            if (adviceBox) {
                let vatNote = data.isVatExempt 
                    ? `Esta fatura é <strong>isenta de IVA (${vatBadgeText})</strong>, logo não há IVA a entregar ao Estado.` 
                    : `Cobras <strong>${formatCurrency(data.vatAmount)}</strong> de IVA (${Math.round(data.effectiveVatRate*100)}%) que pertence ao Estado e deve ser guardado.`;

                let ssNote = data.ssMode === "exempt_tco"
                    ? `Como tens <strong>isenção por Trabalho por Conta de Outrem</strong>, não tens de descontar nada para a Segurança Social nesta fatura.`
                    : data.ssMode === "sales"
                    ? `Para venda de mercadorias, a base de incidência da SS é de apenas 20%, resultando numa reserva de <strong>${formatCurrency(data.ssReserve)}</strong>.`
                    : `Para prestação de serviços, a base relevante é 70% (21,4%), exigindo uma reserva de <strong>${formatCurrency(data.ssReserve)}</strong>.`;

                let irsNote = data.irsWithheld > 0
                    ? `O cliente retém imediatamente <strong>${formatCurrency(data.irsWithheld)}</strong> na fonte (${Math.round(data.irsRetentionRate*100)}%), pelo que esse valor já não entra na tua conta.`
                    : `Sem retenção na fonte: deves guardar <strong>${formatCurrency(data.irsReserve)}</strong> para o acerto do Modelo 3 do IRS.`;

                adviceBox.innerHTML = `
                    <p style="margin-bottom:6px;"><strong>Análise da Fatura (${formatCurrency(data.grossAmount)}):</strong></p>
                    <ul style="padding-left:18px;margin-bottom:8px;">
                        <li>${vatNote}</li>
                        <li>${ssNote}</li>
                        <li>${irsNote}</li>
                    </ul>
                    <p>👉 <strong>Resultado Final:</strong> O teu dinheiro limpo e livre para gastares no bolso é de <strong>${formatCurrency(data.netTakeHome)}</strong>.</p>
                `;
            }
        } catch (e) {
            console.error("Erro no simulador de lucro:", e);
        }
    };

    if (profitInput && vatRateSelect && ssModeSelect && irsRetentionSelect) {
        profitInput.addEventListener('input', updateProfitSim);
        vatRateSelect.addEventListener('change', updateProfitSim);
        ssModeSelect.addEventListener('change', updateProfitSim);
        irsRetentionSelect.addEventListener('change', updateProfitSim);

        if (customVatInput) customVatInput.addEventListener('input', updateProfitSim);
        if (customSsInput) customSsInput.addEventListener('input', updateProfitSim);
    }
}

/* ==========================================================================
   ASSISTENTE FISCAL IA
   ========================================================================== */
function initAssistant() {
    const input = document.getElementById('assistant-user-input');
    const sendBtn = document.getElementById('btn-send-question');
    const chatDisplay = document.getElementById('assistant-chat-display');
    const chips = document.querySelectorAll('.btn-chip');

    const askAssistant = async (questionText) => {
        if (!questionText.trim()) return;

        // Adicionar mensagem do utilizador
        appendChatMessage("Tu", questionText, "user");
        input.value = '';

        try {
            const res = await fetch('/api/assistant/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: questionText })
            });
            const data = await res.json();
            appendChatMessage("FiscalGuard IA", `${data.title ? `<strong>${data.title}</strong>\n\n` : ''}${data.answer}`, "bot");
        } catch (e) {
            appendChatMessage("FiscalGuard IA", "Desculpa, ocorreu um erro ao consultar as regras fiscais: " + e.message, "bot");
        }
    };

    if (sendBtn && input) {
        sendBtn.addEventListener('click', () => askAssistant(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') askAssistant(input.value);
        });
    }

    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            askAssistant(chip.dataset.q);
        });
    });

    function appendChatMessage(sender, text, type) {
        const msg = document.createElement('div');
        msg.className = `chat-message message-${type}`;
        msg.innerHTML = `
            <div class="message-sender">${sender}</div>
            <div class="message-body">${text}</div>
        `;
        chatDisplay.appendChild(msg);
        chatDisplay.scrollTop = chatDisplay.scrollHeight;
    }
}

/* ==========================================================================
   UTILITÁRIOS
   ========================================================================== */
function formatCurrency(val) {
    const num = Number(val) || 0;
    return num.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
}

function getCategoryName(cat) {
    const names = {
        geral: "Gerais Familiares",
        saude: "Saúde",
        educacao: "Educação",
        imoveis: "Habitação",
        restauracao: "Restauração (15% IVA)",
        reparacao_auto: "Oficinas Auto",
        cabeleireiros: "Cabeleireiros",
        passes: "Passes Sociais",
        veterinarios: "Veterinários",
        ginasios: "Ginásios",
        atividade: "Atividade Profissional"
    };
    return names[cat] || "Geral";
}
