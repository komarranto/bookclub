// Локальные тесты логики бота без Google Apps Script.
// Запуск: node First-Project/test/run_tests.js
//
// Подменяем сервисы Apps Script (SpreadsheetApp, PropertiesService,
// LockService, UrlFetchApp, ScriptApp, Logger) заглушками, а Telegram —
// фейком, который помнит опросы и отдаёт заданные тестом голоса через
// stopPoll. Часы тоже подменены: тест «перематывает» время и вызывает
// tick(), как это делает ежечасный триггер.

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
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Управляемые часы: new Date() и Date.now() внутри бота возвращают clock.now */
function makeClock(start) {
  const clock = { now: start };
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(clock.now);
      else super(...args);
    }
    static now() {
      return clock.now;
    }
  }
  clock.Date = FakeDate;
  clock.set = (ms) => { clock.now = ms; };
  return clock;
}

/**
 * options.members — id участников чата; options.admins — id админов;
 * options.triggers — имена функций существующих триггеров;
 * options.telegramResponse(url, payload) — свой ответ Telegram (или null).
 */
function makeContext(options = {}) {
  const props = new Map();
  const fetchCalls = [];
  const logs = [];
  const ss = options.spreadsheet || new FakeSpreadsheet();
  const members = options.members || [111, 222, 333, 444];
  const admins = options.admins || [111];
  const triggers = (options.triggers || []).map(name => ({ getHandlerFunction: () => name }));
  const deletedTriggers = [];
  const createdTriggers = [];
  // Пятница, 16 октября 2026, 10:00 по местному времени процесса
  const clock = makeClock(options.start || new Date(2026, 9, 16, 10, 0, 0).getTime());

  // Telegram: опросы с id и голосами, которые задаёт тест
  const polls = new Map();
  let nextMessageId = 500;

  const ctx = {
    console,
    Date: clock.Date,
    JSON,
    Math,
    Number,
    String,
    Error,
    encodeURIComponent,
    Logger: { log: (m) => logs.push(String(m)) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); }
      })
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => !(options.lockFails && options.lockFails()), releaseLock: () => {} })
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => {
        deletedTriggers.push(t.getHandlerFunction());
        triggers.splice(triggers.indexOf(t), 1);
      },
      newTrigger: (name) => {
        const spec = { name };
        const builder = {
          timeBased: () => builder,
          everyHours: (n) => { spec.everyHours = n; return builder; },
          create: () => {
            createdTriggers.push(spec);
            const t = { getHandlerFunction: () => name };
            triggers.push(t);
            return t;
          }
        };
        return builder;
      }
    },
    UrlFetchApp: {
      fetch: (url, requestOptions) => {
        const payload = requestOptions && requestOptions.payload ? JSON.parse(requestOptions.payload) : null;
        fetchCalls.push({ url, payload, at: clock.now });
        const respond = (obj) => ({ getContentText: () => JSON.stringify(obj) });
        if (options.telegramResponse) {
          const custom = options.telegramResponse(url, payload);
          if (custom) return respond(custom);
        }
        if (url.endsWith('/sendPoll')) {
          const id = nextMessageId++;
          polls.set(id, { options: payload.options, votes: payload.options.map(() => 0), closed: false });
          return respond({ ok: true, result: { message_id: id } });
        }
        if (url.endsWith('/stopPoll')) {
          const poll = polls.get(payload.message_id);
          if (!poll) return respond({ ok: false, description: 'Bad Request: message to stop poll not found' });
          poll.closed = true;
          return respond({ ok: true, result: { options: poll.options.map((text, i) => ({ text, voter_count: poll.votes[i] })) } });
        }
        if (url.endsWith('/getChatMember')) {
          const status = admins.includes(payload.user_id) ? 'administrator' : members.includes(payload.user_id) ? 'member' : 'left';
          return respond({ ok: true, result: { status } });
        }
        if (url.endsWith('/sendMessage')) {
          return respond({ ok: true, result: { message_id: nextMessageId++ } });
        }
        return respond({ ok: true, result: true });
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(TEST_CONFIG + '\n' + botSource, ctx, { filename: 'BookClubBot.gs' });

  const cycle = () => JSON.parse(props.get('cycle') || 'null');
  const vote = (messageId, votes) => { polls.get(messageId).votes = votes; };
  return { ctx, props, fetchCalls, logs, ss, clock, polls, cycle, vote, deletedTriggers, createdTriggers };
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

const ANTON = { id: 111, first_name: 'Антон' };   // админ
const MASHA = { id: 222, first_name: 'Маша' };
const VASYA = { id: 333, first_name: 'Вася' };
const OLYA = { id: 444, first_name: 'Оля' };
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
function lastChat(fetchCalls) {
  const all = texts(chatMessages(fetchCalls));
  return all[all.length - 1] || '';
}

/** Перемотать время до момента iso (+ сдвиг) и сделать tick, как ежечасный триггер */
function tickAt(t, iso, offsetMs = 0) {
  t.clock.set(new Date(iso).getTime() + offsetMs);
  t.ctx.tick();
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (err) {
    console.log(`❌ ${name}\n   ${err.stack.split('\n').slice(0, 3).join('\n   ')}`);
    process.exitCode = 1;
  }
}

/** Цикл на этапе заявок: 4 заявки от трёх человек */
function cycleWithSubmissions() {
  const t = makeContext();
  t.ctx.handleTelegramUpdate(groupMsg('/start_cycle', MASHA));
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book Дюна', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book Мор', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book Пикник на обочине', MASHA));
  t.ctx.handleTelegramUpdate(privateMsg('/suggest_book Стоунер', VASYA));
  return t;
}

// ==================== ПОЛНЫЙ ЦИКЛ ====================

test('Полный цикл: старт → заявки → голосование → дата → чтение → встреча → оценка → история', () => {
  const t = makeContext();
  const { ctx, fetchCalls, ss } = t;

  // 1. Старт
  ctx.handleTelegramUpdate(groupMsg('/start_cycle', MASHA));
  let c = t.cycle();
  assert.strictEqual(c.id, 1);
  assert.strictEqual(c.phase, 'submissions');
  const submitUntil = new Date(c.submitUntil);
  assert.strictEqual(submitUntil.getTime(), new Date(2026, 9, 23, 19, 0, 0).getTime(), 'заявки — 7 дней, до 23 октября 19:00');
  assert.strictEqual(submitUntil.getHours(), 19, 'срок — 19:00');
  const start = texts(chatMessages(fetchCalls)).find(x => x.includes('Цикл #1 начался'));
  assert.ok(start.includes('до 23 октября (пт), 19:00') && start.includes('/suggest_book Пикник на обочине — Стругацкие'));
  assert.ok(start.includes('просто нажми /suggest_book'), 'объяснено, что можно нажать команду без текста');
  const pinned = lastChat(fetchCalls);
  assert.ok(pinned.startsWith('📌 Цикл #1') && pinned.includes('Расписание обновляется само'));
  const pin = fetchCalls.find(x => x.url.endsWith('/pinChatMessage'));
  assert.ok(pin && pin.payload.message_id === c.pinnedMessageId || pin.payload.message_id === t.cycle().pinnedMessageId, 'расписание закреплено');

  ctx.handleTelegramUpdate(groupMsg('/start_process', ANTON));
  assert.ok(lastChat(fetchCalls).includes('Уже идёт цикл #1'), '/start_process — синоним, второй цикл не стартует');

  // 2. Заявки
  ctx.handleTelegramUpdate(groupMsg('/suggest_book Дюна', ANTON));
  ctx.handleTelegramUpdate(groupMsg('/suggest_book Мор', ANTON));
  ctx.handleTelegramUpdate(groupMsg('/suggest_book Шантарам', ANTON));
  assert.ok(lastChat(fetchCalls).includes('уже 2 заявки'), 'не больше 2 книг на человека');
  ctx.handleTelegramUpdate(groupMsg('/suggest_book дюна', MASHA));
  assert.ok(lastChat(fetchCalls).includes('уже есть в заявках'));
  ctx.handleTelegramUpdate(groupMsg('/suggest_book Пикник на обочине', MASHA));
  ctx.handleTelegramUpdate(privateMsg('/suggest_book Стоунер', VASYA));
  assert.ok(dmMessages(fetchCalls, 333).pop().payload.text.includes('«Стоунер» — в заявках'));
  ctx.handleTelegramUpdate(groupMsg('/books', OLYA));
  const books = lastChat(fetchCalls);
  assert.ok(books.includes('1. Дюна (от Антон)') && books.includes('4. Стоунер (от Вася)'));

  // Напоминание за сутки до конца заявок — один раз
  tickAt(t, c.submitUntil, -25 * HOUR);
  assert.ok(!lastChat(fetchCalls).includes('Последний день заявок'));
  tickAt(t, c.submitUntil, -23 * HOUR);
  assert.ok(lastChat(fetchCalls).includes('Последний день заявок') && lastChat(fetchCalls).includes('4 заявки'));
  tickAt(t, c.submitUntil, -22 * HOUR);
  assert.strictEqual(texts(chatMessages(fetchCalls)).filter(x => x.includes('Последний день заявок')).length, 1);

  // 3. Голосование
  tickAt(t, c.submitUntil, HOUR);
  c = t.cycle();
  assert.strictEqual(c.phase, 'voting');
  const votePoll = pollCalls(fetchCalls).pop();
  assert.deepStrictEqual(votePoll.payload.options, ['Дюна', 'Мор', 'Пикник на обочине', 'Стоунер'], 'в опросе — только названия, без имён');
  assert.strictEqual(votePoll.payload.is_anonymous, false, 'голосование за книгу публичное');
  assert.strictEqual(votePoll.payload.allows_multiple_answers, true);
  const voteHowTo = texts(chatMessages(fetchCalls)).find(x => x.includes('Шаг 2 из 5'));
  assert.ok(voteHowTo.includes('голоса видны всем') && voteHowTo.includes('Отменить голос') && voteHowTo.includes('можно несколько'));
  t.vote(c.votePolls[0].messageId, [1, 0, 3, 2]);

  tickAt(t, c.voteUntil, -23 * HOUR);
  assert.ok(lastChat(fetchCalls).includes('Голосование за книгу цикла #1 закрывается'));
  tickAt(t, c.voteUntil, 5 * 60 * 1000);
  c = t.cycle();
  assert.strictEqual(c.phase, 'scheduling');
  assert.deepStrictEqual(c.book, { title: 'Пикник на обочине', by: 'Маша', votes: 3 });
  assert.ok(['Антон', 'Вася'].includes(c.moderator), 'ведущий — не автор победившей книги');
  const chosen = texts(chatMessages(fetchCalls)).find(x => x.includes('Книга цикла #1'));
  assert.ok(chosen.includes('«Пикник на обочине»') && chosen.includes('голосов: 3') && chosen.includes('Ведущий встречи'));
  assert.ok(t.polls.get(c.votePolls[0].messageId).closed, 'опрос за книгу закрыт');

  // 4. Дата встречи: два опроса, суббота и воскресенье через ~5 недель
  const datePolls = pollCalls(fetchCalls).slice(-2);
  assert.ok(datePolls[0].payload.question.includes('суббота') && datePolls[1].payload.question.includes('воскресенье'));
  assert.strictEqual(datePolls[0].payload.options.length, 12);
  assert.strictEqual(datePolls[0].payload.allows_multiple_answers, true);
  const saturday = new Date(c.datePolls[0].date);
  const weeks = (saturday - new Date(t.clock.now)) / DAY / 7;
  assert.ok(weeks >= 4.9 && weeks <= 6, `встреча примерно через 5 недель, а не ${weeks}`);
  t.vote(c.datePolls[1].messageId, [0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0]); // воскресенье 15:00
  t.vote(c.datePolls[0].messageId, [0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0]); // суббота 12:00

  // Вопросы можно задавать, как только книга выбрана
  ctx.handleTelegramUpdate(groupMsg('/question Что такое Зона?', OLYA));
  ctx.handleTelegramUpdate(privateMsg('/question Почему Рэдрик пошёл к Шару?', MASHA));
  assert.ok(dmMessages(fetchCalls, 222).pop().payload.text.includes('сохранён (анонимно). Всего вопросов: 2'));

  tickAt(t, c.dateVoteUntil, 30 * 60 * 1000);
  c = t.cycle();
  assert.strictEqual(c.phase, 'reading');
  const meeting = new Date(c.meetingAt);
  assert.strictEqual(meeting.getUTCDay(), 0, 'победило воскресенье');
  assert.strictEqual(meeting.getUTCHours(), 15);
  assert.ok(lastChat(fetchCalls).includes('📌 Встреча по «Пикник на обочине» — воскресенье') && lastChat(fetchCalls).includes('15:00 (UTC+0)'));

  // 5. Чтение: чекпоинт на полпути, список вопросов за сутки, регламент за 2 часа
  tickAt(t, c.checkpointAt, -HOUR);
  assert.strictEqual(pollCalls(fetchCalls).filter(p => p.payload.question.includes('Полпути')).length, 0);
  tickAt(t, c.checkpointAt, 10 * 60 * 1000);
  tickAt(t, c.checkpointAt, 2 * HOUR);
  const checkpoints = pollCalls(fetchCalls).filter(p => p.payload.question.includes('Полпути'));
  assert.strictEqual(checkpoints.length, 1, 'чекпоинт — один раз');
  assert.strictEqual(checkpoints[0].payload.is_anonymous, true);

  tickAt(t, c.meetingAt, -23 * HOUR);
  const questionsMsg = lastChat(fetchCalls);
  assert.ok(questionsMsg.includes('Завтра встреча') && questionsMsg.includes('1. Что такое Зона?') && questionsMsg.includes('2. Почему Рэдрик'));
  assert.ok(questionsMsg.includes('docs.google.com'), 'ссылка на таблицу с вопросами');

  tickAt(t, c.meetingAt, -HOUR - 30 * 60 * 1000);
  const agenda = lastChat(fetchCalls);
  assert.ok(agenda.includes('Регламент') && agenda.includes(`Ведущий: ${c.moderator}`) && agenda.includes('60 мин'));
  tickAt(t, c.meetingAt, -HOUR);
  assert.strictEqual(texts(chatMessages(fetchCalls)).filter(x => x.includes('Регламент')).length, 1);

  // 6. После встречи — оценка
  tickAt(t, c.meetingAt, HOUR);
  assert.strictEqual(t.cycle().phase, 'reading', 'во время встречи оценку не шлём');
  tickAt(t, c.meetingAt, 2 * HOUR + 60 * 1000);
  c = t.cycle();
  assert.strictEqual(c.phase, 'rating');
  const ratingPoll = pollCalls(fetchCalls).pop();
  assert.ok(ratingPoll.payload.question.includes('Как тебе «Пикник на обочине»? Оценка от 1 до 5 (анонимно)'));
  assert.strictEqual(ratingPoll.payload.is_anonymous, true);
  assert.strictEqual(ratingPoll.payload.options.length, 5);
  t.vote(c.ratingPoll, [3, 1, 0, 0, 0]);

  tickAt(t, c.rateUntil, 10 * 60 * 1000);
  c = t.cycle();
  assert.strictEqual(c.phase, 'done');
  const summary = lastChat(fetchCalls);
  assert.ok(summary.includes('Средняя оценка: 4.8 из 5 (4 оценки)') && summary.includes('Вопросов к встрече: 2'));

  // 7. История — в видимом листе таблицы
  const history = ss.getSheetByName('История клуба');
  assert.ok(history && !history.hidden, 'лист «История клуба» видимый');
  const row = history.getRange(2, 1, 1, 9).getValues()[0];
  assert.deepStrictEqual([row[0], row[1], row[2], row[3], row[5], row[6], row[7]], [1, 'Пикник на обочине', 'Маша', 3, 4.8, 4, 2]);
  const questions = ss.getSheetByName('Вопросы к встрече');
  assert.ok(questions && !questions.hidden, 'лист «Вопросы к встрече» видимый');
  assert.strictEqual(questions.getRange(3, 4).getValue(), 'аноним', 'вопрос из лички — без имени');
  assert.ok(ss.getSheetByName('Заявки').hidden, 'служебный лист заявок скрыт');

  ctx.handleTelegramUpdate(groupMsg('/history', VASYA));
  assert.ok(lastChat(fetchCalls).includes('#1 «Пикник на обочине» — ⭐ 4.8'));

  // Следующий цикл
  ctx.handleTelegramUpdate(groupMsg('/start_cycle', VASYA));
  assert.strictEqual(t.cycle().id, 2);
  ctx.handleTelegramUpdate(groupMsg('/books', VASYA));
  assert.ok(lastChat(fetchCalls).includes('Заявок в цикле #2 пока нет'), 'заявки прошлого цикла не переезжают');
});

// ==================== ЭТАПЫ: КРАЙНИЕ СЛУЧАИ ====================

test('Нет заявок — приём продлевается; одна заявка — сразу выбрана без голосования', () => {
  const t = makeContext();
  t.ctx.handleTelegramUpdate(groupMsg('/start_cycle', MASHA));
  let c = t.cycle();
  tickAt(t, c.submitUntil, HOUR);
  assert.strictEqual(t.cycle().phase, 'submissions');
  assert.ok(lastChat(t.fetchCalls).includes('продлеваем приём'));

  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book Дюна', ANTON));
  c = t.cycle();
  tickAt(t, c.submitUntil, HOUR);
  c = t.cycle();
  assert.strictEqual(c.phase, 'scheduling');
  assert.strictEqual(c.book.title, 'Дюна');
  assert.strictEqual(c.moderator, 'Антон', 'других кандидатов в ведущие нет');
  assert.strictEqual(pollCalls(t.fetchCalls).length, 2, 'только опросы о дате');
});

test('13 заявок — два опроса (7 и 6), голоса суммируются; ничья решается жребием', () => {
  const t = makeContext();
  t.ctx.handleTelegramUpdate(groupMsg('/start_cycle', MASHA));
  for (let i = 0; i < 13; i++) {
    t.ctx.handleTelegramUpdate(groupMsg('/suggest_book Книга ' + i, { id: 1000 + i, first_name: 'Читатель' + i }));
  }
  let c = t.cycle();
  tickAt(t, c.submitUntil, HOUR);
  c = t.cycle();
  assert.strictEqual(c.votePolls.length, 2);
  assert.deepStrictEqual(c.votePolls.map(p => p.candidates.length), [7, 6]);
  assert.ok(pollCalls(t.fetchCalls)[0].payload.question.includes('опрос 1 из 2'));
  // Состояние цикла с максимумом заявок длиной 100 символов помещается в 9 КБ
  const big = makeContext();
  big.ctx.handleTelegramUpdate(groupMsg('/start_cycle', MASHA));
  for (let i = 0; i < 31; i++) {
    big.ctx.handleTelegramUpdate(groupMsg(`/suggest_book ${String(i).padStart(2, '0')} ` + 'я'.repeat(120), { id: 2000 + i, first_name: 'Ч' + i }));
  }
  assert.ok(lastChat(big.fetchCalls).includes('это максимум'));
  big.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  assert.ok(Buffer.byteLength(big.props.get('cycle'), 'utf8') < 9216, 'cycle помещается в лимит Script Properties');

  t.vote(c.votePolls[0].messageId, [0, 4, 0, 0, 0, 0, 0]); // Книга 1
  t.vote(c.votePolls[1].messageId, [0, 0, 0, 0, 0, 4]);    // Книга 12
  tickAt(t, c.voteUntil, HOUR);
  c = t.cycle();
  assert.ok(['Книга 1', 'Книга 12'].includes(c.book.title));
  assert.ok(texts(chatMessages(t.fetchCalls)).some(x => x.includes('ничья, бот бросил жребий')));
});

test('За время встречи никто не проголосовал — суббота, 12:00; /another_time сдвигает опросы на неделю', () => {
  const t = cycleWithSubmissions();
  let c = t.cycle();
  tickAt(t, c.submitUntil, HOUR);
  c = t.cycle();
  t.vote(c.votePolls[0].messageId, [5, 0, 0, 0]);
  tickAt(t, c.voteUntil, HOUR);
  c = t.cycle();
  const firstSaturday = new Date(c.datePolls[0].date);
  const oldPolls = c.datePolls.map(p => p.messageId);

  t.ctx.handleTelegramUpdate(groupMsg('/another_time', OLYA));
  c = t.cycle();
  assert.strictEqual(Math.round((new Date(c.datePolls[0].date) - firstSaturday) / DAY), 7);
  assert.ok(oldPolls.every(id => t.polls.get(id).closed), 'старые опросы закрыты');

  tickAt(t, c.dateVoteUntil, HOUR);
  c = t.cycle();
  const meeting = new Date(c.meetingAt);
  assert.strictEqual(meeting.getUTCDay(), 6);
  assert.strictEqual(meeting.getUTCHours(), 12);
  assert.ok(texts(chatMessages(t.fetchCalls)).some(x => x.includes('никто не проголосовал')));

  t.ctx.handleTelegramUpdate(groupMsg('/another_time', OLYA));
  assert.ok(lastChat(t.fetchCalls).includes('Сдвинуть дату можно, пока идёт выбор даты'));
});

test('/meeting_done: заранее — «ещё впереди»; в день встречи — сразу оценка, повтор молчит', () => {
  const t = cycleWithSubmissions();
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/set_meeting 20.12 15:00', ANTON));
  const c = t.cycle();
  assert.strictEqual(c.phase, 'reading');
  t.ctx.handleTelegramUpdate(groupMsg('/meeting_done', MASHA));
  assert.ok(lastChat(t.fetchCalls).includes('ещё впереди'));

  t.clock.set(new Date(c.meetingAt).getTime() + HOUR);
  t.ctx.handleTelegramUpdate(groupMsg('Встреча закончена!', MASHA));
  assert.strictEqual(t.cycle().phase, 'rating');
  const before = t.fetchCalls.length;
  t.ctx.handleTelegramUpdate(groupMsg('/meeting_done', VASYA));
  assert.strictEqual(t.fetchCalls.length, before, 'повтор — тишина');
});

test('Админ-команды: не админу — отказ; /skip двигает этап; /set_meeting фиксирует дату; /cancel_cycle отменяет', () => {
  const t = cycleWithSubmissions();
  t.ctx.handleTelegramUpdate(groupMsg('/skip', MASHA));
  assert.ok(lastChat(t.fetchCalls).includes('только для админов'));
  assert.strictEqual(t.cycle().phase, 'submissions');

  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  assert.strictEqual(t.cycle().phase, 'voting');

  t.ctx.handleTelegramUpdate(groupMsg('/set_meeting завтра', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('Сначала нужно выбрать книгу'));
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  assert.strictEqual(t.cycle().phase, 'scheduling');
  t.ctx.handleTelegramUpdate(groupMsg('/set_meeting 22.11', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('Формат: /set_meeting 22.11 12:00'));
  t.ctx.handleTelegramUpdate(groupMsg('/set_meeting 22.11 17:30', ANTON));
  const c = t.cycle();
  assert.strictEqual(c.phase, 'reading');
  assert.strictEqual(c.meetingAt, '2026-11-22T17:30:00.000Z');
  assert.ok(c.datePolls.every(p => t.polls.get(p.messageId).closed), 'опросы о дате закрыты');

  t.ctx.handleTelegramUpdate(groupMsg('/cancel_cycle', ANTON));
  assert.strictEqual(t.cycle().phase, 'done');
  assert.ok(lastChat(t.fetchCalls).includes('отменён'));
  t.ctx.handleTelegramUpdate(groupMsg('/start_cycle', MASHA));
  assert.strictEqual(t.cycle().id, 2);
});

test('/remove_book: убрать можно только свою заявку и только на этапе заявок', () => {
  const t = cycleWithSubmissions();
  t.ctx.handleTelegramUpdate(groupMsg('/remove_book 1', MASHA));
  assert.ok(lastChat(t.fetchCalls).includes('только свою'));
  t.ctx.handleTelegramUpdate(groupMsg('/remove_book 9', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('Укажи номер'));
  t.ctx.handleTelegramUpdate(groupMsg('/remove_book 1', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book Шантарам', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('твоих: 2 из 2'), 'после удаления можно предложить другую');
  t.ctx.handleTelegramUpdate(groupMsg('/books', OLYA));
  const list = lastChat(t.fetchCalls);
  assert.ok(!list.includes('Дюна') && list.includes('Шантарам'));
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/remove_book 1', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('только во время приёма заявок'));
});

test('Вне цикла: заявки и вопросы не принимаются, /status и /books подсказывают /start_cycle', () => {
  const t = makeContext();
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book Дюна', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('/start_cycle'));
  t.ctx.handleTelegramUpdate(groupMsg('/question Вопрос?', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('когда книга цикла уже выбрана'));
  t.ctx.handleTelegramUpdate(groupMsg('/status', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('Циклов ещё не было'));
  t.ctx.handleTelegramUpdate(groupMsg('/books', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('/start_cycle'));
  const n = t.fetchCalls.length;
  t.ctx.tick();
  assert.strictEqual(t.fetchCalls.length, n, 'tick без цикла ничего не делает');
});

test('/status показывает этап, все даты и подсказку, что делать', () => {
  const t = cycleWithSubmissions();
  t.ctx.handleTelegramUpdate(groupMsg('/status', OLYA));
  const s = lastChat(t.fetchCalls);
  assert.ok(s.includes('Сейчас: 📥 Приём заявок'));
  assert.ok(s.includes('👉 Заявки') && s.includes('▫️ Голосование'));
  assert.ok(s.includes('👉 Сейчас: предложи до 2 книг — /suggest_book'));
  assert.ok(s.includes('/guide'));
});

test('tick, вызванный дважды в одно время, не дублирует сообщения и опросы', () => {
  const t = cycleWithSubmissions();
  const c = t.cycle();
  t.clock.set(new Date(c.submitUntil).getTime() + HOUR);
  t.ctx.tick();
  const n = t.fetchCalls.length;
  t.ctx.tick();
  assert.strictEqual(t.fetchCalls.length, n);
});

// ==================== НАДЁЖНОСТЬ (по итогам ревью) ====================

test('Сбой Telegram при закрытии опроса: этап ждёт и повторяет, голоса не теряются и не превращаются в «0 + жребий»', () => {
  let failStop = true;
  const t = makeContext({
    telegramResponse: (url) => (failStop && url.endsWith('/stopPoll')) ? { ok: false, error_code: 502, description: 'Bad Gateway' } : null
  });
  t.ctx.handleTelegramUpdate(groupMsg('/start_cycle', MASHA));
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book Дюна', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book Мор', MASHA));
  let c = t.cycle();
  tickAt(t, c.submitUntil, HOUR);
  c = t.cycle();
  t.vote(c.votePolls[0].messageId, [0, 9]);
  tickAt(t, c.voteUntil, HOUR);
  assert.strictEqual(t.cycle().phase, 'voting', 'при сбое этап не закрывается');
  assert.ok(!texts(chatMessages(t.fetchCalls)).some(x => x.includes('бот бросил жребий')));
  failStop = false;
  tickAt(t, c.voteUntil, 2 * HOUR);
  c = t.cycle();
  assert.deepStrictEqual(c.book, { title: 'Мор', by: 'Маша', votes: 9 });
});

test('Ошибка посреди закрытия оценки: голоса сохранены, история записывается один раз и с правильной оценкой', () => {
  let failSheet = true;
  const t = cycleWithSubmissions();
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/set_meeting 20.12 15:00', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON)); // → оценка
  let c = t.cycle();
  assert.strictEqual(c.phase, 'rating');
  t.vote(c.ratingPoll, [2, 2, 0, 0, 0]);
  const realInsert = t.ss.insertSheet.bind(t.ss);
  t.ss.insertSheet = (name) => {
    if (failSheet && name === 'История клуба') { failSheet = false; throw new Error('Service unavailable'); }
    return realInsert(name);
  };
  assert.throws(() => tickAt(t, c.rateUntil, HOUR));
  assert.ok(t.polls.get(c.ratingPoll).closed);
  tickAt(t, c.rateUntil, 2 * HOUR); // опрос уже закрыт — голоса берутся из сохранённых
  c = t.cycle();
  assert.strictEqual(c.phase, 'done');
  const rows = t.ss.getSheetByName('История клуба').getRange(2, 1, t.ss.getSheetByName('История клуба').getLastRow() - 1, 9).getValues();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0][5], 4.5);
  assert.ok(lastChat(t.fetchCalls).includes('Средняя оценка: 4.5'));
});

test('/set_meeting: только до встречи, без несуществующих и прошедших дат', () => {
  const t = cycleWithSubmissions();
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/set_meeting 31.02 12:00', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('Такой даты нет'));
  t.ctx.handleTelegramUpdate(groupMsg('/set_meeting 20.12 25:99', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('Такой даты нет'));
  t.ctx.handleTelegramUpdate(groupMsg('/set_meeting 10.10 12:00', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('уже прошла'));
  assert.strictEqual(t.cycle().phase, 'scheduling');
  t.ctx.handleTelegramUpdate(groupMsg('/set_meeting 20.12 15:00', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON)); // → оценка
  t.ctx.handleTelegramUpdate(groupMsg('/set_meeting 27.12 15:00', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('только до встречи'));
  assert.strictEqual(t.cycle().phase, 'rating');
});

test('/another_time — не больше 2 раз за цикл', () => {
  const t = cycleWithSubmissions();
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  const first = new Date(t.cycle().datePolls[0].date);
  t.ctx.handleTelegramUpdate(groupMsg('/another_time', OLYA));
  t.ctx.handleTelegramUpdate(groupMsg('/another_time', VASYA));
  t.ctx.handleTelegramUpdate(groupMsg('/another_time', OLYA));
  assert.ok(lastChat(t.fetchCalls).includes('уже сдвигали 2 раза'));
  assert.strictEqual(Math.round((new Date(t.cycle().datePolls[0].date) - first) / DAY), 14);
});

test('«Встреча закончена» срабатывает только как отдельное сообщение и не раньше чем за час до начала', () => {
  const t = cycleWithSubmissions();
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/set_meeting 20.12 15:00', ANTON));
  const c = t.cycle();
  t.clock.set(new Date(c.meetingAt).getTime() - 3 * HOUR);
  t.ctx.handleTelegramUpdate(groupMsg('/meeting_done', MASHA));
  assert.ok(lastChat(t.fetchCalls).includes('ещё впереди'));
  t.clock.set(new Date(c.meetingAt).getTime() + 30 * 60 * 1000);
  t.ctx.handleTelegramUpdate(groupMsg('Встреча прошла бы веселее с пиццей', MASHA));
  assert.strictEqual(t.cycle().phase, 'reading', 'фраза, начинающаяся с триггера, — не команда');
  t.ctx.handleTelegramUpdate(groupMsg('встреча прошла 🎉', MASHA));
  assert.strictEqual(t.cycle().phase, 'rating');
});

test('/cancel_cycle закрывает и опрос-оценку; /status пишет, что цикл отменён', () => {
  const t = cycleWithSubmissions();
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/set_meeting 20.12 15:00', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  const c = t.cycle();
  t.ctx.handleTelegramUpdate(groupMsg('/cancel_cycle', ANTON));
  assert.ok(t.polls.get(c.ratingPoll).closed);
  t.ctx.handleTelegramUpdate(groupMsg('/status', OLYA));
  assert.ok(lastChat(t.fetchCalls).includes('был отменён'));
});

test('Дубли заявок не проходят из-за пробелов и кавычек; кавычки вокруг названия убираются', () => {
  const t = makeContext();
  t.ctx.handleTelegramUpdate(groupMsg('/start_cycle', MASHA));
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book «Мастер и Маргарита»', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book Мастер  и   маргарита', MASHA));
  assert.ok(lastChat(t.fetchCalls).includes('уже есть в заявках'));
  t.ctx.handleTelegramUpdate(groupMsg('/books', OLYA));
  assert.ok(lastChat(t.fetchCalls).includes('1. Мастер и Маргарита (от Антон)'));
});

test('Бот занят (блокировка не взялась) — честный ответ «попробуй ещё раз», а не «сохранено»', () => {
  let busy = false;
  const t = makeContext({ lockFails: () => busy });
  t.ctx.handleTelegramUpdate(groupMsg('/start_cycle', MASHA));
  busy = true;
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book Дюна', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('попробуй ещё раз'));
  busy = false;
  t.ctx.handleTelegramUpdate(groupMsg('/books', OLYA));
  assert.ok(lastChat(t.fetchCalls).includes('пока нет'));
});

test('Формула в названии не превращается в формулу таблицы', () => {
  const t = makeContext();
  t.ctx.handleTelegramUpdate(groupMsg('/start_cycle', MASHA));
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book =HYPERLINK("x")', ANTON));
  assert.strictEqual(String(t.ss.getSheetByName('Заявки').getRange(2, 5).getValue()).charAt(0), "'");
});

// ==================== ПРОСТОТА ДЛЯ УЧАСТНИКОВ ====================

test('Нажал /suggest_book без названия — бот просит прислать ответом, ответ становится заявкой', () => {
  const t = makeContext();
  t.ctx.handleTelegramUpdate(groupMsg('/start_cycle', MASHA));
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book', ANTON));
  const prompt = chatMessages(t.fetchCalls).pop();
  assert.ok(prompt.payload.text.includes('ответом на это сообщение'));
  assert.strictEqual(prompt.payload.reply_markup.force_reply, true);
  assert.strictEqual(prompt.payload.reply_markup.selective, true, 'поле ответа открывается только у того, кто нажал');
  assert.strictEqual(prompt.payload.reply_parameters.message_id, 77);

  const promptId = 500 + t.fetchCalls.filter(c => c.url.endsWith('/sendMessage') || c.url.endsWith('/sendPoll')).length - 1;
  const answer = (text, from, replyToId) => ({
    postData: { contents: JSON.stringify({ update_id: nextUpdateId++, message: { message_id: 90, chat: { id: Number(CLUB), type: 'supergroup' }, from, text, reply_to_message: { message_id: replyToId } } }) },
    parameter: { secret: 'test-secret' }
  });
  // Чужой ответ на тот же запрос — не заявка
  t.ctx.handleTelegramUpdate(answer('Чужая книга', MASHA, promptId));
  t.ctx.handleTelegramUpdate(answer('Дюна — Герберт', ANTON, promptId));
  assert.ok(lastChat(t.fetchCalls).includes('✅ «Дюна — Герберт» — в заявках'));
  // Повторный ответ на тот же запрос уже не считается заявкой
  t.ctx.handleTelegramUpdate(answer('Ещё одна', ANTON, promptId));
  t.ctx.handleTelegramUpdate(groupMsg('/books', OLYA));
  const list = lastChat(t.fetchCalls);
  assert.ok(list.includes('1. Дюна — Герберт (от Антон)') && !list.includes('Чужая') && !list.includes('Ещё одна'));
});

test('То же в личке: /question без текста → ответ → анонимный вопрос', () => {
  const t = cycleWithSubmissions();
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(privateMsg('/question', MASHA));
  const prompt = dmMessages(t.fetchCalls, 222).pop();
  assert.ok(prompt.payload.text.includes('Пришли вопрос'));
  const promptId = 500 + t.fetchCalls.filter(c => c.url.endsWith('/sendMessage') || c.url.endsWith('/sendPoll')).length - 1;
  t.ctx.handleTelegramUpdate({
    postData: { contents: JSON.stringify({ update_id: nextUpdateId++, message: { message_id: 6, chat: { id: 222, type: 'private' }, from: MASHA, text: 'Зачем автор так закончил книгу?', reply_to_message: { message_id: promptId } } }) },
    parameter: { secret: 'test-secret' }
  });
  assert.ok(dmMessages(t.fetchCalls, 222).pop().payload.text.includes('сохранён (анонимно)'));
  assert.strictEqual(t.ss.getSheetByName('Вопросы к встрече').getRange(2, 4).getValue(), 'аноним');
});

test('/guide — пошаговая инструкция со всеми шагами, форматом заявки и тем, как голосовать', () => {
  const t = makeContext();
  t.ctx.handleTelegramUpdate(groupMsg('/guide', ANTON));
  const g = lastChat(t.fetchCalls);
  for (const part of ['1️⃣ ЗАЯВКИ — 7 дней', '/suggest_book Пикник на обочине — Стругацкие', '/remove_book 2',
    '2️⃣ ГОЛОСОВАНИЕ — 3 дня', 'можно несколько', 'Голоса видны всем', 'Отменить голос', 'жребий',
    '3️⃣ ВРЕМЯ ВСТРЕЧИ — 2 дня', 'Отметь ВСЕ часы', 'UTC+0', '/another_time',
    '4️⃣ ЧТЕНИЕ', '/question', 'в личку', '5️⃣ ВСТРЕЧА И ОЦЕНКА', '(анонимно)', '/start_cycle']) {
    assert.ok(g.includes(part), `в инструкции есть «${part}»`);
  }
  assert.ok(g.length < 4096, 'влезает в одно сообщение Telegram');
  t.ctx.handleTelegramUpdate(privateMsg('/guide', STRANGER));
  assert.ok(dmMessages(t.fetchCalls, 999).pop().payload.text.includes('1️⃣ ЗАЯВКИ'));
  t.ctx.handleTelegramUpdate(groupMsg('/help', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('/guide'));
});

test('Закреплённое расписание обновляется на каждом этапе и открепляется в конце', () => {
  const t = cycleWithSubmissions();
  const pinnedId = t.cycle().pinnedMessageId;
  assert.ok(pinnedId);
  const edits = () => t.fetchCalls.filter(c => c.url.endsWith('/editMessageText'));
  let c = t.cycle();
  tickAt(t, c.submitUntil, -23 * HOUR); // только напоминание — расписание не меняется
  assert.strictEqual(edits().length, 0);
  tickAt(t, c.submitUntil, HOUR);
  assert.strictEqual(edits().length, 1);
  assert.strictEqual(edits()[0].payload.message_id, pinnedId);
  assert.ok(edits()[0].payload.text.includes('Сейчас: 🗳 Голосование за книгу') && edits()[0].payload.text.includes('✅ Заявки'));
  c = t.cycle();
  t.vote(c.votePolls[0].messageId, [0, 0, 3, 0]);
  tickAt(t, c.voteUntil, HOUR);
  assert.ok(edits().pop().payload.text.includes('«Пикник на обочине»'));
  t.ctx.handleTelegramUpdate(groupMsg('/set_meeting 20.12 15:00', ANTON));
  assert.ok(edits().pop().payload.text.includes('20 декабря'));
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  assert.strictEqual(t.cycle().phase, 'done');
  assert.ok(edits().pop().payload.text.includes('/start_cycle'));
  assert.ok(t.fetchCalls.some(x => x.url.endsWith('/unpinChatMessage') && x.payload.message_id === pinnedId));
});

test('Опрос не отправился — этап не закрывается «нулём голосов»: бот переотправляет и продлевает срок', () => {
  let pollsBroken = true;
  const t = makeContext({ telegramResponse: (url) => (pollsBroken && url.endsWith('/sendPoll')) ? { ok: false, description: 'Bad Request: polls are not allowed' } : null });
  t.ctx.handleTelegramUpdate(groupMsg('/start_cycle', MASHA));
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book Дюна', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book Мор', MASHA));
  let c = t.cycle();
  tickAt(t, c.submitUntil, HOUR);
  assert.ok(texts(chatMessages(t.fetchCalls)).some(x => x.includes('Не получилось отправить опрос')));
  c = t.cycle();
  tickAt(t, c.voteUntil, HOUR);
  assert.strictEqual(t.cycle().phase, 'voting', 'без опроса голосование не закрывается');
  assert.strictEqual(texts(chatMessages(t.fetchCalls)).filter(x => x.includes('Не получилось отправить опрос')).length, 1, 'предупреждение не спамится');
  pollsBroken = false;
  tickAt(t, c.voteUntil, 2 * HOUR);
  c = t.cycle();
  assert.strictEqual(c.phase, 'voting');
  assert.ok(c.votePolls[0].messageId, 'опрос отправлен заново');
  assert.ok(new Date(c.voteUntil).getTime() > t.clock.now + 20 * HOUR, 'срок продлён, чтобы успели проголосовать');
  assert.ok(lastChat(t.fetchCalls).includes('отправил его сейчас'));
  t.vote(c.votePolls[0].messageId, [0, 2]);
  tickAt(t, c.voteUntil, HOUR);
  assert.strictEqual(t.cycle().book.title, 'Мор');
});

test('Перенос встречи не присылает чекпоинт второй раз', () => {
  const t = cycleWithSubmissions();
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/set_meeting 20.12 15:00', ANTON));
  let c = t.cycle();
  tickAt(t, c.checkpointAt, 10 * 60 * 1000);
  t.ctx.handleTelegramUpdate(groupMsg('/set_meeting 27.12 15:00', ANTON));
  c = t.cycle();
  tickAt(t, c.checkpointAt, 10 * 60 * 1000);
  assert.strictEqual(pollCalls(t.fetchCalls).filter(p => p.payload.question.includes('Полпути')).length, 1);
});

test('Ответы на команды приходят ответом на сообщение человека', () => {
  const t = makeContext();
  t.ctx.handleTelegramUpdate(groupMsg('/start_cycle', MASHA));
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book Дюна', ANTON));
  assert.strictEqual(chatMessages(t.fetchCalls).pop().payload.reply_parameters.message_id, 77);
});

// ==================== СТАТИСТИКА ====================

test('/stats: топ книг, меньше всего зашла, чьи книги нравятся больше', () => {
  const t = makeContext();
  const sheet = t.ctx.getOrCreateDataSheet(vm.runInContext('DATA_SHEETS.HISTORY', t.ctx));
  const rows = [
    [1, 'Дюна', 'Антон', 3, new Date(), 4.5, 4, 5, 'Маша'],
    [2, 'Мор', 'Маша', 2, new Date(), 3.2, 5, 2, 'Вася'],
    [3, 'Стоунер', 'Вася', 4, new Date(), 4.9, 5, 7, 'Антон'],
    [4, 'Шантарам', 'Антон', 2, new Date(), 2.1, 3, 1, 'Оля'],
    [5, 'Без оценок', 'Оля', 1, new Date(), '', 0, 0, 'Антон']
  ];
  sheet.getRange(2, 1, rows.length, 9).setValues(rows);
  t.ctx.handleTelegramUpdate(groupMsg('/stats', ANTON));
  const s = lastChat(t.fetchCalls);
  assert.ok(s.includes('Прочитано книг: 5'));
  assert.ok(s.includes('Средняя оценка: 3.7'));
  assert.ok(s.includes('🥇 «Стоунер» — 4.9') && s.includes('🥈 «Дюна» — 4.5') && s.includes('🥉 «Мор» — 3.2'));
  assert.ok(s.includes('Меньше всего зашла: «Шантарам» — 2.1'));
  assert.ok(s.indexOf('Вася — 4.9') < s.indexOf('Антон — 3.3'), 'рейтинг вкусов по средней оценке');
  assert.ok(s.includes('Антон — 3.3 (2 книги)'));
});

test('/stats и /history без истории — понятный ответ', () => {
  const t = makeContext();
  t.ctx.handleTelegramUpdate(groupMsg('/stats', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('Статистики пока нет'));
  t.ctx.handleTelegramUpdate(groupMsg('/history', ANTON));
  assert.ok(lastChat(t.fetchCalls).includes('История клуба пока пуста'));
});

// ==================== ЛИЧКА, ВЕБХУК, СТАРЫЕ КОМАНДЫ ====================

test('Личка: участник — тихо, чужой — отказ; остальное — справка', () => {
  const t = cycleWithSubmissions();
  t.ctx.handleTelegramUpdate(privateMsg('/suggest_book Чужая', STRANGER));
  assert.ok(dmMessages(t.fetchCalls, 999).pop().payload.text.includes('только для участников'));
  t.ctx.handleTelegramUpdate(privateMsg('/start_cycle', STRANGER));
  assert.ok(dmMessages(t.fetchCalls, 999).pop().payload.text.includes('/question'));
  t.ctx.handleTelegramUpdate(groupMsg('/books', OLYA));
  assert.ok(!lastChat(t.fetchCalls).includes('Чужая'));
});

test('Вебхук: неверный secret, чужой чат, повтор update_id, битый JSON — без последствий; doPost ничего не возвращает', () => {
  const t = makeContext();
  const bad = groupMsg('/start_cycle', ANTON);
  bad.parameter.secret = 'wrong';
  assert.strictEqual(t.ctx.handleTelegramUpdate(bad), 'ignored');
  const foreign = { postData: { contents: JSON.stringify({ update_id: nextUpdateId++, message: { chat: { id: -100999 }, from: ANTON, text: '/start_cycle' } }) }, parameter: { secret: 'test-secret' } };
  assert.strictEqual(t.ctx.handleTelegramUpdate(foreign), 'ignored');
  assert.strictEqual(t.cycle(), null);

  const msg = groupMsg('/start_cycle', ANTON);
  t.ctx.handleTelegramUpdate(msg);
  t.ctx.handleTelegramUpdate(msg);
  t.ctx.handleTelegramUpdate(msg);
  assert.strictEqual(texts(chatMessages(t.fetchCalls)).length, 2, 'повтор того же update_id — без ответа (2 = анонс + расписание)');

  assert.strictEqual(t.ctx.handleTelegramUpdate({ postData: { contents: '{bad' }, parameter: { secret: 'test-secret' } }), 'error');
  assert.strictEqual(t.ctx.doPost(groupMsg('/status', ANTON)), undefined);
  assert.doesNotThrow(() => t.ctx.doPost({}));
});

test('Старые команды — вежливый ответ; команды другому боту — тишина; нигде нет Markdown', () => {
  const t = makeContext({ telegramResponse: (url) => url.endsWith('/getMe') ? { ok: true, result: { username: 'BookClubBot' } } : null });
  for (const cmd of ['/iam Антон', '/duel Маша', '/anon привет', '/book_vote']) {
    t.ctx.handleTelegramUpdate(groupMsg(cmd, ANTON));
  }
  assert.ok(texts(chatMessages(t.fetchCalls)).every(x => x.includes('больше не работает')));
  const n = chatMessages(t.fetchCalls).length;
  t.ctx.handleTelegramUpdate(groupMsg('/help@OtherBot', ANTON));
  assert.strictEqual(chatMessages(t.fetchCalls).length, n);
  t.ctx.handleTelegramUpdate(groupMsg('/help@bookclubbot', ANTON));
  const help = lastChat(t.fetchCalls);
  for (const cmd of ['/start_cycle', '/status', '/suggest_book', '/question', '/history', '/stats', '/skip']) {
    assert.ok(help.includes(cmd), cmd);
  }
  for (const c of messageCalls(t.fetchCalls)) {
    assert.strictEqual(c.payload.parse_mode, undefined);
  }
});

test('Тексты от людей: Markdown-символы вычищены, длинные названия с эмодзи обрезаются без поломки', () => {
  const t = makeContext();
  t.ctx.handleTelegramUpdate(groupMsg('/start_cycle', MASHA));
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book ' + '*Книга*_' + 'а'.repeat(140) + '📚📚📚', ANTON));
  t.ctx.handleTelegramUpdate(groupMsg('/suggest_book Вторая', MASHA));
  t.ctx.handleTelegramUpdate(groupMsg('/skip', ANTON));
  const option = pollCalls(t.fetchCalls)[0].payload.options[0];
  assert.ok(option.startsWith('Книгаааа') && option.length <= 100);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(option));
});

// ==================== УСТАНОВКА ====================

test('setupBot: ежечасный tick вместо старых триггеров, меню команд, чистка старых данных, анонс один раз', () => {
  const t = makeContext({ triggers: ['sendWeeklyReport', 'tick', 'someOtherTrigger'] });
  for (const key of ['telegramMembers', 'duels', 'lastMeetingCommandAt', 'lastProposedMeetingDate']) t.props.set(key, '{}');

  assert.strictEqual(t.ctx.setupBot(), true);
  assert.deepStrictEqual(t.deletedTriggers.sort(), ['sendWeeklyReport', 'tick']);
  assert.deepStrictEqual(t.createdTriggers, [{ name: 'tick', everyHours: 1 }]);
  for (const key of ['telegramMembers', 'duels', 'lastMeetingCommandAt', 'lastProposedMeetingDate']) {
    assert.ok(!t.props.has(key), `${key} удалён`);
  }
  const setCommands = t.fetchCalls.filter(c => c.url.endsWith('/setMyCommands'));
  assert.strictEqual(setCommands.length, 2);
  const names = setCommands[0].payload.commands.map(c => c.command);
  for (const cmd of ['status', 'start_cycle', 'suggest_book', 'books', 'question', 'questions', 'history', 'stats', 'help']) {
    assert.ok(names.includes(cmd), cmd);
  }
  for (const c of setCommands[0].payload.commands.concat(setCommands[1].payload.commands)) {
    assert.ok(/^[a-z0-9_]{1,32}$/.test(c.command));
  }
  const announce = lastChat(t.fetchCalls);
  assert.ok(announce.includes('/start_cycle') && announce.includes('/question') && announce.includes('/stats'));

  t.fetchCalls.length = 0;
  assert.strictEqual(t.ctx.setupBot(), false, 'второй раз анонс не шлётся');
  assert.strictEqual(chatMessages(t.fetchCalls).length, 0);
  assert.strictEqual(t.createdTriggers.length, 2, 'триггер пересоздаётся, а не копится');
  assert.strictEqual(t.ctx.resendAnnouncement(), true);
});

test('setupTelegramWebhook: адрес из WEB_APP_URL с secret; пустой адрес — понятная ошибка', () => {
  const t = makeContext();
  t.ctx.setupTelegramWebhook();
  const setWebhook = t.fetchCalls.find(c => c.url.endsWith('/setWebhook')).payload;
  assert.strictEqual(setWebhook.url, 'https://script.google.com/macros/s/TEST/exec?secret=test-secret');
  assert.deepStrictEqual(setWebhook.allowed_updates, ['message', 'callback_query'], 'без вебхука на каждый голос в опросах');
  assert.throws(() => t.ctx.setupTelegramWebhook('ВАШ_URL_ВЕБ_ПРИЛОЖЕНИЯ'), /WEB_APP_URL не задан/);
});

console.log(`\n${passed} тестов прошло${process.exitCode ? ', есть ошибки' : ', ошибок нет'}`);
