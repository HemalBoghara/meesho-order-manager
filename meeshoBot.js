const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

class MeeshoBot {
    constructor(configPath = 'config.json') {
        this.baseDir = __dirname;
        this.configPath = path.join(this.baseDir, configPath);
        this.config = this.loadConfig();

        this.authFile = path.join(this.baseDir, 'auth_state.json');
        this.sessionDir = path.join(this.baseDir, 'session_data');
        this.ordersCacheFile = path.join(this.baseDir, 'latest_orders.json');
        this.otpsCacheFile = path.join(this.baseDir, 'latest_return_otps.json');

        this.browser = null;
        this.context = null;
        this.page = null;

        this.logsBuffer = [];
        this.pendingOrders = [];
        this.courierOtps = [];
        this.isBusy = false;

        const meeshoCfg = this.config.meesho || {};
        this.storeName = meeshoCfg.store_name || 'Not Logged In';
        this.currentEmail = meeshoCfg.email_or_phone || '';
        this.workspaceHash = meeshoCfg.workspace_hash || '4ntb1';

        // Headless detection: production on VPS/Hostinger defaults to true, otherwise check env
        const headlessEnv = process.env.HEADLESS;
        if (headlessEnv !== undefined) {
            this.isHeadless = headlessEnv.toLowerCase() === 'true' || headlessEnv === '1';
        } else if (process.env.NODE_ENV === 'production') {
            this.isHeadless = true;
        } else {
            this.isHeadless = false;
        }

        this._busyLock = false;
        this._navLock = false;
    }

    log(message, level = 'info') {
        const now = new Date();
        const timestamp = now.toTimeString().split(' ')[0];
        const entry = { timestamp, message, level };
        this.logsBuffer.push(entry);
        if (this.logsBuffer.length > 200) {
            this.logsBuffer.shift();
        }

        const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
        if (level === 'error') {
            console.error(`${prefix} ${message}`);
        } else if (level === 'warning') {
            console.warn(`${prefix} ${message}`);
        } else {
            console.log(`${prefix} ${message}`);
        }
    }

    loadConfig() {
        if (fs.existsSync(this.configPath)) {
            try {
                const data = fs.readFileSync(this.configPath, 'utf8');
                return JSON.parse(data);
            } catch (err) {
                console.error(`Error loading config: ${err.message}`);
            }
        }

        const examplePath = path.join(this.baseDir, 'config.example.json');
        if (fs.existsSync(examplePath)) {
            try {
                return JSON.parse(fs.readFileSync(examplePath, 'utf8'));
            } catch (e) {}
        }
        return {};
    }

    saveConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
        } catch (err) {
            console.error(`Error saving config: ${err.message}`);
        }
    }

    _extractWorkspaceHash(url) {
        if (!url) return null;
        const match = url.match(/\/panel\/v3\/new\/(?:growth|fulfillment|root)\/([a-zA-Z0-9_-]+)/);
        if (match) {
            const h = match[1];
            if (h !== 'login' && h !== 'root') {
                return h;
            }
        }
        return null;
    }

    async initBrowser(headless = null, forceClean = false) {
        const isHeadlessMode = headless !== null ? headless : this.isHeadless;

        if (!forceClean && this.page && !this.page.isClosed()) {
            return this.page;
        }

        await this._cleanupBrowserResources();

        this.log(`Launching Chromium browser (headless=${isHeadlessMode}) for Meesho Supplier Panel...`);

        const launchArgs = [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote'
        ];

        if (!isHeadlessMode) {
            launchArgs.push('--start-maximized');
        }

        this.browser = await chromium.launch({
            headless: isHeadlessMode,
            args: launchArgs
        });

        const contextArgs = {
            viewport: { width: 1280, height: 800 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        };

        if (!forceClean && fs.existsSync(this.authFile)) {
            try {
                const stat = fs.statSync(this.authFile);
                if (stat.size > 20) {
                    contextArgs.storageState = this.authFile;
                    this.log('Loaded saved Meesho session credentials.');
                }
            } catch (e) {
                this.log(`Notice: Saved session not loaded: ${e.message}`, 'warning');
            }
        }

        this.context = await this.browser.newContext(contextArgs);

        // Anti-detection stealth init scripts
        await this.context.addInitScript(`
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            window.chrome = {
                runtime: {},
                loadTimes: function() {},
                csi: function() {},
                app: {}
            };
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en', 'hi']
            });
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });
        `);

        this.page = await this.context.newPage();
        return this.page;
    }

    async _cleanupBrowserResources() {
        if (this.context) {
            try {
                await this.context.close();
            } catch (e) {}
            this.context = null;
        }

        if (this.browser) {
            try {
                await this.browser.close();
            } catch (e) {}
            this.browser = null;
        }

        this.page = null;
    }

    async saveSessionState() {
        if (this.context) {
            try {
                await this.context.storageState({ path: this.authFile });
            } catch (e) {
                this.log(`Notice saving session: ${e.message}`, 'warning');
            }
        }
    }

    async logout() {
        this.log('Logging out from Meesho Supplier Panel...');
        await this.close();

        if (fs.existsSync(this.authFile)) {
            try {
                fs.unlinkSync(this.authFile);
            } catch (err) {
                console.error(`Error removing auth file: ${err.message}`);
            }
        }

        this.pendingOrders = [];
        this.courierOtps = [];
        this.storeName = 'Not Logged In';
        this.currentEmail = '';
        this.workspaceHash = '';

        this._saveCachedOrders([]);
        this._saveCachedOtps([]);

        this.config.meesho = this.config.meesho || {};
        this.config.meesho.store_name = 'Not Logged In';
        this.config.meesho.email_or_phone = '';
        this.config.meesho.password = '';
        this.config.meesho.workspace_hash = '';
        this.saveConfig(this.config);

        this.log('Logged out successfully. All session data removed.', 'info');
        return { success: true, message: 'Logged out successfully.' };
    }

    async checkLoginStatus() {
        if (!fs.existsSync(this.authFile)) {
            return {
                logged_in: false,
                current_url: '',
                store_name: 'Not Logged In',
                email: '',
                workspace_hash: '',
                message: 'Not logged in'
            };
        }

        try {
            const page = await this.initBrowser(this.isHeadless);
            let currentUrl = page.url();

            if (!currentUrl.includes('supplier.meesho.com')) {
                await page.goto('https://supplier.meesho.com/panel/v3/new/root/login', {
                    timeout: 35000,
                    waitUntil: 'domcontentloaded'
                });
                await this._delay(2500);
                currentUrl = page.url();
            }

            const hasPasswordField = (await page.$("input[name='password']")) !== null;
            const isLoginPage = currentUrl.includes('/login') || hasPasswordField;
            const isPanel = currentUrl.includes('/panel') && !isLoginPage;

            if (isPanel) {
                const h = this._extractWorkspaceHash(currentUrl);
                if (h) this.workspaceHash = h;
                await this._extractStoreName(page);
                await this.saveSessionState();
            }

            return {
                logged_in: isPanel,
                current_url: currentUrl,
                store_name: isPanel ? this.storeName : 'Not Logged In',
                email: isPanel ? this.currentEmail : '',
                workspace_hash: isPanel ? this.workspaceHash : '',
                message: isPanel ? `Connected: ${this.storeName}` : 'Not logged in'
            };
        } catch (e) {
            return {
                logged_in: false,
                error: e.message,
                message: 'Connection error',
                store_name: 'Not Logged In'
            };
        }
    }

    async _extractStoreName(page) {
        try {
            const name = await page.evaluate(() => {
                const bodyText = document.body.innerText || '';
                const match = bodyText.match(/Welcome back,?\s*([^\n\r]+)/i);
                if (match && match[1].trim()) {
                    return match[1].trim().split('\n')[0];
                }

                const storeEl = document.querySelector(
                    '[data-testid*="seller"], [data-testid*="store"], [class*="store-name"], [class*="seller-name"], [class*="supplier-info"], [class*="account-info"]'
                );
                if (storeEl && storeEl.innerText.trim()) {
                    return storeEl.innerText.trim().split('\n')[0];
                }

                const asideEl = document.querySelector('aside, [class*="sidebar"], [class*="navigation"]');
                if (asideEl) {
                    const lines = asideEl.innerText.split('\n').map(l => l.trim()).filter(Boolean);
                    for (const l of lines.slice(0, 5)) {
                        if (l.length >= 3 && !['notices', 'support', 'home', 'orders', 'returns'].includes(l.toLowerCase())) {
                            return l;
                        }
                    }
                }

                const textLines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
                const excludedWords = [
                    'notice', 'support', 'home', 'orders', 'returns', 'pricing',
                    'barcoded', 'claims', 'inventory', 'catalog', 'quality',
                    'payments', 'warehouse', 'services', 'supplier hub',
                    'growth', 'fulfillment', 'dashboard', 'login'
                ];
                for (const line of textLines.slice(0, 10)) {
                    const lower = line.toLowerCase();
                    if (line.length >= 3 && line.length <= 45 && !excludedWords.some(w => lower.includes(w))) {
                        return line;
                    }
                }
                return '';
            });

            if (name) {
                this.storeName = name;
                this.config.meesho = this.config.meesho || {};
                this.config.meesho.store_name = name;
                this.saveConfig(this.config);
            } else if (!this.storeName || this.storeName === 'Not Logged In') {
                if (this.currentEmail) {
                    const prefix = this.currentEmail.split('@')[0].replace(/\./g, ' ');
                    const formatted = prefix.charAt(0).toUpperCase() + prefix.slice(1);
                    this.storeName = this.workspaceHash ? `${formatted} (${this.workspaceHash})` : formatted;
                    this.config.meesho = this.config.meesho || {};
                    this.config.meesho.store_name = this.storeName;
                    this.saveConfig(this.config);
                }
            }
        } catch (e) {
            if (!this.storeName || this.storeName === 'Not Logged In') {
                if (this.currentEmail) {
                    this.storeName = this.currentEmail.split('@')[0];
                }
            }
        }
    }

    async login(emailOrPhone = '', password = '', waitTimeoutSec = 60) {
        this.isBusy = true;
        try {
            const page = await this.initBrowser(this.isHeadless, true);
            this.currentEmail = emailOrPhone || this.currentEmail;
            this.log(`Navigating to Meesho Login for ${emailOrPhone}...`);

            await page.goto('https://supplier.meesho.com/panel/v3/new/root/login', {
                timeout: 45000,
                waitUntil: 'domcontentloaded'
            });
            await this._delay(3000);
            await this._dismissPopupModals(page);

            const title = await page.title();
            if (title.includes('Access Denied')) {
                this.log(`Notice: Page returned '${title}'. Waiting for render...`, 'warning');
                await this._delay(2000);
            }

            // Fill Email / Mobile
            this.log('Filling Email / Mobile Number...');
            const emailLoc = page.locator("input[name='emailOrPhone'], input[type='text'], input[placeholder*='email' i], input[placeholder*='number' i], input[type='tel']").first();
            await emailLoc.waitFor({ state: 'visible', timeout: 30000 });
            await emailLoc.fill(emailOrPhone, { force: true });
            this.log(`Entered identifier: ${emailOrPhone}`);

            // Fill Password
            this.log('Filling Password...');
            const pwdLoc = page.locator("input[name='password'], input[type='password']").first();
            await pwdLoc.waitFor({ state: 'visible', timeout: 15000 });
            await pwdLoc.fill(password, { force: true });
            this.log('Entered password.');

            await this._delay(500);

            // Click Submit
            this.log('Submitting login form...');
            const submitBtn = page.locator("button[type='submit'], button:has-text('Log in')").first();
            await submitBtn.waitFor({ state: 'visible', timeout: 5000 });
            await submitBtn.click({ force: true });
            this.log("Clicked 'Log in' button. Waiting for dashboard...");

            let elapsed = 0;
            while (elapsed < waitTimeoutSec) {
                await this._delay(1500);
                elapsed += 1.5;

                if (page.isClosed()) {
                    this.isBusy = false;
                    return { success: false, message: 'Browser was closed during login.' };
                }

                const currentUrl = page.url();
                if (currentUrl.includes('/panel') && !currentUrl.includes('/login')) {
                    const h = this._extractWorkspaceHash(currentUrl);
                    if (h) this.workspaceHash = h;

                    await this._dismissPopupModals(page);
                    await this._delay(1500);
                    await this._extractStoreName(page);

                    if (!this.storeName || this.storeName === 'Not Logged In') {
                        const prefix = emailOrPhone.split('@')[0];
                        this.storeName = this.workspaceHash ? `${prefix} (${this.workspaceHash})` : prefix;
                    }

                    this.log(`Successfully logged in as: ${this.storeName} (${this.workspaceHash})!`, 'info');
                    await this.saveSessionState();

                    this.config.meesho = this.config.meesho || {};
                    this.config.meesho.email_or_phone = emailOrPhone;
                    this.config.meesho.password = password;
                    this.config.meesho.workspace_hash = this.workspaceHash;
                    this.config.meesho.store_name = this.storeName;
                    this.saveConfig(this.config);

                    this.isBusy = false;
                    return { success: true, message: `Logged in as ${this.storeName}` };
                }
            }

            this.isBusy = false;
            return { success: false, message: 'Login timed out. Please check credentials.' };
        } catch (e) {
            this.isBusy = false;
            this.log(`Login error: ${e.message}`, 'error');
            return { success: false, error: e.message, message: `Login error: ${e.message}` };
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

    async fetchPendingOrders() {
        if (this._navLock) {
            this.log('Navigation in progress, waiting for pending lock...', 'warning');
            while (this._navLock) {
                await this._delay(500);
            }
        }
        this._navLock = true;
        try {
            return await this._fetchPendingOrdersInternal();
        } finally {
            this._navLock = false;
        }
    }

    async _fetchPendingOrdersInternal() {
        this.isBusy = true;
        this.log(`Fetching live pending orders for ${this.storeName} (${this.workspaceHash})...`);
        try {
            const page = await this.initBrowser(this.isHeadless);

            const h = this._extractWorkspaceHash(page.url());
            if (h) {
                this.workspaceHash = h;
            } else if (!this.workspaceHash) {
                this.workspaceHash = (this.config.meesho && this.config.meesho.workspace_hash) || '4ntb1';
            }

            const targetUrl = `https://supplier.meesho.com/panel/v3/new/fulfillment/${this.workspaceHash}/orders/pending`;
            this.log(`Navigating to fulfillment orders: ${targetUrl}`);

            await page.goto(targetUrl, { timeout: 40000, waitUntil: 'domcontentloaded' });
            await this._delay(3500);

            if (page.url().includes('/login')) {
                this.log('Session not active. Please log in first!', 'warning');
                this.isBusy = false;
                return [];
            }

            await this._dismissPopupModals(page);
            await this._extractStoreName(page);

            const pendingTab = page.locator("button[role='tab']:has-text('Pending'), [role='tab']:has-text('Pending')").first();
            if ((await pendingTab.count()) > 0) {
                const isSelected = (await pendingTab.getAttribute('aria-selected')) === 'true';
                if (!isSelected) {
                    this.log("Clicking 'Pending' tab on Meesho...");
                    await pendingTab.click();
                    await this._delay(2500);
                }
            }

            await page.evaluate(() => window.scrollBy(0, 400));
            await this._delay(1500);

            try {
                await page.waitForSelector('table tbody tr, tr[data-index]', { timeout: 6000 });
            } catch (e) {}

            this.log('Scanning pending orders table for active account...');
            const realOrders = await this._parseOrdersFromDom(page);

            this.pendingOrders = realOrders;
            this._saveCachedOrders(this.pendingOrders);

            if (realOrders.length > 0) {
                this.log(`Successfully retrieved ${realOrders.length} pending orders for ${this.storeName}!`, 'info');
            } else {
                this.log(`No pending orders currently found for ${this.storeName} (Count: 0).`, 'info');
            }

            this.isBusy = false;
            return this.pendingOrders;
        } catch (e) {
            this.isBusy = false;
            this.log(`Error fetching orders: ${e.message}`, 'error');
            return this.getCachedOrders();
        }
    }

    async _parseOrdersFromDom(page) {
        try {
            return await page.evaluate(() => {
                const results = [];
                const rows = document.querySelectorAll('table tbody tr, tr');

                rows.forEach(row => {
                    const text = row.innerText || '';
                    if (
                        !text.trim() ||
                        text.includes('Product Details') ||
                        text.includes('Sub-order ID') ||
                        text.includes('Download Orders Data') ||
                        text.includes('Label download failed')
                    ) {
                        return;
                    }

                    const idMatch = text.match(/(\d{15,22}(?:_\d+)?)/);
                    if (!idMatch) return;

                    let subOrderId = idMatch[1];
                    if (!subOrderId.includes('_')) {
                        subOrderId = subOrderId + '_1';
                    }

                    let sku = 'N/A';
                    const skuMatch =
                        text.match(/([A-Za-z0-9_-]+(?:DIYORA|HYEON)[A-Za-z0-9_-]*)/i) ||
                        text.match(/SKU ID\s*\n*\s*([A-Za-z0-9_-]+)/i) ||
                        text.match(/([A-Za-z0-9_]{6,})/);
                    if (skuMatch) {
                        sku = skuMatch[1];
                    }

                    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3);
                    let productTitle = 'Product Item';
                    for (const l of lines) {
                        if (
                            !l.includes('Order ID:') &&
                            !l.includes('Sub-order') &&
                            !l.includes('SKU') &&
                            !l.includes('Accept') &&
                            !l.includes('Cancel') &&
                            !l.includes('Ad order') &&
                            isNaN(l)
                        ) {
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
                    if (slaMatch) {
                        slaDate = slaMatch[1].trim();
                    }

                    const imgs = Array.from(row.querySelectorAll('img'));
                    let imgUrl = '';
                    for (const im of imgs) {
                        if (im.src && !im.src.includes('checkbox') && !im.src.includes('.svg')) {
                            imgUrl = im.src;
                            break;
                        }
                    }
                    if (!imgUrl && imgs.length > 1) {
                        imgUrl = imgs[imgs.length - 1].src;
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
            this.log(`DOM parsing note: ${e.message}`, 'warning');
            return [];
        }
    }

    async fetchCourierReturnOtps() {
        if (this._navLock) {
            while (this._navLock) await this._delay(500);
        }
        this._navLock = true;
        this.log('Fetching Courier Partner Return Delivery OTPs from Meesho...');
        try {
            const page = await this.initBrowser(this.isHeadless);
            const capturedApiData = [];

            const onOtpResponse = async response => {
                try {
                    const contentType = response.headers()['content-type'] || '';
                    if (response.url().includes('fetchDeliveryOTPs') && contentType.includes('json')) {
                        const data = await response.json();
                        capturedApiData.push(data);
                    }
                } catch (e) {}
            };

            page.on('response', onOtpResponse);

            const targetUrl = `https://supplier.meesho.com/panel/v3/new/fulfillment/${this.workspaceHash}/returns/returnTracking-intransit`;
            await page.goto(targetUrl, { timeout: 35000, waitUntil: 'domcontentloaded' });
            await this._delay(3500);
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
                    const items = res.supplier_delivery_otp;
                    for (const it of items) {
                        let cName = it.carrier_name || 'Courier Partner';
                        if (it.carrier_details && typeof it.carrier_details === 'object') {
                            cName = it.carrier_details.name || cName;
                        }
                        cName = cName.charAt(0).toUpperCase() + cName.slice(1);

                        let icon = '';
                        if (it.carrier_details && typeof it.carrier_details === 'object') {
                            icon = it.carrier_details.icon || '';
                        }

                        let validTillStr = 'Today';
                        const exp = it.otp_expiry_timestamp || '';
                        if (exp) {
                            try {
                                const dt = new Date(exp);
                                validTillStr = dt.toLocaleTimeString('en-US', {
                                    day: 'numeric',
                                    month: 'short',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                });
                            } catch (e) {
                                validTillStr = exp;
                            }
                        }

                        otps.push({
                            courier: cName,
                            otp: String(it.otp || 'N/A'),
                            packets_count: it.count || (it.delivery_shipment_details && it.delivery_shipment_details.total_shipment_count) || 1,
                            awbs: it.awbs || [],
                            valid_till: validTillStr,
                            icon: icon
                        });
                    }
                }
            }

            if (otps.length === 0) {
                const domOtps = await page.evaluate(() => {
                    const list = [];
                    const bodyText = document.body.innerText || '';
                    const regex = /([A-Za-z]+)\s+OTP:?\s*(\d{4,6})/gi;
                    let m;
                    while ((m = regex.exec(bodyText)) !== null) {
                        list.push({
                            courier: m[1],
                            otp: m[2],
                            packets_count: 1,
                            awbs: [],
                            valid_till: 'Today',
                            icon: ''
                        });
                    }
                    return list;
                });
                if (domOtps && domOtps.length > 0) {
                    otps.push(...domOtps);
                }
            }

            this.courierOtps = otps;
            this._saveCachedOtps(this.courierOtps);

            if (otps.length > 0) {
                this.log(`Retrieved ${otps.length} active Courier Partner Return Delivery OTP(s)!`, 'info');
            } else {
                this.log('No active Courier Partner Return OTPs for today (0 out for delivery).', 'info');
            }

            return this.courierOtps;
        } catch (e) {
            this.log(`Error fetching Return OTPs: ${e.message}`, 'warning');
            return this.getCachedOtps();
        } finally {
            this._navLock = false;
        }
    }

    _saveCachedOrders(orders) {
        try {
            fs.writeFileSync(this.ordersCacheFile, JSON.stringify(orders, null, 2), 'utf8');
        } catch (e) {
            console.error(`Failed to cache orders: ${e.message}`);
        }
    }

    getCachedOrders() {
        if (fs.existsSync(this.ordersCacheFile)) {
            try {
                return JSON.parse(fs.readFileSync(this.ordersCacheFile, 'utf8'));
            } catch (e) {}
        }
        return this.pendingOrders;
    }

    _saveCachedOtps(otps) {
        try {
            fs.writeFileSync(this.otpsCacheFile, JSON.stringify(otps, null, 2), 'utf8');
        } catch (e) {
            console.error(`Failed to cache OTPs: ${e.message}`);
        }
    }

    getCachedOtps() {
        if (fs.existsSync(this.otpsCacheFile)) {
            try {
                return JSON.parse(fs.readFileSync(this.otpsCacheFile, 'utf8'));
            } catch (e) {}
        }
        return this.courierOtps;
    }

    async acceptOrders(orderIds = null, acceptAll = false) {
        if (this._navLock) {
            while (this._navLock) await this._delay(500);
        }
        this._navLock = true;
        this.isBusy = true;
        try {
            const page = await this.initBrowser(this.isHeadless);
            this.log(`Starting Accept Orders process (Accept All: ${acceptAll}, Selected: ${(orderIds || []).length})...`);

            const h = this._extractWorkspaceHash(page.url());
            if (h) {
                this.workspaceHash = h;
            } else if (!this.workspaceHash) {
                this.workspaceHash = (this.config.meesho && this.config.meesho.workspace_hash) || '4ntb1';
            }

            const targetUrl = `https://supplier.meesho.com/panel/v3/new/fulfillment/${this.workspaceHash}/orders/pending`;
            if (!page.url().includes('/orders/pending') || !page.url().includes(this.workspaceHash)) {
                await page.goto(targetUrl, { timeout: 35000, waitUntil: 'domcontentloaded' });
                await this._delay(3000);
            }

            await this._dismissPopupModals(page);

            const pendingTab = page.locator("button[role='tab']:has-text('Pending'), [role='tab']:has-text('Pending')").first();
            if ((await pendingTab.count()) > 0) {
                const isSelected = (await pendingTab.getAttribute('aria-selected')) === 'true';
                if (!isSelected) {
                    this.log("Clicking 'Pending' tab on Meesho...");
                    await pendingTab.click();
                    await this._delay(2500);
                }
            }

            let acceptedCount = 0;

            if (acceptAll) {
                this.log("Looking for 'Select All' checkbox in pending orders table...");

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
                        const rowCheckboxes = document.querySelectorAll('tbody input[type="checkbox"], tr td input[type="checkbox"]');
                        rowCheckboxes.forEach(cb => {
                            if (!cb.checked) {
                                cb.click();
                                count++;
                            }
                        });
                    }
                    return count;
                });

                this.log(`Checkbox selection result: ${checkedCount} (${checkedCount === -1 ? 'Select All used' : `${checkedCount} individual checkboxes clicked`})`);
                await this._delay(2000);

                const selectAll = page.locator("th input[type='checkbox'], thead input[type='checkbox'], input[data-testid*='select-all']").first();
                if ((await selectAll.count()) > 0) {
                    try {
                        const isChecked = await selectAll.isChecked();
                        if (!isChecked) {
                            await selectAll.click({ force: true });
                            this.log("Clicked 'Select All' checkbox via Playwright (force).");
                            await this._delay(2000);
                        }
                    } catch (e) {
                        this.log(`Select All Playwright click note: ${e.message}`, 'warning');
                    }
                }

                const bulkBtn = page.locator("button:has-text('Accept Orders'), button:has-text('Accept Selected'), button:has-text('Accept')").first();
                let btnEnabled = false;

                if ((await bulkBtn.count()) > 0) {
                    this.log('Waiting for Accept button to become enabled...');
                    for (let waitI = 0; waitI < 10; waitI++) {
                        const isDisabled = (await bulkBtn.getAttribute('disabled')) !== null;
                        if (!isDisabled) {
                            btnEnabled = true;
                            this.log('Accept button is now enabled!');
                            break;
                        }
                        await this._delay(1000);
                        if (waitI === 3) {
                            this.log('Button still disabled, re-clicking checkboxes...');
                            await page.evaluate(() => {
                                document.querySelectorAll('th input[type="checkbox"], thead input[type="checkbox"]').forEach(cb => cb.click());
                            });
                            await this._delay(1000);
                        }
                    }

                    if (btnEnabled) {
                        await bulkBtn.click({ force: true });
                        this.log('Clicked bulk Accept button.');
                        await this._delay(1500);

                        const modalConfirm = page.locator("div[role='dialog'] button:has-text('Accept Order'), div[role='dialog'] button:has-text('Accept'), div[role='dialog'] button:has-text('Confirm'), div[role='dialog'] button:has-text('Yes')").first();

                        for (let i = 0; i < 5; i++) {
                            if ((await modalConfirm.count()) > 0 && (await modalConfirm.isVisible())) {
                                break;
                            }
                            await this._delay(500);
                        }

                        if ((await modalConfirm.count()) > 0 && (await modalConfirm.isVisible())) {
                            this.log("Clicking 'Accept Order' confirmation inside modal...");
                            await modalConfirm.click({ force: true });

                            for (let j = 0; j < 20; j++) {
                                await this._delay(1000);
                                const gotIt = page.locator("button:has-text('Got it')").first();
                                if ((await gotIt.count()) > 0 && (await gotIt.isVisible())) {
                                    await gotIt.click();
                                    break;
                                }
                            }

                            acceptedCount = this.pendingOrders.length;
                            this.log(`All pending orders (${acceptedCount}) accepted successfully on Meesho!`, 'info');
                        }
                    } else {
                        this.log('Accept button remained disabled after all checkbox attempts.', 'warning');
                    }
                }

                if (acceptedCount === 0) {
                    this.log('Bulk accept not triggered, accepting individual pending orders one by one...');
                    const allIds = this.pendingOrders.map(o => o.sub_order_id).filter(Boolean);
                    for (const oid of allIds) {
                        if (await this._acceptSingleOrderById(page, oid)) {
                            acceptedCount++;
                            await this._delay(1500);
                        }
                    }
                }
            } else if (orderIds && orderIds.length > 0) {
                this.log(`Accepting ${orderIds.length} orders: ${orderIds.join(', ')}`);
                for (const oid of orderIds) {
                    const ok = await this._acceptSingleOrderById(page, oid);
                    if (ok) {
                        acceptedCount++;
                        this.log(`Accepted Order ${oid} successfully on Meesho.`, 'info');
                        await this._delay(1500);
                    } else {
                        this.log(`Accept failed for Order ${oid} on Meesho.`, 'warning');
                    }
                }
            }

            if (acceptedCount > 0) {
                if (acceptAll || acceptedCount >= this.pendingOrders.length) {
                    this.pendingOrders = [];
                } else if (orderIds) {
                    const cleanIds = new Set(orderIds.map(oid => oid.split('_')[0]));
                    this.pendingOrders = this.pendingOrders.filter(
                        o => !cleanIds.has((o.sub_order_id || '').split('_')[0])
                    );
                }
                this._saveCachedOrders(this.pendingOrders);
                this.log(`Removed ${acceptedCount} accepted order(s) from pending list in panel.`);
            }

            this.isBusy = false;
            await this._delay(1500);
            await this._fetchPendingOrdersInternal();

            return {
                success: acceptedCount > 0,
                accepted_count: acceptedCount,
                remaining_count: this.pendingOrders.length,
                message: acceptedCount > 0
                    ? `Successfully accepted ${acceptedCount} order(s) on Meesho and updated panel.`
                    : 'Could not accept order(s) on Meesho. Please check logs.'
            };
        } catch (e) {
            this.isBusy = false;
            this.log(`Error during order acceptance: ${e.message}`, 'error');
            return {
                success: false,
                error: e.message,
                accepted_count: 0,
                message: `Failed to accept orders: ${e.message}`
            };
        } finally {
            this._navLock = false;
        }
    }

    async _acceptSingleOrderById(page, orderId) {
        try {
            const cleanId = orderId.split('_')[0];
            this.log(`Locating order row for ${cleanId} on Meesho...`);

            await this._closeAllModals(page);
            await this._delay(500);

            let row = page.locator(`tr:has-text('${cleanId}')`).first();
            if ((await row.count()) === 0) {
                row = page.locator(`xpath=//tr[contains(., '${cleanId}')]`).first();
            }

            if ((await row.count()) === 0) {
                this.log(`Could not find order row for ${cleanId} in table.`, 'warning');
                return false;
            }

            await row.scrollIntoViewIfNeeded();
            await this._delay(500);

            const acceptBtn = row.locator("button:has-text('Accept'), button[data-testid*='accept']").first();
            if ((await acceptBtn.count()) === 0) {
                this.log(`Accept button not found for ${cleanId}.`, 'warning');
                return false;
            }

            await acceptBtn.click({ force: true });
            this.log(`Clicked row Accept button for ${cleanId}. Waiting for confirmation modal...`);
            await this._delay(1500);

            const modalConfirm = page.locator("div[role='dialog'] button:has-text('Accept Order'), div[role='dialog'] button:has-text('Accept'), div[role='dialog'] button:has-text('Confirm'), div[role='dialog'] button:has-text('Yes')").first();

            for (let i = 0; i < 5; i++) {
                if ((await modalConfirm.count()) > 0 && (await modalConfirm.isVisible())) {
                    break;
                }
                await this._delay(500);
            }

            if ((await modalConfirm.count()) > 0 && (await modalConfirm.isVisible())) {
                this.log("Found Meesho modal confirmation button ('Accept Order'). Clicking...");
                await modalConfirm.click({ force: true });
                this.log('Clicked modal confirm. Waiting for Meesho to process...');

                for (let j = 0; j < 20; j++) {
                    await this._delay(1000);
                    const gotItBtn = page.locator("button:has-text('Got it')").first();
                    if ((await gotItBtn.count()) > 0 && (await gotItBtn.isVisible())) {
                        this.log("Order accepted successfully on Meesho! Clicking 'Got it' to close modal.");
                        await gotItBtn.click({ force: true });
                        await this._delay(1000);
                        await this._closeAllModals(page);
                        return true;
                    }

                    const dialogsCount = await page.locator("div[role='dialog']").count();
                    if (dialogsCount === 0) {
                        this.log('Meesho modal dismissed. Order accepted!', 'info');
                        await this._closeAllModals(page);
                        return true;
                    }
                }

                const bodyTxt = await page.innerText('body');
                if (bodyTxt.toLowerCase().includes('accepted successfully')) {
                    this.log('Confirmed: Order accepted successfully on Meesho.', 'info');
                    const gotItBtn = page.locator("button:has-text('Got it'), button[aria-label='Close'], button:has-text('Close')").first();
                    if ((await gotItBtn.count()) > 0 && (await gotItBtn.isVisible())) {
                        await gotItBtn.click({ force: true });
                    }
                    await this._closeAllModals(page);
                    return true;
                }

                await this._closeAllModals(page);
                return true;
            }

            this.log(`Confirmation modal not detected for ${cleanId}.`, 'warning');
            return false;
        } catch (e) {
            this.log(`Error accepting order ${orderId}: ${e.message}`, 'warning');
            try {
                await this._closeAllModals(page);
            } catch (err) {}
            return false;
        }
    }

    async _closeAllModals(page) {
        try {
            await page.evaluate(() => {
                document.querySelectorAll('div[role="presentation"][aria-label="Close modal"], div.fixed.inset-0[role="presentation"]').forEach(el => {
                    el.remove();
                });
                document.querySelectorAll('button').forEach(btn => {
                    const txt = (btn.innerText || '').toLowerCase().trim();
                    if (txt === 'got it' || txt === 'close' || txt === '×' || txt === 'x') {
                        try { btn.click(); } catch (e) {}
                    }
                });
                document.querySelectorAll('div[role="dialog"]').forEach(el => {
                    const txt = el.innerText || '';
                    if (txt.includes('accepted successfully') || txt.includes('Got it')) {
                        el.remove();
                    }
                });
            });
        } catch (e) {}
    }

    async close() {
        try {
            await this._cleanupBrowserResources();
            this.log('Browser closed.');
        } catch (e) {
            console.error(`Error closing browser: ${e.message}`);
        }
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const botInstance = new MeeshoBot();

module.exports = {
    MeeshoBot,
    botInstance
};
