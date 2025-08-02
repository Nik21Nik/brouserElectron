// Элементы DOM
const searchBox       = document.getElementById('searchBox');
const panelHandle     = document.getElementById('panelHandle');
const sidePanel       = document.getElementById('sidePanel');
const tiles           = document.querySelectorAll('.tile');
const fileInput       = document.getElementById('fileInput');
const background      = document.getElementById('background');
const body            = document.body;

// Виджеты
const widgetBtn        = document.getElementById('widgetButton');
const widgetModal      = document.getElementById('widgetModal');
const widgetClose      = widgetModal.querySelector('.close-btn');
const widgetCheckboxes = widgetModal.querySelectorAll('input[type="checkbox"][data-widget]');
const widgetClock      = document.getElementById('widgetClock');
const widgetWeather    = document.getElementById('widgetWeather');
const widgetCalendar   = document.getElementById('widgetCalendar');
const themeToggleBtn   = document.getElementById('themeToggle');

// Контейнер для списка закладок
const bookmarksContainer = document.getElementById('bookmarksList');

// Создаём элемент для текста погоды внутри виджета, если его нет
let weatherContent = widgetWeather.querySelector('span.weather-text');
if (!weatherContent) {
  weatherContent = document.createElement('span');
  weatherContent.className = 'weather-text';
  widgetWeather.appendChild(weatherContent);
}

// Вспомогательная функция: первая буква заглавная
const capitalize = str => str.charAt(0).toUpperCase() + str.slice(1);

// Обновление видимости виджетов в UI в зависимости от чекбоксов
const updateWidgetsDisplay = () => {
  widgetCheckboxes.forEach(({ dataset, checked }) => {
    const el = document.getElementById('widget' + capitalize(dataset.widget));
    if (el) el.style.display = checked ? 'block' : 'none';
  });
};

// Сохраняем настройки виджетов (IPC -> localStorage с гарантиями)
const saveWidgetSettings = async () => {
  const settings = {};
  widgetCheckboxes.forEach(ch => {
    settings[ch.dataset.widget] = ch.checked;
  });

  if (window.tabAPI?.saveWidgetSettings) {
    try {
      await window.tabAPI.saveWidgetSettings(settings);
    } catch (e) {
      console.error('[ERROR] Сохранение виджетов через IPC:', e);
      // fallback в localStorage при ошибке IPC
      try {
        localStorage.setItem('widgetSettings', JSON.stringify(settings));
      } catch (err) {
        console.error('[ERROR] Сохранение виджетов в localStorage:', err);
      }
    }
  } else {
    try {
      localStorage.setItem('widgetSettings', JSON.stringify(settings));
    } catch (err) {
      console.error('[ERROR] Сохранение виджетов в localStorage:', err);
    }
  }
};

// Загружаем настройки виджетов из IPC или localStorage с гарантиями
const loadWidgetsFromIPC = async () => {
  if (!window.tabAPI?.getWidgets) return null;
  try {
    return await window.tabAPI.getWidgets();
  } catch (e) {
    console.warn('[WARN] Не удалось загрузить виджеты из IPC:', e);
    return null;
  }
};

const loadWidgetSettings = async () => {
  let settings = null;

  settings = await loadWidgetsFromIPC();

  if (!settings || !Object.keys(settings).length) {
    if (window.tabAPI?.getWidgetSettings) {
      try {
        settings = await window.tabAPI.getWidgetSettings();
      } catch (e) {
        console.warn('[WARN] Не удалось получить настройки виджетов через IPC:', e);
      }
    }
  }
  
  if (!settings) {
    try {
      const saved = localStorage.getItem('widgetSettings');
      if (saved) {
        settings = JSON.parse(saved);
      }
    } catch (e) {
      console.warn('[WARN] Ошибка парсинга настроек виджетов из localStorage:', e);
    }
  }

  if (settings) {
    widgetCheckboxes.forEach(ch => {
      if (ch.dataset.widget in settings) {
        ch.checked = settings[ch.dataset.widget];
      }
    });
  }
};

// Обработчики открытия/закрытия модального окна виджетов
widgetBtn.addEventListener('click', () => {
  widgetModal.classList.add('active');
  // Синхронизация чекбоксов с текущим отображением виджетов
  widgetCheckboxes.forEach(ch => {
    const el = document.getElementById('widget' + capitalize(ch.dataset.widget));
    ch.checked = el && getComputedStyle(el).display !== 'none';
  });
});

widgetCheckboxes.forEach(ch => {
  ch.addEventListener('change', () => {
    updateWidgetsDisplay();
    saveWidgetSettings();
  });
});

widgetClose.addEventListener('click', () => widgetModal.classList.remove('active'));

widgetModal.addEventListener('click', e => {
  if (e.target === widgetModal) widgetModal.classList.remove('active');
});

// Панель и анимация плиток
panelHandle.addEventListener('click', () => {
  const open = sidePanel.classList.toggle('open');
  sidePanel.setAttribute('aria-hidden', !open);
  panelHandle.classList.toggle('rotating', open);

  tiles.forEach((tile, i) => {
    setTimeout(() => tile.classList.toggle('show', open), i * 80);
  });
});

// Обработка поиска по Enter
searchBox.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const q = encodeURIComponent(searchBox.value.trim());
    if (q) window.location.href = `https://www.google.com/search?q=${q}`;
  }
});

// Загрузка фонового изображения через input
document.getElementById('changeBackground').addEventListener('click', () => fileInput.click());

// --- Новый код загрузки/сохранения фонового изображения с гарантиями ---
async function loadBackground() {
  const video = document.getElementById('backgroundVideo');

  // 1. Попытка загрузки видео
  try {
    const savedVideo = localStorage.getItem('backgroundVideo');
    if (savedVideo) {
      video.src = savedVideo;
      video.style.display = 'block';
      background.style.backgroundImage = 'none';
    } else {
      // 2. Иначе, загрузка картинки
      const savedImage = localStorage.getItem('background');
      if (savedImage) {
        background.style.backgroundImage = `url(${savedImage})`;
        video.src = '';
        video.style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Ошибка загрузки фона:', err);
  }

  updateSearchBoxPlaceholderStyle();
}


fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  if (!f) return;

  const r = new FileReader();
  r.onload = e => {
    const dataUrl = e.target.result;
    const isVideo = f.type.startsWith('video');

    if (isVideo) {
      const video = document.getElementById('backgroundVideo');
      video.src = dataUrl;
      video.style.display = 'block';
      background.style.backgroundImage = 'none'; // отключаем фон-картинку

      localStorage.setItem('backgroundVideo', dataUrl);
      localStorage.removeItem('background'); // очищаем старую картинку

    } else {
      background.style.backgroundImage = `url(${dataUrl})`;
      const video = document.getElementById('backgroundVideo');
      video.src = '';
      video.style.display = 'none';

      localStorage.setItem('background', dataUrl);
      localStorage.removeItem('backgroundVideo');
    }

    fileInput.value = '';
    updateSearchBoxPlaceholderStyle();
  };

  r.readAsDataURL(f);
});


// Переход на страницу закладок
document.getElementById('openBookmarks').addEventListener('click', () => {
  window.location.href = 'bookmarks.html';
});

// Открытие истории (через IPC)
document.getElementById('openHistory').addEventListener('click', () => {
  window.tabAPI?.openHistory();
});

// Часы (обновление каждую секунду)
const updateClock = () => {
  const now = new Date();
  let span = widgetClock.querySelector('span');
  if (!span) {
    span = document.createElement('span');
    widgetClock.appendChild(span);
  }
  span.textContent = now.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};
setInterval(updateClock, 1000);

// Календарь
const updateCalendar = () => {
  const now = new Date();
  let span = widgetCalendar.querySelector('span');
  if (!span) {
    span = document.createElement('span');
    widgetCalendar.appendChild(span);
  }

  const weekday = capitalize(now.toLocaleDateString('ru-RU', { weekday: 'long' }));
  const dateStr = now.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  span.innerHTML = `<strong>${weekday}</strong><br>${dateStr}`;
  span.style.fontSize = '15px';
  span.style.lineHeight = '1.4';
  span.style.textAlign = 'center';
  span.style.whiteSpace = 'pre-line';
};

// Погода — обновление каждые 30 секунд, повтор при ошибке через 2 мин
const WEATHER_UPDATE_INTERVAL = 30 * 1000;
const WEATHER_RETRY_DELAY = 2 * 60 * 1000;
let weatherTimeoutId = null;

async function fetchWeather() {
  weatherContent.textContent = 'Загрузка погоды...';

  try {
    const city = 'Voronezh';
    const response = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    const data = await response.json();

    const current = data.current_condition?.[0];
    if (!current) throw new Error('Нет данных о погоде');

    const temp = current.temp_C + '°C';
    const desc = current.weatherDesc?.[0]?.value || '';

    weatherContent.innerHTML = 
      `<span style="vertical-align:middle;">${city}: ${temp}, ${desc}</span>`
    ;

    clearTimeout(weatherTimeoutId);
    weatherTimeoutId = setTimeout(fetchWeather, WEATHER_UPDATE_INTERVAL);

  } catch (e) {
    console.error('Ошибка погоды:', e);
    weatherContent.textContent = 'Ошибка погоды. Повтор через 2 мин.';
    clearTimeout(weatherTimeoutId);
    weatherTimeoutId = setTimeout(fetchWeather, WEATHER_RETRY_DELAY);
  }
}

// Функции для смены цвета плейсхолдера в поиске по яркости фона
function getBackgroundColorBrightness() {
  const bg = window.getComputedStyle(background).backgroundColor;
  const rgb = bg.match(/\d+/g);
  if (!rgb) return 255;

  const r = +rgb[0], g = +rgb[1], b = +rgb[2];
  return (0.299 * r + 0.587 * g + 0.114 * b);
}

function updateSearchBoxPlaceholderStyle() {
  const brightness = getBackgroundColorBrightness();
  if (brightness < 120) {
    searchBox.style.setProperty('--placeholder-color', 'rgba(255,255,255,0.7)');
  } else {
    searchBox.style.setProperty('--placeholder-color', 'rgba(0,0,0,0.3)');
  }
}

// Создаёт DOM элемент закладки с возможностью редактировать комментарий
function createBookmarkElement(bookmark) {
  const li = document.createElement('li');

  const a = document.createElement('a');
  a.href = bookmark.url;
  a.textContent = bookmark.title || bookmark.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.classList.add('bookmark-item');
  li.appendChild(a);

  if (bookmark.comment && bookmark.comment.trim() !== '') {
    const commentDiv = document.createElement('div');
    commentDiv.classList.add('bookmark-comment-text');
    commentDiv.textContent = bookmark.comment;
    li.appendChild(commentDiv);
  }

  return li;
}

// Сохраняет массив закладок через IPC или localStorage
async function saveBookmarks(bookmarks) {
  if (window.tabAPI?.saveBookmarks) {
    try {
      await window.tabAPI.saveBookmarks(bookmarks);
    } catch (e) {
      console.error('Ошибка сохранения закладок через tabAPI:', e);
      try {
        localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
      } catch (err) {
        console.error('Ошибка сохранения закладок в localStorage:', err);
      }
    }
  } else {
    try {
      localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
    } catch (err) {
      console.error('Ошибка сохранения закладок в localStorage:', err);
    }
  }
}

// Загружает закладки и выводит их в DOM с комментариями
async function loadBookmarks() {
  let bookmarks = [];

  if (window.tabAPI?.getBookmarks) {
    try {
      bookmarks = await window.tabAPI.getBookmarks();
    } catch (e) {
      console.error('Ошибка загрузки закладок через tabAPI:', e);
    }
  } else {
    try {
      const saved = localStorage.getItem('bookmarks');
      if (saved) bookmarks = JSON.parse(saved);
    } catch (e) {
      console.warn('Ошибка парсинга закладок из localStorage:', e);
    }
  }

  bookmarksContainer.innerHTML = '';
  bookmarks.forEach(bm => {
    const el = createBookmarkElement(bm, () => {
      saveBookmarks(bookmarks);
    });
    bookmarksContainer.appendChild(el);
  });
}

// --- Запуск при загрузке страницы ---
window.addEventListener('DOMContentLoaded', async () => {
  await loadBackground();
  await loadWidgetSettings();
  updateWidgetsDisplay();
  updateClock();
  updateCalendar();
  fetchWeather();
  updateSearchBoxPlaceholderStyle();
  await loadBookmarks();
});

// Элементы настроек
const settingsModal = document.getElementById('settingsModal');
const settingsClose = document.getElementById('settingsClose');
const openSettingsBtn = document.getElementById('openSettings');
const blurRange = document.getElementById('blurRange');
const blurValue = document.getElementById('blurValue');
const themeToggle = document.getElementById('themeToggle');

// Функция применить блюр
function applyBlur(value) {
  background.style.setProperty('--background-blur', `${value}px`);
  if (value > 0) {
    background.classList.add('blur');
  } else {
    background.classList.remove('blur');
  }
  blurValue.textContent = `${value}px`;
}

// Функция применить тему
function applyTheme(theme) {
  if (theme === 'light') {
    body.classList.remove('dark');
    body.classList.add('light');
  } else {
    body.classList.remove('light');
    body.classList.add('dark');
  }
}

// Загрузка настроек из localStorage
function loadSettings() {
  try {
    const savedBlur = localStorage.getItem('backgroundBlur');
    const savedTheme = localStorage.getItem('theme');

    const blur = savedBlur !== null ? Number(savedBlur) : 0;
    const theme = savedTheme || 'dark';

    blurRange.value = blur;
    applyBlur(blur);

    themeToggle.value = theme;
    applyTheme(theme);
  } catch (e) {
    console.error('Ошибка загрузки настроек:', e);
  }
}

// Сохранение настроек в localStorage
function saveSettings() {
  try {
    localStorage.setItem('backgroundBlur', blurRange.value);
    localStorage.setItem('theme', themeToggle.value);
  } catch (e) {
    console.error('Ошибка сохранения настроек:', e);
  }
}

// Открыть модальное окно настроек
openSettingsBtn.addEventListener('click', () => {
  loadSettings();
  settingsModal.style.display = 'flex';
});

// Закрыть модальное окно
settingsClose.addEventListener('click', () => {
  settingsModal.style.display = 'none';
});

// Закрыть при клике вне содержимого
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    settingsModal.style.display = 'none';
  }
});

// Обработка изменения блюра
blurRange.addEventListener('input', () => {
  applyBlur(blurRange.value);
  saveSettings();
});

// Обработка переключения темы
themeToggle.addEventListener('change', () => {
  applyTheme(themeToggle.value);
  saveSettings();
});

// При загрузке страницы применить настройки
window.addEventListener('DOMContentLoaded', () => {
  loadSettings();
});

document.getElementById("openVPNModal").addEventListener("click", () => {
  document.getElementById("vpnModal").style.display = "flex";
  const storedProxies = localStorage.getItem("proxyList");
  document.getElementById("proxyList").value = storedProxies || "";
  document.getElementById("vpnToggle").checked = localStorage.getItem("vpnEnabled") === "true";
});

document.getElementById("vpnClose").addEventListener("click", () => {
  document.getElementById("vpnModal").style.display = "none";
});

document.getElementById("saveProxyList").addEventListener("click", () => {
  const list = document.getElementById("proxyList").value.trim();
  localStorage.setItem("proxyList", list);
  alert("Прокси список сохранён.");
});

document.getElementById("vpnToggle").addEventListener("change", (e) => {
  localStorage.setItem("vpnEnabled", e.target.checked);
});

document.getElementById("applyProxy").addEventListener("click", () => {
  console.log("▶ Кнопка применить нажата");

  const vpnEnabled = document.getElementById("vpnToggle").checked;

  if (!vpnEnabled) {
    window.electronAPI.setProxy("none");
    alert("VPN отключён");
    return;
  }

  const proxies = document.getElementById("proxyList").value.trim().split("\n").filter(p => p);
  if (!proxies.length) return alert("Добавьте хотя бы один прокси.");

  const proxy = proxies[Math.floor(Math.random() * proxies.length)];
  console.log("📡 Применяю прокси:", proxy);
  window.electronAPI.setProxy(proxy);
  alert("VPN включён. Прокси: " + proxy);
});


window.electronAPI.setProxy('http=127.0.0.1:8080');

ipcRenderer.on('proxy-set-result', (event, result) => {
  if (result.success) {
    console.log('Прокси успешно установлен');
  } else {
    console.error('Ошибка при установке прокси:', result.error);
  }
});

// Слушаем ответ
window.ipcRenderer.on('proxy-set-success', (_, proxyUsed) => {
  console.log('Прокси успешно установлен:', proxyUsed);
  reloadAllTabs();
});

window.ipcRenderer.on('proxy-set-failure', (_, errorMessage) => {
  console.error('Ошибка установки прокси:', errorMessage);
});
