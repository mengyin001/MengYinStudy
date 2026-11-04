/**
 * Electron shell for MengYin Study (CommonJS main process).
 *
 * The built web app is served from a tiny loopback HTTP server instead of
 * file://, so `fetch`, dynamic `import()` of plugin modules and the service
 * worker all behave exactly like they do in a browser.
 */
const { app, BrowserWindow, dialog, shell } = require('electron');
const { createServer } = require('node:http');
const { mkdir, readFile, stat, writeFile } = require('node:fs/promises');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const distDir = path.resolve(__dirname, '..', 'web', 'dist');
const devMode = process.argv.includes('--dev');
const smokeMode = process.argv.includes('--smoke');
const devUrl = 'http://127.0.0.1:5173/';

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
  ['.map', 'application/json; charset=utf-8'],
]);

async function startStaticServer(root) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      let relative = decodeURIComponent(url.pathname);
      if (relative.endsWith('/')) relative += 'index.html';
      const filePath = path.join(root, relative);
      if (!filePath.startsWith(root)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      let data;
      try {
        data = await readFile(filePath);
      } catch {
        // Unknown paths fall back to the SPA shell.
        data = await readFile(path.join(root, 'index.html'));
      }
      response.writeHead(200, {
        'Content-Type': MIME.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      response.end(data);
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}/` };
}

let staticServer = null;
let mainWindow = null;

async function resolveAppUrl() {
  if (devMode) return devUrl;
  try {
    await stat(path.join(distDir, 'index.html'));
  } catch {
    throw new Error(`找不到前端建置檔案：${distDir}\n請先執行 npm run build。`);
  }
  const { server, url } = await startStaticServer(distDir);
  staticServer = server;
  return url;
}

async function createWindow() {
  let url;
  try {
    url = await resolveAppUrl();
  } catch (error) {
    dialog.showErrorBox('無法啟動 MengYin Study', error instanceof Error ? error.message : String(error));
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#0b0f19',
    autoHideMenuBar: true,
    title: 'MengYin Study',
    icon: path.join(distDir, 'icons', 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(url);

  if (smokeMode) {
    // Dev aid: render, save a screenshot, then exit. Used by the smoke test.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const image = await mainWindow.webContents.capturePage();
    const target = path.join(projectRoot, '_screenshots', 'desktop-smoke.png');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, image.toPNG());
    console.log(`[smoke] saved ${target}`);
    app.quit();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    await createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    staticServer?.close();
  });
}
