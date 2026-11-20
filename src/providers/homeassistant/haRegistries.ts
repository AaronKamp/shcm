import { isRecord, str } from '../../core/json';

/** Per-entity details that live in HA's registries, not in `get_states`. */
export interface EntityRegistryInfo {
  /** Area name: the entity's own area, else its device's area. */
  readonly area?: string;
  /** HA marks it config/diagnostic, or the user hid it in HA. */
  readonly secondary: boolean;
  /** The integration that created the entity, e.g. `spotify`, `music_assistant`. */
  readonly platform?: string;
}

/** Registry change events that should trigger a refresh. */
export const REGISTRY_EVENTS = ['area_registry_updated', 'device_registry_updated', 'entity_registry_updated'] as const;

type Request = (payload: Record<string, unknown>) => Promise<unknown>;

const records = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : []);

/**
 * Reads the area, device and entity registries and joins them per entity_id.
 * Entities not in the entity registry (YAML-only, no unique_id) are absent;
 * callers treat them as primary with no area.
 */
export const fetchRegistryInfo = async (request: Request): Promise<Map<string, EntityRegistryInfo>> => {
  const [areas, devices, entities] = await Promise.all([
    request({ type: 'config/area_registry/list' }),
    request({ type: 'config/device_registry/list' }),
    request({ type: 'config/entity_registry/list' }),
  ]);

  const areaName = new Map(records(areas).map((a) => [str(a['area_id']), str(a['name'])]));
  const deviceArea = new Map(records(devices).map((d) => [str(d['id']), str(d['area_id'])]));

  const out = new Map<string, EntityRegistryInfo>();
  for (const e of records(entities)) {
    const entityId = str(e['entity_id']);
    if (!entityId) continue;
    const areaId = str(e['area_id']) || deviceArea.get(str(e['device_id'])) || '';
    const area = areaName.get(areaId) || undefined;
    const secondary = e['entity_category'] === 'config' || e['entity_category'] === 'diagnostic' || (e['hidden_by'] !== null && e['hidden_by'] !== undefined);
    const platform = str(e['platform']) || undefined;
    out.set(entityId, { secondary, ...(area ? { area } : {}), ...(platform ? { platform } : {}) });
  }
  return out;
};
