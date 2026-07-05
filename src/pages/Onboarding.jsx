import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Mic, UserPlus, LogOut, AlertCircle } from 'lucide-react';

const QUALIFICATIONS = [
  'High School',
  'Diploma',
  "Bachelor's Degree",
  "Master's Degree",
  'Doctorate / PhD',
  'Other'
];

const PROFICIENCY = ['Basic', 'Conversational', 'Fluent', 'Native / Bilingual'];

const COUNTRIES = [
  'India', 'United States', 'United Kingdom', 'Canada', 'Australia', 'Nigeria',
  'Kenya', 'South Africa', 'Ghana', 'Philippines', 'Pakistan', 'Bangladesh',
  'Sri Lanka', 'Nepal', 'Singapore', 'Malaysia', 'Indonesia', 'Germany',
  'France', 'Spain', 'Italy', 'Netherlands', 'Ireland', 'New Zealand',
  'United Arab Emirates', 'Saudi Arabia', 'Egypt', 'Brazil', 'Mexico', 'Other'
];

export default function Onboarding() {
  const { session, onboardingEmail, refreshProfile, signOut } = useAuth();
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    highest_qualification: '',
    english_proficiency: '',
    country: ''
  });
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const required = ['first_name', 'last_name', 'highest_qualification', 'english_proficiency', 'country'];
    if (required.some((f) => !form[f].trim())) {
      setError('Please complete all fields.');
      return;
    }
    if (!agreed) {
      setError('Please accept the Terms & Conditions to continue.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ ...form, terms_accepted: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not complete registration');
      refreshProfile();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const inputClass = 'w-full px-3.5 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors';
  const labelClass = 'block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center px-5 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-gradient-to-tr from-indigo-500 to-violet-600 rounded-xl">
              <Mic className="w-5 h-5 text-white" />
            </div>
            <span className="font-extrabold text-lg tracking-tight text-white">VoiceEarn</span>
          </div>
          <button onClick={signOut} className="text-[10px] uppercase font-black tracking-wider px-2.5 py-1.5 bg-slate-900 text-slate-400 rounded-lg hover:bg-slate-800 flex items-center space-x-1">
            <LogOut className="w-3 h-3" />
            <span>Sign Out</span>
          </button>
        </div>

        <div className="flex items-center space-x-2.5 mb-1">
          <UserPlus className="w-5 h-5 text-indigo-400" />
          <h1 className="text-2xl font-black text-white">Complete your profile</h1>
        </div>
        <p className="text-sm text-slate-400 mb-6">
          A few details so our team can review your application. This takes under a minute.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-xs text-red-300 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>Email (from Google)</label>
            <input type="email" value={onboardingEmail} disabled className={`${inputClass} opacity-60 cursor-not-allowed`} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>First Name</label>
              <input type="text" value={form.first_name} onChange={update('first_name')} placeholder="Jane" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Last Name</label>
              <input type="text" value={form.last_name} onChange={update('last_name')} placeholder="Doe" className={inputClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Highest Qualification</label>
            <select value={form.highest_qualification} onChange={update('highest_qualification')} className={inputClass}>
              <option value="">Select…</option>
              {QUALIFICATIONS.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          </div>

          <div>
            <label className={labelClass}>English Proficiency</label>
            <select value={form.english_proficiency} onChange={update('english_proficiency')} className={inputClass}>
              <option value="">Select…</option>
              {PROFICIENCY.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div>
            <label className={labelClass}>Country</label>
            <select value={form.country} onChange={update('country')} className={inputClass}>
              <option value="">Select…</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Terms & Conditions */}
          <div className="pt-1">
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5 text-[11px] text-slate-400 leading-relaxed max-h-32 overflow-y-auto">
              <p className="font-black text-slate-300 uppercase tracking-wider text-[10px] mb-1.5">Terms &amp; Conditions</p>
              By joining VoiceEarn you agree that the voice recordings you submit may be <strong className="text-slate-300">used, reproduced, distributed, published and sold</strong> by the platform for any purpose, including <strong className="text-slate-300">training and evaluating AI and machine-learning models</strong>. All submitted recordings and derived data become the <strong className="text-slate-300">intellectual property of VoiceEarn</strong>. You confirm the voice is your own, that you are permitted to grant these rights, and that payment is made only for recordings accepted after review.
            </div>
            <label className="flex items-start space-x-2.5 mt-3 cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 w-4 h-4 accent-indigo-500 shrink-0" />
              <span className="text-xs text-slate-300">I have read and accept the Terms &amp; Conditions above.</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-black uppercase tracking-wider text-xs rounded-xl flex items-center justify-center space-x-2"
          >
            {submitting ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <span>Submit Application</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
