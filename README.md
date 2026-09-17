# 🛡️ FiscalGuard PT — Contabilista & Sentinela Pessoal

> **Assistente Inteligente de Fiscalidade & Segurança Social Portuguesa para PC e Portátil**  
> Monitorização contínua de Finanças (AT), Segurança Social Direta (SSD), e-fatura, cálculo de lucro líquido real e alertas automáticos nativos no Windows.

[![Node.js](https://img.shields.io/badge/Node.js-24.x-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Web-blueviolet.svg)](#)
[![Multi-Device](https://img.shields.io/badge/Sync-PC%20%E2%86%94%20Port%C3%A1til-emerald.svg)](#)

---

## 🚀 Principais Funcionalidades

### 1. 🚦 Semáforo Fiscal & Contributivo em Tempo Real
- **Autoridade Tributária (AT)**: Estado da situação tributária (regularizada vs. dívidas ativas), validade da certidão de não dívida e divergências.
- **Segurança Social Direta (SSD)**: Estado da conta corrente contributiva, situação de pagamentos e verificação do Débito Direto ativo.

### 2. ⚡ Automação 100% Desatendida (Background)
- Monitorização periódica em segundo plano de prazos, guias de pagamento e novas faturas.
- Verificação do dia limite de pagamento das contribuições (dia 20) com emissão dos dados Multibanco (Entidade e Referência) para pagamento imediato.

### 3. 🔄 Sincronização Multi-Dispositivo (PC ↔ Portátil)
- **Emparelhamento com 1-Clique**: Código seguro de emparelhamento (`FG-XXXXXX`) para ligar o computador de secretária ao portátil.
- **Sincronização em Nuvem / Pasta Partilhada**: Suporte nativo a cofre partilhado encriptado (`S:\FiscalGuard-Sync` ou OneDrive), permitindo trabalhar no PC ou no portátil com total paridade de dados.

### 4. 🧾 Central e-fatura com Auto-Classificação Inteligente (1-Clique)
- Deteta faturas que se encontram pendentes de associação de setor no portal das Finanças.
- Analisa o fornecedor e o CAE para sugerir e validar categorias com 1 clique (Saúde, Educação, Imóveis, Restauração 15%, Despesas Gerais e Atividade Profissional).

### 5. 💰 Simulador "Lucro Real no Bolso" ("O Teu Contabilista")
- Diz-te com precisão cirúrgica quanto podes gastar de cada fatura que emites:
  - 🏛️ **Reserva de IVA** (23% a entregar ao Estado);
  - 🛡️ **Segurança Social** (21,4% sobre 70% da prestação de serviços);
  - 📑 **Provisão de IRS** (para evitar surpresas no acerto de Abril/Junho);
  - 💰 **Dinheiro Limpo e Livre no Bolso**.

### 6. 📐 Gestor e Simulador da Declaração Trimestral da SS
- Calcula a base de incidência trimestral e permite testar a variação legal de **-25% a +25%**.
- Explica o impacto exato em euros de pagar menos agora vs. ter mais proteção social no futuro (baixas médicas, parentalidade e reforma).

### 7. 🔔 Sentinela de Prazos & Notificações Nativas do Windows
- Disparo automático de notificações Windows Toast (e balões nativos):
  - 30 dias antes (planeamento de tesouraria);
  - 7 dias antes (lembrete operacional);
  - 48 horas antes (alerta urgente);
  - No próprio dia (alerta crítico).

### 8. 🤖 Assistente Fiscal IA Integrado
- Respostas rápidas em português de Portugal sobre o Código do IRS, CIVA, regras de dedução de viaturas e combustíveis, limites do Artigo 53.º e acumulação de trabalho dependente com recibos verdes.

---

## 📂 Estrutura do Projeto

```
S:\fiscalguard-pt\
├── data\                   # Base de dados local e cofre de sincronização (JSON)
├── public\                 # Frontend moderno (HTML5, CSS3 Glassmorphism, JS)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── assistant.js            # Base de conhecimento fiscal e motor de IA
├── db.js                   # Módulo de persistência local atómica
├── notifier.js             # Gestor de alertas e limiares de prazos
├── notify.ps1              # Script PowerShell para Windows Toast Notifications
├── rules.js                # Motor de regras tributárias e contributivas portuguesas
├── server.js               # Servidor Express & API REST
├── sync-relay.js           # Motor de sincronização PC ↔ Portátil
├── sync.js                 # Conector de sincronização automática com portais
├── start.bat               # Lançador Windows 1-Clique
└── package.json
```

---

## 🛠️ Instalação e Execução

### Pré-requisitos
- Node.js 18+ instalado
- PowerShell (já incluído no Windows 10/11)

### Passo 1: Instalar dependências
```bash
npm install
```

### Passo 2: Iniciar a aplicação
```bash
# Via terminal:
npm start

# Ou simplesmente dar duplo clique em:
start.bat
```

A aplicação abre automaticamente no navegador em:  
👉 **`http://localhost:4848`**

---

## 💻 Como Sincronizar o Portátil com o PC

1. No **PC Principal**, copia o repositório ou pasta para o teu **Portátil** (ou clona através do GitHub: `git clone https://github.com/ApexScorpio/fiscalguard-pt.git`).
2. Abre a app em ambos os computadores.
3. No separador **"Sincronização PC / Portátil"**:
   - Vê o código de emparelhamento no PC (ex: `FG-849201`);
   - Introduz esse código no portátil e clica em **Emparelhar**.
4. Ambos os dispositivos ficam ligados e sincronizam automaticamente faturas, despesas e alertas!

---

## 🔒 Segurança & Privacidade
- Todo o armazenamento é **100% local** no disco `S:\` (sem qualquer dependência do disco `C:\`).
- Nenhum dado fiscal ou credencial é transmitido para servidores de terceiros.
- A sincronização entre dispositivos é cifrada ponta-a-ponta (E2EE) com chave local AES.

---

## 📄 Licença
Distribuído sob a licença MIT. Desenvolvido por **ApexScorpio**.
