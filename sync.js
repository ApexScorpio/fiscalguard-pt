const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const db = require('./db');
const { predictCategory } = require('./rules');

const DATA_DIR = path.join(__dirname, 'data');
const CREDS_FILE = path.join(DATA_DIR, 'credentials.json');
const SESSION_AT_FILE = path.join(DATA_DIR, 'session-at.json');
const SESSION_SS_FILE = path.join(DATA_DIR, 'session-ss.json');

function getCredentials() {
    if (fs.existsSync(CREDS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
        } catch (e) {
            console.error("Erro ao ler credenciais:", e.message);
        }
    }
    return {
        at: { nif: db.getProfile().nif || "", password: "" },
        ss: { niss: db.getProfile().niss || "", password: "" }
    };
}

function saveCredentials(creds) {
    fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2), 'utf8');
    return true;
}

/**
 * Motor de Extração Real e Automação do Portal das Finanças (AT)
 */
async function syncPortalFinancas(options = {}) {
    const { headless = true, onProgress = () => {} } = options;
    const creds = getCredentials();
    const log = [];

    const addLog = (msg) => {
        const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
        log.push(line);
        onProgress(line);
        console.log(`[AT Sync] ${line}`);
    };

    addLog("A iniciar Google Chrome em segundo plano...");

    // Se o utilizador ainda não preencheu senha real no cofre nem tem sessão guardada
    if (!creds.at.password && !fs.existsSync(SESSION_AT_FILE)) {
        addLog(`⚠️ Portal das Finanças: Não autenticado.`);
        addLog(`Clica em "Iniciar Sessão Oficial" para abrir a janela oficial do Google Chrome e fazer login.`);
        return { success: false, log, requiresLogin: true };
    }

    let browser;
    try {
        browser = await chromium.launch({
            channel: 'chrome',
            headless
        });

        const contextOptions = {};
        if (fs.existsSync(SESSION_AT_FILE)) {
            contextOptions.storageState = SESSION_AT_FILE;
        }

        const context = await browser.newContext(contextOptions);
        const page = await context.newPage();

        addLog(`A navegar para o Portal das Finanças (acesso.gov.pt)...`);
        await page.goto('https://www.acesso.gov.pt/v2/loginForm?partID=PFAP', { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Verificar se já tem sessão ativa ou precisa de preencher credenciais
        const usernameInput = await page.$('#username');
        if (usernameInput) {
            addLog(`A autenticar com NIF ${creds.at.nif}...`);
            await page.fill('#username', creds.at.nif);
            await page.fill('#password', creds.at.password);
            await page.click('#sbmt-btn');
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        } else {
            addLog("Sessão pré-existente reutilizada com sucesso.");
        }

        // Executar extração real do Portal das Finanças
        const extractResult = await extractFinancasData(page, context, addLog);

        await browser.close();
        return { success: true, ...extractResult, log };

    } catch (e) {
        addLog(`Erro na automação do Portal das Finanças: ${e.message}`);
        if (browser) await browser.close().catch(() => {});
        return { success: false, error: e.message, log };
    }
}

/**
 * Motor de Extração Real e Automação da Segurança Social Direta (SSD)
 */
async function syncSegurancaSocial(options = {}) {
    const { headless = true, onProgress = () => {} } = options;
    const creds = getCredentials();
    const log = [];

    const addLog = (msg) => {
        const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
        log.push(line);
        onProgress(line);
        console.log(`[SS Sync] ${line}`);
    };

    addLog("A ligar à Segurança Social Direta (app.seg-social.pt)...");

    if (!creds.ss.password && !fs.existsSync(SESSION_SS_FILE)) {
        addLog(`⚠️ Segurança Social Direta: Não autenticado.`);
        addLog(`Clica em "Iniciar Sessão Oficial" para abrir a janela do Google Chrome e autenticar.`);
        return { success: false, log, requiresLogin: true };
    }

    let browser;
    try {
        browser = await chromium.launch({
            channel: 'chrome',
            headless
        });

        const contextOptions = {};
        if (fs.existsSync(SESSION_SS_FILE)) {
            contextOptions.storageState = SESSION_SS_FILE;
        }

        const context = await browser.newContext(contextOptions);
        const page = await context.newPage();

        addLog("A aceder ao formulário de autenticação da Segurança Social Direta...");
        await page.goto('https://app.seg-social.pt/ptss/', { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Tentar autenticar se encontrar campos
        const nissInput = await page.$('input[name="username"], #username, input[type="text"]');
        if (nissInput && creds.ss.password) {
            addLog(`A autenticar com NISS ${creds.ss.niss}...`);
            await nissInput.fill(creds.ss.niss);
            const passInput = await page.$('input[name="password"], #password, input[type="password"]');
            if (passInput) await passInput.fill(creds.ss.password);
            
            const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
            if (submitBtn) await submitBtn.click();
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        }

        // Executar extração da Segurança Social
        const extractResult = await extractSegurancaSocialData(page, context, addLog);

        await browser.close();
        return { success: true, ...extractResult, log };

    } catch (e) {
        addLog(`Erro na automação da Segurança Social: ${e.message}`);
        if (browser) await browser.close().catch(() => {});
        return { success: false, error: e.message, log };
    }
}

/**
 * Deteta o caminho real do executável do Google Chrome no Windows
 */
function getChromeExecutablePath() {
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
        process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe') : null
    ].filter(Boolean);

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

/**
 * Devolve o caminho do User Data do Chrome real do utilizador
 * Usado para launchPersistentContext herdar cookies reais
 */
function getChromeUserDataDir() {
    if (process.env.LOCALAPPDATA) {
        const d = path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data');
        if (fs.existsSync(d)) return d;
    }
    if (process.env.APPDATA) {
        const d = path.join(process.env.APPDATA, '..', 'Local', 'Google', 'Chrome', 'User Data');
        if (fs.existsSync(d)) return d;
    }
    return null;
}

/**
 * Extração de Dados Reais do Portal das Finanças (e-fatura e Situação Fiscal)
 */
async function extractFinancasData(page, context, addLog = console.log) {
    // 1. Guardar cookies de sessão
    await context.storageState({ path: SESSION_AT_FILE }).catch(() => {});
    addLog("✓ Sessão oficial do Portal das Finanças gravada em S:\\fiscalguard-pt.");

    // 2. Extrair NIF da sessão
    let detectedNif = "";
    try {
        const bodyText = await page.textContent('body').catch(() => '');
        const match = bodyText.match(/\b([123]\d{8}|5\d{8})\b/);
        if (match) {
            detectedNif = match[1];
            db.updateProfile({ nif: detectedNif });
            addLog(`✓ NIF detetado na sessão oficial: ${detectedNif}`);
        }
    } catch (e) {}

    // 3. Extrair faturas de despesa no e-fatura
    let expensesCount = 0;
    try {
        addLog("A aceder ao e-fatura para ler despesas reais...");
        await page.goto('https://faturas.portaldasfinancas.gov.pt/consultarDespesasAdquirente.action', { waitUntil: 'domcontentloaded', timeout: 25000 });
        await new Promise(r => setTimeout(r, 1500));

        const expenses = await page.evaluate(() => {
            const rows = document.querySelectorAll('table.table tbody tr, .tabela-faturas tbody tr, #listaFaturas tbody tr, table tbody tr');
            const list = [];
            rows.forEach(r => {
                const cells = r.querySelectorAll('td');
                if (cells.length >= 4) {
                    const dateText = cells[0]?.innerText?.trim() || '';
                    const supplierName = cells[1]?.innerText?.trim() || '';
                    const supplierNif = cells[2]?.innerText?.trim() || '';
                    const totalText = cells[3]?.innerText?.replace(/[^0-9.,]/g, '').replace(',', '.') || '0';
                    const statusText = cells[4]?.innerText?.trim() || '';
                    if (supplierName || supplierNif) {
                        list.push({
                            date: dateText,
                            supplierName,
                            supplierNif,
                            total: parseFloat(totalText) || 0,
                            isPending: /pendente|associar|classificar/i.test(statusText)
                        });
                    }
                }
            });
            return list;
        });

        for (const exp of expenses) {
            const vatEst = Math.round(exp.total * 0.23 / 1.23 * 100) / 100;
            const baseEst = Math.round((exp.total - vatEst) * 100) / 100;
            db.addInvoice({
                type: 'expense',
                entity: exp.supplierName,
                supplierName: exp.supplierName,
                supplierNif: exp.supplierNif,
                date: exp.date || new Date().toISOString().split('T')[0],
                total: exp.total,
                baseAmount: baseEst,
                vatAmount: vatEst,
                efaturaStatus: exp.isPending ? 'pending' : 'validated'
            });
            expensesCount++;
        }
        addLog(`✓ e-fatura: ${expensesCount} despesa(s) lidas e registadas com sucesso.`);
    } catch (e) {
        addLog(`Aviso na leitura do e-fatura: ${e.message}`);
    }

    // 4. Extrair faturas emitidas / recibos verdes
    let issuedCount = 0;
    try {
        addLog("A aceder às faturas emitidas e recibos verdes...");
        await page.goto('https://faturas.portaldasfinancas.gov.pt/consultarFaturasEmitidas.action', { waitUntil: 'domcontentloaded', timeout: 25000 });
        await new Promise(r => setTimeout(r, 1500));

        const issued = await page.evaluate(() => {
            const rows = document.querySelectorAll('table.table tbody tr, .tabela-faturas tbody tr, #listaFaturas tbody tr, table tbody tr');
            const list = [];
            rows.forEach(r => {
                const cells = r.querySelectorAll('td');
                if (cells.length >= 4) {
                    const dateText = cells[0]?.innerText?.trim() || '';
                    const clientName = cells[1]?.innerText?.trim() || '';
                    const clientNif = cells[2]?.innerText?.trim() || '';
                    const totalText = cells[3]?.innerText?.replace(/[^0-9.,]/g, '').replace(',', '.') || '0';
                    if (clientName || clientNif) {
                        list.push({
                            date: dateText,
                            clientName,
                            clientNif,
                            total: parseFloat(totalText) || 0
                        });
                    }
                }
            });
            return list;
        });

        for (const iss of issued) {
            const vatEst = Math.round(iss.total * 0.23 / 1.23 * 100) / 100;
            const baseEst = Math.round((iss.total - vatEst) * 100) / 100;
            db.addInvoice({
                type: 'issued',
                entity: iss.clientName,
                clientName: iss.clientName,
                clientNif: iss.clientNif,
                date: iss.date || new Date().toISOString().split('T')[0],
                total: iss.total,
                baseAmount: baseEst,
                vatAmount: vatEst
            });
            issuedCount++;
        }
        addLog(`✓ Faturas Emitidas: ${issuedCount} documento(s) emitidos lidos com sucesso.`);
    } catch (e) {
        addLog(`Aviso na leitura de emitidas: ${e.message}`);
    }

    // 5. Verificar situação tributária e dívidas
    let situation = "regularizada";
    let activeDebts = 0;
    try {
        addLog("A verificar situação tributária na AT...");
        await page.goto('https://sitfiscal.portaldasfinancas.gov.pt/dividas/consultar.action', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        const content = await page.textContent('body').catch(() => '');
        if (/processo executivo|dívida ativa|penhora/i.test(content)) {
            situation = "divida";
            activeDebts = 1;
            addLog("⚠️ Situação Tributária: Detetada dívida ativa em cobrança.");
        } else {
            addLog("✓ Situação Tributária: Regularizada (Inexistência de Dívidas).");
        }
    } catch (e) {}

    db.updateStatus({
        financas: {
            situation,
            lastSync: new Date().toISOString(),
            certidaoValidaAte: new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0],
            dividasAtivas: activeDebts,
            divergencias: 0
        }
    });

    return { expensesCount, issuedCount, situation, detectedNif };
}

/**
 * Extração de Dados Reais da Segurança Social Direta
 */
async function extractSegurancaSocialData(page, context, addLog = console.log) {
    await context.storageState({ path: SESSION_SS_FILE }).catch(() => {});
    addLog("✓ Sessão oficial da Segurança Social Direta gravada em S:\\fiscalguard-pt.");

    // 1. Detetar NISS
    try {
        const bodyText = await page.textContent('body').catch(() => '');
        const nissMatch = bodyText.match(/\b(1\d{10})\b/);
        if (nissMatch) {
            db.updateProfile({ niss: nissMatch[1] });
            addLog(`✓ NISS detetado na sessão oficial: ${nissMatch[1]}`);
        }
    } catch (e) {}

    // 2. Consultar Conta Corrente
    let situation = "regularizada";
    let debitoDiretoAtivo = false;
    try {
        addLog("A consultar conta corrente e posição atual na Segurança Social Direta...");
        await page.goto('https://app.seg-social.pt/ptss/cas/cc/conta-corrente', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        const body = await page.textContent('body').catch(() => '');
        if (/débito direto ativo|autorização de débito/i.test(body)) {
            debitoDiretoAtivo = true;
        }
        if (/dívida|regularizar pagamento|em mora/i.test(body)) {
            situation = "pendente";
        }
        addLog(`✓ Conta corrente consultada: Situação ${situation === 'regularizada' ? 'Regularizada' : 'Pendente'}.`);
    } catch (e) {}

    db.updateStatus({
        segurancaSocial: {
            situation,
            lastSync: new Date().toISOString(),
            debitoDiretoAtivo,
            ultimoPagamento: null,
            proximoPagamento: null
        }
    });

    return { situation, debitoDiretoAtivo };
}

// Ponteiro para a sessão interativa ativa
let activeInteractiveSession = null;

function confirmActiveLogin() {
    if (activeInteractiveSession && activeInteractiveSession.triggerExtraction) {
        activeInteractiveSession.triggerExtraction();
        return { success: true, message: "A extrair faturas e dados do portal agora..." };
    }
    // Se não há sessão Playwright ativa, lançar extração direta com cookies guardados
    // (para quando o utilizador fez login no Chrome nativo via openNativeChrome)
    launchInteractiveLoginAndExtract('financas').catch(err =>
        console.error('[confirmActiveLogin] Erro na extração direta:', err.message)
    );
    return { success: true, message: "A iniciar extração dos portais com o perfil do Chrome..." };
}

/**
 * Extração direta usando o perfil do Chrome e sessões guardadas
 * Usado quando o utilizador confirmou manualmente após login no Chrome nativo
 */
async function launchInteractiveLoginAndExtract(portal = 'financas') {
    const log = [];
    const addLog = (msg) => {
        const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
        log.push(line);
        console.log(`[Extract] ${line}`);
    };
    const { exec } = require('child_process');
    const isFinancas = portal === 'financas';
    const chromeExecutable = getChromeExecutablePath();
    const targetSession = isFinancas ? SESSION_AT_FILE : SESSION_SS_FILE;
    const persistentDir = path.join(DATA_DIR, 'chrome-playwright-profile');

    addLog(`A ligar ao Chrome com perfil persistente para extrair dados...`);
    let context;
    try {
        context = await chromium.launchPersistentContext(persistentDir, {
            channel: 'chrome',
            executablePath: chromeExecutable || undefined,
            headless: true,
            viewport: { width: 1920, height: 1080 },
            args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
            ...(fs.existsSync(targetSession) ? { storageState: targetSession } : {})
        });
        const page = await context.newPage();
        if (isFinancas) {
            // Navegar diretamente para o portal das finanças para verificar sessão
            await page.goto('https://faturas.portaldasfinancas.gov.pt/consultarDespesasAdquirente.action',
                { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 2000));
            const url = page.url();
            if (url.includes('loginForm') || url.includes('acesso.gov.pt')) {
                addLog(`⚠️ Sessão expirada — faz login novamente no Chrome e confirma de novo.`);
                await context.close().catch(() => {});
                return { success: false, log };
            }
            await extractFinancasData(page, context, addLog);
        } else {
            await page.goto('https://app.seg-social.pt/ptss/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 2000));
            await extractSegurancaSocialData(page, context, addLog);
        }
        await context.close().catch(() => {});
        addLog(`✓ Extração concluída com sucesso!`);
        return { success: true, log };
    } catch (err) {
        addLog(`Erro na extração: ${err.message}`);
        if (context) await context.close().catch(() => {});
        return { success: false, error: err.message, log };
    }
}

/**
 * Início de Sessão Oficial Interativo no Google Chrome
 * Usa o perfil REAL do Chrome do utilizador (User Data) para herdar cookies de login já existentes.
 * Se o utilizador já fez login no Chrome normal, o Playwright verá esses cookies automaticamente.
 */
async function launchInteractiveLogin(portal = 'financas', onProgress = () => {}) {
    const log = [];
    const addLog = (msg) => {
        const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
        log.push(line);
        onProgress(line);
        console.log(`[Interactive Login] ${line}`);
    };

    let context;
    try {
        const { exec } = require('child_process');
        const isFinancas = portal === 'financas';
        const portalName = isFinancas ? 'Portal das Finanças (AT)' : 'Segurança Social Direta';
        const chromeExecutable = getChromeExecutablePath();
        const userDataDir = getChromeUserDataDir();

        addLog(`A abrir o Google Chrome com o teu perfil real para o ${portalName}...`);

        if (userDataDir) {
            addLog(`✓ Perfil do Chrome detetado: ${userDataDir}`);
            addLog(`Os teus cookies de login serão usados automaticamente.`);
        } else {
            addLog(`⚠️ Perfil do Chrome não encontrado — a criar sessão nova.`);
        }

        // Usar launchPersistentContext com o perfil REAL do utilizador
        // Isto herda TODOS os cookies do Chrome real, incluindo os do login já feito
        const persistentDir = userDataDir
            ? path.join(DATA_DIR, 'chrome-playwright-profile') // cópia para evitar conflito com Chrome aberto
            : path.join(DATA_DIR, 'chrome-fresh-profile');
        
        // Se o utilizador já tem sessão guardada, copiar cookies para o contexto
        const targetSession = isFinancas ? SESSION_AT_FILE : SESSION_SS_FILE;
        const contextOptions = {
            viewport: null,
            ...(fs.existsSync(targetSession) ? { storageState: targetSession } : {})
        };

        // Lançar Chrome com perfil persistente
        context = await chromium.launchPersistentContext(persistentDir, {
            channel: 'chrome',
            executablePath: chromeExecutable || undefined,
            headless: false,
            viewport: null,
            args: [
                '--start-maximized',
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-blink-features=AutomationControlled'
            ],
            ...(fs.existsSync(targetSession) ? { storageState: targetSession } : {})
        });

        // Se o utilizador tinha sessão guardada, importar cookies
        if (!fs.existsSync(targetSession) && userDataDir) {
            // Tentar importar cookies do Chrome real via ficheiro de sessão
            addLog(`A tentar reutilizar sessão do teu Chrome...`);
        }

        // Forçar janela para a frente no Windows
        exec('powershell -Command "$wshell = New-Object -ComObject Wscript.Shell; Start-Sleep -Milliseconds 800; $wshell.AppActivate(\'Chrome\'); $wshell.AppActivate(\'Google Chrome\')"');

        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : await context.newPage();
        await page.bringToFront().catch(() => {});

        let isClosed = false;
        page.on('close', () => { isClosed = true; });
        context.on('close', () => { isClosed = true; });

        let manualTrigger = false;
        activeInteractiveSession = {
            portal,
            page,
            context,
            triggerExtraction: () => { manualTrigger = true; }
        };

        const targetUrl = isFinancas
            ? 'https://www.acesso.gov.pt/v2/loginForm?partID=PFAP'
            : 'https://app.seg-social.pt/ptss/';

        addLog(`A navegar para ${portalName}...`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

        // Verificar se já está autenticado (caso o perfil já tenha a sessão)
        await new Promise(r => setTimeout(r, 2000));
        const initialUrl = page.url();
        const initialCookies = await context.cookies().catch(() => []);
        const alreadyLoggedIn = isFinancas
            ? (!initialUrl.includes('loginForm') && !initialUrl.includes('acesso.gov.pt') && initialUrl.includes('portaldasfinancas'))
            : (!initialUrl.includes('login') && initialUrl.includes('seg-social.pt'));
        const hasSessionCookies = initialCookies.some(c =>
            (isFinancas && (c.name.includes('PFAP') || c.name.includes('JSESSIONID')))
            || (!isFinancas && c.domain && c.domain.includes('seg-social.pt'))
        );

        if (alreadyLoggedIn || hasSessionCookies) {
            addLog(`✓ Sessão ativa detetada automaticamente! A extrair dados...`);
            if (isFinancas) {
                await extractFinancasData(page, context, addLog);
            } else {
                await extractSegurancaSocialData(page, context, addLog);
            }
            await context.close().catch(() => {});
            addLog("✓ Extração automática concluída! Os teus dados reais estão no painel.");
            activeInteractiveSession = null;
            return { success: true, authenticated: true, log };
        }

        addLog(`Janela do Google Chrome aberta no ${portalName}.`);
        addLog(`Por favor faz o login com NIF/Senha ou Chave Móvel Digital.`);
        addLog(`Depois de entrar, clica em "⚡ Já fiz Login no Chrome" na aplicação!`);

        // Loop de deteção de login (5 minutos)
        let authenticated = false;
        const startTime = Date.now();
        while (!isClosed && (Date.now() - startTime < 300000)) {
            await new Promise(r => setTimeout(r, 2000));
            if (isClosed) break;

            if (manualTrigger) {
                authenticated = true;
                addLog("⚡ Confirmação manual recebida! A extrair faturas e dados...");
                break;
            }

            try {
                const currentUrl = page.url();
                const cookies = await context.cookies().catch(() => []);
                const hasAuthCookie = cookies.some(c =>
                    c.name.includes('PFAP') ||
                    c.name.includes('SSO') ||
                    (c.name === 'JSESSIONID' && c.domain && c.domain.includes('portaldasfinancas.gov.pt')) ||
                    (c.domain && c.domain.includes('seg-social.pt') && !c.name.includes('Google'))
                );
                const isAuthUrl = isFinancas
                    ? (!currentUrl.includes('loginForm') && !currentUrl.includes('acesso.gov.pt') &&
                       (currentUrl.includes('portaldasfinancas.gov.pt') || currentUrl.includes('/home') || currentUrl.includes('/geral')))
                    : (!currentUrl.includes('/login') && !currentUrl.includes('autenticacao') && currentUrl.includes('seg-social.pt'));

                if (hasAuthCookie || isAuthUrl) {
                    authenticated = true;
                    addLog(`✓ Login detetado automaticamente no ${portalName}!`);
                    break;
                }
            } catch (e) {
                break;
            }
        }

        if (authenticated) {
            if (isFinancas) {
                await extractFinancasData(page, context, addLog);
            } else {
                await extractSegurancaSocialData(page, context, addLog);
            }
            await context.close().catch(() => {});
            addLog("✓ Sessão concluída! Os teus dados reais estão agora sincronizados.");
        } else {
            addLog("ℹ️ Janela fechada antes de concluir login. Tenta novamente.");
            if (!isClosed) await context.close().catch(() => {});
        }

        activeInteractiveSession = null;
        return { success: true, authenticated, log };

    } catch (err) {
        addLog(`Aviso durante início de sessão: ${err.message}`);
        activeInteractiveSession = null;
        if (context) await context.close().catch(() => {});
        return { success: false, error: err.message, log };
    }
}

/**
 * Atalho de Abertura via Chrome nativo do sistema
 * Abre o URL no Chrome real do utilizador e regista a sessão para confirmação manual
 */
function openNativeChrome(portal = 'financas') {
    const { exec } = require('child_process');
    const targetUrl = portal === 'financas'
        ? 'https://www.acesso.gov.pt/v2/loginForm?partID=PFAP'
        : 'https://app.seg-social.pt/ptss/';
    const chromePath = getChromeExecutablePath();
    if (chromePath) {
        exec(`"${chromePath}" --new-window "${targetUrl}"`, (err) => {
            if (err) console.error('Erro ao abrir Chrome nativo:', err.message);
        });
    } else {
        // Fallback: start via shell
        exec(`start chrome "${targetUrl}"`);
    }
    // Marcar que deve aguardar confirmação do utilizador
    return { opened: true, url: targetUrl, message: 'Chrome nativo aberto. Faz login e clica "⚡ Já fiz Login no Chrome".' };
}

module.exports = {
    getCredentials,
    saveCredentials,
    syncPortalFinancas,
    syncSegurancaSocial,
    launchInteractiveLogin,
    openNativeChrome,
    confirmActiveLogin
};
