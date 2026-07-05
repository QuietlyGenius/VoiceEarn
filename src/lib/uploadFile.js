import supabase, { isMockMode } from './supabase';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Vercel/serverless can return a plain-text error (e.g. "Request Entity Too
// Large") instead of JSON — parse defensively so callers never crash on it.
async function parseResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || res.statusText };
  }
}

/**
 * Uploads a File/Blob to a Supabase Storage bucket and returns its public URL.
 *
 * Production: the serverless function only mints a short-lived *signed upload
 * URL* (a tiny JSON response); the file bytes go straight from the browser to
 * Supabase Storage. This avoids Vercel's 4.5 MB request-body limit entirely, so
 * large books and long recordings upload fine.
 *
 * Local mock mode: falls back to base64-through-the-mock-API (no size limit
 * locally, and the mock backend has no real Storage).
 */
export async function uploadToBucket({ file, fileName, contentType, bucketName, accessToken }) {
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  if (isMockMode) {
    const fileBase64 = await blobToBase64(file);
    const res = await fetch('/api/upload-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({ fileName, fileBase64, contentType, bucketName })
    });
    const data = await parseResponse(res);
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data.url;
  }

  // 1. Ask the (admin-gated) function for a signed upload URL — small request.
  const res = await fetch('/api/upload-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({ signed: true, fileName, contentType, bucketName })
  });
  const data = await parseResponse(res);
  if (!res.ok) throw new Error(data.error || 'Could not start upload');

  // 2. Upload the bytes directly to Supabase Storage (no function involved).
  const { error } = await supabase.storage
    .from(bucketName)
    .uploadToSignedUrl(data.path, data.token, file, { contentType });
  if (error) throw new Error(error.message || 'Upload to storage failed');

  return data.publicUrl;
}
