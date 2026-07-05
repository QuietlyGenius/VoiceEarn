import supabase from './db-client.js';
import { isAdminEmail as isAdmin } from '../src/lib/adminEmails.js';

// Only these keys can be written, with validation, so a compromised or crafted
// request can't inject arbitrary settings.
const ALLOWED_KEYS = {
  rate_per_page: (v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0,
  signup_bonus_usd: (v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0,
  registration_mode: (v) => v === 'auto' || v === 'manual'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // GET is public: settings (pay rate, registration mode, signup bonus) are
    // non-sensitive and the unauthenticated landing page needs the bonus value.
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('settings').select('*');
      if (error) throw error;
      return res.status(200).json(data);
    }

    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'POST') {
      // SECURITY: only admins may change platform settings (pay rate, bonus, mode).
      if (!isAdmin(user.email)) {
        return res.status(403).json({ error: 'Forbidden: Only administrators can change settings.' });
      }

      const { key, value } = req.body || {};
      if (!key || !(key in ALLOWED_KEYS)) {
        return res.status(400).json({ error: 'Unknown or disallowed setting key.' });
      }
      if (!ALLOWED_KEYS[key](value)) {
        return res.status(400).json({ error: `Invalid value for ${key}.` });
      }

      const { data: existing } = await supabase
        .from('settings')
        .select('*')
        .eq('key', key)
        .maybeSingle();

      let result;
      if (existing) {
        const { data, error } = await supabase
          .from('settings')
          .update({ value })
          .eq('key', key)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        const { data, error } = await supabase
          .from('settings')
          .insert({ key, value })
          .select()
          .single();
        if (error) throw error;
        result = data;
      }

      return res.status(200).json(result);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Settings API error:', err);
    res.status(500).json({ error: err.message });
  }
}
