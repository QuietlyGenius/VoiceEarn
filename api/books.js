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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized: No token' });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized: Invalid token' });

    if (req.method === 'GET') {
      const { bookId } = req.query;

      const { data: books, error: booksError } = await supabase
        .from('books')
        .select('*')
        .order('id', { ascending: true });

      if (booksError) throw booksError;

      let progressMap = {};
      const { data: progress, error: progressError } = await supabase
        .from('user_book_progress')
        .select('*')
        .eq('user_id', user.id);

      if (!progressError && progress) {
        progress.forEach(p => {
          progressMap[p.book_id] = p.current_page;
        });
      }

      const booksWithProgress = books.map(book => ({
        ...book,
        current_page: progressMap[book.id] || 1
      }));

      if (bookId) {
        const { data: pages, error: pagesError } = await supabase
          .from('book_pages')
          .select('*')
          .eq('book_id', parseInt(bookId))
          .order('page_number', { ascending: true });

        if (pagesError) throw pagesError;
        return res.status(200).json({ book: books.find(b => b.id == bookId), pages });
      }

      return res.status(200).json(booksWithProgress);
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

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Books API error:', err);
    res.status(500).json({ error: err.message });
  }
}
