// ============================================
// Signup Module - Using Supabase Auth
// ============================================

(function() {
    'use strict';

    const elements = {
        form: document.getElementById('signupForm'),
        name: document.getElementById('name'),
        email: document.getElementById('email'),
        password: document.getElementById('password'),
        confirmPassword: document.getElementById('confirmPassword'),
        agreeTerms: document.getElementById('agreeTerms'),
        togglePasswords: document.querySelectorAll('.toggle-password'),
        toast: document.getElementById('toast'),
        submitBtn: document.querySelector('button[type="submit"]'),
        strengthBars: document.querySelectorAll('.strength-bar'),
        strengthText: document.querySelector('.strength-text')
    };

    // ===== Toast =====
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

    // ===== Button State =====
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
        },

        name(name) {
            return name && name.trim().length >= 2;
        },

        password(password) {
            return password && password.length >= 6;
        },

        passwordStrength(password) {
            let strength = 0;
            if (password.length >= 6) strength++;
            if (password.length >= 10) strength++;
            if (/[A-Z]/.test(password) && /[a-z]/.test(password)) strength++;
            if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) strength++;
            return Math.min(strength, 4);
        }
    };

    // ===== Password Strength =====
    function updatePasswordStrength(password) {
        const strength = validate.passwordStrength(password);
        const bars = elements.strengthBars;
        const text = elements.strengthText;

        bars.forEach(bar => {
            bar.classList.remove('active-weak', 'active-medium', 'active-strong');
        });
        text.classList.remove('weak', 'medium', 'strong');

        if (!password) {
            text.textContent = '';
            return;
        }

        let strengthClass, label;
        if (strength <= 1) {
            strengthClass = 'active-weak';
            text.className = 'strength-text weak';
            label = 'Weak password';
        } else if (strength <= 2) {
            strengthClass = 'active-medium';
            text.className = 'strength-text medium';
            label = 'Medium strength';
        } else {
            strengthClass = 'active-strong';
            text.className = 'strength-text strong';
            label = 'Strong password';
        }

        text.textContent = label;
        for (let i = 0; i < strength; i++) {
            bars[i]?.classList.add(strengthClass);
        }
    }

    // ===== Signup Handler =====
    async function handleSignup(event) {
        event.preventDefault();

        const name = elements.name?.value.trim();
        const email = elements.email?.value.trim();
        const password = elements.password?.value;
        const confirmPassword = elements.confirmPassword?.value;
        const agreeTerms = elements.agreeTerms?.checked;

        // Validation
        if (!name || !email || !password || !confirmPassword) {
            toast.show('Please fill in all fields', 'error');
            return;
        }

        if (!validate.name(name)) {
            toast.show('Name must be at least 2 characters', 'error');
            elements.name?.focus();
            return;
        }

        if (!validate.email(email)) {
            toast.show('Please enter a valid email address', 'error');
            elements.email?.focus();
            return;
        }

        if (!validate.password(password)) {
            toast.show('Password must be at least 6 characters', 'error');
            elements.password?.focus();
            return;
        }

        if (password !== confirmPassword) {
            toast.show('Passwords do not match', 'error');
            elements.confirmPassword?.focus();
            return;
        }

        if (!agreeTerms) {
            toast.show('Please accept the Terms and Privacy Policy', 'warning');
            return;
        }

        if (!window.supabaseClient) {
            toast.show('System not ready. Please refresh the page.', 'error');
            return;
        }

        buttonState.setLoading(elements.submitBtn, true);

        try {
            // ===== Supabase Auth Sign Up =====
            const username = name.toLowerCase().replace(/\s+/g, '_');
            
            const { data, error } = await window.supabaseClient.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        full_name: name,
                        username: username
                    }
                }
            });

            if (error) {
                throw error;
            }

            // Check if email confirmation is required
            if (data.user && !data.session) {
                // Email confirmation required
                toast.show(
                    '🎉 Account created! Please check your email to confirm.',
                    'success',
                    5000
                );
                
                setTimeout(() => {
                    window.location.href = '../login/login.html';
                }, 3000);
            } else {
                // Auto-logged in (no email confirmation)
                toast.show('Account created successfully! Redirecting...', 'success', 2500);
                
                setTimeout(() => {
                    window.location.href = '/dashboard/index.html';
                }, 1500);
            }

        } catch (error) {
            console.error('Signup error:', error);
            
            let message = 'Signup failed. Please try again.';
            
            if (error.message?.includes('already registered')) {
                message = 'This email is already registered. Try logging in instead.';
            } else if (error.message?.includes('password')) {
                message = error.message;
            } else if (error.message?.includes('email')) {
                message = 'Please enter a valid email address';
            } else if (error.message) {
                message = error.message;
            }
            
            toast.show(message, 'error');
            buttonState.setLoading(elements.submitBtn, false);
        }
    }

    // ===== Password Toggles =====
    function setupPasswordToggles() {
        elements.togglePasswords.forEach(btn => {
            btn.addEventListener('click', () => {
                const wrapper = btn.closest('.input-wrapper');
                const input = wrapper?.querySelector('input');
                if (!input) return;
                input.type = input.type === 'password' ? 'text' : 'password';
            });
        });
    }

    // ===== Realtime Validation =====
    function setupRealtimeValidation() {
        elements.password?.addEventListener('input', (e) => {
            updatePasswordStrength(e.target.value);
        });

        elements.confirmPassword?.addEventListener('input', () => {
            const password = elements.password?.value;
            const confirm = elements.confirmPassword?.value;

            if (confirm && password !== confirm) {
                elements.confirmPassword.setCustomValidity('Passwords do not match');
            } else {
                elements.confirmPassword.setCustomValidity('');
            }
        });
    }

    // ===== Check Auth State =====
    async function checkAuthState() {
        if (!window.supabaseClient) {
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
        checkAuthState();
        elements.form?.addEventListener('submit', handleSignup);
        setupPasswordToggles();
        setupRealtimeValidation();
        elements.name?.focus();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();