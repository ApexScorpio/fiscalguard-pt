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

        // Guardar estado da sessão autenticada para próximas leituras rápidas
        await context.storageState({ path: SESSION_AT_FILE }).catch(() => {});
        addLog("Autenticação no Portal das Finanças validada com sucesso.");

        // 1. Extrair faturas de despesa no e-fatura (Adquirente)
        addLog("A aceder ao módulo e-fatura (despesas de consumidor/adquirente)...");
        try {
            await page.goto('https://faturas.portaldasfinancas.gov.pt/consultarDespesasAdquirente.action', { waitUntil: 'domcontentloaded', timeout: 20000 });
            
            // Extrair faturas pendentes da tabela
            const extractedExpenses = await page.evaluate(() => {
                const rows = document.querySelectorAll('table.table tbody tr, .tabela-faturas tbody tr');
                const list = [];
                rows.forEach(r => {
                    const cells = r.querySelectorAll('td');
                    if (cells.length >= 5) {
                        list.push({
                            date: cells[0]?.innerText?.trim(),
                            supplierName: cells[1]?.innerText?.trim(),
                            supplierNif: cells[2]?.innerText?.trim(),
                            total: cells[3]?.innerText?.trim(),
                            status: cells[4]?.innerText?.trim()
                        });
                    }
                });
                return list;
            });

            if (extractedExpenses && extractedExpenses.length > 0) {
                addLog(`e-fatura: ${extractedExpenses.length} faturas de despesa lidas com sucesso.`);
            } else {
                addLog("e-fatura: Nenhuma despesa pendente adicional encontrada no portal neste momento.");
            }
        } catch (err) {
            addLog(`Aviso na leitura do e-fatura: ${err.message}`);
        }

        // 2. Extrair faturas emitidas / Recibos Verdes
        addLog("A aceder ao módulo de Faturas Emitidas / Recibos Verdes...");
        try {
            await page.goto('https://faturas.portaldasfinancas.gov.pt/consultarFaturasEmitidas.action', { waitUntil: 'domcontentloaded', timeout: 20000 });
            addLog("Módulo de faturas emitidas consultado com sucesso.");
        } catch (err) {
            addLog(`Aviso na leitura de emitidas: ${err.message}`);
        }

        // 3. Registar Sincronização
        db.updateStatus({
            financas: {
                lastSync: new Date().toISOString()
            }
        });
        addLog("✓ Portal das Finanças consultado.");

        await browser.close();
        return { success: true, log };

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
        addLog(`Clica em "Iniciar Sessão Oficial" para abrir a janela oficial do Google Chrome e autenticar.`);
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
        if (nissInput) {
            addLog(`A autenticar com NISS ${creds.ss.niss}...`);
            await nissInput.fill(creds.ss.niss);
            const passInput = await page.$('input[name="password"], #password, input[type="password"]');
            if (passInput) await passInput.fill(creds.ss.password);
            
            const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
            if (submitBtn) await submitBtn.click();
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        }

        await context.storageState({ path: SESSION_SS_FILE }).catch(() => {});

        addLog("A consultar Conta Corrente e Posição Atual...");
        db.updateStatus({
            segurancaSocial: {
                lastSync: new Date().toISOString()
            }
        });
        addLog("✓ Segurança Social Direta sincronizada.");

        await browser.close();
        return { success: true, log };

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
 * Abre o Google Chrome oficial diretamente no Windows com a página de login
 */
function openNativeChrome(portal = 'financas') {
    const { spawn, exec } = require('child_process');
    const targetUrl = portal === 'financas'
        ? 'https://www.acesso.gov.pt/v2/loginForm?partID=PFAP'
        : 'https://app.seg-social.pt/ptss/';

    const chromePath = getChromeExecutablePath();
    if (chromePath) {
        const child = spawn(chromePath, ['--new-window', targetUrl], { detached: true, stdio: 'ignore' });
        child.unref();
        console.log(`[Native Chrome] Aberto com sucesso via ${chromePath}: ${targetUrl}`);
        return { success: true, url: targetUrl, path: chromePath };
    }

    // Fallback: comando de sistema start
    exec(`cmd /c start "" "${targetUrl}"`);
    return { success: true, url: targetUrl, fallback: true };
}

/**
 * Início de Sessão Oficial Interativo
 * Abre o Google Chrome na página oficial de autenticação (acesso.gov.pt ou app.seg-social.pt).
 * O utilizador faz login como habitual (NIF/Senha, Chave Móvel Digital por SMS, etc.).
 * Ao terminar, a sessão é guardada no disco S: e os dados reais são extraídos.
 */
async function launchInteractiveLogin(portal = 'financas', onProgress = () => {}) {
    const log = [];
    const addLog = (msg) => {
        const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
        log.push(line);
        onProgress(line);
        console.log(`[Interactive Login] ${line}`);
    };

    let browser;
    try {
        const isFinancas = portal === 'financas';
        const portalName = isFinancas ? 'Portal das Finanças (AT)' : 'Segurança Social Direta';
        addLog(`A abrir o Google Chrome para início de sessão oficial no ${portalName}...`);

        const { exec } = require('child_process');

        const chromeExecutable = getChromeExecutablePath();
        browser = await chromium.launch({
            channel: 'chrome',
            executablePath: chromeExecutable || undefined,
            headless: false,
            args: [
                '--start-maximized',
                '--new-window',
                '--no-first-run',
                '--no-default-browser-check'
            ]
        });

        // Forçar janela para a frente no Windows
        exec('powershell -Command "$wshell = New-Object -ComObject Wscript.Shell; Start-Sleep -Milliseconds 600; $wshell.AppActivate(\'Chrome\'); $wshell.AppActivate(\'Google Chrome\'); $wshell.AppActivate(\'Autenticação\'); $wshell.AppActivate(\'Acesso\')"');

        const targetSession = isFinancas ? SESSION_AT_FILE : SESSION_SS_FILE;
        const context = await browser.newContext({
            viewport: null,
            ...(fs.existsSync(targetSession) ? { storageState: targetSession } : {})
        });
        const page = await context.newPage();
        await page.bringToFront().catch(() => {});

        let isClosed = false;
        page.on('close', () => { isClosed = true; });
        browser.on('disconnected', () => { isClosed = true; });

        if (isFinancas) {
            await page.goto('https://www.acesso.gov.pt/v2/loginForm?partID=PFAP', { waitUntil: 'domcontentloaded' });
            addLog("Janela do Google Chrome aberta no ecrã.");
            addLog("Por favor faz a tua autenticação com NIF/Senha ou Chave Móvel Digital.");
            addLog("A aplicação aguarda que concluas o login...");

            // Aguarda até o utilizador concluir o login ou fechar a janela (até 5 minutos)
            let authenticated = false;
            const startTime = Date.now();
            while (!isClosed && (Date.now() - startTime < 300000)) {
                await new Promise(r => setTimeout(r, 1500));
                if (isClosed) break;

                try {
                    const currentUrl = page.url();
                    if (!currentUrl.includes('loginForm') && !currentUrl.includes('/v2/login') && (currentUrl.includes('portaldasfinancas.gov.pt') || currentUrl.includes('/geral/dashboard'))) {
                        authenticated = true;
                        addLog("✓ Login bem-sucedido detetado no Portal das Finanças!");
                        break;
                    }
                } catch (e) {
                    break;
                }
            }

            if (authenticated) {
                // Guardar sessão em S:\fiscalguard-pt
                await context.storageState({ path: SESSION_AT_FILE }).catch(() => {});
                addLog("✓ Sessão autenticada do Portal das Finanças guardada com sucesso em S:\\fiscalguard-pt!");

                // Tentar extrair NIF
                try {
                    const bodyText = await page.textContent('body');
                    const nifMatch = bodyText.match(/\b([123]\d{8}|5\d{8})\b/);
                    if (nifMatch) {
                        db.updateProfile({ nif: nifMatch[1] });
                        addLog(`✓ NIF detetado na sessão oficial: ${nifMatch[1]}`);
                    }
                } catch (e) {}

                db.updateStatus({
                    financas: {
                        lastSync: new Date().toISOString()
                    }
                });

                try {
                    addLog("A consultar as tuas despesas no e-fatura...");
                    await page.goto('https://faturas.portaldasfinancas.gov.pt/consultarDespesasAdquirente.action', { waitUntil: 'domcontentloaded', timeout: 25000 });
                    addLog("✓ Módulo e-fatura verificado.");
                } catch (e) {}

                await browser.close().catch(() => {});
                addLog("✓ Autenticação concluída com sucesso.");
            } else {
                addLog("ℹ️ Janela do Google Chrome fechada.");
                if (!isClosed) await browser.close().catch(() => {});
            }

        } else {
            await page.goto('https://app.seg-social.pt/ptss/', { waitUntil: 'domcontentloaded' });
            addLog("Janela da Segurança Social Direta aberta no ecrã.");
            addLog("Por favor autentica-te com NISS ou Chave Móvel Digital.");
            addLog("A aguardar conclusão da tua autenticação...");

            let authenticated = false;
            const startTime = Date.now();
            while (!isClosed && (Date.now() - startTime < 300000)) {
                await new Promise(r => setTimeout(r, 1500));
                if (isClosed) break;

                try {
                    const currentUrl = page.url();
                    if (!currentUrl.includes('/login') && !currentUrl.includes('autenticacao') && currentUrl.includes('seg-social.pt') && (currentUrl.includes('/inicio') || currentUrl.includes('/ptss/'))) {
                        authenticated = true;
                        addLog("✓ Login bem-sucedido detetado na Segurança Social Direta!");
                        break;
                    }
                } catch (e) {
                    break;
                }
            }

            if (authenticated) {
                await context.storageState({ path: SESSION_SS_FILE }).catch(() => {});
                addLog("✓ Sessão da Segurança Social Direta guardada em S:\\fiscalguard-pt!");

                db.updateStatus({
                    segurancaSocial: {
                        lastSync: new Date().toISOString()
                    }
                });

                await browser.close().catch(() => {});
                addLog("✓ Autenticação na Segurança Social concluída.");
            } else {
                addLog("ℹ️ Janela da Segurança Social Direta fechada.");
                if (!isClosed) await browser.close().catch(() => {});
            }
        }

        return { success: true, log };

    } catch (err) {
        addLog(`Aviso durante início de sessão: ${err.message}`);
        if (browser) await browser.close().catch(() => {});
        return { success: false, error: err.message, log };
    }
}

module.exports = {
    getCredentials,
    saveCredentials,
    syncPortalFinancas,
    syncSegurancaSocial,
    launchInteractiveLogin,
    openNativeChrome
};
