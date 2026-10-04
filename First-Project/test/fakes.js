// Минимальная подделка Google Sheets для локальных тестов: ровно те методы,
// которые вызывает бот (getRange/getValue(s)/setValue(s)/uncheck,
// getLastRow, insertSheet, copyTo и т.п.). Пустая ячейка, как и в Apps
// Script, возвращает ''.

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }
  getValue() {
    return this.sheet.get(this.row, this.col);
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) line.push(this.sheet.get(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  setValue(value) {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) this.sheet.set(this.row + r, this.col + c, value);
    }
    return this;
  }
  setValues(values) {
    if (values.length !== this.numRows || values.some(v => v.length !== this.numCols)) {
      throw new Error(`setValues: размер ${values.length}x${values[0] && values[0].length} не совпадает с диапазоном ${this.numRows}x${this.numCols}`);
    }
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  uncheck() {
    return this.setValue(false);
  }
  setNumberFormat() {
    return this;
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.cells = new Map();
    this.hidden = false;
  }
  get(row, col) {
    const key = `${row},${col}`;
    return this.cells.has(key) ? this.cells.get(key) : '';
  }
  set(row, col, value) {
    if (row < 1 || col < 1) throw new Error(`Неверная ячейка ${row},${col}`);
    const v = value instanceof Date ? new Date(value.getTime()) : value;
    this.cells.set(`${row},${col}`, v);
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    return new FakeRange(this, row, col, numRows, numCols);
  }
  getLastRow() {
    let last = 0;
    for (const [key, value] of this.cells) {
      if (value === '' || value === null || value === undefined) continue;
      last = Math.max(last, Number(key.split(',')[0]));
    }
    return last;
  }
  getName() {
    return this.name;
  }
  setName(name) {
    this.name = name;
    return this;
  }
  hideSheet() {
    this.hidden = true;
    return this;
  }
  copyTo(spreadsheet) {
    const copy = new FakeSheet(`Копия ${this.name}`);
    for (const [key, value] of this.cells) copy.cells.set(key, value instanceof Date ? new Date(value.getTime()) : value);
    spreadsheet.sheets.push(copy);
    return copy;
  }
}

class FakeSpreadsheet {
  constructor() {
    this.sheets = [];
  }
  getSheets() {
    return this.sheets.slice();
  }
  getSheetByName(name) {
    return this.sheets.find(s => s.getName() === name) || null;
  }
  insertSheet(name) {
    if (this.getSheetByName(name)) throw new Error(`Лист ${name} уже есть`);
    const sheet = new FakeSheet(name);
    this.sheets.push(sheet);
    return sheet;
  }
  addSheet(sheet) {
    this.sheets.push(sheet);
    return sheet;
  }
  getUrl() {
    return 'https://docs.google.com/spreadsheets/d/TEST';
  }
  setActiveSheet(sheet) {
    this.active = sheet;
    return sheet;
  }
  moveActiveSheet() {}
}

module.exports = { FakeSheet, FakeSpreadsheet };
