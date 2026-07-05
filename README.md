# VoiceEarn (Voice Narration Work Platform)

A mobile-first web app where contributors sign in with Google, read published books aloud in short sessions, and get paid per approved page. Payouts are tracked in USD and INR and sent to a Polygon (USDC) wallet.

## 🚀 Features

- **Google-only sign-in** via Supabase Auth — no passwords to manage.
- **Application & approval flow**: new users complete a short profile (name, qualification, English proficiency, country). Admins choose **auto** approval or a **manual** waitlist queue.
- **Reading Room**: scrollable page view that preserves the book's headings and paragraph breaks, with a sentence-level reading guide, adjustable font size, an optional adjustable-speed auto-scroll teleprompter, a pre-recording instructions modal, and pause/resume recording.
- **Dual-currency wallet**: live USD/INR earnings and balance.
- **Admin console**: registration **Approvals** queue + full **Users** list (all registered users with status, details, wallet, and approve/reject/revoke), book uploads (PDF/EPUB auto-parsed into pages preserving structure, with an option to skip leading pages), recording review with per-page approval, Polygon payout management, and configurable rate / signup bonus / registration mode.

> **Pagination & time:** book text is split into ~250-word pages while keeping paragraph and heading structure; estimated minutes are `words ÷ 130` (no buffer). A configurable signup bonus (default $0) is advertised on the landing page when set.

---

## 🛠️ Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS v4, Lucide React, React Router
- **Backend**: Node.js Vercel Serverless Functions (`api/`)
- **Database & Auth**: Supabase (PostgreSQL + Google OAuth)
- **Storage**: Supabase Storage (`audio-recordings`, `book-files`)

---

## 📦 Project Directory Structure

```text
├── api/
│   ├── db-client.js       # Supabase client (+ offline mock DB & storage for local dev)
│   ├── profile.js         # Self profile: onboarding, fetch, update
│   ├── registrations.js   # Admin: list/approve/reject pending applicants
│   ├── settings.js        # Platform settings (rate, mode, bonus) — admin-gated writes
│   ├── books.js           # Book lists, pages, and pagination/time calc
│   ├── progress.js        # Save/fetch reading page progress
│   ├── recordings.js      # Submit, fetch, and review recordings
│   ├── withdrawals.js     # Polygon withdrawals (min $20)
│   ├── exchange-rate.js   # USD→INR rate (public)
│   ├── upload-file.js     # Base64→Storage upload (audio & book files)
│   └── db-wake.js         # Optional Supabase auto-wake hook (no-op unless configured)
├── src/
│   ├── components/
│   │   └── ProtectedRoute.jsx  # Auth + onboarding/pending/rejected/admin gating
│   ├── contexts/
│   │   └── AuthContext.jsx     # Session + profile provider
│   ├── lib/
│   │   ├── supabase.js         # Frontend Supabase client (+ Google OAuth, dev mock)
│   │   ├── adminEmails.js      # Single shared admin allowlist (frontend + api/*.js)
│   │   └── bookFileParser.js   # Client-side PDF/EPUB text extraction (pdfjs-dist, JSZip)
│   ├── pages/
│   │   ├── Login.jsx           # Landing + Google sign-in + FAQ
│   │   ├── Onboarding.jsx      # First-time registration form
│   │   ├── AccountStatus.jsx   # Waitlist / rejected screens
│   │   ├── Dashboard.jsx       # Wallet, book library, history, profile
│   │   ├── RecordingStudio.jsx # Reading Room + recorder
│   │   └── AdminDashboard.jsx  # Approvals, books, queue, payouts, settings
│   ├── App.tsx / main.tsx / index.css
├── vercel.json                 # SPA routing
├── package.json
└── tsconfig.json
```

---

## ⚙️ Step-by-Step Local Setup Guide

### 1. Prerequisites
Ensure you have the following installed:
- [Node.js](https://nodejs.org/) **v20.19+ (or v22.12+)** — required by Vite 7
- [npm](https://www.npmjs.com/) (bundled with Node)

---

### 2. Get the Code & Install Dependencies
From the project root:
```bash
npm install
```
This installs both the frontend and the serverless-function dependencies.

---

### 3. Setup Supabase Database
1. Go to [Supabase](https://supabase.com/) and create a free project.
2. In the SQL Editor, execute the following commands to create the tables:

```sql
-- 1. User Profiles Table
-- Created on first Google sign-in via the onboarding form. `status` is
-- 'pending' | 'approved' | 'rejected' and is the access gate.
CREATE TABLE profiles (
  id UUID PRIMARY KEY,                         -- Supabase auth user id
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  highest_qualification TEXT,
  english_proficiency TEXT,
  country TEXT,
  status TEXT DEFAULT 'pending',
  wallet_balance_usd DOUBLE PRECISION DEFAULT 0,
  polygon_address TEXT,
  terms_accepted BOOLEAN DEFAULT FALSE,
  terms_accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Books Table
CREATE TABLE books (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  file_url TEXT,
  total_pages INTEGER NOT NULL,
  calculated_minutes DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Book Pages Table
CREATE TABLE book_pages (
  id SERIAL PRIMARY KEY,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  content TEXT NOT NULL
);

-- 4. Recordings Table
CREATE TABLE recordings (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  audio_url TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  approved_minutes DOUBLE PRECISION DEFAULT 0.0,
  pages_recorded INTEGER DEFAULT 1,
  duration_seconds DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Withdrawals Table
CREATE TABLE withdrawals (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  amount DOUBLE PRECISION NOT NULL,
  polygon_address TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Reading Progress Table
CREATE TABLE user_book_progress (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  current_page INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Settings Table (rate_per_page, registration_mode, signup_bonus_usd)
CREATE TABLE settings (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 4. Setup Storage Buckets
1. Inside your Supabase Dashboard, navigate to **Storage**.
2. Create a bucket named `audio-recordings` and set it to **Public** so the admin review queue can play back submitted audio.
3. Create a second bucket named `book-files` (used when an admin uploads a PDF/EPUB). Public or private both work — the app never reads the file back, it only stores the URL for reference.

> In local **mock mode** (no `.env`), uploads are written to `public/mock-uploads/` and served back by the Vite dev server, so audio playback works offline too. That folder is gitignored.

---

### 5. Enable Google Sign-In (Supabase Auth)
Login is **Google-only** in production, handled by Supabase Auth's built-in Google provider — there is no custom OAuth proxy to run.

1. In **Google Cloud Console → APIs & Services → Credentials**, create an **OAuth 2.0 Client ID** (type: Web application).
2. Add your Supabase callback as an authorized redirect URI:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. In the **Supabase Dashboard → Authentication → Providers → Google**, paste the Client ID and Client Secret and enable it.
4. In **Authentication → URL Configuration**, set your Site URL (e.g. `https://your-app.vercel.app`) and add it to Redirect URLs.

That's it — the frontend calls `supabase.auth.signInWithOAuth({ provider: 'google' })` and Supabase handles the rest.

> **Local dev:** with no `.env`, the app runs in mock mode and "Continue with Google" signs you in as a simulated user. A dev-only email box (mock mode only) lets you sign in as any address — e.g. `admin@example.com` — to exercise the admin console.

---

### 6. Configure Environment Variables
Copy the example file and fill in your Supabase credentials:
```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_public_key

# Server-only: full-access key used by api/*.js. Never prefix this with
# VITE_/NEXT_PUBLIC_ or it will be bundled into client-side JS.
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

These same three variables are used in both places: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are inlined into the frontend by Vite at build time, and the `api/*.js` serverless functions read `VITE_SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) plus `SUPABASE_SERVICE_ROLE_KEY` at runtime. If none of the URL variants is set, both sides fall back to offline mock mode — so if production ever behaves like mock mode, it means the URL var didn't reach that environment.

`.env` is gitignored — never commit real keys to `vercel.json` or any other tracked file. If a service role key ever ends up in a commit or a shared file, rotate it from the Supabase dashboard (**Settings → API**) rather than just deleting it, since anyone who saw the old value can keep using it until it's rotated.

---

### 7. Set Your Admin Email
Admin access (the `/admin` console: approvals, books, review queue, payouts, settings) is controlled by a single allowlist in [src/lib/adminEmails.js](src/lib/adminEmails.js):

```js
export const ADMIN_EMAILS = ['admin@example.com', 'admin2@example.com'];
```

Replace these with your own Google account email(s) before deploying — this is the only file you edit; the frontend route guard and every `api/*.js` authorization check import from it. On first sign-in an admin profile is created automatically (approved), so admins never wait in the queue.

### Registration modes (set in the admin **Settings** tab)
- **Manual** (default): new users who sign in with Google fill the profile form, then wait in the **Approvals** queue with a "you're on the waitlist" message until an admin approves them.
- **Auto**: everyone who signs in is approved instantly.
- **Signup bonus** is configurable and defaults to **$0**. Only enable a bonus in *manual* mode — a bonus under auto-registration can be farmed with throwaway Google accounts.

---

### 8. Run Locally
Start the local Vite development server:
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your Google Chrome browser. Without a `.env` file, the app automatically runs in a local **offline mock mode** (see `api/db-client.js` / `src/lib/supabase.js`), persisting to `local-db.json` instead of a real database — handy for UI development without touching production data.

---

### 9. Deploying — Free Stack, Fully on Live (Vercel + Supabase)
Both Vercel's Hobby plan and Supabase's Free plan cover everything this app needs, at $0.

1. **Push to GitHub.**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```
   Create a new (private, if the code contains anything sensitive) repo on GitHub and push:
   ```bash
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
   `.gitignore` already excludes `node_modules`, `.env`, and `local-db.json`, so no secrets or local mock data get pushed.

2. **Import into Vercel.**
   - Go to [vercel.com/new](https://vercel.com/new), sign in with GitHub, and import the repo.
   - Framework preset: Vite (auto-detected). Build command / output directory: leave the defaults (`npm run build` / `dist`).

3. **Add environment variables — in the Vercel dashboard, not in `vercel.json`.**
   Project → **Settings → Environment Variables**, add the three variables from step 6 (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) for the **Production** environment. Google sign-in is configured in the Supabase dashboard (step 5), not via env vars. `vercel.json` only handles SPA routing — it must never hold real credentials, since it is committed to git.

4. **Deploy.** Click **Deploy**; Vercel builds the React app and auto-maps every file in `api/` to a serverless function at the matching `/api/*` route.

5. **Point Supabase at your live URL (required for Google sign-in).** After the first deploy you'll have a `https://<your-app>.vercel.app` URL. In **Supabase → Authentication → URL Configuration**, set the **Site URL** to it and add `https://<your-app>.vercel.app/**` to **Redirect URLs**. Without this the Google redirect back to your app is rejected. (If you add a custom domain later, add it here too.)

6. **Supabase free-tier pausing.** A free Supabase project auto-pauses after ~1 week with no API activity. This repo has a `triggerRestore()` hook (`api/db-wake.js`) that was wired to a specific third-party auto-wake service (`FULLSTACK_RESTORE_API_URL`) — that endpoint isn't yours, so leave `FULLSTACK_PROJECT_REF`/`FULLSTACK_RESTORE_API_URL` unset; the hook silently no-ops when they're absent and nothing breaks. If your project does pause, resume it manually from the Supabase dashboard (takes a few seconds), or upgrade Supabase's plan if that's a problem for your use case.

7. **Verify.** Visit your `*.vercel.app` URL, sign in with Google using the admin email you set in step 7, and confirm the `/admin` console loads.

---

## 🧪 Local Dev Sign-In (Mock Mode Only)
With no `.env` file the app runs offline (backed by `local-db.json`, uploads under `public/mock-uploads/`). On the login page:
- **"Continue with Google"** signs you in as a simulated new applicant (`newuser@gmail.com`).
- A **dev-only email box** (visible in mock mode only) lets you sign in as any address — use `admin@example.com` to reach the admin console. Admins are auto-approved.

None of this exists in a production build — once real Supabase credentials are set, sign-in is Google-only and access is gated by the approval flow.
