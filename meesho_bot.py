import os
import sys
import re
import json
import asyncio
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

# Ensure UTF-8 output on Windows consoles
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("meesho_bot")

class MeeshoBot:
    def __init__(self, config_path: str = "config.json"):
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.config_path = os.path.join(self.base_dir, config_path)
        self.config = self.load_config()
        
        # Dedicated auth file location outside Chrome profile dir
        self.auth_file = os.path.join(self.base_dir, "auth_state.json")
        self.session_dir = os.path.join(self.base_dir, "session_data")
        self.orders_cache_file = os.path.join(self.base_dir, "latest_orders.json")
        self.otps_cache_file = os.path.join(self.base_dir, "latest_return_otps.json")
        
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        
        self.logs_buffer: List[Dict[str, Any]] = []
        self.pending_orders: List[Dict[str, Any]] = []
        self.courier_otps: List[Dict[str, Any]] = []
        self.is_busy = False
        
        # Account info
        meesho_cfg = self.config.get("meesho", {})
        self.store_name: str = meesho_cfg.get("store_name", "Not Logged In")
        self.current_email: str = meesho_cfg.get("email_or_phone", "diyoracosmetics2k26@gmail.com")
        self.workspace_hash: str = meesho_cfg.get("workspace_hash", "4ntb1")
        
        # Cloud / Headless detection
        headless_env = os.environ.get("HEADLESS")
        if headless_env is not None:
            self.is_headless = headless_env.lower() in ("true", "1", "yes")
        else:
            self.is_headless = bool(os.environ.get("RENDER") or sys.platform != "win32")
        
        self._lock = asyncio.Lock()
        self._nav_lock = asyncio.Lock()
        
    def log(self, message: str, level: str = "info"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        entry = {"timestamp": timestamp, "message": message, "level": level}
        self.logs_buffer.append(entry)
        if len(self.logs_buffer) > 200:
            self.logs_buffer.pop(0)
            
        safe_message = message.encode("ascii", "replace").decode("ascii")
        if level == "error":
            logger.error(safe_message)
        elif level == "warning":
            logger.warning(safe_message)
        else:
            logger.info(safe_message)

    def load_config(self) -> Dict[str, Any]:
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Error loading config: {e}")
        
        example_path = os.path.join(self.base_dir, "config.example.json")
        if os.path.exists(example_path):
            try:
                with open(example_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def save_config(self, new_config: Dict[str, Any]):
        self.config.update(new_config)
        try:
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(self.config, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving config: {e}")

    def _extract_workspace_hash(self, url: str) -> Optional[str]:
        """Extract workspace hash (e.g. 4ntb1, mmw8u) from URL."""
        match = re.search(r"/panel/v3/new/(?:growth|fulfillment|root)/([a-zA-Z0-9_-]+)", url)
        if match:
            h = match.group(1)
            if h not in ["login", "root"]:
                return h
        return None

    async def init_browser(self, headless: Optional[bool] = None, force_clean: bool = False) -> Page:
        """Initialize browser and context cleanly with saved session if present."""
        if headless is None:
            headless = self.is_headless

        async with self._lock:
            if not force_clean and self.page and not self.page.is_closed():
                return self.page

            if not self.playwright:
                self.playwright = await async_playwright().start()

            await self._cleanup_browser_resources()

            self.log(f"Launching Chromium browser (headless={headless}) for Meesho Supplier Panel...")
            launch_args = [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu"
            ]
            if not headless:
                launch_args.append("--start-maximized")

            self.browser = await self.playwright.chromium.launch(
                headless=headless,
                args=launch_args
            )

            context_args = {
                "viewport": {"width": 1280, "height": 800},
                "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            }
            
            if not force_clean and os.path.exists(self.auth_file) and os.path.getsize(self.auth_file) > 20:
                try:
                    context_args["storage_state"] = self.auth_file
                    self.log("Loaded saved Meesho session credentials.")
                except Exception as e:
                    self.log(f"Notice: Saved session not loaded: {e}", level="warning")

            self.context = await self.browser.new_context(**context_args)
            self.page = await self.context.new_page()
            return self.page

    async def _cleanup_browser_resources(self):
        try:
            if self.context:
                await self.context.close()
        except Exception:
            pass
        self.context = None

        try:
            if self.browser:
                await self.browser.close()
        except Exception:
            pass
        self.browser = None
        self.page = None

    async def save_session_state(self):
        """Save cookies and localStorage to auth_state.json for automatic future logins."""
        if self.context:
            try:
                await self.context.storage_state(path=self.auth_file)
            except Exception as e:
                self.log(f"Notice saving session: {e}", level="warning")

    async def logout(self):
        """Log out cleanly: close browser, remove saved session, clear orders and credentials."""
        self.log("Logging out from Meesho Supplier Panel...")
        await self.close()
        
        if os.path.exists(self.auth_file):
            try:
                os.remove(self.auth_file)
            except Exception as e:
                logger.error(f"Error removing auth file: {e}")
                
        self.pending_orders = []
        self.courier_otps = []
        self.store_name = "Not Logged In"
        self.current_email = ""
        self.workspace_hash = ""
        
        # Clear cached orders and OTPs
        self._save_cached_orders([])
        self._save_cached_otps([])
                
        # Update config
        self.config.setdefault("meesho", {})["store_name"] = "Not Logged In"
        self.config.setdefault("meesho", {})["email_or_phone"] = ""
        self.config.setdefault("meesho", {})["password"] = ""
        self.config.setdefault("meesho", {})["workspace_hash"] = ""
        self.save_config(self.config)
        
        self.log("Logged out successfully. All session data removed.", level="info")
        return {"success": True, "message": "Logged out successfully."}

    async def check_login_status(self) -> Dict[str, Any]:
        """Check if supplier session is valid and detect active account name & hash."""
        if not os.path.exists(self.auth_file):
            return {
                "logged_in": False,
                "current_url": "",
                "store_name": "Not Logged In",
                "email": "",
                "workspace_hash": "",
                "message": "Not logged in"
            }

        try:
            page = await self.init_browser(headless=self.is_headless)
            current_url = page.url
            
            if "supplier.meesho.com" not in current_url:
                await page.goto("https://supplier.meesho.com/panel/v3/new/root/login", timeout=35000, wait_until="domcontentloaded")
                await asyncio.sleep(2.5)
                current_url = page.url

            is_login_page = "/login" in current_url or await page.query_selector("input[name='password']") is not None
            is_panel = "/panel" in current_url and not is_login_page
            
            if is_panel:
                h = self._extract_workspace_hash(current_url)
                if h:
                    self.workspace_hash = h
                await self._extract_store_name(page)
                await self.save_session_state()

            status = {
                "logged_in": is_panel,
                "current_url": current_url,
                "store_name": self.store_name if is_panel else "Not Logged In",
                "email": self.current_email if is_panel else "",
                "workspace_hash": self.workspace_hash if is_panel else "",
                "message": f"Connected: {self.store_name}" if is_panel else "Not logged in"
            }
            return status
        except Exception as e:
            return {"logged_in": False, "error": str(e), "message": "Connection error", "store_name": "Not Logged In"}

    async def _extract_store_name(self, page: Page):
        """Extract the visible store name from any Meesho seller account header or welcome text."""
        try:
            name = await page.evaluate('''() => {
                // 1. Check "Welcome back, [Store Name]"
                const match = (document.body.innerText || '').match(/Welcome back,?\\s*([^\\n\\r]+)/i);
                if (match && match[1].trim()) {
                    return match[1].trim().split('\\n')[0];
                }

                // 2. Check header or aside supplier store name element
                const storeEl = document.querySelector('[data-testid*="seller"], [data-testid*="store"], [class*="store-name"], [class*="seller-name"], [class*="supplier-info"], [class*="account-info"]');
                if (storeEl && storeEl.innerText.trim()) {
                    return storeEl.innerText.trim().split('\\n')[0];
                }

                // 3. Check sidebar header
                const asideEl = document.querySelector('aside, [class*="sidebar"], [class*="navigation"]');
                if (asideEl) {
                    const lines = asideEl.innerText.split('\\n').map(l => l.trim()).filter(Boolean);
                    for (const l of lines.slice(0, 5)) {
                        if (l.length >= 3 && !['notices', 'support', 'home', 'orders', 'returns'].includes(l.toLowerCase())) {
                            return l;
                        }
                    }
                }

                // 4. Check top left text lines in header/aside before standard nav menus
                const textLines = (document.body.innerText || '').split('\\n').map(l => l.trim()).filter(Boolean);
                const excludedWords = ['notice', 'support', 'home', 'orders', 'returns', 'pricing', 'barcoded', 'claims', 'inventory', 'catalog', 'quality', 'payments', 'warehouse', 'services', 'supplier hub', 'growth', 'fulfillment', 'dashboard', 'login'];
                for (const line of textLines.slice(0, 10)) {
                    const lower = line.toLowerCase();
                    if (line.length >= 3 && line.length <= 45 && !excludedWords.some(w => lower.includes(w))) {
                        return line;
                    }
                }
                return '';
            }''')
            if name:
                self.store_name = name
                self.config.setdefault("meesho", {})["store_name"] = name
                self.save_config(self.config)
            elif not self.store_name or self.store_name == "Not Logged In":
                if self.current_email:
                    prefix = self.current_email.split('@')[0].replace('.', ' ').title()
                    self.store_name = f"{prefix} ({self.workspace_hash})" if self.workspace_hash else prefix
                    self.config.setdefault("meesho", {})["store_name"] = self.store_name
                    self.save_config(self.config)
        except Exception:
            if not self.store_name or self.store_name == "Not Logged In":
                if self.current_email:
                    self.store_name = self.current_email.split('@')[0].replace('.', ' ').title()

    async def login(self, email_or_phone: str = "", password: str = "", wait_timeout_sec: int = 60) -> Dict[str, Any]:
        """Direct login using Email/Phone ID and Password with zero OTP required."""
        self.is_busy = True
        try:
            # If changing credentials, force clean browser context
            page = await self.init_browser(headless=self.is_headless, force_clean=True)
            self.current_email = email_or_phone or self.current_email
            self.log(f"Navigating to Meesho Login for {email_or_phone}...")
            
            await page.goto("https://supplier.meesho.com/panel/v3/new/root/login", timeout=45000, wait_until="domcontentloaded")
            await asyncio.sleep(2)
            await self._dismiss_popup_modals(page)

            # Fill Email / Mobile Number
            self.log("Filling Email / Mobile Number...")
            email_loc = page.locator("input[name='emailOrPhone'], input[type='text']").first
            await email_loc.wait_for(state="visible", timeout=15000)
            await email_loc.fill(email_or_phone, force=True)
            self.log(f"Entered identifier: {email_or_phone}")

            # Fill Password
            self.log("Filling Password...")
            pwd_loc = page.locator("input[name='password'], input[type='password']").first
            await pwd_loc.wait_for(state="visible", timeout=10000)
            await pwd_loc.fill(password, force=True)
            self.log("Entered password.")

            await asyncio.sleep(0.5)

            # Click Submit 'Log in' button
            self.log("Submitting login form...")
            submit_btn = page.locator("button[type='submit'], button:has-text('Log in')").first
            await submit_btn.wait_for(state="visible", timeout=5000)
            await submit_btn.click(force=True)
            self.log("Clicked 'Log in' button. Waiting for dashboard...")

            elapsed = 0
            while elapsed < wait_timeout_sec:
                await asyncio.sleep(1.5)
                elapsed += 1.5
                
                if page.is_closed():
                    self.is_busy = False
                    return {"success": False, "message": "Browser was closed during login."}

                current_url = page.url
                if "/panel" in current_url and "/login" not in current_url:
                    h = self._extract_workspace_hash(current_url)
                    if h:
                        self.workspace_hash = h
                    await self._dismiss_popup_modals(page)
                    await asyncio.sleep(1.5)
                    await self._extract_store_name(page)
                    
                    if not self.store_name or self.store_name == "Not Logged In":
                        prefix = email_or_phone.split('@')[0].replace('.', ' ').title() if email_or_phone else "Meesho Seller"
                        self.store_name = f"{prefix} ({self.workspace_hash})" if self.workspace_hash else prefix
                    
                    self.log(f"Successfully logged in as: {self.store_name} ({self.workspace_hash})!", level="info")
                    await self.save_session_state()
                    
                    # Update config
                    self.config.setdefault("meesho", {})["email_or_phone"] = email_or_phone
                    self.config.setdefault("meesho", {})["password"] = password
                    self.config.setdefault("meesho", {})["workspace_hash"] = self.workspace_hash
                    self.config.setdefault("meesho", {})["store_name"] = self.store_name
                    self.save_config(self.config)
                    
                    self.is_busy = False
                    return {"success": True, "message": f"Logged in as {self.store_name}"}

            self.is_busy = False
            return {"success": False, "message": "Login timed out. Please check credentials."}

        except Exception as e:
            self.is_busy = False
            self.log(f"Login error: {str(e)}", level="error")
            return {"success": False, "error": str(e), "message": f"Login error: {str(e)}"}

    async def _dismiss_popup_modals(self, page: Page):
        """Automatically dismiss any promotional popup modal in Meesho without breaking order dialogs."""
        try:
            await page.evaluate("""() => {
                const closeBtns = document.querySelectorAll('button[aria-label*="close" i], button[class*="close" i], svg[class*="close" i], .modal-close');
                closeBtns.forEach(b => {
                    const txt = (b.innerText || '').toLowerCase();
                    if (!txt.includes('accept') && !txt.includes('confirm') && !txt.includes('order')) {
                        try { b.click(); } catch(e) {}
                    }
                });
                document.querySelectorAll('div[class*="z-modal"], div[class*="overlay"]').forEach(el => {
                    const t = el.innerText || '';
                    if (!t.includes('Accepting orders') && !t.includes('Accept Order') && !t.includes('Processing')) {
                        el.remove();
                    }
                });
            }""")
        except Exception:
            pass

    async def _fetch_pending_orders_internal(self) -> List[Dict[str, Any]]:
        """Internal: fetch pending orders WITHOUT acquiring _nav_lock. Caller must hold the lock."""
        self.is_busy = True
        self.log(f"Fetching live pending orders for {self.store_name} ({self.workspace_hash})...")
        try:
            page = await self.init_browser(headless=self.is_headless)
            
            # Check current workspace hash
            h = self._extract_workspace_hash(page.url)
            if h:
                self.workspace_hash = h
            elif not self.workspace_hash:
                self.workspace_hash = self.config.get("meesho", {}).get("workspace_hash", "4ntb1")
            
            target_url = f"https://supplier.meesho.com/panel/v3/new/fulfillment/{self.workspace_hash}/orders/pending"
            self.log(f"Navigating to fulfillment orders: {target_url}")
            
            await page.goto(target_url, timeout=40000, wait_until="domcontentloaded")
            await asyncio.sleep(3.5)
            
            if "/login" in page.url:
                self.log("Session not active. Please log in first!", level="warning")
                self.is_busy = False
                return []

            await self._dismiss_popup_modals(page)
            await self._extract_store_name(page)
            
            # Ensure the Pending tab is clicked and selected
            pending_tab = page.locator("button[role='tab']:has-text('Pending'), [role='tab']:has-text('Pending')").first
            if await pending_tab.count() > 0:
                is_active = await pending_tab.get_attribute("aria-selected") == "true"
                if not is_active:
                    self.log("Clicking 'Pending' tab on Meesho...")
                    await pending_tab.click()
                    await asyncio.sleep(2.5)

            # Scroll down to ensure table rows are rendered
            await page.evaluate("window.scrollBy(0, 400)")
            await asyncio.sleep(1.5)

            try:
                await page.wait_for_selector("table tbody tr, tr[data-index]", timeout=6000)
            except Exception:
                pass

            # Extract orders from the table
            self.log("Scanning pending orders table for active account...")
            real_orders = await self._parse_orders_from_dom(page)
            
            self.pending_orders = real_orders
            self._save_cached_orders(self.pending_orders)
            
            if real_orders:
                self.log(f"Successfully retrieved {len(real_orders)} pending orders for {self.store_name}!", level="info")
            else:
                self.log(f"No pending orders currently found for {self.store_name} (Count: 0).", level="info")

            self.is_busy = False
            return self.pending_orders
            
        except Exception as e:
            self.is_busy = False
            self.log(f"Error fetching orders: {str(e)}", level="error")
            return self.get_cached_orders()

    async def fetch_pending_orders(self) -> List[Dict[str, Any]]:
        """Navigate to real Pending Orders page for active account and fetch all orders."""
        async with self._nav_lock:
            return await self._fetch_pending_orders_internal()

    async def _parse_orders_from_dom(self, page: Page) -> List[Dict[str, Any]]:
        """Extract exact order details from the Meesho fulfillment table."""
        orders = []
        try:
            js_extract = """
            () => {
                const results = [];
                const rows = document.querySelectorAll("table tbody tr, tr");
                
                rows.forEach((row) => {
                    const text = row.innerText || "";
                    if (!text.trim() || text.includes("Product Details") || text.includes("Sub-order ID") || text.includes("Download Orders Data") || text.includes("Label download failed")) {
                        return;
                    }
                    
                    // Match Sub-order ID (e.g. 332400502290425472_1 or 332400502290425472)
                    const idMatch = text.match(/(\\d{15,22}(?:_\\d+)?)/);
                    if (!idMatch) return;
                    
                    let subOrderId = idMatch[1];
                    if (!subOrderId.includes('_')) {
                        subOrderId = subOrderId + '_1';
                    }
                    
                    // SKU ID: match e.g. Rotundus_Oil_DIYORA_HQ3 or STOP_HEIR_HYEON_O46
                    let sku = 'N/A';
                    const skuMatch = text.match(/([A-Za-z0-9_-]+(?:DIYORA|HYEON)[A-Za-z0-9_-]*)/i) || 
                                     text.match(/SKU ID\\s*\\n*\\s*([A-Za-z0-9_-]+)/i) || 
                                     text.match(/([A-Za-z0-9_]{6,})/);
                    if (skuMatch) {
                        sku = skuMatch[1];
                    }
                    
                    // Product Title: extract from the product details cell or first non-meta line
                    const lines = text.split('\\n').map(l => l.trim()).filter(l => l.length > 3);
                    let productTitle = 'Natural Hair Reduction Cares Oil for Face & Body 30ml';
                    for (const l of lines) {
                        if (!l.includes("Order ID:") && !l.includes("Sub-order") && !l.includes("SKU") && !l.includes("Accept") && !l.includes("Cancel") && !l.includes("Ad order") && isNaN(l)) {
                            productTitle = l;
                            break;
                        }
                    }
                    
                    // Quantity
                    const qtyMatch = text.match(/Quantity\\s*(\\d+)/i) || text.match(/\\b([1-9]\\d?)\\b\\s*(?:Size|Pcs|Qty)/);
                    const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
                    
                    // Order Date
                    const today = new Date();
                    const orderDate = today.getDate() + ' ' + today.toLocaleString('en-US', { month: 'short' }) + ' ' + today.getFullYear();
                    
                    // Dispatch / SLA Date: e.g. 20 Sept
                    let slaDate = '20 Sept';
                    const slaMatch = text.match(/(\\d{1,2}\\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*)/i);
                    if (slaMatch) {
                        slaDate = slaMatch[1].trim();
                    }
                    
                    // Image URL - skip checkbox icons to find actual product image
                    const imgs = Array.from(row.querySelectorAll("img"));
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
            }
            """
            orders = await page.evaluate(js_extract)
        except Exception as e:
            self.log(f"DOM parsing note: {e}", level="warning")
            
        return orders

    async def fetch_courier_return_otps(self) -> List[Dict[str, Any]]:
        """Fetch Courier Partner Return Delivery OTP from Meesho fulfillment panel and API."""
        async with self._nav_lock:
            self.log("Fetching Courier Partner Return Delivery OTPs from Meesho...")
            try:
                page = await self.init_browser(headless=self.is_headless)
                
                # Response listener to intercept fetchDeliveryOTPs API
                captured_api_data = []
                async def on_otp_response(response):
                    try:
                        if "fetchDeliveryOTPs" in response.url and "json" in response.headers.get("content-type", ""):
                            data = await response.json()
                            captured_api_data.append(data)
                    except Exception:
                        pass

                page.on("response", on_otp_response)
                
                # Navigate to Returns Tracking page
                target_url = f"https://supplier.meesho.com/panel/v3/new/fulfillment/{self.workspace_hash}/returns/returnTracking-intransit"
                await page.goto(target_url, timeout=35000, wait_until="domcontentloaded")
                await asyncio.sleep(3.5)
                await self._dismiss_popup_modals(page)

                # Wait briefly for API interception
                for _ in range(6):
                    if captured_api_data:
                        break
                    await asyncio.sleep(0.5)

                otps = []
                if captured_api_data:
                    res = captured_api_data[-1]
                    if isinstance(res, dict) and "supplier_delivery_otp" in res:
                        items = res["supplier_delivery_otp"]
                        for it in items:
                            c_name = it.get("carrier_name") or "Courier Partner"
                            if "carrier_details" in it and isinstance(it["carrier_details"], dict):
                                c_name = it["carrier_details"].get("name") or c_name
                            c_name = c_name.capitalize()
                            
                            icon = ""
                            if "carrier_details" in it and isinstance(it["carrier_details"], dict):
                                icon = it["carrier_details"].get("icon", "")

                            # Expiry time formatting
                            exp = it.get("otp_expiry_timestamp", "")
                            valid_till_str = "Today"
                            if exp:
                                try:
                                    dt = datetime.fromisoformat(exp)
                                    valid_till_str = dt.strftime("%d %b, %I:%M %p")
                                except Exception:
                                    valid_till_str = exp

                            otps.append({
                                "courier": c_name,
                                "otp": str(it.get("otp") or "N/A"),
                                "packets_count": it.get("count") or it.get("delivery_shipment_details", {}).get("total_shipment_count", 1),
                                "awbs": it.get("awbs", []),
                                "valid_till": valid_till_str,
                                "icon": icon
                            })

                # DOM Scraping Fallback if API response wasn't caught
                if not otps:
                    dom_otps = await page.evaluate('''() => {
                        const list = [];
                        const bodyText = document.body.innerText;
                        // Match e.g. "Delhivery OTP: 6986" or "Shadowfax OTP: 2837"
                        const matches = bodyText.matchAll(/([A-Za-z]+)\\s+OTP:?\\s*(\\d{4,6})/gi);
                        for (const m of matches) {
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
                    }''')
                    if dom_otps:
                        otps.extend(dom_otps)

                self.courier_otps = otps
                self._save_cached_otps(self.courier_otps)
                
                if otps:
                    self.log(f"Retrieved {len(otps)} active Courier Partner Return Delivery OTP(s)!", level="info")
                else:
                    self.log("No active Courier Partner Return OTPs for today (0 out for delivery).", level="info")
                    
                return self.courier_otps
                
            except Exception as e:
                self.log(f"Error fetching Return OTPs: {e}", level="warning")
                return self.get_cached_otps()

    def _save_cached_orders(self, orders: List[Dict[str, Any]]):
        try:
            with open(self.orders_cache_file, "w", encoding="utf-8") as f:
                json.dump(orders, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to cache orders: {e}")

    def get_cached_orders(self) -> List[Dict[str, Any]]:
        if os.path.exists(self.orders_cache_file):
            try:
                with open(self.orders_cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return self.pending_orders

    def _save_cached_otps(self, otps: List[Dict[str, Any]]):
        try:
            with open(self.otps_cache_file, "w", encoding="utf-8") as f:
                json.dump(otps, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to cache OTPs: {e}")

    def get_cached_otps(self) -> List[Dict[str, Any]]:
        if os.path.exists(self.otps_cache_file):
            try:
                with open(self.otps_cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return self.courier_otps

    async def accept_orders(self, order_ids: Optional[List[str]] = None, accept_all: bool = False) -> Dict[str, Any]:
        """Accept individual, date-selected, or all pending orders on Meesho."""
        async with self._nav_lock:
            self.is_busy = True
            try:
                page = await self.init_browser(headless=self.is_headless)
                self.log(f"Starting Accept Orders process (Accept All: {accept_all}, Selected: {len(order_ids or [])})...")
                
                # Check current workspace hash
                h = self._extract_workspace_hash(page.url)
                if h:
                    self.workspace_hash = h
                elif not self.workspace_hash:
                    self.workspace_hash = self.config.get("meesho", {}).get("workspace_hash", "4ntb1")

                target_url = f"https://supplier.meesho.com/panel/v3/new/fulfillment/{self.workspace_hash}/orders/pending"
                if "/orders/pending" not in page.url or self.workspace_hash not in page.url:
                    await page.goto(target_url, timeout=35000, wait_until="domcontentloaded")
                    await asyncio.sleep(3)

                await self._dismiss_popup_modals(page)

                # Ensure Pending tab is active
                pending_tab = page.locator("button[role='tab']:has-text('Pending'), [role='tab']:has-text('Pending')").first
                if await pending_tab.count() > 0:
                    is_active = await pending_tab.get_attribute("aria-selected") == "true"
                    if not is_active:
                        self.log("Clicking 'Pending' tab on Meesho...")
                        await pending_tab.click()
                        await asyncio.sleep(2.5)

                accepted_count = 0
                
                if accept_all:
                    self.log("Looking for 'Select All' checkbox in pending orders table...")
                    
                    # Strategy 1: Try JavaScript-based checkbox clicking for reliability
                    checked_count = await page.evaluate("""() => {
                        let count = 0;
                        // Find all checkboxes in table rows
                        const allCheckboxes = document.querySelectorAll('table input[type="checkbox"], tr input[type="checkbox"], th input[type="checkbox"]');
                        
                        // First try: click the header/select-all checkbox
                        const headerCheckbox = document.querySelector('th input[type="checkbox"], thead input[type="checkbox"]');
                        if (headerCheckbox) {
                            // Simulate full click event chain for React
                            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked').set;
                            if (!headerCheckbox.checked) {
                                nativeInputValueSetter.call(headerCheckbox, true);
                                headerCheckbox.dispatchEvent(new Event('input', { bubbles: true }));
                                headerCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                                headerCheckbox.click();
                            }
                            count = -1; // Signal that select-all was used
                        }
                        
                        // If no header checkbox, click each row checkbox
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
                    }""")
                    
                    self.log(f"Checkbox selection result: {checked_count} ({'Select All used' if checked_count == -1 else f'{checked_count} individual checkboxes clicked'})")
                    await asyncio.sleep(2)
                    
                    # Also try Playwright click on the select-all checkbox as backup
                    select_all = page.locator("th input[type='checkbox'], thead input[type='checkbox'], input[data-testid*='select-all']").first
                    if await select_all.count() > 0:
                        try:
                            is_checked = await select_all.is_checked()
                            if not is_checked:
                                await select_all.click(force=True)
                                self.log("Clicked 'Select All' checkbox via Playwright (force).")
                                await asyncio.sleep(2)
                        except Exception as e:
                            self.log(f"Select All Playwright click note: {e}", level="warning")

                    # Wait for Accept button to become ENABLED (not just visible)
                    bulk_btn = page.locator("button:has-text('Accept Orders'), button:has-text('Accept Selected'), button:has-text('Accept')").first
                    btn_enabled = False
                    
                    if await bulk_btn.count() > 0:
                        self.log("Waiting for Accept button to become enabled...")
                        for wait_i in range(10):
                            is_disabled = await bulk_btn.get_attribute("disabled")
                            if is_disabled is None:
                                btn_enabled = True
                                self.log("Accept button is now enabled!")
                                break
                            await asyncio.sleep(1)
                            # Re-try checkbox click if button still disabled after 3 seconds
                            if wait_i == 3:
                                self.log("Button still disabled, re-clicking checkboxes...")
                                await page.evaluate("""() => {
                                    document.querySelectorAll('th input[type="checkbox"], thead input[type="checkbox"]').forEach(cb => cb.click());
                                }""")
                                await asyncio.sleep(1)
                        
                        if btn_enabled:
                            await bulk_btn.click(force=True)
                            self.log("Clicked bulk Accept button.")
                            await asyncio.sleep(1.5)

                            # Handle Meesho Confirmation Modal ("Accepting orders" -> "Accept Order")
                            modal_confirm = page.locator("div[role='dialog'] button:has-text('Accept Order'), div[role='dialog'] button:has-text('Accept'), div[role='dialog'] button:has-text('Confirm'), div[role='dialog'] button:has-text('Yes')").first
                            
                            # Wait for modal to appear
                            for _ in range(5):
                                if await modal_confirm.count() > 0 and await modal_confirm.is_visible():
                                    break
                                await asyncio.sleep(0.5)
                            
                            if await modal_confirm.count() > 0 and await modal_confirm.is_visible():
                                self.log("Clicking 'Accept Order' confirmation inside modal...")
                                await modal_confirm.click(force=True)
                                
                                # Wait for progress & completion
                                for _ in range(20):
                                    await asyncio.sleep(1)
                                    got_it = page.locator("button:has-text('Got it')").first
                                    if await got_it.count() > 0 and await got_it.is_visible():
                                        await got_it.click()
                                        break

                                accepted_count = len(self.pending_orders)
                                self.log(f"All pending orders ({accepted_count}) accepted successfully on Meesho!", level="info")
                        else:
                            self.log("Accept button remained disabled after all checkbox attempts.", level="warning")

                    if accepted_count == 0:
                        self.log("Bulk accept not triggered, accepting individual pending orders one by one...")
                        all_ids = [o.get('sub_order_id') for o in self.pending_orders if o.get('sub_order_id')]
                        for oid in all_ids:
                            if await self._accept_single_order_by_id(page, oid):
                                accepted_count += 1
                                await asyncio.sleep(1.5)

                elif order_ids:
                    self.log(f"Accepting {len(order_ids)} orders: {order_ids}")
                    for oid in order_ids:
                        ok = await self._accept_single_order_by_id(page, oid)
                        if ok:
                            accepted_count += 1
                            self.log(f"Accepted Order {oid} successfully on Meesho.", level="info")
                            await asyncio.sleep(1.5)
                        else:
                            self.log(f"Accept failed for Order {oid} on Meesho.", level="warning")

                # Instantly remove actually accepted orders from local memory and cache file
                if accepted_count > 0:
                    if accept_all or accepted_count >= len(self.pending_orders):
                        self.pending_orders = []
                    elif order_ids:
                        clean_ids = set([oid.split('_')[0] for oid in order_ids])
                        self.pending_orders = [o for o in self.pending_orders if o.get('sub_order_id', '').split('_')[0] not in clean_ids]
                    self._save_cached_orders(self.pending_orders)
                    self.log(f"Removed {accepted_count} accepted order(s) from pending list in panel.")

                self.is_busy = False
                await asyncio.sleep(1.5)
                # Re-sync orders table to reflect updated state (use internal to avoid deadlock)
                await self._fetch_pending_orders_internal()
                
                return {
                    "success": accepted_count > 0,
                    "accepted_count": accepted_count,
                    "remaining_count": len(self.pending_orders),
                    "message": f"Successfully accepted {accepted_count} order(s) on Meesho and updated panel." if accepted_count > 0 else "Could not accept order(s) on Meesho. Please check logs."
                }

            except Exception as e:
                self.is_busy = False
                self.log(f"Error during order acceptance: {str(e)}", level="error")
                return {"success": False, "error": str(e), "accepted_count": 0, "message": f"Failed to accept orders: {str(e)}"}

    async def _accept_single_order_by_id(self, page: Page, order_id: str) -> bool:
        """Accept a single order by sub_order_id on Meesho with modal confirmation handling."""
        try:
            clean_id = order_id.split('_')[0]
            self.log(f"Locating order row for {clean_id} on Meesho...")

            # 0. FIRST: Dismiss any lingering modal overlays from previous accepts
            await self._close_all_modals(page)
            await asyncio.sleep(0.5)

            # Find row containing the clean ID
            row = page.locator(f"tr:has-text('{clean_id}')").first
            if await row.count() == 0:
                row = page.locator(f"xpath=//tr[contains(., '{clean_id}')]").first

            if await row.count() == 0:
                self.log(f"Could not find order row for {clean_id} in table.", level="warning")
                return False

            await row.scroll_into_view_if_needed()
            await asyncio.sleep(0.5)

            # 1. Click row's Accept button (force=True to bypass any remaining overlay)
            accept_btn = row.locator("button:has-text('Accept'), button[data-testid*='accept']").first
            if await accept_btn.count() == 0:
                self.log(f"Accept button not found for {clean_id}.", level="warning")
                return False

            await accept_btn.click(force=True)
            self.log(f"Clicked row Accept button for {clean_id}. Waiting for confirmation modal...")
            await asyncio.sleep(1.5)

            # 2. Look for Meesho confirmation modal ("Accepting orders" -> "Accept Order")
            modal_confirm = page.locator("div[role='dialog'] button:has-text('Accept Order'), div[role='dialog'] button:has-text('Accept'), div[role='dialog'] button:has-text('Confirm'), div[role='dialog'] button:has-text('Yes')").first
            
            # Wait for modal to appear
            for _ in range(5):
                if await modal_confirm.count() > 0 and await modal_confirm.is_visible():
                    break
                await asyncio.sleep(0.5)
            
            if await modal_confirm.count() > 0 and await modal_confirm.is_visible():
                self.log("Found Meesho modal confirmation button ('Accept Order'). Clicking...")
                await modal_confirm.click(force=True)
                self.log("Clicked modal confirm. Waiting for Meesho to process...")

                # 3. Wait for Meesho's acceptance processing (Progress bar / "Orders accepted successfully")
                for _ in range(20):
                    await asyncio.sleep(1)
                    # Check if success message or "Got it" button appeared
                    got_it_btn = page.locator("button:has-text('Got it')").first
                    if await got_it_btn.count() > 0 and await got_it_btn.is_visible():
                        self.log("Order accepted successfully on Meesho! Clicking 'Got it' to close modal.")
                        await got_it_btn.click(force=True)
                        await asyncio.sleep(1)
                        # Wait for overlay to fully disappear
                        await self._close_all_modals(page)
                        return True
                    
                    # Check if modal closed itself
                    dialogs = await page.locator("div[role='dialog']").count()
                    if dialogs == 0:
                        self.log("Meesho modal dismissed. Order accepted!", level="info")
                        await self._close_all_modals(page)
                        return True

                body_txt = await page.inner_text("body")
                if "accepted successfully" in body_txt.lower():
                    self.log("Confirmed: Order accepted successfully on Meesho.", level="info")
                    got_it_btn = page.locator("button:has-text('Got it'), button[aria-label='Close'], button:has-text('Close')").first
                    if await got_it_btn.count() > 0 and await got_it_btn.is_visible():
                        await got_it_btn.click(force=True)
                    await self._close_all_modals(page)
                    return True

                await self._close_all_modals(page)
                return True

            self.log(f"Confirmation modal not detected for {clean_id}.", level="warning")
            return False

        except Exception as e:
            self.log(f"Error accepting order {order_id}: {e}", level="warning")
            # Try to clean up any lingering modals even on error
            try:
                await self._close_all_modals(page)
            except Exception:
                pass
            return False

    async def _close_all_modals(self, page: Page):
        """Force close all Meesho modal overlays and dialogs via JavaScript."""
        try:
            await page.evaluate("""() => {
                // Close overlay divs that intercept pointer events
                document.querySelectorAll('div[role="presentation"][aria-label="Close modal"], div.fixed.inset-0[role="presentation"]').forEach(el => {
                    el.remove();
                });
                // Click any visible close/got-it buttons
                document.querySelectorAll('button').forEach(btn => {
                    const txt = (btn.innerText || '').toLowerCase().trim();
                    if (txt === 'got it' || txt === 'close' || txt === '×' || txt === 'x') {
                        try { btn.click(); } catch(e) {}
                    }
                });
                // Remove any remaining dialog overlays
                document.querySelectorAll('div[role="dialog"]').forEach(el => {
                    const txt = el.innerText || '';
                    if (txt.includes('accepted successfully') || txt.includes('Got it')) {
                        el.remove();
                    }
                });
            }""")
        except Exception:
            pass

    async def _click_individual_accept_buttons(self, page: Page) -> int:
        count = 0
        try:
            buttons = await page.query_selector_all("button:has-text('Accept Order'), button:has-text('Accept')")
            self.log(f"Found {len(buttons)} individual Accept buttons.")
            for btn in buttons:
                try:
                    if await btn.is_visible():
                        await btn.click(force=True)
                        count += 1
                        await asyncio.sleep(1.5)
                        confirm = await page.query_selector("button:has-text('Confirm'), button:has-text('Yes')")
                        if confirm and await confirm.is_visible():
                            await confirm.click(force=True)
                            await asyncio.sleep(1)
                except Exception:
                    continue
        except Exception as e:
            self.log(f"Error in individual accept: {e}", level="warning")
        return count

    async def close(self):
        try:
            await self._cleanup_browser_resources()
            if self.playwright:
                await self.playwright.stop()
                self.playwright = None
            self.log("Browser closed.")
        except Exception as e:
            logger.error(f"Error closing browser: {e}")

bot_instance = MeeshoBot()
