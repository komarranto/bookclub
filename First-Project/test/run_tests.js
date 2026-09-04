// Локальные тесты логики бота без Google Apps Script.
// Запуск: node First-Project/test/run_tests.js
//
// Подменяем сервисы Apps Script (SpreadsheetApp, PropertiesService,
// LockService, UrlFetchApp, ContentService, Logger) заглушками и гоняем
// doPost с реальными JSON-апдейтами Telegram. Проверяем поведение
// команд встречи end-to-end: два опроса, 10 слотов, мультивыбор,
// защита от повторов по update_id, cooldown, /another_time, /bot_version.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const botSource = fs.readFileSync(path.join(__dirname, '..', 'BookClubBot.gs'), 'utf8');

const TEST_CONFIG = `
const TELEGRAM_BOT_TOKEN = 'TEST_TOKEN';
const TELEGRAM_CHAT_ID = '-1001234567890';
const TELEGRAM_WEBHOOK_SECRET = 'test-secret';
const WEB_APP_URL = 'https://script.google.com/macros/s/TEST/exec';
`;

function makeContext() {
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
      getActiveSpreadsheet: () => ({ getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST' })
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
      fetch: (url, options) => {
        const payload = options && options.payload ? JSON.parse(options.payload) : null;
        fetchCalls.push({ url, payload });
        return { getContentText: () => JSON.stringify({ ok: true, result: true }) };
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

test('/meeting_done → ровно два опроса: суббота и воскресенье через ~6 недель, по 10 слотов, мультивыбор', () => {
  const { ctx, fetchCalls } = makeContext();
  const res = ctx.handleTelegramUpdate(telegramUpdate(100, '/meeting_done'));
  assert.strictEqual(res, 'ok');

  const polls = pollCalls(fetchCalls);
  assert.strictEqual(polls.length, 2, `ожидалось 2 опроса, получено ${polls.length}`);

  for (const p of polls) {
    assert.strictEqual(p.payload.chat_id, '-1001234567890');
    assert.strictEqual(p.payload.options.length, 10, 'в опросе должно быть ровно 10 слотов');
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
  assert.strictEqual(pollCalls(fetchCalls).length, 0);
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
  const setCommands = fetchCalls.find(c => c.url.endsWith('/setMyCommands'));
  assert.deepStrictEqual(setCommands.payload.commands.map(c => c.command), ['meeting_done', 'another_time', 'bot_version']);
});

test('setupTelegramWebhook с незаполненным WEB_APP_URL — понятная ошибка', () => {
  const { ctx } = makeContext();
  assert.throws(() => ctx.setupTelegramWebhook('ВАШ_URL_ВЕБ_ПРИЛОЖЕНИЯ'), /WEB_APP_URL не задан/);
});

console.log(`\n${passed} тестов прошло${process.exitCode ? ', есть ошибки' : ', ошибок нет'}`);
