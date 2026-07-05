import supabase from './db-client.js';
import { isAdminEmail as isAdmin } from '../src/lib/adminEmails.js';

async function getSetting(key, fallback) {
  const { data } = await supabase.from('settings').select('*').eq('key', key).maybeSingle();
  return data?.value ?? fallback;
}

// Fields a user is allowed to set about themselves. Never includes `status`,
// `wallet_balance_usd`, or `email` — those are server-controlled.
const PROFILE_FIELDS = ['first_name', 'last_name', 'highest_qualification', 'english_proficiency', 'country'];

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

    // GET — return the caller's profile, or signal that onboarding is required.
    if (req.method === 'GET') {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (profileError) throw profileError;

      if (!profile) {
        // Admins are auto-provisioned as approved and skip the applicant form.
        if (isAdmin(user.email)) {
          const { data: adminProfile, error: adminErr } = await supabase
            .from('profiles')
            .insert({
              id: user.id,
              email: user.email.toLowerCase(),
              first_name: 'Admin',
              last_name: '',
              highest_qualification: '',
              english_proficiency: '',
              country: '',
              status: 'approved',
              wallet_balance_usd: 0,
              polygon_address: '',
              terms_accepted: true,
              terms_accepted_at: new Date().toISOString()
            })
            .select()
            .single();
          if (adminErr) throw adminErr;
          return res.status(200).json(adminProfile);
        }
        return res.status(200).json({ needs_onboarding: true, email: user.email });
      }
      return res.status(200).json(profile);
    }

    // POST — first-time onboarding. Creates the profile using details from the
    // registration form. Status depends on the admin-configured mode.
    if (req.method === 'POST') {
      const { data: existing } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (existing) return res.status(200).json(existing);

      const body = req.body || {};
      const missing = PROFILE_FIELDS.filter((f) => !body[f] || !String(body[f]).trim());
      if (missing.length) {
        return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
      }
      if (body.terms_accepted !== true) {
        return res.status(400).json({ error: 'You must accept the Terms & Conditions to register.' });
      }

      const mode = await getSetting('registration_mode', 'manual');
      const isApproved = isAdmin(user.email) || mode === 'auto';
      const status = isApproved ? 'approved' : 'pending';

      let bonus = 0;
      if (isApproved) {
        bonus = parseFloat(await getSetting('signup_bonus_usd', '0')) || 0;
      }

      const record = {
        id: user.id,
        email: user.email.toLowerCase(),
        status,
        wallet_balance_usd: bonus,
        polygon_address: '',
        terms_accepted: true,
        terms_accepted_at: new Date().toISOString()
      };
      PROFILE_FIELDS.forEach((f) => { record[f] = String(body[f]).trim(); });

      const { data: created, error: createError } = await supabase
        .from('profiles')
        .insert(record)
        .select()
        .single();

      if (createError) throw createError;
      return res.status(201).json(created);
    }

    // PUT — update the caller's own editable fields only.
    if (req.method === 'PUT') {
      const body = req.body || {};
      const updates = {};
      [...PROFILE_FIELDS, 'polygon_address'].forEach((f) => {
        if (body[f] !== undefined) updates[f] = typeof body[f] === 'string' ? body[f].trim() : body[f];
      });
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No updatable fields provided' });
      }

      const { data: updated, error: updateError } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
        .select()
        .single();

      if (updateError) throw updateError;
      return res.status(200).json(updated);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Profile API error:', err);
    res.status(500).json({ error: err.message });
  }
}
