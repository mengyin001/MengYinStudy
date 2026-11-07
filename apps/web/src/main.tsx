import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppProvider } from './state/AppContext';
import { AuthProvider } from './state/AuthContext';
import { BillingProvider } from './state/BillingContext';
import { CollectionsProvider } from './state/CollectionsContext';
import { OfficialContentProvider } from './state/OfficialContentContext';
import { UserDecksProvider } from './state/UserDecksContext';
import { UserLibraryProvider } from './state/UserLibraryContext';
import { runStorageMigrations } from './lib/storage';
import './styles/base.css';
import './styles/app.css';
// Loaded last so its sizing hides/overrides the shared `.btn` rules. The page
// is only rendered for signed-out visitors, but the CSS is tiny and always
// present, which keeps the build order deterministic.
import './styles/landing.css';

const container = document.getElementById('root');
if (!container) throw new Error('找不到 #root 容器');
const rootElement: HTMLElement = container;

async function start(): Promise<void> {
  try {
    await runStorageMigrations();
  } finally {
    createRoot(rootElement).render(
      <StrictMode>
        <AuthProvider>
          <BillingProvider>
            <UserDecksProvider>
              <UserLibraryProvider>
                <CollectionsProvider>
                  <OfficialContentProvider>
                    <AppProvider>
                      <App />
                    </AppProvider>
                  </OfficialContentProvider>
                </CollectionsProvider>
              </UserLibraryProvider>
            </UserDecksProvider>
          </BillingProvider>
        </AuthProvider>
      </StrictMode>,
    );
  }
}

void start();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
