/*
 * BSP Consult — GA4 behaviour analytics (TEN-8, item 8).
 *
 * Loads the GA4 gtag.js tag once per page, auto-sends a page_view, and exposes
 * a tiny global `teTrack(name, params)` — the GA4 logEvent() equivalent — that
 * every page (and auth.js) calls to record custom events. Plain
 * <script src="analytics.js">-includable, no modules.
 *
 * Sends to the same GA4 property already declared in the Firebase config
 * (measurementId G-L2RZQB615T), so app pages and the marketing funnel land in
 * one property. If the tag is blocked (ad blocker / offline), the dataLayer
 * shim keeps queuing harmlessly and teTrack stays a safe no-op.
 */
(function (global) {
  'use strict';

  var GA_ID = 'G-L2RZQB615T'; // GA4 measurement id — matches auth.js firebaseConfig

  var doc = global.document;
  if (!doc) return;

  // Canonical gtag bootstrap: dataLayer + shim must exist before the async
  // script loads so early calls replay once gtag.js is ready.
  global.dataLayer = global.dataLayer || [];
  function gtag() { global.dataLayer.push(arguments); }
  global.gtag = global.gtag || gtag;

  // Analytics only — no ad personalization.
  gtag('set', 'allow_ad_personalization_signals', false);
  gtag('js', new Date());
  gtag('config', GA_ID);

  // Load the tag async (non-blocking). A 404 / blocked request is harmless.
  var s = doc.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  doc.head.appendChild(s);

  // Public helper — the GA4 logEvent() equivalent. `name` is a GA4 event name
  // (snake_case), `params` an optional flat object of event parameters. Never
  // throws: analytics must never break a page.
  global.teTrack = function (name, params) {
    try { global.gtag('event', name, params || {}); } catch (e) { /* no-op */ }
  };
})(typeof window !== 'undefined' ? window : this);
