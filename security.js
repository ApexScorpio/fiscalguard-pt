'use strict';

/**
 * Restringe a interface fiscal ao navegador local.
 * Não substitui autenticação caso o serviço venha a ser publicado na rede.
 */
function localOnlyGuard(port) {
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);

  return function guard(req, res, next) {
    const host = String(req.headers.host || '').toLowerCase();
    if (!allowedHosts.has(host)) {
      return res.status(403).json({ error: 'Host não autorizado' });
    }

    if (req.headers.origin) {
      let origin;
      try {
        origin = new URL(String(req.headers.origin));
      } catch {
        return res.status(403).json({ error: 'Origem inválida' });
      }
      if (origin.protocol !== 'http:' || origin.host.toLowerCase() !== host) {
        return res.status(403).json({ error: 'Origem não autorizada' });
      }
    }

    if (req.headers['sec-fetch-site'] === 'cross-site') {
      return res.status(403).json({ error: 'Pedido externo recusado' });
    }

    return next();
  };
}

module.exports = { localOnlyGuard };
