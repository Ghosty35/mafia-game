-- 092_all_properties_all_cities.sql
-- =====================================================================
-- Make every property type available in every city.
-- =====================================================================

INSERT INTO public.property_catalog (id, name, ptype, type, city, price, income, spots) VALUES
  -- Residential (fill missing city variants)
  ('villa_ny',    'Villa',           'villa',   'residential', 'New York',     75000,  120, 4),
  ('mansion_ny',  'Mansion',         'mansion', 'residential', 'New York',   1500000,  300, 8),
  ('house_chi',   'House',           'house',   'residential', 'Chicago',     15500,   41, 2),
  ('mansion_chi', 'Mansion',         'mansion', 'residential', 'Chicago',   1500000,  300, 8),
  ('villa_la',    'Villa',           'villa',   'residential', 'Los Angeles',  75000,  120, 4),
  ('house_la',    'House',           'house',   'residential', 'Los Angeles', 16000,   42, 2),
  ('mansion_la',  'Mansion',         'mansion', 'residential', 'Los Angeles',1550000,  295, 8),
  ('villa_mi',    'Villa',           'villa',   'residential', 'Miami',       78000,  125, 4),
  ('house_mi',    'House',           'house',   'residential', 'Miami',       15200,   39, 2),
  ('mansion_mi',  'Mansion',         'mansion', 'residential', 'Miami',     1500000,  300, 8),
  ('house_lv',    'House',           'house',   'residential', 'Las Vegas',   15000,   40, 2),
  ('villa_lv',    'Villa',           'villa',   'residential', 'Las Vegas',   82000,  130, 4),
  ('mansion_lv',  'Mansion',         'mansion', 'residential', 'Las Vegas', 1500000,  300, 8),

  -- Agencies (all cities)
  ('ts_ny',  'Train Station',    'agency', 'agency', 'New York',     25000,  100, 0),
  ('ts_chi', 'Train Station',    'agency', 'agency', 'Chicago',      25000,  100, 0),
  ('ts_la',  'Train Station',    'agency', 'agency', 'Los Angeles',  25000,  100, 0),
  ('ts_mi',  'Train Station',    'agency', 'agency', 'Miami',        25000,  100, 0),
  ('ts_lv',  'Train Station',    'agency', 'agency', 'Las Vegas',    25000,  100, 0),

  ('mf_ny',  'Metal Factory',   'agency', 'agency', 'New York',     45000,  240, 0),
  ('mf_chi', 'Metal Factory',   'agency', 'agency', 'Chicago',      45000,  240, 0),
  ('mf_la',  'Metal Factory',   'agency', 'agency', 'Los Angeles',  45000,  240, 0),
  ('mf_mi',  'Metal Factory',   'agency', 'agency', 'Miami',        45000,  240, 0),
  ('mf_lv',  'Metal Factory',   'agency', 'agency', 'Las Vegas',    45000,  240, 0),

  ('da_ny',  'Detective Agency','agency', 'agency', 'New York',     30000,  160, 0),
  ('da_chi', 'Detective Agency','agency', 'agency', 'Chicago',      30000,  160, 0),
  ('da_la',  'Detective Agency','agency', 'agency', 'Los Angeles',  30000,  160, 0),
  ('da_mi',  'Detective Agency','agency', 'agency', 'Miami',        30000,  160, 0),
  ('da_lv',  'Detective Agency','agency', 'agency', 'Las Vegas',    30000,  160, 0),

  ('h_ny',  'Hospital',        'agency', 'agency', 'New York',     35000,  180, 0),
  ('h_chi', 'Hospital',        'agency', 'agency', 'Chicago',      35000,  180, 0),
  ('h_la',  'Hospital',        'agency', 'agency', 'Los Angeles',  35000,  180, 0),
  ('h_mi',  'Hospital',        'agency', 'agency', 'Miami',        35000,  180, 0),
  ('h_lv',  'Hospital',        'agency', 'agency', 'Las Vegas',    35000,  180, 0),

  ('gb_ny',  'General Bank',   'agency', 'agency', 'New York',     80000,  400, 0),
  ('gb_chi', 'General Bank',   'agency', 'agency', 'Chicago',      80000,  400, 0),
  ('gb_la',  'General Bank',   'agency', 'agency', 'Los Angeles',  80000,  400, 0),
  ('gb_mi',  'General Bank',   'agency', 'agency', 'Miami',        80000,  400, 0),
  ('gb_lv',  'General Bank',   'agency', 'agency', 'Las Vegas',    80000,  400, 0),

  ('airport_ny',  'Airport',        'airport',  'agency', 'New York',    3000000,  800, 0),
  ('airport_chi', 'Airport',        'airport',  'agency', 'Chicago',     3000000,  800, 0),
  ('airport_la',  'Airport',        'airport',  'agency', 'Los Angeles', 3000000,  800, 0),
  ('airport_mi',  'Airport',        'airport',  'agency', 'Miami',       3000000,  800, 0),
  ('airport_lv',  'Airport',        'airport',  'agency', 'Las Vegas',   3000000,  800, 0),

  -- Casinos (all cities)
  ('roulette_ny',  'Roulette',      'casino', 'agency', 'New York',    2500000,  600, 0),
  ('roulette_chi', 'Roulette',      'casino', 'agency', 'Chicago',     2500000,  600, 0),
  ('roulette_la',  'Roulette',      'casino', 'agency', 'Los Angeles', 2500000,  600, 0),
  ('roulette_mi',  'Roulette',      'casino', 'agency', 'Miami',       2500000,  600, 0),
  ('roulette_lv',  'Roulette',      'casino', 'agency', 'Las Vegas',   2500000,  600, 0),

  ('blackjack_ny',  'Blackjack',     'casino', 'agency', 'New York',    2000000,  500, 0),
  ('blackjack_chi', 'Blackjack',     'casino', 'agency', 'Chicago',     2000000,  500, 0),
  ('blackjack_la',  'Blackjack',     'casino', 'agency', 'Los Angeles', 2000000,  500, 0),
  ('blackjack_mi',  'Blackjack',     'casino', 'agency', 'Miami',       2000000,  500, 0),
  ('blackjack_lv',  'Blackjack',     'casino', 'agency', 'Las Vegas',   2000000,  500, 0),

  ('numbers_ny',  'Numbers Game',  'casino', 'agency', 'New York',    800000,  250, 0),
  ('numbers_chi', 'Numbers Game',  'casino', 'agency', 'Chicago',     800000,  250, 0),
  ('numbers_la',  'Numbers Game',  'casino', 'agency', 'Los Angeles', 800000,  250, 0),
  ('numbers_mi',  'Numbers Game',  'casino', 'agency', 'Miami',       800000,  250, 0),
  ('numbers_lv',  'Numbers Game',  'casino', 'agency', 'Las Vegas',   800000,  250, 0),

  ('fruit_ny',  'Fruit Machine', 'casino', 'agency', 'New York',    600000,  200, 0),
  ('fruit_chi', 'Fruit Machine', 'casino', 'agency', 'Chicago',     600000,  200, 0),
  ('fruit_la',  'Fruit Machine', 'casino', 'agency', 'Los Angeles', 600000,  200, 0),
  ('fruit_mi',  'Fruit Machine', 'casino', 'agency', 'Miami',       600000,  200, 0),
  ('fruit_lv',  'Fruit Machine', 'casino', 'agency', 'Las Vegas',   600000,  200, 0),

  -- Tuneshop (all cities)
  ('tuneshop_ny', 'Tuneshop',      'tuneshop', 'agency', 'New York',    700000,  280, 0),
  ('tuneshop_chi','Tuneshop',      'tuneshop', 'agency', 'Chicago',     700000,  280, 0),
  ('tuneshop_la', 'Tuneshop',      'tuneshop', 'agency', 'Los Angeles', 700000,  280, 0),
  ('tuneshop_mi', 'Tuneshop',      'tuneshop', 'agency', 'Miami',       700000,  280, 0),
  ('tuneshop_lv', 'Tuneshop',      'tuneshop', 'agency', 'Las Vegas',   700000,  280, 0),

  -- Red Light District (all cities)
  ('rld_ny',  'Red Light Dist.', 'redlight', 'agency', 'New York',    1500000,  700, 0),
  ('rld_chi', 'Red Light Dist.', 'redlight', 'agency', 'Chicago',     1500000,  700, 0),
  ('rld_la',  'Red Light Dist.', 'redlight', 'agency', 'Los Angeles', 1500000,  700, 0),
  ('rld_mi',  'Red Light Dist.', 'redlight', 'agency', 'Miami',       1500000,  700, 0),
  ('rld_lv',  'Red Light Dist.', 'redlight', 'agency', 'Las Vegas',   1500000,  700, 0)
ON CONFLICT (id) DO NOTHING;
