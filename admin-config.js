// BSP Consult — Admin dashboard config.
// Kept in a SEPARATE file from admin.html so the password can be changed by
// editing only this file (no change to the page logic). This is a static
// GitHub Pages site: the check runs in the browser, so this is OBSCURITY, not
// security — anyone who reads this file can reach the page. Keep the URL
// unlinked and rotate the password here as needed.
window.ADMIN_CONFIG = {
  // Change this to rotate access. Empty string disables the gate (not advised).
  password: 'Admin123!',
  // A value flag is "showing to members" only when a match is State 2 confirmed
  // AND within this many hours of start (mirrors the member-facing State-2 gate).
  stateWindowHours: 30,
};
