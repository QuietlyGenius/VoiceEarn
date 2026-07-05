import supabase from './db-client.js';
import { isAdminEmail as isAdmin } from '../src/lib/adminEmails.js';

// See recordings.js — profiles can't be embedded via PostgREST here because
// withdrawals.user_id and profiles.id both reference auth.users(id) with no
// direct FK between the tables. Fetch and merge in JS instead.
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

        const { data: withdrawals, error: wError } = await supabase
          .from('withdrawals')
          .select('*')
          .order('created_at', { ascending: false });

        if (wError) throw wError;
        return res.status(200).json(await attachProfiles(withdrawals));
      } else {
        // Return only the current user's withdrawals
        const { data: withdrawals, error: wError } = await supabase
          .from('withdrawals')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (wError) throw wError;
        return res.status(200).json(withdrawals);
      }
    }

    if (req.method === 'POST') {
      const { amount, polygon_address } = req.body;
      const withdrawAmount = parseFloat(amount);

      if (isNaN(withdrawAmount) || withdrawAmount < 20) {
        return res.status(400).json({ error: 'Minimum withdrawal amount is $20' });
      }
      
      // Input validation for Polygon wallet address format
      if (!polygon_address || !/^0x[a-fA-F0-9]{40}$/.test(polygon_address)) {
        return res.status(400).json({ error: 'Invalid Polygon address. Must be a valid 42-character ERC-20 address starting with 0x.' });
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('wallet_balance_usd')
        .eq('id', user.id)
        .single();

      if (profileError) throw profileError;

      if (parseFloat(profile.wallet_balance_usd) < withdrawAmount) {
        return res.status(400).json({ error: 'Insufficient wallet balance' });
      }

      const newBalance = parseFloat(profile.wallet_balance_usd) - withdrawAmount;
      const { error: deductError } = await supabase
        .from('profiles')
        .update({ wallet_balance_usd: newBalance, polygon_address })
        .eq('id', user.id);

      if (deductError) throw deductError;

      const { data: withdrawal, error: wError } = await supabase
        .from('withdrawals')
        .insert({
          user_id: user.id,
          amount: withdrawAmount,
          polygon_address,
          status: 'pending'
        })
        .select()
        .single();

      if (wError) {
        await supabase
          .from('profiles')
          .update({ wallet_balance_usd: profile.wallet_balance_usd })
          .eq('id', user.id);
        throw wError;
      }

      return res.status(201).json(withdrawal);
    }

    if (req.method === 'PUT') {
      // SECURITY: Processing withdrawals is strictly restricted to authorized admins
      if (!isAdmin(user.email)) {
        return res.status(403).json({ error: 'Forbidden: Only administrators can process withdrawals.' });
      }

      const { withdrawal_id, status } = req.body;
      if (!withdrawal_id || !status) {
        return res.status(400).json({ error: 'Withdrawal ID and status are required' });
      }

      const wId = parseInt(withdrawal_id);

      // Validate status
      const validStatuses = ['approved', 'rejected'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status value.' });
      }

      const { data: withdrawal, error: fetchError } = await supabase
        .from('withdrawals')
        .select('*')
        .eq('id', wId)
        .single();

      if (fetchError) throw fetchError;

      if (withdrawal.status !== 'pending') {
        return res.status(400).json({ error: 'Withdrawal has already been processed' });
      }

      const { data: updatedW, error: updateWError } = await supabase
        .from('withdrawals')
        .update({ status })
        .eq('id', wId)
        .select()
        .single();

      if (updateWError) throw updateWError;

      if (status === 'rejected') {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('wallet_balance_usd')
          .eq('id', withdrawal.user_id)
          .single();

        if (profileError) throw profileError;

        const refundedBalance = parseFloat(profile.wallet_balance_usd || 0) + parseFloat(withdrawal.amount);
        const { error: refundError } = await supabase
          .from('profiles')
          .update({ wallet_balance_usd: refundedBalance })
          .eq('id', withdrawal.user_id);

        if (refundError) throw refundError;
      }

      return res.status(200).json(updatedW);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Withdrawals API error:', err);
    res.status(500).json({ error: err.message });
  }
}
