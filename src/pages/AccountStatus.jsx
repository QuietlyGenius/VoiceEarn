import { useAuth } from '../contexts/AuthContext';
import { Clock, XCircle, LogOut, Mic, RefreshCw } from 'lucide-react';

export default function AccountStatus({ status }) {
  const { profile, signOut, refreshProfile } = useAuth();
  const rejected = status === 'rejected';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center px-6 text-center">
      <div className="flex items-center space-x-2.5 mb-10">
        <div className="p-2 bg-gradient-to-tr from-indigo-500 to-violet-600 rounded-xl">
          <Mic className="w-5 h-5 text-white" />
        </div>
        <span className="font-extrabold text-lg tracking-tight text-white">VoiceEarn</span>
      </div>

      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ${rejected ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
        {rejected ? <XCircle className="w-8 h-8" /> : <Clock className="w-8 h-8" />}
      </div>

      {rejected ? (
        <>
          <h1 className="text-2xl font-black text-white mb-2">Application not approved</h1>
          <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
            Thank you for your interest, {profile?.first_name || 'there'}. Unfortunately your
            application wasn't approved at this time. If you believe this is a mistake, please
            contact our support team.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-black text-white mb-2">You're on the waitlist</h1>
          <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
            Thanks for applying, {profile?.first_name || 'there'}! Your application is in the review
            queue. We onboard new voice contributors as positions open up — you'll be notified by
            email the moment a spot is ready for you.
          </p>
          <button
            onClick={refreshProfile}
            className="mt-6 text-xs font-bold text-indigo-400 hover:text-indigo-300 flex items-center space-x-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Check status</span>
          </button>
        </>
      )}

      <button
        onClick={signOut}
        className="mt-10 py-2.5 px-5 bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold text-xs rounded-xl border border-slate-800 flex items-center space-x-2"
      >
        <LogOut className="w-4 h-4" />
        <span>Sign Out</span>
      </button>
    </div>
  );
}
