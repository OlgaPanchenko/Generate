/* =============================================================================
   NEWS DROP · Общий источник данных (Google Таблица)
   -----------------------------------------------------------------------------
   Подключается к любому инструменту экосистемы одной строкой перед основным
   скриптом страницы (тег script с src="data-source.js" и закрывающим тегом).

   Читает четыре листа опубликованной Google Таблицы и отдаёт их приложению:

       Турниры    — карточки: федерация, серийность, стадии, правила, регламент
       Календарь  — даты: когда, какая стадия, какой номер, ссылка на эфир
       Шаблоны    — заготовки текстов постов с подстановками (лист необязателен)

   Данные кэшируются в браузере: страница открывается мгновенно на кэше,
   а свежие данные подтягиваются фоном. Если таблица не задана или недоступна,
   приложение продолжает работать на ручном вводе — это осознанное требование,
   таблица только помогает, но ничего не ломает своим отсутствием.

   Требование к таблице: «Доступ по ссылке → Читатель».
   ============================================================================= */
(function (global) {
    'use strict';

    var LS_URL = 'ndrop_sheet_url';
    var LS_CACHE = 'ndrop_sheet_cache';
    var SHEETS = {
        calendar: 'Календарь',
        tournaments: 'Турниры',
        templates: 'Шаблоны',
        players: 'Игроки'
    };

    // Листы, которых может не быть в файле — инструмент работает и без них.
    var OPTIONAL = { templates: true, players: true };

    var listeners = [];
    var state = { calendar: [], tournaments: [], templates: [], players: [], updatedAt: 0, errors: [] };

    /* --------------------------- хранилище (мягкое) ------------------------ */
    function lsGet(key, fallback) {
        try { var v = localStorage.getItem(key); return v === null ? fallback : v; }
        catch (e) { return fallback; }
    }
    function lsSet(key, value) {
        try { localStorage.setItem(key, value); } catch (e) {}
    }

    /* ------------------------------ разбор CSV ----------------------------- */
    /* Собственный парсер, а не split(',') — в названиях турниров попадаются
       запятые и кавычки, и наивное разбиение ломает таблицу. */
    function parseCsv(text) {
        var rows = [];
        var row = [];
        var field = '';
        var inQuotes = false;

        for (var i = 0; i < text.length; i++) {
            var ch = text[i];

            if (inQuotes) {
                if (ch === '"') {
                    if (text[i + 1] === '"') { field += '"'; i++; }
                    else inQuotes = false;
                } else {
                    field += ch;
                }
                continue;
            }

            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { row.push(field); field = ''; }
            else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
            else if (ch !== '\r') { field += ch; }
        }
        if (field.length || row.length) { row.push(field); rows.push(row); }

        return rows.filter(function (r) {
            return r.some(function (cell) { return String(cell).trim() !== ''; });
        });
    }

    /* Превращает строки CSV в объекты, сопоставляя заголовки по синонимам. */
    function toObjects(rows, aliases) {
        if (!rows.length) return [];
        var header = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });

        var index = {};
        Object.keys(aliases).forEach(function (key) {
            var variants = aliases[key];
            for (var i = 0; i < header.length; i++) {
                for (var j = 0; j < variants.length; j++) {
                    if (header[i] === variants[j] || header[i].indexOf(variants[j]) === 0) {
                        if (index[key] === undefined) index[key] = i;
                    }
                }
            }
        });

        return rows.slice(1).filter(function (cells) {
            // Подписи и заметки под таблицей — одна длинная фраза в первой ячейке.
            // Без этого фильтра такая строка превращается в турнир-призрак.
            var filled = cells.filter(function (c) { return String(c).trim() !== ''; });
            return !(filled.length === 1 && String(filled[0]).trim().length > 60);
        }).map(function (cells) {
            var obj = {};
            Object.keys(aliases).forEach(function (key) {
                var i = index[key];
                obj[key] = i === undefined ? '' : String(cells[i] === undefined ? '' : cells[i]).trim();
            });
            return obj;
        }).filter(function (obj) {
            return Object.keys(obj).some(function (k) { return obj[k]; });
        });
    }

    /* ------------------------------ нормализация --------------------------- */
    function splitTags(value) {
        return String(value || '')
            .split(/[\s,;]+/)
            .map(function (t) { return t.replace(/^#+/, '').trim(); })
            .filter(Boolean);
    }

    /* Принимает 20.09.2026, 20.09.26, 2026-09-20, 20/09/2026 и «20 сентября». */
    var MONTHS = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

    function parseDate(value) {
        var raw = String(value || '').trim();
        if (!raw) return null;

        var m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (m) return makeDate(+m[1], +m[2], +m[3]);

        m = raw.match(/^(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?$/);
        if (m) {
            var year = m[3] ? +m[3] : new Date().getFullYear();
            if (year < 100) year += 2000;
            return makeDate(year, +m[2], +m[1]);
        }

        m = raw.toLowerCase().match(/^(\d{1,2})\s+([а-яё]+)\s*(\d{4})?$/);
        if (m) {
            for (var i = 0; i < MONTHS.length; i++) {
                if (m[2].indexOf(MONTHS[i]) === 0) {
                    return makeDate(m[3] ? +m[3] : new Date().getFullYear(), i + 1, +m[1]);
                }
            }
        }
        return null;
    }

    function makeDate(year, month, day) {
        var date = new Date(year, month - 1, day);
        if (isNaN(date.getTime())) return null;
        return {
            date: date,
            iso: year + '-' + pad(month) + '-' + pad(day),
            display: pad(day) + '.' + pad(month) + '.' + year
        };
    }
    function pad(n) { return (n < 10 ? '0' : '') + n; }

    /* ------------------------------- загрузка ------------------------------ */
    function extractSheetId(url) {
        var m = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        return m ? m[1] : (/^[a-zA-Z0-9-_]{20,}$/.test(String(url || '').trim()) ? String(url).trim() : '');
    }

    function csvUrl(sheetId, sheetName) {
        return 'https://docs.google.com/spreadsheets/d/' + sheetId +
               '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(sheetName);
    }

    function fetchSheet(sheetId, sheetName) {
        return fetch(csvUrl(sheetId, sheetName), { cache: 'no-store' })
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.text();
            })
            .then(function (text) {
                // Закрытая таблица отдаёт HTML-страницу логина вместо CSV.
                if (/^\s*<(!doctype|html)/i.test(text)) {
                    throw new Error('нет доступа: открой «Доступ по ссылке → Читатель»');
                }
                return parseCsv(text);
            });
    }

    var ALIASES = {
        calendar: {
            date: ['дата', 'date'],
            time: ['время', 'time'],
            tournament: ['турнир', 'название', 'name'],
            federation: ['федерация', 'federation'],
            stage: ['стадия', 'stage'],
            number: ['номер', '№', 'number'],
            youtube: ['youtube', 'ютуб', 'ссылка', 'link'],
            place: ['место', 'площадка', 'place'],
            status: ['статус', 'status']
        },
        tournaments: {
            name: ['название', 'турнир', 'name'],
            federation: ['федерация', 'federation'],
            short: ['коротк', 'short'],
            serial: ['серийн', 'serial'],
            stages: ['стади', 'stages'],
            rules: ['правила', 'rules'],
            regulations: ['регламент', 'regulation'],
            tags: ['хэштег', 'хештег', 'теги', 'tags'],
            logo: ['логотип', 'logo']
        },
        templates: {
            name: ['название', 'шаблон', 'name'],
            text: ['текст', 'text'],
            tags: ['хэштег', 'хештег', 'теги', 'tags']
        },
        players: {
            nick: ['ник', 'игрок', 'имя', 'nick', 'name'],
            photo: ['фото', 'файл', 'photo'],
            federation: ['федерация', 'federation'],
            note: ['заметка', 'note']
        }
    };

    /* Единая нормализация: одним и тем же кодом обрабатываются данные из файла
       data.js, из выбранного .xlsx и из Google Таблицы. */
    function ingest(raw, errors) {
        if (raw.calendar) {
            state.calendar = raw.calendar.map(function (row) {
                // Числовая ячейка выгружается как «44.0» — в заголовке поста
                // нужен просто «44».
                row.number = String(row.number || '').replace(/^(\d+)[.,]0+$/, '$1');
                var parsed = parseDate(row.date);
                row.dateIso = parsed ? parsed.iso : '';
                row.dateDisplay = parsed ? parsed.display : row.date;
                row.sortKey = parsed ? parsed.date.getTime() : 0;
                row.tagsList = [];
                return row;
            }).sort(function (a, b) { return a.sortKey - b.sortKey; });
        }

        if (raw.tournaments) {
            state.tournaments = raw.tournaments.map(function (row) {
                row.tagsList = splitTags(row.tags);
                // «Серийный» — да/нет: у серийного турнира есть стадии и номера,
                // у оупена одно событие без стадии.
                row.isSerial = /^(да|yes|true|1|\+|серийн)/i.test(String(row.serial || '').trim());
                row.stagesList = String(row.stages || '')
                    .split(/[,;/|]+/)
                    .map(function (s) { return s.trim().toUpperCase(); })
                    .filter(Boolean);
                return row;
            });
        }

        if (raw.templates) {
            state.templates = raw.templates.map(function (row) {
                row.tagsList = splitTags(row.tags);
                return row;
            });
        }

        if (raw.players) state.players = raw.players;

        // Сшиваем календарь со справочником: федерация, правила, регламент и теги
        // живут в карточке турнира, в календаре их дублировать не нужно.
        state.calendar.forEach(function (row) {
            var card = findTournament(row.tournament);
            row.card = card || null;
            if (card) {
                if (!row.federation) row.federation = card.federation || '';
                row.short = card.short || card.name || row.tournament;
                row.rules = card.rules || '';
                row.regulations = card.regulations || '';
                row.tagsList = card.tagsList || [];
                // Явно указанная в календаре стадия главнее галочки в карточке:
                // иначе незаполненный столбец «Серийный» молча съедал бы стадию.
                row.isSerial = card.isSerial || !!String(row.stage || '').trim();
                row.stagesList = card.stagesList || [];
            } else {
                row.short = row.tournament;
                row.rules = '';
                row.regulations = '';
                row.tagsList = [];
                row.isSerial = !!row.stage;
                row.stagesList = [];
            }
        });

        state.errors = errors || [];
        state.updatedAt = Date.now();
        lsSet(LS_CACHE, JSON.stringify({
            calendar: state.calendar,
            tournaments: state.tournaments,
            templates: state.templates,
            players: state.players,
            updatedAt: state.updatedAt
        }));
        notify();
        return state;
    }

    /* Файл data.js рядом со страницей: подключается обычным тегом script и
       поэтому работает даже при открытии с диска, где fetch запрещён. */
    function loadInline() {
        var data = global.NDROP_DATA;
        if (!data || typeof data !== 'object') return null;
        state.source = 'data.js';
        return ingest({
            calendar: (data.calendar || []).map(copy),
            tournaments: (data.tournaments || []).map(copy),
            templates: (data.templates || []).map(copy),
            players: (data.players || []).map(copy)
        }, []);
    }

    function copy(obj) {
        var out = {};
        Object.keys(obj || {}).forEach(function (k) { out[k] = obj[k]; });
        return out;
    }

    function load(options) {
        options = options || {};
        var sheetId = extractSheetId(getSheetUrl());

        if (!sheetId) {
            state.errors = ['Ссылка на таблицу не задана'];
            notify();
            return Promise.resolve(state);
        }

        var errors = [];
        var jobs = Object.keys(SHEETS).map(function (key) {
            return fetchSheet(sheetId, SHEETS[key])
                .then(function (rows) { return { key: key, rows: toObjects(rows, ALIASES[key]) }; })
                .catch(function (err) {
                    if (!OPTIONAL[key]) errors.push('Лист «' + SHEETS[key] + '»: ' + err.message);
                    return { key: key, rows: null };
                });
        });

        return Promise.all(jobs).then(function (results) {
            var raw = {};
            results.forEach(function (result) {
                if (result.rows) raw[result.key] = result.rows;   // лист не прочитан — оставляем прошлые данные
            });
            state.source = 'sheet';
            return ingest(raw, errors);
        });
    }

    function loadCache() {
        try {
            var cached = JSON.parse(lsGet(LS_CACHE, ''));
            if (cached && typeof cached === 'object') {
                state.calendar = cached.calendar || [];
                state.tournaments = cached.tournaments || [];
                state.templates = cached.templates || [];
                state.players = cached.players || [];
                state.updatedAt = cached.updatedAt || 0;
            }
        } catch (e) {}
        return state;
    }

    /* ------------------------------- подписки ------------------------------ */
    function notify() {
        listeners.forEach(function (cb) {
            try { cb(state); } catch (e) { console.error('[data-source]', e); }
        });
    }

    function getSheetUrl() { return lsGet(LS_URL, ''); }
    function setSheetUrl(url) { lsSet(LS_URL, String(url || '').trim()); }

    /* ----------------------------- вспомогательное ------------------------- */
    /* Ближайшие события: со вчерашнего дня и вперёд, чтобы сегодняшний турнир
       не пропадал из списка посреди дня. */
    function upcoming(limit) {
        var edge = Date.now() - 24 * 60 * 60 * 1000;
        var future = state.calendar.filter(function (row) { return !row.sortKey || row.sortKey >= edge; });
        var list = future.length ? future : state.calendar.slice().reverse();
        return limit ? list.slice(0, limit) : list;
    }

    function findTournament(name) {
        var needle = String(name || '').trim().toLowerCase();
        if (!needle) return null;
        return state.tournaments.filter(function (row) {
            return String(row.name).trim().toLowerCase() === needle ||
                   String(row.short).trim().toLowerCase() === needle;
        })[0] || null;
    }

    /* Подстановки в шаблонах: {турнир}, {номер}, {стадия}, {дата}, {время},
       {youtube}, {место}, {федерация}. Незаполненные плейсхолдеры убираем,
       чтобы в посте не оставалось «{место}». */
    function applyTemplate(text, values) {
        var map = {
            'турнир': values.tournament, 'tournament': values.tournament,
            'номер': values.number, 'number': values.number,
            'стадия': values.stage, 'stage': values.stage,
            'дата': values.date, 'date': values.date,
            'время': values.time, 'time': values.time,
            'youtube': values.youtube, 'ютуб': values.youtube,
            'место': values.place, 'place': values.place,
            'федерация': values.federation, 'federation': values.federation,
            'правила': values.rules, 'rules': values.rules,
            'регламент': values.regulations, 'regulations': values.regulations,
            'короткое': values.short, 'short': values.short
        };
        var lines = String(text || '').split('\n').map(function (line) {
            var hadPlaceholder = /\{[^}]+\}/.test(line);
            var filled = line.replace(/\{([^}]+)\}/g, function (all, key) {
                var value = map[String(key).trim().toLowerCase()];
                return value === undefined || value === null ? '' : String(value);
            });

            if (!hadPlaceholder) return filled;

            var stripped = filled.replace(/\s+/g, ' ').trim();
            // Строка, где подстановка была единственным содержимым, схлопывается:
            // «Регламент:» без ссылки в посте не нужен. Правила и регламент —
            // необязательные поля, и пустыми они не должны оставлять мусор.
            if (!stripped || /^.{0,40}[:\-–—>]$/.test(stripped)) return null;

            // Висящая запятая от пустого {место} в конце строки.
            return filled.replace(/[,;]\s*$/, '');
        }).filter(function (line) { return line !== null; });

        return lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    /* Разбор .xlsx прямо в браузере: файл выбирается вручную и никуда не
       отправляется. Работает при открытии страницы с диска, где сеть закрыта. */
    function loadWorkbook(file) {
        return new Promise(function (resolve, reject) {
            if (!global.XLSX) {
                reject(new Error('Библиотека чтения Excel не загрузилась — нужен интернет при первом открытии страницы.'));
                return;
            }
            var reader = new FileReader();
            reader.onload = function (e) {
                try {
                    var wb = global.XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                    var raw = {};
                    var missing = [];

                    Object.keys(SHEETS).forEach(function (key) {
                        var sheet = wb.Sheets[SHEETS[key]];
                        // Обязательны только «Турниры» и «Календарь»; остальные листы
                        // можно не заводить вовсе — их отсутствие не ошибка.
                        if (!sheet) {
                            if (!OPTIONAL[key]) missing.push(SHEETS[key]);
                            return;
                        }
                        var rows = global.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
                        rows = rows.filter(function (r) {
                            return r.some(function (cell) { return String(cell).trim() !== ''; });
                        });
                        raw[key] = toObjects(rows, ALIASES[key]);
                    });

                    state.source = 'excel';
                    var result = ingest(raw, missing.length ? ['В файле нет листов: ' + missing.join(', ')] : []);
                    resolve(result);
                } catch (err) {
                    reject(new Error('Не удалось прочитать файл: ' + err.message));
                }
            };
            reader.onerror = function () { reject(new Error('Не удалось открыть файл.')); };
            reader.readAsArrayBuffer(file);
        });
    }

    /* Готовый data.js: подключается к сайту тегом script и раздаёт данные
       на все устройства без таблиц, сервера и базы. */
    function toDataJs() {
        function clean(rows, keys) {
            return (rows || []).map(function (row) {
                var out = {};
                keys.forEach(function (k) { if (row[k]) out[k] = row[k]; });
                return out;
            });
        }

        var payload = {
            updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
            tournaments: clean(state.tournaments, ['name', 'federation', 'short', 'serial', 'stages', 'rules', 'regulations', 'tags', 'logo']),
            calendar: clean(state.calendar, ['date', 'time', 'tournament', 'federation', 'stage', 'number', 'youtube', 'place', 'status']),
            templates: clean(state.templates, ['name', 'text', 'tags']),
            players: clean(state.players, ['nick', 'photo', 'federation', 'note'])
        };

        return '/* NEWS DROP · данные сайта. Сгенерировано ' + payload.updatedAt + '.\n' +
               '   Положи этот файл рядом со страницами и подключи тегом script перед data-source.js.\n' +
               '   Работает и с диска, и на сайте, на всех устройствах. */\n' +
               'window.NDROP_DATA = ' + JSON.stringify(payload, null, 2) + ';\n';
    }

    global.NDropData = {
        SHEETS: SHEETS,
        state: state,
        load: load,
        loadInline: loadInline,
        loadWorkbook: loadWorkbook,
        toDataJs: toDataJs,
        loadCache: loadCache,
        getSheetUrl: getSheetUrl,
        setSheetUrl: setSheetUrl,
        extractSheetId: extractSheetId,
        upcoming: upcoming,
        findTournament: findTournament,
        applyTemplate: applyTemplate,
        splitTags: splitTags,
        parseCsv: parseCsv,
        parseDate: parseDate,
        onUpdate: function (cb) { listeners.push(cb); }
    };
})(window);
