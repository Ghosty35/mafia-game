export const CITIES = [
  'New York',
  'Chicago',
  'Los Angeles',
  'Miami',
  'Las Vegas',
] as const;

export type City = typeof CITIES[number];

export const DEFAULT_CITY: City = 'New York';