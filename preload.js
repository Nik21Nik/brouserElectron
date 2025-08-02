const { contextBridge, ipcRenderer } = require('electron');

// === IPC Renderer API ===
contextBridge.exposeInMainWorld('ipcRenderer', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, listener) => ipcRenderer.on(channel, listener),
});

// === electronAPI ===
contextBridge.exposeInMainWorld('electronAPI', {
  openLinkInTab: (url) => ipcRenderer.send('open-link-in-tab', url),
  getSources: (types) => ipcRenderer.invoke('get-sources', types),
  setProxy: (proxy) => ipcRenderer.send('set-proxy', proxy),

  onOpenLinkInNewTab: (callback) => {
    ipcRenderer.on('open-link-in-new-tab', (_, url) => callback(url));
  },
});

// === tabAPI ===
contextBridge.exposeInMainWorld('tabAPI', {
  // Отправка запроса на открытие новой вкладки с URL
  sendOpenLinkInNewTab: (url) => {
    ipcRenderer.send('open-link-in-new-tab', url);
  },

  // Слушатель для события открытия новой вкладки из main процесса
  onOpenLinkInNewTab: (callback) => {
    ipcRenderer.on('open-link-in-new-tab', (event, url) => {
      console.log('[preload] open-link-in-new-tab:', url);
      callback(url);
    });
  },

  detachTab: (url) => ipcRenderer.send('detach-tab', url),
  returnToMain: (url) => ipcRenderer.send('return-tab-to-main', url),
  saveTabs: (tabs) => ipcRenderer.invoke('save-tabs', tabs),
  getSavedTabs: () => ipcRenderer.invoke('get-saved-tabs'),

  openHistory: () => ipcRenderer.send('open-history-window'),
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: (mode = 'history') => ipcRenderer.invoke('clear-history', mode),

  setBackground: (dataUrl) => ipcRenderer.invoke('set-background', dataUrl),
  getBackground: () => ipcRenderer.invoke('get-background'),

  savePassword: (site, username, password) =>
    ipcRenderer.invoke('save-password', { site, username, password }),
  getPasswords: () => ipcRenderer.invoke('get-passwords'),

  saveAutofill: (field, value) =>
    ipcRenderer.invoke('save-autofill', { field, value }),
  getAutofill: () => ipcRenderer.invoke('get-autofill'),

  saveWidgetSettings: (settings) => ipcRenderer.send('save-widget-settings', settings),
  getWidgetSettings: () => ipcRenderer.invoke('get-widget-settings'),
  getWidgets: () => ipcRenderer.invoke('get-widgets'),

  navigateFromInput: (input) => {
    input = input.trim();
    const hasProtocol = /^https?:\/\//i.test(input);
    const isDomain = /^[\w-]+\.[\w]{2,}(\/.*)?$/.test(input);

    let url;
    if (hasProtocol) {
      url = input;
    } else if (isDomain) {
      url = `https://${input}`;
    } else {
      const encoded = encodeURIComponent(input);
      url = `https://yandex.ru/search/?text=${encoded}`;
    }

    ipcRenderer.send('open-link-in-tab', url);
  },

  onRestoreTab: (callback) => {
    ipcRenderer.on('restore-tab', (_, url) => callback(url));
  },
  onWarnCannotCloseMain: (callback) => {
    ipcRenderer.on('warn-cannot-close-main', (_, message) => callback(message));
  },

  saveBookmark: (bookmark) => ipcRenderer.invoke('save-bookmark', bookmark),
  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  deleteBookmark: (id) => ipcRenderer.invoke('delete-bookmark', id),
});

// === notifications API ===
contextBridge.exposeInMainWorld('notifications', {
  onShowNotification: (callback) => {
    ipcRenderer.on('show-notification', (_, data) => callback(data));
  },
});

// === Контекстное меню ===
window.addEventListener('contextmenu', (event) => {
  event.preventDefault();

  const target = event.target;
  const anchor = target.closest('a');
  const img = target.closest('img');
  const selection = window.getSelection()?.toString();

  const params = {
    x: event.clientX,
    y: event.clientY,
    linkURL: anchor?.href || '',
    srcURL: img?.src || '',
    mediaType: img ? 'image' : '',
    selectionText: selection || '',
  };

  ipcRenderer.send('show-context-menu', params);
});

window.addEventListener('mousedown', () => {
  ipcRenderer.send('hide-context-menu');
});

// === Перехват window.open и ссылок с target="_blank" ===
window.open = (url) => {
  if (url && typeof url === 'string') {
    ipcRenderer.send('open-link-in-tab', url);
  }
};

window.addEventListener('click', (e) => {
  const anchor = e.target.closest('a');
  if (anchor && anchor.target === '_blank' && anchor.href) {
    e.preventDefault();
    ipcRenderer.send('open-link-in-tab', anchor.href);
  }
});

// === Добавление новой вкладки ===
function addNewTab(url) {
  const tabContainer = document.querySelector('#content');
  if (!tabContainer) {
    console.warn('[addNewTab] Контейнер вкладок не найден');
    return Promise.reject(new Error('Tab container not found'));
  }

  // Деактивируем существующие вкладки
  tabContainer.querySelectorAll('.view').forEach(view => view.classList.remove('active'));

  const webview = document.createElement('webview');
  webview.src = url;
  webview.setAttribute('partition', 'persist:tabs');
  webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no');
  webview.classList.add('view', 'active');
  webview.style.width = '100%';
  webview.style.height = '100%';

  tabContainer.appendChild(webview);
  return Promise.resolve();
}

// === Обработка событий от main ===
ipcRenderer.on('open-link-in-new-tab', (event, url) => {
  console.log('[preload] received open-link-in-new-tab:', url);
  addNewTab(url).then(() => {
    ipcRenderer.send('tab-opened');
  }).catch(() => {
    ipcRenderer.send('tab-opened');
  });
});

ipcRenderer.on('restore-tab', (_, url) => {
  addNewTab(url);
});

window.addEventListener('DOMContentLoaded', () => {
  console.log('[preload] DOM loaded and initialized');
});
