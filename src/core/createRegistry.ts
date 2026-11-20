import { HomeAssistantProvider, type HomeAssistantConfig } from '../providers/homeassistant/HomeAssistantProvider';
import { MockDeviceProvider, type MockDeviceProviderOptions } from '../providers/mock/MockDeviceProvider';
import { CustomPluginProvider } from '../providers/plugin/CustomPluginProvider';
import type { PluginProviderConfig } from '../providers/plugin/pluginTypes';
import { UnifiProtectProvider, type UnifiProtectConfig } from '../providers/UnifiProtectProvider';
import { ProviderRegistry, type ProviderRegistryOptions } from './ProviderRegistry';

export interface RegistryConfig extends ProviderRegistryOptions {
  readonly homeAssistant?: HomeAssistantConfig;
  readonly unifiProtect?: UnifiProtectConfig;
  readonly plugins?: PluginProviderConfig;
  /**
   * Offline mode: when set, a MockDeviceProvider replaces all live providers so
   * the UI can be developed without hitting real endpoints.
   */
  readonly mock?: MockDeviceProviderOptions | true;
}

/** Builds a registry with the built-in providers for whichever integrations are configured. */
export const createProviderRegistry = (config: RegistryConfig): ProviderRegistry => {
  const registry = new ProviderRegistry(config.throttleMs === undefined ? {} : { throttleMs: config.throttleMs });

  if (config.mock !== undefined) {
    registry.register(new MockDeviceProvider(config.mock === true ? {} : config.mock));
    return registry;
  }
  if (config.homeAssistant) registry.register(new HomeAssistantProvider(config.homeAssistant));
  if (config.unifiProtect) registry.register(new UnifiProtectProvider(config.unifiProtect));
  if (config.plugins) registry.register(new CustomPluginProvider(config.plugins));
  return registry;
};
