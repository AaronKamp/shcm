import type { PluginDeviceSpec } from './pluginTypes';

/**
 * Reference device specs showing each transport. Not loaded by default.
 * Hosts/tokens come from `{{env.*}}` so secrets stay out of device definitions.
 */
export const EXAMPLE_PLUGIN_DEVICES: readonly PluginDeviceSpec[] = [
  {
    // Local HTTP: Shelly Gen1 relay (`/relay/0?turn=on`, state at `/relay/0`).
    id: 'shelly_porch',
    name: 'Porch Light',
    domain: 'switch',
    area: 'Porch',
    commands: {
      turn_on: { request: { kind: 'http', url: 'http://{{env.shelly_porch_host}}/relay/0?turn=on' }, parseResponse: { type: 'json', stateField: 'ison', map: { true: 'on', false: 'off' } } },
      turn_off: { request: { kind: 'http', url: 'http://{{env.shelly_porch_host}}/relay/0?turn=off' }, parseResponse: { type: 'json', stateField: 'ison', map: { true: 'on', false: 'off' } } },
    },
    state: {
      kind: 'poll',
      intervalMs: 10_000,
      request: { kind: 'http', url: 'http://{{env.shelly_porch_host}}/relay/0' },
      parse: { type: 'json', stateField: 'ison', map: { true: 'on', false: 'off' } },
    },
  },
  {
    // Raw TCP: Denon/Marantz AVR telnet protocol on port 23.
    id: 'denon_avr',
    name: 'Theater AVR',
    domain: 'media_player',
    area: 'Theater',
    commands: {
      turn_on: { request: { kind: 'tcp', host: '{{env.avr_host}}', port: 23, payload: 'PWON', lineEnding: '\r', readUntil: 'none' }, resultState: 'on' },
      turn_off: { request: { kind: 'tcp', host: '{{env.avr_host}}', port: 23, payload: 'PWSTANDBY', lineEnding: '\r', readUntil: 'none' }, resultState: 'off' },
      set_volume: {
        // payload.level is the AVR's 0-98 scale, e.g. { level: 45 }
        request: { kind: 'tcp', host: '{{env.avr_host}}', port: 23, payload: 'MV{{payload.level}}', lineEnding: '\r', readUntil: 'none' },
        resultAttributes: { volume_raw: '{{payload.level}}' },
      },
    },
    state: {
      kind: 'poll',
      intervalMs: 20_000,
      request: { kind: 'tcp', host: '{{env.avr_host}}', port: 23, payload: 'PW?', lineEnding: '\r', readUntil: 'line' },
      parse: { type: 'regex', pattern: 'PW(ON|STANDBY)', map: { ON: 'on', STANDBY: 'off' } },
    },
  },
  {
    // Cloud/LAN webhook: fire-and-forget trigger with a bearer token.
    id: 'garage_webhook',
    name: 'Garage Opener',
    domain: 'cover',
    area: 'Garage',
    commands: {
      trigger: {
        request: {
          kind: 'http',
          method: 'POST',
          url: '{{env.garage_webhook_url}}',
          headers: { Authorization: 'Bearer {{env.garage_token}}' },
          body: { action: '{{action}}', device: '{{target}}' },
        },
      },
    },
  },
];
