const fs = require('fs');
const path = require('path');
const { getFiscalCalendar, predictCategory } = require('./rules');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const EMPTY_STATE = {
    profile: {
        name: "",
        nif: "",
        niss: "",
        activityType: "independent",
        vatRegime: "normal",
        directDebitSS: false,
        directDebitAT: false,
        vehiclePlate: "",
        vehicleRegMonth: null,
        alertDays: [30, 7, 2, 0]
    },
    status: {
        financas: {
            situation: "nao_configurado",
            lastSync: null,
            certidaoValidaAte: null,
            dividasAtivas: 0,
            divergencias: 0
        },
        segurancaSocial: {
            situation: "nao_configurado",
            lastSync: null,
            debitoDiretoAtivo: false,
            ultimoPagamento: null,
            proximoPagamento: null
        }
    },
    invoices: [],
    calendarState: {},
    vault: {
        hasFinancasCredentials: false,
        hasSSCredentials: false,
        lastVerified: null
    }
};

const DEFAULT_STATE = EMPTY_STATE;

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
        this.data = this.load();
        return this.data.profile;
    }

    updateProfile(updates) {
        this.data = this.load();
        this.data.profile = { ...this.data.profile, ...updates };
        this.save();
        return this.data.profile;
    }

    getStatus() {
        this.data = this.load();
        return this.data.status;
    }

    updateStatus(updates) {
        this.data = this.load();
        if (updates.financas) {
            this.data.status.financas = { ...this.data.status.financas, ...updates.financas };
        }
        if (updates.segurancaSocial) {
            this.data.status.segurancaSocial = { ...this.data.status.segurancaSocial, ...updates.segurancaSocial };
        }
        this.save();
        return this.data.status;
    }

    getInvoices() {
        this.data = this.load();
        return this.data.invoices || [];
    }

    addInvoice(invoice) {
        this.data = this.load();
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
        this.data = this.load();
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
        this.data = this.load();
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
        this.data = this.load();
        const hasFinancas = Boolean(this.data.status.financas && this.data.status.financas.lastSync);
        const hasSS = Boolean(this.data.status.segurancaSocial && this.data.status.segurancaSocial.lastSync);
        const hasInvoices = Boolean(this.data.invoices && this.data.invoices.length > 0);

        // Se ainda não iniciou sessão nos portais oficiais, a agenda está 100% vazia
        if (!hasFinancas && !hasSS && !hasInvoices) {
            return [];
        }

        const fiscalList = getFiscalCalendar(new Date().getFullYear(), this.data.profile);
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

    clearAllData() {
        this.data = JSON.parse(JSON.stringify(EMPTY_STATE));
        this.save();
        return this.data;
    }
}

module.exports = new Database();
