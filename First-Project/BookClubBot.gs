// ==================== НАСТРОЙКИ ====================
//
// Бот книжного клуба: помогает выбрать следующую общую книгу, копить
// вопросы к встрече и договориться о дате встречи. Работает только через
// команды в Telegram — никаких ежедневных отчётов и отметок чтения.
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
const BOT_VERSION = '2026.10.04-1';

// Настройки предложения даты следующей офлайн-встречи клуба (команды /meeting_done, /another_time)
const MEETING_INTERVAL_WEEKS = 6; // базовый интервал между встречами
// На команду уходят ДВА опроса — отдельно на субботу и отдельно на воскресенье.
// В каждом — 12 слотов (текущий максимум вариантов в Telegram Poll),
// по часу с утра. Время — в MEETING_TIMEZONE_LABEL, это пишется в вопросе.
// Правится под привычки клуба.
const MEETING_TIME_SLOTS = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
                            '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
const MEETING_TIMEZONE_LABEL = 'UTC+0';
// Защита от дублей: если команду /meeting_done или /another_time уже
// обработали недавно — новую не обрабатываем (случайное повторное нажатие,
// несколько человек нажали одновременно и т.п.)
const MEETING_COMMAND_COOLDOWN_MS = 2 * 60 * 1000; // 2 минуты
// Текстовые варианты команды «встреча прошла» (без слэша). Работают, только
// если у бота выключен Privacy Mode в @BotFather — иначе Telegram не отдаёт
// боту обычные сообщения из группы, только /команды.
const MEETING_DONE_TEXT_TRIGGERS = ['встреча закончена', 'встреча прошла', 'встреча завершена'];

// Пользовательский текст (вопросы, названия книг)
const USER_TEXT_MAX_LENGTH = 500;
// Голосование за следующую книгу — до 10 вариантов в одном опросе
const BOOK_VOTE_MAX_OPTIONS = 10;

// Данные хранятся на скрытых служебных листах таблицы, к которой
// привязан скрипт (создаются сами при первой записи). Структуру таблицы
// клуба бот больше не читает.
const DATA_SHEETS = {
  QUESTIONS: { name: 'Questions', headers: ['Дата', 'Автор', 'Книга', 'Вопрос', 'В архиве'] },
  SUGGESTIONS: { name: 'BookSuggestions', headers: ['Дата', 'Автор', 'Книга', 'Статус'] }
};

// Команды, которые были в прошлых версиях бота и больше не работают —
// на них бот вежливо отвечает, а не молчит
const RETIRED_COMMANDS = ['iam', 'quote', 'duel', 'anon', 'anon_all', 'my_target'];

// Ключи Script Properties прошлых версий — setupBot() их удаляет
const OBSOLETE_PROPERTIES = ['telegramMembers', 'duels', 'duelWins', 'secretPartners', 'anonStats',
  'anonDailyCounts', 'ceremonyDoneFor', 'firstFinishAnnounced', 'gameAnnouncementSent'];

// Функции старых триггеров (ежедневный отчёт) — setupBot() их удаляет
const OBSOLETE_TRIGGER_HANDLERS = ['sendWeeklyReport', 'createNextSprint'];

// ==================== TELEGRAM ====================

/**
 * Отправить сообщение в Telegram. По умолчанию — простым текстом
 * (в /командах подчёркивания, Markdown их ломает).
 * extra.chatId — написать не в чат клуба, а в личку участнику.
 */
function sendTelegramMessage(message, parseMode = null, extra = {}) {
  const payload = {
    chat_id: extra.chatId || TELEGRAM_CHAT_ID,
    text: message
  };
  if (parseMode) {
    payload.parse_mode = parseMode;
  }
  return callTelegram('sendMessage', payload);
}

/**
 * Отправить нативный Telegram Poll (опрос) — используется для выбора
 * даты/времени следующей встречи клуба (см. секцию "ВСТРЕЧИ КЛУБА")
 */
function sendTelegramPoll(question, options, extra = {}) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPoll`;

  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    question: question,
    options: options,
    is_anonymous: false,
    // по умолчанию мультивыбор (опросы встречи); голосование за книгу — один вариант
    allows_multiple_answers: extra.allowsMultipleAnswers !== false
  };

  const requestOptions = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, requestOptions);
    const result = JSON.parse(response.getContentText());

    if (result.ok) {
      Logger.log('✅ Опрос отправлен!');
    } else {
      Logger.log('❌ Ошибка Telegram (sendPoll): ' + result.description);
    }

    return result;
  } catch (error) {
    Logger.log('❌ Ошибка: ' + error);
    throw error;
  }
}

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

/** Короткий ответ в чат клуба */
function sendChatText(text) {
  return sendTelegramMessage(text);
}

/** Сообщение в личку участнику */
function sendPrivateText(chatId, text) {
  return sendTelegramMessage(text, null, { chatId: chatId });
}

/**
 * Состоит ли пользователь в чате клуба — чтобы в личке бота
 * не мог писать кто угодно.
 */
function isClubMember(userId) {
  if (userId === undefined || userId === null) return false;
  const result = callTelegram('getChatMember', { chat_id: TELEGRAM_CHAT_ID, user_id: userId });
  const status = result && result.ok && result.result ? result.result.status : '';
  return ['creator', 'administrator', 'member', 'restricted'].includes(status);
}

// ==================== ОБЩИЕ ХЕЛПЕРЫ ====================

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

/** Имя автора для вопросов и книг — имя в Telegram */
function getAuthorName(from) {
  const name = sanitizeUserText(from && from.first_name, 50);
  return name || 'Участник клуба';
}

// ---------- Скрытые листы с данными ----------

function getOrCreateDataSheet(def) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(def.name);
  if (!sheet) {
    sheet = ss.insertSheet(def.name);
    sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
    sheet.hideSheet();
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

function appendDataRow(def, values) {
  // Под блокировкой — чтобы две одновременные команды не записали в одну строку
  const ok = withScriptLock(() => {
    const sheet = getOrCreateDataSheet(def);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length).setValues([values]);
    return true;
  });
  if (!ok) throw new Error('Не удалось сохранить — таблица занята');
}

function setDataCell(def, row, column, value) {
  getOrCreateDataSheet(def).getRange(row, column).setValue(value);
}

// ==================== ВСТРЕЧИ КЛУБА ====================

/**
 * Найти ближайшую субботу на дату targetDate или после неё,
 * и воскресенье сразу за ней.
 */
function getUpcomingWeekend(targetDate) {
  const date = new Date(targetDate.getTime());
  date.setHours(0, 0, 0, 0);

  // getDay(): 0 = вс, 6 = сб. Считаем, сколько дней до ближайшей субботы.
  const daysUntilSaturday = (6 - date.getDay() + 7) % 7;
  const saturday = new Date(date.getTime() + daysUntilSaturday * 24 * 60 * 60 * 1000);
  const sunday = new Date(saturday.getTime() + 24 * 60 * 60 * 1000);

  return { saturday, sunday };
}

/**
 * Дата в формате "суббота, 17 октября" для вопроса опроса
 */
function formatDateRu(date) {
  const weekdays = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${weekdays[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]}`;
}

/**
 * Отправить ДВА опроса (суббота и воскресенье ближайших к targetDate
 * выходных), в каждом — все MEETING_TIME_SLOTS с мультивыбором.
 * Запоминает предложенную субботу в PropertiesService (без листов —
 * это встроенное хранилище ключ-значение Apps Script), чтобы
 * /another_time знал, от чего отсчитывать следующую неделю.
 */
function proposeMeetingPolls(targetDate) {
  // LockService делает проверку и запись cooldown атомарными — иначе
  // несколько параллельных doPost могли одновременно пройти проверку
  // "не рано ли" и все разом отправить свои опросы.
  const lock = LockService.getScriptLock();
  const gotLock = lock.tryLock(10000);
  if (!gotLock) {
    Logger.log('⚠️ Не удалось получить блокировку для отправки опросов — пропускаю');
    return false;
  }

  try {
    const props = PropertiesService.getScriptProperties();

    const lastCommandAt = Number(props.getProperty('lastMeetingCommandAt') || 0);
    if (Date.now() - lastCommandAt < MEETING_COMMAND_COOLDOWN_MS) {
      Logger.log('⚠️ Команда встречи проигнорирована — слишком рано после предыдущей (защита от дублей)');
      return false;
    }
    props.setProperty('lastMeetingCommandAt', String(Date.now()));

    const { saturday, sunday } = getUpcomingWeekend(targetDate);

    const questionTail = `Какое время подходит? Время — ${MEETING_TIMEZONE_LABEL}. Можно выбрать несколько.`;
    sendTelegramPoll(`📅 Встреча клуба — ${formatDateRu(saturday)}. ${questionTail}`, MEETING_TIME_SLOTS);
    sendTelegramPoll(`📅 Встреча клуба — ${formatDateRu(sunday)}. ${questionTail}`, MEETING_TIME_SLOTS);

    props.setProperty('lastProposedMeetingDate', saturday.toISOString());

    Logger.log(`📅 Предложены даты встречи: ${formatDateRu(saturday)} / ${formatDateRu(sunday)}`);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Команда /meeting_done (или текст «встреча закончена») — встреча прошла:
 * 1. предложить даты следующей через MEETING_INTERVAL_WEEKS недель;
 * 2. отправить вопросы прошедшей встречи в архив — копим заново;
 * 3. запустить голосование за следующую общую книгу (если есть 2+ кандидата).
 * Шаги 2–3 — только если опросы реально ушли (не сработала защита от дублей).
 */
function handleMeetingDoneCommand() {
  const targetDate = new Date(Date.now() + MEETING_INTERVAL_WEEKS * 7 * 24 * 60 * 60 * 1000);
  const proposed = proposeMeetingPolls(targetDate);
  if (!proposed) return false;

  let archived = 0;
  try {
    archived = archiveQuestions();
  } catch (error) {
    Logger.log('⚠️ Ошибка при архивации вопросов: ' + error);
  }

  const candidates = getOpenBookSuggestions().length;
  let text = '📚 Встреча прошла — спасибо всем! Выше — опросы про дату следующей.\n\n';
  text += candidates >= 2
    ? '📖 Ниже — голосование за следующую общую книгу 👇\n'
    : '📖 Предлагайте следующую общую книгу: /suggest_book название — потом проголосуем (/book_vote).\n';
  if (archived > 0) {
    text += `❓ Вопросы к прошедшей встрече (${archived}) ушли в архив. К следующей копим заново: /question текст`;
  } else {
    text += '❓ Вопросы к следующей встрече: /question текст';
  }
  sendChatText(text);

  if (candidates >= 2) {
    try {
      launchBookVote();
    } catch (error) {
      Logger.log('⚠️ Ошибка при запуске голосования за книгу: ' + error);
    }
  }
  return true;
}

/**
 * Команда /another_time — «предложенное время не подходит»: сдвинуть
 * предложение на неделю вперёд от последней предложенной субботы.
 * Если предыдущего предложения нет (например, после установки скрипта) —
 * отсчитываем от сегодня, чтобы команда не падала с ошибкой.
 */
function handleAnotherTimeCommand() {
  const lastProposed = PropertiesService.getScriptProperties().getProperty('lastProposedMeetingDate');
  const baseDate = lastProposed ? new Date(lastProposed) : new Date();
  const targetDate = new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  return proposeMeetingPolls(targetDate);
}

/**
 * Команда /bot_version — ответить в чат версией задеплоенного кода.
 * Нужна, чтобы после обновления за 5 секунд убедиться, что в Apps Script
 * реально работает новая версия, а не старая.
 */
function handleBotVersionCommand() {
  sendChatText(`🤖 Бот книжного клуба, версия ${BOT_VERSION}\nВсе команды: /help`);
}

// ==================== СЛЕДУЮЩАЯ КНИГА ====================

function getOpenBookSuggestions() {
  return readDataRows(DATA_SHEETS.SUGGESTIONS)
    .filter(r => r.values[3] === 'open' && String(r.values[2]).trim());
}

/** /suggest_book название — добавить книгу в кандидаты (дубли отсекаются) */
function handleSuggestBookCommand(author, args, reply) {
  const title = sanitizeUserText(args, 150);
  if (!title) {
    reply('Напиши название после команды: /suggest_book Мастер и Маргарита');
    return;
  }
  const open = getOpenBookSuggestions();
  if (open.some(r => String(r.values[2]).toLowerCase() === title.toLowerCase())) {
    reply(`📚 «${title}» уже есть в списке кандидатов.`);
    return;
  }
  appendDataRow(DATA_SHEETS.SUGGESTIONS, [new Date(), author, title, 'open']);
  reply(`📚 «${title}» — в кандидатах на следующую общую книгу (всего: ${open.length + 1}). Список: /books`);
}

/** /books — список кандидатов */
function handleBooksListCommand() {
  const open = getOpenBookSuggestions();
  if (open.length === 0) {
    sendChatText('Кандидатов на следующую книгу пока нет. Предложить: /suggest_book название');
    return;
  }
  let text = '📚 Кандидаты на следующую общую книгу:\n\n';
  open.forEach((r, i) => {
    const line = `${i + 1}. ${r.values[2]} (от ${r.values[1]})\n`;
    if (text.length + line.length < 3500) text += line;
  });
  text += open.length >= 2
    ? '\nЗапустить голосование: /book_vote'
    : '\nДля голосования нужен ещё хотя бы один кандидат: /suggest_book название';
  sendChatText(text);
}

/**
 * Запустить опрос «какую книгу читаем следующей» из открытых предложений.
 * Возвращает { launched, count }. Попавшие в опрос книги помечаются
 * 'voted' и в следующий опрос не попадают.
 */
function launchBookVote() {
  const open = getOpenBookSuggestions();
  if (open.length < 2) return { launched: false, count: open.length };

  const chosen = open.slice(0, BOOK_VOTE_MAX_OPTIONS);
  const options = chosen.map(r => truncateText(`${r.values[2]} (от ${r.values[1]})`, 100));
  const result = sendTelegramPoll('📚 Какую книгу читаем следующей общей?', options, { allowsMultipleAnswers: false });

  if (result && result.ok) {
    for (const r of chosen) setDataCell(DATA_SHEETS.SUGGESTIONS, r.row, 4, 'voted');
    return { launched: true, count: chosen.length };
  }
  return { launched: false, count: open.length };
}

function handleBookVoteCommand() {
  const result = launchBookVote();
  if (!result.launched) {
    sendChatText(`Для голосования нужно минимум 2 кандидата, сейчас: ${result.count}. Предлагайте: /suggest_book название`);
  }
}

// ==================== ВОПРОСЫ К ВСТРЕЧЕ ====================
//
// /question текст — вопрос к следующей встрече (в личке боту — никто не
// узнает автора). /questions — список. /meeting_done отправляет вопросы
// прошедшей встречи в архив.

function getActiveQuestions() {
  return readDataRows(DATA_SHEETS.QUESTIONS)
    .filter(r => r.values[4] !== true && String(r.values[3]).trim());
}

function handleQuestionCommand(author, args, reply) {
  const text = sanitizeUserText(args);
  if (!text) {
    reply('Напиши вопрос после команды: /question Почему герой так поступил в финале?');
    return;
  }
  appendDataRow(DATA_SHEETS.QUESTIONS, [new Date(), author, '', text, false]);
  const count = getActiveQuestions().length;
  reply(`❓ Вопрос к встрече сохранён (всего: ${count}). Список без имён: /questions`);
}

function handleQuestionsListCommand() {
  const rows = getActiveQuestions();
  if (rows.length === 0) {
    sendChatText('Вопросов к встрече пока нет. Добавить: /question текст (или в личку боту — анонимно)');
    return;
  }
  let text = '❓ Вопросы к встрече:\n\n';
  rows.forEach((r, i) => {
    const line = `${i + 1}. ${r.values[3]}\n`;
    if (text.length + line.length < 3500) text += line;
  });
  text += '\nДобавить ещё: /question текст';
  sendChatText(text);
}

/** Отправить текущие вопросы в архив. Возвращает, сколько их было. */
function archiveQuestions() {
  const rows = getActiveQuestions();
  for (const r of rows) setDataCell(DATA_SHEETS.QUESTIONS, r.row, 5, true);
  return rows.length;
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
    'Следующая книга:\n' +
    '/suggest_book название — предложить книгу\n' +
    '/books — список кандидатов\n' +
    '/book_vote — голосование за следующую общую книгу\n\n' +
    'Встреча:\n' +
    '/question текст — вопрос к встрече (в личку боту — анонимно)\n' +
    '/questions — вопросы к встрече\n' +
    '/meeting_done — встреча прошла: даты следующей + выбор книги\n' +
    '/another_time — сдвинуть даты встречи на неделю\n\n' +
    '/bot_version — версия бота';
}

function privateHelpText() {
  return '🤫 Здесь можно тихо, без сообщения в общем чате:\n\n' +
    '/question текст — вопрос к встрече (в списке он будет без имени)\n' +
    '/suggest_book название — предложить следующую общую книгу\n\n' +
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
    case 'another_time': handleAnotherTimeCommand(); break;
    case 'bot_version': handleBotVersionCommand(); break;
    case 'help': sendChatText(groupHelpText()); break;
    case 'suggest_book': handleSuggestBookCommand(getAuthorName(from), cmd.args, reply); break;
    case 'books': handleBooksListCommand(); break;
    case 'book_vote': handleBookVoteCommand(); break;
    case 'question': handleQuestionCommand(getAuthorName(from), cmd.args, reply); break;
    case 'questions': handleQuestionsListCommand(); break;
    default:
      if (RETIRED_COMMANDS.includes(cmd.command)) {
        sendChatText('Эта функция больше не работает — бот стал проще. Все команды: /help');
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
  if (cmd.command === 'question') handleQuestionCommand(getAuthorName(from), cmd.args, reply);
  else handleSuggestBookCommand(getAuthorName(from), cmd.args, reply);
}

/**
 * Нажатия на inline-кнопки. Своих кнопок у бота сейчас нет — это могут
 * быть только старые кнопки дуэлей в истории чата.
 */
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

    // Личка с ботом — тихая отправка вопросов и книг
    if (message.chat && message.chat.type === 'private') {
      handlePrivateMessage(message);
      return 'ok';
    }

    // Команды принимаем только из чата клуба — не реагируем на
    // сообщения из чужих групп
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
 *
 * Можно запускать прямо из выпадающего списка функций, без аргументов —
 * адрес берётся из WEB_APP_URL. Функция сама дописывает ?secret=...
 * из TELEGRAM_WEBHOOK_SECRET.
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
      { command: 'suggest_book', description: 'Предложить следующую общую книгу' },
      { command: 'books', description: 'Кандидаты на следующую книгу' },
      { command: 'book_vote', description: 'Голосование за следующую общую книгу' },
      { command: 'question', description: 'Вопрос к встрече' },
      { command: 'questions', description: 'Вопросы к встрече' },
      { command: 'meeting_done', description: 'Встреча прошла — даты следующей и выбор книги' },
      { command: 'another_time', description: 'Предложенное время не подходит — сдвинуть на неделю' },
      { command: 'help', description: 'Все команды бота' },
      { command: 'bot_version', description: 'Какая версия бота сейчас работает' }
    ]
  });
  Logger.log('setMyCommands: ' + JSON.stringify(setCommands));

  // Меню в личке с ботом (заменяет старое меню с анонимками)
  const setPrivateCommands = callTelegram('setMyCommands', {
    scope: { type: 'all_private_chats' },
    commands: [
      { command: 'question', description: 'Вопрос к встрече — без имени в списке' },
      { command: 'suggest_book', description: 'Предложить следующую общую книгу' },
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
 * 1. Удаляет старый ежедневный триггер отчёта (иначе он будет падать
 *    каждый день — функции отчёта больше нет).
 * 2. Перерегистрирует вебхук и меню команд Telegram.
 * 3. Чистит Script Properties от данных прошлых версий
 *    (дуэли, тайные напарники и т.п.).
 * 4. Отправляет в чат анонс — один раз. Повторно: resendAnnouncement().
 */
function setupBot(forceAnnouncement) {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (OBSOLETE_TRIGGER_HANDLERS.includes(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger);
      Logger.log(`🗑️ Удалён старый триггер ${trigger.getHandlerFunction()}`);
    }
  }

  setupTelegramWebhook();

  const props = PropertiesService.getScriptProperties();
  for (const key of OBSOLETE_PROPERTIES) {
    props.deleteProperty(key);
  }

  if (props.getProperty('slimAnnouncementSent') && forceAnnouncement !== true) {
    Logger.log('ℹ️ Анонс уже отправлялся — меню команд обновлено, анонс не повторяю. Повторить: resendAnnouncement()');
    return false;
  }

  const result = sendChatText(formatAnnouncement());
  if (result && result.ok) {
    props.setProperty('slimAnnouncementSent', new Date().toISOString());
    Logger.log('✅ Анонс отправлен в чат клуба');
    return true;
  }
  Logger.log('❌ Анонс не отправлен — см. ошибку выше');
  return false;
}

/**
 * 📣 Отправить анонс ещё раз. Отдельная функция — чтобы запускать из
 * меню и списка функций в редакторе без аргументов.
 */
function resendAnnouncement() {
  return setupBot(true);
}

/** Текст анонса для чата клуба */
function formatAnnouncement() {
  return '📚 Бот клуба стал проще\n\n' +
    'Отмечать чтение в таблице больше не нужно: ежедневных отчётов, стриков и бейджей не будет. ' +
    'Читаем в своём темпе 🙂\n\n' +
    'Бот теперь помогает с главным — выбрать общую книгу и собраться на встречу:\n\n' +
    '📖 /suggest_book название — предложить книгу\n' +
    '📋 /books — кто что предложил\n' +
    '🗳 /book_vote — голосование за следующую общую книгу\n' +
    '❓ /question текст — вопрос к встрече (в личку боту — анонимно)\n' +
    '📝 /questions — все вопросы к встрече\n' +
    '📅 /meeting_done — встреча прошла: бот предложит даты следующей и сам запустит выбор книги\n' +
    '🔁 /another_time — сдвинуть даты встречи на неделю\n\n' +
    'Дуэли, тайные напарники и анонимки отключены.\n' +
    'Все команды: /help';
}

/**
 * 📋 МЕНЮ — добавляет кнопку в интерфейс Google Sheets
 * Вызывается автоматически при открытии таблицы
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📚 Книжный клуб')
    .addItem('🚀 Обновить бота (меню команд + анонс)', 'setupBot')
    .addItem('📣 Отправить анонс ещё раз', 'resendAnnouncement')
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
