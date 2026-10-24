'use strict';

// Sessão AT gerida pelo FiscalGuard: só dados agregados são devolvidos à web.
// O perfil do Chrome pertence a esta aplicação; nunca usar o perfil normal,
// nem os perfis WebView2 de outros programas.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

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

function makeManager({ engine = chromium, dir = DIR, profile = PROFILE, snapshot = SNAPSHOT } = {}) {
  let context = null;
  let loginPage = null;
  let timer = null;
  let busy = false;
  let launching = null;
  let closing = false;
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
      try { await saved.close(); } catch {}
      closing = false;
    }
  }

  async function startLogin() {
    if (launching) return launching;
    if (context) {
      try { if (loginPage && !loginPage.isClosed()) await loginPage.bringToFront(); } catch {}
      return setState(state.phase, state.message);
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
        loginPage = context.pages()[0] || await context.newPage();
        const page = loginPage;
        context.on('close', () => {
          if (!closing && state.phase !== 'synced') {
            setState('login_required', 'Janela de autenticação encerrada; é necessário confirmar a sessão');
          }
          clearWatcher();
          context = null;
          loginPage = null;
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

  async function probe(force) {
    if (busy || !context) return publicState(state);
    let current;
    try { current = loginPage && !loginPage.isClosed() ? loginPage.url() : ''; }
    catch { current = ''; }
    if (!force && (!officialHost(current) || /login|autentic|sign.in/i.test(new URL(current).pathname))) {
      return publicState(state);
    }
    busy = true;
    setState('verifying', 'A verificar respostas autenticadas da AT');
    let verificationPage = null;
    try {
      verificationPage = await context.newPage();
      await verificationPage.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (!fiscalHost(verificationPage.url())) {
        return setState('login_required', 'A AT pediu autenticação; conclui o acesso na janela oficial');
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
      await closeContext(); // Perfil fica persistente; fecha só a janela gerida.
      return result;
    } catch (error) {
      return setState('error', 'Falha na verificação AT: ' + error.constructor.name);
    } finally {
      try { if (verificationPage && !verificationPage.isClosed()) await verificationPage.close(); } catch {}
      busy = false;
    }
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
    if (!fs.existsSync(profile)) {
      return setState('login_required', 'Ainda não existe um perfil AT persistente deste FiscalGuard');
    }
    fs.mkdirSync(dir, { recursive: true });
    try {
      context = await engine.launchPersistentContext(profile, {
        channel: 'chrome', headless: true, acceptDownloads: false
      });
      loginPage = context.pages()[0] || await context.newPage();
      const result = await probe(true);
      await closeContext();
      return result;
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
