// BSP Consult — Admin dashboard config.
//
// TEN-8 (Firebase auth): the old client-side `password` gate was OBSCURITY only
// (admin.html and admin-log.json are static files on GitHub Pages — anyone with
// the URL could read them). The dashboard now gates on a REAL Firebase Auth
// session via auth.js/BSP.*, and "founder only" is enforced by the allowlist
// below AND by the matching Firestore rule on the `admin/*` collection.
//
// >>> FOUNDER ACTION REQUIRED <<<
// Fill in your Firebase account identity in BOTH places:
//   1. ADMIN_UIDS below  (preferred — a uid can never change under you), and/or
//      ADMIN_EMAILS below (must be a VERIFIED email on the account).
//   2. The SAME uid(s)/email(s) inside firestore.rules → `match /admin/{doc}`.
// Find your uid in the Firebase console (Authentication → Users) or by signing
// in and running `BSP.currentUser().uid` / `BSP.currentUser().email` in the
// browser console. Until at least one entry is filled, NOBODY can pass the gate.
window.ADMIN_CONFIG = {
  // Allowlisted Firebase Auth uids that may open the admin dashboard.
  // Example: ['aBcD1234efGh5678ijkl'].  Leave [] if using emails only.
  ADMIN_UIDS: [
    // 'PASTE_FOUNDER_FIREBASE_UID_HERE',
  ],

  // Allowlisted (verified) account emails, matched case-insensitively.
  // Example: ['micha.dekegel@hotmail.com'].  Leave [] if using uids only.
  ADMIN_EMAILS: [
    // 'PASTE_FOUNDER_EMAIL_HERE',
  ],

  // A value flag is "showing to members" only when a match is State 2 confirmed
  // AND within this many hours of start (mirrors the member-facing State-2 gate).
  stateWindowHours: 30,
};
