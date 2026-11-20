import type { ProviderStatus } from '../core/types';
import { useDeviceStore } from '../state/deviceStore';

const TONE: Record<ProviderStatus, string> = {
  idle: 'bg-slate-500',
  connecting: 'bg-warn animate-pulse',
  reconnecting: 'bg-warn animate-pulse',
  connected: 'bg-ok',
  error: 'bg-bad',
  disconnected: 'bg-slate-500',
};

const NAMES: Record<string, string> = {
  home_assistant: 'Home Assistant',
  unifi_protect: 'UniFi Protect',
  custom_hook: 'Plugins',
  mock: 'Mock',
};

export function ProviderStatusPills() {
  const statuses = useDeviceStore((s) => s.statuses);
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="Provider status">
      {Object.entries(statuses).flatMap(([id, status]) => (status === undefined ? [] : [[id, status] as const])).map(([id, status]) => (
        <li key={id} className="flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-xs text-slate-300" title={status}>
          <span className={`h-2 w-2 rounded-full ${TONE[status]}`} aria-hidden />
          {NAMES[id] ?? id}
        </li>
      ))}
    </ul>
  );
}
