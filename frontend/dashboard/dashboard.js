// ============================================
// Dashboard Module — Supabase, expiry-based chart lines
// Each expiry = its own line. Expiries populated from data.
// ============================================

(function () {
    'use strict';

    const CONFIG = window.APP_CONFIG;

    const state = {
        charts: { price: null, volume: null },
        user: null,
        profile: null,
        currentSymbol: null,
        expiries: [],          // distinct expiry dates for current symbol (FUT)
        selectedExpiries: new Set(),
        realtimeChannel: null
    };

    const elements = {
        tickerSelect: document.getElementById('tickerSelect'),
        futureDatesContainer: document.getElementById('futureDatesContainer'),
        cmCheckbox: document.getElementById('cmCheckbox'),
        planDisplay: document.getElementById('planDisplay'),
        licenseStatus: document.getElementById('licenseStatus'),
        activeCharts: document.getElementById('activeCharts'),
        lastUpdate: document.getElementById('lastUpdate'),
        userAvatar: document.getElementById('userAvatar'),
        userName: document.getElementById('userName'),
        userEmail: document.getElementById('userEmail'),
        logoutBtn: document.getElementById('logoutBtn'),
        refreshBtn: document.getElementById('refreshBtn'),
        sidebar: document.getElementById('sidebar'),
        mobileMenuBtn: document.getElementById('mobileMenuBtn'),
        loadingOverlay: document.getElementById('loadingOverlay'),
        toast: document.getElementById('toast'),
        connectionStatus: document.getElementById('connectionStatus'),
        priceChart: document.getElementById('priceChart'),
        volumeChart: document.getElementById('volumeChart'),
        priceChartEmpty: document.getElementById('priceChartEmpty'),
        volumeChartEmpty: document.getElementById('volumeChartEmpty')
    };

    // ---------- Utils ----------
    const utils = {
        debounce(fn, delay = CONFIG.DEBOUNCE_DELAY) {
            let t;
            return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), delay); };
        },
        showLoading(s = true) { elements.loadingOverlay?.classList.toggle('hidden', !s); },
        destroyChart(c) {
            if (c && typeof c.destroy === 'function') { try { c.destroy(); } catch (e) { } }
            return null;
        },
        formatVolume(v) {
            if (v >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`;
            if (v >= 1e5) return `${(v / 1e5).toFixed(2)}L`;
            if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
            return String(v);
        },
        colorFor(label) {
            let h = 0;
            for (let i = 0; i < label.length; i++) h = label.charCodeAt(i) + ((h << 5) - h);
            return `hsl(${Math.abs(h) % 360}, 65%, 50%)`;
        },
        expiryLabel(iso) {
            // "2026-06-26" -> "26 Jun 26"
            const d = new Date(iso);
            if (isNaN(d.getTime())) return iso;
            return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
        },
        formatTime() {
            return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        }
    };

    const toast = {
        show(msg, type = 'info', dur = 3500) {
            const t = elements.toast; if (!t) return;
            t.querySelector('.toast-message').textContent = msg;
            t.className = `toast ${type}`;
            t.classList.remove('hidden');
            setTimeout(() => t.classList.add('hidden'), dur);
        }
    };

    // ---------- Auth ----------
    const auth = {
        async loadUser() {
            const user = await window.supabaseHelpers.getUser();
            if (!user) { window.location.href = '/login/login.html'; return; }
            state.user = user;
            state.profile = await window.supabaseHelpers.getProfile();
            this.updateUI();
        },
        updateUI() {
            const u = state.user, p = state.profile;
            const name = p?.full_name || p?.username || u.email?.split('@')[0] || 'User';
            if (elements.userName) elements.userName.textContent = name;
            if (elements.userEmail) elements.userEmail.textContent = u.email || '';
            if (elements.userAvatar) elements.userAvatar.textContent = name.charAt(0).toUpperCase();
            if (p) {
                if (elements.planDisplay) elements.planDisplay.textContent = (p.plan || 'free').toUpperCase();
                if (elements.licenseStatus) {
                    const active = p.license_status === 'active' &&
                        new Date(p.license_expires_at) > new Date();
                    elements.licenseStatus.textContent = active ? 'Active' : 'Expired';
                    elements.licenseStatus.style.color = active ? 'var(--success)' : 'var(--danger)';
                }
            }
        },
        async logout() {
            await window.supabaseHelpers.signOut();
            window.location.href = '/login/login.html';
        }
    };

    // ---------- Tickers ----------
    const tickers = {
        async load() {
            if (!elements.tickerSelect) return;
            elements.tickerSelect.innerHTML = '<option value="">Loading...</option>';
            try {
                const { data, error } = await window.supabaseClient
                    .from('tickers')
                    .select('symbol, company_name')
                    .eq('is_active', true)
                    .order('symbol');
                if (error) throw error;

                elements.tickerSelect.innerHTML = '<option value="">-- Select Ticker --</option>';
                (data || []).forEach(({ symbol, company_name }) => {
                    const o = document.createElement('option');
                    o.value = symbol;
                    o.textContent = company_name ? `${symbol} — ${company_name}` : symbol;
                    elements.tickerSelect.appendChild(o);
                });
                if (data && data.length) elements.tickerSelect.selectedIndex = 1;
            } catch (e) {
                console.error('Ticker load failed:', e);
                elements.tickerSelect.innerHTML = '<option value="">Error loading</option>';
                toast.show('Failed to load tickers', 'error');
            }
        }
    };

    // ---------- Expiries (per selected symbol) ----------
    const expiries = {
        async loadForSymbol(symbol) {
            const container = elements.futureDatesContainer;
            const group = container?.querySelector('.checkbox-group');
            if (!group) return;

            group.innerHTML = '<span class="text-muted">Loading expiries...</span>';

            try {
                // Get distinct expiry dates for this symbol's FUT rows
                const { data, error } = await window.supabaseClient
                    .from('price_data')
                    .select('expiry_date')
                    .eq('symbol', symbol)
                    .eq('instrument_type', 'FUT')
                    .neq('expiry_date', '1900-01-01')
                    .order('expiry_date', { ascending: true });

                if (error) throw error;

                // Unique expiries
                const uniq = [...new Set((data || []).map(r => r.expiry_date))].sort();
                state.expiries = uniq;
                state.selectedExpiries = new Set(uniq); // all selected by default

                group.innerHTML = '';

                if (uniq.length === 0) {
                    group.innerHTML = '<span class="text-muted">No futures expiries</span>';
                    return;
                }

                uniq.forEach(exp => {
                    const label = document.createElement('label');
                    label.className = 'checkbox-label';

                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.value = exp;
                    cb.checked = true;
                    cb.addEventListener('change', () => {
                        if (cb.checked) state.selectedExpiries.add(exp);
                        else state.selectedExpiries.delete(exp);
                        charts.loadDebounced();
                    });

                    const span = document.createElement('span');
                    span.textContent = utils.expiryLabel(exp);

                    label.appendChild(cb);
                    label.appendChild(span);
                    group.appendChild(label);
                });
            } catch (e) {
                console.error('Expiry load failed:', e);
                group.innerHTML = '<span class="text-muted">No expiries available</span>';
            }
        }
    };

    // ---------- Charts ----------
    const charts = {
        async load() {
            const symbol = elements.tickerSelect?.value;
            if (!symbol) { this.showEmpty(); return; }

            const selected = Array.from(state.selectedExpiries);
            if (selected.length === 0) { this.showEmpty(); return; }

            const includeCM = elements.cmCheckbox?.checked || false;
            utils.showLoading(true);

            try {
                // Fetch all FUT rows for symbol + selected expiries
                const { data: futData, error } = await window.supabaseClient
                    .from('price_data')
                    .select('trade_date, close_price, volume, turnover, expiry_date')
                    .eq('symbol', symbol)
                    .eq('instrument_type', 'FUT')
                    .in('expiry_date', selected)
                    .order('trade_date', { ascending: true });

                if (error) throw error;

                let cmRows = [];
                if (includeCM) {
                    const { data: secData } = await window.supabaseClient
                        .from('sec_data')
                        .select('trade_date, close_price, total_traded_qty')
                        .eq('symbol', symbol)
                        .order('trade_date', { ascending: true });
                    cmRows = secData || [];
                }

                this.render(futData || [], cmRows);
                if (elements.lastUpdate) elements.lastUpdate.textContent = utils.formatTime();
            } catch (e) {
                console.error('Chart load failed:', e);
                toast.show('Failed to load chart data', 'error');
                this.clear();
            } finally {
                utils.showLoading(false);
            }
        },

        render(futRows, cmRows) {
            if ((!futRows || !futRows.length) && (!cmRows || !cmRows.length)) {
                this.showEmpty();
                return;
            }

            // Group FUT rows by expiry → one dataset per expiry
            const byExpiry = {};
            futRows.forEach(r => {
                (byExpiry[r.expiry_date] ||= []).push(r);
            });

            const priceDatasets = [];
            const volumeDatasets = [];
            const allDates = [];
            const allPrices = [];

            Object.keys(byExpiry).sort().forEach(exp => {
                const rows = byExpiry[exp];
                const label = `FUT ${utils.expiryLabel(exp)}`;
                const color = utils.colorFor(exp);

                const price = rows
                    .filter(r => r.close_price != null)
                    .map(r => ({ x: new Date(r.trade_date), y: Number(r.close_price) }));

                if (price.length) {
                    priceDatasets.push({
                        label, data: price, borderColor: color,
                        backgroundColor: 'transparent', borderWidth: 2,
                        tension: 0.3, pointRadius: 1, pointHoverRadius: 4
                    });
                    price.forEach(p => { allDates.push(p.x); allPrices.push(p.y); });
                }

                const vol = rows
                    .filter(r => r.volume != null)
                    .map(r => ({ x: new Date(r.trade_date), y: Number(r.volume) }));
                if (vol.length) {
                    volumeDatasets.push({
                        label: `${label} Vol`, data: vol, borderColor: color,
                        backgroundColor: `${color}33`, borderWidth: 2,
                        tension: 0.3, yAxisID: 'yFut', pointRadius: 0, fill: true
                    });
                }
            });

            // CM overlay (cash market close)
            if (cmRows && cmRows.length) {
                const color = '#ea4335';
                const price = cmRows
                    .filter(r => r.close_price != null)
                    .map(r => ({ x: new Date(r.trade_date), y: Number(r.close_price) }));
                if (price.length) {
                    priceDatasets.push({
                        label: 'CM (Cash)', data: price, borderColor: color,
                        backgroundColor: 'transparent', borderWidth: 2, borderDash: [5, 4],
                        tension: 0.3, pointRadius: 1
                    });
                    price.forEach(p => { allDates.push(p.x); allPrices.push(p.y); });
                }
                const vol = cmRows
                    .filter(r => r.total_traded_qty != null)
                    .map(r => ({ x: new Date(r.trade_date), y: Number(r.total_traded_qty) }));
                if (vol.length) {
                    volumeDatasets.push({
                        label: 'CM Vol', data: vol, borderColor: color,
                        backgroundColor: `${color}33`, borderWidth: 2,
                        tension: 0.3, yAxisID: 'yCm', pointRadius: 0, fill: true
                    });
                }
            }

            if (!priceDatasets.length) { this.showEmpty(); return; }

            const minDate = new Date(Math.min(...allDates));
            const maxDate = new Date(Math.max(...allDates));
            const yMin = Math.min(...allPrices) * 0.98;
            const yMax = Math.max(...allPrices) * 1.02;

            this.renderPrice(priceDatasets, minDate, maxDate, yMin, yMax);
            this.renderVolume(volumeDatasets, minDate, maxDate);

            if (elements.activeCharts) elements.activeCharts.textContent = priceDatasets.length;
            this.hideEmpty();
        },

        renderPrice(datasets, minDate, maxDate, yMin, yMax) {
            state.charts.price = utils.destroyChart(state.charts.price);
            if (!elements.priceChart) return;
            state.charts.price = new Chart(elements.priceChart, {
                type: 'line',
                data: { datasets },
                options: this.opts({
                    x: { type: 'time', min: minDate, max: maxDate, grid: { display: false } },
                    y: { min: yMin, max: yMax, title: { display: true, text: 'Price (₹)' } }
                })
            });
        },

        renderVolume(datasets, minDate, maxDate) {
            state.charts.volume = utils.destroyChart(state.charts.volume);
            if (!elements.volumeChart || !datasets.length) return;
            state.charts.volume = new Chart(elements.volumeChart, {
                type: 'line',
                data: { datasets },
                options: this.opts({
                    x: { type: 'time', min: minDate, max: maxDate, grid: { display: false } },
                    yFut: {
                        type: 'linear', position: 'left',
                        title: { display: true, text: 'FUT Volume' },
                        ticks: { callback: utils.formatVolume }
                    },
                    yCm: {
                        type: 'linear', position: 'right',
                        title: { display: true, text: 'CM Volume' },
                        grid: { drawOnChartArea: false },
                        ticks: { callback: utils.formatVolume }
                    }
                })
            });
        },

        opts(scales) {
            return {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales,
                plugins: {
                    legend: { display: true, position: 'top' },
                    tooltip: { backgroundColor: 'rgba(15,23,42,0.95)', padding: 12, cornerRadius: 8 },
                    zoom: {
                        zoom: { wheel: { enabled: true }, mode: 'x' },
                        pan: { enabled: true, mode: 'x' }
                    }
                }
            };
        },

        showEmpty() {
            this.clear();
            elements.priceChartEmpty?.classList.remove('hidden');
            elements.volumeChartEmpty?.classList.remove('hidden');
            if (elements.activeCharts) elements.activeCharts.textContent = '0';
        },
        hideEmpty() {
            elements.priceChartEmpty?.classList.add('hidden');
            elements.volumeChartEmpty?.classList.add('hidden');
        },
        clear() {
            state.charts.price = utils.destroyChart(state.charts.price);
            state.charts.volume = utils.destroyChart(state.charts.volume);
        }
    };
    charts.loadDebounced = utils.debounce(() => charts.load());

    // ---------- When ticker changes: reload expiries then chart ----------
    async function onTickerChange() {
        const symbol = elements.tickerSelect?.value;
        if (!symbol) { charts.showEmpty(); return; }
        state.currentSymbol = symbol;
        await expiries.loadForSymbol(symbol);
        await charts.load();
    }

    // ---------- Realtime ----------
    const realtime = {
        init() {
            if (!CONFIG.ENABLE_REALTIME) return;
            try {
                state.realtimeChannel = window.supabaseClient
                    .channel('public:price_data')
                    .on('postgres_changes',
                        { event: 'INSERT', schema: 'public', table: 'price_data' },
                        (payload) => {
                            if (payload.new?.symbol === state.currentSymbol) {
                                toast.show('New data — refreshing...', 'info', 1500);
                                onTickerChange();
                            }
                        })
                    .subscribe((s) => this.status(s === 'SUBSCRIBED'));
            } catch (e) { this.status(false); }
        },
        status(ok) {
            if (!elements.connectionStatus) return;
            elements.connectionStatus.classList.toggle('disconnected', !ok);
            const t = elements.connectionStatus.querySelector('span:last-child');
            if (t) t.textContent = ok ? 'Connected' : 'Disconnected';
        }
    };

    // ---------- Events ----------
    function attach() {
        elements.tickerSelect?.addEventListener('change', onTickerChange);
        elements.cmCheckbox?.addEventListener('change', charts.loadDebounced);
        elements.refreshBtn?.addEventListener('click', () => { onTickerChange(); toast.show('Refreshing...', 'info', 1200); });
        elements.logoutBtn?.addEventListener('click', () => {
            if (confirm('Logout?')) auth.logout();
        });
        elements.mobileMenuBtn?.addEventListener('click', () => elements.sidebar?.classList.toggle('open'));
        window.addEventListener('authStateChange', (e) => {
            if (e.detail.event === 'SIGNED_OUT' || !e.detail.session) {
                window.location.href = '/login/login.html';
            }
        });
    }

    // ---------- Init ----------
    async function init() {
        if (!window.supabaseClient) { setTimeout(init, 100); return; }
        try {
            utils.showLoading(true);
            await auth.loadUser();
            await tickers.load();
            attach();
            realtime.init();
            // Load expiries + chart for the auto-selected ticker
            if (elements.tickerSelect?.value) {
                await onTickerChange();
            } else {
                charts.showEmpty();
            }
            setInterval(() => { if (state.currentSymbol) charts.load(); }, CONFIG.REFRESH_INTERVAL);
        } catch (e) {
            console.error('Init failed:', e);
            toast.show('Failed to initialize dashboard', 'error');
        } finally {
            utils.showLoading(false);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();