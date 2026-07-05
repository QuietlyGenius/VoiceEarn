import { createContext, useContext, useState, useEffect } from 'react';
import supabase from '../lib/supabase';

const AuthContext = createContext({
  user: null,
  session: null,
  profile: null,
  needsOnboarding: false,
  onboardingEmail: '',
  loading: true,
  error: null,
  refreshProfile: () => {},
  signOut: () => {}
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [onboardingEmail, setOnboardingEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchProfile = async (currentUser, currentSession) => {
    if (!currentUser || !currentSession) {
      setProfile(null);
      setNeedsOnboarding(false);
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const res = await fetch('/api/profile', {
        headers: { Authorization: `Bearer ${currentSession.access_token}` }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load your profile');
      }

      const data = await res.json();
      if (data.needs_onboarding) {
        setProfile(null);
        setNeedsOnboarding(true);
        setOnboardingEmail(data.email || currentUser.email || '');
      } else {
        setProfile(data);
        setNeedsOnboarding(false);
      }
    } catch (err) {
      console.error('Error loading profile:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const refreshProfile = () => {
    if (user && session) fetchProfile(user, session);
  };

  const handleSignOut = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setNeedsOnboarding(false);
    setError(null);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession);
      const currentUser = initialSession?.user ?? null;
      setUser(currentUser);
      if (currentUser && initialSession) fetchProfile(currentUser, initialSession);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      const currentUser = currentSession?.user ?? null;
      setUser(currentUser);
      if (currentUser && currentSession) {
        fetchProfile(currentUser, currentSession);
      } else {
        setProfile(null);
        setNeedsOnboarding(false);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      needsOnboarding,
      onboardingEmail,
      loading,
      error,
      refreshProfile,
      signOut: handleSignOut
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
