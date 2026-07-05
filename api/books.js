import supabase from './db-client.js';
import { isAdminEmail as isAdmin } from '../src/lib/adminEmails.js';

const WORDS_PER_PAGE = 250;
const READING_WPM = 130; // narration pace; no buffer applied

const wordCount = (s) => s.replace(/##\s?/g, '').split(/\s+/).filter(Boolean).length;

// Splits book text into ~WORDS_PER_PAGE pages while preserving paragraph and
// heading structure. Paragraphs are separated by blank lines; headings are
// marked with a leading "## " (emitted by the file parser). Within a page,
// paragraphs are rejoined with blank lines so the reader can render them.
function paginate(text) {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pages = [];
  let current = [];
  let currentWords = 0;
  const flush = () => {
    if (current.length) { pages.push(current.join('\n\n')); current = []; currentWords = 0; }
  };

  for (const para of paragraphs) {
    const words = para.split(/\s+/);
    if (words.length > WORDS_PER_PAGE) {
      // Oversized paragraph: start a fresh page, then split it into chunks.
      flush();
      for (let i = 0; i < words.length; i += WORDS_PER_PAGE) {
        pages.push(words.slice(i, i + WORDS_PER_PAGE).join(' '));
      }
      continue;
    }
    if (currentWords + words.length > WORDS_PER_PAGE && current.length) flush();
    current.push(para);
    currentWords += words.length;
  }
  flush();
  return pages;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized: No token' });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized: Invalid token' });

    if (req.method === 'GET') {
      const { bookId } = req.query;

      // Single-book view (recording studio): fetch only this book, its pages and
      // this reader's saved page — in parallel — and include current_page so the
      // client needs just this one request (no second /api/books round-trip).
      if (bookId) {
        const id = parseInt(bookId);
        const [bookRes, pagesRes, progRes] = await Promise.all([
          supabase.from('books').select('*').eq('id', id).maybeSingle(),
          supabase.from('book_pages').select('*').eq('book_id', id).order('page_number', { ascending: true }),
          // No maybeSingle: if duplicate progress rows ever exist, maybeSingle
          // errors and we'd silently fall back to page 1 (which then gets
          // written back, wiping progress). Take the furthest page instead.
          supabase.from('user_book_progress').select('current_page').eq('user_id', user.id).eq('book_id', id)
        ]);
        if (bookRes.error) throw bookRes.error;
        if (pagesRes.error) throw pagesRes.error;
        if (!bookRes.data) return res.status(404).json({ error: 'Book not found' });
        // A removed (archived) book can't be opened or recorded, even via a
        // direct link. Admins never hit this — they manage books elsewhere.
        if (bookRes.data.archived && !isAdmin(user.email)) {
          return res.status(410).json({ error: 'This book has been removed and is no longer available.' });
        }
        const savedPage = Math.max(1, ...(progRes.data || []).map((r) => parseInt(r.current_page, 10) || 1));
        return res.status(200).json({
          book: { ...bookRes.data, current_page: savedPage },
          pages: pagesRes.data || []
        });
      }

      // Library list view: all books merged with this user's progress.
      // Removed (archived) books are hidden from readers; admins can include
      // them with ?all=true so they can restore or see them.
      const includeArchived = req.query.all === 'true' && isAdmin(user.email);
      const { data: books, error: booksError } = await supabase
        .from('books')
        .select('*')
        .order('id', { ascending: true });

      if (booksError) throw booksError;

      const visible = includeArchived ? books : books.filter((b) => !b.archived);

      const progressMap = {};
      const { data: progress } = await supabase
        .from('user_book_progress')
        .select('*')
        .eq('user_id', user.id);
      (progress || []).forEach((p) => {
        const pg = parseInt(p.current_page, 10) || 1;
        progressMap[p.book_id] = Math.max(progressMap[p.book_id] || 1, pg);
      });

      return res.status(200).json(visible.map((book) => ({
        ...book,
        current_page: progressMap[book.id] || 1
      })));
    }

    if (req.method === 'POST') {
      // SECURITY: Book creation is restricted to authorized admins only
      if (!isAdmin(user.email)) {
        return res.status(403).json({ error: 'Forbidden: Only administrators can create or upload books.' });
      }

      const { title, text_content, file_url, skip_pages } = req.body;
      if (!title || !text_content) {
        return res.status(400).json({ error: 'Title and content are required' });
      }

      let pagesText = paginate(text_content.trim());

      // Drop leading pages (cover, index, author's note, etc.) if requested, so
      // contributors never record them.
      const skip = Math.max(0, parseInt(skip_pages, 10) || 0);
      if (skip > 0) pagesText = pagesText.slice(skip);
      if (pagesText.length === 0) {
        return res.status(400).json({ error: 'No pages remain after skipping. Reduce the number of skipped pages.' });
      }

      const totalPages = pagesText.length;
      const totalWords = pagesText.reduce((sum, p) => sum + wordCount(p), 0);
      const calculatedMinutes = Math.max(1, Math.ceil(totalWords / READING_WPM));

      const { data: book, error: bookError } = await supabase
        .from('books')
        .insert({
          title: title.trim(),
          file_url: file_url || '',
          total_pages: totalPages,
          calculated_minutes: calculatedMinutes
        })
        .select()
        .single();

      if (bookError) throw bookError;

      const pageRows = pagesText.map((content, idx) => ({
        book_id: book.id,
        page_number: idx + 1,
        content
      }));

      const { error: pagesError } = await supabase
        .from('book_pages')
        .insert(pageRows);

      if (pagesError) throw pagesError;

      return res.status(201).json(book);
    }

    if (req.method === 'PUT') {
      // SECURITY: managing books (lock flag / archive) is admin-only.
      if (!isAdmin(user.email)) {
        return res.status(403).json({ error: 'Forbidden: Only administrators can manage books.' });
      }

      const { book_id, requires_previous, archived } = req.body || {};
      if (!book_id) return res.status(400).json({ error: 'book_id is required' });

      const updates = {};
      if (typeof requires_previous === 'boolean') updates.requires_previous = requires_previous;
      if (typeof archived === 'boolean') updates.archived = archived;
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'Nothing to update.' });
      }

      // NOTE: archiving/unarchiving only hides the book. It never touches
      // book_pages, recordings or user_book_progress — completed work and
      // earnings are preserved and the action is fully reversible.
      const { data, error } = await supabase
        .from('books')
        .update(updates)
        .eq('id', parseInt(book_id))
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json(data);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Books API error:', err);
    res.status(500).json({ error: err.message });
  }
}
