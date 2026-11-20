import type { ProviderEvent } from './types';

/**
 * Coalesces high-frequency provider events and flushes them in batches
 * (CLAUDE.md rule 2). Within one window only the latest event per uid survives,
 * so a light dimming 60x/sec produces one UI update per window.
 */
export class StateThrottler {
  private pending = new Map<string, ProviderEvent>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly flush: (batch: readonly ProviderEvent[]) => void,
    private readonly windowMs = 100,
  ) {}

  push(event: ProviderEvent): void {
    this.pending.set(StateThrottler.keyOf(event), event);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.drain(), this.windowMs);
    }
  }

  /** Flush immediately (e.g. on teardown). */
  drain(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.size === 0) return;
    const batch = [...this.pending.values()];
    this.pending = new Map();
    this.flush(batch);
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }

  private static keyOf(event: ProviderEvent): string {
    switch (event.type) {
      case 'entity_upsert':
        return `e:${event.entity.uid}`;
      case 'entity_removed':
        return `e:${event.uid}`;
      case 'camera_upsert':
        return `c:${event.camera.uid}`;
      case 'camera_removed':
        return `c:${event.uid}`;
      case 'status':
        return `s:${event.providerId}`;
    }
  }
}
