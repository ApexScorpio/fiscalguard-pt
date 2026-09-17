const fs = require('fs');
const path = require('path');
const { getFiscalCalendar, predictCategory } = require('./rules');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_STATE = {
    profile: {
        name: "ApexScorpio",
        nif: "249817263",
        niss: "12039485711",
        activityType: "independent",
        vatRegime: "normal",
        directDebitSS: true,
        directDebitAT: false,
        vehiclePlate: "AA-00-ZZ",
        vehicleRegMonth: 9,
        alertDays: [30, 7, 2, 0]
    },
    status: {
        financas: {
            situation: "regularizada",
            lastSync: new Date().toISOString(),
            certidaoValidaAte: "2026-12-31",
            dividasAtivas: 0,
            divergencias: 0
        },
        segurancaSocial: {
            situation: "regularizada",
            lastSync: new Date().toISOString(),
            debitoDiretoAtivo: true,
            ultimoPagamento: {
                mes: "Agosto 2026",
                valor: 184.22,
                pagoEm: "2026-08-19"
            },
            proximoPagamento: {
                mes: "Setembro 2026",
                valor: 184.22,
                limite: "2026-09-20",
                entidade: "12244",
                referencia: "512 849 392"
            }
        }
    },
    invoices: [
        {
            id: "inv-e1",
            type: "issued",
            number: "FR 2026/12",
            date: "2026-09-02",
            clientName: "Tech Solutions Portugal Lda",
            clientNif: "509182736",
            description: "Prestação de serviços de consultoria informática e desenvolvimento",
            baseAmount: 2250.00,
            vatRate: 0.23,
            vatAmount: 517.50,
            retentionRate: 0.25,
            retentionAmount: 562.50,
            netReceived: 2205.00
        },
        {
            id: "inv-e2",
            type: "issued",
            number: "FR 2026/11",
            date: "2026-08-01",
            clientName: "Design & Media Studio",
            clientNif: "512398471",
            description: "Desenvolvimento de plataforma web e suporte técnico",
            baseAmount: 1800.00,
            vatRate: 0.23,
            vatAmount: 414.00,
            retentionRate: 0.25,
            retentionAmount: 450.00,
            netReceived: 1764.00
        },
        {
            id: "inv-d1",
            type: "expense",
            supplierName: "Galp Energia / Combustíveis",
            supplierNif: "500109741",
            date: "2026-09-15",
            baseAmount: 65.00,
            vatAmount: 14.95,
            totalAmount: 79.95,
            efaturaStatus: "pending",
            suggestedCategory: "atividade",
            category: null,
            cae: "47300"
        },
        {
            id: "inv-d2",
            type: "expense",
            supplierName: "Farmácia Central de Lisboa",
            supplierNif: "502391823",
            date: "2026-09-12",
            baseAmount: 42.10,
            vatAmount: 2.53,
            totalAmount: 44.63,
            efaturaStatus: "pending",
            suggestedCategory: "saude",
            category: null,
            cae: "47730"
        },
        {
            id: "inv-d3",
            type: "expense",
            supplierName: "Restaurante O Solar dos Sabores",
            supplierNif: "509827361",
            date: "2026-09-10",
            baseAmount: 38.00,
            vatAmount: 4.94,
            totalAmount: 42.94,
            efaturaStatus: "pending",
            suggestedCategory: "restauracao",
            category: null,
            cae: "56101"
        },
        {
            id: "inv-d4",
            type: "expense",
            supplierName: "Worten Equipamentos",
            supplierNif: "503630330",
            date: "2026-09-05",
            baseAmount: 320.00,
            vatAmount: 73.60,
            totalAmount: 393.60,
            efaturaStatus: "pending",
            suggestedCategory: "atividade",
            category: null,
            cae: "47410"
        },
        {
            id: "inv-d5",
            type: "expense",
            supplierName: "Continente Modelo Hipermercados",
            supplierNif: "501530948",
            date: "2026-09-01",
            baseAmount: 145.20,
            vatAmount: 12.30,
            totalAmount: 157.50,
            efaturaStatus: "validated",
            suggestedCategory: "geral",
            category: "geral",
            cae: "47111"
        },
        {
            id: "inv-d6",
            type: "expense",
            supplierName: "Vodafone Portugal Comunicações",
            supplierNif: "502544180",
            date: "2026-08-28",
            baseAmount: 48.00,
            vatAmount: 11.04,
            totalAmount: 59.04,
            efaturaStatus: "validated",
            suggestedCategory: "atividade",
            category: "atividade",
            cae: "61100"
        }
    ],
    calendarState: {},
    vault: {
        hasFinancasCredentials: true,
        hasSSCredentials: true,
        lastVerified: new Date().toISOString()
    }
};

class Database {
    constructor() {
        this.data = this.load();
    }

    load() {
        try {
            if (fs.existsSync(DB_FILE)) {
                const raw = fs.readFileSync(DB_FILE, 'utf8');
                return JSON.parse(raw);
            }
        } catch (e) {
            console.error("Erro ao ler database.json, usando padrão:", e.message);
        }
        this.save(DEFAULT_STATE);
        return DEFAULT_STATE;
    }

    save(data = this.data) {
        try {
            this.data = data;
            fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
            return true;
        } catch (e) {
            console.error("Erro ao salvar database.json:", e.message);
            return false;
        }
    }

    getProfile() {
        return this.data.profile;
    }

    updateProfile(updates) {
        this.data.profile = { ...this.data.profile, ...updates };
        this.save();
        return this.data.profile;
    }

    getStatus() {
        return this.data.status;
    }

    updateStatus(updates) {
        this.data.status = { ...this.data.status, ...updates };
        this.save();
        return this.data.status;
    }

    getInvoices() {
        return this.data.invoices;
    }

    addInvoice(invoice) {
        const newInv = {
            id: "inv-" + Date.now(),
            date: new Date().toISOString().split('T')[0],
            efaturaStatus: invoice.type === 'expense' ? 'pending' : undefined,
            suggestedCategory: invoice.type === 'expense' ? predictCategory(invoice.supplierName, invoice.supplierNif) : undefined,
            category: null,
            ...invoice
        };
        this.data.invoices.unshift(newInv);
        this.save();
        return newInv;
    }

    classifyInvoice(id, category) {
        const inv = this.data.invoices.find(i => i.id === id);
        if (inv) {
            inv.category = category;
            inv.efaturaStatus = 'validated';
            this.save();
            return inv;
        }
        return null;
    }

    classifyAllPending() {
        let count = 0;
        this.data.invoices.forEach(inv => {
            if (inv.type === 'expense' && inv.efaturaStatus === 'pending') {
                inv.category = inv.suggestedCategory || predictCategory(inv.supplierName, inv.supplierNif);
                inv.efaturaStatus = 'validated';
                count++;
            }
        });
        if (count > 0) this.save();
        return count;
    }

    getCalendar() {
        const fiscalList = getFiscalCalendar();
        const savedStates = this.data.calendarState || {};

        return fiscalList.map(item => {
            const state = savedStates[item.id] || { completed: false, completedDate: null };
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const deadlineDate = new Date(item.deadline);
            deadlineDate.setHours(0, 0, 0, 0);
            
            const diffTime = deadlineDate - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            let statusColor = "normal";
            if (state.completed) {
                statusColor = "completed";
            } else if (diffDays < 0) {
                statusColor = "overdue";
            } else if (diffDays <= 2) {
                statusColor = "critical";
            } else if (diffDays <= 7) {
                statusColor = "warning";
            } else if (diffDays <= 30) {
                statusColor = "attention";
            }

            return {
                ...item,
                completed: state.completed,
                completedDate: state.completedDate,
                daysRemaining: diffDays,
                statusColor
            };
        }).sort((a, b) => {
            if (a.completed && !b.completed) return 1;
            if (!a.completed && b.completed) return -1;
            return a.daysRemaining - b.daysRemaining;
        });
    }

    markObligationComplete(id, completed = true) {
        if (!this.data.calendarState) this.data.calendarState = {};
        this.data.calendarState[id] = {
            completed,
            completedDate: completed ? new Date().toISOString() : null
        };
        this.save();
        return this.getCalendar();
    }
}

module.exports = new Database();
