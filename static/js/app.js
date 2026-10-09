// Meesho Multi-Store Order Manager - Frontend Client Logic

document.addEventListener('DOMContentLoaded', () => {
    // State
    let currentUser = null;
    let authToken = localStorage.getItem('auth_token') || '';
    let accounts = [];
    let selectedAccountId = 'all';
    let orders = [];
    let selectedOrderIds = new Set();
    let selectedDateFilter = 'ALL';
    let searchQuery = '';
    let otps = [];
    let autoAcceptRemainingSeconds = 0;
    let countdownTimer = null;
    let autoScroll = true;
    let lastLogCount = 0;

    // Elements - Auth
    const authPortalSection = document.getElementById('authPortalSection');
    const dashboardBody = document.getElementById('dashboardBody');
    const navControls = document.getElementById('navControls');
    const btnNavAuthOpen = document.getElementById('btnNavAuthOpen');
    const userProfileBadge = document.getElementById('userProfileBadge');
    const navUsername = document.getElementById('navUsername');
    const btnUserLogout = document.getElementById('btnUserLogout');

    const authForm = document.getElementById('authForm');
    const authFormTitle = document.getElementById('authFormTitle');
    const tabBtnLogin = document.getElementById('tabBtnLogin');
    const tabBtnRegister = document.getElementById('tabBtnRegister');
    const groupUsername = document.getElementById('groupUsername');
    const authUsername = document.getElementById('authUsername');
    const authEmail = document.getElementById('authEmail');
    const authPassword = document.getElementById('authPassword');
    const btnToggleAuthPwd = document.getElementById('btnToggleAuthPwd');
    const authErrorBox = document.getElementById('authErrorBox');
    const btnAuthSubmit = document.getElementById('btnAuthSubmit');
    const authSpinner = document.getElementById('authSpinner');
    const authBtnText = document.getElementById('authBtnText');
    let isRegisterMode = false;

    // Elements - Stores & Stats
    const storesCountBadge = document.getElementById('storesCountBadge');
    const storesChipsContainer = document.getElementById('storesChipsContainer');
    const btnOpenAddStoreModal = document.getElementById('btnOpenAddStoreModal');
    const statPendingCount = document.getElementById('statPendingCount');
    const statPendingSub = document.getElementById('statPendingSub');
    const statSelectedCount = document.getElementById('statSelectedCount');
    const statStoresCount = document.getElementById('statStoresCount');

    // Auto-Accept
    const autoAcceptToggle = document.getElementById('autoAcceptToggle');
    const autoAcceptInterval = document.getElementById('autoAcceptInterval');
    const autoAcceptCountdown = document.getElementById('autoAcceptCountdown');

    // Courier Return OTPs
    const btnRefreshAllOtps = document.getElementById('btnRefreshAllOtps');
    const otpSpinner = document.getElementById('otpSpinner');
    const otpBtnText = document.getElementById('otpBtnText');
    const otpLastUpdated = document.getElementById('otpLastUpdated');
    const noOtpBanner = document.getElementById('noOtpBanner');
    const otpCardsGrid = document.getElementById('otpCardsGrid');

    // Actions & Table
    const btnSyncAllOrders = document.getElementById('btnSyncAllOrders');
    const syncSpinner = document.getElementById('syncSpinner');
    const syncBtnText = document.getElementById('syncBtnText');
    const searchInput = document.getElementById('searchInput');
    const btnAcceptSelected = document.getElementById('btnAcceptSelected');
    const selectedBadge = document.getElementById('selectedBadge');
    const btnAcceptAllStores = document.getElementById('btnAcceptAllStores');
    const dateChipsContainer = document.getElementById('dateChipsContainer');
    const ordersTable = document.getElementById('ordersTable');
    const ordersTableBody = document.getElementById('ordersTableBody');
    const emptyState = document.getElementById('emptyState');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const btnEmptySync = document.getElementById('btnEmptySync');

    // Terminal
    const terminalLogs = document.getElementById('terminalLogs');
    const autoScrollCheck = document.getElementById('autoScrollCheck');
    const btnClearLogs = document.getElementById('btnClearLogs');

    // Add Store Modal
    const addStoreModal = document.getElementById('addStoreModal');
    const btnCloseAddStoreModal = document.getElementById('btnCloseAddStoreModal');
    const btnCancelAddStore = document.getElementById('btnCancelAddStore');
    const btnSubmitAddStore = document.getElementById('btnSubmitAddStore');
    const addStoreSpinner = document.getElementById('addStoreSpinner');
    const addStoreBtnText = document.getElementById('addStoreBtnText');
    const newStoreName = document.getElementById('newStoreName');
    const newStoreEmail = document.getElementById('newStoreEmail');
    const newStorePassword = document.getElementById('newStorePassword');
    const newStoreHash = document.getElementById('newStoreHash');
    const addStoreError = document.getElementById('addStoreError');
    const btnToggleStorePwd = document.getElementById('btnToggleStorePwd');

    // Confirm Modal
    const confirmModal = document.getElementById('confirmModal');
    const btnCloseConfirmModal = document.getElementById('btnCloseConfirmModal');
    const btnCancelConfirm = document.getElementById('btnCancelConfirm');
    const btnExecuteConfirm = document.getElementById('btnExecuteConfirm');
    const confirmModalText = document.getElementById('confirmModalText');
    let pendingConfirmAction = null;

    // Toast Container
    const toastContainer = document.getElementById('toastContainer');

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icons = { success: '✅', error: '❌', info: 'ℹ️' };
        toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // Helper fetch with auth
    async function apiFetch(url, options = {}) {
        options.headers = options.headers || {};
        if (authToken) {
            options.headers['Authorization'] = `Bearer ${authToken}`;
        }
        if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(options.body);
        }
        const res = await fetch(url, options);
        if (res.status === 401) {
            handleLogout();
            throw new Error('Session expired. Please log in.');
        }
        return res;
    }

    // ----------------- USER AUTHENTICATION -----------------

    function setAuthMode(register) {
        isRegisterMode = register;
        if (register) {
            tabBtnRegister.classList.add('active');
            tabBtnLogin.classList.remove('active');
            groupUsername.classList.remove('hide');
            authFormTitle.textContent = 'Create New Account';
            authBtnText.textContent = 'Sign Up';
        } else {
            tabBtnLogin.classList.add('active');
            tabBtnRegister.classList.remove('active');
            groupUsername.classList.add('hide');
            authFormTitle.textContent = 'Sign In to Meesho Hub';
            authBtnText.textContent = 'Sign In';
        }
        authErrorBox.classList.add('hide');
    }

    tabBtnLogin.addEventListener('click', () => setAuthMode(false));
    tabBtnRegister.addEventListener('click', () => setAuthMode(true));

    btnToggleAuthPwd.addEventListener('click', () => {
        authPassword.type = authPassword.type === 'password' ? 'text' : 'password';
    });

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        authErrorBox.classList.add('hide');
        authSpinner.classList.remove('hide');
        btnAuthSubmit.disabled = true;

        const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
        const payload = {
            email: authEmail.value.trim(),
            password: authPassword.value
        };
        if (isRegisterMode) {
            payload.username = authUsername.value.trim();
        }

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.message || 'Authentication failed');
            }

            authToken = data.token;
            localStorage.setItem('auth_token', authToken);
            currentUser = data.user;
            showToast(data.message || 'Welcome!', 'success');
            onUserLoggedIn();
        } catch (err) {
            authErrorBox.textContent = err.message;
            authErrorBox.classList.remove('hide');
        } finally {
            authSpinner.classList.add('hide');
            btnAuthSubmit.disabled = false;
        }
    });

    async function checkUserAuth() {
        if (!authToken) {
            renderLoggedOut();
            return;
        }
        try {
            const res = await apiFetch('/api/auth/me');
            const data = await res.json();
            if (data.logged_in && data.user) {
                currentUser = data.user;
                onUserLoggedIn();
            } else {
                renderLoggedOut();
            }
        } catch (e) {
            renderLoggedOut();
        }
    }

    function onUserLoggedIn() {
        authPortalSection.classList.add('hide');
        dashboardBody.classList.remove('hide');
        btnNavAuthOpen.classList.add('hide');
        userProfileBadge.classList.remove('hide');
        btnUserLogout.classList.remove('hide');
        navUsername.textContent = currentUser ? currentUser.username : 'User';

        loadAccounts();
        loadOrders(false);
        loadOtps(false);
        updateStatus();
    }

    function renderLoggedOut() {
        authPortalSection.classList.remove('hide');
        dashboardBody.classList.add('hide');
        btnNavAuthOpen.classList.remove('hide');
        userProfileBadge.classList.add('hide');
        btnUserLogout.classList.add('hide');
        currentUser = null;
        accounts = [];
        orders = [];
        otps = [];
    }

    function handleLogout() {
        apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        localStorage.removeItem('auth_token');
        authToken = '';
        renderLoggedOut();
        showToast('Logged out successfully.', 'info');
    }

    btnUserLogout.addEventListener('click', handleLogout);
    btnNavAuthOpen.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // ----------------- ACCOUNTS MANAGEMENT -----------------

    async function loadAccounts() {
        try {
            const res = await apiFetch('/api/accounts');
            const data = await res.json();
            if (data.status === 'success') {
                accounts = data.accounts || [];
                renderStoreChips();
                statStoresCount.textContent = accounts.length;
                storesCountBadge.textContent = `${accounts.length} Connected`;
            }
        } catch (e) {}
    }

    function renderStoreChips() {
        storesChipsContainer.innerHTML = '';

        // All Stores Chip
        const allChip = document.createElement('button');
        allChip.className = `store-filter-chip ${selectedAccountId === 'all' ? 'active' : ''}`;
        allChip.innerHTML = `<span>🌐 All Stores (Combined)</span>`;
        allChip.addEventListener('click', () => {
            selectedAccountId = 'all';
            renderStoreChips();
            loadOrders(false);
            loadOtps(false);
        });
        storesChipsContainer.appendChild(allChip);

        accounts.forEach(acc => {
            const chip = document.createElement('div');
            chip.className = `store-filter-chip ${selectedAccountId === acc.id ? 'active' : ''}`;
            const isOnline = acc.status === 'CONNECTED';
            const statusDot = isOnline ? '🟢' : '🔴';

            chip.innerHTML = `
                <span>${statusDot}</span>
                <strong>${acc.store_name}</strong>
                <span class="store-badge-tag">${acc.orders_count || 0} Orders</span>
                <button class="store-card-delete-btn" title="Delete store">×</button>
            `;

            chip.addEventListener('click', (e) => {
                if (e.target.classList.contains('store-card-delete-btn')) return;
                selectedAccountId = acc.id;
                renderStoreChips();
                loadOrders(false);
                loadOtps(false);
            });

            chip.querySelector('.store-card-delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                confirmModalText.textContent = `Are you sure you want to remove store "${acc.store_name}"?`;
                pendingConfirmAction = async () => {
                    await apiFetch(`/api/accounts/${acc.id}`, { method: 'DELETE' });
                    showToast(`Removed store ${acc.store_name}`, 'info');
                    if (selectedAccountId === acc.id) selectedAccountId = 'all';
                    loadAccounts();
                    loadOrders(false);
                };
                confirmModal.classList.remove('hide');
            });

            storesChipsContainer.appendChild(chip);
        });
    }

    // Add Store Modal
    btnOpenAddStoreModal.addEventListener('click', () => {
        newStoreName.value = '';
        newStoreEmail.value = '';
        newStorePassword.value = '';
        newStoreHash.value = '';
        addStoreError.classList.add('hide');
        addStoreModal.classList.remove('hide');
    });

    btnCloseAddStoreModal.addEventListener('click', () => addStoreModal.classList.add('hide'));
    btnCancelAddStore.addEventListener('click', () => addStoreModal.classList.add('hide'));
    btnToggleStorePwd.addEventListener('click', () => {
        newStorePassword.type = newStorePassword.type === 'password' ? 'text' : 'password';
    });

    btnSubmitAddStore.addEventListener('click', async () => {
        const email = newStoreEmail.value.trim();
        const pwd = newStorePassword.value;
        if (!email || !pwd) {
            addStoreError.textContent = 'Please provide Meesho Email/Phone and Password.';
            addStoreError.classList.remove('hide');
            return;
        }

        addStoreError.classList.add('hide');
        addStoreSpinner.classList.remove('hide');
        btnSubmitAddStore.disabled = true;

        try {
            const res = await apiFetch('/api/accounts', {
                method: 'POST',
                body: {
                    email_or_phone: email,
                    password: pwd,
                    store_name: newStoreName.value.trim(),
                    workspace_hash: newStoreHash.value.trim()
                }
            });
            const data = await res.json();

            if (data.status === 'success') {
                showToast(data.message, 'success');
                addStoreModal.classList.add('hide');
                loadAccounts();
                loadOrders(true);
            } else {
                throw new Error(data.message || 'Failed to add store.');
            }
        } catch (err) {
            addStoreError.textContent = err.message;
            addStoreError.classList.remove('hide');
        } finally {
            addStoreSpinner.classList.add('hide');
            btnSubmitAddStore.disabled = false;
        }
    });

    // ----------------- ORDERS MANAGEMENT -----------------

    async function loadOrders(sync = false) {
        if (sync) {
            syncSpinner.classList.remove('hide');
            btnSyncAllOrders.disabled = true;
        }

        try {
            const url = `/api/orders/pending?sync=${sync}&accountId=${selectedAccountId}`;
            const res = await apiFetch(url);
            const data = await res.json();

            if (data.status === 'success') {
                orders = data.orders || [];
                selectedOrderIds.clear();
                renderDateChips();
                renderOrdersTable();
                statPendingCount.textContent = orders.length;
                statSelectedCount.textContent = '0';
                btnAcceptSelected.disabled = true;
                selectedBadge.textContent = '0';
                if (sync) {
                    showToast(data.message || 'Orders synchronized!', 'success');
                }
            }
        } catch (e) {
            if (sync) showToast(e.message, 'error');
        } finally {
            if (sync) {
                syncSpinner.classList.add('hide');
                btnSyncAllOrders.disabled = false;
            }
        }
    }

    btnSyncAllOrders.addEventListener('click', () => loadOrders(true));
    btnEmptySync.addEventListener('click', () => loadOrders(true));

    function renderDateChips() {
        const uniqueDates = Array.from(new Set(orders.map(o => o.sla_date).filter(Boolean)));
        dateChipsContainer.innerHTML = '';

        const allBtn = document.createElement('button');
        allBtn.className = `chip ${selectedDateFilter === 'ALL' ? 'active' : ''}`;
        allBtn.dataset.date = 'ALL';
        allBtn.textContent = `All Dates (${orders.length})`;
        allBtn.addEventListener('click', () => {
            selectedDateFilter = 'ALL';
            renderDateChips();
            renderOrdersTable();
        });
        dateChipsContainer.appendChild(allBtn);

        uniqueDates.forEach(date => {
            const count = orders.filter(o => o.sla_date === date).length;
            const btn = document.createElement('button');
            btn.className = `chip ${selectedDateFilter === date ? 'active' : ''}`;
            btn.dataset.date = date;
            btn.textContent = `${date} (${count})`;
            btn.addEventListener('click', () => {
                selectedDateFilter = date;
                renderDateChips();
                renderOrdersTable();
            });
            dateChipsContainer.appendChild(btn);
        });
    }

    function renderOrdersTable() {
        ordersTableBody.innerHTML = '';

        let filtered = orders;
        if (selectedDateFilter !== 'ALL') {
            filtered = filtered.filter(o => o.sla_date === selectedDateFilter);
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(o =>
                (o.sub_order_id && o.sub_order_id.toLowerCase().includes(q)) ||
                (o.sku && o.sku.toLowerCase().includes(q)) ||
                (o.product_name && o.product_name.toLowerCase().includes(q)) ||
                (o.storeName && o.storeName.toLowerCase().includes(q))
            );
        }

        if (filtered.length === 0) {
            ordersTable.classList.add('hide');
            emptyState.classList.remove('hide');
            return;
        }

        ordersTable.classList.remove('hide');
        emptyState.classList.add('hide');

        filtered.forEach(order => {
            const tr = document.createElement('tr');
            const isChecked = selectedOrderIds.has(order.sub_order_id);

            tr.innerHTML = `
                <td style="text-align: center;">
                    <input type="checkbox" class="row-checkbox" data-id="${order.sub_order_id}" ${isChecked ? 'checked' : ''} />
                </td>
                <td>
                    <span class="store-badge-tag pink">🏪 ${order.storeName || 'Store'}</span>
                </td>
                <td><strong class="font-mono">${order.sub_order_id}</strong></td>
                <td><span class="sku-pill font-mono">${order.sku}</span></td>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        ${order.image_url ? `<img src="${order.image_url}" style="width: 28px; height: 28px; border-radius: 4px; object-fit: cover;" />` : ''}
                        <span title="${order.product_name}">${order.product_name.substring(0, 45)}...</span>
                    </div>
                </td>
                <td style="text-align: center;">${order.quantity || 1}</td>
                <td><span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">${order.sla_date}</span></td>
                <td>${order.order_date || 'Today'}</td>
                <td style="text-align: right;">
                    <button class="btn btn-sm btn-primary btn-accept-row" data-id="${order.sub_order_id}" data-account="${order.accountId}">
                        <span>Accept</span>
                    </button>
                </td>
            `;

            tr.querySelector('.row-checkbox').addEventListener('change', (e) => {
                if (e.target.checked) selectedOrderIds.add(order.sub_order_id);
                else selectedOrderIds.delete(order.sub_order_id);
                updateSelectedUI();
            });

            tr.querySelector('.btn-accept-row').addEventListener('click', () => {
                executeAccept([order.sub_order_id], false, order.accountId);
            });

            ordersTableBody.appendChild(tr);
        });

        selectAllCheckbox.checked = filtered.length > 0 && filtered.every(o => selectedOrderIds.has(o.sub_order_id));
    }

    selectAllCheckbox.addEventListener('change', (e) => {
        const checked = e.target.checked;
        let visible = orders;
        if (selectedDateFilter !== 'ALL') visible = visible.filter(o => o.sla_date === selectedDateFilter);
        visible.forEach(o => {
            if (checked) selectedOrderIds.add(o.sub_order_id);
            else selectedOrderIds.delete(o.sub_order_id);
        });
        renderOrdersTable();
        updateSelectedUI();
    });

    function updateSelectedUI() {
        const count = selectedOrderIds.size;
        statSelectedCount.textContent = count;
        selectedBadge.textContent = count;
        btnAcceptSelected.disabled = count === 0;
    }

    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderOrdersTable();
    });

    // Accept Selected
    btnAcceptSelected.addEventListener('click', () => {
        if (selectedOrderIds.size === 0) return;
        confirmModalText.textContent = `Accept ${selectedOrderIds.size} selected order(s)?`;
        pendingConfirmAction = () => executeAccept(Array.from(selectedOrderIds), false, selectedAccountId);
        confirmModal.classList.remove('hide');
    });

    // Accept All Stores Simultaneously
    btnAcceptAllStores.addEventListener('click', () => {
        confirmModalText.textContent = `Accept ALL pending orders across all connected stores simultaneously?`;
        pendingConfirmAction = () => executeAccept([], true, 'all');
        confirmModal.classList.remove('hide');
    });

    async function executeAccept(orderIds, acceptAll, accountId) {
        showToast('Initiating order accept...', 'info');
        try {
            const res = await apiFetch('/api/orders/accept', {
                method: 'POST',
                body: {
                    account_id: accountId,
                    accept_all: acceptAll,
                    order_ids: orderIds
                }
            });
            const data = await res.json();
            if (data.status === 'success') {
                showToast(data.message, 'success');
                selectedOrderIds.clear();
                updateSelectedUI();
                loadOrders(false);
            } else {
                showToast(data.message || 'Accept failed', 'error');
            }
        } catch (e) {
            showToast(e.message, 'error');
        }
    }

    // ----------------- COURIER RETURN OTPS (UNIFIED) -----------------

    async function loadOtps(sync = false) {
        if (sync) {
            otpSpinner.classList.remove('hide');
            btnRefreshAllOtps.disabled = true;
        }

        try {
            const res = await apiFetch(`/api/returns/otp?sync=${sync}&accountId=${selectedAccountId}`);
            const data = await res.json();
            if (data.status === 'success') {
                otps = data.otps || [];
                renderOtpCards();
                if (data.last_updated) otpLastUpdated.textContent = `Last checked: ${data.last_updated}`;
                if (sync) showToast(`Retrieved ${otps.length} active Courier Return OTP(s)`, 'success');
            }
        } catch (e) {
            if (sync) showToast(e.message, 'error');
        } finally {
            if (sync) {
                otpSpinner.classList.add('hide');
                btnRefreshAllOtps.disabled = false;
            }
        }
    }

    btnRefreshAllOtps.addEventListener('click', () => loadOtps(true));

    function renderOtpCards() {
        otpCardsGrid.innerHTML = '';
        if (otps.length === 0) {
            noOtpBanner.classList.remove('hide');
            otpCardsGrid.classList.add('hide');
            return;
        }

        noOtpBanner.classList.add('hide');
        otpCardsGrid.classList.remove('hide');

        otps.forEach(item => {
            const card = document.createElement('div');
            card.className = 'otp-card';
            card.innerHTML = `
                <div class="otp-card-header">
                    <span class="store-badge-tag pink">🏪 ${item.storeName || 'Store'}</span>
                    <span class="otp-courier-name">🚚 ${item.courier}</span>
                </div>
                <div class="otp-code-display">${item.otp}</div>
                <div class="otp-meta-row">
                    <span>📦 ${item.packets_count || 1} Parcels</span>
                    <span>⏰ ${item.valid_till || 'Today'}</span>
                </div>
            `;
            otpCardsGrid.appendChild(card);
        });
    }

    // ----------------- AUTO-ACCEPT SCHEDULER -----------------

    autoAcceptToggle.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        const mins = parseInt(autoAcceptInterval.value, 10);
        try {
            const res = await apiFetch('/api/auto-accept/toggle', {
                method: 'POST',
                body: { enabled, interval_minutes: mins }
            });
            const data = await res.json();
            showToast(data.message, 'success');
            updateSchedulerUI(data.scheduler);
        } catch (err) {
            e.target.checked = !enabled;
            showToast(err.message, 'error');
        }
    });

    autoAcceptInterval.addEventListener('change', async () => {
        if (autoAcceptToggle.checked) {
            const mins = parseInt(autoAcceptInterval.value, 10);
            await apiFetch('/api/auto-accept/toggle', {
                method: 'POST',
                body: { enabled: true, interval_minutes: mins }
            });
            showToast(`Auto-accept updated to every ${mins} minutes.`, 'info');
        }
    });

    function updateSchedulerUI(st) {
        if (!st) return;
        autoAcceptToggle.checked = Boolean(st.enabled);
        if (st.interval_minutes) autoAcceptInterval.value = String(st.interval_minutes);

        if (st.enabled && st.seconds_remaining > 0) {
            autoAcceptRemainingSeconds = st.seconds_remaining;
            startCountdown();
        } else if (!st.enabled) {
            clearInterval(countdownTimer);
            autoAcceptCountdown.textContent = 'Inactive';
            autoAcceptCountdown.classList.remove('active');
        }
    }

    function startCountdown() {
        clearInterval(countdownTimer);
        autoAcceptCountdown.classList.add('active');
        countdownTimer = setInterval(() => {
            if (autoAcceptRemainingSeconds <= 0) {
                autoAcceptCountdown.textContent = 'Triggering...';
                clearInterval(countdownTimer);
                return;
            }
            autoAcceptRemainingSeconds--;
            const mins = Math.floor(autoAcceptRemainingSeconds / 60);
            const secs = autoAcceptRemainingSeconds % 60;
            autoAcceptCountdown.textContent = `Next: ${mins}m ${secs}s`;
        }, 1000);
    }

    // ----------------- LIVE LOGS & SYSTEM POLLING -----------------

    async function pollLogs() {
        try {
            const res = await fetch(`/api/logs?accountId=${selectedAccountId}`);
            const data = await res.json();
            const logs = data.logs || [];

            if (logs.length !== lastLogCount) {
                lastLogCount = logs.length;
                terminalLogs.innerHTML = '';
                logs.forEach(l => {
                    const div = document.createElement('div');
                    div.className = `log-entry ${l.level || 'info'}`;
                    div.innerHTML = `
                        <span class="log-time">[${l.timestamp}]</span>
                        <span class="log-tag">[${l.storeName || 'System'}]</span>
                        <span class="log-msg">${l.message}</span>
                    `;
                    terminalLogs.appendChild(div);
                });
                if (autoScroll) {
                    terminalLogs.scrollTop = terminalLogs.scrollHeight;
                }
            }
        } catch (e) {}
    }

    async function updateStatus() {
        if (!authToken) return;
        try {
            const res = await apiFetch('/api/status');
            const data = await res.json();
            if (data.logged_in) {
                updateSchedulerUI(data.auto_accept);
            }
        } catch (e) {}
    }

    autoScrollCheck.addEventListener('change', (e) => {
        autoScroll = e.target.checked;
    });

    btnClearLogs.addEventListener('click', async () => {
        await apiFetch('/api/logs/clear', { method: 'POST' });
        terminalLogs.innerHTML = '';
        lastLogCount = 0;
    });

    // Confirm Modal Listeners
    btnCloseConfirmModal.addEventListener('click', () => confirmModal.classList.add('hide'));
    btnCancelConfirm.addEventListener('click', () => confirmModal.classList.add('hide'));
    btnExecuteConfirm.addEventListener('click', async () => {
        confirmModal.classList.add('hide');
        if (pendingConfirmAction) {
            await pendingConfirmAction();
            pendingConfirmAction = null;
        }
    });

    // Periodic Background Polling
    setInterval(pollLogs, 2500);
    setInterval(updateStatus, 10000);

    // Initial Start
    checkUserAuth();
    pollLogs();
});
