/**
 * 영어 자습 노트 — 구글 시트 기록 저장용 Apps Script
 *
 * 시트 두 개를 자동으로 만듭니다.
 *  - "학습기록"  : 날짜별 체크 · 퀴즈 점수 · 틀린 단어 · 메모
 *  - "엄마한마디": 주(월요일 시작)별 한마디. 시트에 직접 입력해도 앱에 표시됩니다.
 *
 * 배포: 배포 > 새 배포 > 유형 "웹 앱"
 *       실행 사용자: 나 / 액세스 권한: 모든 사용자
 */

const TZ = 'Asia/Seoul';
const LOG_SHEET = '학습기록';
const NOTE_SHEET = '엄마한마디';
const LOG_HEAD = ['날짜', '단어', '구문', '문제', '퀴즈 기록', '틀린 단어', '메모', '수정 시각', '원본(JSON)'];
const NOTE_HEAD = ['주 시작일(월)', '엄마 한마디', '수정 시각'];
const SET_LABEL = { suneung: '수능', final: '기말' };

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'all';
    if (action !== 'all') return json_({ ok: false, error: 'unknown action' });
    return json_({ ok: true, logs: readLogs_(), notes: readNotes_() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'saveLog') { writeLog_(body.date, body.log); return json_({ ok: true }); }
    if (body.action === 'saveNote') { writeNote_(body.week, body.note); return json_({ ok: true }); }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

// ---------- 학습기록 ----------
function writeLog_(date, log) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('bad date');
  log = log || {};
  const sh = sheet_(LOG_SHEET, LOG_HEAD);
  const c = log.checks || {};
  const quizzes = Object.keys(log.quiz || {}).map(function (k) { return log.quiz[k]; });
  const quizText = quizzes.map(function (q) { return (SET_LABEL[q.set] || q.set) + ' Day' + q.day + ' ' + q.score + '/' + q.total; }).join(', ');
  const wrong = [];
  quizzes.forEach(function (q) { (q.wrong || []).forEach(function (w) { if (wrong.indexOf(w) < 0) wrong.push(w); }); });
  const row = [date, c.word ? '✓' : '', c.syntax ? '✓' : '', c.problem ? '✓' : '', quizText, wrong.join(', '),
    log.memo || '', Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'), JSON.stringify(log)];
  const r = findRow_(sh, date);
  if (r) sh.getRange(r, 1, 1, row.length).setValues([row]);
  else {
    sh.appendRow(row);
    sh.getRange(2, 1, sh.getLastRow() - 1, row.length).sort({ column: 1, ascending: false });
  }
}

function readLogs_() {
  const sh = sheet_(LOG_SHEET, LOG_HEAD);
  const out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, LOG_HEAD.length).getValues().forEach(function (r) {
    const d = dateKey_(r[0]);
    if (!d) return;
    let log = {};
    try { log = JSON.parse(r[8] || '{}'); } catch (x) {}
    // 시트에서 체크·메모를 직접 고친 경우 그 값을 우선합니다.
    log.checks = { word: !!r[1], syntax: !!r[2], problem: !!r[3] };
    log.memo = String(r[6] || '');
    out[d] = log;
  });
  return out;
}

// ---------- 엄마 한마디 ----------
function writeNote_(week, note) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week || '')) throw new Error('bad week');
  const sh = sheet_(NOTE_SHEET, NOTE_HEAD);
  const row = [week, (note && note.text) || '', Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm')];
  const r = findRow_(sh, week);
  if (r) sh.getRange(r, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}

function readNotes_() {
  const sh = sheet_(NOTE_SHEET, NOTE_HEAD);
  const out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, NOTE_HEAD.length).getValues().forEach(function (r) {
    const w = dateKey_(r[0]);
    if (w) out[w] = { text: String(r[1] || ''), updatedAt: String(r[2] || '') };
  });
  return out;
}

// ---------- 공통 ----------
function sheet_(name, head) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@'); // 날짜를 문자열로 유지
    if (name === LOG_SHEET) sh.hideColumns(head.length); // 원본(JSON) 열 숨김
  }
  return sh;
}

function findRow_(sh, key) {
  if (sh.getLastRow() < 2) return 0;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) if (dateKey_(vals[i][0]) === key) return i + 2;
  return 0;
}

function dateKey_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
