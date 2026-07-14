/*
 * BSP Consult — shared client-side session + preferences module.
 * Plain <script>-includable (no modules/imports). Exposes a global `BSP`.
 *
 * Storage keys (all namespaced under bsp.*):
 *   bsp.users    -> JSON array of { name, email, passHash, plan, timezone, oddsFormat, notif, createdAt }
 *   bsp.session  -> email of the currently signed-in user (or absent)
 *
 * No backend exists — this is a real, working client-side auth flow.
 * Passwords are never stored in plaintext: we store a SHA-256 hash
 * (SubtleCrypto when available on a secure/localhost context, with a
 * djb2 fallback so it still works from file:// or older contexts).
 */
(function (global) {
  'use strict';

  var USERS_KEY = 'bsp.users';
  var SESSION_KEY = 'bsp.session';

  var DEFAULT_PREFS = {
    plan: 'pro',
    timezone: '(GMT+01:00) Amsterdam',
    oddsFormat: 'decimal',
    notif: { matches: true, digest: true, billing: false }
  };

  /* ---------- low-level storage helpers ---------- */
  function readUsers() {
    try {
      var raw = global.localStorage.getItem(USERS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function writeUsers(users) {
    global.localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function normEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function findUser(users, email) {
    var e = normEmail(email);
    for (var i = 0; i < users.length; i++) {
      if (normEmail(users[i].email) === e) return users[i];
    }
    return null;
  }

  /* ---------- password hashing ---------- */
  // Simple synchronous djb2 fallback (returns hex string, prefixed so we can
  // tell which scheme produced it).
  function djb2(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) & 0xffffffff;
    }
    // Fold to an unsigned hex string.
    return 'd:' + (h >>> 0).toString(16);
  }

  // Returns a Promise<string> hash. Prefers SHA-256, falls back to djb2.
  function hashPassword(password) {
    var pw = String(password);
    var subtle = global.crypto && global.crypto.subtle;
    if (subtle && typeof subtle.digest === 'function' && global.TextEncoder) {
      try {
        var data = new global.TextEncoder().encode('bsp' + pw);
        return subtle.digest('SHA-256', data).then(function (buf) {
          var bytes = new Uint8Array(buf);
          var hex = '';
          for (var i = 0; i < bytes.length; i++) {
            hex += bytes[i].toString(16).padStart(2, '0');
          }
          return 's:' + hex;
        }).catch(function () {
          return djb2(pw);
        });
      } catch (e) {
        return Promise.resolve(djb2(pw));
      }
    }
    return Promise.resolve(djb2(pw));
  }

  // Verify a candidate password against a stored hash, honouring the scheme
  // prefix so we never fall back into a mismatch.
  function verifyPassword(password, storedHash) {
    if (!storedHash) return Promise.resolve(false);
    var pw = String(password);
    if (storedHash.indexOf('s:') === 0) {
      return hashPassword(pw).then(function (h) {
        // hashPassword may fall back to djb2 if subtle later fails; compare
        // only if it produced an s: hash, otherwise recompute is impossible.
        return h === storedHash;
      });
    }
    // djb2 stored
    return Promise.resolve(djb2(pw) === storedHash);
  }

  /* ---------- public user-shape helpers ---------- */
  function publicUser(u) {
    if (!u) return null;
    return {
      name: u.name,
      email: u.email,
      plan: u.plan || DEFAULT_PREFS.plan,
      timezone: u.timezone || DEFAULT_PREFS.timezone,
      oddsFormat: u.oddsFormat || DEFAULT_PREFS.oddsFormat,
      notif: Object.assign({}, DEFAULT_PREFS.notif, u.notif || {})
    };
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  }

  /* ---------- BSP API ---------- */
  var BSP = {
    /* --- auth --- */

    // signUp({name,email,password,plan}) -> Promise<publicUser>
    // Rejects on invalid input or duplicate email.
    signUp: function (opts) {
      opts = opts || {};
      var name = String(opts.name || '').trim();
      var email = normEmail(opts.email);
      var password = String(opts.password || '');
      var plan = opts.plan === 'edge' ? 'edge' : 'pro';

      if (!name) return Promise.reject(new Error('Please enter your full name.'));
      if (!isValidEmail(email)) return Promise.reject(new Error('Please enter a valid email address.'));
      if (password.length < 8) return Promise.reject(new Error('Password must be at least 8 characters.'));

      var users = readUsers();
      if (findUser(users, email)) {
        return Promise.reject(new Error('An account with that email already exists.'));
      }

      return hashPassword(password).then(function (passHash) {
        var user = {
          name: name,
          email: email,
          passHash: passHash,
          plan: plan,
          timezone: DEFAULT_PREFS.timezone,
          oddsFormat: DEFAULT_PREFS.oddsFormat,
          notif: Object.assign({}, DEFAULT_PREFS.notif),
          createdAt: Date.now()
        };
        users.push(user);
        writeUsers(users);
        global.localStorage.setItem(SESSION_KEY, email);
        return publicUser(user);
      });
    },

    // signIn(email, password) -> Promise<publicUser>
    // Rejects with a distinct message for no-account vs wrong-password.
    signIn: function (email, password) {
      var e = normEmail(email);
      if (!isValidEmail(e)) return Promise.reject(new Error('Please enter a valid email address.'));
      var users = readUsers();
      var user = findUser(users, e);
      if (!user) return Promise.reject(new Error('No account found for that email.'));
      return verifyPassword(password, user.passHash).then(function (ok) {
        if (!ok) throw new Error('Incorrect password. Please try again.');
        global.localStorage.setItem(SESSION_KEY, user.email);
        return publicUser(user);
      });
    },

    signOut: function () {
      global.localStorage.removeItem(SESSION_KEY);
    },

    // currentUser() -> publicUser | null (synchronous)
    currentUser: function () {
      var email = global.localStorage.getItem(SESSION_KEY);
      if (!email) return null;
      var user = findUser(readUsers(), email);
      if (!user) {
        // Stale session (user record gone) — clean up.
        global.localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return publicUser(user);
    },

    // updateProfile(patch) -> publicUser | null
    // patch may include name, email, plan, timezone, oddsFormat, notif.
    // Persists to the stored user record and returns the fresh publicUser.
    updateProfile: function (patch) {
      patch = patch || {};
      var sessionEmail = global.localStorage.getItem(SESSION_KEY);
      if (!sessionEmail) return null;
      var users = readUsers();
      var user = findUser(users, sessionEmail);
      if (!user) return null;

      if (typeof patch.name === 'string' && patch.name.trim()) {
        user.name = patch.name.trim();
      }
      if (typeof patch.email === 'string' && isValidEmail(patch.email)) {
        var newEmail = normEmail(patch.email);
        // Guard email uniqueness (allow keeping own email).
        var clash = findUser(users, newEmail);
        if (!clash || normEmail(clash.email) === normEmail(user.email)) {
          user.email = newEmail;
          global.localStorage.setItem(SESSION_KEY, newEmail);
        }
      }
      if (patch.plan === 'edge' || patch.plan === 'pro') user.plan = patch.plan;
      if (typeof patch.timezone === 'string' && patch.timezone) user.timezone = patch.timezone;
      if (patch.oddsFormat === 'decimal' || patch.oddsFormat === 'fractional' || patch.oddsFormat === 'american') {
        user.oddsFormat = patch.oddsFormat;
      }
      if (patch.notif && typeof patch.notif === 'object') {
        user.notif = Object.assign({}, DEFAULT_PREFS.notif, user.notif || {}, patch.notif);
      }
      writeUsers(users);
      return publicUser(user);
    },

    // changePassword(currentPassword, newPassword) -> Promise<true>
    // Validates the current password against the stored hash, updates the hash.
    changePassword: function (currentPassword, newPassword) {
      var sessionEmail = global.localStorage.getItem(SESSION_KEY);
      if (!sessionEmail) return Promise.reject(new Error('You are not signed in.'));
      if (String(newPassword || '').length < 8) {
        return Promise.reject(new Error('New password must be at least 8 characters.'));
      }
      var users = readUsers();
      var user = findUser(users, sessionEmail);
      if (!user) return Promise.reject(new Error('Account not found.'));
      return verifyPassword(currentPassword, user.passHash).then(function (ok) {
        if (!ok) throw new Error('Current password is incorrect.');
        return hashPassword(newPassword).then(function (h) {
          user.passHash = h;
          writeUsers(users);
          return true;
        });
      });
    },

    // requireAuth() -> publicUser | (redirects). Call at top of protected pages.
    requireAuth: function (redirectTo) {
      var u = BSP.currentUser();
      if (!u) {
        global.location.replace(redirectTo || 'auth.html');
        return null;
      }
      return u;
    },

    /* --- preferences (convenience wrappers) --- */
    getPreferences: function () {
      var u = BSP.currentUser();
      if (!u) {
        return {
          oddsFormat: DEFAULT_PREFS.oddsFormat,
          timezone: DEFAULT_PREFS.timezone,
          notif: Object.assign({}, DEFAULT_PREFS.notif)
        };
      }
      return { oddsFormat: u.oddsFormat, timezone: u.timezone, notif: u.notif };
    },

    setOddsFormat: function (fmt) {
      return BSP.updateProfile({ oddsFormat: fmt });
    },
    setTimezone: function (tz) {
      return BSP.updateProfile({ timezone: tz });
    },
    setNotif: function (notif) {
      return BSP.updateProfile({ notif: notif });
    },

    /* --- odds formatting --- */
    // formatOdds(decimalPrice[, format]) -> string in the user's chosen format.
    // decimal  -> "2.62"
    // fractional -> "13/8"
    // american -> "+162" / "-150"
    formatOdds: function (decimalPrice, format) {
      var d = Number(decimalPrice);
      if (!isFinite(d) || d <= 1) {
        // Degenerate input: show as-is to 2dp where possible.
        return isFinite(d) ? d.toFixed(2) : String(decimalPrice);
      }
      var fmt = format || (BSP.currentUser() ? BSP.currentUser().oddsFormat : DEFAULT_PREFS.oddsFormat);

      if (fmt === 'fractional') {
        return decimalToFraction(d);
      }
      if (fmt === 'american') {
        return decimalToAmerican(d);
      }
      return d.toFixed(2);
    }
  };

  /* ---------- odds conversion internals ---------- */
  function decimalToAmerican(d) {
    var b = d - 1; // net fractional profit
    if (b >= 1) {
      return '+' + Math.round(b * 100);
    }
    return '-' + Math.round(100 / b);
  }

  function decimalToFraction(d) {
    var b = d - 1; // fractional profit as a real number
    // Find the nearest simple fraction using a bounded continued-fraction
    // search, then cap the denominator so results look like betting fractions.
    var best = approximateFraction(b, 50);
    return best.num + '/' + best.den;
  }

  function approximateFraction(x, maxDen) {
    if (x <= 0) return { num: 0, den: 1 };
    // Continued fraction expansion.
    var bestNum = 1, bestDen = 1, bestErr = Infinity;
    for (var den = 1; den <= maxDen; den++) {
      var num = Math.round(x * den);
      if (num <= 0) continue;
      var err = Math.abs(x - num / den);
      // Prefer smaller denominators when errors are close (simpler fractions).
      if (err < bestErr - 1e-9) {
        bestErr = err;
        bestNum = num;
        bestDen = den;
      }
    }
    // Reduce.
    var g = gcd(bestNum, bestDen);
    return { num: bestNum / g, den: bestDen / g };
  }

  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { var t = b; b = a % b; a = t; }
    return a || 1;
  }

  // Expose.
  BSP.isValidEmail = isValidEmail;
  BSP._defaults = DEFAULT_PREFS;
  global.BSP = BSP;
})(typeof window !== 'undefined' ? window : this);
