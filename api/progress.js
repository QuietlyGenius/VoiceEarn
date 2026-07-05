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

    const { data: existing, error: findError } = await supabase
      .from('user_book_progress')
      .select('*')
      .eq('user_id', user.id)
      .eq('book_id', book_id)
      .maybeSingle();

    if (findError) throw findError;

    let result;
    if (existing) {
      const { data, error } = await supabase
        .from('user_book_progress')
        .update({ current_page, updated_at: new Date() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from('user_book_progress')
        .insert({
          user_id: user.id,
          book_id,
          current_page
        })
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Progress API error:', err);
    res.status(500).json({ error: err.message });
  }
}
