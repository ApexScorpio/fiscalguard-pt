const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./db');

const SYNC_CONFIG_FILE = path.join(__dirname, 'data', 'sync-config.json');

class MultiDeviceSync {
    constructor() {
        this.config = this.loadConfig();
    }

    loadConfig() {
        try {
            if (fs.existsSync(SYNC_CONFIG_FILE)) {
                return JSON.parse(fs.readFileSync(SYNC_CONFIG_FILE, 'utf8'));
            }
        } catch (e) {
            console.error("Erro ao carregar sync-config.json:", e.message);
        }

        const isLaptop = os.hostname().toLowerCase().includes('laptop') || os.hostname().toLowerCase().includes('portatil');
        const defaultName = isLaptop ? "Portátil" : "PC Principal";

        // Preferência para pasta em S:\ se existir ou pasta partilhada
        const defaultShared = fs.existsSync('S:\\') ? 'S:\\FiscalGuard-Sync' : path.join(os.homedir(), 'OneDrive', 'FiscalGuard-Sync');

        const newConfig = {
            deviceId: "dev-" + crypto.randomBytes(4).toString('hex'),
            deviceName: `${defaultName} (${os.hostname()})`,
            pairingCode: "FG-" + Math.floor(100000 + Math.random() * 900000),
            secretKey: crypto.randomBytes(16).toString('hex'),
            pairedDevices: [
                {
                    id: "dev-local",
                    name: `${defaultName} (${os.hostname()})`,
                    type: "current",
                    lastSync: new Date().toISOString(),
                    status: "online"
                }
            ],
            syncMode: "hybrid",
            sharedFolderPath: defaultShared,
            lastSyncTimestamp: new Date().toISOString()
        };

        this.saveConfig(newConfig);
        return newConfig;
    }

    saveConfig(cfg = this.config) {
        try {
            this.config = cfg;
            fs.writeFileSync(SYNC_CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
        } catch (e) {
            console.error("Erro ao salvar sync-config.json:", e.message);
        }
    }

    getSyncStatus() {
        return {
            deviceId: this.config.deviceId,
            deviceName: this.config.deviceName,
            pairingCode: this.config.pairingCode,
            secretKey: this.config.secretKey,
            syncMode: this.config.syncMode,
            pairedDevices: this.config.pairedDevices,
            lastSyncTimestamp: this.config.lastSyncTimestamp,
            sharedFolderExists: fs.existsSync(this.config.sharedFolderPath),
            sharedFolderPath: this.config.sharedFolderPath
        };
    }

    pairNewDevice(deviceName, code) {
        if (!code || code.trim() !== this.config.pairingCode) {
            throw new Error("Código de emparelhamento inválido.");
        }

        const newDevice = {
            id: "dev-" + crypto.randomBytes(4).toString('hex'),
            name: deviceName || "Portátil Conectado",
            type: "remote",
            lastSync: new Date().toISOString(),
            status: "online"
        };

        this.config.pairedDevices.push(newDevice);
        this.config.lastSyncTimestamp = new Date().toISOString();
        this.saveConfig();

        return {
            success: true,
            device: newDevice,
            currentState: db.data
        };
    }

    exportSyncPacket() {
        const payload = {
            version: "1.0",
            sourceDevice: this.config.deviceName,
            timestamp: new Date().toISOString(),
            database: db.data
        };

        const jsonStr = JSON.stringify(payload);
        const cipher = crypto.createCipheriv(
            'aes-128-cbc',
            Buffer.from(this.config.secretKey, 'hex'),
            Buffer.alloc(16, 0)
        );
        let encrypted = cipher.update(jsonStr, 'utf8', 'base64');
        encrypted += cipher.final('base64');

        return {
            pairingCode: this.config.pairingCode,
            token: encrypted,
            timestamp: payload.timestamp
        };
    }

    importSyncPacket(token, secretKey) {
        try {
            const key = Buffer.from(secretKey || this.config.secretKey, 'hex');
            const decipher = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0));
            let decrypted = decipher.update(token, 'base64', 'utf8');
            decrypted += decipher.final('utf8');

            const payload = JSON.parse(decrypted);

            if (!payload.database) {
                throw new Error("Formato de sincronização inválido.");
            }

            db.data = payload.database;
            db.save();

            this.config.lastSyncTimestamp = new Date().toISOString();
            
            const existing = this.config.pairedDevices.find(d => d.name === payload.sourceDevice);
            if (existing) {
                existing.lastSync = new Date().toISOString();
                existing.status = "online";
            } else {
                this.config.pairedDevices.push({
                    id: "dev-" + crypto.randomBytes(4).toString('hex'),
                    name: payload.sourceDevice || "Portátil Conectado",
                    type: "remote",
                    lastSync: new Date().toISOString(),
                    status: "online"
                });
            }

            this.saveConfig();

            return {
                success: true,
                sourceDevice: payload.sourceDevice,
                timestamp: this.config.lastSyncTimestamp
            };
        } catch (e) {
            throw new Error(`Falha ao decifrar e sincronizar dados: ${e.message}`);
        }
    }

    syncViaSharedFolder() {
        const folder = this.config.sharedFolderPath;
        if (!fs.existsSync(folder)) {
            try {
                fs.mkdirSync(folder, { recursive: true });
            } catch (e) {
                return { success: false, message: `Pasta não acessível: ${e.message}` };
            }
        }

        const syncFilePath = path.join(folder, 'fiscalguard_sync_vault.json');

        if (fs.existsSync(syncFilePath)) {
            const stats = fs.statSync(syncFilePath);
            const localLast = new Date(this.config.lastSyncTimestamp).getTime();
            if (stats.mtimeMs > localLast + 2000) {
                try {
                    const raw = fs.readFileSync(syncFilePath, 'utf8');
                    const packet = JSON.parse(raw);
                    this.importSyncPacket(packet.token, packet.secretKey);
                    return { success: true, action: "imported", time: new Date().toISOString() };
                } catch (e) {
                    console.error("Erro ao ler da pasta partilhada:", e.message);
                }
            }
        }

        const packet = this.exportSyncPacket();
        packet.secretKey = this.config.secretKey;
        fs.writeFileSync(syncFilePath, JSON.stringify(packet, null, 2), 'utf8');
        return { success: true, action: "exported", time: new Date().toISOString() };
    }
}

module.exports = new MultiDeviceSync();
