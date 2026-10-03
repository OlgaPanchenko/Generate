/* =============================================================================
   NEWS DROP · Мост «Генератор → Публикатор»
   -----------------------------------------------------------------------------
   Подключается к 1.html / 2.html / 3.html одной строкой перед </body>:

       <script src="publisher-bridge.js"></script>

   Сам находит кнопку «Скачать PNG» и ставит рядом кнопку «В публикатор»:
   рендерит текущий макет, кладёт PNG в браузерное хранилище и открывает TG.html,
   который подхватывает картинку автоматически.

   Важно: генератор и публикатор должны лежать на ОДНОМ домене — хранилище
   браузера не шарится между разными сайтами.
   ============================================================================= */
(function () {
    'use strict';

    var PUBLISHER_URL = 'TG.html';      // поменяй, если файл называется иначе
    var DB_NAME = 'ndrop-handoff';
    var STORE = 'files';
    var KEY = 'image';
    var LS_KEY = 'ndrop_handoff_image';
    var LS_TIME = 'ndrop_handoff_time';
    var LS_META = 'ndrop_handoff_meta';

    /* ----------------------------- уведомления ----------------------------- */
    function notify(message, type) {
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type || 'info');
        } else {
            console.log('[publisher-bridge]', message);
        }
    }

    /* ------------------------------ IndexedDB ------------------------------ */
    function openDb() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function idbPut(value) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(value, KEY);
                tx.oncomplete = function () { db.close(); resolve(true); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    /* --------------------------- сохранение PNG ---------------------------- */
    function saveHandoff(blob) {
        var meta = collectMeta();
        // Мета кладётся и в localStorage тоже: она крошечная, и так публикатор
        // получит данные макета, даже если IndexedDB окажется недоступна.
        try { localStorage.setItem(LS_META, JSON.stringify(meta)); } catch (e) {}

        // Основной путь — IndexedDB: хранит Blob как есть, без раздувания в base64
        // и без лимита в 5 МБ, в который упирается localStorage.
        return idbPut({ blob: blob, time: Date.now(), name: 'generator.png', meta: meta })
            .catch(function () {
                // Запасной путь — localStorage через dataURL.
                return new Promise(function (resolve, reject) {
                    var reader = new FileReader();
                    reader.onload = function () {
                        try {
                            localStorage.setItem(LS_KEY, reader.result);
                            localStorage.setItem(LS_TIME, String(Date.now()));
                            resolve(true);
                        } catch (e) {
                            reject(new Error('Картинка не поместилась в хранилище браузера. Сохрани её кнопкой «Скачать PNG» и добавь в публикаторе вручную.'));
                        }
                    };
                    reader.onerror = function () { reject(new Error('Не удалось прочитать картинку.')); };
                    reader.readAsDataURL(blob);
                });
            });
    }

    /* --------------------- данные макета вместе с картинкой ---------------- */
    /* Генератор уже знает турнир, федерацию и победителя — передаём это рядом с
       PNG, чтобы в публикаторе не вводить то же самое руками. Читаем из DOM:
       переменные генератора объявлены через let и на window не попадают. */
    function collectMeta() {
        function val(id) {
            var el = document.getElementById(id);
            return el ? String(el.value || '').trim() : '';
        }
        function text(id) {
            var el = document.getElementById(id);
            return el ? String(el.innerText || el.textContent || '').trim() : '';
        }

        var FEDERATIONS = {
            'theme-red-msl': 'МСЛ',
            'theme-blue-mmt': 'ММТ',
            'theme-green-bmf': 'БМФ'
        };

        return {
            tournament: val('tournament-select') || val('config-subtitle'),
            title: val('config-title'),
            federation: FEDERATIONS[val('config-theme')] || '',
            footerRight: val('footer-right-text'),
            winner: text('winner-display-nick'),
            format: val('config-format') || 'vertical',
            time: Date.now()
        };
    }

    /* ------------------------------- отправка ------------------------------ */
    function renderCanvas() {
        // renderCleanCanvas объявлена в самом генераторе: она гасит анимации,
        // чинит CORS-картинки и отдаёт готовый canvas — переиспользуем её,
        // чтобы публикатор получил ровно то же, что даёт «Скачать PNG».
        if (typeof window.renderCleanCanvas !== 'function') {
            return Promise.reject(new Error('Не найдена функция экспорта генератора (renderCleanCanvas).'));
        }
        return window.renderCleanCanvas(1);
    }

    function canvasToBlob(canvas) {
        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (blob) {
                if (blob) resolve(blob);
                else reject(new Error('Не удалось получить PNG из макета.'));
            }, 'image/png');
        });
    }

    function openPublisher() {
        var win = window.open(PUBLISHER_URL, '_blank');
        // Всплывающее окно после await часто режется блокировщиком —
        // тогда просто переходим в текущей вкладке.
        if (!win || win.closed || typeof win.closed === 'undefined') {
            window.location.href = PUBLISHER_URL;
        }
    }

    function sendToPublisher(button) {
        var label = button.querySelector('.bridge-label');
        var icon = button.querySelector('.bridge-icon');
        button.disabled = true;
        if (label) label.textContent = 'Готовлю…';
        if (icon) icon.textContent = 'hourglass_top';

        renderCanvas()
            .then(canvasToBlob)
            .then(saveHandoff)
            .then(function () {
                notify('Картинка передана в публикатор.', 'success');
                openPublisher();
            })
            .catch(function (err) {
                notify('Не получилось передать: ' + err.message, 'error');
            })
            .then(function () {
                button.disabled = false;
                if (label) label.textContent = 'В публикатор';
                if (icon) icon.textContent = 'send';
            });
    }

    /* ---------------------------- вставка кнопки --------------------------- */
    function injectButton() {
        if (document.getElementById('btn-to-publisher')) return;

        var button = document.createElement('button');
        button.id = 'btn-to-publisher';
        button.type = 'button';
        button.className = 'bg-gradient-to-r from-sky-500 to-indigo-500 hover:opacity-95 text-white font-black text-xs sm:text-sm px-4 py-3 rounded-xl shadow-lg transition flex items-center justify-center gap-2 uppercase tracking-wide';
        button.innerHTML = '<span class="material-icons text-base bridge-icon">send</span><span class="bridge-label">В публикатор</span>';
        button.addEventListener('click', function () { sendToPublisher(button); });

        var anchor = document.querySelector('button[onclick*="captureImageAndDownload"]');
        if (anchor && anchor.parentNode) {
            anchor.parentNode.insertBefore(button, anchor.nextSibling);
            return;
        }

        // Панели экспорта не нашлось — вешаем плавающую кнопку, чтобы функция не пропала.
        button.style.position = 'fixed';
        button.style.right = '20px';
        button.style.bottom = '20px';
        button.style.zIndex = '9999';
        document.body.appendChild(button);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectButton);
    } else {
        injectButton();
    }
})();
