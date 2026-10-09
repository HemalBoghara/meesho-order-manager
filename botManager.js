const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db } = require('./db');
const { ensureChromiumInstalled } = require('./browserHelper');

const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

class BotManager {
    constructor() {
        this.activeBrowsers = new Map(); // accountId -> { browser, context, page }
        this.busyAccounts = new Set();    // Set of accountIds currently running an action

        // Cloud / Headless detection
        const headlessEnv = process.env.HEADLESS;
        if (headlessEnv !== undefined) {
            this.isHeadless = headlessEnv.toLowerCase() === 'true' || headlessEnv === '1';
        } else if (process.env.NODE_ENV === 'production') {
            this.isHeadless = true;
        } else {
            this.isHeadless = false;
        }
    }

    log(accountId, storeName, message, level = 'info') {
        const prefix = storeName ? `[${storeName}]` : '[System]';
        console.log(`${new Date().toTimeString().split(' ')[0]} ${prefix} ${message}`);
        return db.addLog({ accountId, storeName: storeName || 'System', message, level });
    }

    async getPageForAccount(account, forceClean = false) {
        const accountId = account.id;

        if (!forceClean && this.activeBrowsers.has(accountId)) {
            const current = this.activeBrowsers.get(accountId);
            if (current.page && !current.page.isClosed()) {
                return current.page;
            }
        }

        await this.closeAccountBrowser(accountId);

        const launchArgs = [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ];

        if (!this.isHeadless) {
            launchArgs.push('--start-maximized');
        }

        const baseLaunchOptions = {
            headless: this.isHeadless,
            args: launchArgs
        };

        let browser = null;

        // Try System Chrome -> System Edge -> Playwright Chromium
        try {
            browser = await chromium.launch({ ...baseLaunchOptions, channel: 'chrome' });
        } catch (chromeErr) {
            try {
                browser = await chromium.launch({ ...baseLaunchOptions, channel: 'msedge' });
            } catch (edgeErr) {
                try {
                    browser = await chromium.launch(baseLaunchOptions);
                } catch (pwErr) {
                    if (pwErr.message.includes("Executable doesn't exist") || pwErr.message.includes("playwright install")) {
                        this.log(accountId, account.storeName, 'Chromium browser missing on server. Auto-downloading Playwright Chromium now...', 'warn');
                        await ensureChromiumInstalled((msg) => this.log(accountId, account.storeName, msg, 'info'));
                        this.log(accountId, account.storeName, 'Retrying browser launch after installation...', 'info');
                        browser = await chromium.launch(baseLaunchOptions);
                    } else {
                        throw pwErr;
                    }
                }
            }
        }

        const contextArgs = {
            viewport: { width: 1280, height: 800 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        };

        const sessionFile = account.sessionFile || path.join(SESSIONS_DIR, `${accountId}_auth.json`);

        if (!forceClean && fs.existsSync(sessionFile)) {
            try {
                const stat = fs.statSync(sessionFile);
                if (stat.size > 20) {
                    contextArgs.storageState = sessionFile;
                }
            } catch (e) {}
        }

        const context = await browser.newContext(contextArgs);

        // Anti-detection stealth
        await context.addInitScript(`
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'hi'] });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        `);

        const page = await context.newPage();
        this.activeBrowsers.set(accountId, { browser, context, page });
        return page;
    }

    async closeAccountBrowser(accountId) {
        if (this.activeBrowsers.has(accountId)) {
            const { browser, context } = this.activeBrowsers.get(accountId);
            try { if (context) await context.close(); } catch (e) {}
            try { if (browser) await browser.close(); } catch (e) {}
            this.activeBrowsers.delete(accountId);
        }
    }

    async saveSessionState(account) {
        const accountId = account.id;
        if (this.activeBrowsers.has(accountId)) {
            const { context } = this.activeBrowsers.get(accountId);
            if (context) {
                const sessionFile = account.sessionFile || path.join(SESSIONS_DIR, `${accountId}_auth.json`);
                try {
                    await context.storageState({ path: sessionFile });
                    db.updateAccount(accountId, { sessionFile });
                } catch (e) {}
            }
        }
    }

    _extractWorkspaceHash(url) {
        if (!url) return null;
        const match = url.match(/\/panel\/v3\/new\/(?:growth|fulfillment|root)\/([a-zA-Z0-9_-]+)/);
        if (match && match[1] !== 'login' && match[1] !== 'root') {
            return match[1];
        }
        return null;
    }

    async _extractStoreName(page) {
        try {
            return await page.evaluate(() => {
                const bodyText = document.body.innerText || '';
                const match = bodyText.match(/Welcome back,?\s*([^\n\r]+)/i);
                if (match && match[1].trim()) return match[1].trim().split('\n')[0];

                const storeEl = document.querySelector(
                    '[data-testid*="seller"], [data-testid*="store"], [class*="store-name"], [class*="seller-name"], [class*="supplier-info"], [class*="account-info"]'
                );
                if (storeEl && storeEl.innerText.trim()) return storeEl.innerText.trim().split('\n')[0];

                const asideEl = document.querySelector('aside, [class*="sidebar"], [class*="navigation"]');
                if (asideEl) {
                    const lines = asideEl.innerText.split('\n').map(l => l.trim()).filter(Boolean);
                    for (const l of lines.slice(0, 5)) {
                        if (l.length >= 3 && !['notices', 'support', 'home', 'orders', 'returns'].includes(l.toLowerCase())) {
                            return l;
                        }
                    }
                }
                return '';
            });
        } catch (e) {
            return '';
        }
    }

    async _dismissPopupModals(page) {
        try {
            await page.evaluate(() => {
                const closeBtns = document.querySelectorAll(
                    'button[aria-label*="close" i], button[class*="close" i], svg[class*="close" i], .modal-close'
                );
                closeBtns.forEach(b => {
                    const txt = (b.innerText || '').toLowerCase();
                    if (!txt.includes('accept') && !txt.includes('confirm') && !txt.includes('order')) {
                        try { b.click(); } catch (e) {}
                    }
                });
                document.querySelectorAll('div[class*="z-modal"], div[class*="overlay"]').forEach(el => {
                    const t = el.innerText || '';
                    if (!t.includes('Accepting orders') && !t.includes('Accept Order') && !t.includes('Processing')) {
                        el.remove();
                    }
                });
            });
        } catch (e) {}
    }

    // ----------------- LOGIN ACCOUNT -----------------

    async loginAccount(account, waitTimeoutSec = 60) {
        const accountId = account.id;
        if (this.busyAccounts.has(accountId)) {
            throw new Error(`Account ${account.storeName} is currently busy with another operation.`);
        }

        this.busyAccounts.add(accountId);
        this.log(accountId, account.storeName, `Starting login for ${account.emailOrPhone}...`);

        try {
            const page = await this.getPageForAccount(account, true);

            await page.goto('https://supplier.meesho.com/panel/v3/new/root/login', {
                timeout: 45000,
                waitUntil: 'domcontentloaded'
            });
            await this._delay(2500);
            await this._dismissPopupModals(page);

            this.log(accountId, account.storeName, 'Entering credentials...');
            const emailLoc = page.locator("input[name='emailOrPhone'], input[type='text'], input[placeholder*='email' i], input[placeholder*='number' i], input[type='tel']").first();
            await emailLoc.waitFor({ state: 'visible', timeout: 30000 });
            await emailLoc.fill(account.emailOrPhone, { force: true });

            const pwdLoc = page.locator("input[name='password'], input[type='password']").first();
            await pwdLoc.waitFor({ state: 'visible', timeout: 15000 });
            await pwdLoc.fill(account.password, { force: true });

            await this._delay(500);

            const submitBtn = page.locator("button[type='submit'], button:has-text('Log in')").first();
            await submitBtn.waitFor({ state: 'visible', timeout: 5000 });
            await submitBtn.click({ force: true });
            this.log(accountId, account.storeName, "Submitted login form. Waiting for Meesho Supplier Panel...");

            let elapsed = 0;
            while (elapsed < waitTimeoutSec) {
                await this._delay(1500);
                elapsed += 1.5;

                if (page.isClosed()) {
                    throw new Error('Browser window was closed during login.');
                }

                const currentUrl = page.url();
                if (currentUrl.includes('/panel') && !currentUrl.includes('/login')) {
                    const hash = this._extractWorkspaceHash(currentUrl) || account.workspaceHash;
                    await this._dismissPopupModals(page);
                    await this._delay(1500);

                    const detectedStoreName = await this._extractStoreName(page);
                    const finalStoreName = detectedStoreName || account.storeName || (account.emailOrPhone.split('@')[0]);

                    await this.saveSessionState(account);

                    db.updateAccount(accountId, {
                        status: 'CONNECTED',
                        storeName: finalStoreName,
                        workspaceHash: hash
                    });

                    this.log(accountId, finalStoreName, `Successfully logged in as: ${finalStoreName} (${hash})!`, 'info');
                    return {
                        success: true,
                        storeName: finalStoreName,
                        workspaceHash: hash
                    };
                }
            }

            throw new Error('Login timed out. Please check credentials or OTP.');
        } catch (err) {
            this.log(accountId, account.storeName, `Login failed: ${err.message}`, 'error');
            db.updateAccount(accountId, { status: 'DISCONNECTED' });
            throw err;
        } finally {
            this.busyAccounts.delete(accountId);
        }
    }

    // ----------------- FETCH ORDERS (SINGLE ACCOUNT) -----------------

    async fetchAccountOrders(account) {
        const accountId = account.id;
        if (this.busyAccounts.has(accountId)) {
            this.log(accountId, account.storeName, 'Account busy, skipping order fetch for now.', 'warning');
            return db.getOrdersByAccount(accountId);
        }

        this.busyAccounts.add(accountId);
        this.log(accountId, account.storeName, `Fetching live pending orders...`);

        try {
            const page = await this.getPageForAccount(account);

            let hash = account.workspaceHash || this._extractWorkspaceHash(page.url()) || '4ntb1';
            const targetUrl = `https://supplier.meesho.com/panel/v3/new/fulfillment/${hash}/orders/pending`;

            await page.goto(targetUrl, { timeout: 40000, waitUntil: 'domcontentloaded' });
            await this._delay(3000);

            if (page.url().includes('/login')) {
                this.log(accountId, account.storeName, 'Session expired. Re-login required.', 'warning');
                db.updateAccount(accountId, { status: 'DISCONNECTED' });
                return db.getOrdersByAccount(accountId);
            }

            await this._dismissPopupModals(page);

            const pendingTab = page.locator("button[role='tab']:has-text('Pending'), [role='tab']:has-text('Pending')").first();
            if ((await pendingTab.count()) > 0) {
                const isSelected = (await pendingTab.getAttribute('aria-selected')) === 'true';
                if (!isSelected) {
                    await pendingTab.click();
                    await this._delay(2000);
                }
            }

            await page.evaluate(() => window.scrollBy(0, 400));
            await this._delay(1500);

            try {
                await page.waitForSelector('table tbody tr, tr[data-index]', { timeout: 6000 });
            } catch (e) {}

            const orders = await this._parseOrdersFromDom(page);
            db.setOrdersForAccount(accountId, account.storeName, orders);

            this.log(accountId, account.storeName, `Retrieved ${orders.length} pending order(s).`, 'info');
            return orders;
        } catch (err) {
            this.log(accountId, account.storeName, `Error fetching orders: ${err.message}`, 'error');
            return db.getOrdersByAccount(accountId);
        } finally {
            this.busyAccounts.delete(accountId);
        }
    }

    async _parseOrdersFromDom(page) {
        try {
            return await page.evaluate(() => {
                const results = [];
                const rows = document.querySelectorAll('table tbody tr, tr');

                rows.forEach(row => {
                    const text = row.innerText || '';
                    if (!text.trim() || text.includes('Product Details') || text.includes('Sub-order ID') || text.includes('Download Orders Data')) {
                        return;
                    }

                    const idMatch = text.match(/(\d{15,22}(?:_\d+)?)/);
                    if (!idMatch) return;

                    let subOrderId = idMatch[1];
                    if (!subOrderId.includes('_')) subOrderId += '_1';

                    let sku = 'N/A';
                    const skuMatch = text.match(/([A-Za-z0-9_-]+(?:DIYORA|HYEON)[A-Za-z0-9_-]*)/i) ||
                                     text.match(/SKU ID\s*\n*\s*([A-Za-z0-9_-]+)/i) ||
                                     text.match(/([A-Za-z0-9_]{6,})/);
                    if (skuMatch) sku = skuMatch[1];

                    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3);
                    let productTitle = 'Product Item';
                    for (const l of lines) {
                        if (!l.includes('Order ID:') && !l.includes('Sub-order') && !l.includes('SKU') && !l.includes('Accept') && !l.includes('Cancel') && isNaN(l)) {
                            productTitle = l;
                            break;
                        }
                    }

                    const qtyMatch = text.match(/Quantity\s*(\d+)/i) || text.match(/\b([1-9]\d?)\b\s*(?:Size|Pcs|Qty)/);
                    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

                    const today = new Date();
                    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const orderDate = `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;

                    let slaDate = 'Today';
                    const slaMatch = text.match(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*)/i);
                    if (slaMatch) slaDate = slaMatch[1].trim();

                    const imgs = Array.from(row.querySelectorAll('img'));
                    let imgUrl = '';
                    for (const im of imgs) {
                        if (im.src && !im.src.includes('checkbox') && !im.src.includes('.svg')) {
                            imgUrl = im.src;
                            break;
                        }
                    }

                    results.push({
                        sub_order_id: subOrderId,
                        sku: sku,
                        product_name: productTitle.substring(0, 80),
                        quantity: qty,
                        order_date: orderDate,
                        sla_date: slaDate,
                        status: 'PENDING',
                        price: 0,
                        image_url: imgUrl
                    });
                });
                return results;
            });
        } catch (e) {
            return [];
        }
    }

    // ----------------- ACCEPT ORDERS (SINGLE ACCOUNT) -----------------

    async acceptAccountOrders(account, orderIds = null, acceptAll = false) {
        const accountId = account.id;
        if (this.busyAccounts.has(accountId)) {
            throw new Error(`Account ${account.storeName} is busy.`);
        }

        this.busyAccounts.add(accountId);
        this.log(accountId, account.storeName, `Accepting orders (Accept All: ${acceptAll}, Selected: ${(orderIds || []).length})...`);

        try {
            const page = await this.getPageForAccount(account);
            let hash = account.workspaceHash || this._extractWorkspaceHash(page.url()) || '4ntb1';
            const targetUrl = `https://supplier.meesho.com/panel/v3/new/fulfillment/${hash}/orders/pending`;

            if (!page.url().includes('/orders/pending')) {
                await page.goto(targetUrl, { timeout: 35000, waitUntil: 'domcontentloaded' });
                await this._delay(2500);
            }

            await this._dismissPopupModals(page);

            let acceptedCount = 0;

            if (acceptAll) {
                this.log(accountId, account.storeName, "Attempting bulk select all...");

                const checkedCount = await page.evaluate(() => {
                    let count = 0;
                    const headerCheckbox = document.querySelector('th input[type="checkbox"], thead input[type="checkbox"]');
                    if (headerCheckbox) {
                        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked').set;
                        if (!headerCheckbox.checked) {
                            nativeSetter.call(headerCheckbox, true);
                            headerCheckbox.dispatchEvent(new Event('input', { bubbles: true }));
                            headerCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                            headerCheckbox.click();
                        }
                        count = -1;
                    }
                    if (count === 0) {
                        document.querySelectorAll('tbody input[type="checkbox"]').forEach(cb => {
                            if (!cb.checked) { cb.click(); count++; }
                        });
                    }
                    return count;
                });

                await this._delay(1500);

                const bulkBtn = page.locator("button:has-text('Accept Orders'), button:has-text('Accept Selected'), button:has-text('Accept')").first();
                if ((await bulkBtn.count()) > 0) {
                    await bulkBtn.click({ force: true });
                    await this._delay(1500);

                    const modalConfirm = page.locator("div[role='dialog'] button:has-text('Accept Order'), div[role='dialog'] button:has-text('Accept'), div[role='dialog'] button:has-text('Confirm')").first();
                    if ((await modalConfirm.count()) > 0 && (await modalConfirm.isVisible())) {
                        await modalConfirm.click({ force: true });
                        for (let j = 0; j < 15; j++) {
                            await this._delay(1000);
                            const gotIt = page.locator("button:has-text('Got it')").first();
                            if ((await gotIt.count()) > 0 && (await gotIt.isVisible())) {
                                await gotIt.click();
                                break;
                            }
                        }
                        const currentOrders = db.getOrdersByAccount(accountId);
                        acceptedCount = currentOrders.length;
                    }
                }

                if (acceptedCount === 0) {
                    // Try row by row
                    const currentOrders = db.getOrdersByAccount(accountId);
                    for (const ord of currentOrders) {
                        if (await this._acceptSingleOrder(page, ord.sub_order_id, accountId, account.storeName)) {
                            acceptedCount++;
                            await this._delay(1500);
                        }
                    }
                }

                db.removeAcceptedOrders(accountId, null, true);
            } else if (orderIds && orderIds.length > 0) {
                for (const oid of orderIds) {
                    if (await this._acceptSingleOrder(page, oid, accountId, account.storeName)) {
                        acceptedCount++;
                        await this._delay(1500);
                    }
                }
                db.removeAcceptedOrders(accountId, orderIds, false);
            }

            this.log(accountId, account.storeName, `Successfully accepted ${acceptedCount} order(s)!`, 'info');
            return { success: acceptedCount > 0, acceptedCount };
        } catch (err) {
            this.log(accountId, account.storeName, `Error accepting orders: ${err.message}`, 'error');
            throw err;
        } finally {
            this.busyAccounts.delete(accountId);
        }
    }

    async _acceptSingleOrder(page, orderId, accountId, storeName) {
        try {
            const cleanId = orderId.split('_')[0];
            let row = page.locator(`tr:has-text('${cleanId}')`).first();
            if ((await row.count()) === 0) return false;

            const acceptBtn = row.locator("button:has-text('Accept'), button[data-testid*='accept']").first();
            if ((await acceptBtn.count()) === 0) return false;

            await acceptBtn.click({ force: true });
            await this._delay(1500);

            const modalConfirm = page.locator("div[role='dialog'] button:has-text('Accept Order'), div[role='dialog'] button:has-text('Accept'), div[role='dialog'] button:has-text('Confirm')").first();
            if ((await modalConfirm.count()) > 0 && (await modalConfirm.isVisible())) {
                await modalConfirm.click({ force: true });
                await this._delay(1500);
                const gotItBtn = page.locator("button:has-text('Got it')").first();
                if ((await gotItBtn.count()) > 0 && (await gotItBtn.isVisible())) {
                    await gotItBtn.click({ force: true });
                }
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    // ----------------- COURIER RETURN OTPS (SINGLE ACCOUNT) -----------------

    async fetchAccountOtps(account) {
        const accountId = account.id;
        if (this.busyAccounts.has(accountId)) {
            return db.data.otps.filter(o => o.accountId === accountId);
        }

        this.busyAccounts.add(accountId);
        this.log(accountId, account.storeName, 'Fetching Courier Return Delivery OTPs...');

        try {
            const page = await this.getPageForAccount(account);
            const capturedApiData = [];

            const onOtpResponse = async response => {
                try {
                    const ct = response.headers()['content-type'] || '';
                    if (response.url().includes('fetchDeliveryOTPs') && ct.includes('json')) {
                        const data = await response.json();
                        capturedApiData.push(data);
                    }
                } catch (e) {}
            };

            page.on('response', onOtpResponse);

            let hash = account.workspaceHash || this._extractWorkspaceHash(page.url()) || '4ntb1';
            const targetUrl = `https://supplier.meesho.com/panel/v3/new/fulfillment/${hash}/returns/returnTracking-intransit`;

            await page.goto(targetUrl, { timeout: 35000, waitUntil: 'domcontentloaded' });
            await this._delay(3000);
            await this._dismissPopupModals(page);

            for (let i = 0; i < 6; i++) {
                if (capturedApiData.length > 0) break;
                await this._delay(500);
            }
            page.off('response', onOtpResponse);

            let otps = [];
            if (capturedApiData.length > 0) {
                const res = capturedApiData[capturedApiData.length - 1];
                if (res && res.supplier_delivery_otp) {
                    for (const it of res.supplier_delivery_otp) {
                        let cName = (it.carrier_details && it.carrier_details.name) || it.carrier_name || 'Courier Partner';
                        cName = cName.charAt(0).toUpperCase() + cName.slice(1);
                        let icon = (it.carrier_details && it.carrier_details.icon) || '';

                        let validTillStr = 'Today';
                        if (it.otp_expiry_timestamp) {
                            try {
                                const dt = new Date(it.otp_expiry_timestamp);
                                validTillStr = dt.toLocaleTimeString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                            } catch (e) {
                                validTillStr = it.otp_expiry_timestamp;
                            }
                        }

                        otps.push({
                            courier: cName,
                            otp: String(it.otp || 'N/A'),
                            packets_count: it.count || (it.delivery_shipment_details && it.delivery_shipment_details.total_shipment_count) || 1,
                            awbs: it.awbs || [],
                            valid_till: validTillStr,
                            icon
                        });
                    }
                }
            }

            db.setOtpsForAccount(accountId, account.storeName, otps);
            this.log(accountId, account.storeName, `Found ${otps.length} active Courier Return OTP(s).`, 'info');
            return otps;
        } catch (err) {
            this.log(accountId, account.storeName, `Error fetching Return OTPs: ${err.message}`, 'warning');
            return db.data.otps.filter(o => o.accountId === accountId);
        } finally {
            this.busyAccounts.delete(accountId);
        }
    }

    // ----------------- PARALLEL MULTI-ACCOUNT RUNNERS -----------------

    async syncAllAccountsParallel(userId) {
        const accounts = db.getAccountsByUser(userId);
        if (accounts.length === 0) return [];

        this.log(null, 'Parallel Sync', `Syncing ${accounts.length} connected store(s) simultaneously...`, 'info');

        // Run fetchAccountOrders for all accounts at the exact same time
        const results = await Promise.allSettled(accounts.map(acc => this.fetchAccountOrders(acc)));

        const allOrders = db.getOrdersByUser(userId);
        this.log(null, 'Parallel Sync', `Completed simultaneous sync for all accounts. Total pending orders: ${allOrders.length}`, 'info');
        return allOrders;
    }

    async acceptAllAccountsParallel(userId) {
        const accounts = db.getAccountsByUser(userId);
        if (accounts.length === 0) return { totalAccepted: 0 };

        this.log(null, 'Parallel Accept', `Accepting all orders across ${accounts.length} store(s) simultaneously...`, 'info');

        // Execute accept orders for all accounts simultaneously
        const results = await Promise.allSettled(
            accounts.map(acc => this.acceptAccountOrders(acc, null, true))
        );

        let totalAccepted = 0;
        results.forEach((res, i) => {
            if (res.status === 'fulfilled' && res.value) {
                totalAccepted += res.value.acceptedCount || 0;
            } else if (res.status === 'rejected') {
                this.log(accounts[i].id, accounts[i].storeName, `Accept failed: ${res.reason.message}`, 'error');
            }
        });

        this.log(null, 'Parallel Accept', `Finished simultaneous accept. Total orders accepted: ${totalAccepted}`, 'info');
        return { totalAccepted };
    }

    async fetchOtpsAllAccountsParallel(userId) {
        const accounts = db.getAccountsByUser(userId);
        if (accounts.length === 0) return [];

        this.log(null, 'Parallel OTP', `Fetching Return Delivery OTPs across ${accounts.length} store(s) simultaneously...`, 'info');

        await Promise.allSettled(accounts.map(acc => this.fetchAccountOtps(acc)));

        const allOtps = db.getOtpsByUser(userId);
        this.log(null, 'Parallel OTP', `Finished simultaneous OTP fetch. Total active OTPs: ${allOtps.length}`, 'info');
        return allOtps;
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const botManager = new BotManager();

module.exports = {
    BotManager,
    botManager
};
