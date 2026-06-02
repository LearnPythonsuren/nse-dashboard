// ============================================
// Login Module - Using Supabase Auth
// ============================================

(function() {
    'use strict';

    const elements = {
        form: document.getElementById('loginForm'),
        email: document.getElementById('email'),
        password: document.getElementById('password'),
        rememberMe: document.getElementById('rememberMe'),
        togglePassword: document.querySelector('.toggle-password'),
        toast: document.getElementById('toast'),
        submitBtn: document.querySelector('button[type="submit"]')
    };

    // ===== Toast Notifications =====
    const toast = {
        show(message, type = 'info', duration = 4000) {
            const toastEl = elements.toast;
            if (!toastEl) return;

            const messageEl = toastEl.querySelector('.toast-message');
            messageEl.textContent = message;
            
            toastEl.className = `toast ${type}`;
            toastEl.classList.remove('hidden');

            setTimeout(() => toastEl.classList.add('hidden'), duration);
        }
    };

    // ===== Button Loading State =====
    const buttonState = {
        setLoading(btn, isLoading) {
            if (!btn) return;
            
            const text = btn.querySelector('.btn-text');
            const loader = btn.querySelector('.btn-loader');
            
            if (isLoading) {
                btn.disabled = true;
                text?.classList.add('hidden');
                loader?.classList.remove('hidden');
            } else {
                btn.disabled = false;
                text?.classList.remove('hidden');
                loader?.classList.add('hidden');
            }
        }
    };

    // ===== Validation =====
    const validate = {
        email(email) {
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        }
    };

    // ===== Login Handler =====
    async function handleLogin(event) {
        event.preventDefault();

        const email = elements.email?.value.trim();
        const password = elements.password?.value;

        // Validation
        if (!email || !password) {
            toast.show('Please fill in all fields', 'error');
            return;
        }

        if (!validate.email(email)) {
            toast.show('Please enter a valid email address', 'error');
            elements.email?.focus();
            return;
        }

        // Check Supabase is loaded
        if (!window.supabaseClient) {
            toast.show('System not ready. Please refresh the page.', 'error');
            return;
        }

        buttonState.setLoading(elements.submitBtn, true);

        try {
            // ===== Supabase Auth Sign In =====
            const { data, error } = await window.supabaseClient.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (error) {
                throw error;
            }

            // Log activity
            if (window.APP_CONFIG.ENABLE_ACTIVITY_LOG) {
                await window.supabaseHelpers?.logActivity('login', 'auth');
            }

            // Success
            toast.show('Welcome back! Redirecting...', 'success', 2000);
            
            setTimeout(() => {
                window.location.href = '/dashboard/index.html';
            }, 1000);

        } catch (error) {
            console.error('Login error:', error);
            
            // User-friendly error messages
            let message = 'Login failed. Please try again.';
            
            if (error.message?.includes('Invalid login credentials')) {
                message = 'Invalid email or password';
            } else if (error.message?.includes('Email not confirmed')) {
                message = 'Please confirm your email before logging in';
            } else if (error.message?.includes('rate limit')) {
                message = 'Too many attempts. Please try again later.';
            } else if (error.message) {
                message = error.message;
            }
            
            toast.show(message, 'error');
            buttonState.setLoading(elements.submitBtn, false);
        }
    }

    // ===== Password Visibility Toggle =====
    function togglePasswordVisibility() {
        const input = elements.password;
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
    }

    // ===== Check Auth State =====
    async function checkAuthState() {
        if (!window.supabaseClient) {
            // Wait for client to be ready
            setTimeout(checkAuthState, 100);
            return;
        }

        const isLoggedIn = await window.supabaseHelpers?.isLoggedIn();
        if (isLoggedIn) {
            window.location.href = '/dashboard/index.html';
        }
    }

    // ===== Initialize =====
    function init() {
        // Check if already logged in
        checkAuthState();

        // Attach event listeners
        elements.form?.addEventListener('submit', handleLogin);
        elements.togglePassword?.addEventListener('click', togglePasswordVisibility);
        elements.email?.focus();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();