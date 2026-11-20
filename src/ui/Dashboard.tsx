import { LayoutGrid, Settings } from 'lucide-react';
import { DoorStatus } from './DoorPills';
import { useState } from 'react';
import { inTauri } from '../platform/window';
import { IntegrationSettings } from './IntegrationSettings';
import { useDeviceStore } from '../state/deviceStore';
import { useLayoutStore } from '../state/layoutStore';
import { FullscreenCamera } from './FullscreenCamera';
import { DashboardSections } from './layout/DashboardSections';
import { PAGE_DOTS_ID } from './layout/PagedSections';
import { SelectionBar } from './layout/SelectionBar';
import { OverlayGroupsEditor } from './overlay/OverlayGroupsEditor';
import { PipLayer } from './PipLayer';
import { ProviderStatusPills } from './ProviderStatusPills';
import { VoiceOverlay } from './voice/VoiceOverlay';
import { useWakeWordListener } from './voice/useWakeWord';
import { TimerTray } from './timers/TimerTray';
import { ScreensaverHost } from './screensaver/Screensaver';
import { useScreensaverTrigger } from './screensaver/useScreensaverTrigger';
import { AppTitle } from './header/AppTitle';
import { FocusToggle, useFocusView } from './header/FocusToggle';
import { HeaderClock } from './header/HeaderClock';

/** Main window: the user's groups, then cameras, then devices by area. */
export function Dashboard() {
  const mockMode = useDeviceStore((s) => s.mock);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ready = useDeviceStore((s) => s.ready);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const editing = useLayoutStore((s) => s.editing);
  const { setEditing } = useLayoutStore.getState();
  useWakeWordListener();
  useScreensaverTrigger();
  useFocusView();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="relative z-30 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface/90 px-4 py-3 backdrop-blur sm:px-6">
        <AppTitle />
        {mockMode && <span className="rounded-md bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">Mock data</span>}
        {/* Page dots (filled by PagedSections). */}
        <div id={PAGE_DOTS_ID} />
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <DoorStatus />
          <ProviderStatusPills />
          <HeaderClock />
          <button
            type="button"
            onClick={() => setEditing(!editing)}
            aria-pressed={editing}
            title="Arrange, group and hide tiles, and choose what the overlay shows"
            className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs ${editing ? 'bg-accent text-white' : 'text-slate-400 hover:bg-panel-hi hover:text-slate-100'}`}
          >
            <LayoutGrid className="h-4 w-4" aria-hidden /> {editing ? 'Done' : 'Edit layout'}
          </button>
          <FocusToggle />
          {inTauri() && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              title="Settings: shortcuts and integrations"
              className="rounded-md p-1.5 text-slate-400 hover:bg-panel-hi hover:text-slate-100"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {/* Fixed height: content pages sideways (see PagedSections) instead of scrolling down. */}
      <main className="flex min-h-0 flex-1 flex-col">
        {!ready && <p className="px-4 pt-4 text-sm text-slate-400 sm:px-6">Connecting to providers…</p>}
        <DashboardSections />
      </main>

      {editing && <SelectionBar onManageGroups={() => setGroupsOpen(true)} />}
      {groupsOpen && <OverlayGroupsEditor onClose={() => setGroupsOpen(false)} />}
      <PipLayer />
      <FullscreenCamera />
      <VoiceOverlay />
      <TimerTray />
      {settingsOpen && <IntegrationSettings onClose={() => setSettingsOpen(false)} />}
      <ScreensaverHost />
    </div>
  );
}
