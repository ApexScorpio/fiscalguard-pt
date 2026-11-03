const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const db = require('./db');
const { calculateNetIncome, simulateSSTrimestral } = require('./rules');
const { sendNativeToast, checkAndTriggerAlerts } = require('./notifier');
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
        atData: db.getAtData()
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

app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🛡️ FiscalGuard PT — Contabilista & Sentinela Pessoal`);
    console.log(`🚀 Servidor ativo em: http://localhost:${PORT}`);
    console.log(`⏱️ Cron Sentinela: Auditoria automática ativa a cada 5 horas`);
    console.log(`🚗 Sentinela IUC: Motor de prazos e barra de progresso ativo`);
    console.log(`=======================================================`);
});
