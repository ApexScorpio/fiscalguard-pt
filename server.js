const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { calculateNetIncome, simulateSSTrimestral } = require('./rules');
const { sendNativeToast, checkAndTriggerAlerts } = require('./notifier');
const { syncPortalFinancas, syncSegurancaSocial, getCredentials, saveCredentials } = require('./sync');
const multiSync = require('./sync-relay');
const { answerQuestion } = require('./assistant');

const app = express();
const PORT = process.env.PORT || 4848;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
    const profile = db.getProfile();
    const status = db.getStatus();
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
        stats: {
            totalIssued,
            totalExpenses,
            totalVatCollected,
            totalVatDeductible,
            netVatPayable,
            pendingEfaturaCount: pendingInvoices.length,
            urgentCount: urgentObligations.length,
            recommendedReserves: {
                vat: netVatPayable,
                ss: profitEstimates.ssReserve,
                irs: profitEstimates.irsReserve,
                netTakeHome: profitEstimates.netTakeHome
            }
        },
        nextUrgent: urgentObligations[0] || calendar.find(c => !c.completed)
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
    const { 
        amount, 
        vatRate, 
        vatExemptReason, 
        ssMode, 
        customSSRate, 
        irsRetentionRate, 
        estimatedIRSFinalRate 
    } = req.body;

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

app.post('/api/sync/run', async (req, res) => {
    try {
        const { headless = true } = req.body || {};
        const atResult = await syncPortalFinancas({ headless });
        const ssResult = await syncSegurancaSocial({ headless });
        const multiSyncResult = multiSync.syncViaSharedFolder();

        res.json({
            success: true,
            at: atResult,
            ss: ssResult,
            multiSync: multiSyncResult,
            syncedAt: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/vault/credentials', (req, res) => {
    const creds = getCredentials();
    res.json({
        at: {
            nif: creds.at.nif || db.getProfile().nif,
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
    current.at.nif = db.getProfile().nif;
    current.ss.niss = db.getProfile().niss;
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

app.get('/api/sync/export', (req, res) => {
    const packet = multiSync.exportSyncPacket();
    res.json(packet);
});

app.post('/api/sync/import', (req, res) => {
    try {
        const { token, secretKey } = req.body;
        const result = multiSync.importSyncPacket(token, secretKey);
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/api/sync/shared-folder', (req, res) => {
    const result = multiSync.syncViaSharedFolder();
    res.json(result);
});

app.post('/api/notify/test', async (req, res) => {
    try {
        const { title, message } = req.body;
        const result = await sendNativeToast(
            title || "FiscalGuard PT",
            message || "O seu contabilista pessoal está ativo e a monitorizar todas as obrigações fiscais no PC e Portátil!"
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
        vault: db.data.vault
    });
});

app.post('/api/settings', (req, res) => {
    const updated = db.updateProfile(req.body);
    res.json({ success: true, profile: updated });
});

setInterval(() => {
    checkAndTriggerAlerts().catch(err => console.error("Erro no agendador de alertas:", err.message));
    multiSync.syncViaSharedFolder();
}, 1000 * 60 * 60);

checkAndTriggerAlerts().catch(() => {});
multiSync.syncViaSharedFolder();

app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🛡️ FiscalGuard PT - Contabilista & Sentinela Pessoal`);
    console.log(`🚀 Servidor ativo em: http://localhost:${PORT}`);
    console.log(`💻 Multi-Dispositivo: Sincronização PC & Portátil pronta`);
    console.log(`📂 Armazenamento Seguro: S:\\fiscalguard-pt`);
    console.log(`=======================================================`);
});
