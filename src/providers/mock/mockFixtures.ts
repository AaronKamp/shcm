import type { EntityDomain, JsonObject } from '../../core/types';

export interface MockEntitySeed {
  readonly id: string;
  readonly domain: EntityDomain;
  readonly name: string;
  readonly area: string;
  readonly state: string;
  readonly attributes: JsonObject;
}

export interface MockCameraSeed {
  readonly id: string;
  readonly name: string;
}

/** Offline fixtures covering every domain the Gemini tool schema mentions. */
export const MOCK_ENTITIES: readonly MockEntitySeed[] = [
  { id: 'light.kitchen', domain: 'light', name: 'Kitchen Lights', area: 'Kitchen', state: 'on', attributes: { brightness: 200 } },
  { id: 'light.living_room', domain: 'light', name: 'Living Room Lamp', area: 'Living Room', state: 'off', attributes: { brightness: 0 } },
  { id: 'switch.patio_string', domain: 'switch', name: 'Patio String Lights', area: 'Patio', state: 'off', attributes: {} },
  { id: 'lock.front_door', domain: 'lock', name: 'Front Door', area: 'Entry', state: 'locked', attributes: { battery: 87 } },
  {
    id: 'climate.main',
    domain: 'climate',
    name: 'Thermostat',
    area: 'Hallway',
    state: 'heat',
    attributes: { current_temperature: 69.5, temperature: 70, hvac_modes: ['off', 'heat', 'cool', 'auto'] },
  },
  {
    id: 'media_player.avr',
    domain: 'media_player',
    name: 'Loft AVR',
    area: 'Loft',
    state: 'on',
    // Shaped like HA's denonavr entity, which reports these attributes.
    attributes: {
      volume_level: 0.35,
      is_volume_muted: false,
      source: 'TV Audio',
      source_list: ['TV Audio', 'Blu-ray', 'Game', 'Media Player', 'Tuner', 'Network', 'Bluetooth', 'Phono'],
      sound_mode: 'STEREO',
      sound_mode_list: ['STEREO', 'DIRECT', 'PURE DIRECT', 'DOLBY DIGITAL', 'DTS SURROUND', 'MULTI CH STEREO', 'MOVIE', 'MUSIC'],
      supported_features: 69004,
    },
  },
  {
    id: 'media_player.chromecast_ultra',
    domain: 'media_player',
    name: 'Chromecast Ultra',
    area: 'Loft',
    state: 'off',
    attributes: { volume_level: 0.5, is_volume_muted: false },
  },
  // Spotify integration: one player per account; Connect devices are its sources.
  {
    id: 'media_player.spotify_home',
    domain: 'media_player',
    name: 'Spotify',
    area: 'Music',
    state: 'paused',
    attributes: {
      source: 'Kitchen speaker',
      source_list: ['Chromecast Ultra', 'Kitchen speaker', 'Whole House'],
      media_title: 'Dreams',
      media_artist: 'Fleetwood Mac',
      volume_level: 0.4,
    },
  },
  // Music Assistant: its own player per speaker, tagged with mass_* attributes.
  {
    id: 'media_player.chromecast_ultra_2',
    domain: 'media_player',
    name: 'Chromecast Ultra (Music Assistant)',
    area: 'Music',
    state: 'idle',
    attributes: { mass_player_type: 'player', media_title: 'Harvest Moon', media_artist: 'Neil Young', volume_level: 0.5, group_members: [] },
  },
  {
    id: 'media_player.den_chromecast',
    domain: 'media_player',
    name: 'Den Chromecast',
    area: 'Den',
    state: 'idle',
    attributes: { mass_player_type: 'player', volume_level: 0.3, group_members: [] },
  },
  { id: 'vacuum.roborock', domain: 'vacuum', name: 'Robot Vacuum', area: 'Downstairs', state: 'docked', attributes: { battery_level: 100 } },
  { id: 'cover.garage_door', domain: 'cover', name: 'Garage Door', area: 'Garage', state: 'closed', attributes: {} },
  { id: 'sensor.outdoor_temp', domain: 'sensor', name: 'Outdoor Temperature', area: 'Outside', state: '48.2', attributes: { unit_of_measurement: '°F' } },
  { id: 'binary_sensor.driveway_motion', domain: 'binary_sensor', name: 'Driveway Motion', area: 'Outside', state: 'off', attributes: {} },
  { id: 'binary_sensor.front_door_motion', domain: 'binary_sensor', name: 'Front Door Motion', area: 'Outside', state: 'off', attributes: { device_class: 'motion' } },
  {
    id: 'weather.forecast_home',
    domain: 'weather',
    name: 'Forecast Home',
    area: 'Outside',
    state: 'partlycloudy',
    attributes: { temperature: 48.2, temperature_unit: '°F' },
  },
];

export const MOCK_CAMERAS: readonly MockCameraSeed[] = [
  { id: 'cam_driveway', name: 'Driveway' },
  { id: 'cam_front_door', name: 'Front Door' },
  { id: 'cam_patio', name: 'Patio' },
  { id: 'cam_garage', name: 'Garage' },
];

/** Resulting state for each mock action, keyed by `${domain}.${action}`. */
export const MOCK_ACTION_STATES: Readonly<Record<string, string>> = {
  'light.turn_on': 'on',
  'light.turn_off': 'off',
  'switch.turn_on': 'on',
  'switch.turn_off': 'off',
  'lock.lock': 'locked',
  'lock.unlock': 'unlocked',
  'media_player.turn_on': 'on',
  'media_player.turn_off': 'off',
  'media_player.media_play': 'playing',
  'media_player.media_pause': 'paused',
  'media_player.play_media': 'playing',
  'vacuum.start': 'cleaning',
  'vacuum.pause': 'paused',
  'vacuum.return_to_base': 'returning',
  'cover.open_cover': 'open',
  'cover.close_cover': 'closed',
};
