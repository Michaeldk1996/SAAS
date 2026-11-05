-- The odds-api.io drop bot (ten287_bot, pg_cron ten287-superbet-drop-bot, every 30 s) for EVERY book in
-- ten287_bot.config.books (founder 2026-11-05: Napoleon Sports BE beside Superbet). Same rules for each book: >= 5%
-- vs the price 10 min earlier, no floor, 30-min cooldown per match PER BOOK (scan's cooldown reads a.book), pre-match
-- ATP-scope men's singles match winner, cut at the live start (TEN-299, load_ticks). scan / load_ticks are book-generic
-- already (tools/ten299-live-cut.sql); only tick() (one book) and render() (a "SUPERBET DROP" header) named Superbet.
-- Additive and idempotent: run it again any time. Rollback: update ten287_bot.config set books = array['Superbet'].
-- A book here must also be in ten287_rec.config.books (the recorder) or it has no ticks and never alerts.

alter table ten287_bot.config add column if not exists books text[];
update ten287_bot.config set books = array[book, 'Napoleon Sports BE'] where books is null;

-- the header names the alert's own book: "🟢 SUPERBET DROP", "🟢 NAPOLEON SPORTS BE DROP"; every other line as before
create or replace function ten287_bot.render(a ten287_bot.alerts, p_at timestamp with time zone) returns text
language sql stable as $$
  select concat_ws(chr(10),
    format('🟢 %s DROP', upper(coalesce(a.book, 'Superbet'))),
    '',
    format('🎾 Match: %s vs %s (%s)', coalesce(a.player_a, '—'), coalesce(a.player_b, '—'), coalesce(a.tier, '—')),
    format('🎯 Line: Match Winner – %s', coalesce(a.side_player, '—')),
    case when a.open_price is null then '🟢 Opening: —'
         else format('🟢 Opening: %s @ %s (%s)', ten287_bot.px(a.open_price), ten287_bot.hhmm(a.open_at), a.open_kind) end,
    format('🟠 Pre-drop: %s @ %s', ten287_bot.px(a.ref_price), ten287_bot.hhmm(a.ref_at)),
    format('🔴 Odds now: %s @ %s', ten287_bot.px(a.cur_price), ten287_bot.hhmm(a.cur_at)),
    format('📉 Drop (10 min): −%s%%', to_char(round((a.ref_price - a.cur_price) / a.ref_price * 100, 1), 'FM9990.0')),
    case when a.open_price is null then '➡️ Since open: —'
         else format('%s Since open: %s',
                case sign(round((a.cur_price - a.open_price) / a.open_price * 100, 1)) when 1 then '↗️' when -1 then '↘️' else '➡️' end,
                ten287_bot.spct((a.cur_price - a.open_price) / a.open_price * 100)) end,
    format('⏱️ Moved: %s', ten287_bot.moved(extract(epoch from (p_at - a.cur_at))::numeric)),
    format('🏦 Bookmaker: %s', a.book))
$$;

-- DB load (2026-11-05): load_ticks read 14 days of ten287_rec.ticks for every book every 30 s (two books since the
-- Napoleon change: the Superbet bot was the second-largest disk reader). load_ticks_live is tools/ten299-live-cut.sql's
-- load_ticks plus ONE predicate: only matches with a tick in the scan window. scan(e, e) needs a current tick inside
-- (e - window, e], so every alert, its reference price and its opening (the earliest tick held) are unchanged.
-- tools/test-ten287-books-sql.py checks it is load_ticks + that predicate, and that tick() alerts as before.
create or replace function ten287_bot.load_ticks_live(p_book text, p_from timestamp with time zone, p_to timestamp with time zone, p_window interval)
 RETURNS integer
 LANGUAGE plpgsql
AS $fn$
declare n integer;
begin
  drop table if exists pg_temp.t287;
  create temp table t287 as
  with raw as (
    select t.event_id, s.side, s.price, t.book_updated_at as at, t.seen_at as known_at, t.event_status
    from ten287_rec.ticks t
    join ten287_rec.events e using (event_id)
    cross join lateral (values ('home', t.back_home), ('away', t.back_away)) s(side, price)
    where t.book = p_book and e.tier is not null
      and coalesce(t.event_status, e.status) = 'pending'   -- a tick without a status falls back to the event's current one
      and s.price >= 1.01 and t.book_updated_at is not null
      and t.book_updated_at between p_from and p_to and t.seen_at <= p_to
      -- LIVE: only the matches with a tick inside (p_to - p_window, p_to] (ticks_book_upd_idx): scan(p_to, p_to)
      -- alerts only on a side whose latest tick is in that window, and keeps every older tick of those matches
      and t.event_id in (select w.event_id from ten287_rec.ticks w
                          where w.book = p_book and w.book_updated_at > p_to - p_window
                            and w.book_updated_at <= p_to and w.seen_at <= p_to)
  ),
  ordered as (
    select *, lag(price) over (partition by event_id, side order by at, known_at) as prev_price from raw
  )
  select event_id, side, price, at, known_at from ordered where prev_price is distinct from price;
  create index on t287 (event_id, side, at);
  -- TEN-299 (founder comment 8585095a, card 518c56f0): no price at or after the match's live start is
  -- pre-match; with the in-play ticks gone, no alert fires on a started match and every drop is measured
  -- against a pre-match price. The cut is drops_live.cuts_287 (tools/ten299-live-cut.sql).
  -- the cuts stay in pg_temp.cut287 for this bot's scan, which evaluates nothing at or after a cut
  drop table if exists pg_temp.cut287;
  create temp table cut287 as select * from drops_live.cuts_287(greatest(p_from, p_to - interval '4 days') - interval '2 days');
  delete from pg_temp.t287 t using pg_temp.cut287 c
   where t.event_id = c.event_id and t.at >= c.cut_at;
  select count(*) into n from t287;
  return n;
end $fn$
;

-- one scan per book (each loads its own ticks into pg_temp.t287 first), then up to 10 unsent live alerts sent
create or replace function ten287_bot.tick() returns integer
language plpgsql as $$
declare e timestamptz := now(); n integer := 0; a ten287_bot.alerts; rid bigint; v_at timestamptz; msg text;
        fl numeric; bks text[]; bk text;
begin
  if not pg_try_advisory_xact_lock(287287) then return 0; end if;
  perform ten287_bot.settle();
  select min_dropped_to_price, coalesce(books, array[book]) into fl, bks from ten287_bot.config;
  foreach bk in array bks loop
    -- load_ticks_live: the same 14 days, but only for matches with a tick in the scan's 10-minute window (DB load,
    -- 2026-11-05) — the only matches scan(e, e) can alert on, so the alerts are identical
    perform ten287_bot.load_ticks_live(bk, now() - interval '14 days', now(), interval '10 minutes');
    n := n + ten287_bot.scan(bk, e, e, 5, 'live', null, interval '10 minutes', fl);
  end loop;
  for a in select * from ten287_bot.alerts where mode = 'live' and delivery = 'unsent' order by id limit 10 loop
    v_at := clock_timestamp();
    msg  := ten287_bot.render(a, v_at);
    rid  := ten287_bot.send(msg);
    update ten287_bot.alerts set net_request_id = rid, message = msg,
                                 sent_at = case when rid is not null then v_at end,
                                 move_delay_s = case when rid is not null then round(extract(epoch from (v_at - a.cur_at))::numeric, 3) end,
                                 delivery = case when rid is null then 'unsent: no vault secret' else 'queued' end
     where id = a.id;
  end loop;
  return n;
end $$;
