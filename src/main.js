const { app, Tray, Menu, BrowserWindow, ipcMain, screen, nativeImage, powerMonitor, globalShortcut } = require('electron');
const path = require('path');

// get-windows gives us the frontmost app/window title so we can tell when the
// user has switched away from an allowlisted call app. It's ESM-only, so it's
// loaded with import(). If it fails to load on some platform/arch we still
// run Sodly, just without the "away from call" nag feature.
let activeWin = null;
import('get-windows')
  .then((mod) => { activeWin = mod.activeWindow; })
  .catch((err) => {
    console.warn('[sodly] get-windows unavailable, focus detection disabled:', err.message);
  });

const ALLOWLIST_KEYWORDS = [
  'zoom', 'zoom.us',
  'google meet', 'meet.google',
  'microsoft teams', 'teams.microsoft',
  'facetime',
  'sodly', 'electron' // our own app / dev window
];

// How long the overlay must be held to give up early. Deliberately long so
// it isn't a casual "meh, unlock" reflex — you have to really mean it.
const HOLD_TO_GIVE_UP_MS = 9000;

// Debounce window for re-raising the overlay after a detected stray focus.
// Bursts of focus-loss events within this window collapse into one re-raise.
const REFOCUS_DEBOUNCE_MS = 200;

let tray = null;
let overlayWindow = null;
let pollTimer = null;
let refocusTimer = null;
let refocusPending = false;

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

// Re-assert alwaysOnTop/visible-on-all-workspaces and bring the overlay back
// to front. Debounced so a rapid burst of "you left the allowlist" polling
// events doesn't stack duplicate re-raises or spam timers.
function scheduleReassertOverlay() {
  if (!state.locked || !overlayWindow) return;
  refocusPending = true;
  if (refocusTimer) return; // already scheduled, coalesce
  refocusTimer = setTimeout(() => {
    refocusTimer = null;
    if (!refocusPending) return;
    refocusPending = false;
    if (!state.locked || !overlayWindow) return;
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlayWindow.showInactive();
    overlayWindow.focus();
  }, REFOCUS_DEBOUNCE_MS);
}

function updateTray() {
  if (!tray) return;
  const label = state.locked
    ? `Sodly — locked (${remainingLabel()})`
    : 'Sodly — off';
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
      label: 'Give up early (requires hold-to-confirm in overlay)',
      enabled: state.locked,
      click: () => {
        if (overlayWindow) overlayWindow.webContents.send('sodly:focus-unlock');
      }
    },
    { type: 'separator' },
    // Deliberate action from the tray always works — this is not the thing
    // we're guarding against. We only intercept the reflexive Cmd+Q.
    { label: 'Quit Sodly', click: () => { forceStopLock(); app.quit(); } }
  ]);
}

function setKioskChrome(active) {
  if (process.platform === 'darwin' && app.dock) {
    if (active) app.dock.hide();
    else app.dock.show();
  }
  // Menu bar (tray) icon itself stays up so the user always has a way to
  // reach "Give up early" / Quit — hiding the tray as well would remove the
  // only deliberate way out short of Force Quit. Kiosk-style here means:
  // no Dock icon, no app menu bar surfaced, overlay always on top.
  if (Menu.setApplicationMenu) {
    Menu.setApplicationMenu(active ? Menu.buildFromTemplate([]) : null);
  }
}

function registerQuitGuard() {
  // Intercept the reflexive Cmd+Q while locked so an instinctive quit
  // doesn't kill an active lock. "Quit" from the tray menu bypasses this
  // (it calls forceStopLock + app.quit directly), and macOS's own Force
  // Quit (Cmd+Opt+Esc) / Activity Monitor / killall are never intercepted —
  // see the HARD SAFETY CONSTRAINT note below.
  const ok = globalShortcut.register('CommandOrControl+Q', () => {
    if (state.locked && overlayWindow) {
      overlayWindow.webContents.send('sodly:quit-blocked');
      scheduleReassertOverlay();
      return; // swallow the reflexive quit
    }
    app.quit();
  });
  if (!ok) {
    console.warn('[sodly] could not register Cmd+Q guard shortcut');
  }
}

function unregisterQuitGuard() {
  globalShortcut.unregister('CommandOrControl+Q');
}

function startLock(durationMs) {
  if (state.locked) return;
  state.locked = true;
  state.durationMs = durationMs;
  state.endsAt = Date.now() + durationMs;
  state.strayCount = 0;

  if (!overlayWindow) overlayWindow = createOverlayWindow();
  overlayWindow.showInactive();

  setKioskChrome(true);
  registerQuitGuard();

  sendState();
  startPolling();
  updateTray();
}

function endLock(reason = 'completed') {
  state.locked = false;
  state.endsAt = null;
  state.durationMs = 0;
  stopPolling();
  refocusPending = false;
  if (refocusTimer) { clearTimeout(refocusTimer); refocusTimer = null; }
  unregisterQuitGuard();
  setKioskChrome(false);
  if (overlayWindow) {
    overlayWindow.webContents.send('sodly:ended', { reason });
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
    overlayWindow.webContents.send('sodly:state', {
      locked: state.locked,
      endsAt: state.endsAt,
      remaining: remainingLabel(),
      strayCount: state.strayCount,
      holdMs: HOLD_TO_GIVE_UP_MS
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
          overlayWindow.webContents.send('sodly:stray', { owner, title, strayCount: state.strayCount });
        }
        // Re-raise within ~150-300ms, debounced against bursts of
        // consecutive stray detections from the polling loop.
        scheduleReassertOverlay();
      }
    } catch (err) {
      // get-windows can throw on permission issues; fail silently per poll
    }
  }, 2000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

ipcMain.on('sodly:request-unlock', () => {
  endLock('manual-unlock');
});

ipcMain.handle('sodly:get-state', () => ({
  locked: state.locked,
  endsAt: state.endsAt,
  remaining: remainingLabel(),
  strayCount: state.strayCount,
  holdMs: HOLD_TO_GIVE_UP_MS
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
  tray.setToolTip('Sodly');
  updateTray();

  powerMonitor.on('lock-screen', () => {
    // Leave lock state as-is; system lock is orthogonal to focus lock.
  });
});

app.on('window-all-closed', (e) => {
  // Menu bar app: never quit just because windows closed.
  e.preventDefault();
});

app.on('will-quit', () => {
  // Belt-and-suspenders: always release the shortcut so we never leave a
  // dangling global hotkey registration behind, whether we quit via the
  // tray, the OS, or a crash-adjacent path.
  globalShortcut.unregisterAll();
});

// HARD SAFETY CONSTRAINT: this app must never attempt to block, delay, or
// survive macOS's own Force Quit (Cmd+Opt+Esc), an Activity Monitor kill, or
// `killall`. Those are OS-level SIGTERM/SIGKILL deliveries to this process;
// Electron/Node cannot intercept SIGKILL at all, and we deliberately do not
// install any SIGTERM handler, relaunch-on-exit logic, launchd
// KeepAlive/watcher, or helper process here. When the OS kills this
// process, it dies, full stop, and nothing of it remains running — that is
// the safety valve and it is not to be crossed.
