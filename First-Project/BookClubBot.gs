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
const BOT_VERSION = '2026.10.14-1';

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

// Опрос-оценка книги после встречи (порядок важен: первый вариант = 5)
const RATING_OPTIONS = ['5 — в восторге', '4 — понравилась', '3 — нормально', '2 — не зашла', '1 — совсем не моё'];

// Чекпоинт на полпути чтения
const CHECKPOINT_OPTIONS = ['Уже дочитал(а) 🎉', 'Больше половины', 'Меньше половины', 'Ещё не начал(а)'];

// Текстовые варианты «встреча прошла» (без слэша). Работают, только если у
// бота выключен Privacy Mode в @BotFather.
const MEETING_DONE_TEXT_TRIGGERS = ['встреча закончена', 'встреча прошла', 'встреча завершена'];

const USER_TEXT_MAX_LENGTH = 500;
const POLL_MAX_OPTIONS = 12; // лимит вариантов в Telegram Poll

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
const ANNOUNCEMENT_ID = 'cycles-1';

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
 * extra.chatId — написать не в чат клуба, а в личку участнику.
 */
function sendTelegramMessage(message, extra = {}) {
  return callTelegram('sendMessage', { chat_id: extra.chatId || TELEGRAM_CHAT_ID, text: message });
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
 * Закрыть опрос и получить итоги: массив голосов по вариантам
 * (в том же порядке). Если опрос не закрылся (удалили и т.п.) — нули.
 */
function stopPollCounts(messageId, optionsCount) {
  const zeros = new Array(optionsCount).fill(0);
  if (!messageId) return zeros;
  const result = callTelegram('stopPoll', { chat_id: TELEGRAM_CHAT_ID, message_id: messageId });
  const poll = result && result.ok ? result.result : null;
  if (!poll || !Array.isArray(poll.options)) return zeros;
  return zeros.map((z, i) => (poll.options[i] ? Number(poll.options[i].voter_count) || 0 : 0));
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
  if (!lock.tryLock(10000)) {
    Logger.log('⚠️ Не удалось получить блокировку — действие пропущено');
    return null;
  }
  try {
    return fn();
  } finally {
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

/** Срок этапа: 'вторник, 21 октября, 19:00' */
function formatDeadline(isoOrDate) {
  const d = new Date(isoOrDate);
  return `${formatDateRu(d)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length).setValues([values]);
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
  lines.push(`${mark('voting')} Голосование за книгу — ${cycle.voteUntil ? 'до ' + formatDeadline(cycle.voteUntil) : `${CYCLE_VOTE_DAYS} дня после заявок`}`);
  lines.push(`${mark('scheduling')} Выбор даты встречи — ${cycle.dateVoteUntil ? 'до ' + formatDeadline(cycle.dateVoteUntil) : `${CYCLE_DATE_VOTE_DAYS} дня после голосования`}`);
  lines.push(`${mark('reading')} Чтение и вопросы к встрече — ${cycle.meetingAt ? 'до встречи' : `около ${CYCLE_READING_WEEKS} недель`}`);
  lines.push(`${mark('rating')} Встреча и оценка книги — ${cycle.meetingAt ? formatMeeting(cycle.meetingAt) : 'выходные, дату выберем опросом'}`);
  return lines.join('\n');
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
  if (!created) return;
  if (created.busy) {
    sendChatText(`Уже идёт цикл #${created.busy.id} (${PHASE_TITLES[created.busy.phase]}). Подробности: /status`);
    return;
  }
  const c = created.cycle;
  sendChatText(
    `🚀 Цикл #${c.id} начался! Выбираем следующую общую книгу.\n\n` +
    `${formatTimeline(c)}\n\n` +
    `📥 Сейчас: предлагайте книги — до ${BOOKS_PER_MEMBER} от каждого:\n/suggest_book название\n` +
    'В личку боту — тоже можно. Список заявок: /books');
}

/** /suggest_book — заявка на книгу (только на этапе заявок, до BOOKS_PER_MEMBER от человека) */
function handleSuggestBookCommand(from, args, reply) {
  const cycle = getCycle();
  if (!cycle || cycle.phase !== 'submissions') {
    reply(isCycleActive(cycle)
      ? `Приём заявок в цикле #${cycle.id} уже закрыт. Что сейчас: /status`
      : 'Сейчас заявки не принимаются. Начать новый цикл выбора книги: /start_cycle');
    return;
  }
  const title = sanitizeUserText(args, 150);
  if (!title) {
    reply('Напиши название после команды: /suggest_book Мастер и Маргарита');
    return;
  }

  const result = withScriptLock(() => {
    const books = getCycleBooks(cycle.id);
    if (books.some(b => b.title.toLowerCase() === title.toLowerCase())) return { duplicate: true };
    const mine = books.filter(b => b.authorId === String(from.id));
    if (mine.length >= BOOKS_PER_MEMBER) return { limit: mine };
    appendDataRow(DATA_SHEETS.CYCLE_BOOKS, [cycle.id, new Date(), getAuthorName(from), String(from.id), title]);
    return { count: books.length + 1, mine: mine.length + 1 };
  });
  if (!result) return;
  if (result.duplicate) {
    reply(`📚 «${title}» уже есть в заявках.`);
  } else if (result.limit) {
    reply(`У тебя уже ${BOOKS_PER_MEMBER} заявки: ${result.limit.map(b => '«' + b.title + '»').join(', ')}. Заменить: /remove_book номер (номера — в /books)`);
  } else {
    reply(`📚 «${title}» — в заявках (твоих: ${result.mine} из ${BOOKS_PER_MEMBER}, всего: ${result.count}). Голосование — после ${formatDeadline(cycle.submitUntil)}.`);
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
    `🗳 Заявки собраны — ${books.length} ${pluralRu(books.length, 'книга', 'книги', 'книг')}! Голосуем до ${formatDeadline(cycle.voteUntil)}.\n` +
    'Можно выбрать несколько книг. Голосование анонимное.' +
    (chunks > 1 ? `\nКниг много, поэтому опросов ${chunks} — голосуйте в каждом.` : ''));

  for (let c = 0; c < chunks; c++) {
    const indexes = [];
    for (let i = c * size; i < Math.min(books.length, (c + 1) * size); i++) indexes.push(i);
    const question = `📚 Цикл #${cycle.id}: какую книгу читаем?` + (chunks > 1 ? ` (опрос ${c + 1} из ${chunks})` : '');
    const messageId = sendPoll(question, indexes.map(i => books[i].title), { multiple: true, anonymous: true });
    cycle.votePolls.push({ messageId: messageId, candidates: indexes });
  }
}

// ==================== ЭТАП 2: ГОЛОСОВАНИЕ ====================

/** Конец голосования: закрываем опросы, считаем голоса, ничья — жребий */
function closeVoting(cycle) {
  const votes = cycle.candidates.map(() => 0);
  for (const poll of cycle.votePolls || []) {
    const counts = stopPollCounts(poll.messageId, poll.candidates.length);
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
  text += `\n🎙 Ведущий встречи: ${cycle.moderator} — готовит вопросы и следит за регламентом.`;
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

  const tail = `Какое время подходит? Время — ${MEETING_TIMEZONE_LABEL}. Можно выбрать несколько.`;
  cycle.datePolls = [saturday, sunday].map(day => ({
    date: day.toISOString(),
    messageId: sendPoll(`📅 Встреча по «${cycle.book.title}» — ${formatDateRu(day)}. ${tail}`, MEETING_TIME_SLOTS, { multiple: true })
  }));
  sendChatText(`📅 Выбираем время встречи — голосуйте в опросах выше до ${formatDeadline(cycle.dateVoteUntil)}.\nНе подходят эти выходные — /another_time (сдвинуть на неделю).`);
}

/** Конец выбора даты: слот с наибольшим числом голосов (при равенстве — более ранний) */
function closeScheduling(cycle) {
  let best = { votes: 0, iso: null };
  for (const poll of cycle.datePolls || []) {
    const counts = stopPollCounts(poll.messageId, MEETING_TIME_SLOTS.length);
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
  cycle.meetingAt = iso;
  cycle.phase = 'reading';
  const now = Date.now();
  cycle.checkpointAt = new Date(now + (new Date(iso).getTime() - now) / 2).toISOString();
  cycle.sent = {};
  sendChatText(
    `📌 Встреча по «${cycle.book.title}» — ${formatMeeting(iso)}` +
    (fallback ? '\n(за время никто не проголосовал — ставим субботу, ' + DEFAULT_MEETING_SLOT + ')' : '') +
    `\n🎙 Ведущий: ${cycle.moderator}\n\n` +
    '📖 Читаем! По дороге записывайте вопросы к обсуждению:\n/question текст (в личку боту — анонимно)\n' +
    'За сутки до встречи бот соберёт их в общий список. Всё расписание: /status');
}

// ==================== ЭТАП 4: ЧТЕНИЕ И ВСТРЕЧА ====================

function handleQuestionCommand(from, args, reply, anonymous) {
  const cycle = getCycle();
  if (!cycle || !cycle.book || !['scheduling', 'reading'].includes(cycle.phase)) {
    reply('Вопросы к встрече принимаются, когда книга цикла уже выбрана. Что сейчас: /status');
    return;
  }
  const text = sanitizeUserText(args);
  if (!text) {
    reply('Напиши вопрос после команды: /question Почему герой так поступил в финале?');
    return;
  }
  withScriptLock(() => appendDataRow(DATA_SHEETS.QUESTIONS,
    [cycle.id, cycle.book.title, new Date(), anonymous ? 'аноним' : getAuthorName(from), text]));
  const count = getCycleQuestions(cycle.id).length;
  reply(`❓ Вопрос к встрече по «${cycle.book.title}» сохранён (всего: ${count}). Список: /questions`);
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
  sendPoll(`📖 Полпути до встречи по «${cycle.book.title}»! Как продвигается чтение?`, CHECKPOINT_OPTIONS, { anonymous: true });
}

function sendQuestionsReminder(cycle) {
  const questions = getCycleQuestions(cycle.id);
  const url = getSpreadsheetUrl();
  let text = `⏰ Завтра встреча по «${cycle.book.title}» — ${formatMeeting(cycle.meetingAt)}\n🎙 Ведущий: ${cycle.moderator}\n\n`;
  text += questions.length > 0
    ? `❓ Вопросы к обсуждению (${questions.length}):\n\n${formatQuestionsList(questions)}`
    : '❓ Вопросов пока нет — самое время добавить: /question текст\n';
  if (url) text += `\nВсе вопросы — в таблице, лист «${DATA_SHEETS.QUESTIONS.name}»: ${url}`;
  sendChatText(text);
}

function sendAgenda(cycle) {
  let text = `📋 Через ${AGENDA_REMINDER_HOURS} ${pluralRu(AGENDA_REMINDER_HOURS, 'час', 'часа', 'часов')} встреча по «${cycle.book.title}»!\n🎙 Ведущий: ${cycle.moderator}\n\nРегламент:\n`;
  MEETING_AGENDA.forEach((item, i) => { text += `${i + 1}. ${item}\n`; });
  text += '\nСписок вопросов: /questions';
  sendChatText(text);
}

// ==================== ЭТАП 5: ОЦЕНКА ====================

function startRating(cycle) {
  cycle.phase = 'rating';
  cycle.rateUntil = deadlineAfterDays(new Date(), CYCLE_RATING_DAYS).toISOString();
  cycle.sent = {};
  cycle.ratingPoll = sendPoll(`⭐ Как вам «${cycle.book.title}»?`, RATING_OPTIONS, { anonymous: true });
  sendChatText(`Спасибо за встречу! 🙌 Оцените книгу в опросе выше — он открыт до ${formatDeadline(cycle.rateUntil)}. Анонимно.`);
}

/** /meeting_done — встреча прошла раньше, чем бот прислал оценку сам */
function handleMeetingDoneCommand() {
  const done = withScriptLock(() => {
    const cycle = getCycle();
    if (!cycle || cycle.phase !== 'reading') return { cycle: cycle };
    if (Date.now() < new Date(cycle.meetingAt).getTime() - 12 * 60 * 60 * 1000) return { early: cycle };
    startRating(cycle);
    saveCycle(cycle);
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
  const counts = stopPollCounts(cycle.ratingPoll, RATING_OPTIONS.length);
  const total = counts.reduce((s, v) => s + v, 0);
  const sum = counts.reduce((s, v, i) => s + v * (5 - i), 0);
  const avg = total > 0 ? Math.round((sum / total) * 10) / 10 : '';
  const questions = getCycleQuestions(cycle.id).length;

  appendDataRow(DATA_SHEETS.HISTORY, [cycle.id, cycle.book.title, cycle.book.by, cycle.book.votes,
    new Date(cycle.meetingAt), avg, total, questions, cycle.moderator || '']);
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
    advanceCycle(cycle, false);
    saveCycle(cycle);
  });
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
  let text = `📚 Цикл #${cycle.id}` + (cycle.book ? ` — «${cycle.book.title}»` : '') + `\nСейчас: ${PHASE_TITLES[cycle.phase]}\n\n`;
  text += formatTimeline(cycle);
  if (cycle.moderator && cycle.phase !== 'done') text += `\n\n🎙 Ведущий встречи: ${cycle.moderator}`;
  const hints = {
    submissions: '\n\n👉 Предложить книгу: /suggest_book название · заявки: /books',
    voting: '\n\n👉 Голосуйте в опросе выше',
    scheduling: '\n\n👉 Голосуйте за время в опросах выше · не подходят выходные: /another_time',
    reading: '\n\n👉 Вопрос к встрече: /question текст · список: /questions',
    rating: '\n\n👉 Оцените книгу в опросе выше',
    done: '\n\n👉 Следующая книга: /start_cycle'
  };
  text += hints[cycle.phase] || '';
  sendChatText(text);
}

/** /another_time — на этапе выбора даты: те же опросы на неделю позже */
function handleAnotherTimeCommand() {
  const moved = withScriptLock(() => {
    const cycle = getCycle();
    if (!cycle || cycle.phase !== 'scheduling') return false;
    for (const poll of cycle.datePolls || []) {
      if (poll.messageId) callTelegram('stopPoll', { chat_id: TELEGRAM_CHAT_ID, message_id: poll.messageId });
    }
    startScheduling(cycle, addDays(new Date(cycle.datePolls[0].date), 7));
    saveCycle(cycle);
    return true;
  });
  if (moved === false) {
    sendChatText('Сдвинуть дату можно, пока идёт выбор даты встречи. Что сейчас: /status');
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
      advanceCycle(cycle, true);
      saveCycle(cycle);
      return null;
    }
    if (command === 'cancel_cycle') {
      for (const poll of (cycle.votePolls || []).concat(cycle.datePolls || [])) {
        if (poll.messageId) callTelegram('stopPoll', { chat_id: TELEGRAM_CHAT_ID, message_id: poll.messageId });
      }
      cycle.phase = 'done';
      cycle.cancelled = true;
      saveCycle(cycle);
      return `Цикл #${cycle.id} отменён. Новый: /start_cycle`;
    }
    if (command === 'set_meeting') {
      if (!cycle.book) return 'Сначала нужно выбрать книгу.';
      const m = String(args).match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2}):(\d{2})$/);
      if (!m) return `Формат: /set_meeting 22.11 12:00 (время — ${MEETING_TIMEZONE_LABEL})`;
      const now = new Date();
      let year = m[3] ? Number(m[3]) : now.getFullYear();
      let iso = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]))).toISOString();
      if (!m[3] && new Date(iso).getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
        iso = new Date(Date.UTC(year + 1, Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]))).toISOString();
      }
      for (const poll of cycle.datePolls || []) {
        if (poll.messageId && cycle.phase === 'scheduling') callTelegram('stopPoll', { chat_id: TELEGRAM_CHAT_ID, message_id: poll.messageId });
      }
      setMeeting(cycle, iso, false);
      saveCycle(cycle);
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
  return '📚 Команды книжного клуба\n\n' +
    'Цикл выбора книги:\n' +
    '/start_cycle — начать новый цикл\n' +
    '/status — что сейчас и все даты цикла\n' +
    `/suggest_book название — предложить книгу (до ${BOOKS_PER_MEMBER} на человека)\n` +
    '/books — заявки цикла\n' +
    '/remove_book номер — убрать свою заявку\n\n' +
    'Встреча:\n' +
    '/question текст — вопрос к встрече (в личку боту — анонимно)\n' +
    '/questions — вопросы к встрече\n' +
    '/another_time — сдвинуть выбор даты на неделю\n' +
    '/meeting_done — встреча прошла: сразу опрос-оценка\n\n' +
    'История:\n' +
    '/history — что мы читали\n' +
    '/stats — оценки, топ книг, чьи книги нравятся больше\n\n' +
    'Для админов: /skip — следующий этап сейчас, /set_meeting ДД.ММ ЧЧ:ММ, /cancel_cycle\n' +
    '/bot_version — версия бота';
}

function privateHelpText() {
  return '🤫 Здесь можно тихо, без сообщения в общем чате:\n\n' +
    '/question текст — вопрос к встрече (в списке — без имени)\n' +
    `/suggest_book название — заявка на книгу (до ${BOOKS_PER_MEMBER} на человека)\n\n` +
    'Остальные команды — в чате клуба, список: /help';
}

function handleGroupMessage(message) {
  const text = message.text.trim();
  const textLower = text.toLowerCase();
  const from = message.from || {};
  const cmd = parseCommand(text);
  const reply = (t) => sendChatText(t);

  if ((cmd && cmd.command === 'meeting_done') || MEETING_DONE_TEXT_TRIGGERS.some(t => textLower.startsWith(t))) {
    handleMeetingDoneCommand();
    return;
  }
  if (!cmd) return;

  switch (cmd.command) {
    case 'start_cycle':
    case 'start_process': handleStartCycleCommand(); break;
    case 'status': handleStatusCommand(); break;
    case 'suggest_book': handleSuggestBookCommand(from, cmd.args, reply); break;
    case 'remove_book': handleRemoveBookCommand(from, cmd.args, reply); break;
    case 'books': handleBooksListCommand(); break;
    case 'question': handleQuestionCommand(from, cmd.args, reply, false); break;
    case 'questions': handleQuestionsListCommand(); break;
    case 'another_time': handleAnotherTimeCommand(); break;
    case 'history': handleHistoryCommand(); break;
    case 'stats': handleStatsCommand(); break;
    case 'skip':
    case 'cancel_cycle':
    case 'set_meeting': handleAdminCommand(cmd.command, from, cmd.args); break;
    case 'help': sendChatText(groupHelpText()); break;
    case 'bot_version': sendChatText(`🤖 Бот книжного клуба, версия ${BOT_VERSION}\nВсе команды: /help`); break;
    default:
      if (RETIRED_COMMANDS.includes(cmd.command)) {
        sendChatText('Эта команда больше не работает. Все команды: /help');
      }
      break;
  }
}

function handlePrivateMessage(message) {
  const chatId = message.chat.id;
  const from = message.from || {};
  const cmd = parseCommand(message.text.trim());
  const reply = (t) => sendPrivateText(chatId, t);

  if (!cmd || !['question', 'suggest_book'].includes(cmd.command)) {
    reply(privateHelpText());
    return;
  }
  // В личку может написать кто угодно — принимаем только участников чата клуба
  if (!isClubMember(from.id)) {
    reply('Эта команда — только для участников книжного клуба.');
    return;
  }
  if (cmd.command === 'question') handleQuestionCommand(from, cmd.args, reply, true);
  else handleSuggestBookCommand(from, cmd.args, reply);
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
  if (!lock.tryLock(10000)) {
    Logger.log('⚠️ Не удалось получить блокировку для проверки update_id — считаю повтором');
    return false;
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

  const setWebhook = callTelegram('setWebhook', { url: webhookUrlWithSecret });
  Logger.log('setWebhook: ' + JSON.stringify(setWebhook));

  const setCommands = callTelegram('setMyCommands', {
    commands: [
      { command: 'status', description: 'Что сейчас и все даты цикла' },
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
    `1️⃣ Заявки (${CYCLE_SUBMIT_DAYS} дней) — каждый предлагает до ${BOOKS_PER_MEMBER} книг: /suggest_book название\n` +
    `2️⃣ Голосование (${CYCLE_VOTE_DAYS} дня) — анонимный опрос из всех заявок\n` +
    `3️⃣ Дата встречи (${CYCLE_DATE_VOTE_DAYS} дня) — опросы на выходные примерно через ${CYCLE_READING_WEEKS} недель\n` +
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
