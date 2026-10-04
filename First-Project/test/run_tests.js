// Локальные тесты логики бота без Google Apps Script.
// Запуск: node First-Project/test/run_tests.js
//
// Подменяем сервисы Apps Script (SpreadsheetApp, PropertiesService,
// LockService, UrlFetchApp, ScriptApp, Logger) заглушками и гоняем
// doPost с реальными JSON-апдейтами Telegram:
// - даты встречи: два опроса, 12 слотов, мультивыбор, защита от повторов
//   по update_id, cooldown, /another_time, /bot_version;
// - выбор следующей книги: /suggest_book, /books, /book_vote;
// - вопросы к встрече: /question, /questions, архив по /meeting_done;
// - личка, старые команды, setupBot (триггеры, меню, анонс).
// Скрытые листы с данными — в фейковой таблице (test/fakes.js).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { FakeSpreadsheet } = require('./fakes');

const botSource = fs.readFileSync(path.join(__dirname, '..', 'BookClubBot.gs'), 'utf8');

const TEST_CONFIG = `
const TELEGRAM_BOT_TOKEN = 'TEST_TOKEN';
const TELEGRAM_CHAT_ID = '-1001234567890';
const TELEGRAM_WEBHOOK_SECRET = 'test-secret';
const WEB_APP_URL = 'https://script.google.com/macros/s/TEST/exec';
`;

const CLUB = '-1001234567890';

/**
 * options.telegramResponse(url, payload) — свой ответ Telegram (или null — обычный ok)
 * options.members — id участников чата клуба (для getChatMember)
 * options.triggers — имена функций существующих триггеров
 */
function makeContext(options = {}) {
  const props = new Map();
  const fetchCalls = [];
  const logs = [];
  const ss = options.spreadsheet || new FakeSpreadsheet();
  const members = options.members || [111, 222, 333];
  const triggers = (options.triggers || []).map(name => ({ getHandlerFunction: () => name }));
  const deletedTriggers = [];

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
      getActiveSpreadsheet: () => ss
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
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => {
        deletedTriggers.push(t.getHandlerFunction());
        triggers.splice(triggers.indexOf(t), 1);
      }
    },
    UrlFetchApp: {
      fetch: (url, requestOptions) => {
        const payload = requestOptions && requestOptions.payload ? JSON.parse(requestOptions.payload) : null;
        fetchCalls.push({ url, payload });
        if (options.telegramResponse) {
          const custom = options.telegramResponse(url, payload);
          if (custom) return { getContentText: () => JSON.stringify(custom) };
        }
        if (url.endsWith('/getChatMember')) {
          const status = members.includes(payload.user_id) ? 'member' : 'left';
          return { getContentText: () => JSON.stringify({ ok: true, result: { status } }) };
        }
        return { getContentText: () => JSON.stringify({ ok: true, result: true }) };
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(TEST_CONFIG + '\n' + botSource, ctx, { filename: 'BookClubBot.gs' });
  return { ctx, props, fetchCalls, logs, ss, deletedTriggers };
}

function telegramUpdate(updateId, text, chatId = CLUB) {
  return {
    postData: { contents: JSON.stringify({ update_id: updateId, message: { chat: { id: Number(chatId) }, text } }) },
    parameter: { secret: 'test-secret' }
  };
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

const ANTON = { id: 111, first_name: 'Антон', username: 'anton' };
const MASHA = { id: 222, first_name: 'Маша', username: 'masha' };
const STRANGER = { id: 999, first_name: 'Незнакомец' };

function pollCalls(fetchCalls) {
  return fetchCalls.filter(c => c.url.endsWith('/sendPoll'));
}
function messageCalls(fetchCalls) {
  return fetchCalls.filter(c => c.url.endsWith('/sendMessage'));
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

// ==================== ДАТА ВСТРЕЧИ И ВЕБХУК ====================

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
  assert.deepStrictEqual(groupCommands.slice().sort(),
    ['another_time', 'book_vote', 'books', 'bot_version', 'help', 'meeting_done', 'question', 'questions', 'suggest_book']);
  assert.deepStrictEqual(setCommands[1].payload.scope, { type: 'all_private_chats' });
  assert.deepStrictEqual(setCommands[1].payload.commands.map(c => c.command), ['question', 'suggest_book', 'help']);
  for (const c of setCommands[0].payload.commands.concat(setCommands[1].payload.commands)) {
    assert.ok(/^[a-z0-9_]{1,32}$/.test(c.command), `имя команды ${c.command} должно подходить Telegram`);
    assert.ok(c.description.length >= 1 && c.description.length <= 256, 'описание команды 1–256 символов');
  }
});

test('setupTelegramWebhook с незаполненным WEB_APP_URL — понятная ошибка', () => {
  const { ctx } = makeContext();
  assert.throws(() => ctx.setupTelegramWebhook('ВАШ_URL_ВЕБ_ПРИЛОЖЕНИЯ'), /WEB_APP_URL не задан/);
});


// ==================== СЛЕДУЮЩАЯ КНИГА ====================

test('/suggest_book + /books + /book_vote: дубли отсекаются, меньше 2 кандидатов — подсказка, иначе опрос с одним ответом', () => {
  const { ctx, ss, fetchCalls } = makeContext();
  ctx.handleTelegramUpdate(groupMsg('/suggest_book Мастер и Маргарита', ANTON));
  ctx.handleTelegramUpdate(groupMsg('/suggest_book мастер и маргарита', MASHA));
  assert.ok(texts(chatMessages(fetchCalls)).some(t => t.includes('уже есть в списке')));
  assert.ok(ss.getSheetByName('BookSuggestions').hidden, 'данные — на скрытом листе');

  ctx.handleTelegramUpdate(groupMsg('/book_vote', MASHA));
  assert.strictEqual(pollCalls(fetchCalls).length, 0);
  assert.ok(texts(chatMessages(fetchCalls)).pop().includes('минимум 2 кандидата, сейчас: 1'));

  ctx.handleTelegramUpdate(privateMsg('/suggest_book Дюна', MASHA));
  ctx.handleTelegramUpdate(groupMsg('/books', ANTON));
  const list = texts(chatMessages(fetchCalls)).pop();
  assert.ok(list.includes('1. Мастер и Маргарита (от Антон)') && list.includes('2. Дюна (от Маша)') && list.includes('/book_vote'));

  ctx.handleTelegramUpdate(groupMsg('/book_vote', ANTON));
  const polls = pollCalls(fetchCalls);
  assert.strictEqual(polls.length, 1);
  assert.strictEqual(polls[0].payload.allows_multiple_answers, false);
  assert.deepStrictEqual(polls[0].payload.options, ['Мастер и Маргарита (от Антон)', 'Дюна (от Маша)']);

  ctx.handleTelegramUpdate(groupMsg('/book_vote', ANTON));
  assert.strictEqual(pollCalls(fetchCalls).length, 1, 'проголосованные книги второй раз в опрос не идут');
  ctx.handleTelegramUpdate(groupMsg('/books', ANTON));
  assert.ok(texts(chatMessages(fetchCalls)).pop().includes('пока нет'));
});

test('Голосование: не больше 10 вариантов, длинные названия с эмодзи обрезаются без поломки', () => {
  const { ctx, fetchCalls } = makeContext();
  for (let i = 0; i < 12; i++) ctx.handleTelegramUpdate(groupMsg(`/suggest_book Книга ${i} ` + 'а'.repeat(95) + '📚📚', ANTON));
  ctx.handleTelegramUpdate(groupMsg('/book_vote', ANTON));
  const options = pollCalls(fetchCalls)[0].payload.options;
  assert.strictEqual(options.length, 10);
  for (const o of options) {
    assert.ok(o.length <= 100, 'вариант опроса не длиннее 100 символов');
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(o), 'нет половинок эмодзи');
  }
  ctx.handleTelegramUpdate(groupMsg('/books', ANTON));
  assert.ok(texts(chatMessages(fetchCalls)).pop().includes('Книга 10'), 'оставшиеся 2 книги ждут следующего голосования');
});

// ==================== ВОПРОСЫ К ВСТРЕЧЕ ====================

test('/question копит вопросы, /questions показывает их без имён', () => {
  const { ctx, fetchCalls } = makeContext();
  ctx.handleTelegramUpdate(groupMsg('/questions', ANTON));
  assert.ok(texts(chatMessages(fetchCalls)).pop().includes('пока нет'));

  ctx.handleTelegramUpdate(groupMsg('/question Кто на самом деле *Большой* Брат?', ANTON));
  assert.ok(texts(chatMessages(fetchCalls)).pop().includes('сохранён (всего: 1)'));
  ctx.handleTelegramUpdate(privateMsg('/question Чем пугает новояз?', MASHA));
  assert.ok(dmMessages(fetchCalls, 222).pop().payload.text.includes('сохранён (всего: 2)'));

  fetchCalls.length = 0;
  ctx.handleTelegramUpdate(groupMsg('/questions', ANTON));
  const list = texts(chatMessages(fetchCalls))[0];
  assert.ok(list.includes('1. Кто на самом деле Большой Брат?'), 'Markdown-символы вычищены');
  assert.ok(list.includes('2. Чем пугает новояз?'));
  assert.ok(!list.includes('Маша') && !list.includes('Антон'), 'в списке нет имён авторов');
});

test('/meeting_done: опросы даты → сообщение → голосование за книгу; вопросы уходят в архив', () => {
  const { ctx, props, fetchCalls } = makeContext();
  ctx.handleTelegramUpdate(groupMsg('/question Вопрос 1', ANTON));
  ctx.handleTelegramUpdate(groupMsg('/question Вопрос 2', MASHA));
  ctx.handleTelegramUpdate(groupMsg('/suggest_book Дюна', ANTON));
  ctx.handleTelegramUpdate(groupMsg('/suggest_book Мор', MASHA));

  fetchCalls.length = 0;
  ctx.handleTelegramUpdate(groupMsg('/meeting_done', ANTON));
  const order = fetchCalls.filter(c => c.url.endsWith('/sendPoll') || c.url.endsWith('/sendMessage'))
    .map(c => c.url.endsWith('/sendPoll') ? (c.payload.allows_multiple_answers ? 'дата' : 'книга') : 'текст');
  assert.deepStrictEqual(order, ['дата', 'дата', 'текст', 'книга']);
  const summary = texts(chatMessages(fetchCalls))[0];
  assert.ok(summary.includes('голосование за следующую общую книгу') && summary.includes('(2) ушли в архив'));

  ctx.handleTelegramUpdate(groupMsg('/questions', ANTON));
  assert.ok(texts(chatMessages(fetchCalls)).pop().includes('пока нет'), 'после встречи список пуст');

  // Повтор в пределах cooldown — ни опросов, ни второго архива/голосования
  fetchCalls.length = 0;
  ctx.handleTelegramUpdate(groupMsg('Встреча закончена', MASHA));
  assert.strictEqual(fetchCalls.filter(c => c.url.endsWith('/sendPoll') || c.url.endsWith('/sendMessage')).length, 0);

  // Следующая встреча без кандидатов — подсказка /suggest_book, без опроса книги
  props.set('lastMeetingCommandAt', String(Date.now() - 3 * 60 * 1000));
  ctx.handleTelegramUpdate(groupMsg('/meeting_done', MASHA));
  assert.strictEqual(pollCalls(fetchCalls).length, 2);
  assert.ok(texts(chatMessages(fetchCalls)).pop().includes('/suggest_book'));
});

// ==================== ЛИЧКА, СТАРЫЕ КОМАНДЫ ====================

test('Личка: участник клуба тихо отправляет вопрос/книгу, чужой — отказ; остальное — справка', () => {
  const { ctx, fetchCalls } = makeContext();
  ctx.handleTelegramUpdate(privateMsg('/question Тихий вопрос', STRANGER));
  ctx.handleTelegramUpdate(privateMsg('/suggest_book Чужая книга', STRANGER));
  assert.ok(dmMessages(fetchCalls, 999).every(c => c.payload.text.includes('только для участников')));
  ctx.handleTelegramUpdate(privateMsg('/start', STRANGER));
  ctx.handleTelegramUpdate(privateMsg('/meeting_done', STRANGER));
  assert.ok(dmMessages(fetchCalls, 999).slice(-2).every(c => c.payload.text.includes('/question')));
  assert.strictEqual(chatMessages(fetchCalls).length, 0, 'в чат клуба из лички ничего не уходит');
  assert.strictEqual(pollCalls(fetchCalls).length, 0);

  ctx.handleTelegramUpdate(groupMsg('/questions', ANTON));
  ctx.handleTelegramUpdate(groupMsg('/books', ANTON));
  assert.ok(texts(chatMessages(fetchCalls)).every(t => t.includes('пока нет')), 'от чужих ничего не сохранилось');
});

test('Старые команды (/iam, /duel, /anon…) — вежливый ответ, новые /help и /bot_version работают', () => {
  const { ctx, fetchCalls } = makeContext();
  for (const cmd of ['/iam Антон', '/duel Маша', '/anon привет', '/anon_all привет', '/quote цитата', '/my_target']) {
    ctx.handleTelegramUpdate(groupMsg(cmd, ANTON));
  }
  const replies = texts(chatMessages(fetchCalls));
  assert.strictEqual(replies.length, 6);
  assert.ok(replies.every(t => t.includes('больше не работает')));

  fetchCalls.length = 0;
  ctx.handleTelegramUpdate(groupMsg('/help', ANTON));
  const help = chatMessages(fetchCalls)[0].payload;
  for (const cmd of ['/suggest_book', '/books', '/book_vote', '/question', '/questions', '/meeting_done', '/another_time']) {
    assert.ok(help.text.includes(cmd), cmd);
  }
  for (const gone of ['/duel', '/anon', '/iam', '/quote']) {
    assert.ok(!help.text.includes(gone), `${gone} в справке быть не должно`);
  }
  ctx.handleTelegramUpdate(groupMsg('/unknown_command', ANTON));
  assert.strictEqual(chatMessages(fetchCalls).length, 1, 'на незнакомые команды бот молчит');
});

test('Ни одно сообщение не уходит с Markdown и без кнопки таблицы', () => {
  const { ctx, fetchCalls } = makeContext();
  ctx.handleTelegramUpdate(groupMsg('/suggest_book Книга_с_подчёркиваниями', ANTON));
  ctx.handleTelegramUpdate(groupMsg('/help', ANTON));
  ctx.handleTelegramUpdate(groupMsg('/meeting_done', ANTON));
  ctx.setupBot();
  for (const c of messageCalls(fetchCalls)) {
    assert.strictEqual(c.payload.parse_mode, undefined);
    assert.strictEqual(c.payload.reply_markup, undefined);
  }
});

test('Старая кнопка «Принять дуэль» в истории чата: бот отвечает, что кнопка не работает; из чужого чата — тишина', () => {
  const { ctx, fetchCalls } = makeContext();
  const cb = (chatId) => ({
    postData: { contents: JSON.stringify({ update_id: nextUpdateId++, callback_query: { id: 'cb1', from: MASHA, data: 'duel_accept:1', message: { chat: { id: Number(chatId) } } } }) },
    parameter: { secret: 'test-secret' }
  });
  assert.strictEqual(ctx.handleTelegramUpdate(cb('-100999')), 'ignored');
  assert.strictEqual(fetchCalls.length, 0);
  ctx.handleTelegramUpdate(cb(CLUB));
  assert.ok(fetchCalls.find(c => c.url.endsWith('/answerCallbackQuery')).payload.text.includes('больше не работает'));
});

test('Команды другому боту (/help@OtherBot) игнорируются', () => {
  const { ctx, fetchCalls } = makeContext({
    telegramResponse: (url) => url.endsWith('/getMe') ? { ok: true, result: { username: 'BookClubBot' } } : null
  });
  ctx.handleTelegramUpdate(groupMsg('/help@OtherBot', ANTON));
  assert.strictEqual(chatMessages(fetchCalls).length, 0);
  ctx.handleTelegramUpdate(groupMsg('/help@bookclubbot', ANTON));
  assert.strictEqual(chatMessages(fetchCalls).length, 1);
});

// ==================== ОБНОВЛЕНИЕ БОТА ====================

test('setupBot: удаляет старый триггер отчёта, чистит старые данные, обновляет меню и шлёт анонс один раз', () => {
  const { ctx, props, fetchCalls, deletedTriggers } = makeContext({ triggers: ['sendWeeklyReport', 'someOtherTrigger'] });
  for (const key of ['telegramMembers', 'duels', 'secretPartners', 'gameAnnouncementSent']) props.set(key, '{}');
  props.set('lastProposedMeetingDate', '2026-11-14T00:00:00.000Z');

  assert.strictEqual(ctx.setupBot(), true);
  assert.deepStrictEqual(deletedTriggers, ['sendWeeklyReport'], 'чужие триггеры не трогаем');
  for (const key of ['telegramMembers', 'duels', 'secretPartners', 'gameAnnouncementSent']) {
    assert.ok(!props.has(key), `${key} удалён`);
  }
  assert.ok(props.has('lastProposedMeetingDate'), 'данные встреч сохраняются');
  assert.strictEqual(fetchCalls.filter(c => c.url.endsWith('/setMyCommands')).length, 2);
  const announce = chatMessages(fetchCalls).pop().payload.text;
  assert.ok(announce.includes('стал проще') && announce.includes('/suggest_book') && announce.includes('/book_vote'));
  assert.ok(announce.includes('отключены'), 'сказано, что старые механики отключены');

  fetchCalls.length = 0;
  assert.strictEqual(ctx.setupBot(), false, 'второй раз анонс не шлётся');
  assert.strictEqual(chatMessages(fetchCalls).length, 0);
  assert.strictEqual(ctx.resendAnnouncement(), true);
  assert.strictEqual(chatMessages(fetchCalls).length, 1);
});

test('В коде не осталось отчётов, стриков, листов Fortnight и игровых механик', () => {
  for (const gone of ['sendWeeklyReport', 'calculateStreak', 'createNextSprint', 'getFortnightSheets', 'handleDuelCommand',
    'ensureSecretPartners', 'handleAnonCommand', 'awardBadges', 'sendSprintCeremony', 'setupDailyTrigger']) {
    assert.ok(!new RegExp(`function ${gone}\\(`).test(botSource), `${gone} должна быть удалена`);
  }
});

console.log(`\n${passed} тестов прошло${process.exitCode ? ', есть ошибки' : ', ошибок нет'}`);
