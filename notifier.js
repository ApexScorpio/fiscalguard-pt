const { execFile } = require('child_process');
const path = require('path');
const db = require('./db');

const SCRIPT_PATH = path.join(__dirname, 'notify.ps1');
const sentAlertsToday = new Set();

function sendNativeToast(title, message, iconType = "Info") {
    return new Promise((resolve, reject) => {
        const args = [
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", SCRIPT_PATH,
            "-Title", title,
            "-Message", message,
            "-IconType", iconType
        ];

        execFile("powershell", args, (error, stdout, stderr) => {
            if (error) {
                console.error("Erro ao enviar notificação Windows:", error.message);
                return reject(error);
            }
            resolve(stdout.trim());
        });
    });
}

async function checkAndTriggerAlerts() {
    const calendar = db.getCalendar();
    const profile = db.getProfile();
    const alertDays = profile.alertDays || [30, 7, 2, 0];
    const todayStr = new Date().toISOString().split('T')[0];

    const alertsTriggered = [];

    for (const obligation of calendar) {
        if (obligation.completed) continue;

        const days = obligation.daysRemaining;

        if (alertDays.includes(days) || days < 0) {
            const alertKey = `${obligation.id}-${days}-${todayStr}`;
            
            if (!sentAlertsToday.has(alertKey)) {
                sentAlertsToday.add(alertKey);

                let title = "FiscalGuard PT: Alerta de Prazo";
                let message = "";
                let icon = "Info";

                if (days < 0) {
                    title = `🚨 EM ATRASO: ${obligation.title}`;
                    message = `A obrigação terminou há ${Math.abs(days)} dia(s)! Regularize imediatamente para evitar coimas.`;
                    icon = "Error";
                } else if (days === 0) {
                    title = `⚠️ HOJE É O ÚLTIMO DIA: ${obligation.title}`;
                    message = `Prazo termina hoje! Não se esqueça de submeter ou pagar.`;
                    icon = "Warning";
                } else if (days <= 2) {
                    title = `⏳ URGENTE (Faltam ${days} dias): ${obligation.title}`;
                    message = `O prazo termina a ${obligation.deadline}. Prepare a documentação necessária.`;
                    icon = "Warning";
                } else if (days <= 7) {
                    title = `📅 Lembrete (Faltam ${days} dias): ${obligation.title}`;
                    message = `Prazo aproxima-se a ${obligation.deadline}.`;
                    icon = "Info";
                } else {
                    title = `ℹ️ Planeamento Fiscal: ${obligation.title}`;
                    message = `Faltam ${days} dias para o prazo (${obligation.deadline}).`;
                    icon = "Info";
                }

                try {
                    await sendNativeToast(title, message, icon);
                    alertsTriggered.push({ id: obligation.id, title, message, days });
                } catch (e) {
                    console.error("Falha ao disparar alerta:", e.message);
                }
            }
        }
    }

    return alertsTriggered;
}

module.exports = {
    sendNativeToast,
    checkAndTriggerAlerts
};
