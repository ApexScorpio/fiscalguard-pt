'use strict';

function summarizeSync(at, ss) {
    const atOk = Boolean(at && at.success === true);
    const ssOk = Boolean(ss && ss.success === true);
    return {
        success: Boolean(atOk && ssOk),
        partialSuccess: Boolean(atOk !== ssOk),
        requiresLogin: Boolean((at && at.requiresLogin === true) || (ss && ss.requiresLogin === true)),
        portals: {
            financas: atOk ? 'succeeded' : (at && at.requiresLogin === true ? 'login_required' : 'failed'),
            segurancaSocial: ssOk ? 'succeeded' : (ss && ss.requiresLogin === true ? 'login_required' : 'failed')
        }
    };
}

module.exports = { summarizeSync };
