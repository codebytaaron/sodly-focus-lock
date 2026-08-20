const { app, Tray, Menu, BrowserWindow, ipcMain, screen, nativeImage, powerMonitor } = require('electron');
const path = require('path');

// active-win gives us the frontmost app/window title so we can tell when the
// user has switched away from an allowlisted call app. It's an optional
// dependency: if the native module fails to load on some platform/arch we
// still run Lockdown, just without the "away from call" nag feature.
let activeWin = null;
try {
  activeWin = require('active-win');
} catch (err) {
  console.warn('[lockdown] active-win unavailable, focus detection disabled:', err.message);
}

const ALLOWLIST_KEYWORDS = [
  'zoom', 'zoom.us',
  'google meet', 'meet.google',
  'microsoft teams', 'teams.microsoft',
  'facetime',
  'lockdown', 'electron' // our own app / dev window
];

let tray = null;
let overlayWindow = null;
let pollTimer = null;

const state = {
  locked: false,
  endsAt: null,       // epoch ms
  durationMs: 0,
  strayCount: 0,      // times user left the allowlist while locked
  lastAppName: null
};

function isAllowlisted(ownerName = '', title = '') {
  const haystack = `${ownerName} ${title}`.toLowerCase();
  return ALLOWLIST_KEYWORDS.some((kw) => haystack.includes(kw));
}

function createOverlayWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: 420,
    height: 130,
    x: Math.round((width - 420) / 2),
    y: 24,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'overlay.html'));
  win.on('closed', () => { overlayWindow = null; });
  return win;
}

function updateTray() {
  if (!tray) return;
  const label = state.locked
    ? `Lockdown — locked (${remainingLabel()})`
    : 'Lockdown — off';
  tray.setToolTip(label);
  tray.setContextMenu(buildTrayMenu());
}

function remainingLabel() {
  if (!state.endsAt) return '';
  const remainMs = Math.max(0, state.endsAt - Date.now());
  const mins = Math.floor(remainMs / 60000);
  const secs = Math.floor((remainMs % 60000) / 1000);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function buildTrayMenu() {
  const durationItems = [15, 25, 45, 60].map((mins) => ({
    label: `Start Focus Lock — ${mins} min`,
    enabled: !state.locked,
    click: () => startLock(mins * 60 * 1000)
  }));

  return Menu.buildFromTemplate([
    { label: state.locked ? `Locked — ${remainingLabel()} left` : 'Not locked', enabled: false },
    { type: 'separator' },
    ...durationItems,
    { type: 'separator' },
    {
      label: 'Unlock now (requires hold-to-confirm in overlay)',
      enabled: state.locked,
      click: () => {
        if (overlayWindow) overlayWindow.webContents.send('lockdown:focus-unlock');
      }
    },
    { type: 'separator' },
    { label: 'Quit Lockdown', click: () => { forceStopLock(); app.quit(); } }
  ]);
}

function startLock(durationMs) {
  if (state.locked) return;
  state.locked = true;
  state.durationMs = durationMs;
  state.endsAt = Date.now() + durationMs;
  state.strayCount = 0;

  if (!overlayWindow) overlayWindow = createOverlayWindow();
  overlayWindow.showInactive();

  sendState();
  startPolling();
  updateTray();
}

function endLock(reason = 'completed') {
  state.locked = false;
  state.endsAt = null;
  state.durationMs = 0;
  stopPolling();
  if (overlayWindow) {
    overlayWindow.webContents.send('lockdown:ended', { reason });
    setTimeout(() => {
      if (overlayWindow) overlayWindow.hide();
    }, 1500);
  }
  updateTray();
}

function forceStopLock() {
  if (state.locked) endLock('quit');
}

function sendState() {
  if (overlayWindow) {
    overlayWindow.webContents.send('lockdown:state', {
      locked: state.locked,
      endsAt: state.endsAt,
      remaining: remainingLabel(),
      strayCount: state.strayCount
    });
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!state.locked) return;

    if (Date.now() >= state.endsAt) {
      endLock('completed');
      return;
    }

    sendState();
    updateTray();

    if (!activeWin) return;
    try {
      const win = await activeWin();
      const owner = win && win.owner ? win.owner.name : '';
      const title = win && win.title ? win.title : '';
      if (owner && !isAllowlisted(owner, title)) {
        state.strayCount += 1;
        if (overlayWindow) {
          overlayWindow.webContents.send('lockdown:stray', { owner, title, strayCount: state.strayCount });
          overlayWindow.showInactive();
          overlayWindow.focus();
        }
      }
    } catch (err) {
      // active-win can throw on permission issues; fail silently per poll
    }
  }, 2000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

ipcMain.on('lockdown:request-unlock', () => {
  endLock('manual-unlock');
});

ipcMain.handle('lockdown:get-state', () => ({
  locked: state.locked,
  endsAt: state.endsAt,
  remaining: remainingLabel(),
  strayCount: state.strayCount
}));

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide(); // menu-bar-only app
  }

  const iconPath = path.join(__dirname, '..', 'assets', 'trayTemplate.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
  } catch (e) {
    trayIcon = nativeImage.createEmpty();
  }
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  tray.setToolTip('Lockdown');
  updateTray();

  powerMonitor.on('lock-screen', () => {
    // Leave lock state as-is; system lock is orthogonal to focus lock.
  });
});

app.on('window-all-closed', (e) => {
  // Menu bar app: never quit just because windows closed.
  e.preventDefault();
});
