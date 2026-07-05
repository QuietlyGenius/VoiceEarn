import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isMockMode = !supabaseUrl ||
  supabaseUrl.includes('your_') ||
  supabaseUrl === '' ||
  supabaseUrl.includes('placeholder');

let supabase;

if (isMockMode) {
  console.log('⚠️ Frontend running in Local Offline Mock Mode (no real Supabase / Google).');

  const authListeners = new Set();

  const makeSession = (rawEmail) => {
    const email = rawEmail.trim().toLowerCase();
    // Keep the seeded ids stable for the two well-known dev accounts.
    let id = email;
    if (email === 'test@example.com') id = '69e041d9-d19b-4f88-a926-9b0284e1fdb5';
    if (email === 'admin@example.com') id = 'admin-id-123';
    return { access_token: email, user: { id, email } };
  };

  const getSession = () => {
    const s = localStorage.getItem('mock_supabase_session');
    return s ? JSON.parse(s) : null;
  };

  const setSession = (session) => {
    if (session) localStorage.setItem('mock_supabase_session', JSON.stringify(session));
    else localStorage.removeItem('mock_supabase_session');
    authListeners.forEach((cb) => cb(session ? 'SIGNED_IN' : 'SIGNED_OUT', session));
  };

  supabase = {
    auth: {
      getSession: async () => ({ data: { session: getSession() }, error: null }),
      // Simulates Google OAuth locally. `options.mockEmail` lets dev tools pick
      // which "Google account" signs in; defaults to a fresh non-admin user so
      // the onboarding + approval-queue flow can be exercised.
      signInWithOAuth: async ({ options } = {}) => {
        const email = options?.mockEmail || 'newuser@gmail.com';
        setSession(makeSession(email));
        return { data: { provider: 'google', url: null }, error: null };
      },
      // Dev-only email sign-in (password ignored). Not shown in production UI.
      signInWithPassword: async ({ email }) => {
        const session = makeSession(email);
        setSession(session);
        return { data: { session, user: session.user }, error: null };
      },
      signOut: async () => { setSession(null); return { error: null }; },
      onAuthStateChange: (callback) => {
        authListeners.add(callback);
        callback('INITIAL_SESSION', getSession());
        return { data: { subscription: { unsubscribe: () => authListeners.delete(callback) } } };
      }
    }
  };
} else {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

// Kicks off Google OAuth. In production this redirects to Google via Supabase;
// in mock mode it signs in as a simulated Google user.
export async function signInWithGoogle(mockEmail) {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/dashboard`,
      ...(mockEmail ? { mockEmail } : {})
    }
  });
}

export default supabase;
