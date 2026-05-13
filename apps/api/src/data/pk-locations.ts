/**
 * Reference list of Pakistani cities and their main areas/sectors
 * with approximate centroid coordinates (lat, lng).
 *
 * This is used to populate dropdowns on the admin web for store
 * creation, zone creation, and any other location-aware UI. The
 * coordinates are approximate; users can fine-tune them via the map.
 *
 * Source: open geo data, manually curated.
 */

export interface PkArea {
  name: string;
  lat: number;
  lng: number;
}

export interface PkCity {
  name: string;
  countryCode: 'PK';
  center: { lat: number; lng: number };
  areas: PkArea[];
}

export const PK_CITIES: PkCity[] = [
  {
    name: 'Islamabad',
    countryCode: 'PK',
    center: { lat: 33.6844, lng: 73.0479 },
    areas: [
      { name: 'F-6',         lat: 33.7295, lng: 73.0848 },
      { name: 'F-7',         lat: 33.7177, lng: 73.0535 },
      { name: 'F-8',         lat: 33.7095, lng: 73.0405 },
      { name: 'F-10',        lat: 33.6911, lng: 73.0184 },
      { name: 'F-11',        lat: 33.6857, lng: 73.0058 },
      { name: 'G-6',         lat: 33.7220, lng: 73.0890 },
      { name: 'G-7',         lat: 33.7100, lng: 73.0701 },
      { name: 'G-8',         lat: 33.6953, lng: 73.0481 },
      { name: 'G-9',         lat: 33.6883, lng: 73.0322 },
      { name: 'G-10',        lat: 33.6783, lng: 73.0163 },
      { name: 'G-11',        lat: 33.6649, lng: 73.0017 },
      { name: 'G-13',        lat: 33.6469, lng: 72.9711 },
      { name: 'G-14',        lat: 33.6429, lng: 72.9512 },
      { name: 'I-8',         lat: 33.6645, lng: 73.0703 },
      { name: 'I-9',         lat: 33.6536, lng: 73.0593 },
      { name: 'I-10',        lat: 33.6431, lng: 73.0418 },
      { name: 'I-11',        lat: 33.6320, lng: 73.0210 },
      { name: 'E-7',         lat: 33.7327, lng: 73.0664 },
      { name: 'E-11',        lat: 33.7038, lng: 72.9851 },
      { name: 'Bahria Town', lat: 33.5217, lng: 73.0913 },
      { name: 'DHA Phase 1', lat: 33.5301, lng: 73.1610 },
      { name: 'DHA Phase 2', lat: 33.5189, lng: 73.1817 },
      { name: 'PWD',         lat: 33.5562, lng: 73.1574 },
    ],
  },
  {
    name: 'Rawalpindi',
    countryCode: 'PK',
    center: { lat: 33.5651, lng: 73.0169 },
    areas: [
      { name: 'Saddar',         lat: 33.5970, lng: 73.0469 },
      { name: 'Westridge',      lat: 33.5870, lng: 72.9930 },
      { name: 'Satellite Town', lat: 33.6391, lng: 73.0680 },
      { name: 'Bahria Town RWP',lat: 33.5217, lng: 73.0913 },
      { name: 'Chaklala',       lat: 33.5764, lng: 73.0951 },
      { name: 'Adiala',         lat: 33.4914, lng: 72.9866 },
      { name: 'Murree Road',    lat: 33.6188, lng: 73.0671 },
    ],
  },
  {
    name: 'Lahore',
    countryCode: 'PK',
    center: { lat: 31.5204, lng: 74.3587 },
    areas: [
      { name: 'DHA Phase 1',     lat: 31.4881, lng: 74.3990 },
      { name: 'DHA Phase 2',     lat: 31.4775, lng: 74.4015 },
      { name: 'DHA Phase 3',     lat: 31.4720, lng: 74.4181 },
      { name: 'DHA Phase 4',     lat: 31.4669, lng: 74.4378 },
      { name: 'DHA Phase 5',     lat: 31.4757, lng: 74.4099 },
      { name: 'DHA Phase 6',     lat: 31.4641, lng: 74.4291 },
      { name: 'DHA Phase 7',     lat: 31.4520, lng: 74.4456 },
      { name: 'DHA Phase 8',     lat: 31.4377, lng: 74.4540 },
      { name: 'Bahria Town LHR', lat: 31.3640, lng: 74.1925 },
      { name: 'Gulberg',         lat: 31.5160, lng: 74.3436 },
      { name: 'Model Town',      lat: 31.4830, lng: 74.3239 },
      { name: 'Johar Town',      lat: 31.4697, lng: 74.2728 },
      { name: 'Wapda Town',      lat: 31.4231, lng: 74.2680 },
      { name: 'Garden Town',     lat: 31.4945, lng: 74.3185 },
      { name: 'Cantt',           lat: 31.5316, lng: 74.4084 },
      { name: 'Iqbal Town',      lat: 31.5093, lng: 74.2862 },
      { name: 'Faisal Town',     lat: 31.4844, lng: 74.3055 },
      { name: 'Township',        lat: 31.4575, lng: 74.3017 },
    ],
  },
  {
    name: 'Karachi',
    countryCode: 'PK',
    center: { lat: 24.8607, lng: 67.0011 },
    areas: [
      { name: 'Clifton',        lat: 24.8138, lng: 67.0298 },
      { name: 'DHA Karachi',    lat: 24.8000, lng: 67.0667 },
      { name: 'Gulshan-e-Iqbal',lat: 24.9189, lng: 67.0915 },
      { name: 'North Nazimabad',lat: 24.9437, lng: 67.0376 },
      { name: 'Korangi',        lat: 24.8302, lng: 67.1490 },
      { name: 'Saddar',         lat: 24.8554, lng: 67.0095 },
    ],
  },
];

export function findCity(name: string): PkCity | undefined {
  return PK_CITIES.find((c) => c.name.toLowerCase() === name.toLowerCase());
}
