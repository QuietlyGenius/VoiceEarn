import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  Wallet, Headphones, BookOpen, Clock, CheckCircle, 
  ArrowRight, ShieldAlert, Coins, ArrowUpRight, Check, AlertTriangle,
  History, User, LogOut, Search, ChevronRight, CheckSquare, X,
  TrendingUp, Award, Activity, Zap, Mic, Lock
} from 'lucide-react';
import { isAdminEmail } from '../lib/adminEmails';

export default function Dashboard() {
  const { profile, session, signOut, refreshProfile } = useAuth();
  const isAdmin = isAdminEmail(profile?.email);
  const [activeTab, setActiveTab] = useState('home'); // Tabs: 'home', 'library', 'history', 'profile'
  const [books, setBooks] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [exchangeRate, setExchangeRate] = useState(83.5);
  const [ratePerPage, setRatePerPage] = useState(0.01);
  const [loading, setLoading] = useState(true);
  
  // Search
  const [searchQuery, setSearchSearchQuery] = useState('');

  // Withdrawal Form State
  const [withdrawAmount, setWithdrawAmount] = useState('20');
  const [polygonAddress, setPolygonAddress] = useState(profile?.polygon_address || '');
  const [withdrawError, setWithdrawError] = useState('');
  const [withdrawSuccess, setWithdrawSuccess] = useState('');
  const [submittingWithdraw, setSubmittingWithdraw] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);

  const navigate = useNavigate();

  const fetchData = async () => {
    if (!session) return;
    try {
      setLoading(true);
      const headers = { 'Authorization': `Bearer ${session.access_token}` };

      // Refresh the cached wallet balance (picks up server-side changes from
      // withdrawals/approvals) in parallel with everything else.
      refreshProfile();

      // Fire all dashboard requests concurrently instead of waterfalling —
      // each is a separate serverless function, so serial awaits multiply the
      // latency. Promise.allSettled so one slow/failed call can't block the rest.
      const [exRes, settingsRes, booksRes, recRes, wRes] = await Promise.allSettled([
        fetch('/api/exchange-rate'),
        fetch('/api/settings', { headers }),
        fetch('/api/books', { headers }),
        fetch('/api/recordings', { headers }),
        fetch('/api/withdrawals', { headers })
      ]);

      const ok = (r) => r.status === 'fulfilled' && r.value.ok;

      if (ok(exRes)) setExchangeRate((await exRes.value.json()).rate);
      if (ok(settingsRes)) {
        const rate = (await settingsRes.value.json()).find((s) => s.key === 'rate_per_page');
        if (rate) setRatePerPage(parseFloat(rate.value));
      }
      if (ok(booksRes)) setBooks(await booksRes.value.json());
      if (ok(recRes)) setRecordings(await recRes.value.json());
      if (ok(wRes)) setWithdrawals(await wRes.value.json());
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [session]);

  const handleWithdraw = async (e) => {
    e.preventDefault();
    setWithdrawError('');
    setWithdrawSuccess('');
    setSubmittingWithdraw(true);

    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount < 20) {
      setWithdrawError('Minimum withdrawal amount is $20 USD.');
      setSubmittingWithdraw(false);
      return;
    }

    if (!polygonAddress.trim().startsWith('0x') || polygonAddress.trim().length !== 42) {
      setWithdrawError('Please enter a valid Polygon address starting with 0x.');
      setSubmittingWithdraw(false);
      return;
    }

    try {
      const res = await fetch('/api/withdrawals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          amount,
          polygon_address: polygonAddress.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Withdrawal request failed');
      }

      setWithdrawSuccess(`Success! Your request for $${amount.toFixed(2)} has been submitted.`);
      setWithdrawAmount('20');
      setIsWithdrawOpen(false);
      fetchData();
    } catch (err) {
      setWithdrawError(err.message);
    } finally {
      setSubmittingWithdraw(false);
    }
  };

  const updatePolygonAddress = async (addr) => {
    try {
      await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ polygon_address: addr })
      });
    } catch (err) {
      console.error('Error updating address:', err);
    }
  };

  const toINR = (usd) => {
    return (parseFloat(usd || 0) * exchangeRate).toLocaleString('en-IN', {
      maximumFractionDigits: 2,
      style: 'currency',
      currency: 'INR'
    });
  };

  const toUSD = (usd) => {
    return (parseFloat(usd || 0)).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD'
    });
  };

  // Which pages a clip covered (falls back to the count for older clips).
  const pageLabel = (rec) => {
    const s = rec.start_page, e = rec.end_page;
    if (s && e) return s === e ? `Page ${s}` : `Pages ${s}–${e}`;
    const n = rec.pages_recorded || 1;
    return n > 1 ? `${n} pages` : '1 page';
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-slate-400 font-medium text-sm">Loading your dashboard...</p>
      </div>
    );
  }

  // Books are read in the order they were uploaded (the API returns them
  // id-ascending). The NEXT book unlocks once the previous reaches 90% — so a
  // reader isn't blocked by the final page or two. "Done" (bookmark past the
  // last page, i.e. current_page > total_pages) is tracked separately, only for
  // the status pill.
  const UNLOCK_THRESHOLD = 0.9;
  let blockingTitle = null; // earliest sequential book not yet at 90%
  const booksWithState = books.map((book) => {
    const total = book.total_pages || 1;
    const cp = book.current_page || 1;
    const done = cp > total;
    const pagesDone = done ? total : Math.max(0, cp - 1);
    const reached90 = done || pagesDone / total >= UNLOCK_THRESHOLD;
    // Only books flagged "sequential" (requires_previous, the default) take part
    // in the lock chain. A book with the flag off is always freely available.
    const gated = book.requires_previous !== false;
    const locked = gated && blockingTitle !== null;
    const lockedBy = locked ? blockingTitle : null;
    if (gated && !reached90 && !blockingTitle) blockingTitle = book.title;
    return {
      ...book,
      total,
      done,
      locked,
      lockedBy,
      pagesDone,
      nextPage: Math.min(cp, total),
      pct: Math.round((pagesDone / total) * 100)
    };
  });

  const filteredBooks = booksWithState.filter(b =>
    b.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24 flex flex-col selection:bg-indigo-500 selection:text-white">
      
      {/* Mobile Top Header */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-xl border-b border-slate-900/60 px-5 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="p-2 bg-gradient-to-tr from-indigo-500 to-violet-600 rounded-xl shadow-md shadow-indigo-500/10">
            <Mic className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-extrabold text-sm tracking-tight text-white block">VoiceEarn</span>
            <span className="text-[8px] font-black uppercase text-indigo-400 tracking-widest block font-mono">Narrate &amp; Earn</span>
          </div>
        </div>
        
        {/* Prominent Outside Navigation & Logout Option */}
        <div className="flex items-center space-x-3">
          {isAdmin && (
            <Link
              to="/admin"
              className="text-[10px] uppercase font-black tracking-wider px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-indigo-400 rounded-lg border border-indigo-500/10 transition-colors"
            >
              Admin
            </Link>
          )}
          <button
            onClick={signOut}
            className="text-[10px] uppercase font-black tracking-wider px-2.5 py-1.5 bg-red-950/40 text-red-400 rounded-lg hover:bg-red-900/30 transition-colors flex items-center space-x-1"
          >
            <LogOut className="w-3 h-3" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Container - max-w-md to lock as a mobile app layout */}
      <main className="max-w-md w-full mx-auto px-5 pt-6 flex-1 flex flex-col">
        
        {/* TAB 1: HOME / WALLET */}
        {activeTab === 'home' && (
          <div className="space-y-6 flex-1 flex flex-col justify-between">
            <div className="space-y-6">
              
              {/* Primary Focus: Recording CTA */}
              <div className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-900 rounded-3xl p-6 shadow-xl shadow-indigo-950/40 relative overflow-hidden border border-indigo-500/20">
                <div className="absolute right-0 bottom-0 opacity-10 translate-x-4 translate-y-4">
                  <Mic className="w-48 h-48" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-indigo-200 uppercase tracking-widest font-mono">Voice Work</span>
                  <span className="bg-emerald-500/20 text-emerald-300 text-[9px] px-2.5 py-1 rounded-full font-black uppercase tracking-wider flex items-center space-x-1 border border-emerald-500/20">
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>Active</span>
                  </span>
                </div>

                <div className="mt-5">
                  <h3 className="text-2xl font-extrabold text-white">Start narrating</h3>
                  <p className="text-sm text-indigo-200 mt-1.5 max-w-[260px]">
                    Pick a book, read the text on your screen aloud, and get paid for every approved page.
                  </p>
                </div>

                <button
                  onClick={() => setActiveTab('library')}
                  className="mt-5 px-5 py-3 bg-white text-indigo-950 text-xs font-black uppercase tracking-wider rounded-xl flex items-center justify-center space-x-2 shadow-lg hover:bg-indigo-50 transition-all"
                >
                  <span>Browse Books</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {/* Earnings Card */}
              <div className="bg-slate-900/30 border border-slate-900 p-5 rounded-3xl space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Your Earnings</span>
                  <span className="text-[10px] text-indigo-400 font-bold font-mono">Rate: {toUSD(ratePerPage)} / page</span>
                </div>

                <div className="flex items-baseline justify-between">
                  <div>
                    <h2 className="text-3xl font-black text-white leading-none">
                      {toUSD(profile?.wallet_balance_usd)}
                    </h2>
                    <p className="text-sm font-bold text-slate-400 mt-1">
                      ≈ {toINR(profile?.wallet_balance_usd)}
                    </p>
                  </div>

                  <button
                    onClick={() => setIsWithdrawOpen(true)}
                    disabled={parseFloat(profile?.wallet_balance_usd || 0) < 20}
                    className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-900 disabled:text-slate-600 disabled:border-slate-800 text-[10px] font-black uppercase tracking-wider text-white rounded-xl transition-all border border-indigo-500/20"
                  >
                    Withdraw
                  </button>
                </div>

                {parseFloat(profile?.wallet_balance_usd || 0) < 20 && (
                  <p className="text-[10px] text-slate-500 font-medium">
                    * You can withdraw your earnings once you reach $20.00.
                  </p>
                )}
              </div>

              {/* Simple Stats Grid */}
              <div className="grid grid-cols-2 gap-3.5">
                <div className="bg-slate-900/30 border border-slate-900 p-4 rounded-2xl">
                  <span className="text-[10px] text-slate-500 font-black uppercase tracking-wider block">Submitted Clips</span>
                  <span className="text-2xl font-black text-white mt-2 block leading-none">{recordings.length}</span>
                </div>
                <div className="bg-slate-900/30 border border-slate-900 p-4 rounded-2xl">
                  <span className="text-[10px] text-slate-500 font-black uppercase tracking-wider block">Approved Pages</span>
                  <span className="text-2xl font-black text-emerald-400 mt-2 block leading-none">
                    {recordings.filter(r => r.status === 'approved' || r.status === 'partially_approved')
                      .reduce((sum, r) => sum + parseFloat(r.approved_minutes || 0), 0).toFixed(0)} pages
                  </span>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* TAB 2: LIBRARY */}
        {activeTab === 'library' && (
          <div className="space-y-4 flex-1 flex flex-col">
            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-3 top-3.5 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchSearchQuery(e.target.value)}
                placeholder="Search books..."
                className="w-full pl-9 pr-4 py-3 bg-slate-900/60 border border-slate-900 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            <div className="space-y-3.5 flex-1 overflow-y-auto">
              {filteredBooks.length === 0 ? (
                <div className="p-8 bg-slate-900/40 rounded-2xl text-center text-slate-600 border border-slate-900">
                  No books match your search.
                </div>
              ) : (
                filteredBooks.map((book) => (
                  book.locked ? (
                    /* LOCKED — the same card as an unlocked book, just blurred and
                       non-interactive, with a crisp centered lock overlay. */
                    <div key={book.id} className="relative rounded-2xl overflow-hidden">
                      <div className="bg-slate-900/30 rounded-2xl p-5 border border-slate-900 space-y-4 blur-[3px] opacity-50 select-none pointer-events-none">
                        <div className="flex justify-between items-start gap-3">
                          <div className="min-w-0">
                            <h4 className="font-extrabold text-lg text-white leading-tight truncate">{book.title}</h4>
                            <span className="text-[12px] text-slate-500 font-semibold">{book.total} pages total</span>
                          </div>
                          <span className="shrink-0 text-[11px] font-black uppercase px-3 py-1.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">Locked</span>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-end justify-between">
                            <span className="text-2xl font-black text-white leading-none">
                              {book.pagesDone}<span className="text-slate-500 text-base font-bold"> / {book.total}</span>
                            </span>
                            <span className="text-[12px] font-bold text-slate-400">pages recorded</span>
                          </div>
                          <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-900">
                            <div className="bg-gradient-to-r from-indigo-500 to-emerald-500 h-full rounded-full" style={{ width: `${book.pct}%` }} />
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[12px] bg-slate-950/40 rounded-lg px-3 py-2 border border-slate-900">
                          <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Earn up to</span>
                          <span className="text-emerald-400 font-black">
                            +${(book.total * ratePerPage).toFixed(2)}
                            <span className="text-slate-500 font-semibold ml-1">≈ {toINR(book.total * ratePerPage)}</span>
                          </span>
                        </div>
                      </div>
                      {/* crisp overlay, centered so it never overlaps the title */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                        <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center mb-2 shadow-lg">
                          <Lock className="w-6 h-6 text-slate-100" />
                        </div>
                        <span className="text-sm font-black text-white uppercase tracking-wide drop-shadow">Locked</span>
                        <p className="text-[12px] text-slate-200 font-semibold mt-1.5 leading-snug max-w-[250px] bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-1.5">
                          Reach 90% of <span className="text-white font-bold">"{book.lockedBy}"</span> to unlock
                        </p>
                      </div>
                    </div>
                  ) : (
                    /* UNLOCKED — plain-language progress + clear next action */
                    <div key={book.id} className="bg-slate-900/30 rounded-2xl p-5 border border-slate-900 space-y-4">
                      <div className="flex justify-between items-start gap-3">
                        <div className="min-w-0">
                          <h4 className="font-extrabold text-lg text-white leading-tight">{book.title}</h4>
                          <span className="text-[12px] text-slate-500 font-semibold">{book.total} pages total</span>
                        </div>
                        {book.done ? (
                          <span className="shrink-0 text-[11px] font-black uppercase px-3 py-1.5 rounded-full bg-emerald-950/30 text-emerald-400 border border-emerald-900/40 flex items-center gap-1">
                            <CheckCircle className="w-3.5 h-3.5" /> Done
                          </span>
                        ) : book.pagesDone === 0 ? (
                          <span className="shrink-0 text-[11px] font-black uppercase px-3 py-1.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">New</span>
                        ) : (
                          <span className="shrink-0 text-[11px] font-black uppercase px-3 py-1.5 rounded-full bg-indigo-950/30 text-indigo-300 border border-indigo-900/40">In progress</span>
                        )}
                      </div>

                      {/* Big, plain progress read-out */}
                      <div className="space-y-2">
                        <div className="flex items-end justify-between">
                          <span className="text-2xl font-black text-white leading-none">
                            {book.pagesDone}<span className="text-slate-500 text-base font-bold"> / {book.total}</span>
                          </span>
                          <span className="text-[12px] font-bold text-slate-400">pages recorded</span>
                        </div>
                        <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-900">
                          <div className="bg-gradient-to-r from-indigo-500 to-emerald-500 h-full rounded-full transition-all duration-300" style={{ width: `${book.pct}%` }} />
                        </div>
                        {book.done ? (
                          <p className="text-[13px] text-emerald-400 font-bold">🎉 All pages recorded — this book is complete!</p>
                        ) : (
                          <p className="text-[13px] text-amber-300 font-bold flex items-center gap-1.5">
                            <Mic className="w-3.5 h-3.5 shrink-0" />
                            {book.pagesDone === 0
                              ? `Not started yet — record page 1 to begin`
                              : `Next: record page ${book.nextPage} of ${book.total}`}
                          </p>
                        )}
                      </div>

                      {/* Earnings */}
                      <div className="flex items-center justify-between text-[12px] bg-slate-950/40 rounded-lg px-3 py-2 border border-slate-900">
                        <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Earn up to</span>
                        <span className="text-emerald-400 font-black">
                          +${(book.total * ratePerPage).toFixed(2)}
                          <span className="text-slate-500 font-semibold ml-1">≈ {toINR(book.total * ratePerPage)}</span>
                        </span>
                      </div>

                      {/* Call to action */}
                      {book.done ? (
                        <button
                          onClick={() => navigate(`/record/${book.id}`)}
                          className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm py-3 rounded-xl border border-slate-700 transition-all"
                        >
                          Completed — re-record if needed
                        </button>
                      ) : (
                        <button
                          onClick={() => navigate(`/record/${book.id}`)}
                          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-wider text-sm py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all"
                        >
                          <Mic className="w-4 h-4" />
                          <span>{book.pagesDone === 0 ? 'Start — record page 1' : `Continue — page ${book.nextPage}`}</span>
                        </button>
                      )}
                    </div>
                  )
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: ACTIVITY / HISTORY */}
        {activeTab === 'history' && (
          <div className="space-y-6 flex-1 flex flex-col overflow-y-auto">
            
            {/* Audio submissions */}
            <div className="space-y-3">
              <h3 className="text-[13px] font-black uppercase tracking-wider text-slate-400">Your Recording Clips</h3>
              <div className="space-y-2.5">
                {recordings.length === 0 ? (
                  <p className="text-sm text-slate-500 italic text-center py-6">No recordings submitted yet.</p>
                ) : (
                  recordings.map((rec) => {
                    const earnedUsd = parseFloat(rec.approved_minutes || 0) * ratePerPage;
                    const estimateUsd = (rec.pages_recorded || 1) * ratePerPage;
                    const isEarned = rec.status === 'approved' || rec.status === 'partially_approved';
                    return (
                    <div key={rec.id} className="bg-slate-900/30 p-4 rounded-2xl border border-slate-900 space-y-2.5">
                      <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="font-bold text-white text-[15px] block truncate">
                          {rec.books?.title}
                        </span>
                        <span className="text-[11px] text-slate-400 block font-semibold mt-1">
                          Submitted {new Date(rec.created_at).toLocaleDateString()}
                        </span>
                        <span className="text-[11px] text-indigo-400 block font-bold mt-0.5">
                          {pageLabel(rec)}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`px-3 py-1 rounded-full font-black text-[11px] uppercase border ${
                          rec.status === 'approved' ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900/30' :
                          rec.status === 'rejected' ? 'bg-red-950/20 text-red-400 border-red-900/30' :
                          rec.status === 'partially_approved' ? 'bg-indigo-950/20 text-indigo-400 border-indigo-900/30' :
                          'bg-amber-950/20 text-amber-400 border-amber-900/30'
                        }`}>
                          {rec.status === 'pending' ? 'Reviewing' : rec.status.replace('_', ' ')}
                        </span>
                        {isEarned && (
                          <>
                            <span className="text-base text-emerald-400 font-extrabold block mt-1.5 font-mono">
                              +${earnedUsd.toFixed(2)}
                            </span>
                            <span className="text-[12px] text-slate-400 font-semibold block font-mono">
                              ≈ {toINR(earnedUsd)}
                            </span>
                          </>
                        )}
                        {rec.status === 'pending' && (
                          <>
                            <span className="text-sm text-amber-400 font-extrabold block mt-1.5 font-mono">
                              ~${estimateUsd.toFixed(2)}
                            </span>
                            <span className="text-[12px] text-slate-400 font-semibold block font-mono">
                              ≈ {toINR(estimateUsd)} if approved
                            </span>
                          </>
                        )}
                      </div>
                      </div>
                      {rec.review_reason && (rec.status === 'rejected' || rec.status === 'partially_approved') && (
                        <div className="text-[12px] rounded-lg px-3 py-2 bg-amber-950/15 border border-amber-900/25 text-amber-200/90 leading-snug">
                          <span className="font-bold text-amber-400">
                            {rec.status === 'rejected' ? 'Why it was rejected: ' : 'Note: '}
                          </span>
                          {rec.review_reason}
                        </div>
                      )}
                    </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Withdrawals */}
            <div className="space-y-3">
              <h3 className="text-[13px] font-black uppercase tracking-wider text-slate-400">Your Cashouts</h3>
              <div className="space-y-2.5">
                {withdrawals.length === 0 ? (
                  <p className="text-sm text-slate-500 italic text-center py-6">No cashouts requested yet.</p>
                ) : (
                  withdrawals.map((w) => (
                    <div key={w.id} className="bg-slate-900/30 p-4 rounded-2xl border border-slate-900 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="font-extrabold text-white text-base">${parseFloat(w.amount).toFixed(2)}</span>
                        <span className="text-[12px] text-slate-400 font-semibold font-mono ml-1.5">
                          ≈ {toINR(w.amount)}
                        </span>
                        <span className="text-[11px] text-slate-500 block font-mono truncate mt-1">
                          {w.polygon_address}
                        </span>
                      </div>
                      <span className={`px-3 py-1 rounded-full font-black text-[11px] uppercase border shrink-0 ${
                        w.status === 'approved' ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900/30' :
                        w.status === 'rejected' ? 'bg-red-950/20 text-red-400 border-red-900/30' :
                        'bg-amber-950/20 text-amber-400 border-amber-900/30'
                      }`}>
                        {w.status === 'pending' ? 'Processing' : w.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        )}

        {/* TAB 4: PROFILE */}
        {activeTab === 'profile' && (
          <div className="space-y-6 flex-1 flex flex-col justify-between">
            <div className="space-y-6">
              {/* Profile Card */}
              <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-900 space-y-4">
                <div className="flex items-center space-x-3.5">
                  <div className="w-12 h-12 bg-gradient-to-tr from-indigo-500 to-violet-600 rounded-2xl flex items-center justify-center font-black text-lg text-white">
                    {(profile?.first_name || profile?.email || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <span className="font-extrabold text-base text-white block truncate">
                      {[profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.email}
                    </span>
                    <span className="text-[11px] text-slate-400 block truncate">{profile?.email}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 pt-1 border-t border-slate-800/60">
                  <div className="flex justify-between text-xs pt-2">
                    <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Qualification</span>
                    <span className="text-slate-300 font-medium">{profile?.highest_qualification || '—'}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">English</span>
                    <span className="text-slate-300 font-medium">{profile?.english_proficiency || '—'}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Country</span>
                    <span className="text-slate-300 font-medium">{profile?.country || '—'}</span>
                  </div>
                </div>
              </div>

              {/* Polygon Address Config */}
              <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-900 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Polygon Wallet Address</h3>
                <input
                  type="text"
                  value={polygonAddress}
                  onChange={(e) => {
                    setPolygonAddress(e.target.value);
                    updatePolygonAddress(e.target.value);
                  }}
                  placeholder="Enter 0x address to link..."
                  className="w-full px-3.5 py-3 bg-slate-950 border border-slate-900 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-indigo-500 transition-colors"
                />
                <p className="text-[10px] text-slate-600 leading-relaxed">
                  Your address is saved automatically. Manual cashouts will be sent here.
                </p>
              </div>
            </div>

            {/* Logout */}
            <div className="pt-6">
              <button
                onClick={signOut}
                className="w-full py-3 bg-red-950/20 hover:bg-red-950/30 text-red-400 font-extrabold text-xs rounded-xl border border-red-950/30 transition-all flex items-center justify-center space-x-2"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        )}

      </main>

      {/* WITHDRAWAL DRAWER / MODAL */}
      {isWithdrawOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-t-3xl w-full max-w-md p-6 space-y-4 animate-in slide-in-from-bottom duration-300">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-base text-white">Cash Out Request</h3>
              <button onClick={() => setIsWithdrawOpen(false)} className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            {withdrawError && (
              <div className="p-3 bg-red-950/30 border border-red-500/20 rounded-xl text-xs text-red-400">
                {withdrawError}
              </div>
            )}

            <form onSubmit={handleWithdraw} className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                  Amount to Cash Out (USD)
                </label>
                <input
                  type="number"
                  min="20"
                  step="0.01"
                  required
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  className="w-full px-4 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-bold focus:outline-none focus:border-indigo-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                  Polygon Wallet Address
                </label>
                <input
                  type="text"
                  required
                  value={polygonAddress}
                  onChange={(e) => setPolygonAddress(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-4 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              <button
                type="submit"
                disabled={submittingWithdraw}
                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs rounded-xl"
              >
                {submittingWithdraw ? 'Submitting Request...' : 'Confirm Cash Out'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* STICKY BOTTOM NAVIGATION BAR */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/90 backdrop-blur-xl border-t border-slate-900/60 py-3.5 px-8 max-w-md mx-auto w-full flex items-center justify-between">
        <button
          onClick={() => setActiveTab('home')}
          className={`flex flex-col items-center space-y-1.5 transition-all ${
            activeTab === 'home' ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <Wallet className="w-5 h-5" />
          <span className="text-[9px] font-black uppercase tracking-widest font-mono">Wallet</span>
        </button>

        <button
          onClick={() => setActiveTab('library')}
          className={`flex flex-col items-center space-y-1.5 transition-all ${
            activeTab === 'library' ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <BookOpen className="w-5 h-5" />
          <span className="text-[9px] font-black uppercase tracking-widest font-mono">Books</span>
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`flex flex-col items-center space-y-1.5 transition-all ${
            activeTab === 'history' ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <History className="w-5 h-5" />
          <span className="text-[9px] font-black uppercase tracking-widest font-mono">History</span>
        </button>

        <button
          onClick={() => setActiveTab('profile')}
          className={`flex flex-col items-center space-y-1.5 transition-all ${
            activeTab === 'profile' ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <User className="w-5 h-5" />
          <span className="text-[9px] font-black uppercase tracking-widest font-mono">Profile</span>
        </button>
      </footer>

    </div>
  );
}
