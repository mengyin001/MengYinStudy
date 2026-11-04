import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppProvider } from './state/AppContext';
import { AuthProvider } from './state/AuthContext';
import { OfficialContentProvider } from './state/OfficialContentContext';
import { UserDecksProvider } from './state/UserDecksContext';
import { UserLibraryProvider } from './state/UserLibraryContext';
import { runStorageMigrations } from './lib/storage';
import './styles/base.css';
import './styles/app.css';

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
          <UserDecksProvider>
            <UserLibraryProvider>
              <OfficialContentProvider>
                <AppProvider>
                  <App />
                </AppProvider>
              </OfficialContentProvider>
            </UserLibraryProvider>
          </UserDecksProvider>
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
