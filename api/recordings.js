import supabase from './db-client.js';
import { isAdminEmail as isAdmin } from '../src/lib/adminEmails.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'GET') {
      const { admin } = req.query;

      if (admin === 'true') {
        // SECURITY: Restrict admin queue views to actual administrators
        if (!isAdmin(user.email)) {
          return res.status(403).json({ error: 'Forbidden: Access denied.' });
        }

        const { data: recordings, error: recError } = await supabase
          .from('recordings')
          .select(`
            *,
            books (title),
            profiles:user_id (email, wallet_balance_usd)
          `)
          .order('created_at', { ascending: false });

        if (recError) throw recError;
        return res.status(200).json(recordings);
      } else {
        // Return only the current user's recordings
        const { data: recordings, error: recError } = await supabase
          .from('recordings')
          .select(`
            *,
            books (title)
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (recError) throw recError;
        return res.status(200).json(recordings);
      }
    }

    if (req.method === 'POST') {
      const { book_id, audio_url, duration_seconds, pages_recorded } = req.body;
      if (!book_id || !audio_url) {
        return res.status(400).json({ error: 'Book ID and audio URL are required' });
      }

      // Input validation
      const duration = parseFloat(duration_seconds);
      if (isNaN(duration) || duration <= 0) {
        return res.status(400).json({ error: 'Invalid recording duration.' });
      }

      const pagesRecorded = parseInt(pages_recorded, 10);

      const { data: recording, error: recError } = await supabase
        .from('recordings')
        .insert({
          user_id: user.id,
          book_id: parseInt(book_id),
          audio_url,
          status: 'pending',
          approved_minutes: 0,
          pages_recorded: !isNaN(pagesRecorded) && pagesRecorded > 0 ? pagesRecorded : 1,
          duration_seconds: duration
        })
        .select()
        .single();

      if (recError) throw recError;
      return res.status(201).json(recording);
    }

    if (req.method === 'PUT') {
      // SECURITY: Reviewing recordings is strictly restricted to authorized admins
      if (!isAdmin(user.email)) {
        return res.status(403).json({ error: 'Forbidden: Only administrators can review recordings.' });
      }

      const { recording_id, status, approved_pages } = req.body;
      if (!recording_id || !status) {
        return res.status(400).json({ error: 'Recording ID and status are required' });
      }

      const recId = parseInt(recording_id);
      const pages = parseFloat(approved_pages || 0);

      // Validate status
      const validStatuses = ['approved', 'rejected', 'partially_approved'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status value.' });
      }

      // Validate pages
      if (isNaN(pages) || pages < 0) {
        return res.status(400).json({ error: 'Approved pages must be zero or greater.' });
      }

      const { data: recording, error: fetchError } = await supabase
        .from('recordings')
        .select('*')
        .eq('id', recId)
        .single();

      if (fetchError) throw fetchError;

      if (recording.status !== 'pending') {
        return res.status(400).json({ error: 'Recording has already been reviewed' });
      }

      const { data: rateSetting } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'rate_per_page')
        .maybeSingle();
      const ratePerPage = parseFloat(rateSetting?.value ?? 0.01);
      const earnings = pages * ratePerPage;

      const { data: updatedRec, error: updateRecError } = await supabase
        .from('recordings')
        .update({
          status,
          approved_minutes: pages
        })
        .eq('id', recId)
        .select()
        .single();

      if (updateRecError) throw updateRecError;

      if ((status === 'approved' || status === 'partially_approved') && earnings > 0) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('wallet_balance_usd')
          .eq('id', recording.user_id)
          .single();

        if (profileError) throw profileError;

        const newBalance = parseFloat(profile.wallet_balance_usd || 0) + earnings;

        const { error: updateProfileError } = await supabase
          .from('profiles')
          .update({ wallet_balance_usd: newBalance })
          .eq('id', recording.user_id);

        if (updateProfileError) throw updateProfileError;
      }

      return res.status(200).json(updatedRec);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Recordings API error:', err);
    res.status(500).json({ error: err.message });
  }
}
