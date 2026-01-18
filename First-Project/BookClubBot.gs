// ==================== НАСТРОЙКИ ====================
// Вставь сюда свои данные:
const TELEGRAM_BOT_TOKEN = 'ВАШ_ТОКЕН_БОТА';  // Получить у @BotFather
const TELEGRAM_CHAT_ID = 'ВАШ_CHAT_ID';        // ID чата или группы

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
 */
function calculateStreak(memberName, fortnightSheets) {
  let streak = 0;

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
        streak++;
      } else {
        return streak;
      }
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
 * Сформировать еженедельное сообщение (красивый дизайн)
 */
function formatWeeklyMessage(readingData, booksData, commonBook, sprintName) {
  let msg = '';

  // Заголовок
  msg += '═══════════════════════\n';
  msg += `       📚 *КНИЖНЫЙ КЛУБ*\n`;
  msg += `              ${sprintName}\n`;
  msg += '═══════════════════════\n\n';

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
  msg += '    _Приятного чтения!_ 📖\n';
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
    parse_mode: 'Markdown'
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

  const message = formatWeeklyMessage(readingData, booksData, commonBook, current.name);

  Logger.log('\n--- СООБЩЕНИЕ ---\n' + message);

  sendTelegramMessage(message);
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

  const message = formatWeeklyMessage(readingData, booksData, commonBook, current.name);

  Logger.log('\n--- СООБЩЕНИЕ ДЛЯ TELEGRAM ---\n');
  Logger.log(message);

  Logger.log('\n--- ДАННЫЕ ---');
  Logger.log('Чтение: ' + JSON.stringify(readingData, null, 2));
  Logger.log('Книги: ' + JSON.stringify(booksData, null, 2));
}

/**
 * ⚙️ НАСТРОИТЬ ЕЖЕНЕДЕЛЬНЫЙ ТРИГГЕР
 * Запусти один раз — отчёт будет отправляться каждое воскресенье в 18:00
 */
function setupWeeklyTrigger() {
  // Удаляем старые триггеры
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'sendWeeklyReport') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // Создаём новый — каждое воскресенье в 18:00
  ScriptApp.newTrigger('sendWeeklyReport')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(18)
    .create();

  Logger.log('✅ Триггер создан! Отчёт будет приходить каждое воскресенье в 18:00');
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
