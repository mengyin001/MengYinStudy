const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('mengyinDesktop', {
  platform: process.platform,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
});
