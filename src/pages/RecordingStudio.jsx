import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { uploadToBucket } from '../lib/uploadFile';
import {
  Mic, Square, ChevronLeft, ChevronRight, AlertTriangle,
  CheckCircle, AudioLines, ArrowLeft, Type, Palette, X, Pause, Play, ScrollText,
  Info, Volume2, Headphones, Trash2
} from 'lucide-react';

const MAX_SECONDS = 600; // fixed 10-minute session cap

// Split page text into sentences so the reading guide can highlight a natural
// 2-3 line unit rather than a single word.
function splitSentences(text) {
  if (!text) return [];
  const matched = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g);
  return (matched || [text]).map((s) => s.trim()).filter(Boolean);
}

export default function RecordingStudio() {
  const { id: bookId } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();

  const [book, setBook] = useState(null);
  const [pages, setPages] = useState([]);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  // Reading display options
  const [fontSize, setFontSize] = useState('text-2xl');
  const [themeMode, setThemeMode] = useState('dark');

  // Modals
  const [showInstructions, setShowInstructions] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  // Instructions are shown once per session; after that "Start" records directly.
  const [instructionsAck, setInstructionsAck] = useState(false);

  // Reading guide + auto-scroll
  const [activeSentence, setActiveSentence] = useState(0);
  const [autoScroll, setAutoScroll] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(45); // px/sec
  const readerRef = useRef(null);
  const sentenceRefs = useRef([]);
  const scrollTickRef = useRef(false);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  const [micError, setMicError] = useState('');

  // Submission state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const sessionStartPageIdxRef = useRef(0);

  // Visualizer
  const canvasRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);

  useEffect(() => {
    const fetchBookAndPages = async () => {
      try {
        setLoading(true);
        const headers = { Authorization: `Bearer ${session.access_token}` };
        // A single request returns the book, its pages, and the saved page.
        const res = await fetch(`/api/books?bookId=${bookId}`, { headers });
        if (!res.ok) throw new Error('Failed to load book');
        const data = await res.json();
        setBook(data.book);
        setPages(data.pages);

        const idx = data.pages.findIndex((p) => p.page_number === (data.book?.current_page || 1));
        setCurrentPageIdx(idx >= 0 ? idx : 0);
      } catch (err) {
        console.error('Error loading book details:', err);
      } finally {
        setLoading(false);
      }
    };
    if (session) fetchBookAndPages();
  }, [bookId, session]);

  // ---- Visualizer ----
  const startVisualizer = (stream) => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      audioContext.createMediaStreamSource(stream).connect(analyser);
      analyser.fftSize = 64;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const draw = () => {
        if (!canvasRef.current || !analyserRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const { width, height } = canvas;
        animationFrameRef.current = requestAnimationFrame(draw);
        analyserRef.current.getByteFrequencyData(dataArray);
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, width, height);
        const barWidth = (width / dataArray.length) * 1.5;
        let x = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const barHeight = dataArray[i] / 2.5;
          const gradient = ctx.createLinearGradient(0, height, 0, 0);
          gradient.addColorStop(0, '#4f46e5');
          gradient.addColorStop(1, '#ec4899');
          ctx.fillStyle = gradient;
          ctx.fillRect(x, height - barHeight, barWidth - 2, barHeight);
          x += barWidth;
        }
      };
      draw();
    } catch (err) {
      console.warn('Visualizer unavailable:', err);
    }
  };

  const stopVisualizer = () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (audioContextRef.current) audioContextRef.current.close();
    audioContextRef.current = null;
    analyserRef.current = null;
  };

  const requestMicPermission = async () => {
    try {
      setMicError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermissionGranted(true);
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      console.error('Microphone access error:', err);
      setMicError('Microphone permission denied. Please allow mic access in your browser settings.');
      setMicPermissionGranted(false);
    }
  };

  useEffect(() => {
    requestMicPermission();
    return () => stopVisualizer();
  }, []);

  // ---- Timer (pauses when recording is paused) ----
  useEffect(() => {
    if (isRecording && !isPaused) {
      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev >= MAX_SECONDS) { stopRecording(); return MAX_SECONDS; }
          return prev + 1;
        });
      }, 1000);
    } else if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }
    return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
  }, [isRecording, isPaused]);

  // ---- Reading content ----
  // Page content preserves structure: paragraphs are separated by blank lines
  // and headings are marked with a leading "## ". We render headings as blocks
  // and split paragraphs into sentences (each gets a global index so the
  // reading-guide highlight can track a natural 2-3 line unit).
  const currentPage = pages[currentPageIdx];
  const blocks = useMemo(() => {
    const raw = (currentPage?.content || '').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
    let idx = 0;
    return raw.map((b) => {
      if (b.startsWith('## ')) return { type: 'heading', text: b.slice(3).trim() };
      const sentences = splitSentences(b).map((text) => ({ text, i: idx++ }));
      return { type: 'para', sentences };
    });
  }, [currentPage]);

  // Reset reading position when the page changes.
  useEffect(() => {
    setActiveSentence(0);
    setAutoScroll(false);
    sentenceRefs.current = [];
    if (readerRef.current) readerRef.current.scrollTop = 0;
  }, [currentPageIdx]);

  // Highlight the sentence nearest the reading guide line as the reader scrolls.
  const updateActiveSentence = useCallback(() => {
    const container = readerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const guideY = rect.top + container.clientHeight * 0.35;
    let best = 0;
    let bestDist = Infinity;
    sentenceRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const center = (r.top + r.bottom) / 2;
      const dist = Math.abs(center - guideY);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    setActiveSentence(best);
  }, []);

  const handleScroll = () => {
    if (scrollTickRef.current) return;
    scrollTickRef.current = true;
    requestAnimationFrame(() => { updateActiveSentence(); scrollTickRef.current = false; });
  };

  // Auto-scroll teleprompter.
  useEffect(() => {
    if (!autoScroll) return;
    let raf;
    let last = performance.now();
    const step = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      const c = readerRef.current;
      if (c) {
        c.scrollTop += scrollSpeed * dt;
        updateActiveSentence();
        if (c.scrollTop + c.clientHeight >= c.scrollHeight - 2) { setAutoScroll(false); return; }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [autoScroll, scrollSpeed, updateActiveSentence]);

  const jumpToSentence = (i) => {
    setActiveSentence(i);
    const el = sentenceRefs.current[i];
    const c = readerRef.current;
    if (el && c) {
      const offset = el.offsetTop - c.clientHeight * 0.35;
      c.scrollTo({ top: offset, behavior: 'smooth' });
    }
  };

  // ---- Recording ----
  // "Start" opens the instructions modal first; beginRecording runs on confirm.
  const beginRecording = async () => {
    setShowInstructions(false);
    setInstructionsAck(true);
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl('');
    setRecordingSeconds(0);
    setUploadSuccess(false);
    setUploadError('');
    setIsPaused(false);
    audioChunksRef.current = [];
    sessionStartPageIdxRef.current = currentPageIdx;

    try {
      // Voice-optimised capture: mono + browser DSP (echo cancel / noise
      // suppression / auto gain) gives clean speech at a fraction of the size.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      setMicPermissionGranted(true);
      startVisualizer(stream);

      // Opus at 48 kbps mono is transparent for spoken voice yet ~4-5x smaller
      // than the browser default (which was producing ~2.5 MB for 2 minutes).
      let options = { mimeType: 'audio/webm', audioBitsPerSecond: 48000 };
      if (!MediaRecorder.isTypeSupported('audio/webm')) options = { mimeType: 'audio/ogg', audioBitsPerSecond: 48000 };
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: options.mimeType });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
        stopVisualizer();
      };

      recorder.start(1000);
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
      setMicError('Could not start recording. Please verify microphone permission.');
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording && !isPaused) {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && isRecording && isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
    }
  };

  // Opens the in-app confirmation modal (replaces the native browser confirm).
  const requestCancel = () => setShowCancelModal(true);

  const confirmCancel = () => {
    setShowCancelModal(false);
    if (mediaRecorderRef.current && isRecording) mediaRecorderRef.current.stop();
    setIsRecording(false);
    setIsPaused(false);
    setAudioBlob(null);
    setAudioUrl('');
    setRecordingSeconds(0);
    setUploadError('');
    setUploadSuccess(false);
    stopVisualizer();
    navigate('/dashboard');
  };

  const handlePageChange = async (newIdx) => {
    if (newIdx < 0 || newIdx >= pages.length) return;
    setCurrentPageIdx(newIdx);
    try {
      await fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ book_id: parseInt(bookId), current_page: pages[newIdx].page_number })
      });
    } catch (err) {
      console.error('Error saving reading progress:', err);
    }
  };

  const uploadRecording = async () => {
    if (!audioBlob) return;
    setIsUploading(true);
    setUploadError('');
    setUploadSuccess(false);
    try {
      // Sends bytes directly to Storage in production (no serverless size limit).
      const audioUrlUploaded = await uploadToBucket({
        file: audioBlob,
        fileName: `recording_${bookId}.webm`,
        contentType: audioBlob.type,
        bucketName: 'audio-recordings',
        accessToken: session.access_token
      });

      const pagesRecorded = Math.abs(currentPageIdx - sessionStartPageIdxRef.current) + 1;
      const submitRes = await fetch('/api/recordings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          book_id: parseInt(bookId),
          audio_url: audioUrlUploaded,
          duration_seconds: recordingSeconds,
          pages_recorded: pagesRecorded
        })
      });
      if (!submitRes.ok) {
        const err = await submitRes.text();
        let msg;
        try { msg = JSON.parse(err).error; } catch { msg = err; }
        throw new Error(msg || 'Failed to submit recording');
      }

      setUploadSuccess(true);
      setIsUploading(false);

      const nextIdx = currentPageIdx + 1;
      if (nextIdx < pages.length) {
        // Auto-advance to the next page so contributors read straight through
        // the book instead of re-recording the page they just finished.
        setTimeout(() => {
          handlePageChange(nextIdx);
          setAudioBlob(null);
          if (audioUrl) URL.revokeObjectURL(audioUrl);
          setAudioUrl('');
          setRecordingSeconds(0);
          setUploadSuccess(false);
          setUploadError('');
          sessionStartPageIdxRef.current = nextIdx;
        }, 1200);
      } else {
        // Finished the final page — head back to the dashboard.
        setTimeout(() => navigate('/dashboard'), 1600);
      }
    } catch (err) {
      console.error('Upload failed:', err);
      setUploadError(err.message || 'Network error during submission. Please try again.');
      setIsUploading(false);
    }
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh bg-slate-950">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="mt-4 text-slate-400 font-medium text-sm">Preparing your reading room…</p>
      </div>
    );
  }

  const themeClasses = {
    dark: 'bg-slate-950 text-slate-200',
    sepia: 'bg-amber-50 text-amber-950',
    light: 'bg-white text-slate-950'
  };
  const readerText = themeMode === 'sepia' ? 'text-amber-950/80' : themeMode === 'light' ? 'text-slate-700' : 'text-slate-400';
  const activeText = themeMode === 'dark' ? 'text-white' : 'text-black';
  const activeBg = themeMode === 'sepia' ? 'bg-amber-500/25' : themeMode === 'light' ? 'bg-indigo-500/15' : 'bg-indigo-500/25';

  return (
    <div className={`h-dvh flex flex-col overflow-hidden ${themeClasses[themeMode]}`}>
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800/80 px-4 py-3 shrink-0 flex items-center justify-between">
        <div className="flex items-center space-x-2 min-w-0">
          <button onClick={requestCancel} aria-label="Back to dashboard" className="flex items-center space-x-1 pl-1.5 pr-2.5 py-2 text-slate-300 hover:text-white rounded-xl bg-slate-800/70 hover:bg-slate-800 border border-slate-700/60 shrink-0">
            <ArrowLeft className="w-5 h-5" />
            <span className="text-[11px] font-bold">Back</span>
          </button>
          <div className="min-w-0">
            <span className="text-[9px] uppercase font-black text-indigo-400 block tracking-widest font-mono">Reading Room</span>
            <span className="font-extrabold text-sm truncate block text-white">{book?.title}</span>
          </div>
        </div>
        <div className="flex items-center space-x-1.5 shrink-0">
          <button onClick={() => setThemeMode((p) => (p === 'dark' ? 'sepia' : p === 'sepia' ? 'light' : 'dark'))} className="p-2.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800" title="Toggle theme">
            <Palette className="w-5 h-5" />
          </button>
          <button onClick={() => setFontSize((p) => (p === 'text-lg' ? 'text-xl' : p === 'text-xl' ? 'text-2xl' : p === 'text-2xl' ? 'text-3xl' : 'text-lg'))} className="p-2.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800" title="Font size">
            <Type className="w-5 h-5" />
          </button>
          <span className="bg-indigo-950 text-indigo-300 text-[9px] font-black px-2.5 py-1 rounded-md border border-indigo-900 uppercase font-mono whitespace-nowrap">
            {currentPageIdx + 1}/{pages.length}
          </span>
        </div>
      </header>

      {/* Reading pane (scrolls inside its own box) */}
      <div ref={readerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-md mx-auto">
          {currentPage ? (
            <div className={`font-serif leading-loose transition-all duration-200 ${fontSize}`}>
              {blocks.map((blk, bi) =>
                blk.type === 'heading' ? (
                  <h3 key={bi} className={`font-black leading-snug mt-7 mb-3 first:mt-0 ${activeText}`}>
                    {blk.text}
                  </h3>
                ) : (
                  <p key={bi} className="mb-5 text-justify">
                    {blk.sentences.map((s) => (
                      <span
                        key={s.i}
                        ref={(el) => (sentenceRefs.current[s.i] = el)}
                        onClick={() => jumpToSentence(s.i)}
                        className={`cursor-pointer rounded px-0.5 transition-colors duration-200 ${
                          s.i === activeSentence ? `${activeBg} ${activeText} font-medium` : readerText
                        }`}
                      >
                        {s.text}{' '}
                      </span>
                    ))}
                  </p>
                )
              )}
            </div>
          ) : (
            <p className="text-slate-500 text-center italic">This book has no pages loaded.</p>
          )}
          {/* trailing space so the last sentence can scroll up to the guide line */}
          <div className="h-[35vh]" />
        </div>
      </div>

      {/* Reading assist + page nav */}
      <div className="shrink-0 bg-slate-900/40 border-t border-slate-800/60">
        <div className="max-w-md mx-auto px-4 py-2.5 space-y-2.5">
          {/* Auto-scroll teleprompter */}
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setAutoScroll((v) => !v)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-colors ${
                autoScroll ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
            >
              <ScrollText className="w-3.5 h-3.5" />
              <span>{autoScroll ? 'Auto-scroll on' : 'Auto-scroll'}</span>
            </button>
            <div className="flex-1 flex items-center space-x-2">
              <span className="text-[9px] font-black uppercase text-slate-500">Speed</span>
              <input
                type="range"
                min="15"
                max="140"
                value={scrollSpeed}
                onChange={(e) => setScrollSpeed(Number(e.target.value))}
                className="flex-1 accent-indigo-500 h-1"
              />
            </div>
          </div>

          {/* Page navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => handlePageChange(currentPageIdx - 1)}
              disabled={currentPageIdx === 0}
              className="flex items-center space-x-1 text-xs font-bold px-3 py-2 bg-slate-900/60 text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-slate-900/60 rounded-xl border border-slate-800/40 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /><span>Prev</span>
            </button>
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
              Page {currentPageIdx + 1} of {pages.length}
            </span>
            <button
              onClick={() => handlePageChange(currentPageIdx + 1)}
              disabled={currentPageIdx === pages.length - 1}
              className="flex items-center space-x-1 text-xs font-bold px-3 py-2 bg-slate-900/60 text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-slate-900/60 rounded-xl border border-slate-800/40 transition-colors"
            >
              <span>Next</span><ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Recording controls */}
      <footer className="bg-slate-900 border-t border-slate-800/60 p-4 shrink-0 space-y-3">
        {micError && (
          <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl flex items-center space-x-2 text-xs text-red-300">
            <AlertTriangle className="w-4 h-4 shrink-0" /><span>{micError}</span>
            <button onClick={requestMicPermission} className="underline ml-auto">Retry</button>
          </div>
        )}
        {uploadError && (
          <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl flex items-start space-x-2 text-xs text-red-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div><p className="font-bold">Submission failed</p><p className="text-[11px] mt-0.5">{uploadError}</p></div>
          </div>
        )}
        {uploadSuccess && (
          <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl flex items-center space-x-2 text-xs text-emerald-300">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>
              {currentPageIdx < pages.length - 1
                ? `Page ${currentPageIdx + 1} submitted! Opening page ${currentPageIdx + 2}…`
                : 'Final page submitted! Returning to your dashboard…'}
            </span>
          </div>
        )}

        {/* Visualizer + timer */}
        <div className="flex items-center space-x-3">
          <div className="relative h-9 flex-1 bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center">
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" width={300} height={36} />
            {!isRecording && !audioUrl && <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest relative z-10 font-mono">Ready</span>}
            {audioUrl && !isRecording && <span className="text-[10px] text-emerald-400 uppercase font-black tracking-widest relative z-10 font-mono">Recorded</span>}
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <div className={`w-2.5 h-2.5 rounded-full ${isRecording && !isPaused ? 'bg-red-500 animate-pulse' : isPaused ? 'bg-amber-400' : 'bg-slate-600'}`} />
            <span className="font-mono text-xs font-black text-slate-300">{formatTime(recordingSeconds)}/10:00</span>
          </div>
        </div>

        {/* Controls */}
        {!isRecording && !audioUrl && (
          <button onClick={() => (instructionsAck ? beginRecording() : setShowInstructions(true))} disabled={!micPermissionGranted || isUploading} className="w-full py-4 bg-red-600 hover:bg-red-700 disabled:bg-slate-800 disabled:text-slate-600 text-white font-black uppercase tracking-wider text-base rounded-2xl flex items-center justify-center space-x-2 shadow-lg shadow-red-900/20">
            <Mic className="w-5 h-5" /><span>Record page {currentPageIdx + 1}</span>
          </button>
        )}

        {isRecording && (
          <div className="flex space-x-2.5">
            <button onClick={requestCancel} className="flex-1 py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-black uppercase tracking-wider text-xs rounded-2xl flex items-center justify-center space-x-1.5 border border-slate-700">
              <X className="w-4 h-4" /><span>Cancel</span>
            </button>
            {isPaused ? (
              <button onClick={resumeRecording} className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-wider text-xs rounded-2xl flex items-center justify-center space-x-1.5">
                <Play className="w-4 h-4" /><span>Resume</span>
              </button>
            ) : (
              <button onClick={pauseRecording} className="flex-1 py-3.5 bg-amber-500/90 hover:bg-amber-500 text-slate-950 font-black uppercase tracking-wider text-xs rounded-2xl flex items-center justify-center space-x-1.5">
                <Pause className="w-4 h-4" /><span>Pause</span>
              </button>
            )}
            <button onClick={stopRecording} className="flex-1 py-3.5 bg-slate-100 hover:bg-white text-slate-900 font-black uppercase tracking-wider text-xs rounded-2xl flex items-center justify-center space-x-1.5">
              <Square className="w-4 h-4 fill-slate-900" /><span>Finish</span>
            </button>
          </div>
        )}

        {audioUrl && !isRecording && (
          <div className="space-y-3">
            <div className="flex items-center justify-center space-x-1.5">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-black uppercase tracking-wider text-emerald-400">Recording ready — review &amp; submit</span>
            </div>
            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <audio src={audioUrl} controls className="w-full" />
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <button onClick={requestCancel} disabled={isUploading} className="py-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-black uppercase tracking-wider text-xs rounded-2xl flex items-center justify-center space-x-1.5 border border-slate-700">
                <Trash2 className="w-4 h-4" /><span>Discard</span>
              </button>
              <button onClick={uploadRecording} disabled={isUploading} className="col-span-2 py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-black uppercase tracking-wider text-sm rounded-2xl flex items-center justify-center space-x-2 shadow-lg shadow-emerald-900/30">
                {isUploading ? (
                  <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /><span>Submitting…</span></>
                ) : (
                  <><CheckCircle className="w-5 h-5" /><span>Submit for review</span></>
                )}
              </button>
            </div>
          </div>
        )}

        {isRecording && (
          <div className="flex items-center justify-center space-x-1.5">
            <AudioLines className={`w-3.5 h-3.5 ${isPaused ? 'text-amber-400' : 'text-red-400 animate-bounce'}`} />
            <span className={`text-[9px] uppercase font-black tracking-wider font-mono ${isPaused ? 'text-amber-400' : 'text-red-400'}`}>
              {isPaused ? 'Paused' : 'Recording'}
            </span>
          </div>
        )}
      </footer>

      {/* Pre-recording instructions modal */}
      {showInstructions && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 bg-indigo-500/10 rounded-xl text-indigo-400"><Info className="w-5 h-5" /></div>
              <h3 className="text-lg font-black text-white">Before you record</h3>
            </div>
            <p className="text-sm text-slate-400">Please read carefully — following these keeps your recording payable.</p>

            <ul className="space-y-3 text-sm">
              <li className="flex items-start space-x-2.5 text-slate-300"><Volume2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" /><span>Record in a <strong className="text-white">quiet place</strong> with no background noise, echo, TV or traffic.</span></li>
              <li className="flex items-start space-x-2.5 text-slate-300"><Headphones className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" /><span>Use <strong className="text-white">earphones with a mic</strong> for the clearest audio.</span></li>
              <li className="flex items-start space-x-2.5 text-slate-300"><Mic className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" /><span>Read <strong className="text-white">every word clearly</strong> and at a steady pace. Don't skip lines.</span></li>
            </ul>

            <div className="p-3.5 bg-red-950/30 border border-red-500/30 rounded-xl space-y-2 text-xs text-red-300">
              <p className="font-black uppercase tracking-wider flex items-center space-x-1.5"><AlertTriangle className="w-3.5 h-3.5" /><span>You will not be paid if</span></p>
              <ul className="space-y-1.5 list-disc list-inside text-red-300/90">
                <li>the audio is unclear, muffled or noisy;</li>
                <li>pages are skipped or not fully read;</li>
                <li>the recording is empty, junk, or not your own voice.</li>
              </ul>
              <p className="text-red-300/80">Rejected recordings earn <strong>nothing</strong> — please don't waste a session.</p>
            </div>

            <div className="flex space-x-2.5 pt-1">
              <button onClick={() => setShowInstructions(false)} className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl">Not now</button>
              <button onClick={beginRecording} className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-wider text-xs rounded-xl flex items-center justify-center space-x-1.5">
                <Mic className="w-4 h-4" /><span>I understand — start</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel/discard confirmation modal (replaces the native browser confirm) */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 bg-red-500/10 rounded-xl text-red-400"><Trash2 className="w-5 h-5" /></div>
              <h3 className="text-lg font-black text-white">Discard recording?</h3>
            </div>
            <p className="text-sm text-slate-400">Your recorded audio will be permanently discarded and you'll return to the dashboard.</p>
            <div className="flex space-x-2.5 pt-1">
              <button onClick={() => setShowCancelModal(false)} className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl">Keep recording</button>
              <button onClick={confirmCancel} className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white font-black uppercase tracking-wider text-xs rounded-xl">Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
