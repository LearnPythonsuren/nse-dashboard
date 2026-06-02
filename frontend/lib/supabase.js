// ============================================
// Supabase Client Initialization
// ============================================
// This file initializes the Supabase client globally
// Used by all other JavaScript files in the app

(function() {
    'use strict';

    const CONFIG = window.APP_CONFIG;
    if (!CONFIG) {
        console.error('APP_CONFIG not loaded. Make sure config.js is loaded first.');
        return;
    }

    // Wait for Supabase library to load
    function initSupabase() {
        if (typeof supabase === 'undefined') {
            console.error('Supabase library not loaded');
            return null;
        }

        try {
            const client = supabase.createClient(
                CONFIG.SUPABASE_URL,
                CONFIG.SUPABASE_ANON_KEY,
                {
                    auth: {
                        autoRefreshToken: true,
                        persistSession: true,
                        detectSessionInUrl: true
                    },
                    realtime: {
                        params: {
                            eventsPerSecond: 10
                        }
                    }
                }
            );

            console.log('✅ Supabase client initialized');
            return client;
        } catch (error) {
            console.error('Failed to initialize Supabase:', error);
            return null;
        }
    }

    // Initialize and attach to window
    window.supabaseClient = initSupabase();

    // ============================================
    // Helper functions
    // ============================================
    window.supabaseHelpers = {
        // Get current user
        async getUser() {
            const { data: { user }, error } = await window.supabaseClient.auth.getUser();
            return user;
        },

        // Get current session
        async getSession() {
            const { data: { session }, error } = await window.supabaseClient.auth.getSession();
            return session;
        },

        // Get user profile
        async getProfile() {
            const user = await this.getUser();
            if (!user) return null;

            const { data, error } = await window.supabaseClient
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();

            if (error) {
                console.error('Profile fetch error:', error);
                return null;
            }

            return data;
        },

        // Check if user is logged in
        async isLoggedIn() {
            const session = await this.getSession();
            return session !== null;
        },

        // Sign out
        async signOut() {
            const { error } = await window.supabaseClient.auth.signOut();
            if (error) console.error('Sign out error:', error);
            return !error;
        },

        // Subscribe to realtime changes
        subscribeToTable(tableName, callback) {
            return window.supabaseClient
                .channel(`public:${tableName}`)
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: tableName },
                    callback
                )
                .subscribe();
        },

        // Log user activity (optional)
        async logActivity(action, resource, metadata = {}) {
            try {
                const user = await this.getUser();
                if (!user) return;

                await window.supabaseClient
                    .from('user_activity')
                    .insert({
                        user_id: user.id,
                        action,
                        resource,
                        metadata
                    });
            } catch (error) {
                console.warn('Activity logging failed:', error);
            }
        }
    };

    // ============================================
    // Auth state listener
    // ============================================
    if (window.supabaseClient) {
        window.supabaseClient.auth.onAuthStateChange((event, session) => {
            console.log(`[Auth Event] ${event}`);
            
            // Dispatch custom event for other parts of app to listen
            window.dispatchEvent(new CustomEvent('authStateChange', {
                detail: { event, session }
            }));
        });
    }

})();