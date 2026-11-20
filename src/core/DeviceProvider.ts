import type {
  CameraStream,
  CommandResult,
  DeviceCommand,
  JsonValue,
  ProviderEvent,
  ProviderEventListener,
  ProviderId,
  ProviderStatus,
  SmartEntity,
  Unsubscribe,
} from './types';
import type { BrowseRequest, MediaItem, SearchRequest } from './media';

/**
 * The unified contract every smart home integration MUST implement.
 * (CLAUDE.md rule 1: connect, disconnect, subscribeStates, executeCommand.)
 */
export interface DeviceProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly status: ProviderStatus;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /**
   * Subscribe to raw provider events. The listener immediately receives an
   * `entity_upsert`/`camera_upsert` replay of the current snapshot.
   */
  subscribeStates(listener: ProviderEventListener): Unsubscribe;

  executeCommand(command: DeviceCommand): Promise<CommandResult>;

  /** Optional: browse a media player's library (playlists, albums…). */
  browseMedia?(targetId: string, request: BrowseRequest): Promise<MediaItem>;

  /** Optional: search a media player's library (artists, albums…). */
  searchMedia?(targetId: string, request: SearchRequest): Promise<MediaItem[]>;

  /** Optional: pass a typed command to an outside assistant (Google Home), returning its raw reply. */
  askAssistant?(command: string): Promise<JsonValue | undefined>;

  /** Current snapshot (may be empty before `connect` resolves). */
  getEntities(): readonly SmartEntity[];
  getCameras(): readonly CameraStream[];
}

/**
 * Shared plumbing for providers: listener fan-out, snapshot cache and status
 * tracking. Concrete providers only implement transport-specific logic.
 */
export abstract class BaseDeviceProvider implements DeviceProvider {
  abstract readonly id: ProviderId;
  abstract readonly displayName: string;

  private readonly listeners = new Set<ProviderEventListener>();
  protected readonly entities = new Map<string, SmartEntity>();
  protected readonly cameras = new Map<string, CameraStream>();
  private currentStatus: ProviderStatus = 'idle';

  get status(): ProviderStatus {
    return this.currentStatus;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract executeCommand(command: DeviceCommand): Promise<CommandResult>;

  subscribeStates(listener: ProviderEventListener): Unsubscribe {
    this.listeners.add(listener);
    for (const entity of this.entities.values()) listener({ type: 'entity_upsert', entity });
    for (const camera of this.cameras.values()) listener({ type: 'camera_upsert', camera });
    return () => {
      this.listeners.delete(listener);
    };
  }

  getEntities(): readonly SmartEntity[] {
    return [...this.entities.values()];
  }

  getCameras(): readonly CameraStream[] {
    return [...this.cameras.values()];
  }

  protected setStatus(status: ProviderStatus, error?: string): void {
    this.currentStatus = status;
    this.emit(error === undefined ? { type: 'status', providerId: this.id, status } : { type: 'status', providerId: this.id, status, error });
  }

  protected upsertEntity(entity: SmartEntity): void {
    this.entities.set(entity.uid, entity);
    this.emit({ type: 'entity_upsert', entity });
  }

  protected removeEntity(uid: string): void {
    if (this.entities.delete(uid)) this.emit({ type: 'entity_removed', uid });
  }

  protected upsertCamera(camera: CameraStream): void {
    this.cameras.set(camera.uid, camera);
    this.emit({ type: 'camera_upsert', camera });
  }

  protected removeCamera(uid: string): void {
    if (this.cameras.delete(uid)) this.emit({ type: 'camera_removed', uid });
  }

  protected clearSnapshot(): void {
    for (const uid of [...this.entities.keys()]) this.removeEntity(uid);
    for (const uid of [...this.cameras.keys()]) this.removeCamera(uid);
  }

  private emit(event: ProviderEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err: unknown) {
        console.error(`[${this.id}] listener threw`, err);
      }
    }
  }
}

export const commandError = (message: string): CommandResult => ({ ok: false, message });
export const commandOk = (message?: string): CommandResult => (message === undefined ? { ok: true } : { ok: true, message });

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
