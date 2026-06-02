// ============================================
// Auth Guard - Protects authenticated routes (Supabase)
// ============================================
// Include this on protected pages (e.g., dashboard)
// Must load AFTER config.js, supabase library, and lib/supabase.js

(function() {
    'use strict';

    async function checkAuthentication() {
        // Wait for Supabase client to be ready
        if (!window.supabaseClient || !window.supabaseHelpers) {
            setTimeout(checkAuthentication, 100);
            return;
        }

        try {
            const session = await window.supabaseHelpers.getSession();

            if (!session) {
                redirectToLogin();
                return;
            }

            // Session valid - check expiry (Supabase auto-refreshes, but double-check)
            const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
            if (expiresAt && Date.now() > expiresAt) {
                // Try to refresh
                const { data, error } = await window.supabaseClient.auth.refreshSession();
                if (error || !data.session) {
                    redirectToLogin();
                    return;
                }
            }

            // Authenticated - allow page to load
        } catch (error) {
            console.error('Auth check failed:', error);
            redirectToLogin();
        }
    }

    function redirectToLogin() {
        const path = window.location.pathname;
        if (path.includes('/login/') || path.includes('/signup/')) {
            return;
        }
        window.location.href = '/login/login.html';
    }

    // Run check
    checkAuthentication();

})();