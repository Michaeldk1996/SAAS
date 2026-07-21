/*
 * BSP Consult — shared client-side session + preferences module (Firebase-backed).
 *
 * Plain <script>-includable (no ES modules/imports). Exposes a global `BSP`.
 * This module replaces the earlier localStorage-only implementation with a real
 * Firebase Authentication + Cloud Firestore backend, while keeping the same
 * public `BSP.*` surface so existing pages (auth.html, account.html, the
 * dashboard) keep working with only their async call-sites updated.
 *
 * The Firebase compat SDK is loaded on demand from Google's gstatic CDN, so
 * there is no new local JS file to add to the deploy pipeline and no extra
 * <script> tag is required on the pages — including auth.js is enough.
 *
 * Firestore user document: users/{uid}
 *   fullName, email, plan ('free'), oddsFormat ('decimal'),
 *   favouriteBookmakers [], timezone,
 *   notifications { favouritePlayers, valuePicks, openingOdds, sharpMoney } (all false),
 *   createdAt (server timestamp)
 */
(function (global) {
  'use strict';

  /* ---------- Firebase project config (public web keys, not secrets) ---------- */
  var firebaseConfig = {
    apiKey: 'AIzaSyA9NYa0FY9gZHa7Cuwvxr-WtBWuSw-dCNs',
    authDomain: 'tennis-edge-75cd9.firebaseapp.com',
    projectId: 'tennis-edge-75cd9',
    storageBucket: 'tennis-edge-75cd9.firebasestorage.app',
    messagingSenderId: '740095842288',
    appId: '1:740095842288:web:b10f428e7c1e3e354c2f35',
    measurementId: 'G-L2RZQB615T'
  };

  var SDK_VERSION = '10.12.5';
  var SDK_BASE = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/';

  var DEFAULT_TZ = '(GMT+01:00) Amsterdam';
  var NOTIF_KEYS = ['favouritePlayers', 'valuePicks', 'openingOdds', 'sharpMoney'];

  function defaultNotif() {
    return { favouritePlayers: false, valuePicks: false, openingOdds: false, sharpMoney: false };
  }

  /* ---------- module state ---------- */
  var _auth = null;
  var _db = null;
  var _cachedUser = null;      // publicUser or null
  var _authResolved = false;   // has onAuthStateChanged fired at least once?
  var _authCbs = [];           // subscribers to auth-state changes

  var _firstAuthResolve;
  var _firstAuth = new Promise(function (res) { _firstAuthResolve = res; });

  var _readyResolve, _readyReject;
  var _ready = new Promise(function (res, rej) { _readyResolve = res; _readyReject = rej; });

  /* ---------- SDK loading ---------- */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = global.document.createElement('script');
      s.src = src;
      s.async = false; // preserve execution order
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      global.document.head.appendChild(s);
    });
  }

  function initFirebase() {
    return loadScript(SDK_BASE + 'firebase-app-compat.js')
      .then(function () {
        return Promise.all([
          loadScript(SDK_BASE + 'firebase-auth-compat.js'),
          loadScript(SDK_BASE + 'firebase-firestore-compat.js')
        ]);
      })
      .then(function () {
        var firebase = global.firebase;
        if (!global.__bspFirebaseApp) {
          global.__bspFirebaseApp = firebase.initializeApp(firebaseConfig);
        }
        _auth = firebase.auth();
        _db = firebase.firestore();
        return _auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () {});
      })
      .then(function () {
        // Restore/observe the session. Fires once immediately with the persisted
        // user (or null) after the SDK finishes its async session restore — this
        // is why requireAuth() must await the first callback rather than reading
        // currentUser() synchronously on page load.
        _auth.onAuthStateChanged(function (fbUser) {
          var done = function (u) {
            _cachedUser = u;
            _authResolved = true;
            _firstAuthResolve(u);
            notifyAuth(u);
          };
          if (fbUser) {
            loadProfile(fbUser).then(done).catch(function () { done(publicUser(fbUser, {})); });
          } else {
            done(null);
          }
        });
        _readyResolve();
      })
      .catch(function (err) {
        _readyReject(err);
        // Resolve the first-auth gate so protected pages don't hang forever if
        // the SDK fails to load; they will treat the user as signed out.
        if (!_authResolved) { _authResolved = true; _firstAuthResolve(null); }
        throw err;
      });
  }

  var _initPromise = null;
  function ensureInit() {
    if (!_initPromise) _initPromise = initFirebase();
    return _initPromise.then(function () { return _ready; });
  }

  /* ---------- profile helpers ---------- */
  function loadProfile(fbUser) {
    return _db.collection('users').doc(fbUser.uid).get().then(function (snap) {
      var data = snap && snap.exists ? snap.data() : {};
      return publicUser(fbUser, data);
    });
  }

  function publicUser(fbUser, data) {
    data = data || {};
    var notif = Object.assign(defaultNotif(), data.notifications || {});
    return {
      uid: fbUser.uid,
      name: data.fullName || fbUser.displayName || '',
      email: data.email || fbUser.email || '',
      emailVerified: !!fbUser.emailVerified,
      plan: data.plan || 'free',
      oddsFormat: data.oddsFormat || 'decimal',
      timezone: data.timezone || DEFAULT_TZ,
      favouriteBookmakers: Array.isArray(data.favouriteBookmakers) ? data.favouriteBookmakers : [],
      notifications: notif,
      createdAt: data.createdAt || null
    };
  }

  function notifyAuth(u) {
    for (var i = 0; i < _authCbs.length; i++) {
      try { _authCbs[i](u); } catch (e) {}
    }
  }

  function normEmail(email) { return String(email || '').trim().toLowerCase(); }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  }

  /* Map Firebase auth error codes to the friendly messages the UI expects.
   * auth.html highlights fields by matching /password/i and /account/i, so the
   * chosen wording matters. */
  function mapAuthError(err) {
    var code = (err && err.code) || '';
    var msg;
    switch (code) {
      case 'auth/email-already-in-use': msg = 'An account with that email already exists.'; break;
      case 'auth/invalid-email': msg = 'Please enter a valid email address.'; break;
      case 'auth/weak-password': msg = 'Password must be at least 8 characters.'; break;
      case 'auth/user-not-found': msg = 'No account found for that email.'; break;
      case 'auth/wrong-password': msg = 'Incorrect password. Please try again.'; break;
      // Newer SDKs collapse wrong-password / no-user into invalid-credential
      // (email-enumeration protection) — surface a combined message that still
      // contains "password" so the field highlight fires.
      case 'auth/invalid-credential': msg = 'Incorrect email or password. Please try again.'; break;
      case 'auth/too-many-requests': msg = 'Too many attempts. Please wait a moment and try again.'; break;
      case 'auth/network-request-failed': msg = 'Network error. Check your connection and try again.'; break;
      case 'auth/requires-recent-login': msg = 'Please sign in again to change this, for security.'; break;
      default: msg = (err && err.message) ? err.message.replace(/^Firebase:\s*/, '') : 'Something went wrong. Please try again.';
    }
    var e = new Error(msg);
    e.code = code;
    return e;
  }

  /* ---------- BSP API ---------- */
  var BSP = {
    /* --- lifecycle --- */

    // ready() -> Promise resolved once the SDK has initialised.
    ready: function () { return ensureInit(); },

    // whenAuthReady() -> Promise<publicUser|null> resolved after the first
    // auth-state resolution (session restore complete).
    whenAuthReady: function () { return ensureInit().then(function () { return _firstAuth; }); },

    // onAuthChange(cb) -> unsubscribe fn. cb(publicUser|null) is called on every
    // auth-state change, and immediately with the current value if already known.
    onAuthChange: function (cb) {
      if (typeof cb !== 'function') return function () {};
      _authCbs.push(cb);
      if (_authResolved) { try { cb(_cachedUser); } catch (e) {} }
      ensureInit();
      return function () {
        var i = _authCbs.indexOf(cb);
        if (i >= 0) _authCbs.splice(i, 1);
      };
    },

    /* --- auth --- */

    // signUp({name,email,password,plan}) -> Promise<publicUser>
    signUp: function (opts) {
      opts = opts || {};
      var name = String(opts.name || '').trim();
      var email = normEmail(opts.email);
      var password = String(opts.password || '');

      if (!name) return Promise.reject(new Error('Please enter your full name.'));
      if (!isValidEmail(email)) return Promise.reject(new Error('Please enter a valid email address.'));
      if (password.length < 8) return Promise.reject(new Error('Password must be at least 8 characters.'));

      var firebase = global.firebase;
      return ensureInit().then(function () {
        return _auth.createUserWithEmailAndPassword(email, password);
      }).then(function (cred) {
        var user = cred.user;
        // plan defaults to 'free' by spec — the auth.html plan picker is a
        // marketing intent signal only (no billing is wired yet).
        var profile = {
          fullName: name,
          email: email,
          plan: 'free',
          oddsFormat: 'decimal',
          favouriteBookmakers: [],
          timezone: DEFAULT_TZ,
          notifications: defaultNotif(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        return user.updateProfile({ displayName: name })
          .catch(function () {})
          // Fire Firebase's built-in verification email immediately after the
          // account is created. Best-effort: a send failure (e.g. rate limit)
          // must not block account creation — the holding screen offers a
          // "Resend" button as the recovery path.
          .then(function () { return user.sendEmailVerification().catch(function () {}); })
          .then(function () { return _db.collection('users').doc(user.uid).set(profile); })
          .then(function () {
            _cachedUser = publicUser(user, profile);
            return _cachedUser;
          });
      }).catch(function (err) { throw mapAuthError(err); });
    },

    // signIn(email, password) -> Promise<publicUser>
    signIn: function (email, password) {
      var e = normEmail(email);
      if (!isValidEmail(e)) return Promise.reject(new Error('Please enter a valid email address.'));
      return ensureInit().then(function () {
        return _auth.signInWithEmailAndPassword(e, String(password || ''));
      }).then(function (cred) {
        return loadProfile(cred.user);
      }).then(function (u) {
        _cachedUser = u;
        return u;
      }).catch(function (err) { throw mapAuthError(err); });
    },

    // signOut() -> Promise (resolves once the session is cleared).
    signOut: function () {
      return ensureInit().then(function () { return _auth.signOut(); }).then(function () {
        _cachedUser = null;
      }).catch(function () { _cachedUser = null; });
    },

    // currentUser() -> publicUser | null (synchronous; may be null before the
    // first auth-state resolution — use whenAuthReady()/onAuthChange() to await).
    currentUser: function () { return _cachedUser; },

    // authResolved() -> bool: has the first auth-state settled yet?
    authResolved: function () { return _authResolved; },

    // requireAuth(redirectTo) -> Promise<publicUser|null>. Redirects to the
    // login page if there is no session once auth state has resolved.
    requireAuth: function (redirectTo) {
      return BSP.whenAuthReady().then(function (u) {
        if (!u) { global.location.replace(redirectTo || 'auth.html'); return null; }
        return u;
      }).catch(function () {
        global.location.replace(redirectTo || 'auth.html');
        return null;
      });
    },

    // requireVerified(loginTo, verifyTo) -> Promise<publicUser|null>. Like
    // requireAuth, but ALSO bounces a signed-in-but-unverified user to the
    // email holding screen. Used to gate the dashboard so a verification link
    // must be clicked before the board is reachable.
    requireVerified: function (loginTo, verifyTo) {
      return BSP.whenAuthReady().then(function (u) {
        if (!u) { global.location.replace(loginTo || 'auth.html'); return null; }
        if (!u.emailVerified) { global.location.replace(verifyTo || 'verify.html'); return null; }
        return u;
      }).catch(function () {
        global.location.replace(loginTo || 'auth.html');
        return null;
      });
    },

    // sendVerificationEmail() -> Promise. Re-sends Firebase's built-in
    // verification email to the currently signed-in user (the "Resend" button).
    sendVerificationEmail: function () {
      return ensureInit().then(function () {
        var user = _auth.currentUser;
        if (!user) throw new Error('You are not signed in.');
        if (user.emailVerified) return true;
        return user.sendEmailVerification().then(function () { return true; });
      }).catch(function (err) { throw mapAuthError(err); });
    },

    // reloadUser() -> Promise<publicUser|null>. Reloads the Firebase user from
    // the server so a freshly-clicked verification link is reflected in
    // emailVerified, refreshes the cached public user, and notifies subscribers.
    reloadUser: function () {
      return ensureInit().then(function () {
        var user = _auth.currentUser;
        if (!user) { _cachedUser = null; notifyAuth(null); return null; }
        return user.reload().then(function () {
          return loadProfile(_auth.currentUser);
        }).then(function (u) {
          _cachedUser = u;
          notifyAuth(u);
          return u;
        });
      });
    },

    // updateProfile(patch) -> Promise<publicUser>
    // patch may include name, email, plan, timezone, oddsFormat,
    // favouriteBookmakers, notifications.
    updateProfile: function (patch) {
      patch = patch || {};
      return ensureInit().then(function () {
        var user = _auth.currentUser;
        if (!user) throw new Error('You are not signed in.');

        var updates = {};
        var chain = Promise.resolve();

        if (typeof patch.name === 'string' && patch.name.trim()) {
          updates.fullName = patch.name.trim();
          chain = chain.then(function () { return user.updateProfile({ displayName: updates.fullName }).catch(function () {}); });
        }
        if (typeof patch.email === 'string' && isValidEmail(patch.email)) {
          var newEmail = normEmail(patch.email);
          if (newEmail !== normEmail(user.email)) {
            updates.email = newEmail;
            chain = chain.then(function () { return user.updateEmail(newEmail); });
          }
        }
        if (patch.plan === 'free' || patch.plan === 'edge' || patch.plan === 'pro') updates.plan = patch.plan;
        if (typeof patch.timezone === 'string' && patch.timezone) updates.timezone = patch.timezone;
        if (patch.oddsFormat === 'decimal' || patch.oddsFormat === 'fractional' || patch.oddsFormat === 'american') {
          updates.oddsFormat = patch.oddsFormat;
        }
        if (Array.isArray(patch.favouriteBookmakers)) updates.favouriteBookmakers = patch.favouriteBookmakers;
        if (patch.notifications && typeof patch.notifications === 'object') {
          var merged = Object.assign({}, (_cachedUser && _cachedUser.notifications) || defaultNotif());
          NOTIF_KEYS.forEach(function (k) {
            if (typeof patch.notifications[k] === 'boolean') merged[k] = patch.notifications[k];
          });
          updates.notifications = merged;
        }

        return chain.then(function () {
          if (Object.keys(updates).length === 0) return _cachedUser;
          return _db.collection('users').doc(user.uid).set(updates, { merge: true }).then(function () {
            return loadProfile(user);
          }).then(function (u) { _cachedUser = u; return u; });
        });
      }).catch(function (err) { throw mapAuthError(err); });
    },

    // changePassword(currentPassword, newPassword) -> Promise<true>
    changePassword: function (currentPassword, newPassword) {
      if (String(newPassword || '').length < 8) {
        return Promise.reject(new Error('New password must be at least 8 characters.'));
      }
      var firebase = global.firebase;
      return ensureInit().then(function () {
        var user = _auth.currentUser;
        if (!user) throw new Error('You are not signed in.');
        var cred = firebase.auth.EmailAuthProvider.credential(user.email, String(currentPassword || ''));
        return user.reauthenticateWithCredential(cred).then(function () {
          return user.updatePassword(String(newPassword));
        }).then(function () { return true; });
      }).catch(function (err) {
        if (err && (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential')) {
          var e = new Error('Current password is incorrect.'); e.code = err.code; throw e;
        }
        throw mapAuthError(err);
      });
    },

    // sendPasswordReset(email) -> Promise<true>
    // Fires Firebase's built-in password-reset email — no custom backend.
    // Resolves even for an unknown address (email-enumeration protection),
    // which is why the UI always shows the same "reset link sent" confirmation.
    sendPasswordReset: function (email) {
      var e = normEmail(email);
      if (!isValidEmail(e)) return Promise.reject(new Error('Please enter a valid email address.'));
      return ensureInit().then(function () {
        return _auth.sendPasswordResetEmail(e);
      }).then(function () { return true; }).catch(function (err) {
        throw mapAuthError(err);
      });
    },

    /* --- preferences (convenience wrappers) --- */
    getPreferences: function () {
      var u = _cachedUser;
      if (!u) return { oddsFormat: 'decimal', timezone: DEFAULT_TZ, notifications: defaultNotif() };
      return { oddsFormat: u.oddsFormat, timezone: u.timezone, notifications: u.notifications };
    },
    setOddsFormat: function (fmt) { return BSP.updateProfile({ oddsFormat: fmt }); },
    setTimezone: function (tz) { return BSP.updateProfile({ timezone: tz }); },
    setNotifications: function (notifications) { return BSP.updateProfile({ notifications: notifications }); },

    /* --- odds formatting --- */
    formatOdds: function (decimalPrice, format) {
      var d = Number(decimalPrice);
      if (!isFinite(d) || d <= 1) {
        return isFinite(d) ? d.toFixed(2) : String(decimalPrice);
      }
      var fmt = format || (_cachedUser ? _cachedUser.oddsFormat : 'decimal');
      if (fmt === 'fractional') return decimalToFraction(d);
      if (fmt === 'american') return decimalToAmerican(d);
      return d.toFixed(2);
    }
  };

  /* ---------- odds conversion internals ---------- */
  function decimalToAmerican(d) {
    var b = d - 1;
    if (b >= 1) return '+' + Math.round(b * 100);
    return '-' + Math.round(100 / b);
  }
  function decimalToFraction(d) {
    var best = approximateFraction(d - 1, 50);
    return best.num + '/' + best.den;
  }
  function approximateFraction(x, maxDen) {
    if (x <= 0) return { num: 0, den: 1 };
    var bestNum = 1, bestDen = 1, bestErr = Infinity;
    for (var den = 1; den <= maxDen; den++) {
      var num = Math.round(x * den);
      if (num <= 0) continue;
      var err = Math.abs(x - num / den);
      if (err < bestErr - 1e-9) { bestErr = err; bestNum = num; bestDen = den; }
    }
    var g = gcd(bestNum, bestDen);
    return { num: bestNum / g, den: bestDen / g };
  }
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = b; b = a % b; a = t; } return a || 1; }

  /* ---------- expose ---------- */
  BSP.isValidEmail = isValidEmail;
  BSP.NOTIF_KEYS = NOTIF_KEYS;
  global.BSP = BSP;

  // Kick off SDK init eagerly so the session restores as early as possible.
  ensureInit().catch(function () {});
})(typeof window !== 'undefined' ? window : this);
