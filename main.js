const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  globalShortcut,
  clipboard,
  nativeImage,
  dialog,
  session
} = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const punycode = require('punycode');
const tabsFilePath = path.join(__dirname, 'tabs.json');
const widgetsPath = path.join(app.getPath('userData'), 'widgets.json');
const { ElectronBlocker } = require('@cliqz/adblocker-electron');

let mainWindow = null;
let historyWindow = null;
let detachedWindows = [];
let openTabs = [];

const userDataPath = app.getPath('userData');

const paths = {
  history: path.join(userDataPath, 'history.json'),
  background: path.join(userDataPath, 'background.json'),
  passwords: path.join(userDataPath, 'passwords.json'),
  autofill: path.join(userDataPath, 'autofill.json'),
  tabs: path.join(userDataPath, 'tabs.json'),
  bookmarks: path.join(userDataPath, 'bookmarks.json'),
  widgets: path.join(userDataPath, 'widgets.json'), // ← добавлено
};

const loadWidgetSettings = () => {
  const saved = localStorage.getItem('widgetSettings');
  if (saved) {
    const settings = JSON.parse(saved);
    widgetCheckboxes.forEach(checkbox => {
      const key = checkbox.dataset.widget;
      if (key in settings) checkbox.checked = settings[key];
    });
    console.log('[DEBUG] Виджеты загружены из localStorage', settings);
  }
};

// Функция загрузки виджетов с созданием дефолта при отсутствии файла
async function loadWidgets() {
  try {
    const data = await fs.promises.readFile(widgetsPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    const defaultWidgets = {
      clock: true, 
      weather: true, 
      calendar: true,
      bookmarks: true,
    };
    // Создаём файл с дефолтом
    await fs.promises.writeFile(widgetsPath, JSON.stringify(defaultWidgets, null, 2), 'utf-8');
    return defaultWidgets;
  }
}

// Функция сохранения виджетов
async function saveWidgets(widgets) {
  try {
    await fs.promises.writeFile(widgetsPath, JSON.stringify(widgets, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Ошибка при сохранении виджетов:', err);
    return false;
  }
}

// === Утилиты ===


function readJSON(filePath, fallback = []) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw.trim());
    }
  } catch (err) {
    console.error(`Ошибка чтения файла ${filePath}:`, err);
    try {
      fs.unlinkSync(filePath);
    } catch (e) {}
  }
  return fallback;
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`Ошибка записи файла ${filePath}:`, err);
    return false;
  }
}

function parseInputToUrl(input) {
  input = input.trim();
  if (!input) return 'about:blank';
  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(input);
  let testUrl = input;
  if (!hasProtocol) testUrl = 'http://' + input;

  try {
    const url = new URL(testUrl);
    if (url.hostname && url.hostname.includes('.')) {
      url.hostname = punycode.toUnicode(url.hostname);
      return url.toString();
    }
  } catch {}
  
}

function isImageUrl(url) {
  return /\.(jpe?g|png|gif|bmp|webp|svg|ico)(\?.*)?$/i.test(url || '');
}

function downloadImage(url, dest, callback) {
  const protocol = url.startsWith('https') ? https : http;
  const file = fs.createWriteStream(dest);

  protocol.get(url, (response) => {
    if (response.statusCode !== 200) return callback(new Error(`Ошибка загрузки: ${response.statusCode}`));
    if (!response.headers['content-type']?.startsWith('image')) {
      response.destroy();
      file.close();
      fs.unlink(dest, () => {});
      return callback(new Error('URL не содержит изображение'));
    }
    response.pipe(file);
    file.on('finish', () => file.close(callback));
  }).on('error', err => {
    fs.unlink(dest, () => callback(err));
  });
}

function copyImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error('Ошибка загрузки'));
      if (!res.headers['content-type']?.startsWith('image')) {
        res.destroy();
        return reject(new Error('Это не изображение'));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const image = nativeImage.createFromBuffer(buffer);
        if (image.isEmpty()) return reject(new Error('Пустое изображение'));
        clipboard.writeImage(image);
        resolve();
      });
    }).on('error', reject);
  });
}

function loadTabs(cb) {
  fs.readFile(paths.tabs, 'utf-8', (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        fs.writeFile(paths.tabs, '[]', 'utf-8', () => cb(null, []));
      } else {
        cb(err);
      }
    } else {
      try {
        // Проверяем, не пустой ли файл
        const parsed = data.trim() ? JSON.parse(data) : [];
        cb(null, parsed);
      } catch (parseErr) {
        // Если JSON битый, восстанавливаем файл пустым массивом
        fs.writeFile(paths.tabs, '[]', 'utf-8', () => cb(null, []));
      }
    }
  });
}

function loadTabsAsync() {
  return new Promise((resolve, reject) => {
    loadTabs((err, tabs) => {
      if (err) reject(err);
      else resolve(tabs);
    });
  });
}

function showContextMenu(win, params = {}) {
  const template = [
    { label: 'Назад', enabled: win.webContents.canGoBack(), click: () => win.webContents.goBack() },
    { label: 'Вперёд', enabled: win.webContents.canGoForward(), click: () => win.webContents.goForward() },
    { type: 'separator' },
    { label: 'Обновить', click: () => { saveTabs(); win.webContents.reload(); } },
    { type: 'separator' },
    { label: 'Копировать', role: 'copy', enabled: !!params.selectionText || isImageUrl(params.srcURL) },
    { label: 'Вставить', role: 'paste', enabled: params.editFlags?.canPaste },
    { type: 'separator' },
    {
      label: 'Открыть в новой вкладке',
      visible: !!params.linkURL,
      click: () => mainWindow?.webContents.send('open-link-in-new-tab', params.linkURL),
    },
  ];

  if (isImageUrl(params.srcURL)) {
    template.push(
      {
        label: 'Копировать изображение',
        click: async () => {
          try {
            await copyImageFromUrl(params.srcURL);
            win.webContents.send('show-notification', { title: 'Успешно', body: 'Изображение скопировано' });
          } catch {
            win.webContents.send('show-notification', { title: 'Ошибка', body: 'Не удалось скопировать изображение' });
          }
        }
      },
      {
        label: 'Скачать изображение',
        click: async () => {
          const { canceled, filePath } = await dialog.showSaveDialog(win, {
            title: 'Сохранить изображение как...',
            defaultPath: path.basename(params.srcURL),
            filters: [{ name: 'Изображения', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'] }]
          });
          if (!canceled && filePath) {
            downloadImage(params.srcURL, filePath, (err) => {
              const message = err
                ? { title: 'Ошибка', body: 'Ошибка загрузки изображения' }
                : { title: 'Сохранено', body: `Файл сохранён: ${filePath}` };
              win.webContents.send('show-notification', message);
            });
          }
        }
      }
    );
  }

  // Инспектор элемента
  template.push(
    { type: 'separator' },
    {
      label: 'Инспектор элемента',
      click: () => {
        if (params.x != null && params.y != null) {
          win.webContents.inspectElement(params.x, params.y);
          if (win.webContents.isDevToolsOpened()) {
            win.webContents.devToolsWebContents.focus();
          }
        }
      }
    }
  );

  Menu.buildFromTemplate(template).popup({ window: win });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800, height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: false,
    }
  });

  mainWindow.loadURL('https://example.com');

  mainWindow.webContents.on('context-menu', (event, params) => {
    showContextMenu(mainWindow, params);
  });
}

function filterTabs(tabs) {
  return tabs.filter(tab => {
    if (typeof tab !== 'string' || !tab.trim()) return false;
    try {
      const url = new URL(parseInputToUrl(tab));
      if (url.protocol === 'file:') return false;
      const forbidden = ['home/home.html', 'home/history.html', 'home/load.html'];
      return !forbidden.some(p => url.pathname.endsWith(p));
    } catch {
      return false;
    }
  });
}
function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "MyBrowser",
    icon: path.join(__dirname, 'build/icons/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      javascript: true,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      webviewTag: true,
      partition: 'persist:tabs'
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.once('did-finish-load', async () => {
    const bgData = readJSON(paths.background, {});
    mainWindow.webContents.send('set-background', bgData);

    const savedTabs = await loadTabsAsync();

    if (savedTabs.length > 0) {
      console.log('Tabs already saved, skipping home.html tab.');
    } else {
      const homePath = `file://${path.join(__dirname, 'home/home.html')}`;
      console.log('No saved tabs found, opening home.html');
      mainWindow.webContents.send('open-link-in-new-tab', homePath);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[DEBUG] Перенаправляем в текущей вкладке:', url);
    mainWindow.loadURL(url);
    return { action: 'deny' };
  });

  function isSafeUrl(url) {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch (e) {
      return false;
    }
  }

  mainWindow.webContents.on('context-menu', (event, params) => {
    showContextMenu(mainWindow, params);
  });

  mainWindow.on('close', (e) => {
    if (detachedWindows.length) {
      e.preventDefault();
      mainWindow.webContents.send('warn-cannot-close-main', 'Сначала закройте отдельные вкладки.');
    }
  });

  const shortcut = process.platform === 'darwin' ? 'Cmd+M' : 'Ctrl+M';
  globalShortcut.register(shortcut, () => showContextMenu(mainWindow, {}));

  // Добавляем слушатель для возврата вкладки из отдельного окна
  const { ipcMain } = require('electron');
  ipcMain.on('return-tab-to-main', (event, url) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (isSafeUrl(url)) {
        // Можно сделать открытие в новой вкладке, либо просто загрузить в mainWindow
        mainWindow.webContents.send('open-link-in-new-tab', url);
        mainWindow.show();
        mainWindow.focus();
      } else {
        console.warn(`Получен небезопасный URL для возврата вкладки: ${url}`);
      }
    }
  });

  return mainWindow;
}


// === IPC ===

ipcMain.handle('get-sources', async (event, types = ['screen', 'window']) => {
  const sources = await desktopCapturer.getSources({ types });
  return sources.map(source => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
  }));
});

ipcMain.on('set-proxy', async (event, proxy) => {
  // Используем сессию с partition, которая у тебя в webview (например, 'persist:tabs')
  const ses = session.fromPartition('persist:tabs');

  try {
    if (!proxy || proxy === "none") {
      await ses.setProxy({ proxyRules: '' });
      console.log("🚫 Прокси отключён");
    } else {
      await ses.setProxy({ proxyRules: proxy });
      console.log("✅ Прокси установлен:", proxy);
    }

    // Проверим какой прокси сейчас используется
    const proxyUsed = await ses.resolveProxy('https://example.com');
    console.log("Используемый прокси:", proxyUsed);

    // Отправим подтверждение в рендерер
    event.sender.send('proxy-set-success', proxyUsed);
  } catch (err) {
    console.error("Ошибка при установке прокси:", err);
    event.sender.send('proxy-set-failure', err.message);
  }
});

ipcMain.on('show-context-menu', (event, params) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  showContextMenu(win, params);
});

ipcMain.on('open-link-in-tab', (_, input) => {
  mainWindow?.webContents.send('open-link-in-new-tab', parseInputToUrl(input));
});

ipcMain.handle('save-tabs', async (event, tabsState) => {
  const savePath = path.join(app.getPath('userData'), 'tabs.json');
  fs.writeFileSync(savePath, JSON.stringify(tabsState, null, 2), 'utf-8');
  return true;
});

ipcMain.handle('get-saved-tabs', () => openTabs);

ipcMain.handle('load-tabs', async () => {
  try {
    const tabsJson = await fs.promises.readFile(paths.tabs, 'utf8');
    if (!tabsJson.trim()) {
      // Пустой файл — возвращаем пустой массив
      return [];
    }
    return JSON.parse(tabsJson);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await fs.promises.writeFile(paths.tabs, '[]', 'utf8');
      return [];
    }
    // Если JSON.parse упал из-за синтаксической ошибки — тоже возвращаем пустой массив и перезаписываем файл
    if (err instanceof SyntaxError) {
      await fs.promises.writeFile(paths.tabs, '[]', 'utf8');
      return [];
    }
    throw err;
  }
});


ipcMain.handle('get-background', () => readJSON(paths.background, {}));
ipcMain.handle('set-background', (_, data) => {
  const success = writeJSON(paths.background, data);
  console.log(`[Background] ${success ? 'Фон успешно сохранён.' : 'Не удалось сохранить фон.'}`);
  return success;
});

ipcMain.on('add-history', (_, entry) => {
  const history = readJSON(paths.history);
  history.push(entry);
  writeJSON(paths.history, history.slice(-500));
});
ipcMain.handle('get-history', () => readJSON(paths.history));
ipcMain.handle('clear-history', () => {
  if (fs.existsSync(paths.history)) {
    fs.unlinkSync(paths.history);
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('get-passwords', () => readJSON(paths.passwords, []));
ipcMain.handle('save-passwords', (_, passwords) => writeJSON(paths.passwords, passwords));
ipcMain.handle('add-password', (_, entry) => {
  const passwords = readJSON(paths.passwords, []);
  passwords.push(entry);
  return writeJSON(paths.passwords, passwords);
});
ipcMain.handle('delete-password', (_, id) => {
  const filtered = readJSON(paths.passwords, []).filter(p => p.id !== id);
  return writeJSON(paths.passwords, filtered);
});


function loadBookmarks() {
  try {
    return JSON.parse(fs.readFileSync(paths.bookmarks, 'utf8'));
  } catch {
    return [];
  }
}

function saveBookmarks(bookmarks) {
  writeJSON(paths.bookmarks, bookmarks);
}

ipcMain.handle('get-bookmarks', () => loadBookmarks());
ipcMain.handle('save-bookmark', (_, bookmark) => {
  const bookmarks = loadBookmarks();
  const id = bookmarks.length ? Math.max(...bookmarks.map(b => b.id || 0)) + 1 : 1;
  bookmark.id = id;
  bookmarks.push(bookmark);
  saveBookmarks(bookmarks);
  return id;
});
ipcMain.handle('delete-bookmark', (_, id) => {
  const bookmarks = loadBookmarks().filter(b => b.id !== id);
  saveBookmarks(bookmarks);
  return true;
});

ipcMain.handle('get-widget-settings', () => readJSON(paths.widgets, []));
ipcMain.handle('save-widget-settings', (_, widgets) => writeJSON(paths.widgets, widgets));

ipcMain.handle('get-widgets', async () => {
  const filePath = path.join(app.getPath('userData'), 'widgets.json');

  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    console.log('Widgets file not found or invalid, creating default...');
    const defaultWidgets = {
      clock: true,
      weather: true,
      calendar: true,
      bookmarks: true,
    };
    try {
      await fs.writeFile(filePath, JSON.stringify(defaultWidgets, null, 2)); // 👈 без 'utf-8'
    } catch (writeErr) {
      console.error('Failed to write widgets.json:', writeErr);
    }
    return defaultWidgets;
  }
});


ipcMain.handle('save-widgets', (_, widgets) => {
  console.log('[INFO] Что-то изменилось');
  console.warn('[WARN] Что-то странное произошло');
  console.error('[ERROR] Что-то пошло не так');

  return writeJSON(paths.widgets, widgets);
});


ipcMain.handle('add-widget', (_, widget) => {
  const widgets = readJSON(paths.widgets, []);
  widget.id = Date.now(); // уникальный ID
  widgets.push(widget);

  console.log('[INFO] Добавляем виджет', widget);

  const success = writeJSON(paths.widgets, widgets);
  return success ? widget.id : null;
});

ipcMain.handle('delete-widget', (_, id) => {
  const widgets = readJSON(paths.widgets, []);
  const filtered = widgets.filter(w => w.id !== id);

  console.log('[INFO] Удаляем виджет с id:', id);

  return writeJSON(paths.widgets, filtered);
});

ipcMain.handle('clear-data', (_, mode = 'history') => {
  const targets = {
    history: [paths.history],
    passwords: [paths.passwords],
    all: [paths.history, paths.passwords, paths.autofill],
  }[mode] || [];

  try {
    targets.forEach(file => fs.existsSync(file) && fs.unlinkSync(file));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.on('detach-tab', (_, url) => {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      webviewTag: true,
    },
  });

  win.loadFile('detached.html');
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('load-url', parseInputToUrl(url));
  });

  win.on('closed', () => {
    detachedWindows = detachedWindows.filter(w => w !== win);
  });

  detachedWindows.push(win);
});

ipcMain.on('return-tab-to-main', (event, url) => {
  console.log('Main process получил return-tab-to-main с url:', url);

  if (mainWindow && url) {
    mainWindow.webContents.send('open-tab-from-window', url);
  }
});

ipcMain.on('open-history-window', () => {
  if (historyWindow) return historyWindow.focus();

  historyWindow = new BrowserWindow({
    width: 700,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      webviewTag: true,
    },
  });

  historyWindow.loadFile('home/history.html');
  historyWindow.on('closed', () => {
    historyWindow = null;
  });
});

app.whenReady().then(async () => {
  const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));
  const { Request } = require('@cliqz/adblocker'); // импортируем для ручной проверки

  // Загружаем фильтры EasyList + EasyPrivacy
  const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);

  // Получаем пользовательскую сессию
  const customSession = session.fromPartition('persist:tabs');

  // Белый список доменов (YouTube)
  const whiteListHosts = new Set([
    'www.youtube.com',
    'youtube.com',
  ]);

  // Ручная блокировка запросов через webRequest
  customSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, async (details, callback) => {
    const url = details.url;

    try {
      const parsed = new URL(url);

      // Пропускаем запрос, если он в белом списке
      if (whiteListHosts.has(parsed.hostname)) {
        console.log(`[AdBlocker] Пропущено (whitelist): ${url}`);
        return callback({ cancel: false });
      }

      // Проверяем, должен ли блокироваться
      const req = Request.fromRawDetails({
        url: details.url,
        method: details.method,
        resourceType: details.resourceType,
      });

      const { match } = blocker.match(req);

      if (match) {
        console.log(`[AdBlocker] Заблокировано: ${url}`);
        return callback({ cancel: true });
      }

      return callback({ cancel: false });

    } catch (e) {
      console.warn('[AdBlocker] Ошибка анализа URL:', url, e.message);
      return callback({ cancel: false });
    }
  });

  // Необязательно: лог событий (например, для отладки фильтров)
  blocker.on('request-blocked', (req) => {
    console.log(`[AdBlocker] Заблокировано (match log): ${req.url}`);
  });

  // Создаём главное окно
  mainWindow = createMainWindow();

  // macOS: повторное открытие окна при активации приложения
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});



app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});