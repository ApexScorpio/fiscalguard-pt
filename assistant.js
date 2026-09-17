const KNOWLEDGE_BASE = [
    {
        keywords: ["artigo 53", "isencao de iva", "isenção de iva", "limite iva", "15000", "15 000"],
        title: "Isenção de IVA (Artigo 53.º do Código do IVA)",
        answer: "Em Portugal, podes beneficiar da isenção de IVA ao abrigo do Artigo 53.º do CIVA se:\n1. Não tiveres nem fores obrigado a ter contabilidade organizada;\n2. Não praticares operações de importação/exportação;\n3. O teu volume de negócios anual não ultrapassar **15.000 €**.\n\n*Atenção:* Se ultrapassares o limite durante o ano, tens de submeter uma declaração de alterações em Janeiro do ano seguinte e passar a cobrar IVA (habitualmente 23%) a partir de Fevereiro."
    },
    {
        keywords: ["declaracao trimestral", "declaração trimestral", "seguranca social", "segurança social", "variacao 25", "variação"],
        title: "Declaração Trimestral da Segurança Social",
        answer: "A Declaração Trimestral é obrigatória para Trabalhadores Independentes nos meses de **Janeiro, Abril, Julho e Outubro** (até ao último dia do mês):\n- Declaram-se os rendimentos ilíquidos faturados nos 3 meses anteriores;\n- O rendimento relevante calculado é de **70%** (prestação de serviços) ou **20%** (venda de mercadorias);\n- Podes escolher variar a base mensal calculada entre **-25% e +25%** (em intervalos de 5%);\n- A contribuição mínima é de 20€/mês mesmo que não tenhas tido rendimentos."
    },
    {
        keywords: ["quando pagar", "dia 20", "pagamento seguranca social", "pagar ss", "prazo ss"],
        title: "Prazo de Pagamento da Segurança Social",
        answer: "As contribuições mensais de Trabalhadores Independentes devem ser pagas **entre o dia 10 e o dia 20 de cada mês**, relativamente ao mês anterior.\n\n*Recomendação:* Ativa o Débito Direto na Segurança Social Direta para nunca falhares o dia 20 e evitar juros de mora ou perda de certidão de não dívida."
    },
    {
        keywords: ["combustivel", "combustível", "gasoleo", "gasolina", "despesas de viatura", "carro"],
        title: "Dedução de Despesas de Combustível e Viatura",
        answer: "No **Regime Simplificado** de IRS:\n- O Estado assume automaticamente que 25% do teu rendimento bruto corresponde a despesas da atividade, pelo que só 75% é tributado em IRS;\n- No entanto, tens de justificar 15% dessas despesas no e-fatura como afetas à atividade profissional;\n- O IVA de gasolina não é dedutível; o IVA de gasóleo só é dedutível em 50% (ou 100% se for veículo de mercadorias afeto a 100% à atividade)."
    },
    {
        keywords: ["retencao na fonte", "retenção na fonte", "recibos verdes", "25%"],
        title: "Retenção na Fonte de IRS em Recibos Verdes",
        answer: "Quando emites uma fatura a uma entidade coletiva (empresa) com contabilidade organizada, é aplicada uma retenção na fonte de IRS à taxa padrão de **25%** (art. 101.º do CIRS).\n\n*Nota importante:* Se faturaste menos de 15.000€ e estás no primeiro ano de atividade ou optares por dispensa de retenção (art. 101.º-B), podes não reter, mas lembra-te: o imposto terá de ser pago na totalidade quando entregares o IRS em Abril/Maio!"
    },
    {
        keywords: ["e-fatura", "validar faturas", "25 de fevereiro", "deducoes irs"],
        title: "Validação no e-fatura e Deduções à Coleta",
        answer: "Tens até ao dia **25 de Fevereiro** de cada ano para validar e classificar todas as faturas do ano anterior no portal e-fatura:\n- Despesas Gerais Familiares: 35% do valor até ao máximo de 250€ por sujeito passivo;\n- Saúde: 15% até 1.000€;\n- Educação: 30% até 800€;\n- Habitação: 15% até 600€ (rendas ou juros de contratos antigos);\n- Restauração, Cabeleireiros, Reparação Auto: benefício de 15% do IVA suportado até 250€;\n- Passes Sociais: 100% do IVA suportado."
    },
    {
        keywords: ["tco", "conta de outrem", "acumulacao", "acumulação", "trabalho dependente"],
        title: "Acumulação de Conta de Outrem com Recibos Verdes",
        answer: "Se trabalhas por conta de outrem (TCO) com contrato e passas recibos verdes em paralelo:\n1. **Segurança Social:** Podes ficar isento de pagar contribuições de Trabalhador Independente se o teu salário por conta de outrem for igual ou superior a 1 IAS (em 2026 ~520€) e os rendimentos independentes não forem prestados à mesma entidade empregadora;\n2. **IRS:** Os rendimentos da Categoria A (salários) e Categoria B (recibos verdes) englobam-se no apuramento anual do IRS."
    }
];

function answerQuestion(query) {
    const cleanQuery = query.toLowerCase();
    
    for (const item of KNOWLEDGE_BASE) {
        if (item.keywords.some(kw => cleanQuery.includes(kw))) {
            return {
                found: true,
                title: item.title,
                answer: item.answer
            };
        }
    }

    return {
        found: false,
        title: "Orientação Fiscal Personalizada",
        answer: `Como teu assistente fiscal e contabilista pessoal, analisei a tua questão sobre "${query}".\n\nNo sistema tributário português, todas as movimentações de prestação de serviços ou vendas devem ser comunicadas à AT via e-fatura e integradas nas declarações periódicas (IVA e SS). Podes verificar as tuas faturas pendentes no separador "e-fatura" e simular o impacto no teu rendimento líquido no "Simulador de Lucro Real". Se quiseres, pergunta-me especificamente sobre "Isenção de IVA", "Declaração Trimestral SS", "Dedução de Combustível" ou "Prazos de Pagamento".`
    };
}

module.exports = {
    answerQuestion,
    KNOWLEDGE_BASE
};
