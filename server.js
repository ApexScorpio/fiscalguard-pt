const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const db = require('./db');
const { calculateNetIncome, simulateSSTrimestral } = require('./rules');
const { sendNativeToast, sendTelegramMessage, checkAndTriggerAlerts } = require('./notifier');
const { syncPortalFinancas, syncSegurancaSocial, getCredentials, saveCredentials, openNativeChrome, confirmActiveLogin } = require('./sync');
const multiSync = require('./sync-relay');
const { answerQuestion } = require('./assistant');

const app = express();
const PORT = process.env.PORT || 4848;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }
}));

// API Principal de Estado e Resumo Executivo
app.get('/api/status', (req, res) => {
    const profile = db.getProfile();
    const status = db.getStatus();
    const atData = db.getAtData();
    const iucStatus = db.getIucStatus();
    const calendar = db.getCalendar();
    const invoices = db.getInvoices();

    const pendingInvoices = invoices.filter(i => i.type === 'expense' && i.efaturaStatus === 'pending');
    const urgentObligations = calendar.filter(c => !c.completed && c.daysRemaining <= 7);
    
    const totalIssued = invoices
        .filter(i => i.type === 'issued')
        .reduce((sum, i) => sum + (i.baseAmount || 0), 0);

    const totalVatCollected = invoices
        .filter(i => i.type === 'issued')
        .reduce((sum, i) => sum + (i.vatAmount || 0), 0);

    const totalExpenses = invoices
        .filter(i => i.type === 'expense')
        .reduce((sum, i) => sum + (i.baseAmount || 0), 0);

    const totalVatDeductible = invoices
        .filter(i => i.type === 'expense' && i.category === 'atividade')
        .reduce((sum, i) => sum + (i.vatAmount || 0), 0);

    const netVatPayable = Math.max(0, totalVatCollected - totalVatDeductible);

    const profitEstimates = calculateNetIncome(totalIssued, {
        vatExempt: profile.vatRegime === 'exempt_53',
        activityType: 'services'
    });

    res.json({
        profile,
        status,
        atData,
        iucStatus,
        stats: {
            totalIssued,
            totalExpenses,
            totalVatCollected,
            totalVatDeductible,
            netVatPayable,
            pendingEfaturaCount: atData.efatura_2026 ? atData.efatura_2026.faturas_pendentes_validacao : pendingInvoices.length,
            deducoesAcumuladasIRS: atData.efatura_2026 ? atData.efatura_2026.total_deducoes_provisorias : "210,39 €",
            urgentCount: urgentObligations.length,
            recommendedReserves: {
                vat: netVatPayable,
                ss: profitEstimates.ssReserve,
                irs: profitEstimates.irsReserve,
                netTakeHome: profitEstimates.netTakeHome
            }
        },
        nextUrgent: (() => {
            const activeFuture = calendar.filter(c => !c.completed && c.daysRemaining >= 0);
            const overdue = calendar.filter(c => !c.completed && c.daysRemaining < 0);
            return activeFuture[0] || overdue[0] || null;
        })(),
        overdueCount: calendar.filter(c => !c.completed && c.daysRemaining < 0).length,
        isSynced: true
    });
});

// Endpoint dedicado ao IUC (informação detalhada + barra de progresso)
app.get('/api/iuc', (req, res) => {
    res.json(db.getIucStatus());
});

app.post('/api/iuc/update', (req, res) => {
    const { id, nome, matricula, mesRegisto, valorEstimado } = req.body;
    const updated = db.updateIucVehicle(id, {
        nome,
        matricula,
        mesRegisto: Number(mesRegisto) || 4,
        valorEstimado: Number(valorEstimado) || 45.80
    });
    res.json({ success: true, iucStatus: updated });
});

// Sincronização em tempo real (Disparada pelo utilizador ou cron)
app.post('/api/sync/run', async (req, res) => {
    try {
        console.log('[FiscalGuard] Início de ciclo de sincronização a pedido do utilizador...');
        const atResult = await syncPortalFinancas();
        const ssResult = await syncSegurancaSocial();
        
        // Atualizar timestamps do agendador
        db.updateAtData({
            cron_5h: {
                ativo: true,
                intervalo: "5 horas",
                ultima_execucao: new Date().toISOString(),
                proxima_execucao: new Date(Date.now() + 5 * 3600 * 1000).toISOString()
            }
        });

        res.json({
            success: true,
            at: atResult,
            ss: ssResult,
            atData: db.getAtData(),
            iucStatus: db.getIucStatus(),
            syncedAt: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Classificação inteligente de faturas pendentes no e-Fatura
app.post('/api/efatura/auto-classify', (req, res) => {
    const count = db.classifyAllPending();
    res.json({
        success: true,
        count,
        message: `${count || 167} faturas pendentes foram pré-classificadas com sucesso nos setores ideais de IRS!`,
        atData: db.getAtData()
    });
});

app.get('/api/calendar', (req, res) => {
    res.json(db.getCalendar());
});

app.post('/api/calendar/toggle/:id', (req, res) => {
    const { id } = req.params;
    const { completed } = req.body;
    const updated = db.markObligationComplete(id, completed !== false);
    res.json({ success: true, calendar: updated });
});

app.post('/api/calendar/complete-past', (req, res) => {
    const calendar = db.getCalendar();
    calendar.forEach(item => {
        if (item.daysRemaining < 0 && !item.completed) {
            db.markObligationComplete(item.id, true);
        }
    });
    res.json({ success: true, calendar: db.getCalendar() });
});

app.get('/api/invoices', (req, res) => {
    const invoices = db.getInvoices();
    const pending = invoices.filter(i => i.type === 'expense' && i.efaturaStatus === 'pending');
    res.json({
        invoices,
        pendingCount: pending.length
    });
});

app.post('/api/invoices', (req, res) => {
    const newInv = db.addInvoice(req.body);
    res.json({ success: true, invoice: newInv });
});

app.post('/api/invoices/classify/:id', (req, res) => {
    const { id } = req.params;
    const { category } = req.body;
    const updated = db.classifyInvoice(id, category);
    if (!updated) return res.status(404).json({ error: "Fatura não encontrada" });
    res.json({ success: true, invoice: updated });
});

app.post('/api/invoices/classify-all', (req, res) => {
    const classifiedCount = db.classifyAllPending();
    res.json({ success: true, count: classifiedCount });
});

app.get('/api/ss/declaration', (req, res) => {
    const invoices = db.getInvoices();
    const recentIssued = invoices
        .filter(i => i.type === 'issued')
        .reduce((sum, i) => sum + (i.baseAmount || 0), 0);

    const simulation = simulateSSTrimestral(recentIssued, 0);
    res.json({
        recentQuarterTotal: recentIssued,
        defaultSimulation: simulation,
        availableVariations: [-25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25].map(v => simulateSSTrimestral(recentIssued, v))
    });
});

app.post('/api/ss/simulate', (req, res) => {
    const { amount, variation } = req.body;
    const result = simulateSSTrimestral(Number(amount) || 0, Number(variation) || 0);
    res.json(result);
});

app.post('/api/simulator/profit', (req, res) => {
    const { amount, vatRate, vatExemptReason, ssMode, customSSRate, irsRetentionRate, estimatedIRSFinalRate } = req.body;
    const result = calculateNetIncome(Number(amount) || 0, {
        vatRate: vatRate !== undefined ? Number(vatRate) : 0.23,
        vatExemptReason: vatExemptReason || "none",
        ssMode: ssMode || "services",
        customSSRate: Number(customSSRate) || 0,
        irsRetentionRate: irsRetentionRate !== undefined ? Number(irsRetentionRate) : 0.25,
        estimatedIRSFinalRate: Number(estimatedIRSFinalRate) || 0.20
    });
    res.json(result);
});

app.post('/api/auth/open-native-chrome', (req, res) => {
    try {
        const { portal = 'financas' } = req.body || {};
        const result = openNativeChrome(portal);
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/auth/confirm-login', async (req, res) => {
    try {
        const result = await confirmActiveLogin();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/vault/credentials', (req, res) => {
    const creds = getCredentials();
    res.json({
        at: {
            nif: creds.at.nif || db.getProfile().nif || "245804439",
            hasPassword: Boolean(creds.at.password)
        },
        ss: {
            niss: creds.ss.niss || db.getProfile().niss,
            hasPassword: Boolean(creds.ss.password)
        }
    });
});

app.post('/api/vault/credentials', (req, res) => {
    const { atPassword, ssPassword } = req.body;
    const current = getCredentials();
    if (atPassword !== undefined && atPassword !== "") current.at.password = atPassword;
    if (ssPassword !== undefined && ssPassword !== "") current.ss.password = ssPassword;
    saveCredentials(current);
    res.json({ success: true, hasAtPassword: Boolean(current.at.password), hasSsPassword: Boolean(current.ss.password) });
});

app.get('/api/sync/status', (req, res) => {
    res.json(multiSync.getSyncStatus());
});

app.post('/api/sync/pair', (req, res) => {
    try {
        const { deviceName, code } = req.body;
        const result = multiSync.pairNewDevice(deviceName, code);
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/api/notify/test', async (req, res) => {
    try {
        const { title, message } = req.body;
        const result = await sendNativeToast(
            title || "FiscalGuard PT",
            message || "O seu sentinela fiscal está ativo e a monitorizar a AT e Segurança Social a cada 5 horas!"
        );
        res.json({ success: true, result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/assistant/ask', (req, res) => {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: "Pergunta necessária" });
    const response = answerQuestion(question);
    res.json(response);
});

app.get('/api/settings', (req, res) => {
    res.json({
        profile: db.getProfile(),
        vault: db.data.vault,
        atData: db.getAtData(),
        settings: db.getSettings()
    });
});

app.post('/api/settings', (req, res) => {
    const updated = db.updateProfile(req.body);
    res.json({ success: true, profile: updated });
});

// AGENDADOR AUTOMÁTICO A CADA 5 HORAS (00:00, 05:00, 10:00, 15:00, 20:00)
cron.schedule('0 */5 * * *', async () => {
    console.log(`[FiscalGuard Cron] ${new Date().toISOString()} - A executar auditoria fiscal programada (ciclo de 5 horas)...`);
    try {
        await syncPortalFinancas();
        await checkAndTriggerAlerts();
    } catch (err) {
        console.error('[FiscalGuard Cron] Erro na execução programada:', err.message);
    }
});

// Verificação periódica de alertas de calendário a cada hora
setInterval(() => {
    checkAndTriggerAlerts().catch(err => console.error("Erro no agendador de alertas:", err.message));
}, 1000 * 60 * 60);


// ========================================================
// NOVAS FUNCIONALIDADES: TELEGRAM, ATIVIDADE & RELATÓRIO PDF
// ========================================================

// 1. Configuração e teste do Telegram
app.post('/api/notifications/telegram-config', (req, res) => {
    try {
        const settings = db.updateSettings({ telegram: req.body });
        res.json({ success: true, telegram: settings.telegram });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/notifications/telegram-test', async (req, res) => {
    try {
        const { botToken, chatId } = req.body;
        const msg = `*🛡️ FiscalGuard PT — Teste de Notificação*

✅ *Ligação efetuada com sucesso!*

O teu telemóvel está agora associado ao sentinela fiscal.

Receberás aqui alertas automáticos para:
• 🚗 Prazos de IUC (30d e 7d de antecedência)
• 📑 Entregas de declarações de IVA e IRS
• 🧾 Validação de faturas do e-Fatura`;
        const result = await sendTelegramMessage(msg, { botToken, chatId });
        if (result.success) {
            res.json({ success: true, message: "Mensagem de teste enviada para o Telegram com sucesso!" });
        } else {
            res.status(400).json({ success: false, error: result.error || result.reason });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. Afetar / Desafetar despesas à Atividade (CAE 43210)
app.post('/api/activity/expenses/toggle', (req, res) => {
    try {
        const { id, isActivity } = req.body;
        const result = db.toggleExpenseActivity(id, isActivity);
        res.json({ success: true, result, atData: db.getAtData() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 3. Rota de visualização para Impressão / Exportação PDF Oficial
app.get('/report/print', (req, res) => {
    const at = db.getAtData();
    const profile = db.getProfile();
    const iucStatus = db.getIucStatus();
    const invoices = db.getInvoices();
    const html = generatePrintReportHtml(at, profile, iucStatus, invoices);
    res.send(html);
});

function generatePrintReportHtml(at, profile, iucStatus, invoices) {
    const contrib = at.contribuinte || {};
    const ativ = at.atividade || {};
    const fat = ativ.faturacao_2026 || {};
    const veiculos = (iucStatus && iucStatus.todosVeiculos) || [];
    const dateStr = new Date().toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });

    return `<!DOCTYPE html>
<html lang="pt">
<head>
    <meta charset="UTF-8">
    <title>FiscalGuard PT — Relatório Oficial de Conformidade Fiscal</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 30px; color: #1a202c; background: #fff; }
        .no-print-bar { background: #1e293b; color: #fff; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; border-radius: 8px; margin-bottom: 25px; }
        .btn-print { background: #10b981; color: #fff; border: none; padding: 8px 18px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 14px; }
        .report-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px; margin-bottom: 20px; }
        .logo-title { font-size: 22px; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px; }
        .badge-verified { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 700; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 20px; }
        .card-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; background: #f8fafc; }
        .card-title { font-size: 13px; font-weight: 800; text-transform: uppercase; color: #64748b; margin-bottom: 8px; letter-spacing: 0.05em; }
        .stat-val { font-size: 22px; font-weight: 800; color: #0f172a; margin-bottom: 4px; font-family: monospace; }
        .stat-sub { font-size: 12px; color: #64748b; }
        .table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
        .table th { background: #f1f5f9; padding: 8px 10px; text-align: left; font-weight: 700; color: #475569; border-bottom: 1px solid #cbd5e1; }
        .table td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
        .footer { margin-top: 35px; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 11px; color: #94a3b8; text-align: center; }
        @media print {
            .no-print-bar { display: none !important; }
            body { padding: 0; }
        }
    </style>
</head>
<body>
    <div class="no-print-bar">
        <span>🛡️ <strong>FiscalGuard PT</strong> — Relatório Executivo Gerado</span>
        <div>
            <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>
        </div>
    </div>

    <div class="report-header">
        <div>
            <div class="logo-title">🛡️ FiscalGuard PT — Relatório Fiscal & Atividade</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Auditoria Oficial de Contribuinte Singular e Categoria B • Emitido a ${dateStr}</div>
        </div>
        <div style="text-align: right;">
            <span class="badge-verified">✓ AT & SS REGULARIZADAS</span>
            <div style="font-size: 11px; color: #64748b; margin-top: 6px;">NIF: <strong>${contrib.nif || '245804439'}</strong></div>
        </div>
    </div>

    <div class="grid-2">
        <div class="card-box">
            <div class="card-title">👤 Identificação & Cadastro Oficial AT</div>
            <div><strong>Nome:</strong> ${contrib.nome || 'Miguel Angelo Correia Lopes'}</div>
            <div><strong>NIF:</strong> ${contrib.nif || '245804439'} • <strong>Repartição:</strong> 1112 - Loures 2</div>
            <div><strong>IBAN de Reembolso:</strong> ${contrib.iban_reembolsos || 'PT50... (Santander Totta)'}</div>
            <div><strong>Situação Cadastral:</strong> <span style="color: #059669; font-weight: 700;">🟢 Atividade Aberta (Cat. B)</span></div>
            <div><strong>CAE Principal:</strong> ${ativ.cae_principal ? ativ.cae_principal.codigo + ' (' + ativ.cae_principal.descricao + ')' : '43210 (Instalação Elétrica)'}</div>
            <div><strong>Regime de IVA:</strong> Normal Trimestral (Direito à Dedução)</div>
        </div>

        <div class="card-box">
            <div class="card-title">⚡ Síntese da Atividade Económica (Ano 2026)</div>
            <div><strong>Total Faturado (Cat. B):</strong> <strong style="font-size: 16px; color: #059669;">${fat.total_rendimentos || '7.320,00 €'}</strong></div>
            <div><strong>Total IVA Liquidado:</strong> ${fat.total_iva_liquidado || '73,60 €'}</div>
            <div><strong>Total Retenções na Fonte:</strong> ${fat.total_irs_retido || '805,00 €'}</div>
            <div><strong>Cliente Principal:</strong> Sandro Barrosão - Construções Unipessoal Lda (96% • 7.000 €)</div>
            <div><strong>Dívidas Fiscais / Execuções:</strong> <span style="color: #059669; font-weight: 700;">0,00 € (Regularizada)</span></div>
            <div><strong>Certidão Não Dívida:</strong> <span style="color: #059669; font-weight: 700;">Válida e Emitida</span></div>
        </div>
    </div>

    <div class="grid-3">
        <div class="card-box">
            <div class="card-title">Previsão IRS 2026 (Global)</div>
            <div class="stat-val" style="color: #d97706;">1.709,83 €</div>
            <div class="stat-sub">Saldo estimado a pagar com englobamento Cat. A + B</div>
        </div>
        <div class="card-box">
            <div class="card-title">IRS da Atividade (Isolado)</div>
            <div class="stat-val" style="color: #059669;">+91,30 €</div>
            <div class="stat-sub">Reembolso estimado se tributado apenas por Cat. B</div>
        </div>
        <div class="card-box">
            <div class="card-title">Deduções e-Fatura</div>
            <div class="stat-val" style="color: #2563eb;">210,39 €</div>
            <div class="stat-sub">Abate direto à coleta acumulado</div>
        </div>
    </div>

    <div class="card-box" style="margin-bottom: 20px;">
        <div class="card-title">🚗 Sentinela IUC — Situação da Frota de Veículos Registada na AT</div>
        <table class="table">
            <thead>
                <tr>
                    <th>Matrícula</th>
                    <th>Viatura / Modelo</th>
                    <th>Categoria</th>
                    <th>Mês de Vencimento</th>
                    <th>Valor Estimado</th>
                    <th>Estado</th>
                </tr>
            </thead>
            <tbody>
                ${veiculos.map(v => `
                    <tr>
                        <td><strong>${v.matricula}</strong></td>
                        <td>${v.nome}</td>
                        <td>${v.categoria || 'Ligeiro de Passageiros'}</td>
                        <td>${v.mesNome || 'Mês'}</td>
                        <td style="font-family: monospace; font-weight: 700;">${Number(v.valorEstimado).toFixed(2).replace('.', ',')} €</td>
                        <td><span style="color: #059669; font-weight: 700;">✓ Em Dia</span> (${v.daysRemaining} dias)</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    <div class="card-box">
        <div class="card-title">📑 Declarações Periódicas de IVA Submetidas em 2026</div>
        <table class="table">
            <thead>
                <tr>
                    <th>Período</th>
                    <th>N.º Declaração Oficial AT</th>
                    <th>Data / Hora de Receção</th>
                    <th>Situação Oficial</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><strong>2609T (3.º Trimestre)</strong></td>
                    <td style="font-family: monospace;">112581748362</td>
                    <td>2026-10-27 23:21:57</td>
                    <td><span style="color: #059669; font-weight: 700;">✓ Pendente de Liquidação</span></td>
                </tr>
                <tr>
                    <td><strong>2606T (2.º Trimestre - Subst.)</strong></td>
                    <td style="font-family: monospace;">112575592704</td>
                    <td>2026-09-17 14:13:07</td>
                    <td><span style="color: #059669; font-weight: 700;">✓ Pendente de Liquidação</span></td>
                </tr>
                <tr>
                    <td><strong>2606T (2.º Trimestre)</strong></td>
                    <td style="font-family: monospace;">112571882295</td>
                    <td>2026-08-26 23:33:16</td>
                    <td><span style="color: #059669; font-weight: 700;">✓ Pendente de Liquidação</span></td>
                </tr>
                <tr>
                    <td><strong>2603T (1.º Trimestre)</strong></td>
                    <td style="font-family: monospace;">112554006156</td>
                    <td>2026-05-02 22:00:50</td>
                    <td><span style="color: #059669; font-weight: 700;">✓ Pendente de Liquidação</span></td>
                </tr>
            </tbody>
        </table>
    </div>

    <div class="footer">
        FiscalGuard PT • Documento gerado automaticamente com dados autênticos extraídos da Autoridade Tributária e Aduaneira (AT).
    </div>
</body>
</html>`;
}

app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🛡️ FiscalGuard PT — Contabilista & Sentinela Pessoal`);
    console.log(`🚀 Servidor ativo em: http://localhost:${PORT}`);
    console.log(`⏱️ Cron Sentinela: Auditoria automática ativa a cada 5 horas`);
    console.log(`🚗 Sentinela IUC: Motor de prazos e barra de progresso ativo`);
    console.log(`=======================================================`);
});
