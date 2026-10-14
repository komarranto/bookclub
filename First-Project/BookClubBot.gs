// ==================== НАСТРОЙКИ ====================
//
// Бот книжного клуба. Ведёт клуб по чёткому циклу с фиксированными датами:
//
//   /start_cycle
//     1. 📥 Заявки        — каждый предлагает до 2 книг (CYCLE_SUBMIT_DAYS дней)
//     2. 🗳 Голосование    — опрос из всех заявок (CYCLE_VOTE_DAYS дней)
//     3. 📅 Дата встречи   — опросы суббота/воскресенье (CYCLE_DATE_VOTE_DAYS дней)
//     4. 📖 Чтение         — вопросы к встрече копятся в таблице, на полпути —
//                            чекпоинт, за сутки — список вопросов, за 2 часа —
//                            регламент встречи
//     5. ⭐ Оценка         — после встречи опрос «Как вам книга?» (1–5)
//     6. 📊 История        — книга, оценка и прочее — в лист «История клуба»
//
// Переходы между этапами делает функция tick() — её раз в час вызывает
// триггер, который ставит setupBot(). Все сроки — в DEADLINE_HOUR по
// часовому поясу проекта Apps Script.
//
// ⚠️ Токен бота, chat_id, секрет вебхука и URL веб-приложения живут в
// ОТДЕЛЬНОМ файле Config.gs (в этом же проекте Apps Script) — см.
// Config.example.gs. Так обновление этого файла никогда не затирает
// ваши реальные значения: при апдейте бота заменяется только Bot.gs,
// а Config.gs остаётся нетронутым.
//
// Ожидаемые константы в Config.gs:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET, WEB_APP_URL

// Версия кода — чтобы командой /bot_version в Telegram проверять,
// какая версия реально задеплоена (а не гадать, доехала ли вставка).
const BOT_VERSION = '2026.10.15-1';

// ---------- Расписание цикла (всё правится под клуб) ----------
const CYCLE_SUBMIT_DAYS = 7;          // приём заявок
const CYCLE_VOTE_DAYS = 3;            // голосование за книгу
const CYCLE_DATE_VOTE_DAYS = 2;       // голосование за дату встречи
const CYCLE_READING_WEEKS = 5;        // встреча — в выходные примерно через столько недель после выбора книги
const CYCLE_RATING_DAYS = 3;          // сколько открыт опрос «Как вам книга?»
const DEADLINE_HOUR = 19;             // все сроки — в 19:00
const BOOKS_PER_MEMBER = 2;           // сколько книг может предложить один человек
const MEETING_DURATION_HOURS = 2;     // через сколько после начала встречи прислать опрос-оценку
const QUESTIONS_REMINDER_HOURS = 24;  // за сколько до встречи прислать список вопросов
const AGENDA_REMINDER_HOURS = 2;      // за сколько до встречи прислать регламент

// Время встречи: опросы на субботу и воскресенье, по 12 слотов.
// Время — в MEETING_TIMEZONE_LABEL, это пишется в вопросе опроса.
const MEETING_TIME_SLOTS = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
                            '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
const MEETING_TIMEZONE_LABEL = 'UTC+0';
const DEFAULT_MEETING_SLOT = '12:00'; // если за время никто не проголосовал — суббота, 12:00

// Регламент встречи — присылается за AGENDA_REMINDER_HOURS часа до начала
const MEETING_AGENDA = [
  '5 мин — разогрев: каждый одним словом о книге',
  '15 мин — круг первых впечатлений, по 2 минуты на человека',
  '60 мин — обсуждение вопросов из списка (ведёт ведущий)',
  '15 мин — любимые цитаты и моменты',
  '10 мин — итоги; после встречи в чат придёт опрос «Как вам книга?»',
  '5 мин — что дальше: следующий цикл стартует командой /start_cycle'
];

// Какие опросы публичные (видно, кто как проголосовал), а какие анонимные
const BOOK_VOTE_ANONYMOUS = false;   // голосование за книгу — публичное
const RATING_ANONYMOUS = true;       // оценка книги — анонимная, чтобы оценки были честными
const CHECKPOINT_ANONYMOUS = true;   // «как продвигается чтение» — анонимно, без стыда за «ещё не начал»

// Опрос-оценка книги после встречи (порядок важен: первый вариант = 5)
const RATING_OPTIONS = ['5 — в восторге', '4 — понравилась', '3 — нормально', '2 — не зашла', '1 — совсем не моё'];

// Чекпоинт на полпути чтения
const CHECKPOINT_OPTIONS = ['Уже дочитал(а) 🎉', 'Больше половины', 'Меньше половины', 'Ещё не начал(а)'];

// Текстовые варианты «встреча прошла» (без слэша). Работают, только если у
// бота выключен Privacy Mode в @BotFather.
const MEETING_DONE_TEXT_TRIGGERS = ['встреча закончена', 'встреча прошла', 'встреча завершена'];

const USER_TEXT_MAX_LENGTH = 500;
const POLL_MAX_OPTIONS = 12; // лимит вариантов в Telegram Poll
const BOOK_TITLE_MAX_LENGTH = 100; // = лимит длины варианта в опросе
// Всего заявок за цикл: состояние цикла хранится в Script Properties
// (лимит 9 КБ на значение), 30 названий по 100 символов туда помещаются
const MAX_SUBMISSIONS_PER_CYCLE = 30;
const DATE_MOVES_PER_CYCLE = 2;   // сколько раз за цикл можно сдвинуть выбор даты (/another_time)
const POLL_STOP_RETRIES = 6;      // сколько раз (по часу) пробовать закрыть опрос при сбое Telegram

// Листы с данными в таблице, к которой привязан скрипт.
// Видимые — «Вопросы к встрече» и «История клуба», их удобно открыть самому.
const DATA_SHEETS = {
  CYCLE_BOOKS: { name: 'Заявки', hidden: true, headers: ['Цикл', 'Дата', 'Автор', 'ID автора', 'Книга'] },
  QUESTIONS: { name: 'Вопросы к встрече', hidden: false, headers: ['Цикл', 'Книга', 'Дата', 'Автор', 'Вопрос'] },
  HISTORY: { name: 'История клуба', hidden: false,
    headers: ['Цикл', 'Книга', 'Предложил(а)', 'Голосов', 'Встреча', 'Средняя оценка', 'Оценок', 'Вопросов', 'Ведущий'] }
};

// Команды прошлых версий, которые больше не работают — бот вежливо отвечает
const RETIRED_COMMANDS = ['iam', 'quote', 'duel', 'anon', 'anon_all', 'my_target', 'book_vote'];

// Ключи Script Properties прошлых версий — setupBot() их удаляет
const OBSOLETE_PROPERTIES = ['telegramMembers', 'duels', 'duelWins', 'secretPartners', 'anonStats',
  'anonDailyCounts', 'ceremonyDoneFor', 'firstFinishAnnounced', 'gameAnnouncementSent',
  'lastMeetingCommandAt', 'lastProposedMeetingDate'];

// Функции старых триггеров (ежедневный отчёт) — setupBot() их удаляет
const OBSOLETE_TRIGGER_HANDLERS = ['sendWeeklyReport', 'createNextSprint'];

// Анонс в чат отправляется один раз на каждое значение этой строки
const ANNOUNCEMENT_ID = 'cycles-2';

const RU_WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const RU_WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const RU_MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                            'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// ==================== TELEGRAM ====================

/** Универсальный вызов Bot API для служебных методов */
function callTelegram(method, payload) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const result = JSON.parse(response.getContentText());
    if (!result.ok) {
      Logger.log(`❌ Ошибка Telegram (${method}): ${result.description}`);
    }
    return result;
  } catch (error) {
    Logger.log(`❌ Ошибка (${method}): ${error}`);
    return { ok: false };
  }
}

/**
 * Отправить сообщение в Telegram — простым текстом (в /командах
 * подчёркивания, Markdown их ломает).
 * extra.chatId — написать не в чат клуба, а в личку участнику;
 * extra.replyTo — ответом на сообщение; extra.replyMarkup — клавиатура/force_reply.
 */
function sendTelegramMessage(message, extra = {}) {
  const payload = { chat_id: extra.chatId || TELEGRAM_CHAT_ID, text: message };
  if (extra.replyTo) {
    payload.reply_parameters = { message_id: extra.replyTo, allow_sending_without_reply: true };
  }
  if (extra.replyMarkup) payload.reply_markup = extra.replyMarkup;
  return callTelegram('sendMessage', payload);
}

function messageIdOf(result) {
  return result && result.ok && result.result && result.result.message_id ? result.result.message_id : null;
}

/** Короткое сообщение в чат клуба */
function sendChatText(text) {
  return sendTelegramMessage(text);
}

/** Сообщение в личку участнику */
function sendPrivateText(chatId, text) {
  return sendTelegramMessage(text, { chatId: chatId });
}

/**
 * Опрос в чат клуба. Возвращает message_id опроса или null.
 * extra.multiple — можно выбрать несколько вариантов;
 * extra.anonymous — анонимный (для честных оценок).
 */
function sendPoll(question, options, extra = {}) {
  const result = callTelegram('sendPoll', {
    chat_id: TELEGRAM_CHAT_ID,
    question: truncateText(question, 300),
    options: options.map(o => truncateText(o, 100)),
    is_anonymous: extra.anonymous === true,
    allows_multiple_answers: extra.multiple === true
  });
  return result && result.ok && result.result && result.result.message_id ? result.result.message_id : null;
}

/**
 * Закрыть опрос и получить итоги: массив голосов по вариантам (в том же
 * порядке). Опроса нет (не отправился, удалён) — нули. Временный сбой
 * Telegram (сеть, 5xx, 429) — null: этап подождёт и попробует в следующий
 * час, а не объявит «0 голосов».
 */
function stopPollCounts(messageId, optionsCount) {
  const zeros = new Array(optionsCount).fill(0);
  if (!messageId) return zeros;
  const result = callTelegram('stopPoll', { chat_id: TELEGRAM_CHAT_ID, message_id: messageId });
  if (!result || !result.ok) {
    const permanent = /not found|already been closed|can't be stopped|message to stop/i.test(String(result && result.description));
    return permanent ? zeros : null;
  }
  const poll = result.result;
  if (!poll || !Array.isArray(poll.options)) return zeros;
  return zeros.map((z, i) => (poll.options[i] ? Number(poll.options[i].voter_count) || 0 : 0));
}

/**
 * Итоги опроса цикла с сохранением: результат запоминается в самом опросе
 * (holder.counts) и цикл сразу сохраняется — если дальше что-то упадёт,
 * голоса не потеряются. null — Telegram пока не ответил, ждём следующего часа.
 */
function collectPollCounts(cycle, holder, messageId, optionsCount) {
  if (holder.counts) return holder.counts;
  let counts = stopPollCounts(messageId, optionsCount);
  if (counts === null) {
    holder.stopFailures = (holder.stopFailures || 0) + 1;
    if (holder.stopFailures < POLL_STOP_RETRIES) {
      Logger.log(`⚠️ Не удалось закрыть опрос ${messageId} — попробую через час`);
      return null;
    }
    Logger.log(`❌ Опрос ${messageId} так и не закрылся — считаю без его голосов`);
    counts = new Array(optionsCount).fill(0);
  }
  holder.counts = counts;
  saveCycle(cycle);
  return counts;
}

/** Опрос в чат; не отправился — предупреждение в чат (обычно боту запрещены опросы) */
function sendPollOrWarn(question, options, extra) {
  const messageId = sendPoll(question, options, extra);
  if (!messageId) {
    sendChatText('⚠️ Не получилось отправить опрос. Проверьте, что боту разрешено отправлять опросы в группе — бот попробует ещё раз через час и, если нужно, продлит срок.');
  }
  return messageId;
}

function getChatMemberStatus(userId) {
  if (userId === undefined || userId === null) return '';
  const result = callTelegram('getChatMember', { chat_id: TELEGRAM_CHAT_ID, user_id: userId });
  return result && result.ok && result.result ? result.result.status : '';
}

/** Состоит ли пользователь в чате клуба — чтобы в личке бота не мог писать кто угодно */
function isClubMember(userId) {
  return ['creator', 'administrator', 'member', 'restricted'].includes(getChatMemberStatus(userId));
}

/** Админ чата клуба — для /skip, /cancel_cycle, /set_meeting */
function isChatAdmin(userId) {
  return ['creator', 'administrator'].includes(getChatMemberStatus(userId));
}

// ==================== ОБЩИЕ ХЕЛПЕРЫ ====================

function readJsonProperty(key, fallback) {
  const raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function writeJsonProperty(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(value));
}

/**
 * Выполнить fn под блокировкой скрипта (чтение-изменение-запись JSON в
 * PropertiesService из параллельных вебхуков). Если блокировку получить
 * не удалось — возвращает null и ничего не делает.
 */
function withScriptLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    Logger.log('⚠️ Не удалось получить блокировку — действие пропущено');
    return null;
  }
  try {
    return fn();
  } finally {
    // Дописать изменения таблицы до снятия блокировки — иначе параллельный
    // вызов может увидеть старый getLastRow() и записать в ту же строку
    try {
      if (typeof SpreadsheetApp.flush === 'function') SpreadsheetApp.flush();
    } catch (error) {
      Logger.log('⚠️ flush: ' + error);
    }
    lock.releaseLock();
  }
}

/**
 * Очистить текст от участника: убрать символы разметки Markdown
 * (иначе Telegram не примет сообщение с отчётом целиком), обрезать длину.
 */
function sanitizeUserText(text, maxLength = USER_TEXT_MAX_LENGTH) {
  const clean = String(text || '')
    .replace(/[*_`\[\]]/g, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return sliceByCodePoints(clean, maxLength).trim();
}

/**
 * Обрезать строку, не разрезая эмодзи пополам: половинка эмодзи —
 * невалидный UTF-8, и Telegram отклоняет сообщение целиком.
 * Длину считаем в UTF-16, как Telegram считает лимиты.
 */
function sliceByCodePoints(str, maxLength) {
  let out = '';
  for (const ch of Array.from(str)) {
    if (out.length + ch.length > maxLength) break;
    out += ch;
  }
  return out;
}

function truncateText(text, maxLength) {
  const str = String(text);
  return str.length > maxLength ? sliceByCodePoints(str, maxLength - 1) + '…' : str;
}

/** Имя автора — имя в Telegram */
function getAuthorName(from) {
  const name = sanitizeUserText(from && from.first_name, 50);
  return name || 'Участник клуба';
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

/** Через days дней в DEADLINE_HOUR:00 */
function deadlineAfterDays(from, days) {
  const d = addDays(from, days);
  d.setHours(DEADLINE_HOUR, 0, 0, 0);
  return d;
}

/** 'вторник, 21 октября' */
function formatDateRu(date) {
  return `${RU_WEEKDAYS[date.getDay()]}, ${date.getDate()} ${RU_MONTHS_GENITIVE[date.getMonth()]}`;
}

/** Срок этапа: '21 октября (вт), 19:00' — читается после «до», «после», «закрывается» */
function formatDeadline(isoOrDate) {
  const d = new Date(isoOrDate);
  return `${d.getDate()} ${RU_MONTHS_GENITIVE[d.getMonth()]} (${RU_WEEKDAYS_SHORT[d.getDay()]}), ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Сколько осталось до момента: 'через 2 часа', 'через 40 минут', 'уже сейчас' */
function formatTimeLeft(iso) {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (minutes <= 5) return 'уже сейчас';
  if (minutes < 60) return `через ${minutes} ${pluralRu(minutes, 'минуту', 'минуты', 'минут')}`;
  const hours = Math.round(minutes / 60);
  return `через ${hours} ${pluralRu(hours, 'час', 'часа', 'часов')}`;
}

/** Сравнение названий: без регистра, лишних пробелов и кавычек */
function normalizeTitle(title) {
  return String(title).toLowerCase().replace(/[«»"'“”„]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Время встречи хранится в UTC: слоты опроса — в MEETING_TIMEZONE_LABEL (UTC+0).
 * 'суббота, 22 ноября, 12:00 (UTC+0)'
 */
function formatMeeting(iso) {
  const d = new Date(iso);
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${RU_WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${RU_MONTHS_GENITIVE[d.getUTCMonth()]}, ${time} (${MEETING_TIMEZONE_LABEL})`;
}

/** Календарный день date + слот 'ЧЧ:ММ' → момент в UTC (ISO) */
function meetingIso(date, slot) {
  const parts = slot.split(':').map(Number);
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), parts[0], parts[1])).toISOString();
}

/** Ближайшие суббота (на targetDate или после) и воскресенье за ней */
function getUpcomingWeekend(targetDate) {
  const date = new Date(targetDate.getTime());
  date.setHours(0, 0, 0, 0);
  const saturday = addDays(date, (6 - date.getDay() + 7) % 7);
  const sunday = addDays(saturday, 1);
  return { saturday, sunday };
}

function daysText(n) {
  return `${n} ${pluralRu(n, 'день', 'дня', 'дней')}`;
}

function pluralRu(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function getSpreadsheetUrl() {
  try {
    return SpreadsheetApp.getActiveSpreadsheet().getUrl();
  } catch (error) {
    return '';
  }
}

// ---------- Листы с данными ----------

function getOrCreateDataSheet(def) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(def.name);
  if (!sheet) {
    sheet = ss.insertSheet(def.name);
    sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
    if (def.hidden) sheet.hideSheet();
  }
  return sheet;
}

/**
 * Прочитать строки данных одним запросом. Если листа ещё нет — пустой
 * список (лист не создаём, чтобы чтение ничего не меняло в таблице).
 * Каждая строка: { row (номер строки на листе), values }.
 */
function readDataRows(def) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.name);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, def.headers.length).getValues();
  return values.map((v, i) => ({ row: i + 2, values: v }));
}

/**
 * Добавить строку в лист. Без блокировки — вызывающий код сам берёт
 * withScriptLock, где важна атомарность (LockService не стоит вкладывать).
 */
function appendDataRow(def, values) {
  const sheet = getOrCreateDataSheet(def);
  // Текст, начинающийся с = + - @, таблица приняла бы за формулу
  const safe = values.map(v => (typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v));
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, safe.length).setValues([safe]);
}

// ==================== СОСТОЯНИЕ ЦИКЛА ====================
//
// Текущий цикл — JSON в Script Properties ('cycle'):
// { id, phase, startedAt, submitUntil, voteUntil, dateVoteUntil, meetingAt,
//   checkpointAt, rateUntil, book: { title, by, votes }, moderator,
//   votePolls: [{ messageId, candidates: [индексы] }], candidates: [{ title, by }],
//   datePolls: [{ messageId, date }], ratingPoll, sent: { флаги напоминаний } }
// phase: submissions → voting → scheduling → reading → rating → done

const PHASE_TITLES = {
  submissions: '📥 Приём заявок',
  voting: '🗳 Голосование за книгу',
  scheduling: '📅 Выбор даты встречи',
  reading: '📖 Чтение',
  rating: '⭐ Оценка книги',
  done: '✅ Цикл завершён'
};

function getCycle() {
  return readJsonProperty('cycle', null);
}

function saveCycle(cycle) {
  writeJsonProperty('cycle', cycle);
}

function isCycleActive(cycle) {
  return Boolean(cycle && cycle.phase !== 'done');
}

/** Заявки текущего цикла: [{ row, author, authorId, title }] */
function getCycleBooks(cycleId) {
  return readDataRows(DATA_SHEETS.CYCLE_BOOKS)
    .filter(r => Number(r.values[0]) === Number(cycleId) && String(r.values[4]).trim())
    .map(r => ({ row: r.row, author: String(r.values[2]), authorId: String(r.values[3]), title: String(r.values[4]) }));
}

function getCycleQuestions(cycleId) {
  return readDataRows(DATA_SHEETS.QUESTIONS)
    .filter(r => Number(r.values[0]) === Number(cycleId) && String(r.values[4]).trim())
    .map(r => ({ author: String(r.values[3]), text: String(r.values[4]) }));
}

/** Таймлайн цикла для /status и анонсов */
function formatTimeline(cycle) {
  const order = ['submissions', 'voting', 'scheduling', 'reading', 'rating'];
  const current = order.indexOf(cycle.phase);
  const mark = (phase) => {
    const i = order.indexOf(phase);
    if (cycle.phase === 'done' || i < current) return '✅';
    return i === current ? '👉' : '▫️';
  };
  const lines = [];
  lines.push(`${mark('submissions')} Заявки (до ${BOOKS_PER_MEMBER} книг на человека) — до ${formatDeadline(cycle.submitUntil)}`);
  lines.push(`${mark('voting')} Голосование за книгу — ${cycle.voteUntil ? 'до ' + formatDeadline(cycle.voteUntil) : `${daysText(CYCLE_VOTE_DAYS)} после заявок`}`);
  lines.push(`${mark('scheduling')} Выбор даты встречи — ${cycle.dateVoteUntil ? 'до ' + formatDeadline(cycle.dateVoteUntil) : `${daysText(CYCLE_DATE_VOTE_DAYS)} после голосования`}`);
  lines.push(`${mark('reading')} Чтение и вопросы к встрече — ${cycle.meetingAt ? 'до встречи' : `около ${CYCLE_READING_WEEKS} ${pluralRu(CYCLE_READING_WEEKS, 'недели', 'недель', 'недель')}`}`);
  lines.push(`${mark('rating')} Встреча и оценка книги — ${cycle.meetingAt ? formatMeeting(cycle.meetingAt) : 'выходные, дату выберем опросом'}`);
  return lines.join('\n');
}

// Что делать участнику прямо сейчас — в /status и в закреплённом расписании
const PHASE_HINTS = {
  submissions: `👉 Сейчас: предложи до ${BOOKS_PER_MEMBER} книг — /suggest_book Название — автор\nЗаявки: /books`,
  voting: '👉 Сейчас: отметь в опросе все книги, которые хочешь читать (можно несколько)',
  scheduling: '👉 Сейчас: в двух опросах (суббота и воскресенье) отметь все часы, когда сможешь прийти. Не подходят выходные — /another_time',
  reading: '👉 Сейчас: читаем 🙂 Вопрос к обсуждению — /question текст (анонимно — в личку боту). Все вопросы: /questions',
  rating: '👉 Сейчас: оцени книгу в опросе (анонимно)',
  done: '👉 Следующая книга: /start_cycle'
};

// ---------- Закреплённое расписание цикла ----------
//
// В начале цикла бот присылает и закрепляет сообщение с расписанием и
// дальше сам его обновляет на каждом этапе. Закреплять бот может, только
// если он админ с правом закреплять сообщения; если нет — просто не закрепит.

function formatPinnedText(cycle) {
  let text = `📌 Цикл #${cycle.id}` + (cycle.book ? ` — «${cycle.book.title}»` : '') +
    `\nРасписание обновляется само.\n\nСейчас: ${cycle.cancelled ? '❌ Цикл отменён' : PHASE_TITLES[cycle.phase]}\n\n`;
  if (!cycle.cancelled) {
    text += formatTimeline(cycle);
    if (cycle.moderator && cycle.phase !== 'done') text += `\n\n🎙 Ведущий встречи: ${cycle.moderator}`;
  }
  text += `\n\n${PHASE_HINTS[cycle.phase]}\n\nКак всё устроено: /guide`;
  return text;
}

function pinCycleSchedule(cycle) {
  const messageId = messageIdOf(sendChatText(formatPinnedText(cycle)));
  if (!messageId) return;
  cycle.pinnedMessageId = messageId;
  callTelegram('pinChatMessage', { chat_id: TELEGRAM_CHAT_ID, message_id: messageId, disable_notification: true });
}

/** Подпись состояния — чтобы обновлять закреп только когда что-то поменялось */
function cycleSignature(cycle) {
  return JSON.stringify([cycle && cycle.phase, cycle && cycle.submitUntil, cycle && cycle.voteUntil,
    cycle && cycle.dateVoteUntil, cycle && cycle.meetingAt, cycle && cycle.book && cycle.book.title, cycle && cycle.cancelled]);
}

function refreshPinnedSchedule(cycle) {
  if (!cycle || !cycle.pinnedMessageId) return;
  callTelegram('editMessageText', { chat_id: TELEGRAM_CHAT_ID, message_id: cycle.pinnedMessageId, text: formatPinnedText(cycle) });
  if (cycle.phase === 'done') {
    callTelegram('unpinChatMessage', { chat_id: TELEGRAM_CHAT_ID, message_id: cycle.pinnedMessageId });
  }
}

// ---------- «Пришли ответом на это сообщение» ----------
//
// Если нажать /suggest_book или /question в меню, Telegram отправит команду
// без текста. Тогда бот просит прислать название/вопрос ответом на своё
// сообщение (поле ответа открывается само) — и принимает этот ответ.

const PROMPTS = {
  suggest_book: '📚 Пришли название книги ответом на это сообщение — можно с автором.\nНапример: Пикник на обочине — Стругацкие',
  question: '❓ Пришли вопрос к встрече ответом на это сообщение.'
};

function askForText(kind, message) {
  const from = message.from || {};
  const result = sendTelegramMessage(PROMPTS[kind], {
    chatId: message.chat.id,
    replyTo: message.message_id,
    replyMarkup: { force_reply: true, selective: true, input_field_placeholder: kind === 'suggest_book' ? 'Название — автор' : 'Вопрос к встрече' }
  });
  const messageId = messageIdOf(result);
  if (!messageId) return;
  withScriptLock(() => {
    const prompts = readJsonProperty('prompts', {});
    const now = Date.now();
    for (const key of Object.keys(prompts)) {
      if (now - prompts[key].at > 24 * 60 * 60 * 1000) delete prompts[key];
    }
    prompts[`${message.chat.id}:${messageId}`] = { kind: kind, userId: String(from.id), at: now };
    const keys = Object.keys(prompts);
    if (keys.length > 50) keys.slice(0, keys.length - 50).forEach(k => delete prompts[k]);
    writeJsonProperty('prompts', prompts);
  });
}

/** Это ответ на наш запрос «пришли ответом»? Тогда вернуть вид запроса и забыть его */
function takePrompt(message) {
  const replyTo = message.reply_to_message;
  if (!replyTo || !replyTo.message_id) return null;
  const key = `${message.chat.id}:${replyTo.message_id}`;
  const prompts = readJsonProperty('prompts', {});
  const prompt = prompts[key];
  if (!prompt || prompt.userId !== String((message.from || {}).id)) return null;
  delete prompts[key];
  writeJsonProperty('prompts', prompts);
  return prompt.kind;
}

// ==================== ЭТАП 1: ЗАЯВКИ ====================

/** /start_cycle — запустить новый цикл */
function handleStartCycleCommand() {
  const created = withScriptLock(() => {
    const existing = getCycle();
    if (isCycleActive(existing)) return { busy: existing };
    const id = (existing ? Number(existing.id) : 0) + 1;
    const cycle = {
      id: id,
      phase: 'submissions',
      startedAt: new Date().toISOString(),
      submitUntil: deadlineAfterDays(new Date(), CYCLE_SUBMIT_DAYS).toISOString(),
      sent: {}
    };
    saveCycle(cycle);
    return { cycle: cycle };
  });
  if (!created) {
    sendChatText('Бот сейчас занят — попробуй ещё раз через минуту.');
    return;
  }
  if (created.busy) {
    sendChatText(`Уже идёт цикл #${created.busy.id} (${PHASE_TITLES[created.busy.phase]}). Подробности: /status`);
    return;
  }
  const c = created.cycle;
  sendChatText(
    `🚀 Цикл #${c.id} начался — выбираем следующую общую книгу!\n\n` +
    `📥 Шаг 1 из 5 — заявки, до ${formatDeadline(c.submitUntil)}\n` +
    `Каждый может предложить до ${BOOKS_PER_MEMBER} ${pluralRu(BOOKS_PER_MEMBER, 'книги', 'книг', 'книг')}. Как:\n` +
    '• напиши в чат: /suggest_book Название — автор\n' +
    '  например: /suggest_book Пикник на обочине — Стругацкие\n' +
    '• или просто нажми /suggest_book — бот попросит прислать название ответом\n' +
    '• можно написать боту в личку — тогда в чате не будет лишних сообщений\n\n' +
    'Посмотреть заявки: /books · убрать свою: /remove_book номер\n' +
    'Дальше бот сам запустит голосование. Всё расписание — в закреплённом сообщении.');
  pinCycleSchedule(c);
  withScriptLock(() => {
    const fresh = getCycle();
    if (fresh && fresh.id === c.id) {
      fresh.pinnedMessageId = c.pinnedMessageId;
      saveCycle(fresh);
    }
  });
}

/** /suggest_book — заявка на книгу (только на этапе заявок, до BOOKS_PER_MEMBER от человека) */
function handleSuggestBookCommand(from, args, reply, ask) {
  const cycle = getCycle();
  if (!cycle || cycle.phase !== 'submissions') {
    reply(isCycleActive(cycle)
      ? `Приём заявок в цикле #${cycle.id} уже закрыт. Что сейчас: /status`
      : 'Сейчас заявки не принимаются. Начать новый цикл выбора книги: /start_cycle');
    return;
  }
  const title = sanitizeUserText(args, BOOK_TITLE_MAX_LENGTH).replace(/^[«"“„']+|[»"”']+$/g, '').trim();
  if (!title) {
    if (ask) ask('suggest_book');
    else reply('Напиши название после команды: /suggest_book Пикник на обочине — Стругацкие');
    return;
  }

  const result = withScriptLock(() => {
    // Перепроверяем под блокировкой: заявки могли закрыться, пока ждали
    const fresh = getCycle();
    if (!fresh || fresh.id !== cycle.id || fresh.phase !== 'submissions') return { closed: true };
    const books = getCycleBooks(cycle.id);
    if (books.some(b => normalizeTitle(b.title) === normalizeTitle(title))) return { duplicate: true };
    const mine = books.filter(b => b.authorId === String(from.id));
    if (mine.length >= BOOKS_PER_MEMBER) return { limit: mine };
    if (books.length >= MAX_SUBMISSIONS_PER_CYCLE) return { full: true };
    appendDataRow(DATA_SHEETS.CYCLE_BOOKS, [cycle.id, new Date(), getAuthorName(from), String(from.id), title]);
    return { count: books.length + 1, mine: mine.length + 1 };
  });
  if (!result) {
    reply('Не получилось сохранить — попробуй ещё раз через минуту.');
    return;
  }
  if (result.full) {
    reply(`В цикле уже ${MAX_SUBMISSIONS_PER_CYCLE} заявок — это максимум. Голосование — после ${formatDeadline(cycle.submitUntil)}.`);
  } else if (result.closed) {
    reply('Приём заявок только что закрылся. Что сейчас: /status');
  } else if (result.duplicate) {
    reply(`📚 «${title}» уже есть в заявках.`);
  } else if (result.limit) {
    reply(`У тебя уже ${BOOKS_PER_MEMBER} ${pluralRu(BOOKS_PER_MEMBER, 'заявка', 'заявки', 'заявок')}: ${result.limit.map(b => '«' + b.title + '»').join(', ')}. Заменить: /remove_book номер (номера — в /books)`);
  } else {
    reply(`✅ «${title}» — в заявках (твоих: ${result.mine} из ${BOOKS_PER_MEMBER}, всего: ${result.count}).\n` +
      `Голосование начнётся ${formatDeadline(cycle.submitUntil)}. Все заявки: /books`);
  }
}

/** /remove_book N — убрать свою заявку */
function handleRemoveBookCommand(from, args, reply) {
  const cycle = getCycle();
  if (!cycle || cycle.phase !== 'submissions') {
    reply('Убирать заявки можно только во время приёма заявок.');
    return;
  }
  const n = parseInt(args, 10);
  const books = getCycleBooks(cycle.id);
  const book = books[n - 1];
  if (!book) {
    reply('Укажи номер из списка /books, например: /remove_book 2');
    return;
  }
  if (book.authorId !== String(from.id)) {
    reply('Убрать можно только свою заявку.');
    return;
  }
  const sheet = getOrCreateDataSheet(DATA_SHEETS.CYCLE_BOOKS);
  sheet.getRange(book.row, 5).setValue('');
  reply(`Заявка «${book.title}» убрана.`);
}

/** /books — заявки текущего цикла */
function handleBooksListCommand() {
  const cycle = getCycle();
  if (!isCycleActive(cycle)) {
    sendChatText('Сейчас цикл выбора книги не идёт. Начать: /start_cycle');
    return;
  }
  const books = getCycleBooks(cycle.id);
  if (books.length === 0) {
    sendChatText(`Заявок в цикле #${cycle.id} пока нет. Предложить: /suggest_book название`);
    return;
  }
  let text = `📚 Заявки цикла #${cycle.id}:\n\n`;
  books.forEach((b, i) => {
    const line = `${i + 1}. ${b.title} (от ${b.author})\n`;
    if (text.length + line.length < 3500) text += line;
  });
  if (cycle.phase === 'submissions') text += `\nПриём заявок — до ${formatDeadline(cycle.submitUntil)}`;
  sendChatText(text);
}

/**
 * Конец приёма заявок: 0 заявок — продлеваем, 1 — она и есть книга,
 * 2+ — голосование. Опросов может быть несколько (лимит 12 вариантов) —
 * поэтому в них можно выбрать несколько книг, и побеждает книга с
 * наибольшим числом голосов по всем опросам.
 */
function closeSubmissions(cycle) {
  const books = getCycleBooks(cycle.id);
  const now = new Date();

  if (books.length === 0) {
    cycle.submitUntil = deadlineAfterDays(now, 3).toISOString();
    cycle.sent = {};
    sendChatText(`📥 В цикле #${cycle.id} пока ни одной заявки — продлеваем приём до ${formatDeadline(cycle.submitUntil)}.\nПредложить книгу: /suggest_book название`);
    return;
  }

  cycle.candidates = books.map(b => ({ title: b.title, by: b.author }));
  if (books.length === 1) {
    sendChatText(`📥 Заявка всего одна — голосовать не из чего, так что читаем её!`);
    chooseBook(cycle, 0, 0, false);
    return;
  }

  const chunks = Math.ceil(books.length / POLL_MAX_OPTIONS);
  const size = Math.ceil(books.length / chunks);
  cycle.votePolls = [];
  cycle.phase = 'voting';
  cycle.voteUntil = deadlineAfterDays(now, CYCLE_VOTE_DAYS).toISOString();
  cycle.sent = {};

  sendChatText(
    `🗳 Шаг 2 из 5 — голосование, до ${formatDeadline(cycle.voteUntil)}\n` +
    `Заявки собраны: ${books.length} ${pluralRu(books.length, 'книга', 'книги', 'книг')}. Опрос — ниже.\n\n` +
    'Как голосовать:\n' +
    '• отметь ВСЕ книги, которые хочешь читать — можно несколько\n' +
    (BOOK_VOTE_ANONYMOUS ? '• голосование анонимное\n' : '• голоса видны всем\n') +
    '• передумал — нажми на опрос, «Отменить голос», и проголосуй заново\n' +
    (chunks > 1 ? `• книг много, поэтому опросов ${chunks} — голосуй в каждом\n` : '') +
    `\nПобеждает книга с наибольшим числом голосов, при ничьей — жребий. Итоги — ${formatDeadline(cycle.voteUntil)}.`);

  for (let c = 0; c < chunks; c++) {
    const indexes = [];
    for (let i = c * size; i < Math.min(books.length, (c + 1) * size); i++) indexes.push(i);
    const poll = { messageId: null, candidates: indexes, part: c + 1, parts: chunks };
    poll.messageId = sendPollOrWarn(votePollQuestion(cycle, poll), indexes.map(i => books[i].title),
      { multiple: true, anonymous: BOOK_VOTE_ANONYMOUS });
    cycle.votePolls.push(poll);
  }
}

function votePollQuestion(cycle, poll) {
  return `📚 Цикл #${cycle.id}: какие книги хочешь читать? Отметь все, что нравятся` +
    (poll.parts > 1 ? ` (опрос ${poll.part} из ${poll.parts})` : '');
}

// ==================== ЭТАП 2: ГОЛОСОВАНИЕ ====================

/** Конец голосования: закрываем опросы, считаем голоса, ничья — жребий */
function closeVoting(cycle) {
  const votes = cycle.candidates.map(() => 0);
  for (const poll of cycle.votePolls || []) {
    const counts = collectPollCounts(cycle, poll, poll.messageId, poll.candidates.length);
    if (!counts) return; // Telegram не ответил — повторим через час
    poll.candidates.forEach((candidateIndex, i) => { votes[candidateIndex] += counts[i]; });
  }
  const best = Math.max(...votes);
  const leaders = votes.map((v, i) => (v === best ? i : -1)).filter(i => i >= 0);
  const winner = leaders[Math.floor(Math.random() * leaders.length)];
  chooseBook(cycle, winner, best, leaders.length > 1);
}

/** Книга выбрана: объявляем, назначаем ведущего, запускаем выбор даты */
function chooseBook(cycle, candidateIndex, votes, byLot) {
  const book = cycle.candidates[candidateIndex];
  cycle.book = { title: book.title, by: book.by, votes: votes };

  // Ведущий встречи — случайный из тех, кто подавал заявки (кроме автора
  // победившей книги, если есть из кого выбирать)
  const proposers = Array.from(new Set(cycle.candidates.map(c => c.by)));
  const others = proposers.filter(p => p !== book.by);
  const pool = others.length > 0 ? others : proposers;
  cycle.moderator = pool[Math.floor(Math.random() * pool.length)];

  let text = `🎉 Книга цикла #${cycle.id}: «${book.title}»!\nПредложил(а): ${book.by}`;
  if (cycle.candidates.length > 1) {
    text += `, голосов: ${votes}`;
    if (byLot) text += ' — была ничья, бот бросил жребий 🎲';
  }
  text += `\n🎙 Ведущий встречи: ${cycle.moderator} — открывает встречу, ведёт обсуждение по вопросам и следит за регламентом.`;
  sendChatText(text);

  startScheduling(cycle, addDays(new Date(), CYCLE_READING_WEEKS * 7));
}

// ==================== ЭТАП 3: ДАТА ВСТРЕЧИ ====================

/** Два опроса — суббота и воскресенье выходных на/после targetDate */
function startScheduling(cycle, targetDate) {
  const { saturday, sunday } = getUpcomingWeekend(targetDate);
  cycle.phase = 'scheduling';
  cycle.dateVoteUntil = deadlineAfterDays(new Date(), CYCLE_DATE_VOTE_DAYS).toISOString();
  cycle.sent = {};

  cycle.datePolls = [saturday, sunday].map(day => {
    const poll = { date: day.toISOString(), messageId: null };
    poll.messageId = sendPollOrWarn(datePollQuestion(cycle, poll), MEETING_TIME_SLOTS, { multiple: true });
    return poll;
  });
  sendChatText(
    `📅 Шаг 3 из 5 — время встречи, до ${formatDeadline(cycle.dateVoteUntil)}\n` +
    `Выше два опроса: ${formatDateRu(saturday)} и ${formatDateRu(sunday)}.\n\n` +
    'Как голосовать:\n' +
    '• отметь ВСЕ часы, когда сможешь прийти, — в обоих опросах\n' +
    `• время — ${MEETING_TIMEZONE_LABEL}\n` +
    '• не можешь в эти выходные совсем — ничего не отмечай\n\n' +
    'Бот выберет час, который подходит большинству (при равенстве — более ранний).\n' +
    `Не подходят эти выходные — /another_time (сдвинуть на неделю, не больше ${DATE_MOVES_PER_CYCLE} раз за цикл).`);
}

function datePollQuestion(cycle, poll) {
  return `📅 Встреча по «${cycle.book.title}» — ${formatDateRu(new Date(poll.date))}. Когда сможешь? Отметь все удобные часы (время — ${MEETING_TIMEZONE_LABEL})`;
}

/** Конец выбора даты: слот с наибольшим числом голосов (при равенстве — более ранний) */
function closeScheduling(cycle) {
  let best = { votes: 0, iso: null };
  for (const poll of cycle.datePolls || []) {
    const counts = collectPollCounts(cycle, poll, poll.messageId, MEETING_TIME_SLOTS.length);
    if (!counts) return; // Telegram не ответил — повторим через час
    counts.forEach((votes, i) => {
      if (votes > best.votes) best = { votes: votes, iso: meetingIso(new Date(poll.date), MEETING_TIME_SLOTS[i]) };
    });
  }
  const fallback = !best.iso;
  const saturday = new Date(cycle.datePolls[0].date);
  setMeeting(cycle, best.iso || meetingIso(saturday, DEFAULT_MEETING_SLOT), fallback);
}

/** Зафиксировать дату встречи и перейти к чтению */
function setMeeting(cycle, iso, fallback) {
  // При переносе уже назначенной встречи чекпоинт второй раз не шлём
  const checkpointSent = cycle.phase === 'reading' && cycle.sent && cycle.sent.checkpoint;
  cycle.meetingAt = iso;
  cycle.phase = 'reading';
  const now = Date.now();
  cycle.checkpointAt = new Date(now + (new Date(iso).getTime() - now) / 2).toISOString();
  cycle.sent = checkpointSent ? { checkpoint: true } : {};
  sendChatText(
    `📌 Встреча по «${cycle.book.title}» — ${formatMeeting(iso)}` +
    (fallback ? `\n(за время никто не проголосовал — ставим субботу, ${DEFAULT_MEETING_SLOT})` : '') +
    `\n🎙 Ведущий: ${cycle.moderator}\n\n` +
    '📖 Шаг 4 из 5 — читаем!\n' +
    'Появился вопрос для обсуждения — запиши его, чтобы не забыть:\n' +
    '• /question текст — или просто /question, бот попросит прислать ответом\n' +
    '• анонимно — напиши то же самое боту в личку\n\n' +
    'Все вопросы: /questions. На полпути бот спросит, как идёт чтение; за сутки до встречи пришлёт общий список вопросов, ' +
    `за ${AGENDA_REMINDER_HOURS} ${pluralRu(AGENDA_REMINDER_HOURS, 'час', 'часа', 'часов')} — план встречи.`);
}

// ==================== ЭТАП 4: ЧТЕНИЕ И ВСТРЕЧА ====================

function handleQuestionCommand(from, args, reply, anonymous, ask) {
  const cycle = getCycle();
  if (!cycle || !cycle.book || !['scheduling', 'reading'].includes(cycle.phase)) {
    reply('Вопросы к встрече принимаются, когда книга цикла уже выбрана. Что сейчас: /status');
    return;
  }
  const text = sanitizeUserText(args);
  if (!text) {
    if (ask) ask('question');
    else reply('Напиши вопрос после команды: /question Почему герой так поступил в финале?');
    return;
  }
  const saved = withScriptLock(() => {
    appendDataRow(DATA_SHEETS.QUESTIONS, [cycle.id, cycle.book.title, new Date(), anonymous ? 'аноним' : getAuthorName(from), text]);
    return true;
  });
  if (!saved) {
    reply('Не получилось сохранить вопрос — попробуй ещё раз через минуту.');
    return;
  }
  const count = getCycleQuestions(cycle.id).length;
  reply(`✅ Вопрос к встрече по «${cycle.book.title}» сохранён${anonymous ? ' (анонимно)' : ''}. Всего вопросов: ${count}. Список: /questions`);
}

function formatQuestionsList(questions) {
  let text = '';
  questions.forEach((q, i) => {
    const line = `${i + 1}. ${q.text}\n`;
    if (text.length + line.length < 3300) text += line;
  });
  return text;
}

function handleQuestionsListCommand() {
  const cycle = getCycle();
  if (!cycle || !cycle.book) {
    sendChatText('Книга цикла ещё не выбрана — вопросов пока нет.');
    return;
  }
  const questions = getCycleQuestions(cycle.id);
  if (questions.length === 0) {
    sendChatText(`Вопросов к встрече по «${cycle.book.title}» пока нет. Добавить: /question текст`);
    return;
  }
  sendChatText(`❓ Вопросы к встрече по «${cycle.book.title}»:\n\n${formatQuestionsList(questions)}\nДобавить ещё: /question текст`);
}

function sendCheckpoint(cycle) {
  sendPoll(`📖 Полпути до встречи по «${cycle.book.title}»! Как продвигается чтение? (анонимно)`, CHECKPOINT_OPTIONS, { anonymous: CHECKPOINT_ANONYMOUS });
}

function sendQuestionsReminder(cycle) {
  const questions = getCycleQuestions(cycle.id);
  const url = getSpreadsheetUrl();
  const hoursLeft = (new Date(cycle.meetingAt).getTime() - Date.now()) / (60 * 60 * 1000);
  const when = hoursLeft >= 12 ? 'Завтра встреча' : `Встреча ${formatTimeLeft(cycle.meetingAt)}`;
  let text = `⏰ ${when} по «${cycle.book.title}» — ${formatMeeting(cycle.meetingAt)}\n🎙 Ведущий: ${cycle.moderator}\n\n`;
  text += questions.length > 0
    ? `❓ Вопросы к обсуждению (${questions.length}):\n\n${formatQuestionsList(questions)}`
    : '❓ Вопросов пока нет — самое время добавить: /question текст\n';
  if (url) text += `\nВсе вопросы — в таблице, лист «${DATA_SHEETS.QUESTIONS.name}»: ${url}`;
  sendChatText(text);
}

function sendAgenda(cycle) {
  const left = formatTimeLeft(cycle.meetingAt);
  let text = `📋 Встреча по «${cycle.book.title}» — ${left}!\n🎙 Ведущий: ${cycle.moderator}\n\nРегламент:\n`;
  MEETING_AGENDA.forEach((item, i) => { text += `${i + 1}. ${item}\n`; });
  text += '\nСписок вопросов: /questions';
  sendChatText(text);
}

// ==================== ЭТАП 5: ОЦЕНКА ====================

function startRating(cycle) {
  cycle.phase = 'rating';
  cycle.rateUntil = deadlineAfterDays(new Date(), CYCLE_RATING_DAYS).toISOString();
  cycle.sent = {};
  cycle.ratingPoll = sendPollOrWarn(ratingPollQuestion(cycle), RATING_OPTIONS, { anonymous: RATING_ANONYMOUS });
  sendChatText(
    `⭐ Шаг 5 из 5 — оценка. Спасибо за встречу! 🙌\n` +
    `Оцени «${cycle.book.title}» в опросе выше — ${RATING_ANONYMOUS ? 'анонимно' : 'голоса видны всем'}, до ${formatDeadline(cycle.rateUntil)}.\n` +
    'Даже если не дочитал(а) или не был(а) на встрече — оцени то, что прочитал(а). Итог попадёт в историю клуба: /history, /stats');
}

function ratingPollQuestion(cycle) {
  return `⭐ Как тебе «${cycle.book.title}»? Оценка от 1 до 5${RATING_ANONYMOUS ? ' (анонимно)' : ''}`;
}

/** /meeting_done — встреча прошла раньше, чем бот прислал оценку сам */
function handleMeetingDoneCommand() {
  const done = withScriptLock(() => {
    const cycle = getCycle();
    if (!cycle || cycle.phase !== 'reading') return { cycle: cycle };
    if (Date.now() < new Date(cycle.meetingAt).getTime() - 60 * 60 * 1000) return { early: cycle };
    startRating(cycle);
    saveCycle(cycle);
    refreshPinnedSchedule(cycle);
    return { ok: true };
  });
  if (!done || done.ok) return;
  if (done.early) {
    sendChatText(`Встреча по «${done.early.book.title}» ещё впереди — ${formatMeeting(done.early.meetingAt)}.`);
  } else if (done.cycle && done.cycle.phase === 'rating') {
    // Оценка уже идёт — молчим, чтобы не дублировать
  } else {
    sendChatText('Сейчас встреча не запланирована. Что сейчас: /status');
  }
}

/** Конец оценки: средняя оценка → лист «История клуба» → итоги в чат */
function closeRating(cycle) {
  cycle.ratingResult = cycle.ratingResult || {};
  const counts = collectPollCounts(cycle, cycle.ratingResult, cycle.ratingPoll, RATING_OPTIONS.length);
  if (!counts) return; // Telegram не ответил — повторим через час
  const total = counts.reduce((s, v) => s + v, 0);
  const sum = counts.reduce((s, v, i) => s + v * (5 - i), 0);
  const avg = total > 0 ? Math.round((sum / total) * 10) / 10 : '';
  const questions = getCycleQuestions(cycle.id).length;

  if (!cycle.historyWritten) {
    appendDataRow(DATA_SHEETS.HISTORY, [cycle.id, cycle.book.title, cycle.book.by, cycle.book.votes,
      new Date(cycle.meetingAt), avg, total, questions, cycle.moderator || '']);
    cycle.historyWritten = true;
    saveCycle(cycle);
  }
  cycle.rating = { avg: avg, total: total };
  cycle.phase = 'done';
  cycle.sent = {};

  sendChatText(
    `📊 Итоги цикла #${cycle.id}: «${cycle.book.title}»\n` +
    (total > 0 ? `⭐ Средняя оценка: ${avg} из 5 (${total} ${pluralRu(total, 'оценка', 'оценки', 'оценок')})\n` : '⭐ Оценок не было\n') +
    `❓ Вопросов к встрече: ${questions}\n\n` +
    'Книга записана в историю клуба (/history, /stats).\nСледующая книга: /start_cycle');
}

// ==================== ПЛАНИРОВЩИК ====================

/**
 * ⏱ tick — раз в час (триггер ставит setupBot): двигает цикл по этапам
 * и присылает напоминания. Каждое напоминание — один раз (флаги cycle.sent).
 */
function tick() {
  withScriptLock(() => {
    const cycle = getCycle();
    if (!isCycleActive(cycle)) return;
    const before = cycleSignature(cycle);
    try {
      advanceCycle(cycle, false);
    } finally {
      // Сохраняем даже при ошибке: отправленные опросы и флаги напоминаний
      // не должны потеряться, иначе через час всё уйдёт в чат повторно
      saveCycle(cycle);
    }
    if (cycleSignature(cycle) !== before) refreshPinnedSchedule(cycle);
  });
}

/**
 * Опросы, которые не отправились (например, у бота не было права), —
 * пробуем отправить снова. Если удалось и до срока меньше суток —
 * срок продлевается, чтобы все успели проголосовать.
 * Возвращает true, если какой-то опрос так и не отправился.
 */
function resendMissingPolls(cycle) {
  const pending = [];
  if (cycle.phase === 'voting') {
    for (const poll of cycle.votePolls || []) {
      if (!poll.messageId) pending.push({ set: (id) => { poll.messageId = id; },
        send: () => sendPoll(votePollQuestion(cycle, poll), poll.candidates.map(i => cycle.candidates[i].title),
          { multiple: true, anonymous: BOOK_VOTE_ANONYMOUS }) });
    }
  } else if (cycle.phase === 'scheduling') {
    for (const poll of cycle.datePolls || []) {
      if (!poll.messageId) pending.push({ set: (id) => { poll.messageId = id; },
        send: () => sendPoll(datePollQuestion(cycle, poll), MEETING_TIME_SLOTS, { multiple: true }) });
    }
  } else if (cycle.phase === 'rating' && !cycle.ratingPoll) {
    pending.push({ set: (id) => { cycle.ratingPoll = id; },
      send: () => sendPoll(ratingPollQuestion(cycle), RATING_OPTIONS, { anonymous: RATING_ANONYMOUS }) });
  }
  if (pending.length === 0) return false;

  let missing = false;
  let resent = false;
  for (const item of pending) {
    const id = item.send();
    if (id) {
      item.set(id);
      resent = true;
    } else {
      missing = true;
    }
  }
  if (resent) {
    const key = { voting: 'voteUntil', scheduling: 'dateVoteUntil', rating: 'rateUntil' }[cycle.phase];
    const minimum = deadlineAfterDays(new Date(), 1);
    if (new Date(cycle[key]).getTime() < minimum.getTime()) cycle[key] = minimum.toISOString();
    sendChatText(`↩️ Опрос не отправился вовремя — отправил его сейчас (выше). Голосуем до ${formatDeadline(cycle[key])}.`);
    cycle.sent = cycle.sent || {};
    cycle.sent.voteReminder = true; // только что напомнили — второе напоминание в тот же час не нужно
  }
  return missing;
}

/**
 * Один шаг цикла. force = true — перейти к следующему этапу прямо сейчас
 * (/skip), не дожидаясь срока.
 */
function advanceCycle(cycle, force) {
  const now = Date.now();
  const due = (iso) => force || (iso && now >= new Date(iso).getTime());
  const before = (iso, hours) => iso && now >= new Date(iso).getTime() - hours * 60 * 60 * 1000;
  cycle.sent = cycle.sent || {};

  // Опрос этапа не отправился — сначала пробуем отправить его, а этап не
  // закрываем (иначе вышло бы «0 голосов» и случайная книга). /skip — закрывает.
  if (resendMissingPolls(cycle) && !force) return;

  switch (cycle.phase) {
    case 'submissions':
      if (due(cycle.submitUntil)) {
        closeSubmissions(cycle);
      } else if (!cycle.sent.submitReminder && before(cycle.submitUntil, 24)) {
        cycle.sent.submitReminder = true;
        const books = getCycleBooks(cycle.id);
        sendChatText(`⏰ Последний день заявок цикла #${cycle.id} — до ${formatDeadline(cycle.submitUntil)}.\n` +
          `Сейчас ${books.length} ${pluralRu(books.length, 'заявка', 'заявки', 'заявок')}: /books\nПредложить: /suggest_book название`);
      }
      break;
    case 'voting':
      if (due(cycle.voteUntil)) {
        closeVoting(cycle);
      } else if (!cycle.sent.voteReminder && before(cycle.voteUntil, 24)) {
        cycle.sent.voteReminder = true;
        sendChatText(`⏰ Голосование за книгу цикла #${cycle.id} закрывается ${formatDeadline(cycle.voteUntil)} — успейте проголосовать в опросе выше!`);
      }
      break;
    case 'scheduling':
      if (due(cycle.dateVoteUntil)) closeScheduling(cycle);
      break;
    case 'reading':
      if (force || now >= new Date(cycle.meetingAt).getTime() + MEETING_DURATION_HOURS * 60 * 60 * 1000) {
        startRating(cycle);
      } else if (!cycle.sent.agenda && before(cycle.meetingAt, AGENDA_REMINDER_HOURS)) {
        cycle.sent.agenda = true;
        cycle.sent.questions = true;
        cycle.sent.checkpoint = true;
        sendAgenda(cycle);
      } else if (!cycle.sent.questions && before(cycle.meetingAt, QUESTIONS_REMINDER_HOURS)) {
        cycle.sent.questions = true;
        cycle.sent.checkpoint = true;
        sendQuestionsReminder(cycle);
      } else if (!cycle.sent.checkpoint && due(cycle.checkpointAt)) {
        cycle.sent.checkpoint = true;
        sendCheckpoint(cycle);
      }
      break;
    case 'rating':
      if (due(cycle.rateUntil)) closeRating(cycle);
      break;
    default:
      break;
  }
}

// ==================== УПРАВЛЕНИЕ ЦИКЛОМ ====================

function handleStatusCommand() {
  const cycle = getCycle();
  if (!cycle) {
    sendChatText('Циклов ещё не было. Начать выбор книги: /start_cycle');
    return;
  }
  if (cycle.cancelled) {
    sendChatText(`Цикл #${cycle.id} был отменён. Начать новый: /start_cycle`);
    return;
  }
  let text = `📚 Цикл #${cycle.id}` + (cycle.book ? ` — «${cycle.book.title}»` : '') + `\nСейчас: ${PHASE_TITLES[cycle.phase]}\n\n`;
  text += formatTimeline(cycle);
  if (cycle.moderator && cycle.phase !== 'done') text += `\n\n🎙 Ведущий встречи: ${cycle.moderator}`;
  text += `\n\n${PHASE_HINTS[cycle.phase] || ''}\n\nКак всё устроено: /guide`;
  sendChatText(text);
}

/** /another_time — на этапе выбора даты: те же опросы на неделю позже */
function handleAnotherTimeCommand() {
  const moved = withScriptLock(() => {
    const cycle = getCycle();
    if (!cycle || cycle.phase !== 'scheduling') return false;
    if ((cycle.dateMoves || 0) >= DATE_MOVES_PER_CYCLE) return 'limit';
    cycle.dateMoves = (cycle.dateMoves || 0) + 1;
    for (const poll of cycle.datePolls || []) {
      if (poll.messageId) callTelegram('stopPoll', { chat_id: TELEGRAM_CHAT_ID, message_id: poll.messageId });
    }
    startScheduling(cycle, addDays(new Date(cycle.datePolls[0].date), 7));
    saveCycle(cycle);
    refreshPinnedSchedule(cycle);
    return true;
  });
  if (moved === false) {
    sendChatText('Сдвинуть дату можно, пока идёт выбор даты встречи. Что сейчас: /status');
  } else if (moved === 'limit') {
    sendChatText(`Дату в этом цикле уже сдвигали ${DATE_MOVES_PER_CYCLE} раза. Назначить вручную может админ: /set_meeting ДД.ММ ЧЧ:ММ`);
  } else if (moved === null) {
    sendChatText('Бот сейчас занят — попробуй ещё раз через минуту.');
  }
}

/** Админ-команды: /skip, /cancel_cycle, /set_meeting ДД.ММ ЧЧ:ММ */
function handleAdminCommand(command, from, args) {
  if (!isChatAdmin(from.id)) {
    sendChatText('Эта команда — только для админов чата.');
    return;
  }
  const result = withScriptLock(() => {
    const cycle = getCycle();
    if (!isCycleActive(cycle)) return 'Сейчас цикл не идёт. Начать: /start_cycle';

    if (command === 'skip') {
      try {
        advanceCycle(cycle, true);
      } finally {
        saveCycle(cycle);
      }
      refreshPinnedSchedule(cycle);
      return null;
    }
    if (command === 'cancel_cycle') {
      const open = (cycle.votePolls || []).concat(cycle.datePolls || []).map(p => p.messageId);
      if (cycle.ratingPoll) open.push(cycle.ratingPoll);
      for (const messageId of open) {
        if (messageId) callTelegram('stopPoll', { chat_id: TELEGRAM_CHAT_ID, message_id: messageId });
      }
      cycle.phase = 'done';
      cycle.cancelled = true;
      saveCycle(cycle);
      refreshPinnedSchedule(cycle);
      return `Цикл #${cycle.id} отменён. Новый: /start_cycle`;
    }
    if (command === 'set_meeting') {
      if (!cycle.book) return 'Сначала нужно выбрать книгу.';
      if (!['scheduling', 'reading'].includes(cycle.phase)) return 'Дату встречи можно менять только до встречи.';
      const m = String(args).match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2}):(\d{2})$/);
      if (!m) return `Формат: /set_meeting 22.11 12:00 (время — ${MEETING_TIMEZONE_LABEL})`;
      const day = Number(m[1]);
      const month = Number(m[2]) - 1;
      const hour = Number(m[4]);
      const minute = Number(m[5]);
      const now = new Date();
      const build = (year) => new Date(Date.UTC(year, month, day, hour, minute));
      const valid = (d) => d.getUTCDate() === day && d.getUTCMonth() === month && hour < 24 && minute < 60;
      let when = build(m[3] ? Number(m[3]) : now.getFullYear());
      // Без года и дата уже давно прошла — значит, имеется в виду следующий год
      if (!m[3] && when.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) when = build(now.getFullYear() + 1);
      if (!valid(when) || when.getFullYear() < 2000) return 'Такой даты нет. Формат: /set_meeting 22.11 12:00';
      if (when.getTime() <= now.getTime()) return 'Эта дата уже прошла — укажи будущую.';
      const iso = when.toISOString();
      for (const poll of cycle.datePolls || []) {
        if (poll.messageId && cycle.phase === 'scheduling') callTelegram('stopPoll', { chat_id: TELEGRAM_CHAT_ID, message_id: poll.messageId });
      }
      setMeeting(cycle, iso, false);
      saveCycle(cycle);
      refreshPinnedSchedule(cycle);
      return null;
    }
    return null;
  });
  if (result) sendChatText(result);
}

// ==================== СТАТИСТИКА ====================

function getHistory() {
  return readDataRows(DATA_SHEETS.HISTORY)
    .filter(r => String(r.values[1]).trim())
    .map(r => ({
      cycle: r.values[0], title: String(r.values[1]), by: String(r.values[2]),
      votes: Number(r.values[3]) || 0, meeting: r.values[4],
      avg: r.values[5] === '' ? null : Number(r.values[5]), ratings: Number(r.values[6]) || 0,
      questions: Number(r.values[7]) || 0
    }));
}

function handleHistoryCommand() {
  const history = getHistory();
  if (history.length === 0) {
    sendChatText('История клуба пока пуста — она пополняется в конце каждого цикла. Начать: /start_cycle');
    return;
  }
  let text = '📜 Что мы читали:\n\n';
  history.slice().reverse().forEach(h => {
    const line = `#${h.cycle} «${h.title}» — ${h.avg === null ? 'без оценок' : '⭐ ' + h.avg} (предложил(а) ${h.by})\n`;
    if (text.length + line.length < 3500) text += line;
  });
  sendChatText(text);
}

function handleStatsCommand() {
  const history = getHistory();
  if (history.length === 0) {
    sendChatText('Статистики пока нет — она появится после первого завершённого цикла. Начать: /start_cycle');
    return;
  }
  const rated = history.filter(h => h.avg !== null).sort((a, b) => b.avg - a.avg);
  let text = `📊 Статистика клуба\n\n📚 Прочитано книг: ${history.length}\n`;
  if (rated.length > 0) {
    const overall = Math.round((rated.reduce((s, h) => s + h.avg, 0) / rated.length) * 10) / 10;
    text += `⭐ Средняя оценка: ${overall}\n`;
    text += `❓ Вопросов к встречам: ${history.reduce((s, h) => s + h.questions, 0)}\n\n`;
    text += '🏆 Больше всего понравились:\n';
    rated.slice(0, 3).forEach((h, i) => { text += `${['🥇', '🥈', '🥉'][i]} «${h.title}» — ${h.avg}\n`; });
    if (rated.length > 3) {
      const worst = rated[rated.length - 1];
      text += `\n😐 Меньше всего зашла: «${worst.title}» — ${worst.avg}\n`;
    }
    // Чей вкус клубу нравится больше: средняя оценка книг, которые человек предложил
    const byProposer = {};
    for (const h of rated) {
      byProposer[h.by] = byProposer[h.by] || { sum: 0, n: 0 };
      byProposer[h.by].sum += h.avg;
      byProposer[h.by].n += 1;
    }
    const proposers = Object.keys(byProposer)
      .map(name => ({ name, avg: Math.round((byProposer[name].sum / byProposer[name].n) * 10) / 10, n: byProposer[name].n }))
      .sort((a, b) => b.avg - a.avg || b.n - a.n);
    text += '\n🎯 Чьи книги клубу нравятся больше:\n';
    proposers.slice(0, 5).forEach(p => {
      text += `${p.name} — ${p.avg} (${p.n} ${pluralRu(p.n, 'книга', 'книги', 'книг')})\n`;
    });
  } else {
    text += '⭐ Оценок пока не было\n';
  }
  text += '\nВсе книги: /history';
  sendChatText(text);
}

// ==================== ВХОДЯЩИЕ СООБЩЕНИЯ ====================

/** '/cmd@BotName аргументы' → { command: 'cmd', args: 'аргументы' } */
function parseCommand(text) {
  const m = String(text).match(/^\/([a-zA-Z_]+)(?:@(\S+))?(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  // Команда адресована другому боту в группе (/help@OtherBot) — не наша
  if (m[2] && !isOwnBotUsername(m[2])) return null;
  return { command: m[1].toLowerCase(), args: (m[3] || '').trim() };
}

/**
 * Совпадает ли @имя с именем нашего бота. Имя узнаём один раз через getMe
 * и запоминаем. Если узнать не получилось — считаем командой нам
 * (лучше ответить лишний раз, чем потерять команду).
 */
function isOwnBotUsername(name) {
  const props = PropertiesService.getScriptProperties();
  let own = props.getProperty('botUsername');
  if (!own) {
    const me = callTelegram('getMe', {});
    if (me && me.ok && me.result && me.result.username) {
      own = me.result.username;
      props.setProperty('botUsername', own);
    }
  }
  return !own || own.toLowerCase() === String(name).toLowerCase();
}

function groupHelpText() {
  return '📚 Команды книжного клуба\n' +
    'Как всё устроено, по шагам: /guide\n\n' +
    'Где мы сейчас:\n' +
    '/status — этап, все даты цикла и что делать сейчас\n\n' +
    'Выбор книги:\n' +
    '/start_cycle — начать новый цикл\n' +
    `/suggest_book Название — автор — предложить книгу (до ${BOOKS_PER_MEMBER} на человека)\n` +
    '/books — заявки цикла с номерами\n' +
    '/remove_book номер — убрать свою заявку\n\n' +
    'Встреча:\n' +
    '/question текст — вопрос к встрече (в личку боту — анонимно)\n' +
    '/questions — все вопросы к встрече\n' +
    '/another_time — не подходят выходные: сдвинуть выбор даты на неделю\n' +
    '/meeting_done — встреча закончилась: сразу прислать оценку\n\n' +
    'История:\n' +
    '/history — что мы читали\n' +
    '/stats — оценки, топ книг, чьи книги нравятся больше\n\n' +
    'Для админов чата: /skip — следующий этап сейчас, /set_meeting ДД.ММ ЧЧ:ММ, /cancel_cycle\n' +
    '/bot_version — версия бота';
}

/** /guide — пошаговая инструкция для участников клуба */
function guideText() {
  return '📖 Как устроен клуб — по шагам\n\n' +
    'Каждая книга проходит один цикл. Бот сам ведёт расписание и напоминает о сроках — ' +
    'следить за датами не нужно, всё видно в закреплённом сообщении и по /status.\n\n' +
    `1️⃣ ЗАЯВКИ — ${daysText(CYCLE_SUBMIT_DAYS)}\n` +
    `Предложи до ${BOOKS_PER_MEMBER} ${pluralRu(BOOKS_PER_MEMBER, 'книги', 'книг', 'книг')}. Напиши в чат одним сообщением:\n` +
    '/suggest_book Пикник на обочине — Стругацкие\n' +
    'Или просто нажми /suggest_book — бот попросит прислать название ответом. Можно и в личку боту.\n' +
    'Передумал — /books покажет заявки с номерами, /remove_book 2 уберёт твою заявку №2.\n\n' +
    `2️⃣ ГОЛОСОВАНИЕ — ${daysText(CYCLE_VOTE_DAYS)}\n` +
    'Бот пришлёт опрос со всеми заявками. Отметь ВСЕ книги, которые хочешь читать, — можно несколько. ' +
    (BOOK_VOTE_ANONYMOUS ? 'Голосование анонимное. ' : 'Голоса видны всем. ') +
    'Передумал — нажми на опрос, «Отменить голос», и проголосуй заново. ' +
    'Побеждает книга с наибольшим числом голосов, при ничьей — жребий.\n\n' +
    `3️⃣ ВРЕМЯ ВСТРЕЧИ — ${daysText(CYCLE_DATE_VOTE_DAYS)}\n` +
    `Два опроса: суббота и воскресенье примерно через ${CYCLE_READING_WEEKS} ${pluralRu(CYCLE_READING_WEEKS, 'неделю', 'недели', 'недель')}. ` +
    `Отметь ВСЕ часы, когда сможешь прийти (время — ${MEETING_TIMEZONE_LABEL}). Бот выберет час, который подходит большинству. ` +
    'Не подходят эти выходные — /another_time.\n\n' +
    '4️⃣ ЧТЕНИЕ\n' +
    'Читаем 🙂 Появился вопрос для обсуждения — /question текст (или просто /question, бот попросит прислать ответом). ' +
    'Анонимно — то же самое боту в личку. Все вопросы: /questions.\n' +
    'На полпути бот спросит, как идёт чтение. За сутки до встречи пришлёт все вопросы, ' +
    `за ${AGENDA_REMINDER_HOURS} ${pluralRu(AGENDA_REMINDER_HOURS, 'час', 'часа', 'часов')} — план встречи. ` +
    'Ведущего встречи бот выбирает сам.\n\n' +
    '5️⃣ ВСТРЕЧА И ОЦЕНКА\n' +
    `Через ${MEETING_DURATION_HOURS} ${pluralRu(MEETING_DURATION_HOURS, 'час', 'часа', 'часов')} после начала встречи — опрос «Как тебе книга?» от 1 до 5` +
    (RATING_ANONYMOUS ? ' (анонимно)' : '') + `, открыт ${daysText(CYCLE_RATING_DAYS)}. ` +
    'Оценка уходит в историю клуба: /history, /stats.\n\n' +
    'Дальше — следующая книга: /start_cycle. Все команды: /help';
}

function privateHelpText() {
  return '🤫 Здесь можно тихо, без сообщения в общем чате:\n\n' +
    '/question текст — вопрос к встрече. В общем списке он будет без имени.\n' +
    `/suggest_book Название — автор — заявка на книгу (до ${BOOKS_PER_MEMBER} на человека). Имя предложившего видно в /books.\n\n` +
    'Можно просто нажать команду — бот попросит прислать текст ответом.\n' +
    'Как всё устроено: /guide · остальные команды — в чате клуба: /help';
}

function handleGroupMessage(message) {
  const text = message.text.trim();
  const textLower = text.toLowerCase();
  const from = message.from || {};
  // Ответы бота — ответом на сообщение человека, чтобы было видно, кому
  const reply = (t) => sendTelegramMessage(t, { replyTo: message.message_id });
  const ask = (kind) => askForText(kind, message);

  // Ответ на «пришли название/вопрос ответом на это сообщение»
  const prompted = takePrompt(message);
  if (prompted === 'suggest_book') {
    handleSuggestBookCommand(from, text, reply, null);
    return;
  }
  if (prompted === 'question') {
    handleQuestionCommand(from, text, reply, false, null);
    return;
  }

  const cmd = parseCommand(text);

  // Текстовый триггер — только сообщение целиком («Встреча закончена!»),
  // а не любая фраза, которая так начинается
  const bare = textLower.replace(/[\s!.…🎉]+$/u, '');
  if ((cmd && cmd.command === 'meeting_done') || MEETING_DONE_TEXT_TRIGGERS.includes(bare)) {
    handleMeetingDoneCommand();
    return;
  }
  if (!cmd) return;

  switch (cmd.command) {
    case 'start_cycle':
    case 'start_process': handleStartCycleCommand(); break;
    case 'status': handleStatusCommand(); break;
    case 'suggest_book': handleSuggestBookCommand(from, cmd.args, reply, ask); break;
    case 'remove_book': handleRemoveBookCommand(from, cmd.args, reply); break;
    case 'books': handleBooksListCommand(); break;
    case 'question': handleQuestionCommand(from, cmd.args, reply, false, ask); break;
    case 'questions': handleQuestionsListCommand(); break;
    case 'another_time': handleAnotherTimeCommand(); break;
    case 'history': handleHistoryCommand(); break;
    case 'stats': handleStatsCommand(); break;
    case 'skip':
    case 'cancel_cycle':
    case 'set_meeting': handleAdminCommand(cmd.command, from, cmd.args); break;
    case 'guide':
    case 'how': sendChatText(guideText()); break;
    case 'help':
    case 'start': sendChatText(groupHelpText()); break;
    case 'bot_version': sendChatText(`🤖 Бот книжного клуба, версия ${BOT_VERSION}\nВсе команды: /help`); break;
    default:
      if (RETIRED_COMMANDS.includes(cmd.command)) {
        reply('Эта команда больше не работает. Все команды: /help');
      }
      break;
  }
}

function handlePrivateMessage(message) {
  const chatId = message.chat.id;
  const from = message.from || {};
  const text = message.text.trim();
  const reply = (t) => sendPrivateText(chatId, t);
  const ask = (kind) => askForText(kind, message);

  const prompted = takePrompt(message);
  const cmd = prompted ? { command: prompted, args: text } : parseCommand(text);

  if (cmd && (cmd.command === 'guide' || cmd.command === 'how')) {
    reply(guideText());
    return;
  }
  if (!cmd || !['question', 'suggest_book'].includes(cmd.command)) {
    reply(privateHelpText());
    return;
  }
  // В личку может написать кто угодно — принимаем только участников чата клуба
  if (!isClubMember(from.id)) {
    reply('Эта команда — только для участников книжного клуба.');
    return;
  }
  const askIfCommand = prompted ? null : ask;
  if (cmd.command === 'question') handleQuestionCommand(from, cmd.args, reply, true, askIfCommand);
  else handleSuggestBookCommand(from, cmd.args, reply, askIfCommand);
}

/** Своих кнопок у бота нет — это могут быть только старые кнопки в истории чата */
function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message && callbackQuery.message.chat && callbackQuery.message.chat.id;
  if (String(chatId) !== String(TELEGRAM_CHAT_ID)) {
    return 'ignored';
  }
  callTelegram('answerCallbackQuery', { callback_query_id: callbackQuery.id, text: 'Эта кнопка больше не работает' });
  return 'ok';
}

// ==================== ВЕБХУК TELEGRAM ====================

/**
 * Точка входа вебхука — Telegram шлёт сюда POST-запрос на каждое
 * сообщение/команду в чате, где есть бот. Требует, чтобы скрипт был
 * опубликован как Web App (Deploy → New deployment → Web app) и
 * зарегистрирован через setupTelegramWebhook() — см. README, раздел
 * "Команды в Telegram".
 *
 * ВАЖНО: doPost намеренно НИЧЕГО не возвращает. Если вернуть
 * ContentService.createTextOutput(...), Apps Script отдаёт результат через
 * 302-редирект на script.googleusercontent.com, а Telegram по редиректам не
 * ходит и считает доставку проваленной ("Wrong response from the webhook:
 * 302 Found") — и переотправляет апдейт снова и снова. Пустой ответ Apps
 * Script отдаёт напрямую с кодом 200, что Telegram и нужно.
 */
function doPost(e) {
  try {
    handleTelegramUpdate(e);
  } catch (error) {
    Logger.log('❌ Ошибка в doPost: ' + error);
  }
  // намеренно без return — см. комментарий выше
}

/**
 * Обработка одного апдейта Telegram. Вынесена из doPost, чтобы возвращать
 * статус ('ok' / 'ignored' / 'error') для логов и локальных тестов,
 * не влияя на HTTP-ответ вебхука.
 */
function handleTelegramUpdate(e) {
  try {
    // Проверяем секрет. Apps Script doPost(e) НЕ даёт доступа к HTTP-заголовкам
    // (ограничение платформы), поэтому секрет — часть самого URL вебхука
    // (query-параметр ?secret=..., который setupTelegramWebhook() дописывает
    // сама). Отсекает посторонние запросы на публичный /exec-адрес.
    if (!e.parameter || e.parameter.secret !== TELEGRAM_WEBHOOK_SECRET) {
      Logger.log('⚠️ Отклонён запрос на вебхук с неверным secret');
      return 'ignored';
    }

    const update = JSON.parse(e.postData.contents);

    // Защита от повторной доставки. Telegram может прислать один и тот же
    // апдейт несколько раз — уже обработанные update_id пропускаем
    // (храним список последних, см. markUpdateProcessed).
    if (!markUpdateProcessed(update.update_id)) {
      Logger.log(`↩️ Повторная доставка update_id=${update.update_id} — пропускаю`);
      return 'ok';
    }

    if (update.callback_query) {
      return handleCallbackQuery(update.callback_query);
    }

    const message = update.message;
    if (!message || !message.text) {
      return 'ok';
    }

    // Личка с ботом — тихая отправка вопросов и заявок
    if (message.chat && message.chat.type === 'private') {
      handlePrivateMessage(message);
      return 'ok';
    }

    // Команды принимаем только из чата клуба
    if (String(message.chat.id) !== String(TELEGRAM_CHAT_ID)) {
      Logger.log(`⚠️ Команда из чужого чата (${message.chat.id}) проигнорирована`);
      return 'ignored';
    }

    handleGroupMessage(message);
    return 'ok';
  } catch (error) {
    Logger.log('❌ Ошибка при обработке апдейта: ' + error);
    return 'error';
  }
}

/**
 * Атомарно отметить update_id как обработанный.
 * Возвращает true, если это новый апдейт (обрабатываем), и false, если
 * такой (или более старый) уже был — то есть это повторная доставка.
 */
function markUpdateProcessed(updateId) {
  if (updateId === undefined || updateId === null) return true; // нет id — не мешаем

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    // Бот занят (например, tick закрывает этап). Молча выбросить команду
    // хуже, чем рискнуть редким дублем: обрабатываем, команда сама ответит
    // «попробуй ещё раз», если ей тоже понадобится блокировка.
    Logger.log('⚠️ Не удалось получить блокировку для проверки update_id — обрабатываю без проверки');
    return true;
  }

  try {
    // Храним список последних обработанных update_id (а не "максимум"):
    // так ни внеочередной, ни тестовый id не смогут заблокировать все
    // последующие настоящие апдейты.
    const props = PropertiesService.getScriptProperties();
    let recent = [];
    try {
      recent = JSON.parse(props.getProperty('recentTelegramUpdateIds') || '[]');
    } catch (err) {
      recent = [];
    }
    const id = String(updateId);
    if (recent.includes(id)) {
      return false;
    }
    recent.push(id);
    if (recent.length > 200) {
      recent = recent.slice(recent.length - 200);
    }
    props.setProperty('recentTelegramUpdateIds', JSON.stringify(recent));
    return true;
  } finally {
    lock.releaseLock();
  }
}

/**
 * ⚙️ НАСТРОЙКА ВЕБХУКА И МЕНЮ КОМАНД
 * Обычно запускается из setupBot(). Требует, чтобы скрипт был опубликован
 * как Web App (Deploy → New deployment → Web app, Execute as: Me,
 * Who has access: Anyone) и адрес .../exec был вписан в WEB_APP_URL в Config.gs.
 */
function setupTelegramWebhook(webAppUrl) {
  if (!webAppUrl) {
    webAppUrl = (typeof WEB_APP_URL === 'string') ? WEB_APP_URL : '';
  }
  if (!webAppUrl || webAppUrl.indexOf('script.google.com/macros/s/') === -1) {
    throw new Error('WEB_APP_URL не задан. Впиши в Config.gs адрес вида https://script.google.com/macros/s/.../exec из Deploy → Manage deployments.');
  }

  const separator = webAppUrl.includes('?') ? '&' : '?';
  const webhookUrlWithSecret = `${webAppUrl}${separator}secret=${encodeURIComponent(TELEGRAM_WEBHOOK_SECRET)}`;

  // Только сообщения и кнопки: без этого Telegram присылает вебхук на каждый
  // голос в опросах бота (лишние запуски скрипта и борьба за блокировку)
  const setWebhook = callTelegram('setWebhook', { url: webhookUrlWithSecret, allowed_updates: ['message', 'callback_query'] });
  Logger.log('setWebhook: ' + JSON.stringify(setWebhook));

  const setCommands = callTelegram('setMyCommands', {
    commands: [
      { command: 'status', description: 'Что сейчас и все даты цикла' },
      { command: 'guide', description: 'Как всё устроено — по шагам' },
      { command: 'start_cycle', description: 'Начать новый цикл выбора книги' },
      { command: 'suggest_book', description: 'Предложить книгу (до 2 на человека)' },
      { command: 'books', description: 'Заявки цикла' },
      { command: 'remove_book', description: 'Убрать свою заявку' },
      { command: 'question', description: 'Вопрос к встрече' },
      { command: 'questions', description: 'Вопросы к встрече' },
      { command: 'another_time', description: 'Сдвинуть выбор даты встречи на неделю' },
      { command: 'meeting_done', description: 'Встреча прошла — опрос-оценка книги' },
      { command: 'history', description: 'Что мы читали' },
      { command: 'stats', description: 'Статистика клуба' },
      { command: 'help', description: 'Все команды бота' }
    ]
  });
  Logger.log('setMyCommands: ' + JSON.stringify(setCommands));

  const setPrivateCommands = callTelegram('setMyCommands', {
    scope: { type: 'all_private_chats' },
    commands: [
      { command: 'question', description: 'Вопрос к встрече — без имени в списке' },
      { command: 'guide', description: 'Как всё устроено' },
      { command: 'suggest_book', description: 'Заявка на книгу' },
      { command: 'help', description: 'Что умеет бот' }
    ]
  });
  Logger.log('setMyCommands (личка): ' + JSON.stringify(setPrivateCommands));
}

// ==================== ОБНОВЛЕНИЕ БОТА ====================

/**
 * 🚀 ОБНОВИТЬ БОТА — запустить один раз после вставки нового кода
 * (и после Deploy → Manage deployments → New version).
 *
 * 1. Удаляет старые триггеры и ставит ежечасный tick() (двигает цикл).
 * 2. Перерегистрирует вебхук и меню команд Telegram.
 * 3. Чистит Script Properties от данных прошлых версий.
 * 4. Отправляет в чат анонс — один раз на ANNOUNCEMENT_ID.
 */
function setupBot(forceAnnouncement) {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    const handler = trigger.getHandlerFunction();
    if (OBSOLETE_TRIGGER_HANDLERS.includes(handler) || handler === 'tick') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  ScriptApp.newTrigger('tick').timeBased().everyHours(1).create();
  Logger.log('⏱ Триггер tick() — раз в час');

  setupTelegramWebhook();

  const props = PropertiesService.getScriptProperties();
  for (const key of OBSOLETE_PROPERTIES) {
    props.deleteProperty(key);
  }

  if (props.getProperty('announcementSent') === ANNOUNCEMENT_ID && forceAnnouncement !== true) {
    Logger.log('ℹ️ Анонс уже отправлялся — меню команд обновлено, анонс не повторяю. Повторить: resendAnnouncement()');
    return false;
  }

  const result = sendChatText(formatAnnouncement());
  if (result && result.ok) {
    props.setProperty('announcementSent', ANNOUNCEMENT_ID);
    Logger.log('✅ Анонс отправлен в чат клуба');
    return true;
  }
  Logger.log('❌ Анонс не отправлен — см. ошибку выше');
  return false;
}

/** 📣 Отправить анонс ещё раз */
function resendAnnouncement() {
  return setupBot(true);
}

function formatAnnouncement() {
  return '📚 Бот клуба: теперь у нас понятный цикл с датами\n\n' +
    'Каждая книга проходит одни и те же этапы, бот сам напоминает и двигает сроки:\n\n' +
    `1️⃣ Заявки (${daysText(CYCLE_SUBMIT_DAYS)}) — каждый предлагает до ${BOOKS_PER_MEMBER} ${pluralRu(BOOKS_PER_MEMBER, 'книги', 'книг', 'книг')}: /suggest_book название\n` +
    `2️⃣ Голосование (${daysText(CYCLE_VOTE_DAYS)}) — анонимный опрос из всех заявок\n` +
    `3️⃣ Дата встречи (${daysText(CYCLE_DATE_VOTE_DAYS)}) — опросы на выходные примерно через ${CYCLE_READING_WEEKS} ${pluralRu(CYCLE_READING_WEEKS, 'неделю', 'недели', 'недель')}\n` +
    '4️⃣ Чтение — копим вопросы к обсуждению (/question текст, в личку боту — анонимно). ' +
    'На полпути — короткий чекпоинт, за сутки — общий список вопросов, за 2 часа — регламент встречи\n' +
    '5️⃣ После встречи — анонимная оценка «Как вам книга?» от 1 до 5\n' +
    '6️⃣ Книга и оценка — в историю клуба: /history, /stats\n\n' +
    '🎙 На каждую встречу бот случайно выбирает ведущего.\n\n' +
    '👉 Начать первый цикл: /start_cycle\n' +
    'Что сейчас и все даты: /status · все команды: /help';
}

/**
 * 📋 МЕНЮ — добавляет кнопку в интерфейс Google Sheets
 * Вызывается автоматически при открытии таблицы
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📚 Книжный клуб')
    .addItem('🚀 Обновить бота (триггер, меню команд, анонс)', 'setupBot')
    .addItem('📣 Отправить анонс ещё раз', 'resendAnnouncement')
    .addItem('⏱ Проверить цикл сейчас', 'tick')
    .addSeparator()
    .addItem('🗑️ Удалить все триггеры', 'removeAllTriggers')
    .addToUi();
}

/**
 * 🗑️ УДАЛИТЬ ВСЕ ТРИГГЕРЫ
 */
function removeAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }
  Logger.log('✅ Все триггеры удалены');
}
