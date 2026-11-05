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
    perform ten287_bot.load_ticks(bk, now() - interval '14 days', now());
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
