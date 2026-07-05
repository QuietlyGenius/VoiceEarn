import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  BookOpen, Check, X, Shield, AlertCircle, UploadCloud, Settings,
  UserCheck, Clock, GraduationCap, Globe, Languages, Download, Mail
} from 'lucide-react';
import { Link } from 'react-router-dom';

export default function AdminDashboard() {
  const { session } = useAuth();
  const [activeTab, setActiveTab] = useState('approvals');
  const [loading, setLoading] = useState(true);

  // Registration approvals
  const [pendingUsers, setPendingUsers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [approvalError, setApprovalError] = useState('');

  // Book upload
  const [books, setBooks] = useState([]);
  const [bookTitle, setBookTitle] = useState('');
  const [bookText, setBookText] = useState('');
  const [bookError, setBookError] = useState('');
  const [bookSuccess, setBookSuccess] = useState('');
  const [uploadingBook, setUploadingBook] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileParsingStep, setFileParsingStep] = useState('');
  const [skipPages, setSkipPages] = useState('0');

  // Review queue
  const [recordings, setRecordings] = useState([]);
  const [reviewError, setReviewError] = useState('');
  const [reviewSuccess, setReviewSuccess] = useState('');
  const [partialPages, setPartialPages] = useState({});

  // Withdrawals
  const [withdrawals, setWithdrawals] = useState([]);
  const [withdrawError, setWithdrawError] = useState('');
  const [withdrawSuccess, setWithdrawSuccess] = useState('');

  // Settings
  const [ratePerPage, setRatePerPage] = useState('0.01');
  const [registrationMode, setRegistrationMode] = useState('manual');
  const [signupBonus, setSignupBonus] = useState('0');
  const [settingsSuccess, setSettingsSuccess] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  const authHeaders = () => ({ Authorization: `Bearer ${session.access_token}` });

  const fetchData = async () => {
    if (!session) return;
    try {
      setLoading(true);
      const headers = authHeaders();

      const [regRes, allRes, booksRes, recRes, wRes, sRes] = await Promise.all([
        fetch('/api/registrations?status=pending', { headers }),
        fetch('/api/registrations', { headers }),
        fetch('/api/books', { headers }),
        fetch('/api/recordings?admin=true', { headers }),
        fetch('/api/withdrawals?admin=true', { headers }),
        fetch('/api/settings', { headers })
      ]);

      if (regRes.ok) setPendingUsers(await regRes.json());
      if (allRes.ok) setAllUsers(await allRes.json());
      if (booksRes.ok) setBooks(await booksRes.json());
      if (recRes.ok) setRecordings(await recRes.json());
      if (wRes.ok) setWithdrawals(await wRes.json());
      if (sRes.ok) {
        const sData = await sRes.json();
        const get = (k) => sData.find((s) => s.key === k)?.value;
        if (get('rate_per_page') !== undefined) setRatePerPage(get('rate_per_page'));
        if (get('registration_mode') !== undefined) setRegistrationMode(get('registration_mode'));
        if (get('signup_bonus_usd') !== undefined) setSignupBonus(get('signup_bonus_usd'));
      }
    } catch (err) {
      console.error('Error fetching admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [session]);

  const handleReviewRegistration = async (userId, action) => {
    setApprovalError('');
    try {
      const res = await fetch('/api/registrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ user_id: userId, action })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to update registration');
      fetchData();
    } catch (err) {
      setApprovalError(err.message);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setBookTitle(file.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleUploadBook = async (e) => {
    e.preventDefault();
    setBookError('');
    setBookSuccess('');
    setUploadingBook(true);
    setFileParsingStep('Preparing upload…');

    try {
      let fileUrl = '';
      let textToUpload = bookText.trim();

      if (selectedFile) {
        setFileParsingStep(`Uploading ${selectedFile.name}…`);
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(selectedFile);
        });

        const uploadRes = await fetch('/api/upload-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            fileName: selectedFile.name,
            fileBase64: base64,
            contentType: selectedFile.type,
            bucketName: 'book-files'
          })
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.error || 'Failed to upload book file');
        fileUrl = uploadData.url;

        if (!textToUpload) {
          setFileParsingStep('Extracting text from the document…');
          // Loaded on demand so pdfjs/JSZip stay out of the initial bundle.
          const { extractTextFromFile } = await import('../lib/bookFileParser');
          textToUpload = (await extractTextFromFile(selectedFile)).trim();
          if (!textToUpload) {
            throw new Error('Could not extract any text from this file. It may be image-only or corrupted — try pasting the book text manually.');
          }
        }
      }

      if (!bookTitle.trim()) throw new Error('Book title is required.');
      if (!textToUpload) throw new Error('Please enter text content or upload a PDF/EPUB file to parse.');

      setFileParsingStep('Paginating and calculating reading time…');

      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ title: bookTitle.trim(), text_content: textToUpload, file_url: fileUrl, skip_pages: parseInt(skipPages, 10) || 0 })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create book');

      setBookSuccess(`Book "${data.title}" added — ${data.total_pages} pages, ~${data.calculated_minutes} min total.`);
      setBookTitle('');
      setBookText('');
      setSelectedFile(null);
      setSkipPages('0');
      fetchData();
    } catch (err) {
      setBookError(err.message);
    } finally {
      setUploadingBook(false);
      setFileParsingStep('');
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSettingsSuccess('');
    setSettingsError('');
    setSavingSettings(true);
    try {
      const entries = [
        { key: 'rate_per_page', value: String(ratePerPage).trim() },
        { key: 'registration_mode', value: registrationMode },
        { key: 'signup_bonus_usd', value: String(signupBonus).trim() }
      ];
      for (const body of entries) {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error((await res.json()).error || `Failed to save ${body.key}`);
      }
      setSettingsSuccess('Settings saved.');
      fetchData();
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleReviewRecording = async (recordingId, status, pages) => {
    setReviewError('');
    setReviewSuccess('');
    try {
      const res = await fetch('/api/recordings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ recording_id: recordingId, status, approved_pages: pages })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to review recording');
      setReviewSuccess('Recording reviewed.');
      fetchData();
    } catch (err) {
      setReviewError(err.message);
    }
  };

  const handleReviewWithdrawal = async (withdrawalId, status) => {
    setWithdrawError('');
    setWithdrawSuccess('');
    try {
      const res = await fetch('/api/withdrawals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ withdrawal_id: withdrawalId, status })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to process withdrawal');
      setWithdrawSuccess('Withdrawal updated.');
      fetchData();
    } catch (err) {
      setWithdrawError(err.message);
    }
  };

  const tabs = [
    { id: 'approvals', label: `Approvals (${pendingUsers.length})` },
    { id: 'users', label: `Users (${allUsers.length})` },
    { id: 'books', label: 'Books' },
    { id: 'review', label: `Queue (${recordings.filter((r) => r.status === 'pending').length})` },
    { id: 'withdrawals', label: `Payouts (${withdrawals.filter((w) => w.status === 'pending').length})` },
    { id: 'settings', label: 'Settings' }
  ];

  const statusBadge = (status) => {
    const map = {
      approved: 'bg-emerald-950/20 text-emerald-400 border-emerald-900/30',
      pending: 'bg-amber-950/20 text-amber-400 border-amber-900/30',
      rejected: 'bg-red-950/20 text-red-400 border-red-900/30'
    };
    return map[status] || 'bg-slate-800 text-slate-400 border-slate-700';
  };

  const fullName = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      <header className="sticky top-0 z-40 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-400"><Shield className="w-5 h-5" /></div>
          <div>
            <span className="font-extrabold text-sm tracking-tight text-white block">Admin Console</span>
            <span className="text-[8px] font-black uppercase text-indigo-400 tracking-widest block font-mono">VoiceEarn</span>
          </div>
        </div>
        <Link to="/dashboard" className="text-xs font-semibold px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
          User Dashboard
        </Link>
      </header>

      {/* Stats */}
      <div className="max-w-md mx-auto px-4 pt-6 grid grid-cols-3 gap-3">
        <div className="bg-slate-900/40 border border-slate-900 p-3 rounded-xl">
          <span className="text-[8px] font-black uppercase text-slate-500 tracking-wider block">Pending approvals</span>
          <span className="text-xl font-black text-amber-400 mt-1 block">{pendingUsers.length}</span>
        </div>
        <div className="bg-slate-900/40 border border-slate-900 p-3 rounded-xl">
          <span className="text-[8px] font-black uppercase text-slate-500 tracking-wider block">Approved pages</span>
          <span className="text-xl font-black text-indigo-400 mt-1 block">
            {recordings.filter((r) => r.status === 'approved' || r.status === 'partially_approved')
              .reduce((s, r) => s + parseFloat(r.approved_minutes || 0), 0)}
          </span>
        </div>
        <div className="bg-slate-900/40 border border-slate-900 p-3 rounded-xl">
          <span className="text-[8px] font-black uppercase text-slate-500 tracking-wider block">Pending payouts</span>
          <span className="text-xl font-black text-emerald-400 mt-1 block">{withdrawals.filter((w) => w.status === 'pending').length}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-slate-950 mt-6 px-4 py-1 flex space-x-1 border-b border-slate-900 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-3 py-2.5 text-xs font-bold transition-all rounded-lg whitespace-nowrap ${
              activeTab === t.id ? 'bg-slate-900 text-indigo-400' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <main className="max-w-md mx-auto px-4 pt-6">
        {/* APPROVALS */}
        {activeTab === 'approvals' && (
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <UserCheck className="w-5 h-5 text-indigo-400" />
              <h3 className="text-base font-bold text-white">Registration Approvals</h3>
            </div>
            <p className="text-xs text-slate-500">
              Applicants awaiting review. {registrationMode === 'auto'
                ? 'Registration is currently set to AUTO — new users are approved automatically.'
                : 'Registration is set to MANUAL — approve users to grant access.'}
            </p>

            {approvalError && (
              <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-xs text-red-300">{approvalError}</div>
            )}

            {pendingUsers.length === 0 ? (
              <div className="p-8 bg-slate-900/20 rounded-2xl text-center text-slate-600 border border-slate-900">
                No pending applications.
              </div>
            ) : (
              <div className="space-y-3">
                {pendingUsers.map((u) => (
                  <div key={u.id} className="bg-slate-900/30 rounded-2xl p-4 border border-slate-900 space-y-3">
                    <div>
                      <span className="font-bold text-white block">{fullName(u)}</span>
                      <span className="text-[11px] text-indigo-400 font-mono flex items-center space-x-1 mt-0.5">
                        <Mail className="w-3 h-3" /><span>{u.email}</span>
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 text-[11px] text-slate-400">
                      <span className="flex items-center space-x-1.5"><GraduationCap className="w-3.5 h-3.5 text-slate-500" /><span>{u.highest_qualification || '—'}</span></span>
                      <span className="flex items-center space-x-1.5"><Languages className="w-3.5 h-3.5 text-slate-500" /><span>English: {u.english_proficiency || '—'}</span></span>
                      <span className="flex items-center space-x-1.5"><Globe className="w-3.5 h-3.5 text-slate-500" /><span>{u.country || '—'}</span></span>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      <button onClick={() => handleReviewRegistration(u.id, 'reject')} className="py-2 bg-red-950/20 text-red-400 hover:bg-red-950/30 border border-red-950/30 text-[10px] font-black rounded-lg uppercase tracking-wider flex items-center justify-center space-x-1">
                        <X className="w-3.5 h-3.5" /><span>Reject</span>
                      </button>
                      <button onClick={() => handleReviewRegistration(u.id, 'approve')} className="py-2 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-950/30 border border-emerald-950/30 text-[10px] font-black rounded-lg uppercase tracking-wider flex items-center justify-center space-x-1">
                        <Check className="w-3.5 h-3.5" /><span>Approve</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ALL REGISTERED USERS */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <UserCheck className="w-5 h-5 text-indigo-400" />
              <h3 className="text-base font-bold text-white">Registered Users</h3>
            </div>

            {/* Status summary */}
            <div className="grid grid-cols-3 gap-2">
              {['approved', 'pending', 'rejected'].map((st) => (
                <div key={st} className="bg-slate-900/40 border border-slate-900 p-2.5 rounded-xl text-center">
                  <span className="text-[8px] font-black uppercase text-slate-500 tracking-wider block">{st}</span>
                  <span className={`text-lg font-black mt-0.5 block ${st === 'approved' ? 'text-emerald-400' : st === 'pending' ? 'text-amber-400' : 'text-red-400'}`}>
                    {allUsers.filter((u) => u.status === st).length}
                  </span>
                </div>
              ))}
            </div>

            {allUsers.length === 0 ? (
              <div className="p-8 bg-slate-900/20 rounded-2xl text-center text-slate-600 border border-slate-900">No registered users yet.</div>
            ) : (
              <div className="space-y-2.5">
                {allUsers.map((u) => (
                  <div key={u.id} className="bg-slate-900/30 rounded-2xl p-4 border border-slate-900 space-y-2.5">
                    <div className="flex justify-between items-start">
                      <div className="min-w-0">
                        <span className="font-bold text-white block truncate">{fullName(u)}</span>
                        <span className="text-[11px] text-indigo-400 font-mono flex items-center space-x-1 mt-0.5 truncate">
                          <Mail className="w-3 h-3 shrink-0" /><span className="truncate">{u.email}</span>
                        </span>
                      </div>
                      <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full border shrink-0 ${statusBadge(u.status)}`}>{u.status}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-400">
                      <span className="flex items-center space-x-1.5"><GraduationCap className="w-3.5 h-3.5 text-slate-500 shrink-0" /><span className="truncate">{u.highest_qualification || '—'}</span></span>
                      <span className="flex items-center space-x-1.5"><Languages className="w-3.5 h-3.5 text-slate-500 shrink-0" /><span className="truncate">{u.english_proficiency || '—'}</span></span>
                      <span className="flex items-center space-x-1.5"><Globe className="w-3.5 h-3.5 text-slate-500 shrink-0" /><span className="truncate">{u.country || '—'}</span></span>
                      <span className="flex items-center space-x-1.5 font-mono text-emerald-400/80">${parseFloat(u.wallet_balance_usd || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-slate-800/50">
                      <span className="text-[10px] text-slate-600 font-mono">Joined {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</span>
                      {u.status === 'pending' && (
                        <div className="flex space-x-1.5">
                          <button onClick={() => handleReviewRegistration(u.id, 'reject')} className="px-2.5 py-1 bg-red-950/20 text-red-400 hover:bg-red-950/30 border border-red-950/30 text-[9px] font-black rounded uppercase tracking-wider">Reject</button>
                          <button onClick={() => handleReviewRegistration(u.id, 'approve')} className="px-2.5 py-1 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-950/30 border border-emerald-950/30 text-[9px] font-black rounded uppercase tracking-wider">Approve</button>
                        </div>
                      )}
                      {u.status === 'approved' && (
                        <button onClick={() => handleReviewRegistration(u.id, 'reject')} className="px-2.5 py-1 bg-slate-800 text-slate-400 hover:bg-red-950/30 hover:text-red-400 border border-slate-700 text-[9px] font-black rounded uppercase tracking-wider">Revoke</button>
                      )}
                      {u.status === 'rejected' && (
                        <button onClick={() => handleReviewRegistration(u.id, 'approve')} className="px-2.5 py-1 bg-slate-800 text-slate-400 hover:bg-emerald-950/30 hover:text-emerald-400 border border-slate-700 text-[9px] font-black rounded uppercase tracking-wider">Approve</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* BOOKS */}
        {activeTab === 'books' && (
          <div className="space-y-6">
            <div className="bg-slate-900/30 p-5 rounded-2xl border border-slate-900 space-y-4">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <BookOpen className="w-5 h-5 text-indigo-400" />
                <span>Add a Book (PDF / EPUB / Text)</span>
              </h3>

              {bookError && (
                <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-xs text-red-300 flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{bookError}</span>
                </div>
              )}
              {bookSuccess && (
                <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-xs text-emerald-300">{bookSuccess}</div>
              )}
              {fileParsingStep && (
                <div className="p-3 bg-indigo-950/40 border border-indigo-500/30 rounded-xl text-xs text-indigo-300 flex items-center space-x-2">
                  <span className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" /><span>{fileParsingStep}</span>
                </div>
              )}

              <form onSubmit={handleUploadBook} className="space-y-4">
                <div className="space-y-1">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">Book File (PDF or EPUB)</label>
                  <div className="border-2 border-dashed border-slate-800 hover:border-indigo-500/30 rounded-xl p-5 text-center cursor-pointer transition-colors relative">
                    <input type="file" accept=".pdf,.epub" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    <UploadCloud className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    {selectedFile ? (
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-indigo-400 truncate">{selectedFile.name}</p>
                        <p className="text-[10px] text-slate-500 font-mono">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Ready</p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs font-bold text-slate-300">Select a PDF or EPUB file</p>
                        <p className="text-[10px] text-slate-500 mt-1">We extract the text and split it into pages automatically</p>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Book Title</label>
                  <input type="text" required value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} placeholder="e.g., Pride and Prejudice" className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500" />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Skip first N pages</label>
                  <input type="number" min="0" step="1" value={skipPages} onChange={(e) => setSkipPages(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500" />
                  <p className="text-[10px] text-slate-500 mt-1">Drops the first N pages after parsing (cover, table of contents, author's note) so contributors never record them. Leave at 0 to keep everything.</p>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Book Text (optional if a file is uploaded)</label>
                  <textarea rows={5} value={bookText} onChange={(e) => setBookText(e.target.value)} placeholder="Paste the book text here, or leave blank to auto-extract from the uploaded file." className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500 font-serif" />
                </div>

                <button type="submit" disabled={uploadingBook} className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-black uppercase tracking-wider text-xs rounded-xl">
                  {uploadingBook ? 'Processing…' : 'Add Book'}
                </button>
              </form>
            </div>

            <div className="space-y-2">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Library ({books.length})</h4>
              <div className="space-y-2">
                {books.map((book) => (
                  <div key={book.id} className="bg-slate-900/20 p-3.5 rounded-xl border border-slate-900 flex justify-between items-center text-xs">
                    <div>
                      <span className="font-bold text-slate-200 block">{book.title}</span>
                      <span className="text-[10px] text-slate-500 mt-0.5 block">{book.total_pages} pages • {book.calculated_minutes} min cap</span>
                    </div>
                    <span className="text-[10px] bg-indigo-950/20 text-indigo-400 px-2 py-0.5 rounded border border-indigo-900/20 font-bold uppercase tracking-wider font-mono">Active</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* REVIEW QUEUE */}
        {activeTab === 'review' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Pending Recordings</h3>
              {reviewSuccess && <span className="text-xs text-emerald-400 font-bold">{reviewSuccess}</span>}
            </div>
            {reviewError && <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-xs text-red-300">{reviewError}</div>}

            <div className="space-y-3">
              {recordings.filter((r) => r.status === 'pending').length === 0 ? (
                <div className="p-8 bg-slate-900/20 rounded-2xl text-center text-slate-600 border border-slate-900">Review queue is empty.</div>
              ) : (
                recordings.filter((r) => r.status === 'pending').map((rec) => {
                  const currentPages = partialPages[rec.id] ?? String(rec.pages_recorded || 1);
                  return (
                    <div key={rec.id} className="bg-slate-900/30 rounded-2xl p-4.5 border border-slate-900 space-y-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-bold text-white block truncate max-w-[200px]">{rec.books?.title}</span>
                          <span className="text-[10px] text-indigo-400 block font-mono mt-0.5">{rec.profiles?.email}</span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono text-right">
                          {Math.round(rec.duration_seconds)}s
                          <span className="block">{rec.pages_recorded || 1} page(s)</span>
                        </span>
                      </div>

                      <div className="bg-slate-950 p-2 rounded-xl border border-slate-800 space-y-1.5">
                        <audio src={rec.audio_url} controls preload="metadata" className="w-full h-8" />
                        <a href={rec.audio_url} target="_blank" rel="noreferrer" download className="text-[9px] text-slate-500 hover:text-indigo-400 flex items-center space-x-1 font-mono">
                          <Download className="w-3 h-3" /><span>Open / download audio</span>
                        </a>
                      </div>

                      <div className="space-y-3 pt-3 border-t border-slate-900">
                        <div className="flex items-center justify-between space-x-2">
                          <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider">Approved pages (${ratePerPage}/page)</label>
                          <input type="number" min="0" step="1" value={currentPages} onChange={(e) => setPartialPages({ ...partialPages, [rec.id]: e.target.value })} className="w-16 px-2 py-1 bg-slate-950 border border-slate-800 rounded text-xs text-center font-bold text-white" />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <button onClick={() => handleReviewRecording(rec.id, 'rejected', 0)} className="py-2 bg-red-950/20 text-red-400 hover:bg-red-950/30 border border-red-950/30 text-[10px] font-black rounded-lg uppercase tracking-wider">Reject</button>
                          <button onClick={() => handleReviewRecording(rec.id, 'partially_approved', parseInt(currentPages))} className="py-2 bg-indigo-950/20 text-indigo-400 hover:bg-indigo-950/30 border border-indigo-950/30 text-[10px] font-black rounded-lg uppercase tracking-wider">Partial</button>
                          <button onClick={() => handleReviewRecording(rec.id, 'approved', parseInt(currentPages))} className="py-2 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-950/30 border border-emerald-950/30 text-[10px] font-black rounded-lg uppercase tracking-wider">Approve</button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* WITHDRAWALS */}
        {activeTab === 'withdrawals' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Pending Payouts</h3>
              {withdrawSuccess && <span className="text-xs text-emerald-400 font-bold">{withdrawSuccess}</span>}
            </div>
            {withdrawError && <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-xs text-red-300">{withdrawError}</div>}

            <div className="space-y-3">
              {withdrawals.filter((w) => w.status === 'pending').length === 0 ? (
                <div className="p-8 bg-slate-900/20 rounded-2xl text-center text-slate-600 border border-slate-900">No pending withdrawal requests.</div>
              ) : (
                withdrawals.filter((w) => w.status === 'pending').map((w) => (
                  <div key={w.id} className="bg-slate-900/30 rounded-2xl p-4.5 border border-slate-900 space-y-3.5">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-extrabold text-white text-base block">${parseFloat(w.amount).toFixed(2)} USD</span>
                        <span className="text-[10px] text-indigo-400 block font-mono mt-0.5">{w.profiles?.email}</span>
                      </div>
                      <span className="text-[9px] font-black bg-slate-950 px-2.5 py-1 rounded text-slate-400 border border-slate-800 tracking-wider">POLYGON</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-black text-slate-500 uppercase block mb-1 tracking-wider">Destination address</span>
                      <span className="text-xs bg-slate-950 p-3 rounded-xl font-mono text-slate-300 block select-all break-all border border-slate-800">{w.polygon_address}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      <button onClick={() => handleReviewWithdrawal(w.id, 'rejected')} className="py-2.5 bg-red-950/20 text-red-400 hover:bg-red-950/30 border border-red-950/30 text-xs font-black rounded-xl uppercase flex items-center justify-center space-x-1">
                        <X className="w-4 h-4" /><span>Reject & Refund</span>
                      </button>
                      <button onClick={() => handleReviewWithdrawal(w.id, 'approved')} className="py-2.5 bg-emerald-950/30 text-emerald-400 hover:bg-emerald-950/40 border border-emerald-950/30 text-xs font-black rounded-xl uppercase flex items-center justify-center space-x-1">
                        <Check className="w-4 h-4" /><span>Mark Paid</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* SETTINGS */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="bg-slate-900/30 p-5 rounded-2xl border border-slate-900 space-y-5">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Settings className="w-5 h-5 text-indigo-400" /><span>Platform Settings</span>
              </h3>

              {settingsSuccess && <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-xs text-emerald-300">{settingsSuccess}</div>}
              {settingsError && <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-xs text-red-300">{settingsError}</div>}

              <form onSubmit={handleSaveSettings} className="space-y-5">
                {/* Registration mode */}
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2">Registration Mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['auto', 'manual'].map((mode) => (
                      <button
                        type="button"
                        key={mode}
                        onClick={() => setRegistrationMode(mode)}
                        className={`py-2.5 rounded-xl text-xs font-black uppercase tracking-wider border transition-colors ${
                          registrationMode === mode
                            ? 'bg-indigo-600 text-white border-indigo-500'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
                    <strong>Auto:</strong> everyone who signs up with Google is approved instantly.{' '}
                    <strong>Manual:</strong> new users wait in the approvals queue until you approve them.
                  </p>
                </div>

                {/* Rate per page */}
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Earnings Rate Per Page (USD)</label>
                  <input type="number" min="0" step="0.001" required value={ratePerPage} onChange={(e) => setRatePerPage(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-bold focus:outline-none focus:border-indigo-500" />
                  <p className="text-[10px] text-slate-500 mt-1">Users earn this amount per approved page.</p>
                </div>

                {/* Signup bonus */}
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Signup Bonus (USD)</label>
                  <input type="number" min="0" step="0.01" required value={signupBonus} onChange={(e) => setSignupBonus(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-bold focus:outline-none focus:border-indigo-500" />
                  <p className="text-[10px] text-amber-500/70 mt-1 leading-relaxed">
                    Credited once when a user is approved. Keep at $0 unless you use manual approval — a bonus with auto-registration can be farmed with throwaway Google accounts.
                  </p>
                </div>

                <button type="submit" disabled={savingSettings} className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-black uppercase tracking-wider text-xs rounded-xl">
                  {savingSettings ? 'Saving…' : 'Save Settings'}
                </button>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
