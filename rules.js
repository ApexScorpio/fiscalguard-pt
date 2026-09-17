/**
 * Motor de Regras e Calendário Fiscal Português (AT e Segurança Social)
 */

// Categorias oficiais de dedução no e-fatura (IRS Artigo 78.º e seguintes)
const EFATURA_CATEGORIES = {
    GERAL: { id: "geral", name: "Despesas Gerais Familiares", deductionRate: 0.35, maxLimit: 250, icon: "🛒" },
    SAUDE: { id: "saude", name: "Saúde", deductionRate: 0.15, maxLimit: 1000, icon: "💊" },
    EDUCACAO: { id: "educacao", name: "Educação e Formação", deductionRate: 0.30, maxLimit: 800, icon: "🎓" },
    IMOVEIS: { id: "imoveis", name: "Habitação / Imóveis", deductionRate: 0.15, maxLimit: 600, icon: "🏠" },
    LARES: { id: "lares", name: "Lares e Apoio Domiciliário", deductionRate: 0.25, maxLimit: 403.75, icon: "👵" },
    RESTAURACAO: { id: "restauracao", name: "Restauração e Alojamento (15% IVA)", deductionRate: 0.15, maxLimit: 250, icon: "🍽️" },
    REPARACAO_AUTO: { id: "reparacao_auto", name: "Oficinas e Peças Auto (15% IVA)", deductionRate: 0.15, maxLimit: 250, icon: "🔧" },
    CABELEIREIROS: { id: "cabeleireiros", name: "Cabeleireiros e Estética (15% IVA)", deductionRate: 0.15, maxLimit: 250, icon: "✂️" },
    PASSES: { id: "passes", name: "Passes e Transportes Públicos (100% IVA)", deductionRate: 1.00, maxLimit: 250, icon: "🚌" },
    VETERINARIOS: { id: "veterinarios", name: "Despesas Veterinárias (15% IVA)", deductionRate: 0.15, maxLimit: 250, icon: "🐾" },
    GINASIOS: { id: "ginasios", name: "Atividades Desportivas / Ginásios (30% IVA)", deductionRate: 0.30, maxLimit: 250, icon: "🏋️" },
    ATIVIDADE: { id: "atividade", name: "Afeto à Atividade Profissional (Dedução Integral)", deductionRate: 1.00, maxLimit: null, icon: "💼" }
};

// Base de conhecimento para classificação automática inteligente de NIFs/Fornecedores comuns em Portugal
const SMART_CLASSIFIERS = [
    { pattern: /(continente|pingo doce|auchan|intermarch|lidl|mercadona|aldi|el corte ingl|mini pre)/i, category: "geral" },
    { pattern: /(farm|farm[aá]cia|cuf|lusiadas|lus[ií]adas|hospital|trofa saude|reditus|dentist|multiópticas|wells|optica)/i, category: "saude" },
    { pattern: /(escola|universidade|faculdade|colegio|col[eé]gio|bertrand|fnac|leya|ensino|creche)/i, category: "educacao" },
    { pattern: /(restaurante|pizzaria|burger|mcdonald|kfc|h3|tasca|cafetaria|pastelaria|padaria|hotel|airbnb|booking)/i, category: "restauracao" },
    { pattern: /(norauto|mForce|midas|oficina|reparaç|pneus|feu vert|bosch car)/i, category: "reparacao_auto" },
    { pattern: /(cabeleireir|barbearia|barber|estetica|spa|manicure)/i, category: "cabeleireiros" },
    { pattern: /(metropolitano|carris|cp - comboios|carris metropolitana|metro do porto|stcp|tst|fertagus|navegante)/i, category: "passes" },
    { pattern: /(veterin|vet |animais|pet shop|cl[ií]nica vet)/i, category: "veterinarios" },
    { pattern: /(solinca|fitness hut|element|gym|gin[aá]sio|crossfit)/i, category: "ginasios" },
    { pattern: /(repsol|galp|bp |cepsa|prio|combust|posto|via verde)/i, category: "atividade" },
    { pattern: /(edp|galp energia|endesa|goldenergy|vodafone|meo|nos comunica|altice|epal|aguas)/i, category: "atividade" },
    { pattern: /(aws|amazon web|google cloud|microsoft|hetzner|digitalocean|jetbrains|github|slack|zoom)/i, category: "atividade" }
];

/**
 * Classifica automaticamente uma fatura com base no nome do fornecedor ou NIF
 */
function predictCategory(supplierName, supplierNif) {
    if (!supplierName) return "geral";
    for (const rule of SMART_CLASSIFIERS) {
        if (rule.pattern.test(supplierName)) {
            return rule.category;
        }
    }
    return "geral";
}

/**
 * Gera as obrigações fiscais e contributivas do ano com prazos oficiais
 */
function getFiscalCalendar(year = new Date().getFullYear()) {
    return [
        {
            id: "efatura_validacao",
            title: "Validação de Faturas no e-fatura",
            entity: "Autoridade Tributária",
            type: "IRS / e-fatura",
            description: "Data limite para associar o setor de atividade a todas as faturas pendentes do ano anterior.",
            deadline: `${year}-02-25`,
            frequency: "Anual",
            urgency: "alta",
            actionUrl: "https://faturas.portaldasfinancas.gov.pt/",
            penaltyWarning: "A não validação impede a dedução das despesas no IRS (até 250€ em despesas gerais, 1000€ em saúde, etc.)."
        },
        {
            id: "irs_modelo3",
            title: "Entrega do IRS (Modelo 3)",
            entity: "Autoridade Tributária",
            type: "IRS",
            description: "Submissão da declaração anual de rendimentos (Trabalho Dependente, Recibos Verdes, Capitais, Prediais).",
            deadline: `${year}-06-30`,
            startDate: `${year}-04-01`,
            frequency: "Anual",
            urgency: "media",
            actionUrl: "https://irs.portaldasfinancas.gov.pt/",
            penaltyWarning: "Coima por entrega fora de prazo varia entre 150€ e 3.750€."
        },
        {
            id: "ss_declaracao_t1",
            title: "Declaração Trimestral Segurança Social (1.º Trimestre)",
            entity: "Segurança Social Direta",
            type: "Segurança Social",
            description: "Registo dos rendimentos recebidos em Janeiro, Fevereiro e Março. Fixa as contribuições de Maio, Junho e Julho.",
            deadline: `${year}-04-30`,
            startDate: `${year}-04-01`,
            frequency: "Trimestral",
            urgency: "alta",
            actionUrl: "https://app.seg-social.pt/",
            penaltyWarning: "Falta de declaração sujeita a contribuição mínima oficiosa e coimas de 50€ a 500€."
        },
        {
            id: "ss_declaracao_t2",
            title: "Declaração Trimestral Segurança Social (2.º Trimestre)",
            entity: "Segurança Social Direta",
            type: "Segurança Social",
            description: "Registo dos rendimentos recebidos em Abril, Maio e Junho. Fixa as contribuições de Agosto, Setembro e Outubro.",
            deadline: `${year}-07-31`,
            startDate: `${year}-07-01`,
            frequency: "Trimestral",
            urgency: "alta",
            actionUrl: "https://app.seg-social.pt/",
            penaltyWarning: "Falta de declaração sujeita a contribuição mínima oficiosa e coimas de 50€ a 500€."
        },
        {
            id: "ss_declaracao_t3",
            title: "Declaração Trimestral Segurança Social (3.º Trimestre)",
            entity: "Segurança Social Direta",
            type: "Segurança Social",
            description: "Registo dos rendimentos recebidos em Julho, Agosto e Setembro. Fixa as contribuições de Novembro, Dezembro e Janeiro.",
            deadline: `${year}-10-31`,
            startDate: `${year}-10-01`,
            frequency: "Trimestral",
            urgency: "alta",
            actionUrl: "https://app.seg-social.pt/",
            penaltyWarning: "Falta de declaração sujeita a contribuição mínima oficiosa e coimas de 50€ a 500€."
        },
        {
            id: "ss_declaracao_t4",
            title: "Declaração Trimestral Segurança Social (4.º Trimestre)",
            entity: "Segurança Social Direta",
            type: "Segurança Social",
            description: "Registo dos rendimentos recebidos em Outubro, Novembro e Dezembro. Fixa as contribuições de Fevereiro, Março e Abril.",
            deadline: `${year + 1}-01-31`,
            startDate: `${year + 1}-01-01`,
            frequency: "Trimestral",
            urgency: "alta",
            actionUrl: "https://app.seg-social.pt/",
            penaltyWarning: "Falta de declaração sujeita a contribuição mínima oficiosa e coimas de 50€ a 500€."
        },
        {
            id: "ss_pagamento_mensal",
            title: "Pagamento Mensal de Contribuições à Segurança Social",
            entity: "Segurança Social",
            type: "Segurança Social",
            description: "Pagamento da contribuição mensal dos Trabalhadores Independentes relativa ao mês anterior (entre dia 10 e dia 20).",
            deadline: getNextSSPaymentDate(),
            frequency: "Mensal",
            urgency: "critica",
            actionUrl: "https://app.seg-social.pt/",
            paymentDetails: {
                entidade: "12244",
                referencia: "512 849 392",
                nota: "Referência Multibanco Segurança Social"
            },
            penaltyWarning: "Juros de mora diários e perda do direito a certidão de situação contributiva regularizada."
        },
        {
            id: "iva_declaracao_t3",
            title: "Declaração Periódica do IVA (3.º Trimestre)",
            entity: "Autoridade Tributária",
            type: "IVA",
            description: "Submissão da declaração periódica e apuramento do IVA a entregar referente ao trimestre anterior.",
            deadline: `${year}-11-20`,
            paymentDeadline: `${year}-11-25`,
            frequency: "Trimestral",
            urgency: "alta",
            actionUrl: "https://iva.portaldasfinancas.gov.pt/",
            penaltyWarning: "Coimas entre 150€ e 3.750€ por atraso e juros de mora compensatórios."
        },
        {
            id: "imi_prestacao_1",
            title: "Pagamento do IMI (1.ª Prestação ou Pagamento Total)",
            entity: "Autoridade Tributária",
            type: "IMI",
            description: "Pagamento do Imposto Municipal sobre Imóveis (se superior a 100€ pode ser dividido).",
            deadline: `${year}-05-31`,
            frequency: "Anual / Parcelado",
            urgency: "media",
            actionUrl: "https://imoveis.portaldasfinancas.gov.pt/"
        },
        {
            id: "iuc_veiculo",
            title: "Pagamento do IUC (Imposto Único de Circulação)",
            entity: "Autoridade Tributária",
            type: "IUC",
            description: "Pagamento do selo do automóvel no mês da matrícula da viatura.",
            deadline: getIucDeadline(),
            frequency: "Anual",
            urgency: "media",
            actionUrl: "https://iuc.portaldasfinancas.gov.pt/"
        }
    ];
}

function getNextSSPaymentDate() {
    const today = new Date();
    let targetMonth = today.getMonth();
    let targetYear = today.getFullYear();
    
    if (today.getDate() > 20) {
        targetMonth += 1;
        if (targetMonth > 11) {
            targetMonth = 0;
            targetYear += 1;
        }
    }
    
    const d = new Date(targetYear, targetMonth, 20);
    return d.toISOString().split('T')[0];
}

function getIucDeadline() {
    const today = new Date();
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return lastDayOfMonth.toISOString().split('T')[0];
}

function calculateNetIncome(grossAmount, options = {}) {
    const {
        vatRate = 0.23,
        vatExemptReason = "none", // "none", "art53", "art9", "reverse_charge"
        ssMode = "services", // "services" (70%), "sales" (20%), "exempt_tco" (0%), "custom"
        customSSRate = 0,
        irsRetentionRate = 0.25,
        estimatedIRSFinalRate = 0.20
    } = options;

    const baseAmount = Number(grossAmount) || 0;
    const isVatExempt = vatExemptReason !== "none" || vatRate === 0;
    const effectiveVatRate = isVatExempt ? 0 : Number(vatRate) || 0;
    const vatAmount = Math.round(baseAmount * effectiveVatRate * 100) / 100;
    const totalWithVat = baseAmount + vatAmount;

    // Retenção na fonte de IRS
    const irsWithheld = Math.round(baseAmount * (Number(irsRetentionRate) || 0) * 100) / 100;

    // Segurança Social
    let ssReserve = 0;
    let ssEffectivePercent = 0;
    if (ssMode === "services") {
        // 70% de rendimento relevante * 21,4% taxa
        ssReserve = Math.round(baseAmount * 0.70 * 0.214 * 100) / 100;
        ssEffectivePercent = 14.98;
    } else if (ssMode === "sales") {
        // 20% de rendimento relevante * 21,4% taxa
        ssReserve = Math.round(baseAmount * 0.20 * 0.214 * 100) / 100;
        ssEffectivePercent = 4.28;
    } else if (ssMode === "exempt_tco") {
        // Isento por acumulação com TCO (Trabalhador por Conta de Outrem)
        ssReserve = 0;
        ssEffectivePercent = 0;
    } else if (ssMode === "custom") {
        ssReserve = Math.round(baseAmount * (Number(customSSRate) || 0) * 100) / 100;
        ssEffectivePercent = Math.round((Number(customSSRate) || 0) * 10000) / 100;
    }

    // Provisão de IRS (Regime Simplificado: 75% coef. serviços ou 15% mercadorias)
    const coefficient = (ssMode === "sales") ? 0.15 : 0.75;
    const taxableIRSIngress = baseAmount * coefficient;
    const estimatedTotalIRSLiability = Math.round(taxableIRSIngress * estimatedIRSFinalRate * 100) / 100;
    const irsReserve = Math.max(irsWithheld, estimatedTotalIRSLiability);

    // Dinheiro líquido real disponível no bolso:
    // Dinheiro em mão imediato = baseAmount - retenção (se retido na fonte)
    // Líquido livre de todas as obrigações:
    const netTakeHome = Math.max(0, Math.round((baseAmount - ssReserve - (irsReserve - irsWithheld)) * 100) / 100);

    return {
        grossAmount: baseAmount,
        totalWithVat,
        effectiveVatRate,
        vatAmount,
        isVatExempt,
        vatExemptReason,
        ssMode,
        ssEffectivePercent,
        ssReserve,
        irsRetentionRate,
        irsWithheld,
        irsReserve,
        netTakeHome,
        breakdownPercentages: {
            vat: Math.round((vatAmount / (totalWithVat || 1)) * 100),
            ss: Math.round((ssReserve / (baseAmount || 1)) * 100),
            irs: Math.round((irsReserve / (baseAmount || 1)) * 100),
            net: Math.round((netTakeHome / (baseAmount || 1)) * 100)
        }
    };
}

function simulateSSTrimestral(qGrossIncome, variationPercent = 0) {
    const totalQ = Number(qGrossIncome) || 0;
    const relevantIncome = totalQ * 0.70;
    const monthlyBaseAverage = relevantIncome / 3;
    const variationFactor = 1 + (variationPercent / 100);
    const adjustedMonthlyBase = monthlyBaseAverage * variationFactor;
    const monthlyContribution = Math.max(20, Math.round(adjustedMonthlyBase * 0.214 * 100) / 100);
    const totalQuarterPayment = monthlyContribution * 3;

    return {
        qGrossIncome: totalQ,
        relevantIncome,
        monthlyBaseAverage: Math.round(monthlyBaseAverage * 100) / 100,
        variationPercent,
        adjustedMonthlyBase: Math.round(adjustedMonthlyBase * 100) / 100,
        monthlyContribution,
        totalQuarterPayment,
        explanation: variationPercent < 0 
            ? `Ao reduzir ${Math.abs(variationPercent)}%, pagarás menos ${Math.round((monthlyBaseAverage * 0.214 - monthlyContribution)*100)/100}€/mês, mas o teu valor de proteção social (baixas médicas, parentalidade e reforma futura) será menor.`
            : variationPercent > 0
            ? `Ao aumentar +${variationPercent}%, reforças a tua base de incidência para baixas e reforma futura, com um custo adicional de +${Math.round((monthlyContribution - monthlyBaseAverage * 0.214)*100)/100}€/mês.`
            : "Valor padrão sem ajuste (-0%): contribuição correspondente exatamente à média da faturação trimestral."
    };
}

module.exports = {
    EFATURA_CATEGORIES,
    SMART_CLASSIFIERS,
    predictCategory,
    getFiscalCalendar,
    calculateNetIncome,
    simulateSSTrimestral
};
