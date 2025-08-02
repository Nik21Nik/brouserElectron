const { contextBridge, desktopCapturer, ipcRenderer } = require('electron');
const path = require('path');
const punycode = require('punycode/');

window.ipcRenderer = require('electron').ipcRenderer;

// --- Элементы UI ---
const content = document.getElementById('content');
const urlInput = document.getElementById('url');
const tabMenu = document.getElementById('tabMenu');
const preview = document.getElementById('previewPopup');
const previewView = document.getElementById('previewView');
const zoomLevelLabel = document.getElementById('zoom-level');
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const tabToggle = document.getElementById('tabToggle');
const nav = document.getElementById('nav');

let hidePreviewTimer = null;
let tabMenuHideTimer = null;
let tabData = [];
let tabs = [];
let activeTabId = null;
let tabCount = 0;

const homePage = `file://${path.resolve(__dirname, 'home/home.html')}`;
const defaultStartPage = 'https://www.google.com';

function addNewTab(url = defaultStartPage) {
  console.log('📢 Функция addNewTab вызвана с URL:', url);

  const id = `tab${++tabCount}`;
  console.log('🆔 Новый ID вкладки:', id);

  const webview = document.createElement('webview');
  webview.src = url;
  webview.setAttribute('partition', 'persist:tabs');
  webview.setAttribute('webpreferences', 'contextIsolation=no,nodeIntegration=yes');
  webview.classList.add('view', 'active');
  webview.style.width = '100%';
  webview.style.height = '100%';

  const content = document.getElementById('content');
  if (!content) {
    console.warn('⚠️ Элемент #content не найден! Вкладка не будет добавлена.');
    return;
  }

  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));

  content.appendChild(webview);
  console.log('✅ Вебвью добавлен в DOM');

  const tab = { id, webview, zoomFactor: 1, pinned: false };
  tabs.push(tab);
  console.log('📦 Текущий список вкладок:', tabs);

  activeTabId = id;

  applyZoom(tab);
  renderTabMenu();
  saveTabsState();
}

window.addNewTab = function(url = defaultStartPage) {
  console.log('📢 Функция addNewTab вызвана с URL:', url);
  // твой код добавления вкладки
};


// А ниже может быть остальная логика
document.getElementById('go').addEventListener('click', () => {
  const input = document.getElementById('url').value;
  window.tabAPI.navigateFromInput(input);
});

function formatUrl(input) {
  input = input.trim();
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(input)) {
    input = 'https://' + input;
  }
  try {
    return new URL(input).toString();
  } catch {
    return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
  }
}

function decodePunycodeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hostname = punycode.toUnicode(parsed.hostname);
    return parsed.toString();
  } catch {
    return url;
  }
}

function updateZoomDisplay(factor) {
  zoomLevelLabel.textContent = `${Math.round(factor * 100)}%`;
}

function applyZoom(tab) {
  if (!tab || !tab.webview) return;

  if (tab.webview.isLoading()) {
    tab.webview.addEventListener('dom-ready', () => {
      tab.webview.setZoomFactor(tab.zoomFactor);
      updateZoomDisplay(tab.zoomFactor);
    }, { once: true });
  } else {
    tab.webview.setZoomFactor(tab.zoomFactor);
    updateZoomDisplay(tab.zoomFactor);
  }
}

function getCurrentTab() {
  return tabs.find(t => t.id === activeTabId);
}

// --- СОХРАНЕНИЕ СОСТОЯНИЯ ВКЛАДОК С УЧЁТОМ PIN ---
async function saveTabsState() {
  try {
    const tabsState = tabs.map(t => ({
      url: t.webview.getURL(),
      pinned: Boolean(t.pinned),
    }));
    await ipcRenderer.invoke('save-tabs', tabsState);
  } catch (error) {
    console.error('Ошибка сохранения вкладок:', error);
  }
}

// Новая функция загрузки состояния вкладок
async function loadTabsState() {
  try {
    const savedTabsState = await ipcRenderer.invoke('load-tabs');
    if (!Array.isArray(savedTabsState)) return;

    // Очистить текущие вкладки
    tabs.length = 0;
    const tabsContainer = document.getElementById('tabs-container'); // контейнер для <webview>

    // Очистить DOM
    tabsContainer.innerHTML = '';

    for (const tabData of savedTabsState) {
      // Создаём элемент <webview>
      const webview = document.createElement('webview');
      webview.src = tabData.url;
      webview.setAttribute('partition', 'persist:tabs'); // пример, если используешь partition
      webview.style.width = '100%';
      webview.style.height = '100%';
      webview.setAttribute('preload', 'path/to/preload.js'); // если используешь preload

      // Добавляем webview в DOM
      tabsContainer.appendChild(webview);

      // Ждём пока webview загрузится (dom-ready)
      await new Promise((resolve) => {
        webview.addEventListener('dom-ready', resolve, { once: true });
      });

      // Создаём объект вкладки с webview
      const newTab = {
        webview,
        pinned: tabData.pinned,
      };

      tabs.push(newTab);

      // Можно активировать вкладку, например:
      // activateTab(newTab);
    }
  } catch (error) {
    console.error('Ошибка загрузки вкладок:', error);
  }
}


function updateTabTitle(id, title) {
  const tab = tabs.find(t => t.id === id);
  if (tab) {
    tab.title = title;
    renderTabMenu();
    saveTabsState();
  }
}

function observeWebviewFullscreen(webview) {
  webview.addEventListener('enter-html-full-screen', () => handleFullscreenChange(true));
  webview.addEventListener('leave-html-full-screen', () => handleFullscreenChange(false));
  webview.addEventListener('ipc-message', event => {
    if (event.channel === 'fullscreen') {
      handleFullscreenChange(event.args[0]);
    }
  });
}

function handleFullscreenChange(isFullscreen) {
  if (nav) {
    nav.style.display = isFullscreen ? 'none' : 'flex';
  }
}

document.addEventListener('fullscreenchange', () => {
  handleFullscreenChange(!!document.fullscreenElement);
});
document.addEventListener('webkitfullscreenchange', () => {
  handleFullscreenChange(!!document.webkitFullscreenElement);
});

// --- СОЗДАНИЕ ВКЛАДКИ ---
function createTab(url = defaultStartPage, title = 'Новая вкладка', pinned = false) {
  const id = `tab${++tabCount}`;

  const view = document.createElement('div');
  view.className = 'view';
  view.dataset.id = id;

  const webview = document.createElement('webview');
  webview.src = url;
  webview.setAttribute('partition', 'persist:tabs');
  webview.setAttribute('preload', path.join(__dirname, 'preload.js'));
  webview.style.width = '100%';
  webview.style.height = '100%';

  observeWebviewFullscreen(webview);

  // Создаем объект вкладки с url по умолчанию
  const tab = { id, title, url, view, webview, zoomFactor: 1, pinned };

  // Ждем, когда webview будет готов, чтобы получить URL и title
  webview.addEventListener('dom-ready', () => {
    tab.url = webview.getURL();
    tab.title = webview.getTitle() || tab.title;
    updateTabTitle(id, tab.title);  // обновляем название вкладки
    renderTabMenu();                // обновляем меню вкладок
    saveTabsState();                // сохраняем состояние вкладок
  });

  webview.addEventListener('page-title-updated', e => {
    tab.title = e.title;
    updateTabTitle(id, e.title);
    renderTabMenu();
    saveTabsState();

    ipcRenderer.send('add-history', {
      url: webview.getURL(),
      title: e.title,
      date: new Date().toISOString(),
    });
  });

  const updateUrlInput = () => {
    if (activeTabId === id) {
      const currentUrl = webview.getURL();
      tab.url = currentUrl;  // обновляем url в объекте вкладки
      urlInput.value = currentUrl.includes('home/home.html') ? '' : decodePunycodeUrl(currentUrl);
      applyZoom(getCurrentTab());
      renderTabMenu();
      saveTabsState();
    }
  };

  webview.addEventListener('did-navigate', updateUrlInput);
  webview.addEventListener('did-finish-load', updateUrlInput);

  ipcRenderer.on('open-link-in-new-tab', (_, url) => {
    createTab(url);
  });

  view.appendChild(webview);
  content.appendChild(view);

  tabs.push(tab);

  renderTabMenu();
  activateTab(id);
  saveTabsState();
}

// --- АКТИВАЦИЯ ВКЛАДКИ ---
function activateTab(id) {
  activeTabId = id;
  tabs.forEach(t => t.view.classList.toggle('active', t.id === id));

  const current = getCurrentTab();
  if (current) {
    applyZoom(current);
  }

  renderTabMenu();
  tabMenu.classList.remove('visible');
  resetPreview();
}

// --- ЗАКРЫТИЕ ВКЛАДКИ ---
function closeTab(id) {
  const index = tabs.findIndex(t => t.id === id);
  if (index === -1) return;

  // Если вкладка закреплена, запрещаем закрывать (можно поменять логику при желании)
  if (tabs[index].pinned) {
    alert('Эту вкладку нельзя закрыть, она закреплена.');
    return;
  }

  const wasActive = tabs[index].id === activeTabId;

  tabs[index].view.remove();
  tabs.splice(index, 1);
  resetPreview();

  if (wasActive) {
    if (tabs.length) {
      activateTab(tabs[0].id);
    } else {
      createTab(defaultStartPage);
    }
  } else {
    renderTabMenu();
  }

  saveTabsState();
}

function resetPreview() {
  preview.classList.remove('show');
  previewView.src = 'about:blank';
}

// --- ОТОБРАЖЕНИЕ МЕНЮ ВКЛАДОК ---
function renderTabMenu() {
  tabMenu.innerHTML = '';

  tabs.forEach(tab => {
    const tabRow = document.createElement('div');
    tabRow.style.display = 'flex';
    tabRow.style.alignItems = 'center';
    tabRow.style.justifyContent = 'space-between';
    tabRow.style.gap = '8px';
    tabRow.style.padding = '4px 8px';
    tabRow.style.cursor = 'pointer';
    tabRow.style.overflow = 'visible'; // важно!

    const btn = document.createElement('div');
    btn.className = 'tab-btn' + (tab.id === activeTabId ? ' active' : '');
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.flex = '1';
    btn.style.overflow = 'hidden';

    const favicon = document.createElement('img');
    favicon.src = 'https://www.google.com/s2/favicons?domain=' + (tab.url ? new URL(tab.url).hostname : ''); 
    favicon.style.width = '16px';
    favicon.style.height = '16px';
    favicon.style.marginRight = '6px';

    const label = document.createElement('span');
    label.textContent = tab.title || 'Вкладка';
    label.title = tab.title || 'Вкладка';
    label.style.flex = '1';
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';
    label.style.whiteSpace = 'nowrap';
    label.style.minWidth = '0';

    // Добавляем иконку закрепления
    const pinIcon = document.createElement('span');
    pinIcon.textContent = tab.pinned ? '🖈' : '✓';
    pinIcon.title = tab.pinned ? 'Открепить вкладку' : 'Закрепить вкладку';
    pinIcon.style.cursor = 'pointer';
    pinIcon.style.marginRight = '8px';
    pinIcon.onclick = e => {
      e.stopPropagation();
      tab.pinned = !tab.pinned;
      renderTabMenu();
      saveTabsState();
    };

    const muteIcon = document.createElement('span');
    muteIcon.textContent = tab.muted ? '🔇' : '🔊'; // иконка громкости или выключенного звука
    muteIcon.title = tab.muted ? 'Включить звук' : 'Отключить звук';
    muteIcon.style.cursor = 'pointer';
    muteIcon.style.marginRight = '8px';
    muteIcon.onclick = e => {
      e.stopPropagation();
      tab.muted = !tab.muted;
    if (tab.webview) {
      tab.webview.setAudioMuted(tab.muted);
    }
      renderTabMenu();
      saveTabsState
    };
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '6px';
    actions.style.flexShrink = '0';

    const detach = document.createElement('span');
    detach.textContent = '⤴';
    detach.title = 'Открепить';
    detach.style.cursor = 'pointer';
    detach.onclick = e => {
    e.stopPropagation();
    if (tab.webview) {
      const currentURL = tab.webview.getAttribute('src');
    tabData.push({
      id: tab.id,
      url: currentURL
    });
    ipcRenderer.send('detach-tab', currentURL.includes('home/home.html') ? `${currentURL}?detached=true` : currentURL);
    closeTab(tab.id);
    }
  };


    const close = document.createElement('span');
    close.textContent = '×';
    close.title = 'Закрыть';
    close.style.cursor = 'pointer';
    close.onclick = e => {
      e.stopPropagation();
      closeTab(tab.id);
    };

    actions.appendChild(detach);
    actions.appendChild(close);
    btn.append(pinIcon, favicon, label);
    tabRow.append(btn, actions);
    actions.insertBefore(muteIcon, detach)
    tabMenu.appendChild(tabRow);

    btn.onclick = () => activateTab(tab.id);
  });

  const controlGroup = document.createElement('div');
  controlGroup.style.display = 'flex';
  controlGroup.style.flexDirection = 'column';
  controlGroup.style.marginTop = '8px';
  controlGroup.style.gap = '6px';

  const addBtn = document.createElement('button');
  addBtn.textContent = '+ Новая вкладка';
  addBtn.onclick = () => createTab();

  const homeBtn = document.createElement('button');
  homeBtn.textContent = '🏠 Домашняя страница';
  homeBtn.onclick = () => createTab(homePage, 'Домашняя страница');

  const closeAllBtn = document.createElement('button');
  closeAllBtn.textContent = '✖ Закрыть все вкладки';
  closeAllBtn.onclick = () => {
  tabs.slice().forEach(t => {
    if (!t.pinned) closeTab(t.id);
  });
  
  // Если после закрытия нет вкладок — создаём новую
  if (tabs.length === 0) {
    createTab(defaultStartPage);
  }
};


  controlGroup.append(addBtn, homeBtn, closeAllBtn);
  tabMenu.appendChild(controlGroup);
}
// --- Контекстное меню ---
let contextMenu = null;

function createContextMenu() {
  contextMenu = document.createElement('div');
  contextMenu.id = 'contextMenu';
  Object.assign(contextMenu.style, {
    position: 'fixed',
    background: '#000000',
    boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
    borderRadius: '6px',
    padding: '6px 0',
    minWidth: '160px',
    zIndex: 9999,
    fontFamily: 'sans-serif',
    display: 'none',
  });
  document.body.appendChild(contextMenu);
}

function clearContextMenu() {
  if (contextMenu) {
    contextMenu.style.display = 'none';
    contextMenu.innerHTML = '';
  }
}

function showContextMenu(items, x, y) {
  if (!contextMenu) createContextMenu();
  contextMenu.innerHTML = '';

  items.forEach(item => {
    const el = document.createElement('div');
    el.textContent = item.label;
    el.style.padding = '8px 16px';
    el.style.cursor = 'pointer';
    el.onmouseenter = () => el.style.backgroundColor = '#f0f0f0';
    el.onmouseleave = () => el.style.backgroundColor = '';
    el.onclick = () => {
      clearContextMenu();
      item.click();
    };
    contextMenu.appendChild(el);
  });

  const winWidth = window.innerWidth;
  const winHeight = window.innerHeight;
  const menuRect = contextMenu.getBoundingClientRect();
  let posX = x;
  let posY = y;
  if (posX + menuRect.width > winWidth) posX = winWidth - menuRect.width - 10;
  if (posY + menuRect.height > winHeight) posY = winHeight - menuRect.height - 10;

  contextMenu.style.left = posX + 'px';
  contextMenu.style.top = posY + 'px';
  contextMenu.style.display = 'block';
}

window.addEventListener('contextmenu', e => {
  e.preventDefault();
  const target = e.target;
  const anchor = target.closest('a');
  const img = target.closest('img');
  const selection = window.getSelection()?.toString();

  let items = [];

  if (anchor?.href) {
    items = [
      { label: 'Открыть ссылку в новой вкладке', click: () => ipcRenderer.send('open-link-in-new-tab', anchor.href) },
      { label: 'Копировать адрес ссылки', click: () => navigator.clipboard.writeText(anchor.href) },
    ];
  } else if (img?.src) {
    items = [
    ];
  } else if (selection) {
    items = [{ label: 'Копировать выделенный текст', click: () => navigator.clipboard.writeText(selection) }];
  } else {
    items = [
      { label: 'Закрыть вкладку', click: () => closeTab(activeTabId) },
    ];
  }

  showContextMenu(items, e.clientX, e.clientY);
});

window.addEventListener('click', clearContextMenu);
window.addEventListener('blur', clearContextMenu);

// --- Загрузка сохранённых вкладок при старте ---
ipcRenderer.invoke('load-tabs').then(savedTabs => {
  if (savedTabs && savedTabs.length > 0) {
    savedTabs.forEach(t => createTab(t.url, undefined, t.pinned));
  } else {
    
  }
}).catch(e => {
  console.error('Ошибка загрузки вкладок:', e);

});

// --- Управление зумом ---
zoomInBtn.onclick = () => {
  const tab = getCurrentTab();
  if (tab) {
    tab.zoomFactor = Math.min(tab.zoomFactor + 0.1, 3);
    applyZoom(tab);
  }
};
zoomOutBtn.onclick = () => {
  const tab = getCurrentTab();
  if (tab) {
    tab.zoomFactor = Math.max(tab.zoomFactor - 0.1, 0.25);
    applyZoom(tab);
  }
};

// --- Навигация URL ---
urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const tab = getCurrentTab();
    if (tab) {
      const url = formatUrl(urlInput.value);
      tab.webview.loadURL(url);
    }
  }
});

// --- Показать/скрыть меню вкладок ---
let tabMenuHover = false;

tabToggle.addEventListener('mouseenter', () => {
  tabMenu.classList.add('visible');
});

tabToggle.addEventListener('mouseleave', () => {
  setTimeout(() => {
    if (!tabMenuHover) {
      tabMenu.classList.remove('visible');
    }
  }, 200);
});

tabMenu.addEventListener('mouseenter', () => {
  tabMenuHover = true;
  tabMenu.classList.add('visible');
});

tabMenu.addEventListener('mouseleave', () => {
  tabMenuHover = false;
  tabMenu.classList.remove('visible');
});

document.addEventListener('DOMContentLoaded', () => {
  const backBtn = document.getElementById('back');
  const forwardBtn = document.getElementById('forward');
  const reloadBtn = document.getElementById('reload');
  const goBtn = document.getElementById('go');
  const urlInput = document.getElementById('url');

  const zoomInBtn = document.getElementById('zoomIn');
  const zoomOutBtn = document.getElementById('zoomOut');
  const zoomLevelDisplay = document.getElementById('zoom-level');

  // Получить активный webview (на текущей вкладке)
  const getCurrentWebview = () => {
    return document.querySelector('.view.active webview');
  };

  // Обновить отображение текущего зума
  const updateZoomDisplay = (zoom) => {
    zoomLevelDisplay.textContent = `${Math.round(zoom * 100)}%`;
  };

  // Применить зум к активному webview
  const applyZoom = (zoom) => {
    const webview = getCurrentWebview();
    if (!webview) return;
    webview.setZoomFactor(zoom);
    updateZoomDisplay(zoom);
  };

  // Начальный зум (1 = 100%)
  let currentZoom = 1;

  // Навигация по вкладкам
  backBtn.addEventListener('click', () => {
    const webview = getCurrentWebview();
    if (webview && webview.canGoBack()) webview.goBack();
  });

  forwardBtn.addEventListener('click', () => {
    const webview = getCurrentWebview();
    if (webview && webview.canGoForward()) webview.goForward();
  });

  reloadBtn.addEventListener('click', () => {
    const webview = getCurrentWebview();
    if (webview) webview.reload();
  });

  goBtn.addEventListener('click', () => {
    const webview = getCurrentWebview();
    let url = urlInput.value.trim();
    if (webview && url) {
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      webview.loadURL(url);
    }
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const webview = getCurrentWebview();
      let url = urlInput.value.trim();
      if (webview && url) {
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
        webview.loadURL(url);
      }
    }
  });

  // Зум через кнопки
  zoomInBtn.addEventListener('click', () => {
    currentZoom = Math.min(currentZoom + 0.1, 3);
    applyZoom(currentZoom);
  });

  zoomOutBtn.addEventListener('click', () => {
    currentZoom = Math.max(currentZoom - 0.1, 0.25);
    applyZoom(currentZoom);
  });

  if (webview) {
    webview.setZoomFactor(currentZoom);
    updateZoomDisplay(currentZoom);
  }
});

window.addEventListener('DOMContentLoaded', () => {
  if (window.tabAPI && typeof window.tabAPI.onRestoreTab === 'function') {
    window.tabAPI.onRestoreTab((url) => {
      addNewTab(url);
    });
  } else {
    console.error('tabAPI or onRestoreTab is not available');
  }
});

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenSources: async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true
    });
    // Преобразуем источники в простой формат
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL()
    }));
  },
  startCapture: (sourceId) => ipcRenderer.invoke('start-capture', sourceId)
});

window.addEventListener('DOMContentLoaded', () => {
  const webview = document.querySelector('webview');
  if (webview) {
    webview.addEventListener('new-window', (e) => {
      e.preventDefault();
      ipcRenderer.send('webview-open-url', e.url);
    });
  }
});

function addTab(url) {
  console.log('Добавляем вкладку с URL:', url);
  // Добавление вкладки в массив tabs, обновление интерфейса, активация и т.п.
  tabs.push({ id: generateId(), url, title: 'Новая вкладка' });
  activeTabId = tabs[tabs.length - 1].id;
  renderTabMenu();
  saveTabsState();
}

ipcRenderer.on('open-tab-from-window', (event, url) => {
  console.log('Основное окно получило open-tab-from-window:', url);
  addNewTab(url);  // Функция, которая добавляет новую вкладку в список
});

window.addEventListener('DOMContentLoaded', async () => {
  const tabsState = await ipcRenderer.invoke('load-tabs');

  if (Array.isArray(tabsState) && tabsState.length > 0) {
    for (const tab of tabsState) {
      createTab(tab);
    }
  }
  // else больше не нужен — вкладку с home.html пришлёт main через set-tabs
});

ipcRenderer.on('set-tabs', (_, tabs) => {
  if (Array.isArray(tabs)) {
    tabs.forEach(createTab);
  }
});

function reloadAllTabs() {
  const tabContainer = document.querySelector('#content');
  const webviews = tabContainer.querySelectorAll('webview');
  webviews.forEach(wv => wv.reload());
}

