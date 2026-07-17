-- 078: Tax Bank leaderboard
--
-- Bug-inspectie: "Tax Bank Leaderboard — current Tax Bank Value, highest value
-- overall, lowest value overall."
--
-- players.gov_tax_bank already accumulates every dollar a player has paid in
-- property bills (pay_property_bill) and voluntary deposits (gov_tax_deposit);
-- nothing ever read it back. This exposes it as a ranking plus the three
-- headline numbers, and tells you where you personally stand.
--
-- DEFINER because players is RLS owner-read: the board has to see everyone.

create or replace function public.get_tax_leaderboard(p_limit int default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  return jsonb_build_object(
    'total_pool', (select coalesce(sum(gov_tax_bank), 0) from public.players),
    'contributors', (select count(*) from public.players where coalesce(gov_tax_bank, 0) > 0),
    'highest', (
      select jsonb_build_object('username', username, 'amount', gov_tax_bank)
      from public.players
      where coalesce(gov_tax_bank, 0) > 0
      order by gov_tax_bank desc, username
      limit 1
    ),
    -- "lowest overall" only means something among people who actually paid.
    'lowest', (
      select jsonb_build_object('username', username, 'amount', gov_tax_bank)
      from public.players
      where coalesce(gov_tax_bank, 0) > 0
      order by gov_tax_bank asc, username
      limit 1
    ),
    'me', (
      select jsonb_build_object(
        'username', p.username,
        'amount', coalesce(p.gov_tax_bank, 0),
        'rank', case
          when coalesce(p.gov_tax_bank, 0) = 0 then null
          else (select count(*) + 1 from public.players o
                 where coalesce(o.gov_tax_bank, 0) > coalesce(p.gov_tax_bank, 0))
        end
      )
      from public.players p where p.id = auth.uid()
    ),
    'top', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'pos', t.pos,
        'username', t.username,
        'amount', t.gov_tax_bank,
        'is_donator', t.is_donator
      ) order by t.pos), '[]'::jsonb)
      from (
        select username, gov_tax_bank, is_donator,
               row_number() over (order by gov_tax_bank desc, username) as pos
        from public.players
        where coalesce(gov_tax_bank, 0) > 0
        limit v_limit
      ) t
    )
  );
end;
$$;

revoke all on function public.get_tax_leaderboard(int) from public, anon;
grant execute on function public.get_tax_leaderboard(int) to authenticated;
