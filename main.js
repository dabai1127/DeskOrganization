const path = require('node:path');
const fs = require('node:fs/promises');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { app, BrowserWindow, ipcMain, dialog, shell, screen, Tray, Menu } = require('electron');
const organizer = require('./organizer');
const runFile = promisify(execFile);

let window;
let desktopWindow;
let tray;
let desktopCollapsedHeight = 0;
let desktopExpandedHeight = 0;
let selectedRoot;
let sharedDesktopRoot;
let nativeIconsHiddenByApp = false;
let recoverHiddenIcons = false;
let lastOperation = null;
const appRoot = path.resolve(__dirname);
const iconMarkerPath = () => path.join(app.getPath('userData'), 'native-icons-hidden.json');
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
else app.on('second-instance', () => createWindow());

async function loadOperation() {
  try {
    const value = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'last-operation.json'), 'utf8'));
    if (value && Array.isArray(value.moved)) lastOperation = value;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('无法读取上次整理记录:', error);
  }
}

async function saveOperation() {
  const location = path.join(app.getPath('userData'), 'last-operation.json');
  if (!lastOperation) {
    await fs.rm(location, { force: true });
    return;
  }
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(location, JSON.stringify(lastOperation, null, 2), 'utf8');
}

async function currentState() {
  const snapshot = await organizer.scan(selectedRoot, appRoot, selectedRoot === path.resolve(app.getPath('desktop')) ? sharedDesktopRoot : null);
  return { ...snapshot, canUndo: !!lastOperation?.moved?.length && lastOperation.root === selectedRoot, lastOrganizedAt: lastOperation?.root === selectedRoot ? lastOperation.timestamp : null };
}

function createWindow() {
  if (window && !window.isDestroyed()) { window.show(); window.focus(); return window; }
  window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 690,
    backgroundColor: '#f6f3ec',
    title: '晾一晾 · 桌面整理',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.loadFile(path.join(__dirname, 'index.html'));
  window.on('closed', () => { window = null; });
  return window;
}

async function createDesktopWindow() {
  const bounds = screen.getPrimaryDisplay().bounds;
  desktopCollapsedHeight = Math.min(bounds.height, 410);
  desktopExpandedHeight = Math.min(bounds.height, 760);
  desktopWindow = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width, height: desktopCollapsedHeight,
    show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    skipTaskbar: true, hasShadow: false, resizable: false, movable: false,
    title: '晾一晾 · 桌面衣绳',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  desktopWindow.on('closed', () => { desktopWindow = null; });
  await desktopWindow.loadFile(path.join(__dirname, 'desktop.html'));
  desktopWindow.showInactive();
  const handle = desktopWindow.getNativeWindowHandle().readBigUInt64LE().toString();
  const { stdout } = await runFile('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'desktop-host.ps1'),
    '-Action', 'place', '-Handle', handle, '-Width', String(bounds.width), '-Height', String(desktopCollapsedHeight),
    '-X', String(bounds.x), '-Y', String(bounds.y)
  ], { windowsHide: true, timeout: 15000 });
  const result = JSON.parse(stdout.trim());
  if (!result.Placed) throw new Error('桌面宿主未接受衣绳窗口');
  try {
    const icons = await setNativeDesktopIconsVisible(false);
    nativeIconsHiddenByApp = recoverHiddenIcons || (icons.WasVisible && !icons.IsVisible);
    if (nativeIconsHiddenByApp) {
      await fs.mkdir(app.getPath('userData'), { recursive: true });
      await fs.writeFile(iconMarkerPath(), JSON.stringify({ hiddenAt: new Date().toISOString() }), 'utf8');
    }
  } catch (error) {
    console.warn('隐藏原生桌面图标失败:', error);
    nativeIconsHiddenByApp = recoverHiddenIcons || nativeIconsHiddenByApp;
    desktopWindow.webContents.send('desktop:warning', '衣绳已启动，但 Windows 原生图标暂时无法隐藏');
  }
  return result;
}

async function setNativeDesktopIconsVisible(visible) {
  const { stdout } = await runFile('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'desktop-host.ps1'),
    '-Action', 'icons', '-Visible', visible ? 'true' : 'false'
  ], { windowsHide: true, timeout: 15000 });
  const result = JSON.parse(stdout.trim());
  if (!result.IconsHandled || result.IsVisible !== visible) throw new Error('无法切换 Windows 桌面图标显示');
  return result;
}

async function restoreNativeDesktopIcons() {
  if (!nativeIconsHiddenByApp) return;
  await setNativeDesktopIconsVisible(true);
  nativeIconsHiddenByApp = false;
  recoverHiddenIcons = false;
  await fs.rm(iconMarkerPath(), { force: true });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'tray-icon.png'));
  tray.setToolTip('晾一晾 · 桌面整理');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开管理面板', click: createWindow },
    { label: '刷新桌面衣绳', click: () => desktopWindow?.webContents.send('organizer:updated') },
    { type: 'separator' },
    { label: '退出晾一晾', click: () => app.quit() }
  ]));
  tray.on('double-click', createWindow);
}

function broadcastUpdate() {
  if (desktopWindow && !desktopWindow.isDestroyed()) desktopWindow.webContents.send('organizer:updated');
  if (window && !window.isDestroyed()) window.webContents.send('organizer:updated');
}

if (hasInstanceLock) app.whenReady().then(async () => {
  selectedRoot = path.resolve(app.getPath('desktop'));
  sharedDesktopRoot = path.join(process.env.PUBLIC || path.join(path.parse(selectedRoot).root, 'Users', 'Public'), 'Desktop');
  try { await fs.access(iconMarkerPath()); recoverHiddenIcons = true; }
  catch (error) { if (error.code !== 'ENOENT') console.warn('读取桌面图标恢复记录失败:', error); }
  await loadOperation();

  ipcMain.handle('organizer:state', currentState);
  ipcMain.handle('organizer:choose', async () => {
    const result = await dialog.showOpenDialog(window || desktopWindow, { title: '选择要整理的文件夹', defaultPath: selectedRoot, properties: ['openDirectory'] });
    if (!result.canceled && result.filePaths[0]) {
      const selected = path.resolve(result.filePaths[0]);
      if (organizer.isInside(appRoot, selected)) throw new Error('不能整理软件自身所在的文件夹');
      selectedRoot = selected;
    }
    broadcastUpdate();
    return currentState();
  });
  ipcMain.handle('organizer:organize', async () => {
    const result = await organizer.organize(selectedRoot, appRoot);
    if (result.moved.length) { lastOperation = result; await saveOperation(); }
    broadcastUpdate();
    return { result, state: await currentState() };
  });
  ipcMain.handle('organizer:undo', async () => {
    if (!lastOperation || lastOperation.root !== selectedRoot) throw new Error('没有可撤销的整理记录');
    const result = await organizer.undo(lastOperation);
    const restored = new Set(result.restored.map(move => move.to));
    lastOperation.moved = lastOperation.moved.filter(move => !restored.has(move.to));
    if (!lastOperation.moved.length) lastOperation = null;
    await saveOperation();
    broadcastUpdate();
    return { result, state: await currentState() };
  });
  ipcMain.handle('organizer:open', async (_event, itemPath) => {
    if (typeof itemPath !== 'string' || !(organizer.isInside(selectedRoot, itemPath) || (selectedRoot === path.resolve(app.getPath('desktop')) && organizer.isInside(sharedDesktopRoot, itemPath))) || organizer.isInside(appRoot, itemPath)) throw new Error('文件路径无效');
    const error = await shell.openPath(itemPath);
    if (error) throw new Error(error);
  });
  ipcMain.handle('organizer:reveal', async (_event, itemPath) => {
    if (typeof itemPath !== 'string' || !(organizer.isInside(selectedRoot, itemPath) || (selectedRoot === path.resolve(app.getPath('desktop')) && organizer.isInside(sharedDesktopRoot, itemPath))) || organizer.isInside(appRoot, itemPath)) throw new Error('文件路径无效');
    shell.showItemInFolder(itemPath);
  });
  ipcMain.handle('organizer:open-folder', async (_event, target) => {
    const folder = target === 'managed' ? path.join(selectedRoot, organizer.MANAGED_DIR) : selectedRoot;
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  });
  ipcMain.on('desktop:popover', (event, open) => {
    if (!desktopWindow || event.sender !== desktopWindow.webContents || typeof open !== 'boolean') return;
    desktopWindow.setSize(desktopWindow.getSize()[0], open ? desktopExpandedHeight : desktopCollapsedHeight);
  });
  ipcMain.on('desktop:open-panel', event => { if (desktopWindow && event.sender === desktopWindow.webContents) createWindow(); });
  ipcMain.on('panel:show-desktop', event => { if (window && event.sender === window.webContents) window.hide(); });
  createTray();
  try { await createDesktopWindow(); }
  catch (error) {
    console.error('桌面模式启动失败:', error);
    if (desktopWindow && !desktopWindow.isDestroyed()) desktopWindow.destroy();
    await restoreNativeDesktopIcons().catch(restoreError => console.warn('恢复桌面图标失败:', restoreError));
    createWindow();
    dialog.showMessageBox(window, { type: 'warning', title: '桌面模式未启动', message: '桌面衣绳暂时无法挂到 Windows 桌面。', detail: error.message });
  }
  app.on('activate', () => { if (!desktopWindow && !window) createWindow(); });
});

app.on('window-all-closed', () => { if (!tray) app.quit(); });
app.on('before-quit', event => {
  if (app.restoringDesktopIcons || !nativeIconsHiddenByApp) return;
  event.preventDefault();
  app.restoringDesktopIcons = true;
  restoreNativeDesktopIcons().catch(error => console.warn('恢复桌面图标失败:', error)).finally(() => app.quit());
});
