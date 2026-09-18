// Meesho Order Manager - Universal Multi-Account Controller

document.addEventListener('DOMContentLoaded', () => {
    // State
    let orders = [];
    let selectedOrderIds = new Set();
    let isLoggedIn = false;
    let isBotBusy = false;
    let autoScroll = true;
    let lastLogCount = 0;
    let selectedDateFilter = 'ALL';
    
    // Auto-Accept state
    let autoAcceptEnabled = false;
    let autoAcceptInterval = 30;
    let autoAcceptRemainingSeconds = 0;
    let countdownTimer = null;

    // Elements
    const sessionBadge = document.getElementById('sessionBadge');
    const sessionStatusText = document.getElementById('sessionStatusText');
    const statusDot = sessionBadge.querySelector('.status-dot');
    
    const btnLoginNav = document.getElementById('btnLoginNav');
    const btnCheckSession = document.getElementById('btnCheckSession');
    const btnSwitchAccount = document.getElementById('btnSwitchAccount');
    const btnLogout = document.getElementById('btnLogout');
    
    // Gated & Dashboard sections
    const loginGateSection = document.getElementById('loginGateSection');
    const btnGateLogin = document.getElementById('btnGateLogin');
    const dashboardBody = document.getElementById('dashboardBody');

    // Stats Elements
    const statPendingCount = document.getElementById('statPendingCount');
    const statSelectedCount = document.getElementById('statSelectedCount');
    const statAcceptedCount = document.getElementById('statAcceptedCount');

    // Store Info Elements
    const accountStoreName = document.getElementById('accountStoreName');
    const accountStoreEmail = document.getElementById('accountStoreEmail');

    // Return OTP Elements
    const btnRefreshOtp = document.getElementById('btnRefreshOtp');
    const otpSpinner = document.getElementById('otpSpinner');
    const otpBtnText = document.getElementById('otpBtnText');
    const otpLastUpdated = document.getElementById('otpLastUpdated');
    const noOtpBanner = document.getElementById('noOtpBanner');
    const otpCardsGrid = document.getElementById('otpCardsGrid');

    // Auto-Accept Elements
    const autoAcceptToggle = document.getElementById('autoAcceptToggle');
    const autoAcceptIntervalSelect = document.getElementById('autoAcceptInterval');
    const autoAcceptCountdown = document.getElementById('autoAcceptCountdown');

    // Action Toolbar
    const btnSyncOrders = document.getElementById('btnSyncOrders');
    const syncSpinner = document.getElementById('syncSpinner');
    const syncBtnText = document.getElementById('syncBtnText');
    const searchInput = document.getElementById('searchInput');
    const btnAcceptSelected = document.getElementById('btnAcceptSelected');
    const selectedBadge = document.getElementById('selectedBadge');
    const btnAcceptAll = document.getElementById('btnAcceptAll');

    // Chips & Table
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

    // Login Modal Elements
    const loginModal = document.getElementById('loginModal');
    const btnCloseLoginModal = document.getElementById('btnCloseLoginModal');
    const btnCancelModal = document.getElementById('btnCancelModal');
    const btnSubmitLogin = document.getElementById('btnSubmitLogin');
    const loginSpinner = document.getElementById('loginSpinner');
    const loginBtnText = document.getElementById('loginBtnText');
    const loginModalError = document.getElementById('loginModalError');
    const inputEmail = document.getElementById('inputEmail');
    const inputPassword = document.getElementById('inputPassword');
    const btnTogglePassword = document.getElementById('btnTogglePassword');
    const chkRememberAccount = document.getElementById('chkRememberAccount');
    const savedAccountsSection = document.getElementById('savedAccountsSection');
    const savedAccountsChips = document.getElementById('savedAccountsChips');

    // Confirm Accept Modal
    const confirmModal = document.getElementById('confirmModal');
    const btnCloseConfirmModal = document.getElementById('btnCloseConfirmModal');
    const btnCancelConfirm = document.getElementById('btnCancelConfirm');
    const btnExecuteConfirm = document.getElementById('btnExecuteConfirm');
    const confirmModalText = document.getElementById('confirmModalText');
    const toastContainer = document.getElementById('toastContainer');

    let confirmCallback = null;

    // --- Saved Accounts Management (localStorage) ---
    function getSavedAccounts() {
        try {
            return JSON.parse(localStorage.getItem('meesho_saved_accounts')) || [];
        } catch (e) {
            return [];
        }
    }

    function saveAccountToStorage(email, storeName) {
        if (!email) return;
        let list = getSavedAccounts();
        list = list.filter(acc => acc.email.toLowerCase() !== email.toLowerCase());
        list.unshift({ email: email, storeName: storeName || 'Seller Store', savedAt: new Date().toISOString() });
        if (list.length > 8) list.pop();
        localStorage.setItem('meesho_saved_accounts', JSON.stringify(list));
        renderSavedAccountsChips();
    }

    function removeSavedAccount(email, e) {
        if (e) e.stopPropagation();
        let list = getSavedAccounts();
        list = list.filter(acc => acc.email.toLowerCase() !== email.toLowerCase());
        localStorage.setItem('meesho_saved_accounts', JSON.stringify(list));
        renderSavedAccountsChips();
    }

    function renderSavedAccountsChips() {
        const list = getSavedAccounts();
        if (!savedAccountsChips || !savedAccountsSection) return;
        if (list.length === 0) {
            savedAccountsSection.classList.add('hide');
            savedAccountsChips.innerHTML = '';
            return;
        }

        savedAccountsSection.classList.remove('hide');
        savedAccountsChips.innerHTML = '';
        list.forEach(acc => {
            const chip = document.createElement('div');
            chip.className = 'saved-acc-chip';
            chip.innerHTML = `
                <span>🏪 <strong>${escapeHtml(acc.storeName)}</strong> (${escapeHtml(acc.email)})</span>
                <button type="button" class="btn-del-acc" title="Remove">&times;</button>
            `;
            chip.addEventListener('click', () => {
                inputEmail.value = acc.email;
                inputPassword.value = '';
                inputPassword.focus();
            });
            chip.querySelector('.btn-del-acc').addEventListener('click', (ev) => {
                removeSavedAccount(acc.email, ev);
            });
            savedAccountsChips.appendChild(chip);
        });
    }

    // --- Toast Notifications ---
    function showToast(message, type = 'info', durationMs = 4000) {
        if (!toastContainer) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
        toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, durationMs);
    }

    // --- UI State Gating ---
    function updateSessionUI(status) {
        isLoggedIn = Boolean(status.logged_in);

        if (isLoggedIn) {
            // Un-gate: Show dashboard body, hide gate hero
            loginGateSection.classList.add('hide');
            dashboardBody.classList.remove('hide');

            // Header state
            statusDot.className = 'status-dot connected';
            sessionStatusText.textContent = `${status.store_name || 'Meesho Store'} (Connected)`;
            accountStoreName.textContent = status.store_name || 'Meesho Store';
            accountStoreEmail.textContent = status.email || '';
            
            // Show logout & switch account, hide login button
            btnLogout.classList.remove('hide');
            btnSwitchAccount.classList.remove('hide');
            btnLoginNav.classList.add('hide');
        } else {
            // Gate: Show gate hero, hide dashboard body
            loginGateSection.classList.remove('hide');
            dashboardBody.classList.add('hide');

            // Header state
            statusDot.className = 'status-dot disconnected';
            sessionStatusText.textContent = 'Not Logged In';
            accountStoreName.textContent = 'Not Logged In';
            accountStoreEmail.textContent = 'Please log in to continue';

            // Hide logout & switch account, show login button
            btnLogout.classList.add('hide');
            btnSwitchAccount.classList.add('hide');
            btnLoginNav.classList.remove('hide');

            // Clear orders and UI
            orders = [];
            selectedOrderIds.clear();
            renderDateChips();
            renderOrdersTable();
            updateStats();
        }
    }

    // --- Check Session Status ---
    async function checkSessionStatus() {
        statusDot.className = 'status-dot checking';
        sessionStatusText.textContent = 'Checking session...';
        
        try {
            const res = await fetch('/api/check-session');
            const data = await res.json();
            updateSessionUI(data);
            if (data.logged_in) {
                fetchOrders(false);
                fetchCourierReturnOTPs(false);
            }
        } catch (err) {
            updateSessionUI({ logged_in: false });
        }
    }

    // --- Login Handlers ---
    function openLoginModal() {
        loginModalError.classList.add('hide');
        loginModalError.textContent = '';
        renderSavedAccountsChips();
        loginModal.classList.remove('hide');
        inputEmail.focus();
    }

    function closeLoginModal() {
        loginModal.classList.add('hide');
        loginSpinner.classList.add('hide');
        loginBtnText.textContent = '🚀 Login to Meesho';
        btnSubmitLogin.disabled = false;
    }

    async function handleLoginSubmit() {
        const email = inputEmail.value.trim();
        const pwd = inputPassword.value;

        if (!email || !pwd) {
            loginModalError.textContent = 'કૃપા કરીને Email/Mobile Number અને Password બંને ભરો.';
            loginModalError.classList.remove('hide');
            return;
        }

        loginModalError.classList.add('hide');
        loginSpinner.classList.remove('hide');
        loginBtnText.textContent = 'Connecting to Meesho...';
        btnSubmitLogin.disabled = true;

        addLogEntry('info', `Authenticating with Meesho for: ${email}...`);

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email_or_phone: email, password: pwd })
            });
            const data = await res.json();

            if (res.ok && data.logged_in) {
                // Save account to local storage
                if (chkRememberAccount && chkRememberAccount.checked) {
                    saveAccountToStorage(email, data.store_name);
                }

                closeLoginModal();
                showToast(`🎉 Logged in as ${data.store_name || email}! Syncing orders...`, 'success');
                addLogEntry('info', `Login successful! Connected as ${data.store_name} (${data.workspace_hash})`);

                // Update UI state immediately
                updateSessionUI(data);

                // Auto sync all orders and return OTPs immediately after login
                fetchOrders(true);
                fetchCourierReturnOTPs(true);
            } else {
                loginModalError.textContent = data.message || 'Login failed. Please check your credentials.';
                loginModalError.classList.remove('hide');
                addLogEntry('error', `Login failed: ${data.message || 'Authentication error'}`);
            }
        } catch (err) {
            loginModalError.textContent = `Network error: ${err.message}`;
            loginModalError.classList.remove('hide');
            addLogEntry('error', `Login request error: ${err.message}`);
        } finally {
            loginSpinner.classList.add('hide');
            loginBtnText.textContent = '🚀 Login to Meesho';
            btnSubmitLogin.disabled = false;
        }
    }

    // --- Logout Handler ---
    async function handleLogout() {
        showConfirmModal('શું તમે ખરેખર Meesho માંથી Logout કરવા માંગો છો?', async () => {
            addLogEntry('info', 'Logging out from Meesho Supplier Panel...');
            try {
                const res = await fetch('/api/logout', { method: 'POST' });
                const data = await res.json();
                updateSessionUI({ logged_in: false });
                showToast('🚪 Logged out successfully from Meesho.', 'info');
                addLogEntry('info', 'Logged out successfully. All cached session data cleared.');
            } catch (e) {
                addLogEntry('error', `Logout error: ${e.message}`);
            }
        });
    }

    // --- Orders Fetching & Sync ---
    async function fetchOrders(sync = false) {
        if (!isLoggedIn && !sync) return;

        if (sync) {
            syncSpinner.classList.remove('hide');
            syncBtnText.textContent = 'Syncing...';
            btnSyncOrders.disabled = true;
            addLogEntry('info', 'Syncing all pending orders from Meesho Supplier Panel...');
        }

        try {
            const res = await fetch(`/api/orders/pending?sync=${sync}`);
            const data = await res.json();
            if (data.orders) {
                orders = data.orders;
                renderDateChips();
                renderOrdersTable();
                updateStats();
                if (sync) {
                    showToast(`Synced ${orders.length} pending order(s) from Meesho!`, 'success');
                }
            }
        } catch (err) {
            addLogEntry('error', `Fetch orders error: ${err.message}`);
        } finally {
            if (sync) {
                setTimeout(() => {
                    syncSpinner.classList.add('hide');
                    syncBtnText.textContent = '🔄 Sync All Orders';
                    btnSyncOrders.disabled = false;
                }, 1000);
            }
        }
    }

    // --- Return Courier OTP Fetching ---
    async function fetchCourierReturnOTPs(manual = false) {
        if (!isLoggedIn && !manual) return;

        if (manual) {
            otpSpinner.classList.remove('hide');
            otpBtnText.textContent = 'Refreshing...';
            btnRefreshOtp.disabled = true;
            addLogEntry('info', 'Refreshing Courier Partner Return OTPs from Meesho...');
        }

        try {
            const url = manual ? '/api/returns/otp?sync=true' : '/api/returns/otp';
            const res = await fetch(url);
            const data = await res.json();
            
            if (data.last_updated) {
                otpLastUpdated.textContent = `Last checked: ${data.last_updated}`;
            }

            const otps = data.otps || [];
            if (otps.length === 0) {
                noOtpBanner.classList.remove('hide');
                otpCardsGrid.classList.add('hide');
                otpCardsGrid.innerHTML = '';
            } else {
                noOtpBanner.classList.add('hide');
                otpCardsGrid.classList.remove('hide');
                otpCardsGrid.innerHTML = '';

                otps.forEach((item, idx) => {
                    const card = document.createElement('div');
                    card.className = 'courier-card';
                    const iconHtml = item.icon ? `<img src="${escapeHtml(item.icon)}" class="courier-logo-img" alt="${escapeHtml(item.courier)}" onerror="this.style.display='none'" />` : '<span style="font-size: 20px;">🚚</span>';
                    
                    // Collapsible AWB Dropdown
                    let awbDropdownHtml = '';
                    if (item.awbs && item.awbs.length > 0) {
                        awbDropdownHtml = `
                            <div class="awb-dropdown-box">
                                <button type="button" class="btn-awb-dropdown" data-drawer="awb-drawer-${idx}">
                                    <span>📦 View AWB Numbers (${item.awbs.length})</span>
                                    <span class="awb-arrow">▼</span>
                                </button>
                                <div class="awb-drawer hide" id="awb-drawer-${idx}">
                                    ${item.awbs.map(a => `
                                        <div class="awb-item-row">
                                            <span class="awb-code">AWB: ${escapeHtml(a)}</span>
                                            <button type="button" class="btn-copy-mini" data-copy="${escapeHtml(a)}">📋 Copy</button>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `;
                    }

                    card.innerHTML = `
                        <div class="otp-card-header">
                            <div class="courier-info-left">
                                ${iconHtml}
                                <span style="font-weight: 700; color: #fff; font-size: 15px;">${escapeHtml(item.courier)}</span>
                            </div>
                            <span class="courier-badge">Active</span>
                        </div>
                        <div class="otp-box">
                            <span class="otp-number">${escapeHtml(item.otp)}</span>
                            <button class="btn-copy-otp" data-otp="${escapeHtml(item.otp)}">📋 Copy</button>
                        </div>
                        <div class="otp-packets">📦 ${escapeHtml(item.packets_count.toString())} Return Packet(s) • Valid ${escapeHtml(item.valid_till || 'Today')}</div>
                        ${awbDropdownHtml}
                    `;
                    
                    // Copy OTP button listener
                    const copyBtn = card.querySelector('.btn-copy-otp');
                    copyBtn.addEventListener('click', () => {
                        const otpVal = copyBtn.getAttribute('data-otp');
                        navigator.clipboard.writeText(otpVal).then(() => {
                            copyBtn.textContent = '✅ Copied!';
                            showToast(`Copied ${item.courier} OTP: ${otpVal}`, 'success', 2000);
                            setTimeout(() => copyBtn.textContent = '📋 Copy', 2000);
                        }).catch(() => {
                            copyBtn.textContent = '✅ ' + otpVal;
                        });
                    });

                    // Dropdown toggle listener
                    const awbToggleBtn = card.querySelector('.btn-awb-dropdown');
                    if (awbToggleBtn) {
                        const drawerId = awbToggleBtn.getAttribute('data-drawer');
                        const drawerEl = card.querySelector(`#${drawerId}`);
                        awbToggleBtn.addEventListener('click', (ev) => {
                            ev.stopPropagation();
                            const isHidden = drawerEl.classList.contains('hide');
                            if (isHidden) {
                                drawerEl.classList.remove('hide');
                                awbToggleBtn.classList.add('active');
                            } else {
                                drawerEl.classList.add('hide');
                                awbToggleBtn.classList.remove('active');
                            }
                        });
                    }

                    // AWB copy buttons
                    card.querySelectorAll('.btn-copy-mini').forEach(b => {
                        b.addEventListener('click', (ev) => {
                            ev.stopPropagation();
                            const code = b.getAttribute('data-copy');
                            navigator.clipboard.writeText(code).then(() => {
                                b.textContent = 'Copied!';
                                showToast(`Copied AWB: ${code}`, 'success', 2000);
                                setTimeout(() => b.textContent = '📋 Copy', 1500);
                            });
                        });
                    });

                    otpCardsGrid.appendChild(card);
                });
            }
        } catch (err) {
            console.error('Error fetching return OTPs:', err);
        } finally {
            if (manual) {
                setTimeout(() => {
                    otpSpinner.classList.add('hide');
                    otpBtnText.textContent = '🔄 Refresh Return OTP';
                    btnRefreshOtp.disabled = false;
                }, 1000);
            }
        }
    }

    // --- Order Acceptance & Removal ---
    async function executeAcceptOrders(orderIds, acceptAll) {
        const msg = acceptAll ? 'તમામ પેન્ડિંગ ઓર્ડર્સ એક્સેપ્ટ કરવા છે?' : `${orderIds.length} ઓર્ડર્સ Meesho માં એક્સેપ્ટ કરવા છે?`;
        showConfirmModal(msg, async () => {
            addLogEntry('info', acceptAll ? 'Accepting ALL pending orders on Meesho...' : `Accepting ${orderIds.length} order(s) on Meesho...`);
            showToast('Accepting orders on Meesho Supplier Panel...', 'info');

            try {
                const res = await fetch('/api/orders/accept', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        accept_all: acceptAll,
                        order_ids: orderIds
                    })
                });
                const data = await res.json();
                
                const acceptedCount = data.accepted_count || 0;
                
                if (data.status === 'success' && acceptedCount > 0) {
                    // Remove accepted orders from local list
                    if (acceptAll) {
                        orders = [];
                    } else if (orderIds && orderIds.length) {
                        const cleanIds = new Set(orderIds.map(id => id.split('_')[0]));
                        orders = orders.filter(o => !cleanIds.has(o.sub_order_id.split('_')[0]));
                    }

                    if (data.remaining_orders) {
                        orders = data.remaining_orders;
                    }

                    selectedOrderIds.clear();
                    renderDateChips();
                    renderOrdersTable();
                    
                    // Update stats
                    const currentAccepted = parseInt(statAcceptedCount.textContent) || 0;
                    statAcceptedCount.textContent = currentAccepted + acceptedCount;
                    updateStats();

                    showToast(`🎉 ${acceptedCount} order(s) successfully accepted on Meesho!`, 'success');
                    addLogEntry('info', `Successfully accepted ${acceptedCount} order(s) on Meesho. Panel updated.`);
                } else {
                    showToast(`❌ Meesho Error: ${data.message || 'Could not accept order on Meesho. Please check console logs.'}`, 'error');
                    addLogEntry('error', `Accept error on Meesho: ${data.message || 'Order was not accepted on Meesho'}`);
                    // Re-sync orders table to reflect accurate state from Meesho
                    fetchOrders(false);
                }
            } catch (err) {
                showToast(`Acceptance request error: ${err.message}`, 'error');
                addLogEntry('error', `Acceptance error: ${err.message}`);
                fetchOrders(false);
            }
        });
    }

    // --- Date Filtering & Chips (by Dispatch/SLA Date) ---
    function getUniqueDates() {
        const datesMap = {};
        orders.forEach(o => {
            const d = o.sla_date || 'No Date';
            datesMap[d] = (datesMap[d] || 0) + 1;
        });
        return datesMap;
    }

    function renderDateChips() {
        const datesMap = getUniqueDates();
        dateChipsContainer.innerHTML = '';

        // "All Dates" Chip
        const allChip = document.createElement('button');
        allChip.className = `chip ${selectedDateFilter === 'ALL' ? 'active' : ''}`;
        allChip.setAttribute('data-date', 'ALL');
        allChip.textContent = `All Dispatch Dates (${orders.length})`;
        allChip.addEventListener('click', () => {
            selectedDateFilter = 'ALL';
            renderDateChips();
            renderOrdersTable();
        });
        dateChipsContainer.appendChild(allChip);

        // Date Chips
        Object.keys(datesMap).sort().reverse().forEach(date => {
            const chip = document.createElement('button');
            chip.className = `chip ${selectedDateFilter === date ? 'active' : ''}`;
            chip.setAttribute('data-date', date);
            chip.textContent = `🚚 ${date} (${datesMap[date]})`;
            chip.addEventListener('click', () => {
                selectedDateFilter = date;
                renderDateChips();
                renderOrdersTable();
            });
            dateChipsContainer.appendChild(chip);
        });
    }

    function getFilteredOrders() {
        let filtered = orders;
        if (selectedDateFilter !== 'ALL') {
            filtered = filtered.filter(o => o.sla_date === selectedDateFilter);
        }
        const query = searchInput.value.toLowerCase().trim();
        if (query) {
            filtered = filtered.filter(o => {
                const subId = (o.sub_order_id || '').toLowerCase();
                const sku = (o.sku || '').toLowerCase();
                const title = (o.product_name || '').toLowerCase();
                const slaDate = (o.sla_date || '').toLowerCase();
                const orderDate = (o.order_date || '').toLowerCase();
                return subId.includes(query) || sku.includes(query) || title.includes(query) || slaDate.includes(query) || orderDate.includes(query);
            });
        }
        return filtered;
    }

    // --- Table Rendering with Date-wise Batch Headers ---
    function renderOrdersTable() {
        const filtered = getFilteredOrders();
        ordersTableBody.innerHTML = '';

        if (filtered.length === 0) {
            emptyState.classList.remove('hide');
            ordersTable.classList.add('hide');
            updateSelectionUI();
            return;
        }

        emptyState.classList.add('hide');
        ordersTable.classList.remove('hide');

        // Group by dispatch/SLA date
        const grouped = {};
        filtered.forEach(o => {
            const d = o.sla_date || 'No Date';
            if (!grouped[d]) grouped[d] = [];
            grouped[d].push(o);
        });

        Object.keys(grouped).sort().reverse().forEach(date => {
            const dateOrders = grouped[date];
            const dateOrderIds = dateOrders.map(o => o.sub_order_id);
            const allDateSelected = dateOrderIds.every(id => selectedOrderIds.has(id));

            // Date Group Header Row
            const groupRow = document.createElement('tr');
            groupRow.className = 'date-group-header-row';
            groupRow.innerHTML = `
                <td style="text-align: center;">
                    <input type="checkbox" class="date-group-checkbox" data-date="${escapeHtml(date)}" ${allDateSelected ? 'checked' : ''} title="Select all orders for ${escapeHtml(date)}" />
                </td>
                <td colspan="7" class="date-group-title">
                    <span>🚚 Dispatch by ${escapeHtml(date)} — <strong>${dateOrders.length}</strong> Pending Orders</span>
                </td>
                <td style="text-align: right;">
                    <button class="btn btn-xs btn-accept-date" data-date="${escapeHtml(date)}">
                        ⚡ Accept All for Dispatch ${escapeHtml(date)}
                    </button>
                </td>
            `;

            // Date checkbox listener
            const dateCheckbox = groupRow.querySelector('.date-group-checkbox');
            dateCheckbox.addEventListener('change', (e) => {
                const checked = e.target.checked;
                dateOrderIds.forEach(id => {
                    if (checked) selectedOrderIds.add(id);
                    else selectedOrderIds.delete(id);
                });
                renderOrdersTable();
                updateSelectionUI();
            });

            // Date accept button listener
            const dateAcceptBtn = groupRow.querySelector('.btn-accept-date');
            dateAcceptBtn.addEventListener('click', () => {
                executeAcceptOrders(dateOrderIds, false);
            });

            ordersTableBody.appendChild(groupRow);

            // Individual Order Rows
            dateOrders.forEach(order => {
                const isSelected = selectedOrderIds.has(order.sub_order_id);
                const tr = document.createElement('tr');
                tr.className = `order-row ${isSelected ? 'selected' : ''}`;
                tr.setAttribute('data-order-id', order.sub_order_id);

                const imgHtml = order.image_url ? `<img src="${escapeHtml(order.image_url)}" class="product-thumb" alt="Product" onerror="this.style.display='none'" />` : '<span class="thumb-placeholder">🛍️</span>';

                tr.innerHTML = `
                    <td style="text-align: center;">
                        <input type="checkbox" class="order-checkbox" data-order-id="${escapeHtml(order.sub_order_id)}" ${isSelected ? 'checked' : ''} />
                    </td>
                    <td class="order-id-cell font-mono">
                        <span class="badge-sub-order">${escapeHtml(order.sub_order_id)}</span>
                    </td>
                    <td class="sku-cell font-mono">
                        <span class="badge-sku">${escapeHtml(order.sku || 'N/A')}</span>
                    </td>
                    <td class="product-details-cell">
                        <div class="product-info-wrap">
                            ${imgHtml}
                            <span class="product-title" title="${escapeHtml(order.product_name)}">${escapeHtml(order.product_name || 'Meesho Product')}</span>
                        </div>
                    </td>
                    <td style="text-align: center; font-weight: 700;">${order.quantity || 1}</td>
                    <td class="sla-cell">
                        <span class="sla-badge">🚚 ${escapeHtml(order.sla_date || 'N/A')}</span>
                    </td>
                    <td style="opacity: 0.7; font-size: 0.85em;">${escapeHtml(order.order_date || 'N/A')}</td>
                    <td>
                        <span class="status-pill status-pending">${escapeHtml(order.status || 'PENDING')}</span>
                    </td>
                    <td style="text-align: right;">
                        <button class="btn btn-sm btn-accept-single" data-order-id="${escapeHtml(order.sub_order_id)}">
                            Accept
                        </button>
                    </td>
                `;

                // Row checkbox listener
                const rowChk = tr.querySelector('.order-checkbox');
                rowChk.addEventListener('change', (e) => {
                    const checked = e.target.checked;
                    if (checked) {
                        selectedOrderIds.add(order.sub_order_id);
                    } else {
                        selectedOrderIds.delete(order.sub_order_id);
                    }
                    updateSelectionUI();
                    // Update group checkbox without re-rendering everything
                    const allSelectedNow = dateOrderIds.every(id => selectedOrderIds.has(id));
                    dateCheckbox.checked = allSelectedNow;
                });

                // Single accept button listener
                const btnAccept = tr.querySelector('.btn-accept-single');
                btnAccept.addEventListener('click', () => {
                    executeAcceptOrders([order.sub_order_id], false);
                });

                ordersTableBody.appendChild(tr);
            });
        });

        updateSelectionUI();
    }

    function updateSelectionUI() {
        statSelectedCount.textContent = selectedOrderIds.size;
        selectedBadge.textContent = selectedOrderIds.size;
        btnAcceptSelected.disabled = selectedOrderIds.size === 0;

        const filtered = getFilteredOrders();
        const allVisibleSelected = filtered.length > 0 && filtered.every(o => selectedOrderIds.has(o.sub_order_id));
        selectAllCheckbox.checked = allVisibleSelected;
    }

    function updateStats() {
        statPendingCount.textContent = orders.length;
    }

    // --- Modal Confirmation Dialog ---
    function showConfirmModal(message, onConfirm) {
        confirmModalText.textContent = message;
        confirmCallback = onConfirm;
        confirmModal.classList.remove('hide');
    }

    function closeConfirmModal() {
        confirmModal.classList.add('hide');
        confirmCallback = null;
    }

    // --- Auto-Accept Scheduler ---
    async function handleAutoAcceptToggle() {
        const enabled = autoAcceptToggle.checked;
        const interval = parseInt(autoAcceptIntervalSelect.value) || 30;

        try {
            const res = await fetch('/api/auto-accept/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: enabled, interval_minutes: interval })
            });
            const data = await res.json();
            autoAcceptEnabled = enabled;
            autoAcceptInterval = interval;
            showToast(data.message, enabled ? 'success' : 'info');
            addLogEntry('info', data.message);
        } catch (e) {
            autoAcceptToggle.checked = !enabled;
            showToast(`Auto-accept toggle failed: ${e.message}`, 'error');
        }
    }

    function startCountdownTicker() {
        if (countdownTimer) clearInterval(countdownTimer);
        countdownTimer = setInterval(async () => {
            if (!autoAcceptEnabled) {
                autoAcceptCountdown.textContent = 'Inactive';
                return;
            }
            if (autoAcceptRemainingSeconds > 0) {
                autoAcceptRemainingSeconds--;
                const mins = Math.floor(autoAcceptRemainingSeconds / 60);
                const secs = autoAcceptRemainingSeconds % 60;
                autoAcceptCountdown.textContent = `Next in: ${mins}m ${secs}s`;
            } else {
                autoAcceptCountdown.textContent = 'Running check...';
            }
        }, 1000);
    }

    // --- Live Terminal Logs Polling ---
    function addLogEntry(level, msg) {
        const entry = document.createElement('div');
        entry.className = `log-entry ${level}`;
        const time = new Date().toLocaleTimeString();
        entry.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-msg">${escapeHtml(msg)}</span>`;
        terminalLogs.appendChild(entry);
        if (autoScroll) {
            terminalLogs.scrollTop = terminalLogs.scrollHeight;
        }
    }

    function startLogAndStatusPolling() {
        setInterval(async () => {
            try {
                // Poll Status
                const stRes = await fetch('/api/status');
                const st = await stRes.json();
                
                // If logged in state changed externally
                if (st.logged_in !== isLoggedIn) {
                    updateSessionUI(st);
                }

                if (st.auto_accept) {
                    autoAcceptEnabled = st.auto_accept.enabled;
                    autoAcceptToggle.checked = st.auto_accept.enabled;
                    autoAcceptRemainingSeconds = st.auto_accept.seconds_remaining || 0;
                    if (st.auto_accept.interval_minutes) {
                        autoAcceptIntervalSelect.value = st.auto_accept.interval_minutes.toString();
                    }
                }

                // Poll Logs
                const logRes = await fetch('/api/logs');
                const logData = await logRes.json();
                if (logData.logs && logData.logs.length > lastLogCount) {
                    const newLogs = logData.logs.slice(lastLogCount);
                    newLogs.forEach(l => {
                        const div = document.createElement('div');
                        div.className = `log-entry ${l.level || 'info'}`;
                        div.innerHTML = `<span class="log-time">[${l.timestamp}]</span> <span class="log-msg">${escapeHtml(l.message)}</span>`;
                        terminalLogs.appendChild(div);
                    });
                    lastLogCount = logData.logs.length;
                    if (autoScroll) {
                        terminalLogs.scrollTop = terminalLogs.scrollHeight;
                    }
                }
            } catch (err) {
                // Background polling silent fail
            }
        }, 4000);
    }

    // --- Helper Utilities ---
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // --- Wire All Event Listeners ---
    btnLoginNav.addEventListener('click', openLoginModal);
    btnGateLogin.addEventListener('click', openLoginModal);
    btnSwitchAccount.addEventListener('click', openLoginModal);
    btnLogout.addEventListener('click', handleLogout);

    btnCloseLoginModal.addEventListener('click', closeLoginModal);
    btnCancelModal.addEventListener('click', closeLoginModal);
    btnSubmitLogin.addEventListener('click', handleLoginSubmit);

    // Password show/hide toggle
    if (btnTogglePassword) {
        btnTogglePassword.addEventListener('click', () => {
            if (inputPassword.type === 'password') {
                inputPassword.type = 'text';
                btnTogglePassword.textContent = '🙈';
            } else {
                inputPassword.type = 'password';
                btnTogglePassword.textContent = '👁️';
            }
        });
    }

    // Confirm Modal Listeners
    btnCloseConfirmModal.addEventListener('click', closeConfirmModal);
    btnCancelConfirm.addEventListener('click', closeConfirmModal);
    btnExecuteConfirm.addEventListener('click', () => {
        if (confirmCallback) confirmCallback();
        closeConfirmModal();
    });

    // Toolbar & Order Actions
    btnCheckSession.addEventListener('click', checkSessionStatus);
    btnRefreshOtp.addEventListener('click', () => fetchCourierReturnOTPs(true));
    btnSyncOrders.addEventListener('click', () => fetchOrders(true));
    btnEmptySync.addEventListener('click', () => fetchOrders(true));

    searchInput.addEventListener('input', () => {
        renderDateChips();
        renderOrdersTable();
    });

    selectAllCheckbox.addEventListener('change', (e) => {
        const checked = e.target.checked;
        const visibleOrders = getFilteredOrders();
        if (checked) {
            visibleOrders.forEach(o => selectedOrderIds.add(o.sub_order_id));
        } else {
            selectedOrderIds.clear();
        }
        renderOrdersTable();
    });

    btnAcceptSelected.addEventListener('click', () => {
        if (selectedOrderIds.size === 0) return;
        executeAcceptOrders(Array.from(selectedOrderIds), false);
    });

    btnAcceptAll.addEventListener('click', () => {
        if (orders.length === 0) return;
        executeAcceptOrders(orders.map(o => o.sub_order_id), true);
    });

    // Auto-Accept Toggles
    autoAcceptToggle.addEventListener('change', handleAutoAcceptToggle);
    autoAcceptIntervalSelect.addEventListener('change', () => {
        if (autoAcceptToggle.checked) handleAutoAcceptToggle();
    });

    // Terminal clear & scroll
    autoScrollCheck.addEventListener('change', (e) => autoScroll = e.target.checked);
    btnClearLogs.addEventListener('click', () => {
        terminalLogs.innerHTML = '';
        lastLogCount = 0;
    });

    // Initialize application state
    renderSavedAccountsChips();
    checkSessionStatus();
    startLogAndStatusPolling();
    startCountdownTicker();
});
