-- Update Hospital to support flexible/custom amount purchase
-- Player can enter any amount (1 to 100-current health)

create or replace function public.buy_health(amount int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.players;
  cost bigint;
  heal_amount int;
  max_heal int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if amount < 1 then raise exception 'INVALID_AMOUNT'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  max_heal := 100 - p.health;
  if max_heal <= 0 then
    raise exception 'ALREADY_FULL_HEALTH';
  end if;

  heal_amount := least(amount, max_heal);

  -- Dynamic pricing: 12 cash per health point (balanced, same as old 100-pack)
  cost := heal_amount * 12;

  if p.cash < cost then
    raise exception 'NOT_ENOUGH_CASH';
  end if;

  p.cash := p.cash - cost;
  p.health := least(100, p.health + heal_amount);

  update public.players set cash = p.cash, health = p.health where id = p.id;

  return jsonb_build_object(
    'player', to_jsonb(p), 
    'healed', heal_amount,
    'cost', cost
  );
end;
$$;

comment on function public.buy_health(int) is 'Flexible hospital purchase. Enter any amount up to what you need.';