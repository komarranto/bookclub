// ==================== НАСТРОЙКИ ====================
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
const BOT_VERSION = '2026.10.01-1';

// Настройки структуры таблицы (минимальные - остальное определяется автоматически)
const CONFIG = {
  // Левая часть: трекер чтения
  membersRow: 1,           // Строка с именами участников
  membersStartColumn: 2,   // B - первая колонка участников
  datesColumn: 1,          // A - колонка с датами
  checkboxesStartRow: 2,   // Первая строка с чекбоксами

  // Правая часть: информация о книгах (ищем по заголовкам)
  booksSectionStartColumn: 9,  // I - начало правой секции (ищем "Основная книга")
};

// Приветствие под шапкой — по дню недели (индекс = Date.getDay(), 0 = воскресенье)
const WEEKDAY_GREETINGS = [
  'Воскресенье — отличный день дочитать то, что давно лежит закладкой 📖',
  'Новая неделя — новые страницы! 💪',
  'Вторник — ещё один шаг ближе к финалу книги ✨',
  'Погружаемся ещё глубже в сюжет 🌊',
  'Почти получилось! Ещё пара глав — и день закрыт 🔥',
  'Пятница! Можно почитать подольше вечером 🌙',
  'Суббота — время для книги и чая ☕'
];

// Случайная цитата о книгах/чтении в подвале сообщения
const READING_QUOTES = [
  '«Книги — корабли мысли, странствующие по волнам времени» — Фрэнсис Бэкон',
  '«Чтение — это разговор с самыми умными людьми прошлых веков» — Рене Декарт',
  '«Кто много читает, тот много знает» — народная мудрость',
  '«Книга — это друг, который никогда не предаёт» — неизвестный автор',
  '«Читать — значит открывать двери в тысячи миров» — неизвестный автор',
  '«Всё, что тебя когда-либо волновало, уже кто-то описал в книге» — Джеймс Болдуин',
  '«Хорошая книга — это ещё не всё, но без неё нет ничего» — Умберто Эко',
  '«Один час чтения — час, украденный у скуки» — Виктор Гюго',
  '«Читать — значит расти в несколько раз быстрее, чем позволяет собственная жизнь» — неизвестный автор',
  '«Книги — это пчёлы, которые несут цветочную пыльцу от одного ума к другому» — Джеймс Расселл Лоуэлл'
];

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

// ==================== ИГРОВЫЕ МЕХАНИКИ — НАСТРОЙКИ ====================
// Подробности — в секции "ИГРОВЫЕ МЕХАНИКИ" ниже и в README.

// Заморозка стрика (как в Duolingo): за каждые 7 дней стрика — одна
// заморозка, она автоматически спасает стрик при пропущенном дне.
const STREAK_FREEZE_EVERY_DAYS = 7;
const STREAK_MAX_FREEZES = 2;          // больше двух копить нельзя
// Сколько последних спринтов просматривать при подсчёте стрика —
// ограничение, чтобы ежедневный отчёт не упирался в лимит времени Apps Script
const STREAK_HISTORY_MAX_SHEETS = 40; // ~1,5 года при спринтах по 14 дней

// Камбэк: перерыв минимум 3 дня, потом минимум 3 дня чтения подряд
const COMEBACK_MIN_GAP_DAYS = 3;
const COMEBACK_MIN_RUN_DAYS = 3;

// Дуэли
const DUEL_LENGTH_DAYS = 7;
const DUEL_ACCEPT_TIMEOUT_MS = 24 * 60 * 60 * 1000; // вызов действует сутки
const DUEL_FORFEITS = [
  'пишет в чат цитату из книги победителя',
  'рассказывает в чате о своей книге в трёх предложениях',
  'советует победителю книгу',
  'выбирает десерт к следующей встрече'
];

// Тайные напарники и анонимные послания
// Минимум 4: при трёх по кругу подопечный сразу вычисляет опекуна
// («тот, кто не я и не мой подопечный») — и анонимки перестают быть анонимными
const SECRET_PARTNERS_MIN_MEMBERS = 4;
const ANON_DAILY_LIMIT = 5;            // анонимных посланий на человека в день

// Пользовательский текст (цитаты, вопросы, послания, книги)
const USER_TEXT_MAX_LENGTH = 500;
// Голосование за следующую книгу
const BOOK_VOTE_MAX_OPTIONS = 10;

// Скрытые служебные листы с данными игровых механик
// (имена не матчатся regex'ом Fortnight — в отчёт не попадают)
const GAME_SHEETS = {
  QUOTES: { name: 'Quotes', headers: ['Дата', 'Автор', 'Цитата', 'Показана'] },
  QUESTIONS: { name: 'Questions', headers: ['Дата', 'Автор', 'Книга', 'Вопрос', 'Опубликован'] },
  SUGGESTIONS: { name: 'BookSuggestions', headers: ['Дата', 'Автор', 'Книга', 'Статус'] }
};

const RU_MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                            'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// ==================== РАБОТА С ЛИСТАМИ ====================

/**
 * Найти все листы Fortnight и вернуть отсортированные по номеру (убывание)
 */
function getFortnightSheets() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const allSheets = spreadsheet.getSheets();

  const fortnightSheets = [];

  for (const sheet of allSheets) {
    const name = sheet.getName();
    // Ищем листы с названием "Fortnight XX" или "Fortnite XX"
    const match = name.match(/Fortni(?:ght|te)\s*(\d+)/i);
    if (match) {
      fortnightSheets.push({
        sheet: sheet,
        number: parseInt(match[1]),
        name: name
      });
    }
  }

  // Сортируем по номеру (убывание)
  fortnightSheets.sort((a, b) => b.number - a.number);

  return fortnightSheets;
}

/**
 * Получить актуальный лист (с максимальным номером)
 */
function getCurrentSheet() {
  const sheets = getFortnightSheets();
  if (sheets.length === 0) {
    throw new Error('Не найдено листов Fortnight!');
  }
  return sheets[0];
}

// ==================== ЧТЕНИЕ ДАННЫХ ====================

/**
 * Динамически найти участников (до первой пустой ячейки в строке 1)
 */
function getMembers(sheet) {
  const members = [];
  let col = CONFIG.membersStartColumn;

  while (true) {
    const name = sheet.getRange(CONFIG.membersRow, col).getValue();
    if (!name || !name.toString().trim()) {
      break; // Пустая ячейка — конец списка участников
    }
    members.push({ name: name.toString().trim(), column: col });
    col++;

    // Защита от бесконечного цикла
    if (col > 50) break;
  }

  return members;
}

/**
 * Динамически определить количество дней в спринте (по датам в колонке A)
 */
function getSprintDaysCount(sheet) {
  let row = CONFIG.checkboxesStartRow;
  let count = 0;

  while (true) {
    const dateValue = sheet.getRange(row, CONFIG.datesColumn).getValue();
    if (!dateValue) {
      break; // Пустая ячейка — конец дат
    }
    count++;
    row++;

    // Защита от бесконечного цикла
    if (row > 100) break;
  }

  return count;
}

/**
 * Получить чекбоксы чтения для участника (динамическое количество дней)
 */
function getCheckboxesForMember(sheet, memberColumn, daysCount) {
  if (!daysCount) {
    daysCount = getSprintDaysCount(sheet);
  }

  if (daysCount === 0) return [];

  const range = sheet.getRange(CONFIG.checkboxesStartRow, memberColumn, daysCount, 1);
  return range.getValues().map(row => row[0] === true);
}

/**
 * Найти колонку участника по имени на любом листе
 */
function findMemberColumn(sheet, memberName) {
  let col = CONFIG.membersStartColumn;

  while (col <= 50) {
    const name = sheet.getRange(CONFIG.membersRow, col).getValue();
    if (!name || !name.toString().trim()) {
      break;
    }
    if (name.toString().trim().toLowerCase() === memberName.toLowerCase()) {
      return col;
    }
    col++;
  }

  return null; // Участник не найден на этом листе
}

/**
 * Рассчитать стрик с учётом предыдущих спринтов
 * Ищем участника по ИМЕНИ на каждом листе (а не по номеру колонки)
 * Стрик считается от последнего отмеченного дня назад.
 * Учитывает заморозки — см. calculateStreakInfo.
 */
function calculateStreak(memberName, fortnightSheets) {
  return calculateStreakInfo(memberName, fortnightSheets).streak;
}

/**
 * Стрик с заморозками.
 *
 * 1. Идём от сегодняшнего дня назад и по имени участника переходим на
 *    предыдущие листы. Будущие дни текущего спринта не смотрим, сегодняшний
 *    неотмеченный — тоже (ещё успеют отметить). А вот прошедший
 *    неотмеченный день — это пропуск. (Раньше любые неотмеченные дни в
 *    конце спринта считались будущими, и стрик не сгорал, даже если человек
 *    перестал читать неделю назад.) Если даты в листе не читаются —
 *    работает старое правило.
 * 2. Собираем историю, пока не встретим перерыв длиннее, чем можно закрыть
 *    заморозками (STREAK_MAX_FREEZES) — дальше стрик точно не тянется.
 * 3. Проигрываем эту историю вперёд: каждые STREAK_FREEZE_EVERY_DAYS дней
 *    стрика дают заморозку, пропущенный день съедает заморозку (стрик
 *    сохраняется, но не растёт), без заморозки — стрик обнуляется.
 *
 * Без заработанных заморозок результат совпадает со старым подсчётом.
 * Возвращает { streak, freezes (сколько осталось), freezesUsed (сколько
 * пропусков закрыто заморозкой в текущем стрике) }.
 */
function calculateStreakInfo(memberName, fortnightSheets) {
  const newestFirst = [];
  let started = false;
  let datesApplied = false;
  let gap = 0;

  outer:
  for (let s = 0; s < fortnightSheets.length && s < STREAK_HISTORY_MAX_SHEETS; s++) {
    const sheetInfo = fortnightSheets[s];
    const memberColumn = findMemberColumn(sheetInfo.sheet, memberName);
    if (!memberColumn) break; // участника нет на этом листе — история кончилась

    const daysCount = getSprintDaysCount(sheetInfo.sheet);
    let checkboxes = getCheckboxesForMember(sheetInfo.sheet, memberColumn, daysCount);

    // Первый лист с читаемыми датами, где уже наступил хоть один день:
    // берём только наступившие дни. Лист целиком в будущем (следующий
    // спринт создали заранее) пропускаем.
    if (!datesApplied && getDaysLeftInSprint(sheetInfo.sheet) >= 0) {
      const elapsed = getElapsedDaysCount(sheetInfo.sheet, daysCount);
      if (elapsed === 0) continue;
      datesApplied = true;
      checkboxes = checkboxes.slice(0, elapsed);
      if (checkboxes.length > 0 && checkboxes[checkboxes.length - 1] === false) {
        checkboxes.pop(); // сегодня ещё не отметился — не пропуск
      }
      started = true; // дальше каждый неотмеченный день — пропуск
    }
    datesApplied = true; // старое правило — только для самого свежего листа

    for (let i = checkboxes.length - 1; i >= 0; i--) {
      if (checkboxes[i]) {
        started = true;
        gap = 0;
        newestFirst.push(true);
      } else if (started) {
        gap++;
        if (gap > STREAK_MAX_FREEZES) break outer; // такой перерыв не закрыть
        newestFirst.push(false);
      }
      // ещё не встретили отмеченный день — это будущие дни, пропускаем
    }
  }

  // Пропуски в самом начале истории ни на что не влияют
  while (newestFirst.length > 0 && newestFirst[newestFirst.length - 1] === false) {
    newestFirst.pop();
  }

  let streak = 0;
  let freezes = 0;
  let freezesUsed = 0;
  for (let i = newestFirst.length - 1; i >= 0; i--) {
    if (newestFirst[i]) {
      streak++;
      if (streak % STREAK_FREEZE_EVERY_DAYS === 0 && freezes < STREAK_MAX_FREEZES) {
        freezes++;
      }
    } else if (freezes > 0) {
      freezes--;
      freezesUsed++;
    } else {
      streak = 0;
      freezesUsed = 0;
    }
  }

  return { streak, freezes, freezesUsed };
}

/**
 * Получить данные о чтении для всех участников
 */
function getReadingData(currentSheet, fortnightSheets) {
  const members = getMembers(currentSheet.sheet);
  const daysCount = getSprintDaysCount(currentSheet.sheet);
  const results = [];

  for (const member of members) {
    const checkboxes = getCheckboxesForMember(currentSheet.sheet, member.column, daysCount);

    const daysRead = checkboxes.filter(x => x).length;
    const totalDays = checkboxes.length;
    const percentage = totalDays > 0 ? Math.round((daysRead / totalDays) * 100) : 0;

    // Стрик — ищем по ИМЕНИ (с учётом заморозок)
    const streakInfo = calculateStreakInfo(member.name, fortnightSheets);

    results.push({
      name: member.name,
      daysRead: daysRead,
      totalDays: totalDays,
      percentage: percentage,
      streak: streakInfo.streak,
      freezes: streakInfo.freezes,
      freezesUsed: streakInfo.freezesUsed,
      checkboxes: checkboxes
    });
  }

  // Сортируем по проценту (убывание), при равенстве — по стрику
  results.sort((a, b) => {
    if (b.percentage !== a.percentage) {
      return b.percentage - a.percentage;
    }
    return b.streak - a.streak;
  });

  return results;
}

/**
 * Средний процент прочтения по клубу на конкретном листе спринта
 * (без стриков — они тут не нужны, только для сравнения "спринт к спринту")
 */
function getSprintAveragePercent(sheetInfo) {
  const members = getMembers(sheetInfo.sheet);
  const daysCount = getSprintDaysCount(sheetInfo.sheet);

  if (members.length === 0 || daysCount === 0) return null;

  let totalPercent = 0;
  for (const member of members) {
    const checkboxes = getCheckboxesForMember(sheetInfo.sheet, member.column, daysCount);
    if (checkboxes.length === 0) continue;
    totalPercent += (checkboxes.filter(x => x).length / checkboxes.length) * 100;
  }

  return Math.round(totalPercent / members.length);
}

/**
 * Найти секцию с книгами (ищем заголовок "Основная книга" или похожий)
 */
function findBooksSection(sheet) {
  // Ищем в первых 5 строках, колонки I-P
  for (let row = 1; row <= 5; row++) {
    for (let col = CONFIG.booksSectionStartColumn; col <= 16; col++) {
      const value = sheet.getRange(row, col).getValue().toString().toLowerCase();
      if (value.includes('основная книга') || value.includes('общая книга')) {
        return { row: row, col: col };
      }
    }
  }
  return null;
}

/**
 * Получить информацию о книгах участников (динамически)
 */
function getBooksData(sheet) {
  const section = findBooksSection(sheet);
  if (!section) {
    Logger.log('⚠️ Секция книг не найдена');
    return [];
  }

  const books = [];
  const nameCol = section.col;       // J - имена
  const bookCol = section.col + 1;   // K - книги
  const finishedCol = section.col + 2; // L - чекбокс

  // Ищем строку с первым участником (пропускаем заголовки)
  let startRow = section.row + 1;

  // Пропускаем строки "Общая книга" и "Дата обсуждения"
  while (startRow <= section.row + 10) {
    const cellValue = sheet.getRange(startRow, nameCol).getValue().toString().toLowerCase();
    if (cellValue && !cellValue.includes('книга') && !cellValue.includes('дата') && !cellValue.includes('спринт')) {
      break;
    }
    startRow++;
  }

  // Читаем участников (пропускаем пустые строки из-за объединённых ячеек)
  let row = startRow;
  let emptyCount = 0;

  while (row <= startRow + 30 && emptyCount < 5) {
    const name = sheet.getRange(row, nameCol).getValue();

    if (!name || !name.toString().trim()) {
      emptyCount++;
      row++;
      continue;
    }

    // Пропускаем заголовки
    const nameLower = name.toString().toLowerCase();
    if (nameLower.includes('книга') || nameLower.includes('дата') || nameLower.includes('спринт')) {
      row++;
      continue;
    }

    emptyCount = 0;

    const book = sheet.getRange(row, bookCol).getValue();
    const finished = sheet.getRange(row, finishedCol).getValue();

    books.push({
      name: name.toString().trim(),
      book: book || 'Не указана',
      finishedCommonBook: finished === true
    });

    row++;
  }

  return books;
}

/**
 * Получить информацию об общей книге (динамически)
 */
function getCommonBookInfo(sheet) {
  const section = findBooksSection(sheet);
  if (!section) {
    return { title: 'Не указана', discussionDate: 'Не указана' };
  }

  // Общая книга обычно в той же строке, что и заголовок, или на 1 ниже
  // Ищем строки с "Общая книга" и "Дата обсуждения"
  let commonBookTitle = 'Не указана';
  let discussionDate = 'Не указана';

  for (let row = section.row; row <= section.row + 5; row++) {
    const label = sheet.getRange(row, section.col).getValue().toString().toLowerCase();
    const value = sheet.getRange(row, section.col + 1).getValue();

    if (label.includes('общая книга')) {
      commonBookTitle = value || 'Не указана';
    }
    if (label.includes('дата')) {
      discussionDate = value || 'Не указана';
    }
  }

  return { title: commonBookTitle, discussionDate: discussionDate };
}

// ==================== ФОРМАТИРОВАНИЕ СООБЩЕНИЯ ====================

/**
 * Создать прогресс-бар
 */
function createProgressBar(percentage, length = 10) {
  const filled = Math.round((percentage / 100) * length);
  const empty = length - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Получить эмодзи для стрика
 */
function getStreakEmoji(streak) {
  if (streak >= 30) return '🌟';
  if (streak >= 14) return '💎';
  if (streak >= 7) return '🔥';
  if (streak >= 3) return '⚡';
  return '';
}

/**
 * Получить сегодняшнюю дату в формате "Понедельник, 18.01"
 */
function getTodayFormatted() {
  const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const now = new Date();
  const dayName = days[now.getDay()];
  const day = now.getDate().toString().padStart(2, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  return `${dayName}, ${day}.${month}`;
}

/**
 * Проверить, является ли сегодня последним днём спринта
 */
function isLastDayOfSprint(sheet) {
  return getDaysLeftInSprint(sheet) === 0;
}

/**
 * Получить количество дней до конца спринта
 */
function getDaysLeftInSprint(sheet) {
  const daysCount = getSprintDaysCount(sheet);
  if (daysCount === 0) return -1;

  // Получаем последнюю дату спринта
  const lastDateCell = sheet.getRange(CONFIG.checkboxesStartRow + daysCount - 1, CONFIG.datesColumn).getValue();
  if (!lastDateCell) return -1;

  // parseSheetDate понимает и настоящие даты, и текст '06.01.2026'
  // (new Date('05.11.2026') в JavaScript — это 11 мая, а не 5 ноября)
  const lastDate = parseSheetDate(lastDateCell);
  if (!lastDate) return -1;
  const today = new Date();

  // Обнуляем время для корректного сравнения
  lastDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  const diffTime = lastDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
}

/**
 * Сформировать еженедельное сообщение (красивый дизайн)
 */
function formatWeeklyMessage(readingData, booksData, commonBook, sprintName, isLastDay = false, daysLeft = -1, previousAvg = null, memberQuote = null) {
  let msg = '';

  // Формируем строку с датой и оставшимися днями
  let dateString = getTodayFormatted();
  if (daysLeft >= 0) {
    if (daysLeft === 0) {
      dateString += '\n   (последний день спринта!)';
    } else if (daysLeft === 1) {
      dateString += '\n   (остался 1 день до конца спринта)';
    } else if (daysLeft >= 2 && daysLeft <= 4) {
      dateString += `\n   (осталось ${daysLeft} дня до конца спринта)`;
    } else {
      dateString += `\n   (осталось ${daysLeft} дней до конца спринта)`;
    }
  }

  // Заголовок
  msg += '═══════════════════════\n';
  msg += `       📚 *КНИЖНЫЙ КЛУБ*\n`;
  msg += `              ${sprintName}\n`;
  msg += `   ${dateString}\n`;
  msg += '═══════════════════════\n';
  msg += `_${WEEKDAY_GREETINGS[new Date().getDay()]}_\n\n`;

  // Сравнение со средним прошлого спринта (если есть с чем сравнивать)
  if (previousAvg !== null && readingData.length > 0) {
    const currentAvg = Math.round(
      readingData.reduce((sum, m) => sum + m.percentage, 0) / readingData.length
    );
    const diff = currentAvg - previousAvg;
    const arrow = diff > 0 ? '🔺' : diff < 0 ? '🔻' : '▪️';
    const diffText = diff > 0 ? `+${diff}` : `${diff}`;
    msg += `${arrow} *${diffText}%* к прошлому спринту (было ${previousAvg}%, сейчас ${currentAvg}%)\n\n`;
  }

  // Лидер спринта (выделяем особо)
  if (readingData.length > 0) {
    const leader = readingData[0];
    msg += '🏆 *ЛИДЕР СПРИНТА*\n';
    msg += `┌─────────────────────┐\n`;
    msg += `│  ${leader.name}\n`;
    msg += `│  ${createProgressBar(leader.percentage)} ${leader.percentage}%\n`;
    if (leader.streak >= 3) {
      msg += `│  ${getStreakEmoji(leader.streak)} ${leader.streak} дней подряд!\n`;
    }
    msg += `└─────────────────────┘\n\n`;
  }

  // Рейтинг участников
  msg += '📊 *РЕЙТИНГ ЧТЕНИЯ*\n';
  msg += '┌─────────────────────┐\n';

  const medals = ['🥇', '🥈', '🥉'];

  for (let i = 0; i < readingData.length; i++) {
    const m = readingData[i];
    const medal = i < 3 ? medals[i] : `${i + 1}.`;
    const bar = createProgressBar(m.percentage, 8);
    const streakEmoji = getStreakEmoji(m.streak);
    const streakText = m.streak >= 3 ? ` ${streakEmoji}${m.streak}` : '';
    const freezeText = m.freezes > 0 ? ` 🧊${m.freezes}` : '';

    msg += `│ ${medal} *${m.name}*\n`;
    msg += `│    ${bar} ${m.percentage}% (${m.daysRead}/${m.totalDays})${streakText}${freezeText}\n`;

    // Разделитель между участниками (кроме последнего)
    if (i < readingData.length - 1) {
      msg += `│ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n`;
    }
  }

  msg += '└─────────────────────┘\n\n';

  // Общая книга клуба
  msg += '📖 *ОБЩАЯ КНИГА*\n';
  msg += '┌─────────────────────┐\n';
  msg += `│ 📕 ${commonBook.title}\n`;
  msg += `│ 📅 ${commonBook.discussionDate}\n`;

  // Прогресс по общей книге
  const finished = booksData.filter(b => b.finishedCommonBook);
  const finishedCount = finished.length;
  const totalCount = booksData.length;
  const finishedPercent = totalCount > 0 ? Math.round((finishedCount / totalCount) * 100) : 0;

  msg += `│\n`;
  msg += `│ ✅ Дочитали: ${finishedCount}/${totalCount}\n`;
  msg += `│ ${createProgressBar(finishedPercent)}\n`;

  if (finishedCount > 0) {
    msg += `│ (${finished.map(b => b.name).join(', ')})\n`;
  }

  msg += '└─────────────────────┘\n\n';

  // Кто что читает
  msg += '📚 *СЕЙЧАС ЧИТАЮТ*\n';
  msg += '┌─────────────────────┐\n';

  for (let i = 0; i < booksData.length; i++) {
    const b = booksData[i];
    const checkmark = b.finishedCommonBook ? ' ✓' : '';

    msg += `│ 👤 *${b.name}*${checkmark}\n`;
    msg += `│    _${b.book}_\n`;

    if (i < booksData.length - 1) {
      msg += `│\n`;
    }
  }

  msg += '└─────────────────────┘\n\n';

  // Подпись
  msg += '═══════════════════════\n';
  if (memberQuote) {
    // Цитата от участника (/quote). Текст уже очищен от символов Markdown
    // при сохранении, но в курсив его не оборачиваем — так надёжнее.
    msg += `💬 «${memberQuote.text}»\n— прислал(а) ${memberQuote.name}\n\n`;
  } else {
    const quote = READING_QUOTES[Math.floor(Math.random() * READING_QUOTES.length)];
    msg += `_${quote}_\n\n`;
  }
  msg += '    _Приятного чтения!_ 📖\n';
  if (isLastDay) {
    msg += '\n⚠️ *Внимание, последний день спринта!*\n';
  }
  msg += '═══════════════════════';

  return msg;
}

// ==================== TELEGRAM ====================

/**
 * Отправить сообщение в Telegram
 */
function sendTelegramMessage(message, parseMode = 'Markdown', extra = {}) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  // extra.chatId — написать не в чат клуба, а в личку участнику
  // extra.noButton — без кнопки «Открыть таблицу» (короткие ответы на команды)
  // extra.replyMarkup — своя клавиатура (например, кнопка «Принять дуэль»)
  const payload = {
    chat_id: extra.chatId || TELEGRAM_CHAT_ID,
    text: message
  };
  if (extra.replyMarkup) {
    payload.reply_markup = extra.replyMarkup;
  } else if (!extra.noButton) {
    payload.reply_markup = {
      inline_keyboard: [[
        { text: '📊 Открыть таблицу', url: SpreadsheetApp.getActiveSpreadsheet().getUrl() }
      ]]
    };
  }
  // Служебные сообщения с /командами (в них подчёркивания) шлём без Markdown —
  // иначе Telegram отвечает "can't parse entities" и сообщение не уходит.
  if (parseMode) {
    payload.parse_mode = parseMode;
  }

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());

    if (result.ok) {
      Logger.log('✅ Сообщение отправлено!');
    } else {
      Logger.log('❌ Ошибка Telegram: ' + result.description);
      // Например, имя с «_» в таблице ломает Markdown — тогда лучше
      // отправить без форматирования, чем не отправить вовсе
      if (parseMode && /parse entities/i.test(String(result.description))) {
        Logger.log('↩️ Повторяю без форматирования');
        delete payload.parse_mode;
        const retry = UrlFetchApp.fetch(url, Object.assign({}, options, { payload: JSON.stringify(payload) }));
        return JSON.parse(retry.getContentText());
      }
    }

    return result;
  } catch (error) {
    Logger.log('❌ Ошибка: ' + error);
    throw error;
  }
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
 * Команда /meeting_done (или текст «встреча закончена») — предложить
 * даты через MEETING_INTERVAL_WEEKS недель от сегодня.
 */
function handleMeetingDoneCommand() {
  const targetDate = new Date(Date.now() + MEETING_INTERVAL_WEEKS * 7 * 24 * 60 * 60 * 1000);
  return proposeMeetingPolls(targetDate);
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
  sendTelegramMessage(
    `🤖 Бот книжного клуба, версия ${BOT_VERSION}\nВсе команды: /help`,
    null // без Markdown: в командах подчёркивания
  );
}

// ==================== ДОСТИЖЕНИЯ ====================

const ACHIEVEMENTS_SHEET_NAME = 'Achievements';

// Бейджи, которые можно безопасно посчитать из уже существующих данных
// (без хранения истории по дням) — см. обоснование в плане улучшений.
const BADGES = {
  PERFECT_SPRINT: '🎯 Идеальный спринт',
  STREAK_14: '💎 Стрик 14+ дней',
  STREAK_30: '🌟 Стрик 30+ дней'
};

/**
 * Найти или создать служебный лист для хранения выданных бейджей.
 * Лист скрыт и не попадает в getFortnightSheets (имя не матчится regex'ом Fortnight).
 */
function getOrCreateAchievementsSheet(ss) {
  let sheet = ss.getSheetByName(ACHIEVEMENTS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ACHIEVEMENTS_SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([['Имя', 'Бейдж', 'Спринт']]);
    sheet.hideSheet();
  }
  return sheet;
}

/**
 * Прочитать все уже выданные бейджи одним запросом (не поячеечно)
 */
function readExistingAchievements(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  return values.map(row => ({ name: row[0], badge: row[1], sprint: row[2] }));
}

/**
 * Начислить бейджи за текущий отчёт.
 * - "Идеальный спринт" выдаётся один раз за спринт (только в isLastDay).
 * - Стрик-бейджи выдаются один раз за всё время (не привязаны к спринту),
 *   т.к. стрик считается сквозь границы спринтов.
 * Дедупликация — по уже существующим записям на листе Achievements,
 * читаем их один раз в начале, а не проверяем ячейку за ячейкой.
 *
 * Возвращает список новых бейджей "за сегодня" — для отдельного
 * уведомления в Telegram. Ничего не возвращает и не бросает наружу,
 * если писать было нечего.
 */
function awardBadges(readingData, current, isLastDay) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateAchievementsSheet(ss);
  const existing = readExistingAchievements(sheet);

  const hasForSprint = (name, badge, sprint) =>
    existing.some(r => r.name === name && r.badge === badge && r.sprint === sprint);
  const hasEver = (name, badge) =>
    existing.some(r => r.name === name && r.badge === badge);

  const newRows = [];
  const newBadgesByMember = [];

  for (const member of readingData) {
    const earnedNow = [];

    if (
      isLastDay &&
      member.totalDays > 0 &&
      member.daysRead === member.totalDays &&
      !hasForSprint(member.name, BADGES.PERFECT_SPRINT, current.name)
    ) {
      earnedNow.push(BADGES.PERFECT_SPRINT);
      newRows.push([member.name, BADGES.PERFECT_SPRINT, current.name]);
    }

    if (member.streak >= 30 && !hasEver(member.name, BADGES.STREAK_30)) {
      earnedNow.push(BADGES.STREAK_30);
      newRows.push([member.name, BADGES.STREAK_30, current.name]);
    } else if (member.streak >= 14 && !hasEver(member.name, BADGES.STREAK_14)) {
      earnedNow.push(BADGES.STREAK_14);
      newRows.push([member.name, BADGES.STREAK_14, current.name]);
    }

    if (earnedNow.length > 0) {
      newBadgesByMember.push({ name: member.name, badges: earnedNow });
    }
  }

  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 3).setValues(newRows);
  }

  return newBadgesByMember;
}

/**
 * Короткое сообщение про новые бейджи — отдельно от основного отчёта,
 * чтобы легко было выключить одной строкой, если не понравится.
 */
function formatNewBadgesMessage(newBadgesByMember) {
  let msg = '🎉 *Новые бейджи!*\n\n';
  for (const entry of newBadgesByMember) {
    msg += `👤 *${entry.name}*: ${entry.badges.join(', ')}\n`;
  }
  return msg;
}

// ==================== ИГРОВЫЕ МЕХАНИКИ: ОБЩЕЕ ====================
//
// Что здесь живёт:
// - /iam — привязка Telegram-аккаунта к имени в таблице (нужна дуэлям,
//   тайным напарникам и анонимкам);
// - /quote, /question, /questions, /suggest_book, /book_vote;
// - дуэли (/duel + кнопка «Принять»), тайные напарники и /anon в личке;
// - бейджи за прогресс (камбэк, первым дочитал, рывок) и секретные бейджи;
// - церемония итогов спринта.
//
// Где хранятся данные:
// - небольшое состояние (регистрации, дуэли, напарники, счётчики) —
//   в PropertiesService в виде JSON;
// - списки, которые растут (цитаты, вопросы, предложенные книги) —
//   на скрытых листах GAME_SHEETS;
// - выданные бейджи — на том же скрытом листе Achievements.

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

/** Начало сегодняшнего дня (00:00) */
function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

/** Дата → 'YYYY-MM-DD' (удобно хранить и сравнивать строками) */
function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateFromKey(key) {
  const parts = String(key).split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/** 'YYYY-MM-DD' → 'DD.MM' для сообщений */
function shortDateFromKey(key) {
  const d = dateFromKey(key);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Дата из ячейки колонки дат: настоящий Date (так пишет fillSprintDates)
 * или текст вида '06.01.2026' / '06.01.26' (старые листы). Иначе null.
 */
function parseSheetDate(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    const d = new Date(value.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
    if (m) {
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      const d = new Date(year, Number(m[2]) - 1, Number(m[1]));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

/**
 * Дата обсуждения общей книги: Date, '25.01.2026' или '25 января'.
 * Для '25 января' без года берём ближайшую такую дату (не в далёком прошлом).
 */
function parseDiscussionDate(value) {
  const direct = parseSheetDate(value);
  if (direct) return direct;
  if (typeof value !== 'string') return null;

  let monthIndex;
  let m = value.trim().match(/^(\d{1,2})\.(\d{1,2})$/); // '02.10' — без года
  if (m) {
    monthIndex = Number(m[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11) return null;
  } else {
    m = value.trim().toLowerCase().match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/);
    if (!m) return null;
    monthIndex = RU_MONTHS_GENITIVE.indexOf(m[2]);
    if (monthIndex === -1) return null;
  }

  const today = todayStart();
  const year = m[3] ? Number(m[3]) : today.getFullYear();
  let d = new Date(year, monthIndex, Number(m[1]));
  if (!m[3] && d.getTime() < addDays(today, -180).getTime()) {
    d = new Date(year + 1, monthIndex, Number(m[1]));
  }
  return d;
}

/**
 * Сколько дней спринта уже наступило (включая сегодня).
 * Нужно, чтобы не считать будущие пустые дни «пропусками».
 */
function getElapsedDaysCount(sheet, daysCount) {
  const daysLeft = getDaysLeftInSprint(sheet);
  if (daysLeft < 0) return daysCount;
  return Math.max(0, Math.min(daysCount, daysCount - daysLeft));
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

/** Короткий ответ в чат клуба (без Markdown и без кнопки таблицы) */
function sendChatText(text) {
  return sendTelegramMessage(text, null, { noButton: true });
}

/** Сообщение в личку участнику */
function sendPrivateText(chatId, text) {
  return sendTelegramMessage(text, null, { chatId: chatId, noButton: true });
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

// ==================== /iam — КТО ЕСТЬ КТО ====================

/** { telegramUserId: { name, username } } */
function getRegisteredMembers() {
  return readJsonProperty('telegramMembers', {});
}

function findRegisteredName(userId) {
  if (userId === undefined || userId === null) return null;
  const entry = getRegisteredMembers()[String(userId)];
  return entry ? entry.name : null;
}

/** Имя автора для цитат/вопросов/книг: из /iam, иначе имя в Telegram */
function getAuthorName(from) {
  const registered = findRegisteredName(from && from.id);
  if (registered) return registered;
  const telegramName = sanitizeUserText(from && from.first_name, 50);
  return telegramName || 'Участник клуба';
}

function getCurrentMemberNames() {
  return getMembers(getCurrentSheet().sheet).map(m => m.name);
}

function handleIamCommand(from, args) {
  if (!from || from.id === undefined) return;
  const members = getCurrentMemberNames();
  if (!args) {
    sendChatText(`Напиши /iam и своё имя из таблицы, например: /iam ${members[0] || 'Антон'}\nИмена в таблице: ${members.join(', ')}`);
    return;
  }

  const match = members.find(n => n.toLowerCase() === args.trim().toLowerCase());
  if (!match) {
    sendChatText(`Не нашёл «${sanitizeUserText(args, 50)}» в таблице. Имена в таблице: ${members.join(', ')}`);
    return;
  }

  const result = withScriptLock(() => {
    const registered = getRegisteredMembers();
    const takenBy = Object.keys(registered).find(id => id !== String(from.id) && registered[id].name === match);
    if (takenBy) return 'taken';
    registered[String(from.id)] = { name: match, username: from.username || '' };
    writeJsonProperty('telegramMembers', registered);
    return 'ok';
  });

  if (result === 'taken') {
    sendChatText(`Имя «${match}» уже привязано к другому аккаунту. Если это ошибка — пусть тот человек напишет /iam со своим именем.`);
  } else if (result === 'ok') {
    sendChatText(`👋 ${match}, готово! Теперь тебе доступны дуэли, тайные напарники и анонимки. Чтобы бот мог писать тебе в личку — открой его и нажми «Start».`);
  }
}

// ==================== ЦИТАТЫ УЧАСТНИКОВ (/quote) ====================

function handleQuoteCommand(author, args, reply) {
  const text = sanitizeUserText(args);
  if (!text) {
    reply('Напиши цитату после команды: /quote Все счастливые семьи похожи друг на друга…');
    return;
  }
  appendDataRow(GAME_SHEETS.QUOTES, [new Date(), author, text, false]);
  reply('💬 Цитата сохранена — она появится в одном из ближайших отчётов.');
}

/**
 * Взять самую старую непоказанную цитату участника и пометить показанной.
 * null — если таких нет (тогда в отчёте будет случайная из READING_QUOTES).
 */
function pickMemberQuote() {
  const rows = readDataRows(GAME_SHEETS.QUOTES);
  const next = rows.find(r => r.values[3] !== true && String(r.values[2]).trim());
  if (!next) return null;
  return { row: next.row, name: sanitizeUserText(next.values[1], 50), text: sanitizeUserText(next.values[2]) };
}

/** Пометить цитату показанной — только после того, как отчёт ушёл */
function markQuoteShown(quote) {
  setDataCell(GAME_SHEETS.QUOTES, quote.row, 4, true);
}

// ==================== ВОПРОСЫ К ВСТРЕЧЕ (/question) ====================

function getCurrentCommonBookTitle() {
  return String(getCommonBookInfo(getCurrentSheet().sheet).title);
}

function getQuestionsForBook(bookTitle) {
  return readDataRows(GAME_SHEETS.QUESTIONS)
    .filter(r => String(r.values[2]) === String(bookTitle) && String(r.values[3]).trim());
}

function handleQuestionCommand(author, args, reply) {
  const text = sanitizeUserText(args);
  if (!text) {
    reply('Напиши вопрос после команды: /question Почему герой так поступил в финале?');
    return;
  }
  const book = getCurrentCommonBookTitle();
  appendDataRow(GAME_SHEETS.QUESTIONS, [new Date(), author, book, text, false]);
  const count = getQuestionsForBook(book).length;
  reply(`❓ Вопрос к встрече по «${book}» сохранён (всего вопросов: ${count}). Список придёт в чат за день до обсуждения.`);
}

function formatQuestionsList(rows) {
  let text = '';
  rows.forEach((r, i) => {
    const line = `${i + 1}. ${r.values[3]}\n`;
    if (text.length + line.length < 3500) text += line;
  });
  return text;
}

function handleQuestionsListCommand() {
  const book = getCurrentCommonBookTitle();
  const rows = getQuestionsForBook(book);
  if (rows.length === 0) {
    sendChatText(`Вопросов к встрече по «${book}» пока нет. Добавить: /question текст вопроса`);
    return;
  }
  sendChatText(`❓ Вопросы к встрече по «${book}»:\n\n${formatQuestionsList(rows)}\nДобавить ещё: /question текст вопроса`);
}

/**
 * Если завтра — дата обсуждения общей книги, опубликовать вопросы,
 * накопленные через /question (один раз — они помечаются опубликованными).
 */
function publishMeetingQuestionsIfDue(commonBook) {
  const discussion = parseDiscussionDate(commonBook.discussionDate);
  if (!discussion) return false;
  if (dateKey(discussion) !== dateKey(addDays(todayStart(), 1))) return false;

  const book = String(commonBook.title);
  const rows = getQuestionsForBook(book).filter(r => r.values[4] !== true);
  if (rows.length === 0) return false;

  const result = sendChatText(`❓ Завтра обсуждаем «${book}»! Вопросы, которые вы накидали к встрече:\n\n${formatQuestionsList(rows)}\nДобавить ещё: /question текст вопроса`);
  if (result && result.ok) {
    for (const r of rows) setDataCell(GAME_SHEETS.QUESTIONS, r.row, 5, true);
  }
  return true;
}

// ==================== СЛЕДУЮЩАЯ КНИГА (/suggest_book, /book_vote) ====================

function getOpenBookSuggestions() {
  return readDataRows(GAME_SHEETS.SUGGESTIONS)
    .filter(r => r.values[3] === 'open' && String(r.values[2]).trim());
}

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
  appendDataRow(GAME_SHEETS.SUGGESTIONS, [new Date(), author, title, 'open']);
  reply(`📚 «${title}» добавлена в кандидаты на следующую общую книгу (всего: ${open.length + 1}). Голосование — в конце спринта или командой /book_vote.`);
}

/**
 * Запустить опрос «какую книгу читаем следующей» из открытых предложений.
 * Возвращает { launched, count }.
 */
function launchBookVote() {
  const open = getOpenBookSuggestions();
  if (open.length < 2) return { launched: false, count: open.length };

  const chosen = open.slice(0, BOOK_VOTE_MAX_OPTIONS);
  const options = chosen.map(r => truncateText(`${r.values[2]} (от ${r.values[1]})`, 100));
  const result = sendTelegramPoll('📚 Какую книгу читаем следующей общей?', options, { allowsMultipleAnswers: false });

  if (result && result.ok) {
    for (const r of chosen) setDataCell(GAME_SHEETS.SUGGESTIONS, r.row, 4, 'voted');
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

// ==================== ДУЭЛИ ====================
//
// /duel Имя (или /duel @username) — вызов. Под сообщением кнопка
// «Принять» — нажать может только вызванный. Дуэль длится
// DUEL_LENGTH_DAYS дней с дня принятия: кто больше дней отметит чтение.
// Итоги подводит ежедневный отчёт на следующий день после окончания.

function getDuels() {
  return readJsonProperty('duels', []);
}

function isMemberInActiveDuel(duels, name) {
  return duels.some(d => d.status === 'active' && (d.a === name || d.b === name));
}

function resolveDuelTarget(args) {
  const raw = args.trim();
  if (raw.startsWith('@')) {
    const username = raw.slice(1).toLowerCase();
    if (!username) return null;
    const registered = getRegisteredMembers();
    const id = Object.keys(registered).find(k => (registered[k].username || '').toLowerCase() === username);
    return id ? registered[id].name : null;
  }
  return getCurrentMemberNames().find(n => n.toLowerCase() === raw.toLowerCase()) || null;
}

function handleDuelCommand(from, args) {
  const challenger = findRegisteredName(from.id);
  if (!challenger) {
    sendChatText('Чтобы вызывать на дуэль, сначала представься: /iam Имя');
    return;
  }
  if (!args) {
    sendChatText(`Кого вызываем? Например: /duel ${getCurrentMemberNames().find(n => n !== challenger) || 'Маша'}`);
    return;
  }
  const target = resolveDuelTarget(args);
  if (!target) {
    sendChatText(`Не нашёл «${sanitizeUserText(args, 50)}» в таблице. Вызывать можно по имени из таблицы или по @username того, кто сделал /iam.`);
    return;
  }
  if (target === challenger) {
    sendChatText('С самим собой дуэль всегда заканчивается ничьёй 🙂 Выбери соперника.');
    return;
  }

  const duel = withScriptLock(() => {
    const duels = getDuels();
    if (isMemberInActiveDuel(duels, challenger) || isMemberInActiveDuel(duels, target)) {
      return 'busy';
    }
    const created = {
      id: String(Date.now()) + String(Math.floor(Math.random() * 1000)),
      a: challenger,
      b: target,
      status: 'pending',
      createdAt: Date.now()
    };
    duels.push(created);
    writeJsonProperty('duels', pruneDuels(duels));
    return created;
  });

  if (duel === 'busy') {
    sendChatText('У кого-то из вас уже идёт дуэль — дождитесь её итогов.');
    return;
  }
  if (!duel) return;

  // @username соперника (если он делал /iam) — чтобы Telegram прислал ему уведомление
  const registered = getRegisteredMembers();
  const targetId = Object.keys(registered).find(id => registered[id].name === target);
  const targetUsername = targetId && registered[targetId].username;
  const targetMention = targetUsername ? `${target} (@${targetUsername})` : target;

  sendTelegramMessage(
    `⚔️ ${challenger} вызывает ${targetMention} на дуэль!\n\n` +
    `${DUEL_LENGTH_DAYS} дней: кто больше дней почитает. Проигравший выполняет фант.\n` +
    `${target}, вызов действует сутки.`,
    null,
    { replyMarkup: { inline_keyboard: [[{ text: '⚔️ Принять вызов', callback_data: 'duel_accept:' + duel.id }]] } }
  );
}

/** Оставить активные, ожидающие (не протухшие) и 30 последних завершённых */
function pruneDuels(duels) {
  const now = Date.now();
  const alive = duels.filter(d => d.status === 'active' || (d.status === 'pending' && now - d.createdAt <= DUEL_ACCEPT_TIMEOUT_MS));
  const finished = duels.filter(d => d.status === 'finished').slice(-30);
  return alive.concat(finished);
}

function acceptDuel(duelId, from) {
  const name = findRegisteredName(from && from.id);

  const result = withScriptLock(() => {
    const duels = getDuels();
    const duel = duels.find(d => d.id === duelId);
    if (!duel || duel.status === 'expired') return { answer: 'Вызов не найден или устарел' };
    if (duel.status !== 'pending') return { answer: 'Эта дуэль уже идёт или завершена' };
    if (!name) return { answer: 'Сначала напиши в чате клуба /iam Имя (как в таблице), потом нажми кнопку ещё раз' };
    if (name !== duel.b) return { answer: `Этот вызов адресован ${duel.b} 🙂` };
    if (Date.now() - duel.createdAt > DUEL_ACCEPT_TIMEOUT_MS) {
      duel.status = 'expired';
      writeJsonProperty('duels', pruneDuels(duels));
      return { answer: 'Вызов устарел — пусть вызовут заново' };
    }
    if (isMemberInActiveDuel(duels, duel.a) || isMemberInActiveDuel(duels, duel.b)) {
      return { answer: 'У кого-то из вас уже идёт другая дуэль' };
    }

    const start = todayStart();
    duel.status = 'active';
    duel.start = dateKey(start);
    duel.end = dateKey(addDays(start, DUEL_LENGTH_DAYS - 1));
    writeJsonProperty('duels', pruneDuels(duels));
    return { answer: 'Вызов принят! ⚔️', started: duel };
  });

  if (!result) return 'Попробуй ещё раз через минуту';
  if (result.started) {
    const d = result.started;
    sendChatText(`⚔️ Дуэль началась: ${d.a} против ${d.b}!\nСчитаем дни чтения с ${shortDateFromKey(d.start)} по ${shortDateFromKey(d.end)}. Проигравший выполняет фант. Удачи!`);
  }
  return result.answer;
}

/**
 * Сколько разных дней с startKey по endKey участник отметил чтение.
 * Смотрим 3 последних листа — дуэль короче спринта, этого хватает.
 */
function countReadDaysInRange(memberName, startKey, endKey, fortnightSheets) {
  const readDays = new Set();
  for (const sheetInfo of fortnightSheets.slice(0, 3)) {
    const column = findMemberColumn(sheetInfo.sheet, memberName);
    if (!column) continue;
    const daysCount = getSprintDaysCount(sheetInfo.sheet);
    if (daysCount === 0) continue;
    const dates = sheetInfo.sheet.getRange(CONFIG.checkboxesStartRow, CONFIG.datesColumn, daysCount, 1).getValues();
    const checks = getCheckboxesForMember(sheetInfo.sheet, column, daysCount);
    for (let i = 0; i < daysCount; i++) {
      const date = parseSheetDate(dates[i][0]);
      if (!date || !checks[i]) continue;
      const key = dateKey(date);
      if (key >= startKey && key <= endKey) readDays.add(key);
    }
  }
  return readDays.size;
}

/** Подвести итоги дуэлей, которые закончились до сегодняшнего дня */
function resolveFinishedDuels(fortnightSheets, current) {
  const todayKey = dateKey(todayStart());

  // Таблицу читаем ДО блокировки: пока она взята, входящие команды ждут
  const scores = {};
  for (const duel of getDuels()) {
    if (duel.status !== 'active' || !(duel.end < todayKey)) continue;
    scores[duel.id] = {
      a: countReadDaysInRange(duel.a, duel.start, duel.end, fortnightSheets),
      b: countReadDaysInRange(duel.b, duel.start, duel.end, fortnightSheets)
    };
  }
  if (Object.keys(scores).length === 0) return [];

  const finishedNow = withScriptLock(() => {
    const duels = getDuels();
    const done = [];
    for (const duel of duels) {
      if (duel.status !== 'active' || !scores[duel.id]) continue;
      duel.scoreA = scores[duel.id].a;
      duel.scoreB = scores[duel.id].b;
      duel.winner = duel.scoreA > duel.scoreB ? duel.a : duel.scoreB > duel.scoreA ? duel.b : null;
      duel.status = 'finished';
      duel.finishedSprint = current.name;
      done.push(duel);
    }
    if (done.length > 0) {
      writeJsonProperty('duels', pruneDuels(duels));
      const wins = readJsonProperty('duelWins', {});
      for (const duel of done) {
        if (duel.winner) wins[duel.winner] = (wins[duel.winner] || 0) + 1;
      }
      writeJsonProperty('duelWins', wins);
    }
    return done;
  }) || [];

  for (const duel of finishedNow) {
    let text = `⚔️ Итоги дуэли ${duel.a} vs ${duel.b}: ${duel.scoreA}:${duel.scoreB}\n\n`;
    if (duel.winner) {
      const loser = duel.winner === duel.a ? duel.b : duel.a;
      const forfeit = DUEL_FORFEITS[Math.floor(Math.random() * DUEL_FORFEITS.length)];
      text += `🏆 Победа — ${duel.winner}!\n🎲 Фант для ${loser}: ${forfeit}.`;
    } else {
      text += '🤝 Ничья! Оба молодцы — фанта нет.';
    }
    sendChatText(text);
  }
  return finishedNow;
}

// ==================== ТАЙНЫЕ НАПАРНИКИ И АНОНИМКИ ====================
//
// В первый отчёт нового спринта бот случайно назначает каждому
// зарегистрированному (/iam) участнику «подопечного» — по кругу, так что у
// каждого ровно один тайный напарник. Бот пишет каждому в личку, кого он
// опекает. Послания подопечному — в личке боту: /anon текст. Бот публикует
// их в чате клуба без имени отправителя. На церемонии итогов пары
// раскрываются. /anon_all — анонимное послание всему клубу.

function getSecretPartners() {
  return readJsonProperty('secretPartners', null);
}

/** Назначение на текущий спринт или null, если его нет */
function getActiveSecretPartners() {
  const assignment = getSecretPartners();
  if (!assignment) return null;
  return assignment.sprint === getCurrentSheet().name ? assignment : null;
}

function ensureSecretPartners(sprintName, memberNames) {
  const assignment = withScriptLock(() => {
    const existing = getSecretPartners();
    if (existing && existing.sprint === sprintName) return null;

    const registered = getRegisteredMembers();
    const participants = Object.keys(registered)
      .filter(id => memberNames.includes(registered[id].name))
      .map(id => ({ id: id, name: registered[id].name }));
    if (participants.length < SECRET_PARTNERS_MIN_MEMBERS) return null;

    // Перемешиваем (Фишер–Йетс) и замыкаем в круг: каждый опекает следующего
    for (let i = participants.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = participants[i];
      participants[i] = participants[j];
      participants[j] = tmp;
    }
    const pairs = participants.map((p, i) => {
      const target = participants[(i + 1) % participants.length];
      return { giverId: p.id, giverName: p.name, targetId: target.id, targetName: target.name, sent: 0 };
    });

    const created = { sprint: sprintName, pairs: pairs };
    writeJsonProperty('secretPartners', created);
    return created;
  });

  if (!assignment) return false;

  for (const pair of assignment.pairs) {
    sendPrivateText(pair.giverId,
      `🎭 В спринте ${assignment.sprint} ты — тайный книжный напарник для ${pair.targetName}!\n\n` +
      'Поддерживай подопечного анонимно: цитата специально для него, вопрос про его книгу, рекомендация.\n' +
      'Пиши сюда: /anon текст — бот опубликует это в чате клуба без твоего имени.\n' +
      'В конце спринта все пары раскроются 😉');
  }
  sendChatText(
    `🎭 Тайные напарники на ${assignment.sprint} назначены!\n\n` +
    'У каждого есть тайный опекун, который будет анонимно писать ему через бота. Кому ты напарник — бот написал в личку ' +
    '(если не пришло — открой бота и отправь /my_target). В конце спринта всех раскроем!');
  return true;
}

function handleMyTargetCommand(chatId, userId) {
  const assignment = getActiveSecretPartners();
  const pair = assignment && assignment.pairs.find(p => p.giverId === String(userId));
  if (!pair) {
    sendPrivateText(chatId, 'Тайные напарники ещё не назначены. Они назначаются автоматически в начале спринта, когда в клубе минимум 4 человека сделали /iam. А пока можно написать всему клубу анонимно: /anon_all текст');
    return;
  }
  sendPrivateText(chatId, `🎭 В спринте ${assignment.sprint} ты тайный напарник для ${pair.targetName}. Написать анонимно: /anon текст`);
}

/**
 * Анонимное послание. toAll = false — подопечному (только если тайные
 * напарники назначены), toAll = true — всему клубу.
 *
 * Анонимность: кто что отправил, бот нигде не хранит по имени. Лимит
 * ANON_DAILY_LIMIT считается в CacheService (временное хранилище, его не
 * видно в настройках проекта, где Script Properties может открыть любой
 * редактор таблицы). Счётчик посланий подопечному хранится в паре —
 * она и так раскрывается на церемонии.
 */
function handleAnonCommand(chatId, userId, senderName, args, toAll) {
  const text = sanitizeUserText(args);
  if (!text) {
    sendPrivateText(chatId, toAll
      ? 'Напиши текст после команды: /anon_all Всем хорошего чтения!'
      : 'Напиши текст после команды: /anon Держи цитату специально для тебя: …');
    return;
  }

  const sprintName = getCurrentSheet().name;
  const limitKey = `anon:${userId}:${dateKey(todayStart())}`;

  const prepared = withScriptLock(() => {
    let pair = null;
    let assignment = null;
    if (!toAll) {
      assignment = getSecretPartners();
      if (assignment && assignment.sprint === sprintName) {
        pair = assignment.pairs.find(p => p.giverId === String(userId)) || null;
      }
      // /anon без подопечного не превращаем молча в послание всему клубу
      if (!pair) return { noPartner: true };
    }

    const cache = CacheService.getScriptCache();
    const used = Number(cache.get(limitKey) || 0);
    if (used >= ANON_DAILY_LIMIT) return { limit: true };
    cache.put(limitKey, String(used + 1), 6 * 60 * 60); // максимум CacheService — 6 часов

    if (pair) {
      pair.sent = (pair.sent || 0) + 1;
      writeJsonProperty('secretPartners', assignment);
      return { targetName: pair.targetName };
    }
    return { targetName: null };
  });

  if (!prepared) {
    sendPrivateText(chatId, 'Не получилось отправить, попробуй ещё раз через минуту.');
    return;
  }
  if (prepared.noPartner) {
    sendPrivateText(chatId, 'У тебя пока нет подопечного: тайные напарники назначаются в начале спринта. Написать анонимно всему клубу: /anon_all текст');
    return;
  }
  if (prepared.limit) {
    sendPrivateText(chatId, `Лимит анонимок исчерпан (${ANON_DAILY_LIMIT} за несколько часов). Попробуй попозже!`);
    return;
  }

  const groupText = prepared.targetName
    ? `📨 ${prepared.targetName}, тебе послание от тайного напарника:\n\n«${text}»`
    : `📨 Анонимное послание клубу:\n\n«${text}»`;
  const result = sendChatText(groupText);

  if (result && result.ok) {
    sendPrivateText(chatId, prepared.targetName
      ? `✅ Отправлено анонимно для ${prepared.targetName}.`
      : '✅ Отправлено в чат клуба анонимно.');
  } else {
    sendPrivateText(chatId, 'Telegram не принял сообщение, попробуй ещё раз.');
  }
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
    '/iam Имя — привязать свой Telegram к имени в таблице (один раз)\n' +
    '/quote текст — цитата из твоей книги, появится в отчёте\n' +
    '/question текст — вопрос к встрече по общей книге\n' +
    '/questions — вопросы к встрече\n' +
    '/suggest_book название — предложить следующую общую книгу\n' +
    '/book_vote — голосование за следующую книгу\n' +
    '/duel Имя — вызвать на дуэль на 7 дней\n' +
    '/meeting_done, /another_time — дата следующей встречи\n' +
    '/bot_version — версия бота\n\n' +
    '🤫 Анонимно — только в личке с ботом:\n' +
    '/anon текст — послание тайному подопечному\n' +
    '/anon_all текст — послание всему клубу\n' +
    '/my_target — кому ты тайный напарник';
}

function privateHelpText(registeredName) {
  let text = '🤫 Здесь можно писать в чат клуба анонимно:\n\n' +
    '/anon текст — послание твоему подопечному (ты его тайный напарник)\n' +
    '/anon_all текст — анонимное послание всему клубу\n' +
    '/my_target — кому ты тайный напарник в этом спринте\n\n' +
    'И тихо, без сообщения в чате, отправить:\n' +
    '/quote текст — цитату для отчёта\n' +
    '/question текст — вопрос к встрече\n' +
    '/suggest_book название — книгу-кандидата';
  if (!registeredName) {
    text += '\n\n⚠️ Сначала представься в чате клуба: /iam Имя (как в таблице).';
  }
  return text;
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
    case 'iam': handleIamCommand(from, cmd.args); break;
    case 'quote': handleQuoteCommand(getAuthorName(from), cmd.args, reply); break;
    case 'question': handleQuestionCommand(getAuthorName(from), cmd.args, reply); break;
    case 'questions': handleQuestionsListCommand(); break;
    case 'suggest_book': handleSuggestBookCommand(getAuthorName(from), cmd.args, reply); break;
    case 'book_vote': handleBookVoteCommand(); break;
    case 'duel': handleDuelCommand(from, cmd.args); break;
    case 'anon':
    case 'anon_all':
    case 'my_target':
      // В общем чате анонимности нет — пробуем убрать сообщение и подсказываем
      callTelegram('deleteMessage', { chat_id: message.chat.id, message_id: message.message_id });
      sendChatText('🤫 Анонимно писать нужно в личку боту — там /anon текст. Сообщение в общем чате все видят!');
      break;
    default:
      break;
  }
}

function handlePrivateMessage(message) {
  const chatId = message.chat.id;
  const from = message.from || {};
  const cmd = parseCommand(message.text.trim());
  const name = findRegisteredName(from.id);
  const reply = (t) => sendPrivateText(chatId, t);

  if (!cmd || cmd.command === 'start' || cmd.command === 'help') {
    reply(privateHelpText(name));
    return;
  }
  if (!name) {
    reply('Сначала представься в чате клуба: /iam Имя (как в таблице). После этого здесь заработают анонимки.');
    return;
  }

  switch (cmd.command) {
    case 'anon': handleAnonCommand(chatId, from.id, name, cmd.args, false); break;
    case 'anon_all': handleAnonCommand(chatId, from.id, name, cmd.args, true); break;
    case 'my_target': handleMyTargetCommand(chatId, from.id); break;
    case 'quote': handleQuoteCommand(name, cmd.args, reply); break;
    case 'question': handleQuestionCommand(name, cmd.args, reply); break;
    case 'suggest_book': handleSuggestBookCommand(name, cmd.args, reply); break;
    default: reply(privateHelpText(name)); break;
  }
}

/** Нажатия на inline-кнопки. Сейчас это только «Принять дуэль». */
function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message && callbackQuery.message.chat && callbackQuery.message.chat.id;
  if (String(chatId) !== String(TELEGRAM_CHAT_ID)) {
    Logger.log('⚠️ Нажатие кнопки из чужого чата проигнорировано');
    return 'ignored';
  }

  const data = String(callbackQuery.data || '');
  let answer = '';
  if (data.startsWith('duel_accept:')) {
    answer = acceptDuel(data.slice('duel_accept:'.length), callbackQuery.from);
  }
  callTelegram('answerCallbackQuery', { callback_query_id: callbackQuery.id, text: answer });
  return 'ok';
}

// ==================== БЕЙДЖИ ЗА ПРОГРЕСС И СЕКРЕТНЫЕ БЕЙДЖИ ====================

const GAME_BADGES = {
  COMEBACK: '🔄 Камбэк',
  FIRST_FINISH: '🏁 Первым дочитал общую книгу',
  BREAKTHROUGH: '🚀 Рывок спринта'
};

/**
 * Секретные бейджи: в чате объявляется только название, условие — нет.
 * Каждый выдаётся один раз за всё время.
 * c = { checks (наступившие дни спринта), settled (без сегодняшнего
 *       неотмеченного дня), dates, member, isLastDay, stats }
 */
const SECRET_BADGES = [
  {
    // 6 дней подряд строго через день: читал / не читал / читал …
    title: '🎢 Американские горки',
    check: (c) => {
      const x = c.settled;
      for (let i = 0; i + 5 < x.length; i++) {
        let alternating = true;
        for (let j = i; j < i + 5; j++) {
          if (x[j] === x[j + 1]) { alternating = false; break; }
        }
        if (alternating) return true;
      }
      return false;
    }
  },
  {
    // Первые 3 дня спринта пропущены, последние 3 — отмечены
    title: '🌅 Сильный финиш',
    check: (c) => {
      const x = c.checks;
      return c.isLastDay && x.length >= 6 &&
        x.slice(0, 3).every(v => !v) && x.slice(-3).every(v => v);
    }
  },
  {
    // Все наступившие выходные дни спринта (минимум 4) отмечены
    title: '🏖 Выходной читатель',
    check: (c) => {
      let weekendDays = 0;
      for (let i = 0; i < c.settled.length; i++) {
        const d = c.dates[i];
        if (!d || (d.getDay() !== 0 && d.getDay() !== 6)) continue;
        if (!c.settled[i]) return false;
        weekendDays++;
      }
      return weekendDays >= 4;
    }
  },
  {
    // Ровно половина дней спринта
    title: '⚖️ Золотая середина',
    check: (c) => c.isLastDay && c.member.totalDays > 0 && c.member.daysRead * 2 === c.member.totalDays
  },
  {
    title: '🧊 Ледяное сердце', // стрик спасла заморозка
    check: (c) => c.member.freezesUsed > 0
  },
  {
    title: '💬 Цитатник', // 3+ цитаты через /quote
    check: (c) => (c.stats.quotes[c.member.name] || 0) >= 3
  },
  {
    title: '🤔 Почемучка', // 3+ вопроса через /question
    check: (c) => (c.stats.questions[c.member.name] || 0) >= 3
  },
  {
    // 3+ послания подопечному за спринт. Выдаётся только в последний день,
    // вместе с раскрытием пар, — раньше бейдж выдал бы тайного напарника.
    // Послания всему клубу (/anon_all) не считаются: они анонимны навсегда.
    title: '📮 Почтальон',
    check: (c) => c.isLastDay && (c.stats.partnerSent[c.member.name] || 0) >= 3
  },
  {
    title: '🗡 Гладиатор', // 3 выигранные дуэли
    check: (c) => (c.stats.duelWins[c.member.name] || 0) >= 3
  }
];

function countByAuthor(rows, authorIndex) {
  const counts = {};
  for (const r of rows) {
    const author = String(r.values[authorIndex]);
    counts[author] = (counts[author] || 0) + 1;
  }
  return counts;
}

function collectMemberActivityStats(sprintName) {
  const partners = getSecretPartners();
  const partnerSent = {};
  if (partners && partners.sprint === sprintName) {
    for (const p of partners.pairs) partnerSent[p.giverName] = p.sent || 0;
  }
  return {
    quotes: countByAuthor(readDataRows(GAME_SHEETS.QUOTES), 1),
    questions: countByAuthor(readDataRows(GAME_SHEETS.QUESTIONS), 1),
    partnerSent: partnerSent,
    duelWins: readJsonProperty('duelWins', {})
  };
}

/**
 * Камбэк: в конце истории — минимум COMEBACK_MIN_RUN_DAYS дней чтения
 * подряд, перед ними — перерыв минимум COMEBACK_MIN_GAP_DAYS дней,
 * а ещё раньше человек уже читал (новичок — не камбэк).
 * history — массив true/false по дням, от старых к новым.
 */
function isComeback(history) {
  const h = history.slice();
  // Сегодня ещё могут отметиться — неотмеченный сегодняшний день не считаем
  if (h.length > 0 && h[h.length - 1] === false) h.pop();

  let i = h.length - 1;
  let run = 0;
  while (i >= 0 && h[i]) { run++; i--; }
  if (run < COMEBACK_MIN_RUN_DAYS) return false;

  let gap = 0;
  while (i >= 0 && !h[i]) { gap++; i--; }
  return gap >= COMEBACK_MIN_GAP_DAYS && i >= 0;
}

/**
 * Начислить бейджи за прогресс (камбэк, первым дочитал общую книгу)
 * и секретные бейджи. Хранятся на листе Achievements, как и остальные.
 * Возвращает { progress: [{name, badges}], secret: [{name, badge}] }.
 */
function awardGameBadges(readingData, current, fortnightSheets, booksData, commonBook, isLastDay) {
  const sheet = getOrCreateAchievementsSheet(SpreadsheetApp.getActiveSpreadsheet());
  const existing = readExistingAchievements(sheet);
  const hasForSprint = (name, badge, sprint) =>
    existing.some(r => r.name === name && r.badge === badge && r.sprint === sprint);
  const hasEver = (name, badge) =>
    existing.some(r => r.name === name && r.badge === badge);

  const newRows = [];
  const progress = [];
  const secret = [];
  const addProgress = (name, badge, sprintKey) => {
    newRows.push([name, badge, sprintKey]);
    const entry = progress.find(p => p.name === name);
    if (entry) entry.badges.push(badge);
    else progress.push({ name: name, badges: [badge] });
  };

  const daysCount = getSprintDaysCount(current.sheet);
  const elapsed = getElapsedDaysCount(current.sheet, daysCount);
  const dates = daysCount > 0
    ? current.sheet.getRange(CONFIG.checkboxesStartRow, CONFIG.datesColumn, daysCount, 1).getValues().map(r => parseSheetDate(r[0]))
    : [];
  const previous = fortnightSheets.length > 1 ? fortnightSheets[1] : null;
  const stats = collectMemberActivityStats(current.name);

  for (const member of readingData) {
    const allChecks = member.checkboxes || [];
    const checks = allChecks.slice(0, elapsed);
    const settled = checks.slice();
    if (settled.length > 0 && settled[settled.length - 1] === false) settled.pop();

    // 🔄 Камбэк — раз за спринт; перерыв может начаться ещё в прошлом спринте
    // (и не за тот же камбэк, что уже отметили в прошлом спринте)
    if (!hasForSprint(member.name, GAME_BADGES.COMEBACK, current.name) &&
        !(previous && hasForSprint(member.name, GAME_BADGES.COMEBACK, previous.name))) {
      let history = checks;
      if (previous) {
        const column = findMemberColumn(previous.sheet, member.name);
        if (column) history = getCheckboxesForMember(previous.sheet, column).concat(checks);
      }
      if (isComeback(history)) addProgress(member.name, GAME_BADGES.COMEBACK, current.name);
    }

    // 🔮 Секретные бейджи — раз за всё время
    const context = { checks, settled, dates, member, isLastDay, stats };
    for (const badge of SECRET_BADGES) {
      if (hasEver(member.name, badge.title)) continue;
      let earned = false;
      try {
        earned = badge.check(context);
      } catch (error) {
        Logger.log(`⚠️ Ошибка проверки бейджа ${badge.title}: ${error}`);
      }
      if (earned) {
        newRows.push([member.name, badge.title, current.name]);
        secret.push({ name: member.name, badge: badge.title });
      }
    }
  }

  // 🏁 Первым дочитал общую книгу — раз на книгу. Если в один день
  // дочитали несколько человек — бейдж получают все они.
  const bookTitle = String(commonBook.title || '').trim();
  if (bookTitle && bookTitle !== 'Не указана') {
    const bookKey = 'Книга: ' + bookTitle;
    const alreadyAwarded = existing.some(r => r.badge === GAME_BADGES.FIRST_FINISH && r.sprint === bookKey);
    if (!alreadyAwarded) {
      for (const b of booksData.filter(x => x.finishedCommonBook)) {
        addProgress(b.name, GAME_BADGES.FIRST_FINISH, bookKey);
      }
    }
  }

  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 3).setValues(newRows);
  }

  return { progress, secret };
}

/** Объединить два списка [{name, badges}] по имени */
function mergeBadgeLists(a, b) {
  const result = a.map(e => ({ name: e.name, badges: e.badges.slice() }));
  for (const entry of b) {
    const existing = result.find(e => e.name === entry.name);
    if (existing) existing.badges.push(...entry.badges);
    else result.push({ name: entry.name, badges: entry.badges.slice() });
  }
  return result;
}

function formatSecretBadgesMessage(secretBadges) {
  let msg = '🔮 *Секретные бейджи!*\n\n';
  for (const entry of secretBadges) {
    msg += `👤 *${entry.name}* получает «${entry.badge}»\n`;
  }
  msg += '\nЗа что их дают — угадайте сами 😏';
  return msg;
}

// ==================== ЦЕРЕМОНИЯ ИТОГОВ СПРИНТА ====================

/** Процент прочтения участника на листе (по имени) или null */
function getMemberPercentOnSheet(memberName, sheetInfo) {
  const column = findMemberColumn(sheetInfo.sheet, memberName);
  if (!column) return null;
  const checks = getCheckboxesForMember(sheetInfo.sheet, column);
  if (checks.length === 0) return null;
  return Math.round((checks.filter(x => x).length / checks.length) * 100);
}

function pluralRu(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/**
 * Праздничный пост в последний день спринта: MVP, рывок (бейдж выдаётся
 * здесь), самый длинный стрик, камбэки, первым дочитал, дуэли, раскрытие
 * тайных напарников, секретные бейджи.
 */
function sendSprintCeremony(readingData, current, fortnightSheets, commonBook) {
  if (readingData.length === 0) return false;

  const lines = [];
  lines.push(`🎊 *ИТОГИ СПРИНТА — ${current.name}* 🎊`);
  lines.push('');

  // 👑 MVP — максимальный процент (при равенстве — все)
  const topPercent = Math.max(...readingData.map(m => m.percentage));
  const mvps = readingData.filter(m => m.percentage === topPercent);
  if (topPercent > 0) {
    lines.push(`👑 *MVP:* ${mvps.map(m => m.name).join(', ')} — ${topPercent}% (${mvps[0].daysRead}/${mvps[0].totalDays})`);
  }

  const achievementsSheet = getOrCreateAchievementsSheet(SpreadsheetApp.getActiveSpreadsheet());
  const existing = readExistingAchievements(achievementsSheet);

  // 🚀 Рывок — самый большой рост процента к прошлому спринту
  if (fortnightSheets.length > 1) {
    let best = 0;
    let breakthroughs = [];
    for (const m of readingData) {
      const before = getMemberPercentOnSheet(m.name, fortnightSheets[1]);
      if (before === null) continue;
      const delta = m.percentage - before;
      if (delta > best) {
        best = delta;
        breakthroughs = [m.name];
      } else if (delta === best && delta > 0) {
        breakthroughs.push(m.name);
      }
    }
    if (best > 0) {
      lines.push(`🚀 *Рывок спринта:* ${breakthroughs.join(', ')} (+${best}% к прошлому спринту)`);
      const newRows = breakthroughs
        .filter(name => !existing.some(r => r.name === name && r.badge === GAME_BADGES.BREAKTHROUGH && r.sprint === current.name))
        .map(name => [name, GAME_BADGES.BREAKTHROUGH, current.name]);
      if (newRows.length > 0) {
        achievementsSheet.getRange(achievementsSheet.getLastRow() + 1, 1, newRows.length, 3).setValues(newRows);
      }
    }
  }

  // 🔥 Самый длинный стрик
  const topStreak = Math.max(...readingData.map(m => m.streak));
  if (topStreak >= 3) {
    const streakers = readingData.filter(m => m.streak === topStreak).map(m => m.name);
    lines.push(`🔥 *Самый длинный стрик:* ${streakers.join(', ')} — ${topStreak} ${pluralRu(topStreak, 'день', 'дня', 'дней')}`);
  }

  // 🔄 Камбэки этого спринта
  const comebacks = existing.filter(r => r.badge === GAME_BADGES.COMEBACK && r.sprint === current.name).map(r => r.name);
  if (comebacks.length > 0) {
    lines.push(`🔄 *Камбэк:* ${comebacks.join(', ')}`);
  }

  // 🏁 Первым дочитал общую книгу
  const bookKey = 'Книга: ' + String(commonBook.title || '').trim();
  // Общая книга живёт несколько спринтов — объявляем на церемонии один раз
  const props = PropertiesService.getScriptProperties();
  const firstFinishers = props.getProperty('firstFinishAnnounced') === bookKey ? [] :
    existing.filter(r => r.badge === GAME_BADGES.FIRST_FINISH && r.sprint === bookKey).map(r => r.name);
  if (firstFinishers.length > 0) {
    props.setProperty('firstFinishAnnounced', bookKey);
    lines.push(`🏁 *Первым дочитал общую книгу:* ${firstFinishers.join(', ')}`);
  }

  // ⚔️ Дуэли, закончившиеся в этом спринте
  const duels = getDuels().filter(d => d.status === 'finished' && d.finishedSprint === current.name);
  if (duels.length > 0) {
    lines.push('');
    lines.push('⚔️ *Дуэли спринта:*');
    for (const d of duels) {
      lines.push(d.winner
        ? `   ${d.winner} победил(а) ${d.winner === d.a ? d.b : d.a} — ${Math.max(d.scoreA, d.scoreB)}:${Math.min(d.scoreA, d.scoreB)}`
        : `   ${d.a} и ${d.b} — ничья ${d.scoreA}:${d.scoreB}`);
    }
  }

  // 🎭 Раскрываем тайных напарников
  const partners = getSecretPartners();
  if (partners && partners.sprint === current.name) {
    lines.push('');
    lines.push('🎭 *Тайные напарники раскрыты:*');
    for (const p of partners.pairs) {
      const sent = p.sent || 0;
      const sentText = sent > 0 ? ` (${sent} ${pluralRu(sent, 'послание', 'послания', 'посланий')})` : '';
      lines.push(`   ${p.giverName} → ${p.targetName}${sentText}`);
    }
  }

  // 🔮 Секретные бейджи спринта — только количество, интрига остаётся
  const secretTitles = SECRET_BADGES.map(b => b.title);
  const secretCount = existing.filter(r => r.sprint === current.name && secretTitles.includes(r.badge)).length;
  if (secretCount > 0) {
    lines.push('');
    lines.push(`🔮 Секретных бейджей за спринт: ${secretCount}`);
  }

  lines.push('');
  const openSuggestions = getOpenBookSuggestions().length;
  if (openSuggestions >= 2) {
    lines.push('📚 Ниже — голосование за следующую общую книгу 👇');
  } else {
    lines.push('📚 Предлагайте следующую общую книгу: /suggest\\_book название');
  }
  lines.push('Спасибо всем за спринт! Новый начинается завтра 📖');

  sendTelegramMessage(lines.join('\n'));
  return true;
}

// ==================== ГЛАВНЫЕ ФУНКЦИИ ====================

/**
 * 📤 ОТПРАВИТЬ ЕЖЕНЕДЕЛЬНЫЙ ОТЧЁТ
 * Запускай вручную или по триггеру
 */
function sendWeeklyReport() {
  const fortnightSheets = getFortnightSheets();
  const current = getCurrentSheet();

  Logger.log(`Текущий спринт: ${current.name}`);

  const readingData = getReadingData(current, fortnightSheets);
  const booksData = getBooksData(current.sheet);
  const commonBook = getCommonBookInfo(current.sheet);
  const daysLeft = getDaysLeftInSprint(current.sheet);
  const isLastDay = daysLeft === 0;
  // Предыдущий спринт — это следующий элемент в отсортированном по убыванию списке
  const previousAvg = fortnightSheets.length > 1 ? getSprintAveragePercent(fortnightSheets[1]) : null;

  // Цитата от участника (/quote) вместо случайной — если есть непоказанные
  let memberQuote = null;
  try {
    memberQuote = pickMemberQuote();
  } catch (error) {
    Logger.log('⚠️ Ошибка при выборе цитаты участника: ' + error);
  }

  const message = formatWeeklyMessage(readingData, booksData, commonBook, current.name, isLastDay, daysLeft, previousAvg, memberQuote);

  Logger.log('\n--- СООБЩЕНИЕ ---\n' + message);

  const sent = sendTelegramMessage(message);

  if (memberQuote && sent && sent.ok) {
    try {
      markQuoteShown(memberQuote);
    } catch (error) {
      Logger.log('⚠️ Не удалось пометить цитату показанной: ' + error);
    }
  }

  // Всё ниже — дополнительные механики. Каждая в своём try/catch:
  // ошибка в одной не должна ронять остальные и тем более отчёт.

  // Начисление бейджей — не должно ронять отправку отчёта, если что-то пойдёт не так
  let newBadges = [];
  try {
    newBadges = awardBadges(readingData, current, isLastDay);
  } catch (error) {
    Logger.log('⚠️ Ошибка при начислении бейджей: ' + error);
  }

  // Бейджи за прогресс (камбэк, первым дочитал) и секретные бейджи
  let secretBadges = [];
  try {
    const game = awardGameBadges(readingData, current, fortnightSheets, booksData, commonBook, isLastDay);
    newBadges = mergeBadgeLists(newBadges, game.progress);
    secretBadges = game.secret;
  } catch (error) {
    Logger.log('⚠️ Ошибка при начислении игровых бейджей: ' + error);
  }

  try {
    if (newBadges.length > 0) {
      sendTelegramMessage(formatNewBadgesMessage(newBadges));
    }
    if (secretBadges.length > 0) {
      sendTelegramMessage(formatSecretBadgesMessage(secretBadges));
    }
  } catch (error) {
    Logger.log('⚠️ Ошибка при отправке бейджей: ' + error);
  }

  // Вопросы к встрече — за день до даты обсуждения общей книги
  try {
    publishMeetingQuestionsIfDue(commonBook);
  } catch (error) {
    Logger.log('⚠️ Ошибка при публикации вопросов к встрече: ' + error);
  }

  // Подвести итоги закончившихся дуэлей (до церемонии — чтобы попали в неё)
  try {
    resolveFinishedDuels(fortnightSheets, current);
  } catch (error) {
    Logger.log('⚠️ Ошибка при подведении итогов дуэлей: ' + error);
  }

  // Тайные напарники назначаются в первый же отчёт нового спринта.
  // В последний день не назначаем — их тут же пришлось бы раскрывать.
  if (!isLastDay) {
    try {
      ensureSecretPartners(current.name, readingData.map(m => m.name));
    } catch (error) {
      Logger.log('⚠️ Ошибка при назначении тайных напарников: ' + error);
    }
  }

  // Церемония — один раз на спринт (повторный ручной запуск отчёта или
  // не создавшийся вовремя новый спринт не должны её дублировать)
  const props = PropertiesService.getScriptProperties();
  if (isLastDay && props.getProperty('ceremonyDoneFor') !== current.name) {
    props.setProperty('ceremonyDoneFor', current.name);
    // Церемония итогов спринта — отдельным постом после отчёта
    try {
      sendSprintCeremony(readingData, current, fortnightSheets, commonBook);
    } catch (error) {
      Logger.log('⚠️ Ошибка при отправке итогов спринта: ' + error);
    }
    // Голосование за следующую общую книгу из предложенных через /suggest_book
    try {
      launchBookVote();
    } catch (error) {
      Logger.log('⚠️ Ошибка при запуске голосования за книгу: ' + error);
    }
  }

  // Автоматически создаём новый спринт в последний день
  if (isLastDay) {
    Logger.log('🔄 Последний день — создаю новый спринт автоматически...');
    try {
      createNextSprint(true);
    } catch (error) {
      Logger.log('❌ Не удалось создать новый спринт автоматически: ' + error);
      sendTelegramMessage(
        '⚠️ Не удалось автоматически создать новый спринт.\n' +
        'Нужно создать вручную: меню *📚 Книжный клуб → ➕ Создать новый спринт*.'
      );
    }
  }
}

/**
 * 🧪 ТЕСТ — посмотреть сообщение без отправки
 */
function testMessage() {
  const fortnightSheets = getFortnightSheets();
  const current = getCurrentSheet();

  Logger.log('Найденные листы Fortnight:');
  for (const s of fortnightSheets) {
    Logger.log(`  - ${s.name} (номер: ${s.number})`);
  }
  Logger.log(`\nТекущий спринт: ${current.name}`);

  const readingData = getReadingData(current, fortnightSheets);
  const booksData = getBooksData(current.sheet);
  const commonBook = getCommonBookInfo(current.sheet);
  const daysLeft = getDaysLeftInSprint(current.sheet);
  const isLastDay = daysLeft === 0;
  const previousAvg = fortnightSheets.length > 1 ? getSprintAveragePercent(fortnightSheets[1]) : null;

  Logger.log(`Дней до конца спринта: ${daysLeft}`);
  Logger.log(`Последний день спринта: ${isLastDay}`);
  Logger.log(`Средний % прошлого спринта: ${previousAvg === null ? 'нет данных' : previousAvg + '%'}`);

  const message = formatWeeklyMessage(readingData, booksData, commonBook, current.name, isLastDay, daysLeft, previousAvg);

  Logger.log('\n--- СООБЩЕНИЕ ДЛЯ TELEGRAM ---\n');
  Logger.log(message);

  Logger.log('\n--- ДАННЫЕ ---');
  Logger.log('Чтение: ' + JSON.stringify(readingData, null, 2));
  Logger.log('Книги: ' + JSON.stringify(booksData, null, 2));
}

/**
 * 🔍 ОТЛАДКА СТРИКОВ — запусти чтобы понять почему не работают
 */
function debugStreaks() {
  const fortnightSheets = getFortnightSheets();
  const current = getCurrentSheet();
  const members = getMembers(current.sheet);

  Logger.log('=== ОТЛАДКА СТРИКОВ ===\n');

  for (const member of members) {
    Logger.log(`👤 ${member.name}:`);

    // Показываем чекбоксы текущего спринта
    const daysCount = getSprintDaysCount(current.sheet);
    const checkboxes = getCheckboxesForMember(current.sheet, member.column, daysCount);

    Logger.log(`   Дней в спринте: ${daysCount}`);
    Logger.log(`   Чекбоксы (raw): ${JSON.stringify(checkboxes)}`);
    Logger.log(`   Отмечено дней: ${checkboxes.filter(x => x).length}`);

    // Показываем сырые значения из таблицы
    if (daysCount > 0) {
      const rawValues = current.sheet.getRange(CONFIG.checkboxesStartRow, member.column, Math.min(5, daysCount), 1).getValues();
      Logger.log(`   Первые 5 значений (raw): ${JSON.stringify(rawValues)}`);
      Logger.log(`   Тип первого значения: ${typeof rawValues[0][0]}`);
    }

    // Считаем стрик
    const streak = calculateStreak(member.name, fortnightSheets);
    Logger.log(`   Стрик: ${streak}\n`);
  }
}

/**
 * ⚙️ НАСТРОИТЬ ЕЖЕДНЕВНЫЙ ТРИГГЕР
 * Запусти один раз — отчёт будет отправляться каждый день в 19:00 MSK
 */
function setupDailyTrigger() {
  // Удаляем старые триггеры
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'sendWeeklyReport') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // Создаём новый — каждый день в 19:00 (MSK = UTC+3, значит 16:00 UTC)
  ScriptApp.newTrigger('sendWeeklyReport')
    .timeBased()
    .everyDays(1)
    .atHour(16)  // 16:00 UTC = 19:00 MSK
    .inTimezone('Europe/Moscow')
    .create();

  Logger.log('✅ Триггер создан! Отчёт будет приходить каждый день в 19:00 MSK');
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

    // Нажатие на кнопку под сообщением (например, «Принять дуэль»)
    if (update.callback_query) {
      return handleCallbackQuery(update.callback_query);
    }

    const message = update.message;

    if (!message) {
      return 'ok';
    }
    if (!message.text) {
      // Фото/стикер/голосовое в личку — анонимки пока только текстом
      if (message.chat && message.chat.type === 'private') {
        sendPrivateText(message.chat.id, 'Пока я понимаю только текст. Анонимное послание: /anon текст или /anon_all текст');
      }
      return 'ok';
    }

    // Личка с ботом — только для анонимных посланий и тихой отправки
    // цитат/вопросов/книг. Пишут туда только участники, которые
    // представились в чате клуба через /iam (см. handlePrivateMessage).
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
 * ⚙️ РАЗОВАЯ НАСТРОЙКА ВЕБХУКА
 * Запусти вручную один раз после того, как задеплоил скрипт как Web App
 * (Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone)
 * и вписал полученный .../exec адрес в WEB_APP_URL в Config.gs.
 *
 * Можно запускать прямо из выпадающего списка функций, без аргументов —
 * адрес берётся из WEB_APP_URL. Функция сама дописывает ?secret=...
 * из TELEGRAM_WEBHOOK_SECRET.
 *
 * ВАЖНО: перед запуском один раз открой WEB_APP_URL в обычном браузере.
 * Должна показаться страница Apps Script с текстом про doGet — это нормально.
 * Без этого "прогрева" Telegram иногда получает от Google 302 вместо ответа.
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

  const setWebhookUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`;
  const response = UrlFetchApp.fetch(setWebhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ url: webhookUrlWithSecret }),
    muteHttpExceptions: true
  });
  Logger.log('setWebhook: ' + response.getContentText());

  const setCommandsUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`;
  const commandsResponse = UrlFetchApp.fetch(setCommandsUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      commands: [
        { command: 'meeting_done', description: 'Встреча прошла — предложить дату следующей' },
        { command: 'another_time', description: 'Предложенное время не подходит — сдвинуть на неделю' },
        { command: 'bot_version', description: 'Какая версия бота сейчас работает' },
        { command: 'iam', description: 'Привязать свой Telegram к имени в таблице' },
        { command: 'quote', description: 'Цитата из своей книги — попадёт в отчёт' },
        { command: 'question', description: 'Вопрос к встрече по общей книге' },
        { command: 'questions', description: 'Список вопросов к встрече' },
        { command: 'suggest_book', description: 'Предложить следующую общую книгу' },
        { command: 'book_vote', description: 'Голосование за следующую общую книгу' },
        { command: 'duel', description: 'Вызвать на дуэль на 7 дней' },
        { command: 'help', description: 'Все команды бота' }
      ]
    }),
    muteHttpExceptions: true
  });
  Logger.log('setMyCommands: ' + commandsResponse.getContentText());

  // Отдельное меню команд для лички с ботом
  const privateCommandsResponse = UrlFetchApp.fetch(setCommandsUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      scope: { type: 'all_private_chats' },
      commands: [
        { command: 'anon', description: 'Анонимное послание тайному напарнику' },
        { command: 'anon_all', description: 'Анонимное послание всему клубу' },
        { command: 'my_target', description: 'Кому я тайный напарник' },
        { command: 'quote', description: 'Цитата из своей книги — попадёт в отчёт' },
        { command: 'question', description: 'Вопрос к встрече по общей книге' },
        { command: 'suggest_book', description: 'Предложить следующую общую книгу' },
        { command: 'help', description: 'Что умеет бот' }
      ]
    }),
    muteHttpExceptions: true
  });
  Logger.log('setMyCommands (личка): ' + privateCommandsResponse.getContentText());
}

// ==================== СОЗДАНИЕ СПРИНТОВ ====================

/**
 * 📋 МЕНЮ — добавляет кнопку в интерфейс Google Sheets
 * Вызывается автоматически при открытии таблицы
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📚 Книжный клуб')
    .addItem('➕ Создать новый спринт', 'createNextSprint')
    .addItem('📤 Отправить отчёт сейчас', 'sendWeeklyReport')
    .addItem('🧪 Тест сообщения (без отправки)', 'testMessage')
    .addSeparator()
    .addItem('⚙️ Настроить ежедневный триггер', 'setupDailyTrigger')
    .addItem('🗑️ Удалить все триггеры', 'removeAllTriggers')
    .addToUi();
}

/**
 * 📅 Заполнить даты нового спринта
 * Начинает с завтрашнего дня, заполняет столько дней, сколько было в предыдущем спринте
 */
function fillSprintDates(sheet) {
  const daysCount = getSprintDaysCount(sheet);
  if (daysCount === 0) {
    Logger.log('⚠️ Не удалось определить количество дней в спринте');
    return;
  }

  const today = new Date();
  const MILLIS_PER_DAY = 1000 * 60 * 60 * 24;

  for (let i = 0; i < daysCount; i++) {
    // Начинаем с завтра
    const newDate = new Date(today.getTime() + (i + 1) * MILLIS_PER_DAY);

    // Пишем настоящий объект Date (не строку!) — иначе getDaysLeftInSprint()
    // не сможет распарсить дату обратно на авто-созданных спринтах
    sheet.getRange(CONFIG.checkboxesStartRow + i, CONFIG.datesColumn)
      .setValue(newDate)
      .setNumberFormat('dd.MM.yy');
  }

  Logger.log(`📅 Заполнено ${daysCount} дат`);
}

/**
 * ☐ Сбросить все чекбоксы чтения (динамически)
 */
function resetAllCheckboxes(sheet) {
  const members = getMembers(sheet);
  const daysCount = getSprintDaysCount(sheet);

  if (members.length === 0 || daysCount === 0) {
    Logger.log('⚠️ Не удалось определить границы чекбоксов');
    return;
  }

  // Определяем диапазон: от первого участника до последнего, все дни
  const startCol = members[0].column;
  const endCol = members[members.length - 1].column;
  const colCount = endCol - startCol + 1;

  const range = sheet.getRange(CONFIG.checkboxesStartRow, startCol, daysCount, colCount);
  range.uncheck();

  Logger.log(`☐ Сброшено чекбоксов: ${daysCount} x ${colCount}`);
}

/**
 * ☐ Сбросить чекбоксы "дочитал общую книгу" в правой секции
 */
function resetBookCheckboxes(sheet) {
  const section = findBooksSection(sheet);
  if (!section) {
    Logger.log('⚠️ Секция книг не найдена, пропускаю сброс');
    return;
  }

  const finishedCol = section.col + 2; // L - чекбокс "дочитал"

  // Ищем все чекбоксы в этой колонке (пропускаем заголовки)
  let row = section.row + 1;
  let resetCount = 0;

  while (row <= section.row + 30) {
    const cell = sheet.getRange(row, finishedCol);
    const value = cell.getValue();

    // Если это чекбокс (true или false), сбрасываем
    if (value === true || value === false) {
      cell.uncheck();
      resetCount++;
    }

    row++;
  }

  Logger.log(`☐ Сброшено чекбоксов книг: ${resetCount}`);
}

/**
 * ➕ СОЗДАТЬ НОВЫЙ СПРИНТ
 * Копирует текущий лист, увеличивает номер, сбрасывает даты и чекбоксы.
 *
 * silent = false (по умолчанию) — вызов из меню, показывает UI-алерт.
 * silent = true — автоматический вызов из sendWeeklyReport, без UI.
 *
 * Защищена от двойного срабатывания:
 * - LockService не даёт выполниться двум вызовам одновременно
 *   (например ручной запуск + сработавший в то же время триггер);
 * - если лист с таким именем уже существует — создание пропускается,
 *   а не падает с необработанной ошибкой на newSheet.setName(...).
 */
function createNextSprint(silent = false) {
  const lock = LockService.getScriptLock();
  const gotLock = lock.tryLock(30000);
  if (!gotLock) {
    Logger.log('⚠️ Не удалось получить блокировку — создание спринта уже выполняется параллельно');
    return null;
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const current = getCurrentSheet();

    const newSprintNumber = current.number + 1;
    const newSprintName = `Fortnight ${newSprintNumber}`;

    // Лист с таким именем уже есть — значит спринт уже кто-то создал
    // (повторный триггер, ручной запуск сразу после автоматического и т.п.)
    const existingSheet = ss.getSheetByName(newSprintName);
    if (existingSheet) {
      Logger.log(`⚠️ Лист "${newSprintName}" уже существует — пропускаю создание`);
      return existingSheet;
    }

    Logger.log(`Создаю новый спринт: ${newSprintName}`);

    const newSheet = current.sheet.copyTo(ss);
    newSheet.setName(newSprintName);
    ss.setActiveSheet(newSheet);
    ss.moveActiveSheet(1);

    fillSprintDates(newSheet);
    resetAllCheckboxes(newSheet);
    resetBookCheckboxes(newSheet);

    Logger.log(`✅ Спринт "${newSprintName}" создан!`);

    if (!silent) {
      SpreadsheetApp.getUi().alert(
        '✅ Новый спринт создан!',
        `Создан лист "${newSprintName}" с датами на следующие 14 дней.\n\nВсе чекбоксы сброшены.`,
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    }

    return newSheet;
  } finally {
    lock.releaseLock();
  }
}
