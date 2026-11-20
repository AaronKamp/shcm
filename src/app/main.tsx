import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import { installVisibilityTracking, resolveView } from '../platform/window';
import { Dashboard } from '../ui/Dashboard';
import { Overlay } from '../ui/Overlay';
import { startRegistry } from './bootstrap';
import { installCredentialSync } from './credentialSync';

const view = resolveView();
document.body.dataset['view'] = view;

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

void installVisibilityTracking();
void installCredentialSync();
void startRegistry();

createRoot(root).render(
  <StrictMode>{view === 'overlay' ? <Overlay /> : <Dashboard />}</StrictMode>,
);
