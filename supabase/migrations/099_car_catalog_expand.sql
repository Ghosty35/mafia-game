-- 099_car_catalog_expand.sql
-- =====================================================================
-- Expand car_catalog from 9 cars (3 tiers) to 42 cars across 6 tiers:
--   default | low | mid | luxury | super | hyper
-- Existing 9 cars KEEP their purchase_price / base_value (so current
-- owners are not devalued); only their tier / fuel_tank / min_level are
-- aligned to the new 6-tier structure. The 33 new cars are inserted
-- with a balanced economy:
--   * base_value < purchase_price  (resale always below buy -> no buy/sell exploit)
--   * base_speed scales with tier  (race advantage)
--   * min_level gates progression
--   * fuel_tank scales with tier    (travel range)
-- =====================================================================

-- ---------- align the 9 existing cars to the new tier structure ----------
update public.car_catalog set tier = 'default', fuel_tank = 45, min_level = 1  where id = 'old_sedan';
update public.car_catalog set tier = 'default', fuel_tank = 60, min_level = 5  where id = 'sports_car';
update public.car_catalog set tier = 'low',     fuel_tank = 50, min_level = 1  where id in ('honda_civic','toyota_corolla','ford_focus','vw_golf');
update public.car_catalog set tier = 'mid',     fuel_tank = 70, min_level = 10 where id in ('lexus_is','nissan_altima');
update public.car_catalog set tier = 'mid',     fuel_tank = 80, min_level = 12 where id = 'mercedes_c';

-- ---------- insert the 33 new cars (id, name, tier, base_value, base_speed, purchase_price, fuel_tank, min_level) ----------

-- default tier (starter beaters)
insert into public.car_catalog (id, name, tier, base_value, base_speed, purchase_price, fuel_tank, min_level) values
  ('dacia_logan',     'Dacia Logan',      'default', 1800,  72,  2500,  45, 1),
  ('hyundai_accent',  'Hyundai Accent',   'default', 2000,  76,  2800,  45, 1),
  ('kia_rio',         'Kia Rio',          'default', 2000,  76,  2800,  45, 1),
  ('nissan_versa',    'Nissan Versa',     'default', 2100,  78,  3000,  45, 1),
  ('chevrolet_spark', 'Chevrolet Spark',  'default', 1600,  70,  2200,  45, 1)
on conflict (id) do nothing;

-- low tier (daily drivers)
insert into public.car_catalog (id, name, tier, base_value, base_speed, purchase_price, fuel_tank, min_level) values
  ('mazda3',        'Mazda 3',         'low', 11000, 100, 16000, 50, 1),
  ('subaru_impreza','Subaru Impreza',  'low', 12000, 102, 18000, 50, 1),
  ('skoda_octavia', 'Skoda Octavia',   'low', 10000,  98, 15000, 50, 1)
on conflict (id) do nothing;

-- mid tier (executive)
insert into public.car_catalog (id, name, tier, base_value, base_speed, purchase_price, fuel_tank, min_level) values
  ('bmw_3',       'BMW 3 Series',   'mid', 38000, 122, 55000, 60, 10),
  ('audi_a4',     'Audi A4',        'mid', 40000, 124, 58000, 60, 10),
  ('volvo_s60',   'Volvo S60',      'mid', 34000, 120, 50000, 60, 10),
  ('tesla_model3','Tesla Model 3',  'mid', 60000, 130, 90000, 60, 10)
on conflict (id) do nothing;

-- luxury tier
insert into public.car_catalog (id, name, tier, base_value, base_speed, purchase_price, fuel_tank, min_level) values
  ('mercedes_e',   'Mercedes E-Class', 'luxury', 120000, 148, 180000, 70, 20),
  ('bmw_5',        'BMW 5 Series',     'luxury', 130000, 150, 190000, 70, 20),
  ('audi_a6',      'Audi A6',          'luxury', 125000, 149, 185000, 70, 20),
  ('lexus_es',     'Lexus ES',         'luxury', 110000, 146, 160000, 70, 20),
  ('genesis_g80',  'Genesis G80',      'luxury', 100000, 145, 150000, 70, 20),
  ('jaguar_xf',    'Jaguar XF',        'luxury', 115000, 147, 170000, 70, 20),
  ('porsche_macan','Porsche Macan',    'luxury', 200000, 155, 300000, 70, 20)
on conflict (id) do nothing;

-- super tier
insert into public.car_catalog (id, name, tier, base_value, base_speed, purchase_price, fuel_tank, min_level) values
  ('chevrolet_corvette','Chevrolet Corvette','super', 380000, 168, 550000, 80, 35),
  ('bmw_m4',           'BMW M4',           'super', 430000, 171, 650000, 80, 35),
  ('nissan_gtr',       'Nissan GT-R',      'super', 480000, 172, 700000, 80, 35),
  ('porsche_911',      'Porsche 911',      'super', 400000, 170, 600000, 80, 35),
  ('mercedes_amg_gt',  'Mercedes-AMG GT',  'super', 550000, 175, 800000, 80, 35),
  ('audi_r8',          'Audi R8',          'super', 600000, 178, 900000, 80, 35),
  ('aston_vantage',    'Aston Martin Vantage','super', 750000, 180, 1100000, 80, 35)
on conflict (id) do nothing;

-- hyper tier (prestige: top car ~2x the most expensive property/Airport at $3M)
insert into public.car_catalog (id, name, tier, base_value, base_speed, purchase_price, fuel_tank, min_level) values
  ('lamborghini_huracan','Lamborghini Huracan','hyper', 2100000, 200, 3000000,  90, 50),
  ('ferrari_sf90',      'Ferrari SF90',      'hyper', 2450000, 205, 3500000,  90, 50),
  ('mclaren_720s',      'McLaren 720S',      'hyper', 2800000, 208, 4000000,  90, 50),
  ('pagani_huayra',     'Pagani Huayra',     'hyper', 3500000, 212, 5000000,  90, 50),
  ('bugatti_chiron',    'Bugatti Chiron',    'hyper', 3850000, 215, 5500000,  90, 50),
  ('koenigsegg_jesko',  'Koenigsegg Jesko',  'hyper', 4200000, 225, 6000000,  90, 50),
  ('rimac_nevera',      'Rimac Nevera',      'hyper', 4900000, 230, 7000000,  90, 50)
on conflict (id) do nothing;
