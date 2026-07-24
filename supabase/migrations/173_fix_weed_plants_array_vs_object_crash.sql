-- water_weed_plant() and harvest_weed() both do:
--   jsonb_set(coalesce(p.weed_plants, '{}'::jsonb), '{quality}', to_jsonb(new_percent))
-- which crashes with "path element at position 1 is not an integer: quality" whenever
-- weed_plants is a JSONB ARRAY rather than an object (COALESCE only substitutes on NULL,
-- not on wrong-type non-null values). The players.weed_plants column defaults to '[]'::jsonb
-- (an array) -- confirmed 10 of 11 live players have it as '[]', so weed growing has been
-- completely broken for the entire playerbase (only water/harvest ever touch this column,
-- always via the ->'quality' key -- no code anywhere treats it as a real array).
alter table public.players alter column weed_plants set default '{}'::jsonb;

update public.players
set weed_plants = '{}'::jsonb
where jsonb_typeof(weed_plants) = 'array';
