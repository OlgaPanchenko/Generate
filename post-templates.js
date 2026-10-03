/* =============================================================================
   NEWS DROP · Шаблоны постов, справочник и чтение календаря
   -----------------------------------------------------------------------------
   Три уровня данных, каждый заполняется на своём месте:

     федерация — правила и постоянные ссылки на площадки (справочник, один раз)
     турнир    — регламент и таблица/рейтинг (справочник, один раз на турнир)
     событие   — дата и турнир берутся из календаря 3.html; время, стадия,
                 номер, судьи и ссылка на эфир вводятся перед постом

   Список турниров и расписание НЕ дублируются: они читаются прямо из
   хранилища календаря (3.html), поэтому переименование или перенос там
   сразу виден здесь.
   ============================================================================= */
(function (global) {
    'use strict';

    /* ------------------------- ключи календаря 3.html ---------------------- */
    var CAL_TOURNAMENTS = 'tourncal_tournaments_v1';
    var CAL_SCHEDULE = 'tourncal_schedule_v1_';
    var CAL_TIMES = 'tourncal_times_v1_';        // время эфиров по датам
    var CAL_SERIES = 'tourncal_series_v1_';      // номер серии по датам

    /* ------------------------- ключи своего справочника -------------------- */
    var REF_TOURNAMENTS = 'ndrop_ref_tournaments';   // { [id турнира]: {reglament, table, rating} }
    var REF_FEDERATIONS = 'ndrop_ref_federations';   // { msl: {rules, rutube, vk, twitch}, ... }

    var FEDERATIONS = [
        { code: 'msl', name: 'МСЛ' },
        { code: 'mmt', name: 'ММТ' },
        { code: 'bmf', name: 'БМФ' }
    ];

    /* ------------------------------ хранилище ------------------------------ */
    function read(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) { return fallback; }
    }
    function write(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); return true; }
        catch (e) { return false; }
    }

    /* ---------------------------- чтение календаря ------------------------- */
    /* Источник данных: сначала своё хранилище браузера (там свежие правки
       календаря), при его отсутствии — файл calendar-data.js рядом со
       страницей. Так на телефоне и на сайте данные берутся из файла, а на
       рабочем ноуте — из календаря, где ты их только что меняла. */
    function fileData() {
        var d = global.NDROP_CALENDAR;
        return (d && typeof d === 'object') ? d : null;
    }

    function getTournaments() {
        var list = read(CAL_TOURNAMENTS, null);
        if (Array.isArray(list) && list.length) return list;
        var file = fileData();
        return (file && Array.isArray(file.tournaments)) ? file.tournaments : [];
    }

    function usingFile() {
        var list = read(CAL_TOURNAMENTS, null);
        return !(Array.isArray(list) && list.length) && !!fileData();
    }

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    /* Ближайшие события: идём по дням вперёд и назад от сегодня и собираем
       турниры, назначенные в календаре на эти даты. */
    function getEvents(daysAhead, daysBack) {
        daysAhead = daysAhead === undefined ? 90 : daysAhead;
        daysBack = daysBack === undefined ? 7 : daysBack;

        var tournaments = getTournaments();
        var byId = {};
        tournaments.forEach(function (t) { byId[t.id] = t; });

        var months = {};   // кэш расписаний по ключу года_месяца
        function schedule(year, month) {
            var key = CAL_SCHEDULE + year + '_' + month;
            if (!(key in months)) months[key] = read(key, {}) || {};
            return months[key];
        }

        // Время эфиров лежит отдельным ключом на каждую дату
        function times(iso) {
            return read(CAL_TIMES + iso, {}) || {};
        }
        // Номер серии — тоже по датам: 44-я, 45-я и так далее
        function seriesNumbers(iso) {
            return read(CAL_SERIES + iso, {}) || {};
        }

        var fromFile = usingFile();
        var file = fileData() || {};

        var events = [];
        var today = new Date();
        today.setHours(0, 0, 0, 0);

        for (var offset = -daysBack; offset <= daysAhead; offset++) {
            var d = new Date(today.getTime() + offset * 86400000);
            var iso = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
            var dayTimes, ids;

            var daySeries;
            if (fromFile) {
                var day = (file.days || {})[iso];
                ids = day ? (day.tournaments || []) : [];
                dayTimes = day ? (day.times || {}) : {};
                daySeries = day ? (day.series || {}) : {};
            } else {
                dayTimes = times(iso);
                daySeries = seriesNumbers(iso);
                ids = schedule(d.getFullYear(), d.getMonth())[d.getDate()] || [];
            }
            ids.forEach(function (id) {
                var t = byId[id];
                if (!t) return;
                events.push({
                    tournamentId: id,
                    tournament: t.name,
                    fed: t.fed,
                    // Номер серии живёт при турнире в календаре: подставляется
                    // в заголовок поста, чтобы не вбивать его каждый раз
                    isSerial: !!t.isSerial,
                    seriesNumber: daySeries[id] || '',
                    federation: fedName(t.fed),
                    date: d,
                    dateIso: iso,
                    dateDisplay: pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear(),
                    time: dayTimes[id] || '',
                    isPast: offset < 0
                });
            });
        }
        return events;
    }

    function fedName(code) {
        var f = FEDERATIONS.filter(function (x) { return x.code === code; })[0];
        return f ? f.name : (code || '').toUpperCase();
    }

    /* ------------------------------ справочник ----------------------------- */
    /* Справочник заполняется в календаре 3.html. На рабочем ноуте он лежит в
       браузере, на телефоне и на сайте приезжает файлом calendar-data.js. */
    function refStore(lsKey, fileKey) {
        var local = read(lsKey, null);
        if (local && typeof local === 'object' && Object.keys(local).length) return local;
        var file = fileData();
        var fromFile = file && file[fileKey];
        return (fromFile && typeof fromFile === 'object') ? fromFile : (local || {});
    }

    function getTournamentRef(id) {
        var all = refStore(REF_TOURNAMENTS, 'refTournaments');
        var ref = all[id] || {};
        return { reglament: ref.reglament || '', table: ref.table || '', rating: ref.rating || '' };
    }
    function setTournamentRef(id, data) {
        var all = read(REF_TOURNAMENTS, {}) || {};
        all[id] = {
            reglament: (data.reglament || '').trim(),
            table: (data.table || '').trim(),
            rating: (data.rating || '').trim()
        };
        return write(REF_TOURNAMENTS, all);
    }
    function getFederationRef(code) {
        var all = refStore(REF_FEDERATIONS, 'refFederations');
        var ref = all[code] || {};
        return {
            rules: ref.rules || '',
            rating: ref.rating || '',      // общий рейтинг федерации
            youtube: ref.youtube || '',    // канал — запасной вариант, если нет ссылки на эфир
            rutube: ref.rutube || '',
            vk: ref.vk || '',
            twitch: ref.twitch || ''
        };
    }
    function setFederationRef(code, data) {
        var all = read(REF_FEDERATIONS, {}) || {};
        all[code] = {
            rules: (data.rules || '').trim(),
            rating: (data.rating || '').trim(),
            youtube: (data.youtube || '').trim(),
            rutube: (data.rutube || '').trim(),
            vk: (data.vk || '').trim(),
            twitch: (data.twitch || '').trim()
        };
        return write(REF_FEDERATIONS, all);
    }

    /* ------------------------------ сборка текста -------------------------- */
    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function link(url, label) {
        return url ? '<a href="' + esc(url) + '">' + esc(label) + '</a>' : '';
    }

    /* BR — намеренный отступ между блоками поста. Обычные пустые строки (не
       заполненное поле, отсутствующая ссылка) выбрасываются, иначе в посте
       остаются дыры; BR же переживает фильтр. Подряд идущие отступы
       схлопываются в один, по краям отступов не остаётся. */
    var BR = '\u2063';

    function lines(list) {
        var kept = [];
        list.forEach(function (l) {
            if (l === null || l === undefined) return;
            var str = String(l);
            if (str === BR) { kept.push(''); return; }
            if (str.trim() === '') return;
            kept.push(str);
        });
        while (kept.length && kept[0] === '') kept.shift();
        while (kept.length && kept[kept.length - 1] === '') kept.pop();

        var out = [];
        kept.forEach(function (str) {
            if (str === '' && out[out.length - 1] === '') return;
            out.push(str);
        });
        return out.join('\n');
    }

    function headline(ctx, tail) {
        var parts = [ctx.tournament];
        if (ctx.stage) parts.push(ctx.stage);
        if (tail) parts.push(tail);
        return '<b>' + esc(parts.filter(Boolean).join(' | ')) + '</b>';
    }

    var TEMPLATES = [
        {
            id: 'live',
            name: 'Прямой эфир',
            hint: 'Анонс трансляции: судьи, комментатор, площадки',
            fields: [
                { key: 'stage', label: 'Стадия', type: 'stage', placeholder: '1/8 | ПОДГРУППА' },
                { key: 'games', label: 'Игр', placeholder: '6' },
                { key: 'judges', label: 'Судьи', placeholder: 'Mary Poppins, Флэш' },
                { key: 'commentator', label: 'Комментатор', placeholder: 'Грибочки' },
                { key: 'youtube', label: 'Ссылка YouTube', placeholder: 'https://youtu.be/…' }
            ],
            build: function (ctx) {
                var docs = [link(ctx.reglament, 'Регламент'), link(ctx.rules, 'Правила')]
                    .filter(Boolean).join(' | ');

                return lines([
                    headline(ctx),
                    BR,
                    ctx.games ? esc(ctx.federation) + ' | ' + esc(ctx.games) + ' игр'
                              : (ctx.federation ? esc(ctx.federation) : ''),
                    ctx.judges ? 'Судьи: ' + esc(ctx.judges) : '',
                    ctx.commentator ? 'Комментатор: ' + esc(ctx.commentator) : '',
                    docs,
                    BR,
                    link(ctx.youtube || ctx.fedYoutube, 'YOUTUBE'),
                    link(ctx.rutube, 'RUTUBE'),
                    link(ctx.vk, 'VK ВИДЕО LIVE'),
                    link(ctx.twitch, 'TWITCH'),
                    BR,
                    '#трансляции'
                ]);
            }
        },
        {
            id: 'results',
            name: 'Итоги',
            hint: 'Название, ссылка на таблицу и рейтинг',
            fields: [
                { key: 'stage', label: 'Стадия (необязательно)', type: 'stage', placeholder: 'ФИНАЛ' }
            ],
            build: function (ctx) {
                var docs = [link(ctx.table, 'ТАБЛИЦА'), link(ctx.rating, 'Рейтинг')]
                    .filter(Boolean).join(' | ');

                return lines([
                    headline(ctx, 'ИТОГИ'),
                    BR,
                    docs,
                    BR,
                    '#результаты'
                ]);
            }
        }
    ];

    function getTemplate(id) {
        return TEMPLATES.filter(function (t) { return t.id === id; })[0] || null;
    }

    /* Собирает контекст: справочник федерации и турнира + введённые поля. */
    function buildContext(event, values) {
        var ctx = {};
        Object.keys(values || {}).forEach(function (k) { ctx[k] = values[k]; });

        if (event) {
            ctx.tournament = ctx.tournament || event.tournament;
            ctx.federation = ctx.federation || event.federation;
            ctx.date = ctx.date || event.dateDisplay;
            ctx.time = ctx.time || event.time;

            var tref = getTournamentRef(event.tournamentId);
            ctx.reglament = ctx.reglament || tref.reglament;
            ctx.table = ctx.table || tref.table;
            ctx.rating = ctx.rating || tref.rating;

            var fref = getFederationRef(event.fed);
            ctx.rules = ctx.rules || fref.rules;
            ctx.rutube = ctx.rutube || fref.rutube;
            ctx.vk = ctx.vk || fref.vk;
            ctx.twitch = ctx.twitch || fref.twitch;
            ctx.fedYoutube = fref.youtube;
            // Рейтинг федерации в посты НЕ подставляется: поле заведено на будущее.
            // В пост идёт только рейтинг конкретного турнира.
        }
        return ctx;
    }

    function buildPost(templateId, event, values) {
        var tpl = getTemplate(templateId);
        if (!tpl) return '';
        return tpl.build(buildContext(event, values));
    }

    global.NDropPosts = {
        FEDERATIONS: FEDERATIONS,
        TEMPLATES: TEMPLATES,
        getTemplate: getTemplate,
        getTournaments: getTournaments,
        getEvents: getEvents,
        fedName: fedName,
        usingFile: usingFile,
        getTournamentRef: getTournamentRef,
        setTournamentRef: setTournamentRef,
        getFederationRef: getFederationRef,
        setFederationRef: setFederationRef,
        buildContext: buildContext,
        buildPost: buildPost
    };
})(window);
