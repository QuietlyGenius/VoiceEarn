import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import supabase, { signInWithGoogle, isMockMode } from '../lib/supabase';
import {
  Mic, BookOpen, Wallet, ArrowRight, Sparkles, ShieldCheck,
  Menu, X, Plus, Minus, MessageSquare, Award, Gift
} from 'lucide-react';

export default function Login() {
  const { user, error: authError } = useAuth();
  const [formError, setFormError] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState({});
  const [devEmail, setDevEmail] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [bonus, setBonus] = useState(0);
  const [inrRate, setInrRate] = useState(83.5);
  const navigate = useNavigate();
  const location = useLocation();
  const redirectError = location.state?.error;

  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user, navigate]);

  // Public settings + FX so the landing page can advertise the signup bonus.
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : []))
      .then((s) => {
        const b = parseFloat(s.find((x) => x.key === 'signup_bonus_usd')?.value || 0);
        if (!isNaN(b)) setBonus(b);
      })
      .catch(() => {});
    fetch('/api/exchange-rate')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.rate) setInrRate(d.rate); })
      .catch(() => {});
  }, []);

  const handleGoogle = async () => {
    setFormError('');
    setSigningIn(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) throw error;
      // In production this redirects to Google; in mock mode the auth state
      // change fires and the effect above navigates onward.
    } catch (err) {
      setFormError(err.message || 'Google sign-in failed. Please try again.');
      setSigningIn(false);
    }
  };

  const handleDevSignIn = async (e) => {
    e.preventDefault();
    if (!devEmail.trim()) return;
    await supabase.auth.signInWithPassword({ email: devEmail.trim(), password: 'dev' });
  };

  const toggleFaq = (i) => setFaqOpen((p) => ({ ...p, [i]: !p[i] }));

  const faqs = [
    {
      q: 'How do I join?',
      a: 'Sign in with your Google account and complete a short profile. Depending on current openings, you may get instant access or join a short waitlist. We notify you by email as soon as your spot is ready.'
    },
    {
      q: 'What is the work?',
      a: 'You read published books aloud, one page at a time, and record clear audio. These recordings help train and evaluate speech AI. Sessions are short (up to 10 minutes) so you can work whenever suits you.'
    },
    {
      q: 'How much can I earn?',
      a: 'You earn a set rate for every approved page you narrate. Your balance is shown live in both USD and INR, and you can request a payout to your Polygon (USDC) wallet once you reach the minimum threshold.'
    },
    {
      q: 'What do I need?',
      a: 'A quiet space, a phone or computer with a microphone (earphones with a mic give the best quality), and clear spoken English. That is all.'
    }
  ];

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-indigo-500 selection:text-white overflow-x-hidden scroll-smooth">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-fuchsia-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <nav className="sticky top-0 z-50 bg-slate-950/60 backdrop-blur-2xl border-b border-slate-900/80 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-gradient-to-tr from-indigo-500 to-violet-600 rounded-xl shadow-lg shadow-indigo-500/20 flex items-center justify-center">
            <Mic className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-black text-xl tracking-tight text-white">VoiceEarn</span>
            <span className="text-[9px] font-black uppercase text-indigo-400 tracking-widest block -mt-1 font-mono">Narrate & Earn</span>
          </div>
        </div>

        <div className="hidden md:flex items-center space-x-8">
          <a href="#how-it-works" className="text-sm font-semibold text-slate-400 hover:text-white transition-colors">How It Works</a>
          <a href="#faq" className="text-sm font-semibold text-slate-400 hover:text-white transition-colors">FAQ</a>
          <a href="#auth-portal" className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all">Get Started</a>
        </div>

        <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="md:hidden p-2 text-slate-400 hover:text-white">
          {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </nav>

      {isMenuOpen && (
        <div className="md:hidden fixed top-[73px] left-0 w-full bg-slate-950/95 backdrop-blur-2xl border-b border-slate-900 z-40 p-6 space-y-4">
          <a href="#how-it-works" onClick={() => setIsMenuOpen(false)} className="block text-base font-semibold text-slate-300">How It Works</a>
          <a href="#faq" onClick={() => setIsMenuOpen(false)} className="block text-base font-semibold text-slate-300">FAQ</a>
          <a href="#auth-portal" onClick={() => setIsMenuOpen(false)} className="w-full text-center block py-3 bg-indigo-600 text-white font-bold rounded-xl">Get Started</a>
        </div>
      )}

      {/* Hero */}
      <section className="relative pt-20 pb-16 px-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-7 space-y-6 text-center lg:text-left">
          <div className="inline-flex items-center space-x-2 px-4 py-2 bg-indigo-950/40 border border-indigo-500/20 rounded-full">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-black text-indigo-300 uppercase tracking-widest font-mono">Flexible Voice Work</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-[1.05] text-white">
            Read books aloud.<br />
            Record your voice.<br />
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">Get paid per page.</span>
          </h1>

          <p className="text-lg text-slate-400 max-w-xl mx-auto lg:mx-0 font-medium">
            Join a professional pool of voice contributors. Narrate published books in short sessions
            from your phone or computer, and earn for every approved page — paid straight to your wallet.
          </p>

          <div className="grid grid-cols-3 gap-6 pt-6 border-t border-slate-900 max-w-md mx-auto lg:mx-0">
            <div>
              <span className="block text-2xl font-black text-white">Any device</span>
              <span className="text-[10px] text-slate-500 uppercase font-black tracking-wider">Phone or laptop</span>
            </div>
            <div>
              <span className="block text-2xl font-black text-indigo-400">Per page</span>
              <span className="text-[10px] text-slate-500 uppercase font-black tracking-wider">Clear payout</span>
            </div>
            <div>
              <span className="block text-2xl font-black text-emerald-400">USDC</span>
              <span className="text-[10px] text-slate-500 uppercase font-black tracking-wider">Polygon payouts</span>
            </div>
          </div>
        </div>

        {/* Auth card */}
        <div id="auth-portal" className="lg:col-span-5 w-full max-w-md mx-auto">
          <div className="bg-slate-900/30 border border-slate-800/80 backdrop-blur-2xl py-8 px-6 sm:px-10 shadow-2xl rounded-3xl relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl" />

            <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-indigo-500/10 rounded-2xl text-indigo-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-black text-white text-center mb-1">Get started</h2>
            <p className="text-sm text-slate-500 text-center mb-6 font-medium">
              Sign in securely with Google to apply or continue.
            </p>

            {bonus > 0 && (
              <div className="mb-5 p-4 bg-emerald-950/20 border border-emerald-500/20 rounded-2xl flex items-start space-x-3">
                <Gift className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-black text-emerald-400 uppercase tracking-wider">Welcome bonus</h4>
                  <p className="text-[12px] text-slate-300 mt-1 leading-relaxed">
                    New contributors get a <strong className="text-emerald-400">${bonus.toFixed(2)} (≈ ₹{Math.round(bonus * inrRate).toLocaleString('en-IN')})</strong> bonus once their application is approved.
                  </p>
                </div>
              </div>
            )}

            {(formError || redirectError || authError) && (
              <div className="mb-4 p-4 bg-red-950/20 border border-red-500/20 rounded-2xl flex items-start space-x-2 text-xs text-red-400">
                <X className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{formError || redirectError || authError}</span>
              </div>
            )}

            <button
              onClick={handleGoogle}
              disabled={signingIn}
              className="w-full py-4 px-4 bg-white hover:bg-slate-100 disabled:opacity-70 text-slate-900 text-sm font-bold rounded-xl shadow-lg transition-all flex items-center justify-center space-x-3"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              <span>{signingIn ? 'Signing in…' : 'Continue with Google'}</span>
            </button>

            <p className="mt-4 text-center text-[11px] text-slate-500 leading-relaxed">
              By continuing you agree to narrate content responsibly and accept our terms.
            </p>

            {isMockMode && (
              <form onSubmit={handleDevSignIn} className="mt-6 pt-6 border-t border-dashed border-slate-800 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-500/70 text-center">Dev sign-in (mock mode only)</p>
                <div className="flex space-x-2">
                  <input
                    type="email"
                    value={devEmail}
                    onChange={(e) => setDevEmail(e.target.value)}
                    placeholder="admin@example.com"
                    className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                  <button type="submit" className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold">Enter</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 bg-slate-900/10 border-t border-slate-900 px-6">
        <div className="max-w-7xl mx-auto space-y-16">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 bg-indigo-950/40 border border-indigo-500/20 rounded-full">
              <Award className="w-4 h-4 text-indigo-400" />
              <span className="text-[10px] font-black text-indigo-300 uppercase tracking-widest font-mono">Simple Steps</span>
            </div>
            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight">How it works</h2>
            <p className="text-slate-400 max-w-xl mx-auto font-medium">Three steps from sign-up to your first payout.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: BookOpen, title: '1. Pick a book', body: 'Choose from our library. Your progress is saved automatically, so you always continue where you left off.' },
              { icon: Mic, title: '2. Read a page aloud', body: 'Follow the on-screen text and record clear audio in short sessions of up to 10 minutes.' },
              { icon: Wallet, title: '3. Get paid per page', body: 'Once your recording is reviewed and approved, your earnings are added to your wallet for withdrawal.' }
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-slate-900/30 border border-slate-800/80 p-8 rounded-3xl space-y-4 hover:border-slate-700 transition-all">
                <div className="p-3 bg-indigo-500/10 w-fit rounded-2xl text-indigo-400"><Icon className="w-6 h-6" /></div>
                <h3 className="text-xl font-bold text-white">{title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 border-t border-slate-900 px-6 bg-slate-950">
        <div className="max-w-4xl mx-auto space-y-16">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 bg-indigo-950/40 border border-indigo-500/20 rounded-full">
              <MessageSquare className="w-4 h-4 text-indigo-400" />
              <span className="text-[10px] font-black text-indigo-300 uppercase tracking-widest font-mono">FAQ</span>
            </div>
            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight">Questions, answered</h2>
          </div>

          <div className="space-y-4">
            {faqs.map((item, idx) => (
              <div key={idx} className="bg-slate-900/20 border border-slate-900 rounded-2xl overflow-hidden">
                <button onClick={() => toggleFaq(idx)} className="w-full px-6 py-5 text-left flex items-center justify-between font-bold text-white hover:bg-slate-900/30 transition-colors">
                  <span>{item.q}</span>
                  {faqOpen[idx] ? <Minus className="w-4 h-4 text-indigo-400" /> : <Plus className="w-4 h-4 text-indigo-400" />}
                </button>
                {faqOpen[idx] && (
                  <div className="px-6 pb-5 text-sm text-slate-400 leading-relaxed border-t border-slate-900/50 pt-3">{item.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="mt-auto border-t border-slate-900 py-10 text-center text-xs text-slate-500 bg-slate-950">
        <p className="font-medium">© {new Date().getFullYear()} VoiceEarn. All rights reserved.</p>
      </footer>
    </div>
  );
}
