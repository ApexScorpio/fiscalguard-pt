'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PATH = path.join(__dirname, 'data', 'official-import.json');

function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const parsed = new Date(s + 'T00:00:00.000Z');
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== s
    ? null : s;
}

function safeVehicle(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const plate = typeof item.plate === 'string' ? item.plate.trim().toUpperCase() : '';
  const compactPlate = plate.replace(/-/g, '');
  if (!/^[A-Z0-9]{2}-?[A-Z0-9]{2}-?[A-Z0-9]{2}$/.test(plate) ||
      (compactPlate.match(/[0-9]/g) || []).length < 2) return null;
  const amount = item.iucAmountEUR;
  return {
    plate,
    description: typeof item.description === 'string' ? item.description.slice(0, 120) : '',
    dueDate: validDate(item.dueDate),
    iucAmountEUR: typeof amount === 'number' && Number.isFinite(amount) && amount >= 0
      ? Math.round(amount * 100) / 100 : null,
    paymentStatus: ['paid', 'pending', 'unknown'].includes(item.paymentStatus)
      ? item.paymentStatus : 'unknown'
  };
}

function normalizeSnapshot(raw) {
  const blank = {
    status: 'not_imported',
    capturedAt: null,
    origin: null,
    vehicles: [],
    summary: {
      atDebts: null,
      atFines: null,
      atMessages: null,
      ssStatus: 'unknown'
    }
  };
  if (!raw || raw.version !== 1 || raw.source !== 'local-official-capture' ||
      typeof raw.capturedAt !== 'string' || !Number.isFinite(Date.parse(raw.capturedAt))) {
    return blank;
  }
  const overview = raw.summary && typeof raw.summary === 'object' ? raw.summary : {};
  const count = n => Number.isSafeInteger(n) && n >= 0 ? n : null;
  const vehicles = Array.isArray(raw.vehicles) ? raw.vehicles.map(safeVehicle).filter(Boolean) : [];
  const unique = [...new Map(vehicles.map(v => [v.plate, v])).values()];
  unique.sort((a,b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31') ||
    a.plate.localeCompare(b.plate));
  return {
    status: raw.verifiedBy === 'authenticated-json-endpoint' ? 'verified_local' : 'imported_unverified',
    capturedAt: new Date(raw.capturedAt).toISOString(),
    origin: raw.verifiedBy === 'authenticated-json-endpoint'
      ? 'Contagens obtidas de respostas JSON oficiais na sessão autenticada'
      : 'Importação local - confirmar origem e atualização',
    vehicles: unique,
    summary: {
      atDebts: count(overview.atDebts),
      atFines: count(overview.atFines),
      atMessages: count(overview.atMessages),
      ssStatus: ['regular', 'pending', 'unknown'].includes(overview.ssStatus)
        ? overview.ssStatus : 'unknown'
    }
  };
}

function readOverview(filename = DEFAULT_PATH) {
  try {
    const stat = fs.statSync(filename);
    if (stat.size > 1024 * 1024) return normalizeSnapshot(null);
    return normalizeSnapshot(JSON.parse(fs.readFileSync(filename, 'utf8')));
  } catch {
    return normalizeSnapshot(null);
  }
}

module.exports = { validDate, safeVehicle, normalizeSnapshot, readOverview };
