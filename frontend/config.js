// ============================================
// Application Configuration
// ============================================
// ⚠️ IMPORTANT: Update SUPABASE_URL and SUPABASE_ANON_KEY
// Get these from: Supabase Dashboard → Settings → API

window.APP_CONFIG = {
    // ===== Supabase Credentials =====
    // 🔧 UPDATE THESE WITH YOUR SUPABASE PROJECT DETAILS
    SUPABASE_URL: 'https://gsldbanldvmhxxonrinp.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzbGRiYW5sZHZtaHh4b25yaW5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNTA1NjIsImV4cCI6MjA5MjkyNjU2Mn0.vRQCDqIXHGFiDjUsVHPoDpVSJ2i_UeDryOlaxJEWGcc',
    
    // ===== App Settings =====
    APP_NAME: 'NSE Dashboard',
    VERSION: '3.0.0',
    
    // ===== Storage Keys =====
    USER_KEY: 'nse_user',
    
    // ===== Behavior =====
    REFRESH_INTERVAL: 30 * 60 * 1000,  // Auto-refresh data every 30 min
    DEBOUNCE_DELAY: 300,                // Chart update debounce
    TOAST_DURATION: 4000,               // Toast notification duration
    
    // ===== Feature Flags =====
    ENABLE_REALTIME: true,              // Real-time data updates
    ENABLE_ACTIVITY_LOG: true,          // Log user actions
    ENABLE_EMAIL_CONFIRMATION: false    // Set to true in production
};

// ===== Environment Detection =====
const isDevelopment = () => {
    const hostname = window.location.hostname;
    return hostname === 'localhost' || 
           hostname === '127.0.0.1' || 
           hostname.startsWith('192.');
};

window.APP_CONFIG.IS_DEVELOPMENT = isDevelopment();

// ===== Validation =====
if (window.APP_CONFIG.SUPABASE_URL.includes('YOUR_PROJECT_ID')) {
    console.error('⚠️ SUPABASE_URL not configured! Update frontend/config.js');
}

if (window.APP_CONFIG.SUPABASE_ANON_KEY === 'YOUR_ANON_KEY_HERE') {
    console.error('⚠️ SUPABASE_ANON_KEY not configured! Update frontend/config.js');
}

// ===== Logging =====
console.log(`[${window.APP_CONFIG.APP_NAME}] v${window.APP_CONFIG.VERSION}`);
console.log(`[Environment] ${isDevelopment() ? 'Development' : 'Production'}`);
console.log(`[Supabase] ${window.APP_CONFIG.SUPABASE_URL}`);