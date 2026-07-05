import supabase from './db-client.js';
import { isAdminEmail as isAdmin } from '../src/lib/adminEmails.js';

// Attach uploader profile info without relying on a PostgREST embed.
// recordings.user_id and profiles.id both reference auth.users(id), so there is
// no direct foreign key between recordings and profiles — an embed like
// `profiles:user_id (...)` fails on the live schema and 500s the whole query
// (which is why the admin queue looked empty). Fetch profiles separately and
// merge in JS so this works regardless of how the FKs are set up.
async function attachProfiles(rows) {
  if (!rows || rows.length === 0) return rows || [];
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  if (ids.length === 0) return rows;
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, wallet_balance_usd')
    .in('id', ids);
  const map = new Map((profiles || []).map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, profiles: map.get(r.user_id) || r.profiles || null }));
}

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
            books (title)
          `)
          .order('created_at', { ascending: false });

        if (recError) throw recError;
        return res.status(200).json(await attachProfiles(recordings));
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
      const { book_id, audio_url, duration_seconds, pages_recorded, start_page, end_page } = req.body;
      if (!book_id || !audio_url) {
        return res.status(400).json({ error: 'Book ID and audio URL are required' });
      }

      // Input validation
      const duration = parseFloat(duration_seconds);
      if (isNaN(duration) || duration <= 0) {
        return res.status(400).json({ error: 'Invalid recording duration.' });
      }

      const pagesRecorded = parseInt(pages_recorded, 10);

      // Refuse recordings for a removed (archived) book. select('*') so this is
      // safe even before the `archived` column exists.
      const { data: bookRow } = await supabase
        .from('books')
        .select('*')
        .eq('id', parseInt(book_id))
        .maybeSingle();
      if (!bookRow) return res.status(404).json({ error: 'Book not found.' });
      if (bookRow.archived) {
        return res.status(410).json({ error: 'This book has been removed; new recordings are closed.' });
      }

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

      // Best-effort: record which pages this clip covered. Separate update so a
      // missing start_page/end_page column can never block submission.
      const sp = parseInt(start_page, 10);
      const ep = parseInt(end_page, 10);
      if (!isNaN(sp) && !isNaN(ep)) {
        const lo = Math.min(sp, ep);
        const hi = Math.max(sp, ep);
        const { error: pgErr } = await supabase
          .from('recordings')
          .update({ start_page: lo, end_page: hi })
          .eq('id', recording.id);
        if (pgErr) console.warn('start/end page not saved (add columns?):', pgErr.message);
        else { recording.start_page = lo; recording.end_page = hi; }
      }

      // Lock in the pay rate at the moment of recording, so a later admin rate
      // change never retroactively alters what this clip is worth — it's paid at
      // this rate on approval and shown at this rate in history. Best-effort and
      // tolerant so a missing rate_per_page column can never block submission.
      const { data: rateNow } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'rate_per_page')
        .maybeSingle();
      const lockedRate = parseFloat(rateNow?.value ?? 0.01);
      if (!isNaN(lockedRate) && lockedRate >= 0) {
        const { error: rErr } = await supabase
          .from('recordings')
          .update({ rate_per_page: lockedRate })
          .eq('id', recording.id);
        if (rErr) console.warn('rate_per_page not saved (add column?):', rErr.message);
        else recording.rate_per_page = lockedRate;
      }

      return res.status(201).json(recording);
    }

    if (req.method === 'PUT') {
      // SECURITY: Reviewing recordings is strictly restricted to authorized admins
      if (!isAdmin(user.email)) {
        return res.status(403).json({ error: 'Forbidden: Only administrators can review recordings.' });
      }

      const { recording_id, status, approved_pages, review_reason } = req.body;
      if (!recording_id) {
        return res.status(400).json({ error: 'Recording ID is required' });
      }

      const recId = parseInt(recording_id);

      const { data: recording, error: fetchError } = await supabase
        .from('recordings')
        .select('*')
        .eq('id', recId)
        .single();

      if (fetchError) throw fetchError;

      // Reason-only update: add/edit the reason on an already-reviewed recording
      // without changing its status or earnings (for existing rejected clips).
      if (!status) {
        const { data, error } = await supabase
          .from('recordings')
          .update({ review_reason: (review_reason ?? '').trim() || null })
          .eq('id', recId)
          .select()
          .single();
        if (error) {
          if (/review_reason/.test(error.message || '')) {
            return res.status(400).json({ error: 'Review reasons need a one-time setup — add the review_reason column (see docs).' });
          }
          throw error;
        }
        return res.status(200).json(data);
      }

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

      if (recording.status !== 'pending') {
        return res.status(400).json({ error: 'Recording has already been reviewed' });
      }

      // Pay using the rate that was locked in when this clip was recorded, so
      // later rate changes never change what an already-recorded clip is worth.
      // Older clips (recorded before rate-locking) fall back to the current rate.
      let ratePerPage = parseFloat(recording.rate_per_page);
      if (isNaN(ratePerPage)) {
        const { data: rateSetting } = await supabase
          .from('settings')
          .select('value')
          .eq('key', 'rate_per_page')
          .maybeSingle();
        ratePerPage = parseFloat(rateSetting?.value ?? 0.01);
      }
      const earnings = pages * ratePerPage;

      // Core review update (status + earnings). The reason is applied in a
      // separate best-effort update below so a missing review_reason column can
      // never block the actual review/payout.
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

      if (review_reason) {
        const { error: reasonErr } = await supabase
          .from('recordings')
          .update({ review_reason: String(review_reason).trim() || null })
          .eq('id', recId);
        if (reasonErr) console.warn('review_reason not saved (add the column?):', reasonErr.message);
        else updatedRec.review_reason = String(review_reason).trim() || null;
      }

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
