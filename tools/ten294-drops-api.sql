-- TEN-294 — the drops page's ONE database read (founder ruling 2026-09-26: path B′, design doc `design`
-- approved on card 37612d3d). Idempotent; safe to re-run. Installs nothing scheduled and changes no bot.
--
-- WHAT A ROW IS. A row is an alert the live Telegram drop bot already wrote (ten280_bot.alerts for Bet105,
-- ten287_bot.alerts for Superbet, mode = 'live'). Nothing here re-detects a drop, so the page and Telegram
-- cannot disagree, and every price on a row is a stored price with its own stored clock.
--
-- WHO READS IT. Only the stennisfy-drops Fly app, through role drops_reader, which can EXECUTE this one
-- function and nothing else. anon / authenticated get nothing: a browser cannot read the database directly,
-- which is what keeps "500 viewers = 2 reads a minute" true (the Fly app caches and fans out).
--
-- FOUNDER ANSWERS (card 37612d3d, 2026-09-26):
--   Q3 "Dropped to" is the alert's price; "Latest" is a SEPARATE field, the side's latest pre-match price
--      with its own clock, read with EXACTLY the bot loader's filters and side mapping (ten280_bot.load_ticks /
--      ten287_bot.load_ticks) but per alert on existing indexes: calling the loaders themselves would
--      full-scan kibl_line_observations + kibl_now_history every 30 s (independent review, 2026-09-26).
--   Q4 rows = alerts detected in the last 24 h; a started match is flagged, never dropped silently.
create schema if not exists drops_api;
revoke all on schema drops_api from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'drops_reader') then
    create role drops_reader nologin;   -- LOGIN + password are set by the deploy step, never in this file
  end if;
end $$;
grant usage on schema drops_api to drops_reader;

create or replace function drops_api.snapshot(p_hours integer default 24) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, pg_temp
stable
as $$
declare
  v_now   timestamptz := now();
  v_from  timestamptz := now() - make_interval(hours => p_hours);
  v_rows  jsonb;
  v_src   jsonb;
begin
  with b105 as (
    select a.eval_at,
      jsonb_build_object(
        'id', 'bet105-' || a.id,
        'book', 'Bet105',
        'tier', a.tier,
        'playerA', a.player_a, 'playerB', a.player_b, 'side', a.side_player,
        'line', 'Match Winner',
        'scheduledStart', fx.scheduled_start,
        'open', case when a.open_price is null then null else jsonb_build_object(
                  'price', ten280_bot.px(a.open_price), 'at', a.open_at,
                  'kind', case when a.open_is_opener then 'book opener' else 'first seen' end) end,
        'preDrop', case when a.ref_price is null then null else
                   jsonb_build_object('price', ten280_bot.px(a.ref_price), 'at', a.ref_at) end,
        'droppedTo', case when a.cur_price is null then null else
                   jsonb_build_object('price', ten280_bot.px(a.cur_price), 'at', a.cur_at) end,
        'dropPct', case when a.ref_price > 0 and a.cur_price is not null
                        then round((a.ref_price - a.cur_price) / a.ref_price * 100, 1) end,
        'sinceOpenPct', case when a.open_price > 0 and a.cur_price is not null
                             then round((a.cur_price - a.open_price) / a.open_price * 100, 1) end,
        'detectedAt', a.eval_at,
        'latest', (select jsonb_build_object('price', ten280_bot.px(t.price), 'at', t.at)
                     from (
                       -- poller: load_ticks' filters, on kibl_lo_line_idx (fixture, market, segment, side, ...)
                       (select o.price_decimal as price, o.inserted_on as at
                          from public.kibl_line_observations o
                         where o.fixture_id = a.fixture_id and o.market_type_id = 1 and o.segment_id = 1
                           and o.side_id = a.side_id and o.feed_source_id = 171 and o.betting_type_id = 1
                           and o.is_live is false and o.price_decimal >= 1.01
                         order by o.inserted_on desc nulls last limit 1)
                       union all
                       -- stream: the Now price for this fixture, mapped to a side by load_ticks' surname rule
                       -- (same surname on both sides -> never guess)
                       (select p.price, p.kibl_inserted_on
                          from public.kibl_now_price p
                         where p.kind = 'price' and p.fixture_id = a.fixture_id and p.price >= 1.01
                           and ten280_bot.skey(fx.player1_name) <> ten280_bot.skey(fx.player2_name)
                           and p.side_key = ten280_bot.skey(case a.side_id when 2 then fx.player1_name
                                                                            when 3 then fx.player2_name end)
                         order by p.kibl_inserted_on desc limit 1)
                     ) t order by t.at desc nulls last limit 1),
        -- live evidence only; a passed scheduled time is reported separately, never as "started".
        -- Checked only from 3 h before the scheduled time (Kibl's earliest measured early start: 860 min is the
        -- one outlier, p95 -4.1 min): a not-yet-started fixture would otherwise scan all its rows every 30 s.
        'started', coalesce(fx.scheduled_start <= v_now + interval '3 hours', false)
                   and exists (select 1 from public.kibl_line_observations o
                                where o.fixture_id = a.fixture_id and o.is_live is true),
        'pastScheduledStart', fx.scheduled_start is not null and fx.scheduled_start <= v_now
      ) as j
    from ten280_bot.alerts a
    left join public.kibl_fixtures fx on fx.fixture_id = a.fixture_id
    where a.mode = 'live' and a.eval_at >= v_from
  ),
  sb as (
    select a.eval_at,
      jsonb_build_object(
        'id', 'superbet-' || a.id,
        'book', a.book,
        'tier', a.tier,
        'playerA', a.player_a, 'playerB', a.player_b, 'side', a.side_player,
        'line', 'Match Winner',
        'scheduledStart', ev.start_at,
        'open', case when a.open_price is null then null else jsonb_build_object(
                  'price', ten287_bot.px(a.open_price), 'at', a.open_at, 'kind', a.open_kind) end,
        'preDrop', case when a.ref_price is null then null else
                   jsonb_build_object('price', ten287_bot.px(a.ref_price), 'at', a.ref_at) end,
        'droppedTo', case when a.cur_price is null then null else
                   jsonb_build_object('price', ten287_bot.px(a.cur_price), 'at', a.cur_at) end,
        'dropPct', case when a.ref_price > 0 and a.cur_price is not null
                        then round((a.ref_price - a.cur_price) / a.ref_price * 100, 1) end,
        'sinceOpenPct', case when a.open_price > 0 and a.cur_price is not null
                             then round((a.cur_price - a.open_price) / a.open_price * 100, 1) end,
        'detectedAt', a.eval_at,
        -- load_ticks' filters (book, pending, updatedAt present, price >= 1.01), on ticks_event_idx
        'latest', (select jsonb_build_object('price', ten287_bot.px(t.price), 'at', t.book_updated_at)
                     from (select case a.side when 'home' then k.back_home else k.back_away end as price, k.book_updated_at
                             from ten287_rec.ticks k
                            where k.event_id = a.event_id and k.book = a.book and k.book_updated_at is not null
                              and coalesce(k.event_status, ev.status) = 'pending') t
                    where t.price >= 1.01
                    order by t.book_updated_at desc limit 1),
        -- live evidence only: cancelled / postponed are NOT "started"
        'started', coalesce(ev.status in ('live', 'settled', 'finished', 'ended'), false),
        'pastScheduledStart', ev.start_at is not null and ev.start_at <= v_now
      ) as j
    from ten287_bot.alerts a
    left join ten287_rec.events ev on ev.event_id = a.event_id
    where a.mode = 'live' and a.eval_at >= v_from
  )
  select coalesce(jsonb_agg(j order by eval_at desc), '[]'::jsonb) into v_rows
    from (select * from b105 union all select * from sb) u;

  -- Watermarks. Each is a backward scan on an existing index that stops at the first match: cheap at 2/min.
  -- A stalled bot with healthy feeds looks exactly like "no drops today" — hence the bot rows.
  select jsonb_build_array(
    jsonb_build_object('id', 'kibl-stream', 'label', 'Kibl stream (ATP)',
      'lastAt', (select p.written_at from public.kibl_now_price p where p.kind = 'heartbeat'
                  order by p.written_at desc limit 1)),
    jsonb_build_object('id', 'kibl-poller', 'label', 'Kibl poller (Challenger/ITF)',
      -- last_seen_at moves on EVERY sweep that sees a row; observed_at is first-seen only and stands
      -- still on a flat market (independent review) — kibl_lo_last_seen_idx
      'lastAt', (select o.last_seen_at from public.kibl_line_observations o where o.feed_source_id = 171
                  order by o.last_seen_at desc nulls last limit 1)),
    jsonb_build_object('id', 'superbet-recorder', 'label', 'Superbet recorder',
      'lastAt', (select r.processed_at from ten287_rec.requests r
                  where r.kind = 'updated' and r.book = 'Superbet' and r.status_code = 200
                  order by r.id desc limit 1)),
    jsonb_build_object('id', 'bet105-bot', 'label', 'Bet105 drop bot',
      'lastAt', (select d.end_time from cron.job_run_details d
                  where d.jobid = (select j.jobid from cron.job j where j.jobname = 'ten280-bet105-drop-bot')
                    and d.status = 'succeeded'
                  order by d.runid desc limit 1)),
    jsonb_build_object('id', 'superbet-bot', 'label', 'Superbet drop bot',
      'lastAt', (select d.end_time from cron.job_run_details d
                  where d.jobid = (select j.jobid from cron.job j where j.jobname = 'ten287-superbet-drop-bot')
                    and d.status = 'succeeded'
                  order by d.runid desc limit 1))
  ) into v_src;

  return jsonb_build_object('schema', 1, 'dbNow', v_now, 'windowHours', p_hours,
                            'rows', v_rows, 'sources', v_src);
end $$;

revoke all on function drops_api.snapshot(integer) from public, anon, authenticated;
grant execute on function drops_api.snapshot(integer) to drops_reader;
