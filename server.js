const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
require('dotenv').config();

const { botInstance } = require('./meeshoBot');
const { scheduler } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';

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

// Static assets
app.use('/static', express.static(STATIC_DIR));

// Helper Functions
function isBotLoggedIn() {
    const hasAuth = fs.existsSync(botInstance.authFile);
    const hasAcc = Boolean(botInstance.currentEmail) || Boolean(botInstance.workspaceHash);
    return Boolean(hasAuth || hasAcc);
}

function getSafeStoreName() {
    if (botInstance.storeName && botInstance.storeName !== 'Not Logged In') {
        return botInstance.storeName;
    }
    if (botInstance.currentEmail) {
        const prefix = botInstance.currentEmail.split('@')[0].replace(/\./g, ' ');
        const formatted = prefix.charAt(0).toUpperCase() + prefix.slice(1);
        if (botInstance.workspaceHash) {
            return `${formatted} (${botInstance.workspaceHash})`;
        }
        return formatted;
    }
    return 'Meesho Seller';
}

function formatTimeOnly() {
    const d = new Date();
    return d.toTimeString().split(' ')[0];
}

// ------------------- ROUTES -------------------

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'meesho-order-manager', runtime: 'Node.js ' + process.version });
});

// Serve frontend
app.get('/', (req, res) => {
    const indexFile = path.join(TEMPLATES_DIR, 'index.html');
    if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
    } else {
        res.send('<h1>Meesho Order Manager Dashboard Loading...</h1>');
    }
});

// Status API
app.get('/api/status', (req, res) => {
    const loggedIn = isBotLoggedIn();
    const sName = loggedIn ? getSafeStoreName() : '';
    const cachedOrders = loggedIn ? botInstance.getCachedOrders() : [];
    const cachedOtps = loggedIn ? botInstance.getCachedOtps() : [];

    res.json({
        is_busy: botInstance.isBusy,
        logged_in: loggedIn,
        orders_count: cachedOrders.length,
        return_otps_count: cachedOtps.length,
        user_data_exists: loggedIn,
        recent_logs_count: botInstance.logsBuffer.length,
        store_name: sName,
        email: loggedIn ? botInstance.currentEmail : '',
        workspace_hash: loggedIn ? botInstance.workspaceHash : '',
        auto_accept: scheduler.getStatus()
    });
});

// Courier Return Delivery OTPs API
app.get('/api/returns/otp', async (req, res) => {
    const loggedIn = isBotLoggedIn();
    if (!loggedIn) {
        return res.json({
            status: 'unauthorized',
            logged_in: false,
            otps: [],
            count: 0,
            last_updated: 'Never',
            message: 'Please log in to view Return Delivery OTPs.'
        });
    }

    const sync = req.query.sync === 'true';

    if (sync) {
        if (botInstance.isBusy) {
            return res.status(400).json({ message: 'Bot is currently busy with another operation.' });
        }

        const fetchedOtps = await botInstance.fetchCourierReturnOtps();
        return res.json({
            status: 'success',
            message: `Fetched ${fetchedOtps.length} Courier Return OTP(s) from Meesho.`,
            otps: fetchedOtps,
            count: fetchedOtps.length,
            last_updated: formatTimeOnly()
        });
    }

    const otps = botInstance.getCachedOtps();
    return res.json({
        status: 'success',
        logged_in: true,
        otps: otps,
        count: otps.length,
        last_updated: formatTimeOnly()
    });
});

// Login API
app.post('/api/login', async (req, res) => {
    if (botInstance.isBusy) {
        return res.status(400).json({ message: 'Bot is currently busy with another operation.' });
    }

    const { email_or_phone = '', password = '' } = req.body;

    if (email_or_phone) {
        botInstance.config.meesho = botInstance.config.meesho || {};
        botInstance.config.meesho.email_or_phone = email_or_phone;
    }
    if (password) {
        botInstance.config.meesho = botInstance.config.meesho || {};
        botInstance.config.meesho.password = password;
    }
    botInstance.saveConfig(botInstance.config);

    const loginEmail = email_or_phone || (botInstance.config.meesho && botInstance.config.meesho.email_or_phone) || '';
    const loginPwd = password || (botInstance.config.meesho && botInstance.config.meesho.password) || '';

    const loginRes = await botInstance.login(loginEmail, loginPwd);

    if (loginRes.success) {
        res.json({
            status: 'success',
            logged_in: true,
            store_name: botInstance.storeName,
            email: botInstance.currentEmail,
            workspace_hash: botInstance.workspaceHash,
            orders_count: botInstance.getCachedOrders().length,
            return_otps_count: botInstance.getCachedOtps().length,
            message: `Logged in as ${botInstance.storeName}`
        });
    } else {
        res.status(401).json({
            status: 'error',
            message: loginRes.message || 'Login failed. Please check credentials.'
        });
    }
});

// Session Check API
app.get('/api/check-session', async (req, res) => {
    const status = await botInstance.checkLoginStatus();
    res.json(status);
});

// Pending Orders API
app.get('/api/orders/pending', async (req, res) => {
    const loggedIn = isBotLoggedIn();
    if (!loggedIn) {
        return res.json({
            status: 'unauthorized',
            logged_in: false,
            count: 0,
            orders: [],
            message: 'Please log in to view pending orders.'
        });
    }

    const sync = req.query.sync === 'true';

    if (sync) {
        if (botInstance.isBusy) {
            return res.status(400).json({ message: 'Bot is currently busy with another operation.' });
        }

        const fetchedOrders = await botInstance.fetchPendingOrders();
        return res.json({
            status: 'success',
            message: `Fetched ${fetchedOrders.length} pending orders from Meesho.`,
            orders: fetchedOrders,
            count: fetchedOrders.length
        });
    }

    const orders = botInstance.getCachedOrders();
    return res.json({
        status: 'success',
        logged_in: true,
        count: orders.length,
        orders: orders
    });
});

// Accept Orders API
app.post('/api/orders/accept', async (req, res) => {
    if (botInstance.isBusy) {
        return res.status(400).json({ message: 'Bot is currently busy with another operation.' });
    }

    const { accept_all = false, order_ids = [] } = req.body;

    const acceptRes = await botInstance.acceptOrders(order_ids, accept_all);
    const accCount = acceptRes.accepted_count || 0;
    const isSuccess = Boolean(acceptRes.success && accCount > 0);

    return res.json({
        status: isSuccess ? 'success' : 'error',
        message: acceptRes.message,
        accepted_count: accCount,
        remaining_orders: botInstance.getCachedOrders()
    });
});

// Auto-Accept Status
app.get('/api/auto-accept/status', (req, res) => {
    res.json(scheduler.getStatus());
});

// Auto-Accept Toggle
app.post('/api/auto-accept/toggle', (req, res) => {
    const { enabled, interval_minutes = 30 } = req.body;

    let msg = '';
    if (enabled) {
        scheduler.start(interval_minutes);
        msg = `Auto-Accept scheduled: Runs every ${interval_minutes} minutes.`;
    } else {
        scheduler.stop();
        msg = 'Auto-Accept has been turned off.';
    }

    res.json({
        status: 'success',
        message: msg,
        scheduler: scheduler.getStatus()
    });
});

// Logs API
app.get('/api/logs', (req, res) => {
    res.json({
        logs: botInstance.logsBuffer,
        is_busy: botInstance.isBusy
    });
});

// Clear Logs
app.post('/api/logs/clear', (req, res) => {
    botInstance.logsBuffer = [];
    res.json({ status: 'cleared' });
});

// Config API
app.get('/api/config', (req, res) => {
    const cfg = botInstance.loadConfig();
    const safeMeesho = { ...(cfg.meesho || {}) };
    if (safeMeesho.password) {
        safeMeesho.password = '••••••••';
    }
    res.json({
        meesho: safeMeesho,
        app: cfg.app || {},
        auto_accept: cfg.auto_accept || {}
    });
});

// Logout API
app.post('/api/logout', async (req, res) => {
    await botInstance.logout();
    res.json({ status: 'success', message: 'Logged out successfully from Meesho.' });
});

// Close Browser API
app.post('/api/browser/close', async (req, res) => {
    await botInstance.close();
    res.json({ status: 'closed', message: 'Browser session closed.' });
});

// Startup hook
function onStartup() {
    const cfg = botInstance.loadConfig();
    const meeshoCfg = cfg.meesho || {};
    if (meeshoCfg.email_or_phone) {
        botInstance.currentEmail = meeshoCfg.email_or_phone;
    }
    if (meeshoCfg.workspace_hash) {
        botInstance.workspaceHash = meeshoCfg.workspace_hash;
    }
    if (meeshoCfg.store_name && meeshoCfg.store_name !== 'Not Logged In') {
        botInstance.storeName = meeshoCfg.store_name;
    } else if (isBotLoggedIn()) {
        botInstance.storeName = getSafeStoreName();
    }

    const autoCfg = cfg.auto_accept || {};
    if (autoCfg.enabled) {
        const interval = autoCfg.interval_minutes || 30;
        scheduler.start(interval);
        botInstance.log(`Resumed Auto-Accept scheduler on startup (Every ${interval} mins).`, 'info');
    }
}

// Start Server
app.listen(PORT, HOST, () => {
    onStartup();

    console.log('\n' + '='.repeat(60));
    console.log(' 🚀 Meesho Order Manager Starting (Node.js)...');
    console.log(` 🌐 Host: ${HOST} | Port: ${PORT}`);
    console.log(` 🌐 Local URL: http://127.0.0.1:${PORT}`);
    console.log('='.repeat(60) + '\n');

    // Auto-open browser on local Windows development
    if (process.platform === 'win32' && process.env.NODE_ENV !== 'production' && !process.env.CI) {
        setTimeout(() => {
            const openCmd = `start http://127.0.0.1:${PORT}`;
            exec(openCmd, () => {});
        }, 1500);
    }
});

module.exports = app;
