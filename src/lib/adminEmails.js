// Single source of truth for who has admin access, shared by both the
// frontend (route gating) and the API routes (authorization). Replace these
// with your own email(s) before deploying — anyone left in this list, or
// left out of it, gets/loses admin access across the whole app.
export const ADMIN_EMAILS = ['admin@example.com', 'admin2@example.com'];

export function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}
