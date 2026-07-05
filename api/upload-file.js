import supabase from './db-client.js';
import { isAdminEmail as isAdmin } from '../src/lib/adminEmails.js';

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

    const { fileName, fileBase64, contentType, bucketName } = req.body;
    if (!fileName || !fileBase64) {
      return res.status(400).json({ error: 'File name and base64 data are required' });
    }

    const targetBucket = bucketName || 'audio-recordings';

    // SECURITY: Uploading files to the 'book-files' bucket is strictly restricted to authorized admins
    if (targetBucket === 'book-files' && !isAdmin(user.email)) {
      return res.status(403).json({ error: 'Forbidden: Only administrators can upload book files.' });
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    
    const { data, error } = await supabase.storage
      .from(targetBucket)
      .upload(`${user.id}/${Date.now()}_${fileName}`, buffer, {
        contentType: contentType || 'application/octet-stream',
        upsert: true
      });

    if (error) throw error;

    const { data: urlData } = supabase.storage
      .from(targetBucket)
      .getPublicUrl(data.path);

    return res.status(200).json({ url: urlData.publicUrl });
  } catch (err) {
    console.error('Upload file error:', err);
    res.status(500).json({ error: err.message });
  }
}
