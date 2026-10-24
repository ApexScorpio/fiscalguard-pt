'use strict';

// Sessão AT gerida pelo FiscalGuard: só dados agregados são devolvidos à web.
// O perfil do Chrome pertence a esta aplicação; nunca usar o perfil normal,
// nem os perfis WebView2 de outros programas.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const {vault: atVault}=require('./at-vault');
const {makeAutoLogin,isATLoginURL}=require('./at-auto-login');

const DIR = path.join(__dirname, 'data');
const PROFILE = path.join(DIR, 'at-browser-profile');
const SNAPSHOT = path.join(DIR, 'official-import.json');
const HOME = 'https://sitfiscal.portaldasfinancas.gov.pt/geral';

const ENDPOINTS = Object.freeze({
  atMessages: '/geral/dashboard/mensagens',
  atAlerts: '/geral/dashboard/alertas',
  atInteractions: '/geral/dashboard/interacoes',
  atDebts: '/geral/dividas',
  atFines: '/geral/coimas'
});

function officialHost(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' &&
      (u.hostname === 'portaldasfinancas.gov.pt' ||
       u.hostname.endsWith('.portaldasfinancas.gov.pt'));
  } catch { return false; }
}

function fiscalHost(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' &&
      u.hostname === 'sitfiscal.portaldasfinancas.gov.pt';
  } catch { return false; }
}

function countFromPayload(kind, payload) {
  if (Array.isArray(payload)) return payload.length;
  if (!payload || typeof payload !== 'object') return null;
  if (payload.error || payload.errors || payload.unauthorized) return null;
  const fields = {
    atMessages: ['listaMensagens', 'mensagens', 'messages', 'dataFromResponseList'],
    atAlerts: ['listaAlertas', 'alertas', 'alerts', 'dataFromResponseList'],
    atInteractions: ['listaInteracoes', 'interacoes', 'interactions', 'dataFromResponseList'],
    atDebts: ['dataFromResponseList', 'listaDividas', 'dividas', 'debts'],
    atFines: ['dataFromResponseList', 'listaCoimas', 'coimas', 'fines']
  }[kind] || [];
  for (const field of fields) {
    if (Array.isArray(payload[field])) return payload[field].length;
  }
  return null;
}

function publicState(state) {
  return {
    phase: state.phase,
    message: state.message,
    lastVerifiedAt: state.lastVerifiedAt,
    lastImportedAt: state.lastImportedAt,
    verifiedEndpoints: state.verifiedEndpoints,
    counts: state.counts
  };
}

function makeManager({ engine = chromium, dir = DIR, profile = PROFILE, snapshot = SNAPSHOT, vault = atVault, autoLogin = makeAutoLogin({vault}) } = {}) {
  let context = null;
  let loginPage = null;
  let timer = null;
  let busy = false;
  let launching = null;
  let closing = false;
  let browserMode = null; // 'visible' ou 'background'; nao abrir outro perfil
  const state = {
    phase: 'not_checked',
    message: 'Sessão AT por verificar',
    lastVerifiedAt: null,
    lastImportedAt: null,
    verifiedEndpoints: 0,
    counts: { atMessages: null, atDebts: null, atFines: null }
  };

  const setState = (phase, message) => {
    state.phase = phase;
    state.message = message;
    return publicState(state);
  };

  const clearWatcher = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  async function closeContext() {
    clearWatcher();
    if (context) {
      const saved = context;
      closing = true;
      context = null;
      loginPage = null;
      browserMode = null;
      try { await saved.close(); } catch {}
      closing = false;
    }
  }

  async function startLogin() {
    if (launching) return launching;
    if (context && browserMode === 'background') {
      // Reabrir VISIVEL apenas se o utilizador carregar explicitamente em entrar.
      // Fecha o processo headless, mas reutiliza exatamente a MESMA pasta de perfil.
      await closeContext();
    } else if (context) {
      try { if (loginPage && !loginPage.isClosed()) await loginPage.bringToFront(); } catch {}
      return publicState(state);
    }

    launching = (async () => {
      fs.mkdirSync(dir, { recursive: true });
      setState('opening', 'A abrir o navegador oficial das Finanças');
      try {
        context = await engine.launchPersistentContext(profile, {
          channel: 'chrome',
          headless: false,
          viewport: null,
          acceptDownloads: false,
          args: ['--no-first-run', '--no-default-browser-check']
        });
        browserMode = 'visible';
        loginPage = context.pages()[0] || await context.newPage();
        const page = loginPage;
        context.on('close', () => {
          if (!closing) {
            // Fechar a janela nao prova expiracao dos cookies guardados.
            setState('session_saved', 'Navegador fechado; sessao conservada no disco, ainda por verificar');
            clearWatcher();
            context = null;
            loginPage = null;
            browserMode = null;
          }
        });

        await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 30000 });
        setState('waiting_login', 'Conclui o login na janela oficial; os dados serão verificados automaticamente');

        timer = setInterval(() => { void probe(false).catch(() => {}); }, 5000);
        timer.unref?.();
        void probe(false).catch(() => {});
      } catch (error) {
        await closeContext();
        setState('error', 'Não foi possível abrir a janela oficial: ' + error.constructor.name);
      }
      return publicState(state);
    })();

    try { return await launching; } finally { launching = null; }
  }

  async function inspectOfficialPage(page) {
    // Nunca devolver ao Node o corpo das respostas fiscais: apenas contagens,
    // estado HTTP e forma geral do JSON para os endpoints permitidos.
    return page.evaluate(async endpoints => {
      const out = { verifiedEndpoints: 0, counts: {} };
      for (const [key, endpoint] of Object.entries(endpoints)) {
        try {
          const controller = new AbortController();
          const deadline = setTimeout(() => controller.abort(), 10000);
          let response;
          try {
            response = await fetch(endpoint, {
              method: 'GET',
              credentials: 'include',
              cache: 'no-store',
              redirect: 'follow',
              signal: controller.signal
            });
          } finally {
            clearTimeout(deadline);
          }
          const destination = new URL(response.url);
          if (!response.ok ||
              destination.protocol !== 'https:' ||
              destination.hostname !== 'sitfiscal.portaldasfinancas.gov.pt' ||
              !/json/i.test(response.headers.get('content-type') || '')) continue;
          const data = await response.json();
          const props = {
            atMessages: ['listaMensagens', 'mensagens', 'messages', 'dataFromResponseList'],
            atAlerts: ['listaAlertas', 'alertas', 'alerts', 'dataFromResponseList'],
            atInteractions: ['listaInteracoes', 'interacoes', 'interactions', 'dataFromResponseList'],
            atDebts: ['dataFromResponseList', 'listaDividas', 'dividas', 'debts'],
            atFines: ['dataFromResponseList', 'listaCoimas', 'coimas', 'fines']
          };
          let count = null;
          if (Array.isArray(data)) count = data.length;
          else if (data && typeof data === 'object' &&
                   !data.error && !data.errors && !data.unauthorized) {
            for (const prop of props[key] || []) {
              if (Array.isArray(data[prop])) { count = data[prop].length; break; }
            }
          }
          if (count !== null) {
            out.verifiedEndpoints += 1;
            out.counts[key] = count;
          }
        } catch {
          // Falha isolada de consulta: não assume zero.
        }
      }
      return out;
    }, ENDPOINTS);
  }

  async function performProbe(force) {
    if (busy || !context) return publicState(state);
    let current;
    try { current = loginPage && !loginPage.isClosed() ? loginPage.url() : ''; }
    catch { current = ''; }
    const currentPath = (() => { try { return new URL(current).pathname; } catch { return ''; } })();
    if (!force && !officialHost(current) && !isATLoginURL(current)) {
      return publicState(state);
    }
    if (!force && officialHost(current) && /login|autentic|sign.in/i.test(currentPath)) {
      return publicState(state);
    }
    busy = true;
    setState('verifying', 'A verificar respostas autenticadas da AT');
    let verificationPage = null;
    try {
      verificationPage = await context.newPage();
      await verificationPage.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Reautenticar apenas quando o redirecionamento e o formulario
      // correspondem ao dominio oficial de login da AT.
      if (isATLoginURL(verificationPage.url())) {
        const attempt=await autoLogin.run(verificationPage);
        if (attempt.phase==='verification_required') {
          return setState('verification_required','Autenticacao adicional exigida pela AT');
        }
        if (attempt.phase!=='submitted') {
          return setState('login_required',
            'Autenticacao pendente: '+String(attempt.phase||'nao_confirmada'));
        }
      }
      if (!fiscalHost(verificationPage.url())) {
        // Apenas um redirecionamento claro para login significa sessao expirada.
        // Falhas tecnicas nao podem forcar outro login.
        const destination = verificationPage.url();
        const loginRedirect = /^https:\/\/(?:www\.)?acesso\.gov\.pt\//i.test(destination) ||
          /^https:\/\/(?:www\.)?autenticacao\.gov\.pt\//i.test(destination) ||
          /portaldasfinancas\.gov\.pt\/.{0,100}(?:login|autentic)/i.test(destination);
        return setState(loginRedirect ? 'login_required' : 'unverified',
          loginRedirect ? 'A AT pediu nova autenticacao (a sessao foi preservada)' :
            'Portal redirecionou; nao foi possivel confirmar a sessao. Nao e necessario novo login por enquanto');
      }
      const response = await inspectOfficialPage(verificationPage);
      const verified = Number(response?.verifiedEndpoints || 0);
      if (!Number.isSafeInteger(verified) || verified < 1) {
        return setState('unverified', 'A página abriu, mas nenhuma resposta fiscal JSON foi validada');
      }
      const counts = {};
      for (const key of ['atMessages','atDebts','atFines']) {
        const n = response.counts?.[key];
        counts[key] = Number.isSafeInteger(n) && n >= 0 ? n : null;
      }
      state.verifiedEndpoints = verified;
      state.counts = counts;
      state.lastVerifiedAt = new Date().toISOString();
      autoLogin.markAuthenticatedResult?.(true);

      // Importação limitada a contagens comprovadas; não inventa veículos,
      // montantes, dívidas ou estado contributivo.
      let previous = {};
      try { previous = JSON.parse(fs.readFileSync(snapshot, 'utf8')); } catch {}
      const oldSummary = previous && previous.summary && typeof previous.summary === 'object'
        ? previous.summary : {};
      const output = {
        version: 1,
        source: 'local-official-capture',
        capturedAt: state.lastVerifiedAt,
        verifiedBy: 'authenticated-json-endpoint',
        summary: {
          atDebts: counts.atDebts,
          atFines: counts.atFines,
          atMessages: counts.atMessages,
          ssStatus: oldSummary.ssStatus || 'unknown'
        },
        vehicles: Array.isArray(previous.vehicles) ? previous.vehicles : []
      };
      fs.mkdirSync(path.dirname(snapshot), { recursive: true });
      // Ficheiro local em D:, não incluído no GitHub nem expõe cookies.
      fs.writeFileSync(snapshot, JSON.stringify(output, null, 2), { mode: 0o600 });
      state.lastImportedAt = state.lastVerifiedAt;
      const result = setState('synced', 'Ligação autenticada confirmada: ' + verified + ' respostas oficiais válidas');
      // CRITICO: nao fechar o browser nem eliminar o contexto autenticado.
      // Proximas atualizacoes usam exatamente as mesmas cookies e tabs.
      // Reduzir a janela, quando possivel, SEM terminar o processo.
      if (browserMode === 'visible' && loginPage && !loginPage.isClosed() && context.newCDPSession) {
        try {
          const cdp = await context.newCDPSession(loginPage);
          const windowInfo = await cdp.send('Browser.getWindowForTarget');
          if (windowInfo?.windowId != null) {
            await cdp.send('Browser.setWindowBounds', {
              windowId: windowInfo.windowId, bounds: { windowState: 'minimized' }
            });
          }
          await cdp.detach();
        } catch { /* a impossibilidade de minimizar nunca termina a sessao */ }
      }
      return result;
    } catch (error) {
      return setState('error', 'Falha na verificação AT: ' + error.constructor.name);
    } finally {
      try { if (verificationPage && !verificationPage.isClosed()) await verificationPage.close(); } catch {}
      busy = false;
    }
  }

  // Todos os pedidos simultaneos partilham a mesma verificacao.
  // Nunca comunicar um estado intermedio como se fosse o resultado final.
  let activeProbe=null;
  function probe(force) {
    if(activeProbe)return activeProbe;
    const pending=performProbe(force);
    activeProbe=pending;
    void pending.finally(()=>{
      if(activeProbe===pending)activeProbe=null;
    }).catch(()=>{});
    return pending;
  }

  async function confirmLogin() {
    if (!context) {
      return setState('login_required', 'Sem navegador AT gerido pelo FiscalGuard. O login numa aba comum do Chrome não é partilhado automaticamente');
    }
    return probe(true);
  }

  async function refresh() {
    if (context) return probe(true);
    if (busy || launching) return publicState(state);
    if (!fs.existsSync(profile) && !vault.has?.()) {
      return setState('login_required', 'Ainda não existe perfil nem credenciais cifradas AT no FiscalGuard');
    }
    fs.mkdirSync(dir, { recursive: true });
    try {
      context = await engine.launchPersistentContext(profile, {
        channel: 'chrome', headless: true, acceptDownloads: false
      });
      browserMode = 'background';
      loginPage = context.pages()[0] || await context.newPage();
      context.on('close', () => {
        if (!closing) {
          setState('session_saved', 'Navegador terminou; perfil AT continua guardado');
          context = null;
          loginPage = null;
          browserMode = null;
        }
      });
      // Reutilizar navegador aberto nas consultas seguintes.
      return await probe(true);
    } catch (error) {
      await closeContext();
      return setState('error', 'Reutilização da sessão: ' + error.constructor.name);
    }
  }

  function status() { return publicState(state); }
  return { startLogin, confirmLogin, refresh, status, closeContext };
}

const atManager = makeManager();
module.exports = { makeManager, atManager, officialHost, fiscalHost, countFromPayload };
