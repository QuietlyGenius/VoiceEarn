import supabase from './db-client.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { book_id, current_page } = req.body;
    if (!book_id || !current_page) {
      return res.status(400).json({ error: 'Book ID and current page are required' });
    }

    // Read the current bookmark so we can keep it monotonic (forward-only):
    // Supabase upsert overwrites the columns you give it and can't express
    // "take the larger page" on its own, so we compute the furthest page here.
    const { data: existingRows, error: findError } = await supabase
      .from('user_book_progress')
      .select('current_page')
      .eq('user_id', user.id)
      .eq('book_id', book_id);

    if (findError) throw findError;

    const furthest = Math.max(
      parseInt(current_page, 10) || 0,
      ...(existingRows || []).map((r) => parseInt(r.current_page, 10) || 0)
    );

    // Atomic insert-or-update on the (user_id, book_id) unique key. This removes
    // the find-then-insert race entirely — concurrent first-time saves resolve
    // via ON CONFLICT DO UPDATE instead of erroring on the unique constraint.
    const { data, error } = await supabase
      .from('user_book_progress')
      .upsert(
        { user_id: user.id, book_id, current_page: furthest, updated_at: new Date() },
        { onConflict: 'user_id,book_id' }
      )
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json(data);
  } catch (err) {
    console.error('Progress API error:', err);
    res.status(500).json({ error: err.message });
  }
}
