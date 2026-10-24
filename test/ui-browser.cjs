'use strict';

const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    let phase = 'not_checked';
    let imported = false;

    await page.route('**/api/at/session', async route => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          phase,
          message: phase === 'synced'
            ? 'Sessão AT verificada por respostas oficiais simuladas'
            : phase === 'waiting_login'
              ? 'A aguardar autenticação na janela oficial'
              : 'Sessão ainda por verificar',
          lastVerifiedAt: phase === 'synced' ? '2026-10-24T10:00:00Z' : null,
          verifiedEndpoints: phase === 'synced' ? 2 : 0
        })
      });
    });

    await page.route('**/api/official/overview', async route => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(imported ? {
          status: 'verified_local',
          capturedAt: '2026-10-24T10:00:00Z',
          summary: {atDebts: 0, atFines: null, atMessages: 3, ssStatus: 'unknown'},
          vehicles: []
        } : {
          status: 'not_imported',
          capturedAt: null,
          summary: {atDebts: null, atFines: null, atMessages: null, ssStatus: 'unknown'},
          vehicles: []
        })
      });
    });

    await page.route('**/api/at/login', async route => {
      phase = 'waiting_login';
      await route.fulfill({ contentType: 'application/json',
        body: JSON.stringify({phase, message:'A aguardar autenticação na janela oficial'}) });
    });

    await page.route('**/api/at/verify', async route => {
      phase = 'synced';
      imported = true;
      await route.fulfill({ contentType: 'application/json',
        body: JSON.stringify({phase, message:'Sessão validada (respostas simuladas)'}) });
    });

    await page.goto('http://127.0.0.1:4848/', {waitUntil:'domcontentloaded', timeout:25000});
    await page.locator('#official-at-session').waitFor();
    await page.getByText('Por consultar', {exact:true}).first().waitFor();
    assert.match(await page.locator('#official-at-debts').textContent(), /Por consultar/);

    await page.locator('#btn-official-login').click();
    await page.getByText('A aguardar autenticação na janela oficial', {exact:true}).first().waitFor();

    await page.locator('#btn-official-verify').click();
    await page.locator('#official-at-debts').getByText('0 registos').waitFor();
    assert.equal((await page.locator('#official-at-messages').textContent()).trim(),'3 mensagens');
    assert.match(await page.locator('#official-at-session').textContent(), /simulad|verificada/i);
    assert.match(await page.locator('#official-vehicles-list').textContent(), /Nenhuma viatura importada/);
    assert.equal(await page.locator('#official-ss-status').textContent(), 'Por consultar');

    console.log('UI: PASSOU — sessão simulada, dados oficiais simulados, campos não inventados');
    console.log('IMPORTANTE: não prova login nem extração real da AT');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error('UI: FALHOU — ' + String(error.message || error).slice(0,800));
  process.exitCode = 1;
});
