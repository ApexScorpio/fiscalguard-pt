'use strict';

// Recebe APENAS contagens agregadas da extensao local. Nao aceita
// passwords, NIF, cookies, identificadores nem respostas fiscais completas.
const fs = require('node:fs');
const path = require('node:path');

const SNAPSHOT = path.join(__dirname,'data','official-import.json');

function validateReport(report, now=Date.now()) {
  if (!report || typeof report !== 'object' || Array.isArray(report) ||
      report.phase !== 'synced' || !Number.isSafeInteger(report.verifiedEndpoints) ||
      report.verifiedEndpoints < 1 || report.verifiedEndpoints > 5) return null;
  if (typeof report.capturedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(report.capturedAt)) return null;
  const timestamp=Date.parse(report.capturedAt);
  if (!Number.isFinite(timestamp) || Math.abs(now-timestamp)>5*60*1000) return null;
  const counts = {};
  let recognized=0;
  for (const key of ['atMessages','atDebts','atFines']) {
    const n=report.counts?.[key];
    counts[key]=Number.isSafeInteger(n)&&n>=0&&n<10000000?n:null;
    if (counts[key] !== null) recognized++;
  }
  // Endpoints como alertas/interacoes podem validar a sessao, mesmo
  // sem um campo visivel correspondente.
  if (recognized>report.verifiedEndpoints) return null;
  return {
    phase:'synced',
    message:'Contagens da AT recolhidas na sessao existente do Chrome',
    capturedAt:report.capturedAt,
    verifiedEndpoints:report.verifiedEndpoints,
    counts
  };
}

function importChromeReport(input,{filename=SNAPSHOT,now=Date.now()}={}) {
  const safe=validateReport(input,now);
  if (!safe) return { success:false,phase:'unverified',
    message:'Resposta do Chrome invalida ou sem verificacao comprovada' };
  let old={};
  try {old=JSON.parse(fs.readFileSync(filename,'utf8'));} catch {}
  const ss=old?.summary?.ssStatus;
  const snapshot={
    version:1, source:'local-official-capture',
    capturedAt:safe.capturedAt,
    verifiedBy:'chrome-extension-same-origin',
    summary:{
      atMessages:safe.counts.atMessages,
      atDebts:safe.counts.atDebts,
      atFines:safe.counts.atFines,
      ssStatus:['regular','pending','unknown'].includes(ss)?ss:'unknown'
    },
    // Nao aproveitar dados de veiculos para apresentar como consulta nova.
    vehicles:[]
  };
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  fs.writeFileSync(filename,JSON.stringify(snapshot,null,2),{mode:0o600});
  return {success:true,phase:'synced',message:safe.message,
    verifiedEndpoints:safe.verifiedEndpoints,
    capturedAt:safe.capturedAt,
    counts:safe.counts};
}
module.exports={validateReport,importChromeReport};
