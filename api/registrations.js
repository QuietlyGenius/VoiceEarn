import supabase from './db-client.js';
import { isAdminEmail as isAdmin } from '../src/lib/adminEmails.js';

async function getSetting(key, fallback) {
  const { data } = await supabase.from('settings').select('*').eq('key', key).maybeSingle();
  return data?.value ?? fallback;
}

// Admin-only queue for reviewing users who registered while the platform was in
// manual-approval mode. Approving flips status to 'approved' (and credits the
// signup bonus, if configured); rejecting flips it to 'rejected'.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    if (!isAdmin(user.email)) {
      return res.status(403).json({ error: 'Forbidden: Only administrators can manage registrations.' });
    }

    if (req.method === 'GET') {
      const { status } = req.query;
      let query = supabase.from('profiles').select('*').order('created_at', { ascending: false });
      const { data, error } = await query;
      if (error) throw error;
      const filtered = status ? data.filter((p) => p.status === status) : data;
      return res.status(200).json(filtered);
    }

    if (req.method === 'PUT') {
      const { user_id, action } = req.body || {};
      if (!user_id || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'user_id and a valid action (approve|reject) are required' });
      }

      const { data: profile, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user_id)
        .maybeSingle();
      if (fetchError) throw fetchError;
      if (!profile) return res.status(404).json({ error: 'User not found' });

      const newStatus = action === 'approve' ? 'approved' : 'rejected';

      // Credit the signup bonus only on the pending -> approved transition, once.
      const updates = { status: newStatus };
      if (action === 'approve' && profile.status !== 'approved') {
        const bonus = parseFloat(await getSetting('signup_bonus_usd', '0')) || 0;
        if (bonus > 0) {
          updates.wallet_balance_usd = parseFloat(profile.wallet_balance_usd || 0) + bonus;
        }
      }

      const { data: updated, error: updateError } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user_id)
        .select()
        .single();
      if (updateError) throw updateError;

      return res.status(200).json(updated);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Registrations API error:', err);
    res.status(500).json({ error: err.message });
  }
}
