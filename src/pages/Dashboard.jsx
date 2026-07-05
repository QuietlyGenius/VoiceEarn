import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  Wallet, Headphones, BookOpen, Clock, CheckCircle, 
  ArrowRight, ShieldAlert, Coins, ArrowUpRight, Check, AlertTriangle,
  History, User, LogOut, Search, ChevronRight, CheckSquare, X,
  TrendingUp, Award, Activity, Zap, Mic
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

      // 0. Refresh wallet balance (profile is cached in AuthContext and won't
      // otherwise pick up server-side changes from withdrawals/approvals)
      refreshProfile();

      // 1. Fetch Exchange Rate
      const exRes = await fetch('/api/exchange-rate');
      if (exRes.ok) {
        const exData = await exRes.json();
        setExchangeRate(exData.rate);
      }

      // 2. Fetch Configurable Rate Per Page
      const settingsRes = await fetch('/api/settings', { headers });
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        const rateSetting = settingsData.find(s => s.key === 'rate_per_page');
        if (rateSetting) {
          setRatePerPage(parseFloat(rateSetting.value));
        }
      }

      // 3. Fetch Books
      const booksRes = await fetch('/api/books', { headers });
      if (booksRes.ok) {
        const booksData = await booksRes.json();
        setBooks(booksData);
      }

      // 4. Fetch User Recordings
      const recRes = await fetch('/api/recordings', { headers });
      if (recRes.ok) {
        const recData = await recRes.json();
        setRecordings(recData);
      }

      // 5. Fetch User Withdrawals
      const wRes = await fetch('/api/withdrawals', { headers });
      if (wRes.ok) {
        const wData = await wRes.json();
        setWithdrawals(wData);
      }

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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-slate-400 font-medium text-sm">Loading your dashboard...</p>
      </div>
    );
  }

  const filteredBooks = books.filter(b => 
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
                filteredBooks.map((book) => {
                  const progressPct = Math.round((book.current_page / book.total_pages) * 100);
                  return (
                    <div 
                      key={book.id}
                      className="bg-slate-900/30 rounded-2xl p-4.5 border border-slate-900 hover:border-slate-800 transition-all flex flex-col space-y-3.5"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-extrabold text-base text-white">{book.title}</h4>
                          <div className="flex items-center space-x-3 mt-1 text-[11px] text-slate-500 font-bold uppercase tracking-wider">
                            <span className="flex items-center space-x-1">
                              <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                              <span>{book.total_pages} pages</span>
                            </span>
                          </div>
                        </div>
                        <span className="text-right">
                          <span className="text-[10px] font-black text-emerald-400 bg-emerald-950/20 px-2.5 py-1 rounded-lg border border-emerald-900/30 block">
                            +${(book.total_pages * ratePerPage).toFixed(2)}
                          </span>
                          <span className="text-[9px] font-bold text-slate-500 block mt-1">
                            ≈ {toINR(book.total_pages * ratePerPage)}
                          </span>
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
                          <span>Reading Progress</span>
                          <span>{progressPct}% (Page {book.current_page}/{book.total_pages})</span>
                        </div>
                        <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-900">
                          <div 
                            className="bg-gradient-to-r from-indigo-500 to-violet-600 h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${progressPct}%` }}
                          ></div>
                        </div>
                      </div>

                      <button
                        onClick={() => navigate(`/record/${book.id}`)}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-wider text-sm py-3 rounded-xl flex items-center justify-center space-x-1 transition-all"
                      >
                        <span>Start Recording</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 3: ACTIVITY / HISTORY */}
        {activeTab === 'history' && (
          <div className="space-y-6 flex-1 flex flex-col overflow-y-auto">
            
            {/* Audio submissions */}
            <div className="space-y-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">Your Recording Clips</h3>
              <div className="space-y-2">
                {recordings.length === 0 ? (
                  <p className="text-xs text-slate-600 italic text-center py-4">No recordings submitted yet.</p>
                ) : (
                  recordings.map((rec) => (
                    <div key={rec.id} className="bg-slate-900/30 p-4 rounded-xl border border-slate-900 flex items-center justify-between text-sm">
                      <div>
                        <span className="font-bold text-white block truncate max-w-[180px]">
                          {rec.books?.title}
                        </span>
                        <span className="text-[10px] text-slate-500 block font-bold uppercase tracking-wider mt-0.5">
                          Submitted {new Date(rec.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className={`px-2.5 py-1 rounded-full font-black text-[9px] uppercase border ${
                          rec.status === 'approved' ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900/30' :
                          rec.status === 'rejected' ? 'bg-red-950/20 text-red-400 border-red-900/30' :
                          rec.status === 'partially_approved' ? 'bg-indigo-950/20 text-indigo-400 border-indigo-900/30' :
                          'bg-amber-950/20 text-amber-400 border-amber-900/30'
                        }`}>
                          {rec.status === 'pending' ? 'Reviewing' : rec.status.replace('_', ' ')}
                        </span>
                        {(rec.status === 'approved' || rec.status === 'partially_approved') && (
                          <>
                            <span className="text-[10px] text-emerald-400 font-extrabold block mt-1 font-mono">
                              +${(parseFloat(rec.approved_minutes || 0) * ratePerPage).toFixed(2)}
                            </span>
                            <span className="text-[9px] text-slate-500 font-bold block font-mono">
                              ≈ {toINR(parseFloat(rec.approved_minutes || 0) * ratePerPage)}
                            </span>
                          </>
                        )}
                        {rec.status === 'pending' && (
                          <span className="text-[10px] text-amber-400/80 font-bold block mt-1 font-mono">
                            ~${((rec.pages_recorded || 1) * ratePerPage).toFixed(2)} if approved
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Withdrawals */}
            <div className="space-y-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">Your Cashouts</h3>
              <div className="space-y-2">
                {withdrawals.length === 0 ? (
                  <p className="text-xs text-slate-600 italic text-center py-4">No cashouts requested yet.</p>
                ) : (
                  withdrawals.map((w) => (
                    <div key={w.id} className="bg-slate-900/30 p-4 rounded-xl border border-slate-900 flex items-center justify-between text-sm">
                      <div>
                        <span className="font-extrabold text-white">${parseFloat(w.amount).toFixed(2)}</span>
                        <span className="text-[10px] text-slate-500 font-bold font-mono ml-1.5">
                          ≈ {toINR(w.amount)}
                        </span>
                        <span className="text-[10px] text-slate-500 block font-mono truncate max-w-[180px] mt-0.5">
                          {w.polygon_address}
                        </span>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full font-black text-[9px] uppercase border ${
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
