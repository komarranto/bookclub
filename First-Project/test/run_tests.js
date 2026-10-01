// Локальные тесты логики бота без Google Apps Script.
// Запуск: node First-Project/test/run_tests.js
//
// Подменяем сервисы Apps Script (SpreadsheetApp, PropertiesService,
// LockService, UrlFetchApp, ContentService, Logger) заглушками и гоняем
// doPost с реальными JSON-апдейтами Telegram. Проверяем поведение
// команд встречи end-to-end: два опроса, 12 слотов, мультивыбор,
// защита от повторов по update_id, cooldown, /another_time, /bot_version.
//
// Вторая часть файла — игровые механики (церемония итогов, бейджи,
// заморозка стрика, /quote, /question, /suggest_book, дуэли, тайные
// напарники и анонимки). Для них Google-таблица подменяется фейковой
// (test/fakes.js), и ежедневный отчёт гоняется целиком.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const { FakeSpreadsheet, makeSprintSheet, dayOffset } = require('./fakes');

const botSource = fs.readFileSync(path.join(__dirname, '..', 'BookClubBot.gs'), 'utf8');

const TEST_CONFIG = `
const TELEGRAM_BOT_TOKEN = 'TEST_TOKEN';
const TELEGRAM_CHAT_ID = '-1001234567890';
const TELEGRAM_WEBHOOK_SECRET = 'test-secret';
const WEB_APP_URL = 'https://script.google.com/macros/s/TEST/exec';
`;

function makeContext(options = {}) {
  const props = new Map();
  const fetchCalls = [];
  const logs = [];

  const ctx = {
    console,
    Date,
    JSON,
    Math,
    Number,
    String,
    Error,
    encodeURIComponent,
    Logger: { log: (m) => logs.push(String(m)) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => options.spreadsheet || ({ getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST' })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); }
      })
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} })
    },
    UrlFetchApp: {
      fetch: (url, requestOptions) => {
        const payload = requestOptions && requestOptions.payload ? JSON.parse(requestOptions.payload) : null;
        fetchCalls.push({ url, payload });
        const ok = options.telegramOk ? options.telegramOk(url, payload) : true;
        return { getContentText: () => JSON.stringify(ok ? { ok: true, result: true } : { ok: false, description: 'Forbidden: bot can\'t initiate conversation' }) };
      }
    },
    ContentService: {
      createTextOutput: (text) => ({ text })
    }
  };
  vm.createContext(ctx);
  vm.runInContext(TEST_CONFIG + '\n' + botSource, ctx, { filename: 'BookClubBot.gs' });
  return { ctx, props, fetchCalls, logs };
}

function telegramUpdate(updateId, text, chatId = '-1001234567890') {
  return {
    postData: { contents: JSON.stringify({ update_id: updateId, message: { chat: { id: Number(chatId) }, text } }) },
    parameter: { secret: 'test-secret' }
  };
}

function pollCalls(fetchCalls) {
  return fetchCalls.filter(c => c.url.endsWith('/sendPoll'));
}
function messageCalls(fetchCalls) {
  return fetchCalls.filter(c => c.url.endsWith('/sendMessage'));
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (err) {
    console.log(`❌ ${name}\n   ${err.message}`);
    process.exitCode = 1;
  }
}

const DAY = 24 * 60 * 60 * 1000;

test('/meeting_done → ровно два опроса: суббота и воскресенье через ~6 недель, по 12 слотов, мультивыбор', () => {
  const { ctx, fetchCalls } = makeContext();
  const res = ctx.handleTelegramUpdate(telegramUpdate(100, '/meeting_done'));
  assert.strictEqual(res, 'ok');

  const polls = pollCalls(fetchCalls);
  assert.strictEqual(polls.length, 2, `ожидалось 2 опроса, получено ${polls.length}`);

  for (const p of polls) {
    assert.strictEqual(p.payload.chat_id, '-1001234567890');
    assert.strictEqual(p.payload.options.length, 12, 'в опросе должно быть ровно 12 слотов');
    assert.strictEqual(p.payload.options[0], '07:00', 'первый слот — 07:00');
    assert.ok(p.payload.question.includes('UTC+0'), 'в вопросе указан часовой пояс');
    assert.ok(p.payload.question.length <= 300, 'вопрос опроса не длиннее 300 символов (лимит Telegram)');
    assert.strictEqual(p.payload.allows_multiple_answers, true, 'опрос должен быть с мультивыбором');
    assert.strictEqual(p.payload.is_anonymous, false);
  }
  assert.ok(polls[0].payload.question.includes('суббота'), 'первый опрос — суббота');
  assert.ok(polls[1].payload.question.includes('воскресенье'), 'второй опрос — воскресенье');

  // Даты: суббота на/после сегодня+42 дня, воскресенье = суббота + 1
  const target = new Date(Date.now() + 42 * DAY);
  const { saturday, sunday } = ctx.getUpcomingWeekend(target);
  assert.strictEqual(saturday.getDay(), 6);
  assert.strictEqual(sunday.getDay(), 0);
  assert.strictEqual(sunday.getTime() - saturday.getTime(), DAY);
  const diffDays = Math.round((saturday.getTime() - new Date(new Date().setHours(0, 0, 0, 0)).getTime()) / DAY);
  assert.ok(diffDays >= 42 && diffDays <= 48, `суббота должна быть через 42–48 дней, а не ${diffDays}`);
  assert.ok(polls[0].payload.question.includes(ctx.formatDateRu(saturday)));
  assert.ok(polls[1].payload.question.includes(ctx.formatDateRu(sunday)));
});

test('Повторная доставка того же update_id — ни одного нового опроса', () => {
  const { ctx, fetchCalls } = makeContext();
  ctx.handleTelegramUpdate(telegramUpdate(100, '/meeting_done'));
  assert.strictEqual(pollCalls(fetchCalls).length, 2);
  for (let i = 0; i < 5; i++) ctx.handleTelegramUpdate(telegramUpdate(100, '/meeting_done'));
  assert.strictEqual(pollCalls(fetchCalls).length, 2, 'повторы update_id=100 не должны слать опросы');
  // и более старый update_id тоже игнорируется
  ctx.handleTelegramUpdate(telegramUpdate(99, '/meeting_done'));
  assert.strictEqual(pollCalls(fetchCalls).length, 2);
});

test('Новая команда в течение cooldown — опросы не дублируются', () => {
  const { ctx, fetchCalls } = makeContext();
  ctx.handleTelegramUpdate(telegramUpdate(100, '/meeting_done'));
  ctx.handleTelegramUpdate(telegramUpdate(101, '/meeting_done'));
  ctx.handleTelegramUpdate(telegramUpdate(102, '/another_time'));
  assert.strictEqual(pollCalls(fetchCalls).length, 2, 'в пределах 2 минут — только первая пара опросов');
});

test('/another_time после cooldown — новая пара опросов на неделю позже', () => {
  const { ctx, props, fetchCalls } = makeContext();
  ctx.handleTelegramUpdate(telegramUpdate(100, '/meeting_done'));
  const firstSaturday = new Date(props.get('lastProposedMeetingDate'));

  // Имитируем, что прошло больше 2 минут
  props.set('lastMeetingCommandAt', String(Date.now() - 3 * 60 * 1000));

  ctx.handleTelegramUpdate(telegramUpdate(101, '/another_time'));
  const polls = pollCalls(fetchCalls);
  assert.strictEqual(polls.length, 4, 'после cooldown должна уйти вторая пара опросов');

  const secondSaturday = new Date(props.get('lastProposedMeetingDate'));
  assert.strictEqual(secondSaturday.getTime() - firstSaturday.getTime(), 7 * DAY, 'сдвиг ровно на неделю');
  assert.ok(polls[2].payload.question.includes(ctx.formatDateRu(secondSaturday)));
});

test('Команда с суффиксом @botname и текстовый триггер «встреча закончена» работают', () => {
  const { ctx, props, fetchCalls } = makeContext();
  ctx.handleTelegramUpdate(telegramUpdate(100, '/meeting_done@BookClubBot'));
  assert.strictEqual(pollCalls(fetchCalls).length, 2);

  props.set('lastMeetingCommandAt', String(Date.now() - 3 * 60 * 1000));
  ctx.handleTelegramUpdate(telegramUpdate(101, 'Встреча закончена'));
  assert.strictEqual(pollCalls(fetchCalls).length, 4);
});

test('/bot_version → одно сообщение с версией, без опросов', () => {
  const { ctx, fetchCalls } = makeContext();
  ctx.handleTelegramUpdate(telegramUpdate(100, '/bot_version'));
  const msgs = messageCalls(fetchCalls);
  assert.strictEqual(msgs.length, 1);
  // top-level const в vm-контексте не является свойством ctx — читаем через eval в контексте
  const botVersion = vm.runInContext('BOT_VERSION', ctx);
  assert.ok(botVersion && botVersion.length > 0, 'BOT_VERSION должна быть задана');
  assert.ok(msgs[0].payload.text.includes(botVersion), 'в ответе должна быть BOT_VERSION');
  assert.strictEqual(msgs[0].payload.parse_mode, undefined, 'служебное сообщение с /командами — без Markdown (подчёркивания ломают парсинг)');
  assert.strictEqual(pollCalls(fetchCalls).length, 0);
});

test('Ежедневный отчёт по-прежнему уходит с Markdown', () => {
  const { ctx, fetchCalls } = makeContext();
  ctx.sendTelegramMessage('*test*');
  assert.strictEqual(messageCalls(fetchCalls)[0].payload.parse_mode, 'Markdown');
});

test('Дедуп по списку последних update_id: старый/внеочередной id не блокирует новые', () => {
  const { ctx, props, fetchCalls } = makeContext();
  ctx.handleTelegramUpdate(telegramUpdate(999999999999, '/meeting_done')); // «тестовый» огромный id
  assert.strictEqual(pollCalls(fetchCalls).length, 2);
  props.set('lastMeetingCommandAt', String(Date.now() - 3 * 60 * 1000));
  ctx.handleTelegramUpdate(telegramUpdate(100, '/meeting_done')); // настоящий маленький id — должен пройти
  assert.strictEqual(pollCalls(fetchCalls).length, 4);
  ctx.handleTelegramUpdate(telegramUpdate(100, '/meeting_done')); // повтор — нет
  assert.strictEqual(pollCalls(fetchCalls).length, 4);
});

test('Неверный secret, чужой чат, сообщение без текста, обычный текст — ничего не отправляется', () => {
  const { ctx, fetchCalls } = makeContext();

  const badSecret = telegramUpdate(100, '/meeting_done');
  badSecret.parameter.secret = 'wrong';
  assert.strictEqual(ctx.handleTelegramUpdate(badSecret), 'ignored');

  assert.strictEqual(ctx.handleTelegramUpdate(telegramUpdate(101, '/meeting_done', '-100999')), 'ignored');

  const noText = { postData: { contents: JSON.stringify({ update_id: 102, message: { chat: { id: -1001234567890 } } }) }, parameter: { secret: 'test-secret' } };
  assert.strictEqual(ctx.handleTelegramUpdate(noText), 'ok');

  assert.strictEqual(ctx.handleTelegramUpdate(telegramUpdate(103, 'привет, кто читает?')), 'ok');

  assert.strictEqual(fetchCalls.length, 0, 'ни одного запроса в Telegram');
});

test('Битый JSON не роняет вебхук (всегда отвечаем Telegram)', () => {
  const { ctx } = makeContext();
  const res = ctx.handleTelegramUpdate({ postData: { contents: '{not json' }, parameter: { secret: 'test-secret' } });
  assert.strictEqual(res, 'error');
});

test('doPost ничего не возвращает (иначе Apps Script отдаёт 302, который Telegram не принимает) и не бросает наружу', () => {
  const { ctx, fetchCalls } = makeContext();
  const res = ctx.doPost(telegramUpdate(100, '/meeting_done'));
  assert.strictEqual(res, undefined, 'doPost должен возвращать undefined');
  assert.strictEqual(pollCalls(fetchCalls).length, 2, 'при этом команда должна отработать');
  assert.doesNotThrow(() => ctx.doPost({ postData: { contents: '{bad' }, parameter: { secret: 'test-secret' } }));
  assert.doesNotThrow(() => ctx.doPost({}));
});

test('setupTelegramWebhook без аргумента берёт WEB_APP_URL и дописывает secret', () => {
  const { ctx, fetchCalls } = makeContext();
  ctx.setupTelegramWebhook();
  const setWebhook = fetchCalls.find(c => c.url.endsWith('/setWebhook'));
  assert.ok(setWebhook, 'должен быть вызов setWebhook');
  assert.strictEqual(setWebhook.payload.url, 'https://script.google.com/macros/s/TEST/exec?secret=test-secret');
  const setCommands = fetchCalls.filter(c => c.url.endsWith('/setMyCommands'));
  assert.strictEqual(setCommands.length, 2, 'команды для группы и отдельно для лички');
  const groupCommands = setCommands[0].payload.commands.map(c => c.command);
  for (const old of ['meeting_done', 'another_time', 'bot_version']) {
    assert.ok(groupCommands.includes(old), `старая команда ${old} должна остаться в меню`);
  }
  for (const cmd of ['iam', 'quote', 'question', 'questions', 'suggest_book', 'book_vote', 'duel', 'help']) {
    assert.ok(groupCommands.includes(cmd), `новая команда ${cmd} в меню группы`);
  }
  assert.deepStrictEqual(setCommands[1].payload.scope, { type: 'all_private_chats' });
  assert.ok(setCommands[1].payload.commands.some(c => c.command === 'anon'));
  for (const c of setCommands[0].payload.commands.concat(setCommands[1].payload.commands)) {
    assert.ok(/^[a-z0-9_]{1,32}$/.test(c.command), `имя команды ${c.command} должно подходить Telegram`);
    assert.ok(c.description.length >= 1 && c.description.length <= 256, 'описание команды 1–256 символов');
  }
});

test('setupTelegramWebhook с незаполненным WEB_APP_URL — понятная ошибка', () => {
  const { ctx } = makeContext();
  assert.throws(() => ctx.setupTelegramWebhook('ВАШ_URL_ВЕБ_ПРИЛОЖЕНИЯ'), /WEB_APP_URL не задан/);
});

// ==================== ИГРОВЫЕ МЕХАНИКИ ====================

const T = true;
const F = false;
const CLUB = '-1001234567890';

// Клуб: текущий спринт (середина: начался 9 дней назад, 14 дней) + прошлый.
function makeClub({ current, previous, currentStartOffset = -9, commonBook = '1984', discussionDate = '25 января', extraSheets = [] } = {}) {
  const ss = new FakeSpreadsheet();
  ss.addSheet(makeSprintSheet('Fortnight 98', {
    startOffset: currentStartOffset,
    members: current || [
      { name: 'Антон', checks: [T, T, T, T, T, F, T, T, T, T] },
      { name: 'Маша', checks: [T, F, T, T, F, F, T, F, T, F] },
      { name: 'Вася', checks: [F, F, T, F, F, F, F, F, F, F] }
    ],
    commonBook,
    discussionDate
  }));
  ss.addSheet(makeSprintSheet('Fortnight 97', {
    startOffset: currentStartOffset - 14,
    members: previous || [
      { name: 'Антон', checks: Array(14).fill(F) },
      { name: 'Маша', checks: Array(14).fill(F) },
      { name: 'Вася', checks: Array(14).fill(F) }
    ],
    commonBook
  }));
  for (const s of extraSheets) ss.addSheet(s);
  return ss;
}

function clubContext(clubOptions, ctxOptions = {}) {
  const ss = makeClub(clubOptions);
  return Object.assign(makeContext(Object.assign({ spreadsheet: ss }, ctxOptions)), { ss });
}

let nextUpdateId = 1000;
function groupMsg(text, from) {
  return {
    postData: { contents: JSON.stringify({ update_id: nextUpdateId++, message: { message_id: 77, chat: { id: Number(CLUB), type: 'supergroup' }, from, text } }) },
    parameter: { secret: 'test-secret' }
  };
}
function privateMsg(text, from) {
  return {
    postData: { contents: JSON.stringify({ update_id: nextUpdateId++, message: { message_id: 5, chat: { id: from.id, type: 'private' }, from, text } }) },
    parameter: { secret: 'test-secret' }
  };
}
function callback(data, from, chatId = CLUB) {
  return {
    postData: { contents: JSON.stringify({ update_id: nextUpdateId++, callback_query: { id: 'cb' + nextUpdateId, from, data, message: { message_id: 9, chat: { id: Number(chatId) } } } }) },
    parameter: { secret: 'test-secret' }
  };
}

const ANTON = { id: 111, first_name: 'Антон', username: 'anton' };
const MASHA = { id: 222, first_name: 'Мария', username: 'masha' };
const VASYA = { id: 333, first_name: 'Василий', username: 'vasya' };

function registerAll(ctx, users = [ANTON, MASHA, VASYA], names = ['Антон', 'Маша', 'Вася']) {
  users.forEach((u, i) => ctx.handleTelegramUpdate(groupMsg('/iam ' + names[i], u)));
}

function chatMessages(fetchCalls) {
  return messageCalls(fetchCalls).filter(c => String(c.payload.chat_id) === CLUB);
}
function dmMessages(fetchCalls, userId) {
  return messageCalls(fetchCalls).filter(c => String(c.payload.chat_id) === String(userId));
}
function texts(calls) {
  return calls.map(c => c.payload.text);
}

// --- Регрессия: обычный отчёт посреди спринта ---

test('Отчёт посреди спринта: одно сообщение с Markdown и кнопкой, без церемонии, опросов и нового листа', () => {
  const { ctx, ss, fetchCalls } = clubContext();
  ctx.sendWeeklyReport();
  const msgs = chatMessages(fetchCalls);
  assert.ok(msgs.length >= 1);
  const report = msgs[0].payload;
  assert.ok(report.text.includes('КНИЖНЫЙ КЛУБ'));
  assert.ok(report.text.includes('Fortnight 98'));
  assert.ok(report.text.includes('осталось 4 дня до конца спринта'));
  assert.ok(report.text.includes('Антон') && report.text.includes('Маша') && report.text.includes('Вася'));
  assert.ok(report.text.includes('ЛИДЕР СПРИНТА'));
  assert.strictEqual(report.parse_mode, 'Markdown');
  assert.ok(report.reply_markup.inline_keyboard[0][0].text.includes('Открыть таблицу'));
  const quotes = vm.runInContext('READING_QUOTES', ctx);
  assert.ok(quotes.some(q => report.text.includes(q)), 'без цитат участников — случайная цитата из списка');
  assert.ok(!texts(msgs).some(t => t.includes('ИТОГИ СПРИНТА')), 'церемонии посреди спринта нет');
  assert.strictEqual(pollCalls(fetchCalls).length, 0);
  assert.ok(!ss.getSheetByName('Fortnight 99'), 'новый спринт посреди спринта не создаётся');
});

// --- Заморозка стрика ---

function oldCalculateStreak(sequencesNewestSheetFirst) {
  // Старый алгоритм (до заморозок) — эталон для регрессии
  let streak = 0;
  let found = false;
  for (const checks of sequencesNewestSheetFirst) {
    for (let i = checks.length - 1; i >= 0; i--) {
      if (checks[i]) { found = true; streak++; } else if (found) return streak;
    }
  }
  return streak;
}

function streakOf(ctx, ss, name) {
  const sheets = ctx.getFortnightSheets();
  return ctx.calculateStreakInfo(name, sheets);
}

test('Заморозка: 7 дней подряд дают заморозку, она спасает стрик при пропуске', () => {
  const { ctx, ss } = clubContext({
    current: [
      { name: 'Антон', checks: [T, T, T, T, T, T, T, F, T, T] }, // 7, пропуск, 2
      { name: 'Маша', checks: [F, F, T, T, T, T, T, F, T, T] },  // 5, пропуск, 2 — заморозки нет
      { name: 'Вася', checks: [T, T, T, T, T, T, T, F, F, T] }   // 7, два пропуска, заморозка одна
    ]
  });
  const anton = streakOf(ctx, ss, 'Антон');
  assert.strictEqual(anton.streak, 9, 'пропуск закрыт заморозкой: 7 + 2');
  assert.strictEqual(anton.freezes, 0);
  assert.strictEqual(anton.freezesUsed, 1);
  assert.strictEqual(streakOf(ctx, ss, 'Маша').streak, 2, 'без заморозки стрик обнуляется, как раньше');
  assert.strictEqual(streakOf(ctx, ss, 'Вася').streak, 1, 'одной заморозки на два пропуска не хватает');
  assert.strictEqual(ctx.calculateStreak('Антон', ctx.getFortnightSheets()), 9, 'calculateStreak тоже учитывает заморозки');
});

test('Заморозка: стрик идёт через границу спринтов, копится не больше 2 заморозок', () => {
  const { ctx, ss } = clubContext({
    currentStartOffset: -4, // в текущем спринте наступило 5 дней
    current: [{ name: 'Антон', checks: [T, T, T, T, T] }, { name: 'Маша', checks: [F, F, F, T, T] }, { name: 'Вася', checks: [] }],
    previous: [{ name: 'Антон', checks: Array(14).fill(T) }, { name: 'Маша', checks: Array(14).fill(T) }, { name: 'Вася', checks: [] }]
  });
  const anton = streakOf(ctx, ss, 'Антон');
  assert.strictEqual(anton.streak, 19);
  assert.strictEqual(anton.freezes, 2, 'за 14 дней — 2 заморозки, больше не копится');
  assert.strictEqual(streakOf(ctx, ss, 'Маша').streak, 2, 'перерыв в 3 дня двумя заморозками не закрыть');
  assert.strictEqual(streakOf(ctx, ss, 'Вася').streak, 0);
});

test('Заморозка: без заморозок результат совпадает со старым алгоритмом (200 случайных историй)', () => {
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let k = 0; k < 200; k++) {
    // Серии чтения короче 7 дней — заморозки не зарабатываются
    const gen = (len) => {
      const out = [];
      let run = 0;
      for (let i = 0; i < len; i++) {
        const v = run < 6 && rnd() < 0.6;
        run = v ? run + 1 : 0;
        out.push(v);
      }
      return out;
    };
    const cur = gen(10);
    const prev = gen(14);
    // Стык спринтов не должен склеивать серию в 7+
    prev[13] = false;
    // Вчера отмечено — тогда старое правило «неотмеченные дни в конце не
    // считаются» и новое «прошедший пропуск — это пропуск» дают одно и то же
    cur[8] = true;
    if (cur.slice(2, 9).every(Boolean)) cur[2] = false;
    const { ctx, ss } = clubContext({
      current: [{ name: 'Антон', checks: cur }, { name: 'Маша', checks: [] }, { name: 'Вася', checks: [] }],
      previous: [{ name: 'Антон', checks: prev }, { name: 'Маша', checks: [] }, { name: 'Вася', checks: [] }]
    });
    const curFull = cur.concat(Array(4).fill(false)); // в листе 14 дней, последние 4 — будущие
    const expected = oldCalculateStreak([curFull, prev]);
    assert.strictEqual(streakOf(ctx, ss, 'Антон').streak, expected, `история ${JSON.stringify(prev)} | ${JSON.stringify(cur)}`);
  }
});

test('Стрик сгорает, если человек перестал читать (раньше висел вечно); сегодняшний неотмеченный день не считается пропуском', () => {
  const { ctx, ss } = clubContext({
    current: [
      { name: 'Антон', checks: [T, T, T, T, F, F, F, F, F, F] }, // бросил 6 дней назад
      { name: 'Маша', checks: [T, T, T, T, T, T, T, T, T, F] },  // сегодня ещё не отметилась
      { name: 'Вася', checks: [T, T, T, T, T, T, T, T, F, F] }   // вчера пропуск, есть заморозка
    ]
  });
  assert.strictEqual(streakOf(ctx, ss, 'Антон').streak, 0);
  assert.strictEqual(streakOf(ctx, ss, 'Маша').streak, 9);
  const vasya = streakOf(ctx, ss, 'Вася');
  assert.strictEqual(vasya.streak, 8, 'вчерашний пропуск закрыт заморозкой');
  assert.strictEqual(vasya.freezesUsed, 1);
});

test('Заморозки показываются в рейтинге (🧊N), стрик-бейджи считаются по новому стрику', () => {
  const { ctx, fetchCalls } = clubContext({
    current: [{ name: 'Антон', checks: [T, T, T, T, T, T, T, F, T, T] }, { name: 'Маша', checks: [] }, { name: 'Вася', checks: [] }],
    previous: [{ name: 'Антон', checks: Array(14).fill(T) }, { name: 'Маша', checks: [] }, { name: 'Вася', checks: [] }]
  });
  ctx.sendWeeklyReport();
  const all = texts(chatMessages(fetchCalls));
  assert.ok(all[0].includes('🧊'), 'в рейтинге видна заморозка');
  assert.ok(all.some(t => t.includes('💎 Стрик 14+ дней')), 'стрик 23 (14 + 9 с заморозкой) даёт бейдж 14+');
});

// --- /iam ---

test('/iam: привязка по имени из таблицы, чужое имя занять нельзя, неизвестное имя — подсказка', () => {
  const { ctx, props, fetchCalls } = clubContext();
  ctx.handleTelegramUpdate(groupMsg('/iam антон', ANTON));
  let reg = JSON.parse(props.get('telegramMembers'));
  assert.strictEqual(reg['111'].name, 'Антон', 'регистр букв не важен, имя берётся как в таблице');
  assert.strictEqual(reg['111'].username, 'anton');

  ctx.handleTelegramUpdate(groupMsg('/iam Антон', MASHA));
  reg = JSON.parse(props.get('telegramMembers'));
  assert.ok(!reg['222'], 'занятое имя не перехватывается');
  assert.ok(texts(chatMessages(fetchCalls)).some(t => t.includes('уже привязано')));

  ctx.handleTelegramUpdate(groupMsg('/iam Пётр', MASHA));
  assert.ok(texts(chatMessages(fetchCalls)).some(t => t.includes('Не нашёл') && t.includes('Маша')));

  ctx.handleTelegramUpdate(groupMsg('/iam@BookClubBot Маша', MASHA));
  reg = JSON.parse(props.get('telegramMembers'));
  assert.strictEqual(reg['222'].name, 'Маша', 'команда с @botname тоже работает');
  for (const c of chatMessages(fetchCalls)) {
    assert.strictEqual(c.payload.parse_mode, undefined, 'ответы на команды — без Markdown');
  }
});

// --- /quote ---

test('/quote: цитата попадает в следующий отчёт вместо случайной, Markdown-символы вычищены, показывается один раз', () => {
  const { ctx, ss, fetchCalls } = clubContext();
  registerAll(ctx);
  ctx.handleTelegramUpdate(groupMsg('/quote Рукописи не *горят* _никогда_ [`x`]', ANTON));
  const quotesSheet = ss.getSheetByName('Quotes');
  assert.ok(quotesSheet && quotesSheet.hidden, 'данные цитат — на скрытом листе');

  fetchCalls.length = 0;
  ctx.sendWeeklyReport();
  const report = chatMessages(fetchCalls)[0].payload;
  assert.ok(report.text.includes('«Рукописи не горят никогда x»'), report.text.slice(-300));
  assert.ok(report.text.includes('прислал(а) Антон'));
  assert.strictEqual(report.parse_mode, 'Markdown');

  fetchCalls.length = 0;
  ctx.sendWeeklyReport();
  assert.ok(!chatMessages(fetchCalls)[0].payload.text.includes('Рукописи'), 'цитата показывается один раз');
});

test('/quote в личке работает тихо: ответ только в личку, в чат ничего', () => {
  const { ctx, ss, fetchCalls } = clubContext();
  registerAll(ctx);
  fetchCalls.length = 0;
  ctx.handleTelegramUpdate(privateMsg('/quote Тихая цитата', MASHA));
  assert.strictEqual(chatMessages(fetchCalls).length, 0);
  assert.strictEqual(dmMessages(fetchCalls, 222).length, 1);
  assert.strictEqual(ss.getSheetByName('Quotes').getRange(2, 2).getValue(), 'Маша');
});

// --- /question ---

test('/question копит вопросы, /questions показывает их, за день до обсуждения список публикуется один раз', () => {
  const tomorrow = dayOffset(1);
  const { ctx, fetchCalls } = clubContext({ discussionDate: tomorrow });
  registerAll(ctx);
  ctx.handleTelegramUpdate(groupMsg('/question Кто на самом деле Большой Брат?', ANTON));
  ctx.handleTelegramUpdate(privateMsg('/question Чем пугает новояз?', MASHA));
  assert.ok(texts(chatMessages(fetchCalls)).some(t => t.includes('Вопрос к встрече по «1984» сохранён (всего вопросов: 1)')));

  fetchCalls.length = 0;
  ctx.handleTelegramUpdate(groupMsg('/questions', VASYA));
  const list = texts(chatMessages(fetchCalls))[0];
  assert.ok(list.includes('1. Кто на самом деле Большой Брат?') && list.includes('2. Чем пугает новояз?'));

  fetchCalls.length = 0;
  ctx.sendWeeklyReport();
  const published = texts(chatMessages(fetchCalls)).filter(t => t.includes('Завтра обсуждаем «1984»'));
  assert.strictEqual(published.length, 1);
  assert.ok(published[0].includes('Большой Брат') && published[0].includes('новояз'));

  fetchCalls.length = 0;
  ctx.sendWeeklyReport();
  assert.ok(!texts(chatMessages(fetchCalls)).some(t => t.includes('Завтра обсуждаем')), 'повторно не публикуется');
});

test('Дата обсуждения текстом («25 января») тоже распознаётся; в другие дни вопросы не публикуются', () => {
  const months = vm.runInContext('RU_MONTHS_GENITIVE', ctxForParse());
  const tomorrow = dayOffset(1);
  const asText = `${tomorrow.getDate()} ${months[tomorrow.getMonth()]}`;
  const { ctx, fetchCalls } = clubContext({ discussionDate: asText });
  ctx.handleTelegramUpdate(groupMsg('/question Вопрос?', ANTON));
  ctx.sendWeeklyReport();
  assert.ok(texts(chatMessages(fetchCalls)).some(t => t.includes('Завтра обсуждаем')), asText);

  const other = clubContext({ discussionDate: dayOffset(5) });
  other.ctx.handleTelegramUpdate(groupMsg('/question Вопрос?', ANTON));
  other.ctx.sendWeeklyReport();
  assert.ok(!texts(chatMessages(other.fetchCalls)).some(t => t.includes('Завтра обсуждаем')));

  assert.strictEqual(ctxForParse().parseDiscussionDate('Не указана'), null);
});
function ctxForParse() { return makeContext().ctx; }

// --- /suggest_book и /book_vote ---

test('/suggest_book + /book_vote: дубли отсекаются, меньше 2 кандидатов — подсказка, иначе опрос с одним вариантом ответа', () => {
  const { ctx, fetchCalls } = clubContext();
  registerAll(ctx);
  ctx.handleTelegramUpdate(groupMsg('/suggest_book Мастер и Маргарита', ANTON));
  ctx.handleTelegramUpdate(groupMsg('/suggest_book мастер и маргарита', MASHA));
  assert.ok(texts(chatMessages(fetchCalls)).some(t => t.includes('уже есть в списке')));

  ctx.handleTelegramUpdate(groupMsg('/book_vote', VASYA));
  assert.strictEqual(pollCalls(fetchCalls).length, 0);
  assert.ok(texts(chatMessages(fetchCalls)).some(t => t.includes('минимум 2 кандидата, сейчас: 1')));

  ctx.handleTelegramUpdate(privateMsg('/suggest_book Дюна', MASHA));
  ctx.handleTelegramUpdate(groupMsg('/book_vote', VASYA));
  const polls = pollCalls(fetchCalls);
  assert.strictEqual(polls.length, 1);
  assert.strictEqual(polls[0].payload.allows_multiple_answers, false);
  assert.deepStrictEqual(polls[0].payload.options, ['Мастер и Маргарита (от Антон)', 'Дюна (от Маша)']);

  ctx.handleTelegramUpdate(groupMsg('/book_vote', VASYA));
  assert.strictEqual(pollCalls(fetchCalls).length, 1, 'проголосованные книги второй раз в опрос не идут');
});

// --- Церемония итогов ---

test('Последний день: отчёт → бейджи → церемония (MVP, рывок, стрик, напарники) → голосование за книгу → новый спринт', () => {
  const { ctx, ss, props, fetchCalls } = clubContext({
    currentStartOffset: -13,
    current: [
      { name: 'Антон', checks: Array(14).fill(T) },
      { name: 'Маша', checks: [T, T, T, T, T, T, T, F, F, F, F, F, F, F] },
      { name: 'Вася', checks: [T, F, T, F, T, F, T, F, T, F, T, F, T, F] }
    ],
    previous: [
      { name: 'Антон', checks: Array(14).fill(F) },
      { name: 'Маша', checks: Array(14).fill(T) },
      { name: 'Вася', checks: Array(14).fill(F) }
    ]
  });
  registerAll(ctx);
  ctx.handleTelegramUpdate(groupMsg('/suggest_book Дюна', ANTON));
  ctx.handleTelegramUpdate(groupMsg('/suggest_book Мор', MASHA));
  // Напарники уже были назначены на этот спринт
  ctx.ensureSecretPartners('Fortnight 98', ['Антон', 'Маша', 'Вася']);
  ctx.handleTelegramUpdate(privateMsg('/anon Держись!', ANTON));

  fetchCalls.length = 0;
  ctx.sendWeeklyReport();
  const all = texts(chatMessages(fetchCalls));
  assert.ok(all[0].includes('КНИЖНЫЙ КЛУБ') && all[0].includes('последний день спринта'), 'сначала обычный отчёт');
  const ceremony = all.find(t => t.includes('ИТОГИ СПРИНТА'));
  assert.ok(ceremony, 'церемония отправлена');
  assert.ok(all.indexOf(ceremony) > 0, 'церемония после отчёта');
  assert.ok(ceremony.includes('MVP:* Антон — 100% (14/14)'), ceremony);
  assert.ok(ceremony.includes('Рывок спринта:* Антон (+100% к прошлому спринту)'));
  assert.ok(ceremony.includes('Самый длинный стрик:* Антон — 14 дней'));
  assert.ok(ceremony.includes('Тайные напарники раскрыты'));
  const antonPair = JSON.parse(props.get('secretPartners')).pairs.find(p => p.giverName === 'Антон');
  assert.ok(ceremony.includes(`Антон → ${antonPair.targetName} (1 послание)`));
  assert.ok(ceremony.includes('голосование за следующую общую книгу'));
  assert.ok(!/(^|[^\\])_/.test(ceremony.replace(/_[^_]*_/g, '')), 'в Markdown-церемонии нет неэкранированных подчёркиваний');

  const polls = pollCalls(fetchCalls);
  assert.strictEqual(polls.length, 1, 'голосование за книгу запущено');
  assert.ok(ss.getSheetByName('Fortnight 99'), 'новый спринт создан, как и раньше');

  const achievements = ss.getSheetByName('Achievements').getRange(2, 1, ss.getSheetByName('Achievements').getLastRow() - 1, 3).getValues();
  assert.ok(achievements.some(r => r[0] === 'Антон' && r[1] === '🎯 Идеальный спринт'), 'старый бейдж «идеальный спринт» по-прежнему выдаётся');
  assert.ok(achievements.some(r => r[0] === 'Антон' && r[1] === '🚀 Рывок спринта'));
  assert.ok(!ctx.ensureSecretPartners('Fortnight 98', ['Антон', 'Маша', 'Вася']), 'повторно на тот же спринт не назначаются');
});

test('Последний день без кандидатов в книги: церемония зовёт /suggest_book, опроса нет', () => {
  const { ctx, fetchCalls } = clubContext({ currentStartOffset: -13 });
  ctx.sendWeeklyReport();
  const ceremony = texts(chatMessages(fetchCalls)).find(t => t.includes('ИТОГИ СПРИНТА'));
  assert.ok(ceremony.includes('/suggest\\_book'), 'подчёркивание экранировано для Markdown');
  assert.strictEqual(pollCalls(fetchCalls).length, 0);
});

// --- Тайные напарники и анонимки ---

test('Тайные напарники: назначаются по кругу в первом отчёте спринта, каждому — личка, в чат — анонс', () => {
  const { ctx, props, fetchCalls } = clubContext();
  registerAll(ctx);
  fetchCalls.length = 0;
  ctx.sendWeeklyReport();
  const assignment = JSON.parse(props.get('secretPartners'));
  assert.strictEqual(assignment.sprint, 'Fortnight 98');
  assert.strictEqual(assignment.pairs.length, 3);
  const givers = assignment.pairs.map(p => p.giverName).sort();
  const targets = assignment.pairs.map(p => p.targetName).sort();
  assert.deepStrictEqual(givers, ['Антон', 'Вася', 'Маша']);
  assert.deepStrictEqual(targets, givers, 'каждый — чей-то подопечный ровно один раз');
  for (const p of assignment.pairs) {
    assert.notStrictEqual(p.giverName, p.targetName, 'себе не назначается');
    const dm = dmMessages(fetchCalls, p.giverId);
    assert.strictEqual(dm.length, 1);
    assert.ok(dm[0].payload.text.includes(`тайный книжный напарник для ${p.targetName}`));
  }
  assert.ok(texts(chatMessages(fetchCalls)).some(t => t.includes('Тайные напарники на Fortnight 98 назначены')));

  fetchCalls.length = 0;
  ctx.sendWeeklyReport();
  assert.strictEqual(messageCalls(fetchCalls).filter(c => String(c.payload.chat_id) !== CLUB).length, 0, 'на следующий день не переназначаются');
});

test('Тайные напарники: меньше 3 зарегистрированных — не назначаются', () => {
  const { ctx, props } = clubContext();
  registerAll(ctx, [ANTON, MASHA], ['Антон', 'Маша']);
  ctx.sendWeeklyReport();
  assert.ok(!props.get('secretPartners'));
});

test('/anon в личке: послание подопечному уходит в чат без имени отправителя', () => {
  const { ctx, props, fetchCalls } = clubContext();
  registerAll(ctx);
  ctx.sendWeeklyReport();
  const pair = JSON.parse(props.get('secretPartners')).pairs.find(p => p.giverName === 'Антон');

  fetchCalls.length = 0;
  ctx.handleTelegramUpdate(privateMsg('/anon Держи *цитату*: «Свобода — это рабство»', ANTON));
  const group = chatMessages(fetchCalls);
  assert.strictEqual(group.length, 1);
  assert.ok(group[0].payload.text.includes(`${pair.targetName}, тебе послание от тайного напарника`));
  assert.ok(group[0].payload.text.includes('Держи цитату'), 'Markdown-символы вычищены');
  assert.ok(!group[0].payload.text.includes('Антон'), 'имени отправителя в чате нет');
  assert.strictEqual(group[0].payload.parse_mode, undefined);
  assert.ok(!group[0].payload.reply_markup, 'без кнопки таблицы');
  assert.ok(dmMessages(fetchCalls, 111)[0].payload.text.includes('Отправлено анонимно'));
  assert.strictEqual(JSON.parse(props.get('secretPartners')).pairs.find(p => p.giverName === 'Антон').sent, 1);
});

test('/anon_all и /anon без назначенных напарников — анонимно всему клубу; лимит 5 в день', () => {
  const { ctx, fetchCalls } = clubContext();
  registerAll(ctx);
  fetchCalls.length = 0;
  ctx.handleTelegramUpdate(privateMsg('/anon_all Всем привет', MASHA));
  ctx.handleTelegramUpdate(privateMsg('/anon Ещё привет', MASHA));
  const group = texts(chatMessages(fetchCalls));
  assert.strictEqual(group.length, 2);
  assert.ok(group.every(t => t.startsWith('📨 Анонимное послание клубу') && !t.includes('Маша')));

  for (let i = 0; i < 5; i++) ctx.handleTelegramUpdate(privateMsg('/anon_all спам ' + i, MASHA));
  assert.strictEqual(chatMessages(fetchCalls).length, 5, 'не больше 5 анонимок в день');
  assert.ok(texts(dmMessages(fetchCalls, 222)).some(t => t.includes('лимит')));
});

test('Личка: незарегистрированному — подсказка, ничего не уходит в чат; /start — справка; /meeting_done из лички не работает', () => {
  const { ctx, fetchCalls } = clubContext();
  const stranger = { id: 999, first_name: 'Незнакомец' };
  ctx.handleTelegramUpdate(privateMsg('/anon Привет', stranger));
  ctx.handleTelegramUpdate(privateMsg('/meeting_done', stranger));
  ctx.handleTelegramUpdate(privateMsg('/start', stranger));
  assert.strictEqual(chatMessages(fetchCalls).length, 0);
  assert.strictEqual(pollCalls(fetchCalls).length, 0);
  const dms = texts(dmMessages(fetchCalls, 999));
  assert.ok(dms[0].includes('/iam'));
  assert.ok(dms[2].includes('/anon текст'));
});

test('/anon в общем чате: сообщение удаляется, текст не публикуется повторно, подсказка про личку', () => {
  const { ctx, fetchCalls } = clubContext();
  registerAll(ctx);
  fetchCalls.length = 0;
  ctx.handleTelegramUpdate(groupMsg('/anon секретик', ANTON));
  assert.ok(fetchCalls.some(c => c.url.endsWith('/deleteMessage') && c.payload.message_id === 77));
  const group = texts(chatMessages(fetchCalls));
  assert.strictEqual(group.length, 1);
  assert.ok(!group[0].includes('секретик') && group[0].includes('в личку'));
});

test('/my_target: подсказывает подопечного или объясняет, что напарники не назначены', () => {
  const { ctx, props, fetchCalls } = clubContext();
  registerAll(ctx);
  ctx.handleTelegramUpdate(privateMsg('/my_target', VASYA));
  assert.ok(texts(dmMessages(fetchCalls, 333)).pop().includes('ещё не назначены'));
  ctx.sendWeeklyReport();
  const pair = JSON.parse(props.get('secretPartners')).pairs.find(p => p.giverName === 'Вася');
  ctx.handleTelegramUpdate(privateMsg('/my_target', VASYA));
  assert.ok(texts(dmMessages(fetchCalls, 333)).pop().includes(`тайный напарник для ${pair.targetName}`));
});

test('Если бот не может написать в личку — назначение всё равно проходит и в чате есть подсказка /my_target', () => {
  const { ctx, props, fetchCalls } = clubContext({}, { telegramOk: (url, payload) => !(url.endsWith('/sendMessage') && Number(payload.chat_id) > 0) });
  registerAll(ctx);
  assert.doesNotThrow(() => ctx.sendWeeklyReport());
  assert.ok(props.get('secretPartners'));
  assert.ok(texts(chatMessages(fetchCalls)).some(t => t.includes('/my_target')));
});

// --- Дуэли ---

test('Дуэль: вызов с кнопкой, принять может только вызванный, потом итоги по дням из таблицы', () => {
  const { ctx, props, fetchCalls } = clubContext();
  registerAll(ctx);

  ctx.handleTelegramUpdate(groupMsg('/duel Маша', VASYA));
  ctx.handleTelegramUpdate(groupMsg('/duel @masha', ANTON));
  // Вася вызвал первым, Антон тоже может вызвать — пока никто не принял
  const challenge = chatMessages(fetchCalls).filter(c => c.payload.reply_markup && c.payload.reply_markup.inline_keyboard[0][0].callback_data);
  assert.strictEqual(challenge.length, 2);
  const data = challenge[1].payload.reply_markup.inline_keyboard[0][0].callback_data;
  assert.ok(data.startsWith('duel_accept:') && data.length <= 64, 'callback_data не длиннее 64 байт');

  ctx.handleTelegramUpdate(callback(data, VASYA));
  let answers = fetchCalls.filter(c => c.url.endsWith('/answerCallbackQuery'));
  assert.ok(answers.pop().payload.text.includes('адресован Маша'));

  ctx.handleTelegramUpdate(callback(data, MASHA));
  answers = fetchCalls.filter(c => c.url.endsWith('/answerCallbackQuery'));
  assert.ok(answers.pop().payload.text.includes('принят'));
  assert.ok(texts(chatMessages(fetchCalls)).some(t => t.includes('Дуэль началась: Антон против Маша')));

  // Вторую дуэль Маша уже принять не может — она занята
  const first = challenge[0].payload.reply_markup.inline_keyboard[0][0].callback_data;
  ctx.handleTelegramUpdate(callback(first, MASHA));
  assert.ok(fetchCalls.filter(c => c.url.endsWith('/answerCallbackQuery')).pop().payload.text.includes('другая дуэль'));

  // Перематываем: дуэль шла с 8 по 2 день назад (индексы 1..7 в листе)
  const duels = JSON.parse(props.get('duels'));
  const active = duels.find(d => d.status === 'active');
  active.start = ctx.dateKey(dayOffset(-8));
  active.end = ctx.dateKey(dayOffset(-2));
  props.set('duels', JSON.stringify(duels));

  fetchCalls.length = 0;
  ctx.sendWeeklyReport();
  const result = texts(chatMessages(fetchCalls)).find(t => t.includes('Итоги дуэли'));
  // Антон [T,T,T,T,T,F,T,T,T,T]: индексы 1..7 → 6; Маша [T,F,T,T,F,F,T,F,T,F]: 1..7 → 3
  assert.ok(result && result.includes('Антон vs Маша: 6:3') && result.includes('Победа — Антон'), result);
  assert.ok(result.includes('Фант для Маша'));
  assert.strictEqual(JSON.parse(props.get('duelWins'))['Антон'], 1);
  assert.strictEqual(JSON.parse(props.get('duels')).find(d => d.id === active.id).status, 'finished');

  fetchCalls.length = 0;
  ctx.sendWeeklyReport();
  assert.ok(!texts(chatMessages(fetchCalls)).some(t => t.includes('Итоги дуэли')), 'итоги подводятся один раз');
});

test('Дуэль: без /iam нельзя, с собой нельзя, неизвестный соперник — подсказка, просроченный вызов не принять', () => {
  const { ctx, props, fetchCalls } = clubContext();
  ctx.handleTelegramUpdate(groupMsg('/duel Маша', ANTON));
  assert.ok(texts(chatMessages(fetchCalls)).pop().includes('/iam'));
  registerAll(ctx);
  ctx.handleTelegramUpdate(groupMsg('/duel Антон', ANTON));
  assert.ok(texts(chatMessages(fetchCalls)).pop().includes('С самим собой'));
  ctx.handleTelegramUpdate(groupMsg('/duel Пётр', ANTON));
  assert.ok(texts(chatMessages(fetchCalls)).pop().includes('Не нашёл'));

  ctx.handleTelegramUpdate(groupMsg('/duel Маша', ANTON));
  const duels = JSON.parse(props.get('duels'));
  duels[0].createdAt = Date.now() - 25 * 60 * 60 * 1000;
  props.set('duels', JSON.stringify(duels));
  ctx.handleTelegramUpdate(callback('duel_accept:' + duels[0].id, MASHA));
  assert.ok(fetchCalls.filter(c => c.url.endsWith('/answerCallbackQuery')).pop().payload.text.includes('устарел'));
});

test('Нажатие кнопки из чужого чата игнорируется', () => {
  const { ctx, fetchCalls } = clubContext();
  registerAll(ctx);
  fetchCalls.length = 0;
  assert.strictEqual(ctx.handleTelegramUpdate(callback('duel_accept:1', MASHA, '-100999')), 'ignored');
  assert.strictEqual(fetchCalls.length, 0);
});

// --- Бейджи за прогресс и секретные ---

test('🔄 Камбэк: перерыв 3+ дня и 3 дня чтения подряд, один раз за спринт; новичок — не камбэк', () => {
  const { ctx, fetchCalls } = clubContext({
    currentStartOffset: -6, // сегодня — 7-й день
    current: [
      { name: 'Антон', checks: [T, F, F, F, T, T, T] },
      { name: 'Маша', checks: [F, F, F, F, T, T, T] },
      { name: 'Вася', checks: [T, T, T, T, T, T, F] }
    ]
  });
  ctx.sendWeeklyReport();
  const badges = texts(chatMessages(fetchCalls)).find(t => t.includes('Новые бейджи'));
  assert.ok(badges && badges.includes('*Антон*: 🔄 Камбэк'), badges);
  assert.ok(!badges.includes('Маша'), 'до перерыва не читала ни в этом, ни в прошлом спринте — не камбэк');

  fetchCalls.length = 0;
  ctx.sendWeeklyReport();
  assert.ok(!texts(chatMessages(fetchCalls)).some(t => t.includes('Камбэк')), 'повторно в том же спринте не выдаётся');
});

test('🏁 Первым дочитал общую книгу — один раз на книгу (кто дочитал позже, не получает)', () => {
  const { ctx, ss, fetchCalls } = clubContext({
    current: [
      { name: 'Антон', checks: [], finished: true },
      { name: 'Маша', checks: [] },
      { name: 'Вася', checks: [] }
    ]
  });
  ctx.sendWeeklyReport();
  assert.ok(texts(chatMessages(fetchCalls)).some(t => t.includes('*Антон*: 🏁 Первым дочитал общую книгу')));

  ss.getSheetByName('Fortnight 98').getRange(5, 12).setValue(true); // Маша дочитала
  fetchCalls.length = 0;
  ctx.sendWeeklyReport();
  assert.ok(!texts(chatMessages(fetchCalls)).some(t => t.includes('Первым дочитал')));
});

test('🔮 Секретные бейджи: объявляется название без условия, выдаются один раз', () => {
  const { ctx, fetchCalls } = clubContext({
    current: [
      { name: 'Антон', checks: [T, F, T, F, T, F, T, F, F, F] }, // американские горки
      { name: 'Маша', checks: [] },
      { name: 'Вася', checks: [] }
    ]
  });
  registerAll(ctx);
  for (let i = 0; i < 3; i++) ctx.handleTelegramUpdate(groupMsg('/quote цитата ' + i, MASHA));
  ctx.sendWeeklyReport();
  const secret = texts(chatMessages(fetchCalls)).find(t => t.includes('Секретные бейджи'));
  assert.ok(secret, 'есть сообщение о секретных бейджах');
  assert.ok(secret.includes('*Антон* получает «🎢 Американские горки»'));
  assert.ok(secret.includes('*Маша* получает «💬 Цитатник»'));
  assert.ok(secret.includes('угадайте сами'));
  assert.ok(!/через день|3\+|цитат/i.test(secret.replace('Цитатник', '')), 'условия не раскрываются');

  fetchCalls.length = 0;
  ctx.sendWeeklyReport();
  assert.ok(!texts(chatMessages(fetchCalls)).some(t => t.includes('Секретные бейджи')));
});

// --- Надёжность ---

test('Ошибка в игровых механиках не мешает отчёту и созданию нового спринта', () => {
  const ss = makeClub({ currentStartOffset: -13 });
  const realInsert = ss.insertSheet.bind(ss);
  ss.insertSheet = (name) => {
    if (name !== 'Achievements' && !name.startsWith('Fortnight')) throw new Error('boom');
    return realInsert(name);
  };
  const { ctx, props, fetchCalls } = makeContext({ spreadsheet: ss });
  props.set('telegramMembers', '{не json');
  props.set('duels', '{тоже не json');
  assert.doesNotThrow(() => ctx.sendWeeklyReport());
  assert.ok(texts(chatMessages(fetchCalls))[0].includes('КНИЖНЫЙ КЛУБ'));
  assert.ok(ss.getSheetByName('Fortnight 99'), 'новый спринт всё равно создан');
});

test('/help в чате — список команд без Markdown; /bot_version подсказывает /help', () => {
  const { ctx, fetchCalls } = clubContext();
  ctx.handleTelegramUpdate(groupMsg('/help', ANTON));
  const help = chatMessages(fetchCalls)[0].payload;
  assert.strictEqual(help.parse_mode, undefined);
  for (const cmd of ['/iam', '/quote', '/question', '/questions', '/suggest_book', '/book_vote', '/duel', '/anon', '/anon_all', '/my_target', '/meeting_done']) {
    assert.ok(help.text.includes(cmd), cmd);
  }
  ctx.handleTelegramUpdate(groupMsg('/bot_version', ANTON));
  assert.ok(chatMessages(fetchCalls)[1].payload.text.includes('/help'));
});

console.log(`\n${passed} тестов прошло${process.exitCode ? ', есть ошибки' : ', ошибок нет'}`);
