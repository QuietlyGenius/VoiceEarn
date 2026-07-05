import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { triggerRestore } from './db-wake.js';

// Accept either name so a single documented URL var works for both the Vite
// frontend (VITE_SUPABASE_URL) and these serverless functions. On Vercel all
// project env vars reach the function runtime regardless of prefix.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';

const isMockMode = !SUPABASE_URL || SUPABASE_URL.includes('your_');

let supabase;

if (isMockMode) {
  console.log('⚠️ Supabase URL not configured. Running in Local Offline Mock Mode.');
  
  const DB_PATH = path.resolve(process.cwd(), 'local-db.json');

  // Helper to read/write local mock database
  const readDB = () => {
    if (!fs.existsSync(DB_PATH)) {
      const initialState = {
        // No demo content ships. Profiles are created on first Google sign-in.
        // registration_mode defaults to 'manual' (new users wait for admin
        // approval); signup_bonus_usd defaults to '0' (no free credit).
        profiles: [],
        books: [],
        book_pages: [],
        recordings: [],
        withdrawals: [],
        user_book_progress: [],
        settings: [
          { id: 1, key: 'registration_mode', value: 'manual' },
          { id: 2, key: 'signup_bonus_usd', value: '0' },
          { id: 3, key: 'rate_per_page', value: '0.01' }
        ]
      };
      fs.writeFileSync(DB_PATH, JSON.stringify(initialState, null, 2));
      return initialState;
    }
    try {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    } catch {
      return {};
    }
  };

  const writeDB = (data) => {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  };

  // Mock Supabase Client implementation with support for relationship joins
  supabase = {
    from: (table) => {
      return {
        select: (columns = '*') => {
          const db = readDB();
          let rows = JSON.parse(JSON.stringify(db[table] || [])); // Deep clone to avoid mutating DB state in-memory

          // Perform relationship joins automatically if columns contain nested fields
          if (table === 'recordings') {
            rows = rows.map(rec => {
              const book = db.books.find(b => b.id == rec.book_id) || null;
              const profile = db.profiles.find(p => p.id == rec.user_id) || null;
              return {
                ...rec,
                books: book,
                profiles: profile
              };
            });
          } else if (table === 'withdrawals') {
            rows = rows.map(w => {
              const profile = db.profiles.find(p => p.id == w.user_id) || null;
              return {
                ...w,
                profiles: profile
              };
            });
          }

          const builder = {
            data: rows,
            eq: (col, val) => {
              builder.data = builder.data.filter(r => r[col] == val);
              return builder;
            },
            in: (col, vals) => {
              const set = (vals || []).map(String);
              builder.data = builder.data.filter(r => set.includes(String(r[col])));
              return builder;
            },
            order: (col, opts) => {
              const asc = opts?.ascending !== false;
              builder.data.sort((a, b) => {
                if (a[col] < b[col]) return asc ? -1 : 1;
                if (a[col] > b[col]) return asc ? 1 : -1;
                return 0;
              });
              return builder;
            },
            maybeSingle: async () => {
              return { data: builder.data[0] || null, error: null };
            },
            single: async () => {
              if (builder.data.length === 0) return { data: null, error: { message: 'Not found' } };
              return { data: builder.data[0], error: null };
            },
            then: (resolve) => {
              resolve({ data: builder.data, error: null });
            }
          };
          return builder;
        },
        insert: (rows) => {
          const db = readDB();
          const list = db[table] || [];
          const inserted = (Array.isArray(rows) ? rows : [rows]).map((row, idx) => ({
            id: list.length + idx + 1,
            created_at: new Date().toISOString(),
            ...row
          }));

          db[table] = [...list, ...inserted];
          writeDB(db);

          const builder = {
            select: () => ({
              single: async () => ({ data: inserted[0], error: null }),
              then: (resolve) => resolve({ data: inserted, error: null })
            }),
            then: (resolve) => resolve({ data: inserted, error: null })
          };
          return builder;
        },
        upsert: (rows, options = {}) => {
          // Insert-or-update on a unique key, mirroring PostgREST upsert.
          const db = readDB();
          const list = db[table] || [];
          const conflictCols = (options.onConflict || 'id').split(',').map((s) => s.trim());
          const inputRows = Array.isArray(rows) ? rows : [rows];
          const resultRows = [];

          inputRows.forEach((row) => {
            const idx = list.findIndex((r) =>
              conflictCols.every((c) => String(r[c]) === String(row[c]))
            );
            if (idx >= 0) {
              const merged = { ...list[idx], ...row };
              list[idx] = merged;
              resultRows.push(merged);
            } else {
              const inserted = { id: list.length + 1, created_at: new Date().toISOString(), ...row };
              list.push(inserted);
              resultRows.push(inserted);
            }
          });

          db[table] = list;
          writeDB(db);

          return {
            select: () => ({
              single: async () => ({ data: resultRows[0] || null, error: null }),
              then: (resolve) => resolve({ data: resultRows, error: null })
            }),
            then: (resolve) => resolve({ data: resultRows, error: null })
          };
        },
        update: (values) => {
          const builder = {
            eq: (col, val) => {
              const db = readDB();
              const list = db[table] || [];
              let updatedRows = [];
              
              db[table] = list.map(row => {
                if (row[col] == val) {
                  const updated = { ...row, ...values };
                  updatedRows.push(updated);
                  return updated;
                }
                return row;
              });
              
              writeDB(db);

              return {
                select: () => ({
                  single: async () => ({ data: updatedRows[0] || null, error: null }),
                  then: (resolve) => resolve({ data: updatedRows, error: null })
                }),
                then: (resolve) => resolve({ data: updatedRows, error: null })
              };
            }
          };
          return builder;
        },
        delete: () => {
          const builder = {
            eq: (col, val) => {
              const db = readDB();
              const list = db[table] || [];
              db[table] = list.filter(row => row[col] != val);
              writeDB(db);
              return {
                then: (resolve) => resolve({ error: null })
              };
            }
          };
          return builder;
        }
      };
    },
    auth: {
      getUser: async (token) => {
        // Mock session auth verification
        if (token === 'mock-token-test' || token === 'test@example.com') {
          return { data: { user: { id: '69e041d9-d19b-4f88-a926-9b0284e1fdb5', email: 'test@example.com' } }, error: null };
        }
        if (token === 'mock-token-admin' || token === 'admin@example.com') {
          return { data: { user: { id: 'admin-id-123', email: 'admin@example.com' } }, error: null };
        }
        // Fallback to decode any mock email passed as token
        if (token && token.includes('@')) {
          return { data: { user: { id: token, email: token } }, error: null };
        }
        return { data: { user: null }, error: { message: 'Invalid token' } };
      }
    },
    storage: {
      from: (bucket) => ({
        // Persist bytes under public/mock-uploads so Vite serves them back and
        // the admin audio player actually plays local recordings. Production
        // uses real Supabase Storage public URLs instead.
        upload: async (filePath, buffer) => {
          const dest = path.resolve(process.cwd(), 'public', 'mock-uploads', bucket, filePath);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, buffer);
          console.log(`[Mock Storage] Wrote ${bucket}/${filePath} (${buffer.length} bytes)`);
          return { data: { path: filePath }, error: null };
        },
        getPublicUrl: (filePath) => {
          return { data: { publicUrl: `/mock-uploads/${bucket}/${filePath}` } };
        },
        // Mock parity for the signed-upload flow. In local dev the frontend uses
        // the base64 path instead, so this is just a safety net.
        createSignedUploadUrl: async (filePath) => ({
          data: { signedUrl: `/mock-uploads/${bucket}/${filePath}`, token: 'mock-token', path: filePath },
          error: null
        })
      })
    }
  };

} else {
  // Production real Supabase client
  supabase = createClient(
    SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      global: {
        fetch: async (url, options) => {
          const res = await fetch(url, options);
          if (!res.ok && res.status >= 500) triggerRestore();
          return res;
        },
      },
    }
  );
}

export default supabase;
