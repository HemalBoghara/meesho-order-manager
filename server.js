const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
require('dotenv').config();

const { db } = require('./db');
const { botManager } = require('./botManager');
const { scheduler } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Paths
const BASE_DIR = __dirname;
const STATIC_DIR = path.join(BASE_DIR, 'static');
const TEMPLATES_DIR = path.join(BASE_DIR, 'templates');

// Ensure static dirs
fs.mkdirSync(STATIC_DIR, { recursive: true });
fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
fs.mkdirSync(path.join(STATIC_DIR, 'css'), { recursive: true });
fs.mkdirSync(path.join(STATIC_DIR, 'js'), { recursive: true });

app.use('/static', express.static(STATIC_DIR));

// ----------------- AUTH HELPERS & MIDDLEWARE -----------------

function getAuthToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
        if (match) return match[1];
    }
    if (req.query && req.query.token) {
        return req.query.token;
    }
    return null;
}

function requireAuth(req, res, next) {
    const token = getAuthToken(req);
    if (!token) {
        return res.status(401).json({ status: 'unauthorized', message: 'Please log in to continue.' });
    }
    const user = db.getSession(token);
    if (!user) {
        return res.status(401).json({ status: 'unauthorized', message: 'Session expired. Please log in again.' });
    }
    req.user = user;
    req.token = token;
    next();
}

function optionalAuth(req, res, next) {
    const token = getAuthToken(req);
    if (token) {
        req.user = db.getSession(token);
        req.token = token;
    }
    next();
}

// ----------------- PUBLIC ROUTES -----------------

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'meesho-multi-order-manager',
        runtime: `Node.js ${process.version}`,
        stores_active: db.data.accounts.filter(a => a.status === 'CONNECTED').length
    });
});

// Serve frontend dashboard
app.get('/', (req, res) => {
    const indexFile = path.join(TEMPLATES_DIR, 'index.html');
    if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
    } else {
        res.send('<h1>Meesho Multi-Store Order Manager Loading...</h1>');
    }
});

// ----------------- USER AUTHENTICATION -----------------

// Register new user
app.post('/api/auth/register', (req, res) => {
    const { username = '', email = '', password = '' } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ status: 'error', message: 'Username, Email, and Password are required.' });
    }
    if (password.length < 5) {
        return res.status(400).json({ status: 'error', message: 'Password must be at least 5 characters.' });
    }

    try {
        const user = db.createUser({ username, email, password });
        const token = db.createSession(user.id);
        res.cookie('auth_token', token, { httpOnly: false, maxAge: 30 * 24 * 60 * 60 * 1000 });
        botManager.log(null, 'Auth', `New user registered: ${username} (${email})`, 'info');
        res.json({ status: 'success', user, token, message: 'Account created successfully!' });
    } catch (err) {
        res.status(400).json({ status: 'error', message: err.message });
    }
});

// Login user
app.post('/api/auth/login', (req, res) => {
    const { email = '', password = '' } = req.body;

    if (!email || !password) {
        return res.status(400).json({ status: 'error', message: 'Email and Password are required.' });
    }

    const user = db.findUserByEmail(email);
    if (!user || !db.verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ status: 'error', message: 'Invalid email or password.' });
    }

    const token = db.createSession(user.id);
    res.cookie('auth_token', token, { httpOnly: false, maxAge: 30 * 24 * 60 * 60 * 1000 });
    botManager.log(null, 'Auth', `User logged in: ${user.username}`, 'info');

    res.json({
        status: 'success',
        user: { id: user.id, username: user.username, email: user.email },
        token,
        message: 'Logged in successfully!'
    });
});

// Current user info
app.get('/api/auth/me', optionalAuth, (req, res) => {
    if (!req.user) {
        return res.json({ logged_in: false, user: null });
    }
    const accounts = db.getAccountsByUser(req.user.id);
    res.json({
        logged_in: true,
        user: req.user,
        accounts_count: accounts.length
    });
});

// Logout user
app.post('/api/auth/logout', (req, res) => {
    const token = getAuthToken(req);
    if (token) db.deleteSession(token);
    res.clearCookie('auth_token');
    res.json({ status: 'success', message: 'Logged out successfully.' });
});

// ----------------- MEESHO SELLER ACCOUNTS -----------------

// List all seller accounts for current user
app.get('/api/accounts', requireAuth, (req, res) => {
    const accounts = db.getAccountsByUser(req.user.id).map(a => ({
        id: a.id,
        store_name: a.storeName,
        email_or_phone: a.emailOrPhone,
        workspace_hash: a.workspaceHash,
        status: a.status,
        auto_accept: a.autoAccept,
        orders_count: a.ordersCount || 0,
        otps_count: a.otpsCount || 0,
        last_sync_at: a.lastSyncAt,
        created_at: a.createdAt
    }));
    res.json({ status: 'success', accounts });
});

// Add new Meesho seller account
app.post('/api/accounts', requireAuth, async (req, res) => {
    const { email_or_phone = '', password = '', store_name = '', workspace_hash = '' } = req.body;

    if (!email_or_phone || !password) {
        return res.status(400).json({ status: 'error', message: 'Meesho ID (Email/Phone) and Password are required.' });
    }

    // Check if account already exists for this user
    const existing = db.getAccountsByUser(req.user.id).find(a => a.emailOrPhone === email_or_phone.trim());
    if (existing) {
        return res.status(400).json({ status: 'error', message: 'This Meesho seller account is already added.' });
    }

    const account = db.addAccount({
        userId: req.user.id,
        storeName: store_name || email_or_phone.split('@')[0],
        emailOrPhone: email_or_phone,
        password,
        workspaceHash: workspace_hash
    });

    botManager.log(account.id, account.storeName, `Added new Meesho store account. Connecting...`, 'info');

    // Trigger login asynchronously or wait
    try {
        const loginRes = await botManager.loginAccount(account);
        res.json({
            status: 'success',
            message: `Successfully connected ${loginRes.storeName}!`,
            account: db.getAccountById(account.id)
        });
    } catch (err) {
        res.json({
            status: 'warning',
            message: `Account added, but initial login failed: ${err.message}. You can retry login anytime.`,
            account: db.getAccountById(account.id)
        });
    }
});

// Re-login / connect specific account
app.post('/api/accounts/:id/login', requireAuth, async (req, res) => {
    const account = db.getAccountById(req.params.id);
    if (!account || account.userId !== req.user.id) {
        return res.status(404).json({ status: 'error', message: 'Account not found.' });
    }

    try {
        const loginRes = await botManager.loginAccount(account);
        res.json({
            status: 'success',
            message: `Connected ${loginRes.storeName} successfully!`,
            account: db.getAccountById(account.id)
        });
    } catch (err) {
        res.status(400).json({ status: 'error', message: err.message });
    }
});

// Delete account
app.delete('/api/accounts/:id', requireAuth, async (req, res) => {
    const account = db.getAccountById(req.params.id);
    if (!account || account.userId !== req.user.id) {
        return res.status(404).json({ status: 'error', message: 'Account not found.' });
    }

    await botManager.closeAccountBrowser(account.id);
    db.deleteAccount(account.id, req.user.id);
    botManager.log(null, 'System', `Removed store account ${account.storeName}.`, 'info');

    res.json({ status: 'success', message: `Store ${account.storeName} removed successfully.` });
});

// ----------------- ORDERS (MULTI-STORE & PARALLEL) -----------------

// Fetch pending orders (simultaneous across all accounts or specific)
app.get('/api/orders/pending', requireAuth, async (req, res) => {
    const sync = req.query.sync === 'true';
    const accountId = req.query.accountId || 'all';

    if (sync) {
        if (accountId === 'all') {
            // Parallel simultaneous fetch across all stores
            const allOrders = await botManager.syncAllAccountsParallel(req.user.id);
            return res.json({
                status: 'success',
                message: `Simultaneously fetched orders from all connected stores!`,
                count: allOrders.length,
                orders: allOrders
            });
        } else {
            const acc = db.getAccountById(accountId);
            if (!acc || acc.userId !== req.user.id) {
                return res.status(404).json({ status: 'error', message: 'Account not found.' });
            }
            const orders = await botManager.fetchAccountOrders(acc);
            return res.json({
                status: 'success',
                message: `Fetched orders for ${acc.storeName}.`,
                count: orders.length,
                orders: orders
            });
        }
    }

    // Cached orders
    const orders = accountId === 'all'
        ? db.getOrdersByUser(req.user.id)
        : db.getOrdersByAccount(accountId);

    res.json({
        status: 'success',
        count: orders.length,
        orders
    });
});

// Accept Orders (single store or all stores simultaneously)
app.post('/api/orders/accept', requireAuth, async (req, res) => {
    const { account_id = 'all', accept_all = false, order_ids = [] } = req.body;

    if (account_id === 'all') {
        // Parallel accept across all stores
        const result = await botManager.acceptAllAccountsParallel(req.user.id);
        const remaining = db.getOrdersByUser(req.user.id);
        return res.json({
            status: 'success',
            message: `Simultaneously accepted ${result.totalAccepted} orders across all connected stores!`,
            accepted_count: result.totalAccepted,
            remaining_orders: remaining
        });
    }

    const acc = db.getAccountById(account_id);
    if (!acc || acc.userId !== req.user.id) {
        return res.status(404).json({ status: 'error', message: 'Store account not found.' });
    }

    try {
        const result = await botManager.acceptAccountOrders(acc, order_ids, accept_all);
        const remaining = db.getOrdersByUser(req.user.id);
        res.json({
            status: 'success',
            message: `Accepted ${result.acceptedCount} orders for ${acc.storeName}.`,
            accepted_count: result.acceptedCount,
            remaining_orders: remaining
        });
    } catch (err) {
        res.status(400).json({ status: 'error', message: err.message });
    }
});

// ----------------- COURIER RETURN OTPS (UNIFIED) -----------------

// Get Courier Return Delivery OTPs (simultaneously across all stores)
app.get('/api/returns/otp', requireAuth, async (req, res) => {
    const sync = req.query.sync === 'true';
    const accountId = req.query.accountId || 'all';

    if (sync) {
        if (accountId === 'all') {
            const allOtps = await botManager.fetchOtpsAllAccountsParallel(req.user.id);
            return res.json({
                status: 'success',
                message: `Simultaneously fetched Return Delivery OTPs across all stores!`,
                count: allOtps.length,
                otps: allOtps,
                last_updated: new Date().toTimeString().split(' ')[0]
            });
        } else {
            const acc = db.getAccountById(accountId);
            if (!acc || acc.userId !== req.user.id) {
                return res.status(404).json({ status: 'error', message: 'Account not found.' });
            }
            const otps = await botManager.fetchAccountOtps(acc);
            return res.json({
                status: 'success',
                message: `Fetched Return Delivery OTPs for ${acc.storeName}.`,
                count: otps.length,
                otps: otps,
                last_updated: new Date().toTimeString().split(' ')[0]
            });
        }
    }

    const otps = db.getOtpsByUser(req.user.id);
    res.json({
        status: 'success',
        count: otps.length,
        otps: otps,
        last_updated: new Date().toTimeString().split(' ')[0]
    });
});

// ----------------- STATUS & SCHEDULER -----------------

app.get('/api/status', optionalAuth, (req, res) => {
    if (!req.user) {
        return res.json({
            logged_in: false,
            user: null,
            accounts_count: 0,
            orders_count: 0,
            return_otps_count: 0,
            auto_accept: scheduler.getStatus()
        });
    }

    const accounts = db.getAccountsByUser(req.user.id);
    const orders = db.getOrdersByUser(req.user.id);
    const otps = db.getOtpsByUser(req.user.id);

    res.json({
        logged_in: true,
        user: req.user,
        accounts_count: accounts.length,
        connected_count: accounts.filter(a => a.status === 'CONNECTED').length,
        orders_count: orders.length,
        return_otps_count: otps.length,
        auto_accept: scheduler.getStatus()
    });
});

// Toggle auto-accept scheduler
app.post('/api/auto-accept/toggle', requireAuth, (req, res) => {
    const { enabled, interval_minutes = 30 } = req.body;

    if (enabled) {
        scheduler.start(interval_minutes);
    } else {
        scheduler.stop();
    }

    res.json({
        status: 'success',
        message: enabled
            ? `Multi-Store Auto-Accept enabled: Runs every ${interval_minutes} minutes simultaneously across all stores.`
            : 'Multi-Store Auto-Accept has been turned off.',
        scheduler: scheduler.getStatus()
    });
});

app.get('/api/auto-accept/status', (req, res) => {
    res.json(scheduler.getStatus());
});

// ----------------- TERMINAL LOGS -----------------

app.get('/api/logs', optionalAuth, (req, res) => {
    const accountId = req.query.accountId || 'all';
    res.json({
        logs: db.getLogs(accountId)
    });
});

app.post('/api/logs/clear', requireAuth, (req, res) => {
    const accountId = req.query.accountId || 'all';
    db.clearLogs(accountId);
    res.json({ status: 'cleared' });
});

// ----------------- STARTUP & SERVER LISTEN -----------------

function onStartup() {
    // If settings had auto-accept enabled, resume scheduler
    const settings = db.getSettings();
    if (settings.autoAcceptEnabled) {
        const interval = settings.autoAcceptIntervalMinutes || 30;
        scheduler.start(interval);
        botManager.log(null, 'System', `Resumed Multi-Store Auto-Accept scheduler on startup (Every ${interval} mins).`, 'info');
    }

    // Auto-migrate previous single account if exists and no users yet
    try {
        if (db.data.users.length === 0) {
            const configPath = path.join(BASE_DIR, 'config.json');
            const authPath = path.join(BASE_DIR, 'auth_state.json');
            if (fs.existsSync(configPath)) {
                const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                const meesho = cfg.meesho || {};
                if (meesho.email_or_phone) {
                    const defaultUser = db.createUser({
                        username: 'Admin',
                        email: 'admin@meesho.local',
                        password: 'admin'
                    });
                    const acc = db.addAccount({
                        userId: defaultUser.id,
                        storeName: meesho.store_name || 'DIYORA Venture',
                        emailOrPhone: meesho.email_or_phone,
                        password: meesho.password || '',
                        workspaceHash: meesho.workspace_hash || '4ntb1'
                    });
                    if (fs.existsSync(authPath)) {
                        fs.copyFileSync(authPath, acc.sessionFile);
                        db.updateAccount(acc.id, { status: 'CONNECTED' });
                    }
                    botManager.log(acc.id, acc.storeName, 'Migrated existing seller account to multi-tenant system.', 'info');
                }
            }
        }
    } catch (e) {
        console.error('Migration note:', e.message);
    }
}

app.listen(PORT, () => {
    onStartup();

    console.log('\n' + '='.repeat(65));
    console.log(' 🚀 Meesho Multi-Store Order Manager (Node.js) Running');
    console.log(` 🌐 Port: ${PORT}`);
    console.log(` 🌐 Local URL: http://127.0.0.1:${PORT}`);
    console.log('='.repeat(65) + '\n');

    if (process.platform === 'win32' && process.env.NODE_ENV !== 'production' && !process.env.CI) {
        setTimeout(() => {
            exec(`start http://127.0.0.1:${PORT}`, () => {});
        }, 1500);
    }
});

module.exports = app;
