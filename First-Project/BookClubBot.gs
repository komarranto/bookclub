// ==================== НАСТРОЙКИ ====================
// Вставь сюда свои данные:
const TELEGRAM_BOT_TOKEN = 'ВАШ_ТОКЕН_БОТА';  // Получить у @BotFather
const TELEGRAM_CHAT_ID = 'ВАШ_CHAT_ID';        // ID чата или группы

// Секрет для проверки вебхука (см. раздел "Команды в Telegram" в README).
// Сгенерируй любую длинную случайную строку и используй её же при вызове
// setupTelegramWebhook() — Telegram будет присылать её в каждом запросе,
// так doPost() отличает реальные апдейты Telegram от чужих запросов на /exec.
const TELEGRAM_WEBHOOK_SECRET = 'ВАШ_СЕКРЕТ_ВЕБХУКА';

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
// Ровно 5 слотов, равномерно от утра до вечера — на каждый день выходных,
// итого 5 + 5 = 10 вариантов, это максимум, который допускает Telegram Poll
const MEETING_TIME_SLOTS = ['11:00', '13:30', '16:00', '18:30', '21:00'];

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
 * Стрик считается от последнего отмеченного дня назад
 */
function calculateStreak(memberName, fortnightSheets) {
  let streak = 0;
  let foundFirstTrue = false;

  for (const sheetInfo of fortnightSheets) {
    // Находим колонку участника по имени
    const memberColumn = findMemberColumn(sheetInfo.sheet, memberName);

    if (!memberColumn) {
      // Участник не найден на этом листе — стрик прерывается
      return streak;
    }

    const daysCount = getSprintDaysCount(sheetInfo.sheet);
    const checkboxes = getCheckboxesForMember(sheetInfo.sheet, memberColumn, daysCount);

    // Идём с конца листа к началу
    for (let i = checkboxes.length - 1; i >= 0; i--) {
      if (checkboxes[i]) {
        foundFirstTrue = true;
        streak++;
      } else if (foundFirstTrue) {
        // Нашли false после true — стрик прервался
        return streak;
      }
      // Если ещё не нашли первый true — пропускаем false (будущие дни)
    }
    // Весь лист заполнен — продолжаем к предыдущему
  }

  return streak;
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

    // Стрик — ищем по ИМЕНИ
    const streak = calculateStreak(member.name, fortnightSheets);

    results.push({
      name: member.name,
      daysRead: daysRead,
      totalDays: totalDays,
      percentage: percentage,
      streak: streak
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

  const lastDate = new Date(lastDateCell);
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
function formatWeeklyMessage(readingData, booksData, commonBook, sprintName, isLastDay = false, daysLeft = -1, previousAvg = null) {
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

    msg += `│ ${medal} *${m.name}*\n`;
    msg += `│    ${bar} ${m.percentage}% (${m.daysRead}/${m.totalDays})${streakText}\n`;

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
  const quote = READING_QUOTES[Math.floor(Math.random() * READING_QUOTES.length)];
  msg += `_${quote}_\n\n`;
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
function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[
        { text: '📊 Открыть таблицу', url: SpreadsheetApp.getActiveSpreadsheet().getUrl() }
      ]]
    }
  };

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
function sendTelegramPoll(question, options) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPoll`;

  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    question: question,
    options: options,
    is_anonymous: false,
    allows_multiple_answers: false
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
 * Дата в формате "сб 20 авг" для вариантов опроса
 */
function formatShortDate(date) {
  const weekdays = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${weekdays[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
}

/**
 * Построить ровно 10 вариантов ответа для опроса: суббота и воскресенье
 * ближайших к targetDate выходных, на каждый день — все MEETING_TIME_SLOTS
 */
function buildMeetingPollOptions(targetDate) {
  const { saturday, sunday } = getUpcomingWeekend(targetDate);
  const options = [];

  for (const day of [saturday, sunday]) {
    for (const time of MEETING_TIME_SLOTS) {
      options.push(`${formatShortDate(day)}, ${time}`);
    }
  }

  return options;
}

/**
 * Отправить опрос с вариантами даты/времени встречи и запомнить
 * фактически предложенную субботу в PropertiesService (без листов —
 * это встроенное хранилище ключ-значение Apps Script, ничего не создаёт
 * в самой таблице), чтобы /another_time знал, от чего отсчитывать неделю.
 */
function proposeMeetingPoll(targetDate) {
  const { saturday, sunday } = getUpcomingWeekend(targetDate);
  const question = `📅 Встреча книжного клуба — выбираем дату и время (${formatShortDate(saturday)} / ${formatShortDate(sunday)})`;
  const options = buildMeetingPollOptions(targetDate);

  sendTelegramPoll(question, options);

  PropertiesService.getScriptProperties().setProperty(
    'lastProposedMeetingDate',
    saturday.toISOString()
  );

  Logger.log(`📅 Предложены даты встречи: ${formatShortDate(saturday)} / ${formatShortDate(sunday)}`);
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

  const message = formatWeeklyMessage(readingData, booksData, commonBook, current.name, isLastDay, daysLeft, previousAvg);

  Logger.log('\n--- СООБЩЕНИЕ ---\n' + message);

  sendTelegramMessage(message);

  // Начисление бейджей — не должно ронять отправку отчёта, если что-то пойдёт не так
  try {
    const newBadges = awardBadges(readingData, current, isLastDay);
    if (newBadges.length > 0) {
      sendTelegramMessage(formatNewBadgesMessage(newBadges));
    }
  } catch (error) {
    Logger.log('⚠️ Ошибка при начислении бейджей: ' + error);
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
