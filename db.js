const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial DB schema
const defaultDB = {
    users: [],
    sessions: {},
    accounts: [],
    orders: [],
    otps: [],
    logs: [],
    settings: {
        autoAcceptEnabled: false,
        autoAcceptIntervalMinutes: 30
    }
};

class Database {
    constructor() {
        this.data = this._load();
    }

    _load() {
        if (fs.existsSync(DB_FILE)) {
            try {
                const content = fs.readFileSync(DB_FILE, 'utf8');
                return { ...defaultDB, ...JSON.parse(content) };
            } catch (err) {
                console.error('[DB] Error reading db.json, initializing fresh db:', err.message);
            }
        }
        this._save(defaultDB);
        return { ...defaultDB };
    }

    _save(data = this.data) {
        try {
            const tempFile = `${DB_FILE}.tmp`;
            fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
            fs.renameSync(tempFile, DB_FILE);
        } catch (err) {
            console.error('[DB] Save error:', err.message);
        }
    }

    // ----------------- USERS & AUTH -----------------

    hashPassword(password) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.scryptSync(password, salt, 64).toString('hex');
        return `${salt}:${hash}`;
    }

    verifyPassword(password, storedHash) {
        if (!storedHash || !storedHash.includes(':')) return false;
        const [salt, key] = storedHash.split(':');
        const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
        return key === testHash;
    }

    createUser({ username, email, password }) {
        const existing = this.data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
        if (existing) {
            throw new Error('An account with this email already exists.');
        }

        const newUser = {
            id: 'user_' + crypto.randomBytes(6).toString('hex'),
            username: username.trim(),
            email: email.trim().toLowerCase(),
            passwordHash: this.hashPassword(password),
            createdAt: new Date().toISOString()
        };

        this.data.users.push(newUser);
        this._save();
        return { id: newUser.id, username: newUser.username, email: newUser.email };
    }

    findUserByEmail(email) {
        return this.data.users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
    }

    findUserById(id) {
        const u = this.data.users.find(u => u.id === id);
        if (!u) return null;
        return { id: u.id, username: u.username, email: u.email, createdAt: u.createdAt };
    }

    createSession(userId) {
        const token = crypto.randomBytes(32).toString('hex');
        this.data.sessions[token] = {
            userId,
            createdAt: Date.now()
        };
        this._save();
        return token;
    }

    getSession(token) {
        if (!token || !this.data.sessions[token]) return null;
        const session = this.data.sessions[token];
        const user = this.findUserById(session.userId);
        return user;
    }

    deleteSession(token) {
        if (this.data.sessions[token]) {
            delete this.data.sessions[token];
            this._save();
        }
    }

    // ----------------- MEESHO ACCOUNTS -----------------

    getAccountsByUser(userId) {
        return this.data.accounts.filter(a => a.userId === userId);
    }

    getAccountById(accountId) {
        return this.data.accounts.find(a => a.id === accountId);
    }

    addAccount({ userId, storeName, emailOrPhone, password, workspaceHash }) {
        const id = 'acc_' + crypto.randomBytes(6).toString('hex');
        const sessionFile = path.join(__dirname, 'sessions', `${id}_auth.json`);

        const newAccount = {
            id,
            userId,
            storeName: storeName || 'New Store',
            emailOrPhone: emailOrPhone.trim(),
            password: password,
            workspaceHash: workspaceHash ? workspaceHash.trim() : '',
            status: 'CONNECTING',
            sessionFile,
            autoAccept: true,
            lastSyncAt: null,
            ordersCount: 0,
            otpsCount: 0,
            createdAt: new Date().toISOString()
        };

        this.data.accounts.push(newAccount);
        this._save();
        return newAccount;
    }

    updateAccount(accountId, updates) {
        const acc = this.getAccountById(accountId);
        if (!acc) return null;
        Object.assign(acc, updates);
        this._save();
        return acc;
    }

    deleteAccount(accountId, userId) {
        const accIndex = this.data.accounts.findIndex(a => a.id === accountId && a.userId === userId);
        if (accIndex === -1) return false;

        const acc = this.data.accounts[accIndex];
        // Clean up session file
        if (acc.sessionFile && fs.existsSync(acc.sessionFile)) {
            try { fs.unlinkSync(acc.sessionFile); } catch (e) {}
        }

        this.data.accounts.splice(accIndex, 1);
        // Remove orders and otps for this account
        this.data.orders = this.data.orders.filter(o => o.accountId !== accountId);
        this.data.otps = this.data.otps.filter(o => o.accountId !== accountId);
        this.data.logs = this.data.logs.filter(l => l.accountId !== accountId);
        this._save();
        return true;
    }

    // ----------------- ORDERS -----------------

    getOrdersByAccount(accountId) {
        return this.data.orders.filter(o => o.accountId === accountId);
    }

    getOrdersByUser(userId) {
        const userAccIds = new Set(this.getAccountsByUser(userId).map(a => a.id));
        return this.data.orders.filter(o => userAccIds.has(o.accountId));
    }

    setOrdersForAccount(accountId, storeName, ordersList) {
        // Remove existing orders for this account
        this.data.orders = this.data.orders.filter(o => o.accountId !== accountId);
        // Add updated orders tagged with accountId & storeName
        const taggedOrders = ordersList.map(o => ({
            ...o,
            accountId,
            storeName
        }));
        this.data.orders.push(...taggedOrders);

        // Update account count
        this.updateAccount(accountId, {
            ordersCount: ordersList.length,
            lastSyncAt: new Date().toISOString()
        });

        this._save();
        return taggedOrders;
    }

    removeAcceptedOrders(accountId, orderIds, removeAll = false) {
        if (removeAll) {
            this.data.orders = this.data.orders.filter(o => o.accountId !== accountId);
        } else if (orderIds && orderIds.length > 0) {
            const cleanIds = new Set(orderIds.map(id => id.split('_')[0]));
            this.data.orders = this.data.orders.filter(o => {
                if (o.accountId !== accountId) return true;
                const baseId = (o.sub_order_id || '').split('_')[0];
                return !cleanIds.has(baseId);
            });
        }
        const remainingCount = this.data.orders.filter(o => o.accountId === accountId).length;
        this.updateAccount(accountId, { ordersCount: remainingCount });
        this._save();
    }

    // ----------------- COURIER RETURN OTPS -----------------

    getOtpsByUser(userId) {
        const userAccIds = new Set(this.getAccountsByUser(userId).map(a => a.id));
        return this.data.otps.filter(o => userAccIds.has(o.accountId));
    }

    setOtpsForAccount(accountId, storeName, otpsList) {
        this.data.otps = this.data.otps.filter(o => o.accountId !== accountId);
        const tagged = otpsList.map(item => ({
            ...item,
            accountId,
            storeName
        }));
        this.data.otps.push(...tagged);
        this.updateAccount(accountId, { otpsCount: otpsList.length });
        this._save();
        return tagged;
    }

    // ----------------- LOGS -----------------

    addLog({ accountId = null, storeName = 'System', message, level = 'info' }) {
        const timestamp = new Date().toTimeString().split(' ')[0];
        const logEntry = {
            id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            timestamp,
            accountId,
            storeName,
            message,
            level
        };

        this.data.logs.push(logEntry);
        if (this.data.logs.length > 500) {
            this.data.logs.shift();
        }
        this._save();
        return logEntry;
    }

    getLogs(accountId = null, limit = 150) {
        let list = this.data.logs;
        if (accountId && accountId !== 'all') {
            list = list.filter(l => l.accountId === accountId);
        }
        return list.slice(-limit);
    }

    clearLogs(accountId = null) {
        if (accountId && accountId !== 'all') {
            this.data.logs = this.data.logs.filter(l => l.accountId !== accountId);
        } else {
            this.data.logs = [];
        }
        this._save();
    }

    // ----------------- SETTINGS -----------------

    getSettings() {
        return this.data.settings;
    }

    updateSettings(newSettings) {
        this.data.settings = { ...this.data.settings, ...newSettings };
        this._save();
        return this.data.settings;
    }
}

const db = new Database();

module.exports = {
    Database,
    db
};
