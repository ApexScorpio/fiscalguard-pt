const fs = require('fs');
const path = require('path');
const { getFiscalCalendar, predictCategory } = require('./rules');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Estado padrão inicial alimentado com a estrutura oficial
const DEFAULT_AT_DATA = {
    contribuinte: {
        nome: "Miguel Angelo Correia Lopes",
        nif: "245804439",
        email: "lopes.miguelac@gmail.com",
        email_estado: "POR CONFIRMAR",
        telefone: "916621451",
        telefone_estado: "CONFIRMADO (Aceita SMS)",
        data_adesao_portal: "2015-01-24",
        ultima_alteracao_senha: "2026-02-04",
        iban_reembolsos: "PT50 0018 0359 0020 0039 2126 7 (Santander Totta)",
        iban_estado: "Confirmado"
    },
    resumo_geral: {
        situacao_tributaria: "REGULARIZADA",
        dividas_ativas: "0,00 €",
        pagamentos_pendentes: "0,00 €",
        reembolsos_pendentes: "0,00 €",
        faturas_pendentes_validacao: 167
    },
    iuc: {
        estado: "Sem veículos com imposto pendente no ano em curso (Em dia)",
        veiculos: [
            {
                        "id": "v-57-ua-97",
                        "nome": "VORTEX 125 cc",
                        "matricula": "57-UA-97",
                        "categoria": "Motociclo (Cat. E)",
                        "combustivel": "Gasolina",
                        "cilindrada": "125 cc",
                        "emissoes": "50 g CO2/km",
                        "mesRegisto": 12,
                        "mesNome": "Dezembro",
                        "ultimoPagamento": null,
                        "valorEstimado": 6.19,
                        "estado": "pendente_dezembro_2026"
            },
            {
                        "id": "v-ag-14-dp",
                        "nome": "VORTEX 378 cc",
                        "matricula": "AG-14-DP",
                        "categoria": "Motociclo (Cat. E)",
                        "combustivel": "Gasolina",
                        "cilindrada": "378 cc",
                        "emissoes": "108 g CO2/km",
                        "mesRegisto": 3,
                        "mesNome": "Março",
                        "ultimoPagamento": "2026-04-19",
                        "valorEstimado": 21.18,
                        "estado": "pago_2026"
            },
            {
                        "id": "v-84-uz-80",
                        "nome": "OPEL 1.490 cc",
                        "matricula": "84-UZ-80",
                        "categoria": "Automóvel Ligeiro (Cat. B)",
                        "combustivel": "Gasolina",
                        "cilindrada": "1.490 cc",
                        "emissoes": "136 g CO2/km",
                        "mesRegisto": 6,
                        "mesNome": "Junho",
                        "ultimoPagamento": "2026-06-15",
                        "valorEstimado": 185.58,
                        "estado": "pago_2026"
            },
            {
                        "id": "v-61-rn-60",
                        "nome": "RIDE 125 cc",
                        "matricula": "61-RN-60",
                        "categoria": "Motociclo (Cat. E)",
                        "combustivel": "Gasolina",
                        "cilindrada": "125 cc",
                        "emissoes": "-",
                        "mesRegisto": 6,
                        "mesNome": "Junho",
                        "ultimoPagamento": "2026-06-15",
                        "valorEstimado": 0.0,
                        "estado": "pago_2026"
            },
            {
                        "id": "v-21-ag-91",
                        "nome": "OPEL 1.364 cc",
                        "matricula": "21-AG-91",
                        "categoria": "Automóvel Ligeiro (Cat. A)",
                        "combustivel": "Gasolina",
                        "cilindrada": "1.364 cc",
                        "emissoes": "151 g CO2/km",
                        "mesRegisto": 7,
                        "mesNome": "Julho",
                        "ultimoPagamento": "2026-07-31",
                        "valorEstimado": 62.4,
                        "estado": "pago_2026"
            },
            {
                        "id": "v-74-78-ap",
                        "nome": "VOLKSWAGEN 1.391 cc",
                        "matricula": "74-78-AP",
                        "categoria": "Automóvel Ligeiro (Cat. A)",
                        "combustivel": "Gasolina",
                        "cilindrada": "1.391 cc",
                        "emissoes": "-",
                        "mesRegisto": 7,
                        "mesNome": "Julho",
                        "ultimoPagamento": "2026-06-15",
                        "valorEstimado": 34.87,
                        "estado": "pago_2026"
            }
],
        historico_recente: [
            {
                        "data": "2026-07-31",
                        "evento": "IUC - Pagamento Documento Cobrança (Matr. 21-AG-91 • OPEL)",
                        "valor": "62,40 €"
            },
            {
                        "data": "2026-06-15",
                        "evento": "IUC - Pagamento Documento Cobrança (Matr. 84-UZ-80 • OPEL)",
                        "valor": "185,58 €"
            },
            {
                        "data": "2026-06-15",
                        "evento": "IUC - Pagamento Documento Cobrança (Matr. 74-78-AP • VW)",
                        "valor": "34,87 €"
            },
            {
                        "data": "2026-06-15",
                        "evento": "IUC - Pagamento Documento Cobrança (Matr. 61-RN-60 • RIDE)",
                        "valor": "0,00 €"
            },
            {
                        "data": "2026-04-19",
                        "evento": "IUC - Pagamento Documento Cobrança (Matr. AG-14-DP • VORTEX)",
                        "valor": "21,18 €"
            }
]
    },
    irs: {
        previsao_2026: {
            ano: 2026,
            rendimento_global: "20.722,74 €",
            deducao_especifica: "4.462,10 €",
            rendimento_coletavel: "16.260,64 €",
            coleta_bruta: "2.141,22 €",
            retencao_fonte: "221,00 €",
            deducoes_acumuladas: "210,39 €",
            saldo_previsto_a_pagar: "1.709,83 €",
            poupanca_mensal_sugerida: "160,00 €",
            potencial_recuperacao: "250,00 €",
            estado_apuramento: "Em acumulação (167 faturas por classificar)",
            comparativo_2025: "1.920,22 € (poupança de ~210 € já garantida)"
        },
        declaracao_recente: {
            ano: "2025",
            identificacao: "2025-1112-J1131-28",
            tipo: "1.ª D. PRAZO",
            data_rececao: "2026-06-18 16:34:06",
            situacao: "NOTIFICAÇÃO EMITIDA",
            data_situacao: "2026-06-22",
            montante_liquidado: "1.920,22 €",
            numero_liquidacao: "2026 500 5090860"
        },
        rendimento_global_2025: "20.722,74 €",
        coleta_liquida_2025: "2.141,22 €",
        retencao_fonte_2025: "221,00 €"
    },
    efatura_2026: {
        faturas_pendentes_validacao: 167,
        total_deducoes_provisorias: "210,39 €",
        detalhe_setores: {
            despesas_gerais_familiares: { deducao: "195,27 €", gasto: "557,85 €", limite: "250,00 €", percentagem: 78.1 },
            reparacao_automoveis: { deducao: "9,54 €", gasto: "340,27 €", iva: "63,63 €", limite: "250,00 €", percentagem: 3.8 },
            ginasios: { deducao: "4,48 €", gasto: "79,80 €", iva: "14,92 €", limite: "250,00 €", percentagem: 1.8 },
            restauracao_e_alojamento: { deducao: "1,10 €", gasto: "57,66 €", iva: "7,32 €", limite: "250,00 €", percentagem: 0.4 },
            saude: { deducao: "0,00 €", gasto: "0,00 €", limite: "1000,00 €", percentagem: 0.0 },
            educacao: { deducao: "0,00 €", gasto: "0,00 €", limite: "800,00 €", percentagem: 0.0 },
            habitacao: { deducao: "0,00 €", gasto: "0,00 €", limite: "502,00 €", percentagem: 0.0 }
        }
    },
    dividas_e_execucoes: {
        estado: "Situação tributária regularizada (sem processos de execução fiscal nem quantias exequendas)",
        dividas_ativas: 0,
        processos: []
    },
    pagamentos_a_decorrer: {
        estado: "Sem pagamentos a decorrer (0 resultados)",
        itens: []
    },
    cron_5h: {
        ativo: true,
        intervalo: "5 horas",
        ultima_execucao: new Date().toISOString(),
        proxima_execucao: new Date(Date.now() + 5 * 3600 * 1000).toISOString()
    }
};

const EMPTY_STATE = {
    profile: {
        name: "Miguel Angelo Correia Lopes",
        nif: "245804439",
        niss: "",
        activityType: "dependent",
        vatRegime: "exempt",
        directDebitSS: false,
        directDebitAT: false,
        iban: "PT50 0018 0359 0020 0039 2126 7",
        bank: "Banco Santander Totta",
        alertDays: [30, 7, 2, 0]
    },
    status: {
        financas: {
            situation: "regularizada",
            lastSync: new Date().toISOString(),
            certidaoValidaAte: new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0],
            dividasAtivas: 0,
            divergencias: 0
        },
        segurancaSocial: {
            situation: "regularizada",
            lastSync: new Date().toISOString(),
            debitoDiretoAtivo: false,
            ultimoPagamento: null,
            proximoPagamento: null
        }
    },
    atData: DEFAULT_AT_DATA,
    invoices: [],
    calendarState: {},
    vault: {
        hasFinancasCredentials: true,
        hasSSCredentials: false,
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
                const parsed = JSON.parse(raw);
                if (!parsed.atData || !parsed.atData.iuc || !parsed.atData.iuc.veiculos || parsed.atData.iuc.veiculos.length < 4) {
                    parsed.atData = DEFAULT_AT_DATA;
                    this.save(parsed);
                }
                return parsed;
            }
        } catch (e) {
            console.error("Erro ao ler database.json, usando padrão:", e.message);
        }
        this.save(EMPTY_STATE);
        return EMPTY_STATE;
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

    getAtData() {
        this.data = this.load();
        if (!this.data.atData || !this.data.atData.iuc) {
            this.data.atData = DEFAULT_AT_DATA;
            this.save();
        }
        return this.data.atData;
    }

    updateAtData(updates) {
        this.data = this.load();
        this.data.atData = { ...this.data.atData, ...updates };
        if (updates.cron_5h) {
            this.data.atData.cron_5h = { ...this.data.atData.cron_5h, ...updates.cron_5h };
        }
        this.save();
        return this.data.atData;
    }

    /**
     * Motor Dinâmico de Cálculo de IUC:
     * Calcula todos os veículos ordenados DO MAIS PERTO a ter de pagar até ao MAIS LONGE
     */
    getIucStatus() {
        const at = this.getAtData();
        const veiculos = (at.iuc && at.iuc.veiculos && at.iuc.veiculos.length) 
            ? at.iuc.veiculos 
            : DEFAULT_AT_DATA.iuc.veiculos;
        const now = new Date();
        const currentYear = now.getFullYear();

        let candidates = veiculos.map(v => {
            const mes = Number(v.mesRegisto) || 4;
            // No ano corrente
            let deadline = new Date(currentYear, mes, 0); // último dia do mês
            // Se já passou a data ou já foi liquidado no ciclo 2026
            if (deadline < now || v.estado === 'pago_2026') {
                deadline = new Date(currentYear + 1, mes, 0);
            }

            const diffMs = deadline - now;
            const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

            // Ciclo de 365 dias
            const cycleStart = new Date(deadline.getFullYear() - 1, mes, 0);
            const totalCycleDays = (deadline - cycleStart) / (1000 * 60 * 60 * 24);
            const daysPassed = (now - cycleStart) / (1000 * 60 * 60 * 24);
            const progressPercent = Math.min(100, Math.max(0, Math.round((daysPassed / totalCycleDays) * 100)));

            return {
                ...v,
                deadlineDate: deadline.toISOString().split('T')[0],
                deadlineFormatted: `${deadline.getDate()} de ${this.getMonthName(mes)} de ${deadline.getFullYear()}`,
                daysRemaining,
                progressPercent,
                cycleLabel: `${progressPercent}% do ciclo percorrido`
            };
        });

        // ORDENAÇÃO ESTRITA: Do mais perto a pagar até ao mais longe
        candidates.sort((a, b) => a.daysRemaining - b.daysRemaining);

        return {
            proximoIuc: candidates[0],
            todosVeiculos: candidates,
            historico: (at.iuc && at.iuc.historico_recente) || DEFAULT_AT_DATA.iuc.historico_recente,
            estadoGeral: at.iuc ? at.iuc.estado : "Sem veículos com imposto pendente no ano em curso"
        };
    }

    getMonthName(m) {
        const months = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
        return months[m] || `Mês ${m}`;
    }

    updateIucVehicle(id, updates) {
        this.data = this.load();
        if (!this.data.atData) this.data.atData = DEFAULT_AT_DATA;
        if (!this.data.atData.iuc) this.data.atData.iuc = DEFAULT_AT_DATA.iuc;
        if (!this.data.atData.iuc.veiculos) this.data.atData.iuc.veiculos = DEFAULT_AT_DATA.iuc.veiculos;

        const idx = this.data.atData.iuc.veiculos.findIndex(v => v.id === id);
        if (idx >= 0) {
            this.data.atData.iuc.veiculos[idx] = { ...this.data.atData.iuc.veiculos[idx], ...updates };
        } else {
            this.data.atData.iuc.veiculos.push({ id: id || ("v-" + Date.now()), ...updates });
        }
        this.save();
        return this.getIucStatus();
    }

    getInvoices() {
        this.data = this.load();
        return this.data.invoices || [];
    }

    addInvoice(invoice) {
        this.data = this.load();
        const baseAmount = Number(invoice.baseAmount) || Number(invoice.total) || 0;
        const vatAmount = Number(invoice.vatAmount) || 0;
        const total = Number(invoice.total) || (baseAmount + vatAmount);

        const newInv = {
            id: invoice.id || ("inv-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5)),
            date: invoice.date || new Date().toISOString().split('T')[0],
            entity: invoice.entity || invoice.supplierName || 'Entidade',
            supplierName: invoice.supplierName || invoice.entity || 'Entidade',
            supplierNif: invoice.supplierNif || invoice.nif || '',
            baseAmount,
            vatRate: Number(invoice.vatRate) || 0.23,
            vatAmount,
            total,
            type: invoice.type || 'expense',
            efaturaStatus: invoice.type === 'expense' ? (invoice.efaturaStatus || 'pending') : undefined,
            suggestedCategory: invoice.type === 'expense' ? (invoice.suggestedCategory || predictCategory(invoice.supplierName || invoice.entity, invoice.supplierNif)) : undefined,
            category: invoice.category || null,
            ...invoice
        };

        if (!this.data.invoices) this.data.invoices = [];
        const exists = this.data.invoices.some(i => 
            (i.id === newInv.id) ||
            (i.supplierNif && i.supplierNif === newInv.supplierNif && i.date === newInv.date && Math.abs((i.total || 0) - newInv.total) < 0.01)
        );

        if (!exists) {
            this.data.invoices.unshift(newInv);
            this.save();
        }
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
        if (this.data.invoices) {
            this.data.invoices.forEach(inv => {
                if (inv.type === 'expense' && inv.efaturaStatus === 'pending') {
                    inv.category = inv.suggestedCategory || predictCategory(inv.supplierName, inv.supplierNif);
                    inv.efaturaStatus = 'validated';
                    count++;
                }
            });
        }
        if (this.data.atData && this.data.atData.efatura_2026) {
            this.data.atData.efatura_2026.faturas_pendentes_validacao = 0;
        }
        if (this.data.atData && this.data.atData.resumo_geral) {
            this.data.atData.resumo_geral.faturas_pendentes_validacao = 0;
        }
        this.save();
        return count;
    }

    getCalendar() {
        this.data = this.load();
        const profileWithVehicles = { ...this.data.profile, veiculos: (this.data.atData && this.data.atData.iuc && this.data.atData.iuc.veiculos) || [] };
        const fiscalList = getFiscalCalendar(new Date().getFullYear(), profileWithVehicles);
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
