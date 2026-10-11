const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopOrganizer', {
  state: () => ipcRenderer.invoke('organizer:state'),
  choose: () => ipcRenderer.invoke('organizer:choose'),
  organize: () => ipcRenderer.invoke('organizer:organize'),
  undo: () => ipcRenderer.invoke('organizer:undo'),
  open: path => ipcRenderer.invoke('organizer:open', path),
  reveal: path => ipcRenderer.invoke('organizer:reveal', path),
  openFolder: target => ipcRenderer.invoke('organizer:open-folder', target),
  setPopoverOpen: open => ipcRenderer.send('desktop:popover', open),
  openPanel: () => ipcRenderer.send('desktop:open-panel'),
  showDesktop: () => ipcRenderer.send('panel:show-desktop'),
  onUpdated: callback => ipcRenderer.on('organizer:updated', () => callback()),
  onDesktopWarning: callback => ipcRenderer.on('desktop:warning', (_event, message) => callback(message))
});
