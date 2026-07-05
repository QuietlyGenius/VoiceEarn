import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { isAdminEmail } from '../lib/adminEmails';
import Onboarding from '../pages/Onboarding';
import AccountStatus from '../pages/AccountStatus';

function FullScreenSpinner({ label }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950">
      <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      <p className="mt-4 text-slate-400 font-medium">{label || 'Loading…'}</p>
    </div>
  );
}

export default function ProtectedRoute({ children, requireAdmin = false }) {
  const { user, profile, needsOnboarding, loading, error } = useAuth();

  if (loading) return <FullScreenSpinner />;

  if (error) return <Navigate to="/login" replace state={{ error }} />;

  if (!user) return <Navigate to="/login" replace />;

  // Signed in with Google but hasn't completed the registration form yet.
  if (needsOnboarding) return <Onboarding />;

  // Profile still loading (transient between auth and profile fetch).
  if (!profile) return <FullScreenSpinner />;

  // Admins bypass status gating entirely.
  const admin = isAdminEmail(profile.email);

  if (!admin && profile.status === 'pending') return <AccountStatus status="pending" />;
  if (!admin && profile.status === 'rejected') return <AccountStatus status="rejected" />;

  if (requireAdmin && !admin) return <Navigate to="/dashboard" replace />;

  return children;
}
