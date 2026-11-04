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

/**
 * Envia uma mensagem direta de alerta para o telemóvel via Telegram Bot API
 */
async function sendTelegramMessage(text, options = {}) {
    const settings = (typeof db.getSettings === 'function' ? db.getSettings() : {}) || {};
    const tgConfig = settings.telegram || {};

    const botToken = options.botToken || tgConfig.botToken || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = options.chatId || tgConfig.chatId || process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
        return { success: false, reason: "Telegram não configurado (Falta Bot Token ou Chat ID)" };
    }

    try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            })
        });

        const data = await resp.json();
        if (data.ok) {
            return { success: true, messageId: data.result.message_id };
        } else {
            console.error("[Telegram Error]", data);
            return { success: false, error: data.description };
        }
    } catch (err) {
        console.error("[Telegram Fetch Error]", err.message);
        return { success: false, error: err.message };
    }
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

                    // Disparar também via Telegram se configurado
                    const tgText = `*🛡️ FiscalGuard PT — Alerta Fiscal*\n\n${title}\n\n${message}\n📅 *Prazo:* \`${obligation.deadline}\`\n\n_Consulta os detalhes no teu painel FiscalGuard._`;
                    await sendTelegramMessage(tgText);
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
    sendTelegramMessage,
    checkAndTriggerAlerts
};
