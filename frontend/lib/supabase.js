// ============================================
// Supabase Client Initialization
// ============================================
(function() {
    'use strict';

    const CONFIG = window.APP_CONFIG;
    if (!CONFIG) {
        console.error('APP_CONFIG not loaded. Make sure config.js is loaded first.');
        return;
    }

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
                    realtime: { params: { eventsPerSecond: 10 } }
                }
            );
            console.log('✅ Supabase client initialized');
            return client;
        } catch (error) {
            console.error('Failed to initialize Supabase:', error);
            return null;
        }
    }

    window.supabaseClient = initSupabase();

    window.supabaseHelpers = {
        async getUser() {
            const { data: { user } } = await window.supabaseClient.auth.getUser();
            return user;
        },

        async getSession() {
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            return session;
        },

        // Hardened: never throws. Uses maybeSingle() and auto-creates a profile if missing.
        async getProfile() {
            try {
                const user = await this.getUser();
                if (!user) return null;

                // maybeSingle() returns null instead of throwing when no row exists
                const { data, error } = await window.supabaseClient
                    .from('profiles')
                    .select('*')
                    .eq('id', user.id)
                    .maybeSingle();

                if (error) {
                    console.warn('Profile fetch error:', error.message);
                    return null;
                }

                // Auto-create a profile if it doesn't exist yet
                if (!data) {
                    const newProfile = {
                        id: user.id,
                        email: user.email,
                        username: (user.email || 'user').split('@')[0],
                        full_name: user.user_metadata?.full_name || ''
                    };
                    const { data: created, error: insErr } = await window.supabaseClient
                        .from('profiles')
                        .insert(newProfile)
                        .select()
                        .maybeSingle();
                    if (insErr) {
                        console.warn('Profile create failed:', insErr.message);
                        return newProfile; // return in-memory fallback so UI still works
                    }
                    return created || newProfile;
                }

                return data;
            } catch (e) {
                console.warn('getProfile failed:', e);
                return null;
            }
        },

        async isLoggedIn() {
            const session = await this.getSession();
            return session !== null;
        },

        async signOut() {
            const { error } = await window.supabaseClient.auth.signOut();
            if (error) console.error('Sign out error:', error);
            return !error;
        },

        subscribeToTable(tableName, callback) {
            return window.supabaseClient
                .channel(`public:${tableName}`)
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: tableName },
                    callback)
                .subscribe();
        },

        async logActivity(action, resource, metadata = {}) {
            try {
                const user = await this.getUser();
                if (!user) return;
                await window.supabaseClient.from('user_activity').insert({
                    user_id: user.id, action, resource, metadata
                });
            } catch (e) {
                console.warn('Activity logging failed:', e);
            }
        }
    };

    if (window.supabaseClient) {
        window.supabaseClient.auth.onAuthStateChange((event, session) => {
            console.log(`[Auth Event] ${event}`);
            window.dispatchEvent(new CustomEvent('authStateChange', {
                detail: { event, session }
            }));
        });
    }
})();