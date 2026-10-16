(function(){
"use strict";
const CONFIG = window.CONFIG || {};
const SETS = window.WORDSETS || {};
const SET_LABEL = { suneung: "수능", final: "기말" };
const CHK = ["word","syntax","problem"];
const $ = id => document.getElementById(id);

// ---------- 날짜 ----------
const pad = n => String(n).padStart(2,"0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const parse = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
const monday = d => { const x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate()-((x.getDay()+6)%7)); return x; };
const md = d => `${d.getMonth()+1}/${d.getDate()}`;

// ---------- 단어 세트 ----------
const BANK = {};   // set -> {words:[], byId:{}}
Object.keys(SETS).forEach(key => {
  const words = [];
  (SETS[key].days || []).forEach((s, i) => s.split(";").forEach(p => {
    const [en, ko] = p.split("|").map(x => (x||"").trim());
    if (en && ko) words.push({ id: en, day: i+1, en, ko });
  }));
  BANK[key] = { words, byId: Object.fromEntries(words.map(w => [w.id, w])), dayCount: (SETS[key].days||[]).length };
});
const toks = s => s.split(",").map(x => x.trim());

// ---------- 저장소 (이 기기 + 구글 시트) ----------
const CACHE_KEY = "ennote.v1";
let store = { logs:{}, notes:{}, pending:{ logs:{}, notes:{} } };
try { const raw = localStorage.getItem(CACHE_KEY); if (raw) store = Object.assign(store, JSON.parse(raw)); } catch(e) {}
store.pending = store.pending || { logs:{}, notes:{} };
const persist = () => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(store)); } catch(e) {} };
const remote = !!(CONFIG.SCRIPT_URL || "").trim();
let lastSync = null, syncError = false;

async function post(payload){
  const res = await fetch(CONFIG.SCRIPT_URL, { method:"POST", body: JSON.stringify(payload) });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "save failed");
  return j;
}
async function pushLog(date){
  if (!remote) return false;
  try { await post({ action:"saveLog", date, log: store.logs[date] }); delete store.pending.logs[date]; persist(); lastSync = new Date(); syncError = false; return true; }
  catch(e){ syncError = true; return false; }
  finally { renderSync(); }
}
async function pushNote(wk){
  if (!remote) return false;
  try { await post({ action:"saveNote", week: wk, note: store.notes[wk] }); delete store.pending.notes[wk]; persist(); lastSync = new Date(); syncError = false; return true; }
  catch(e){ syncError = true; return false; }
  finally { renderSync(); }
}
async function pullAll(){
  if (!remote) return;
  try {
    for (const d of Object.keys(store.pending.logs)) await pushLog(d);
    for (const w of Object.keys(store.pending.notes)) await pushNote(w);
    const res = await fetch(CONFIG.SCRIPT_URL + "?action=all&t=" + Date.now());
    const j = await res.json();
    if (!j.ok) throw new Error(j.error);
    Object.entries(j.logs || {}).forEach(([d, L]) => { if (!store.pending.logs[d]) store.logs[d] = L; });
    Object.entries(j.notes || {}).forEach(([w, N]) => { if (!store.pending.notes[w]) store.notes[w] = N; });
    persist(); lastSync = new Date(); syncError = false;
  } catch(e) { syncError = true; }
  renderSync(); renderAll();
}
function renderSync(){
  let t;
  if (!remote) t = "기록은 이 기기에만 저장돼요 · 구글 시트 연결 전";
  else if (syncError) t = "구글 시트에 연결하지 못했어요 · 기록은 이 기기에 보관했다가 다음에 다시 보내요";
  else if (lastSync) t = `구글 시트와 동기화됨 · ${pad(lastSync.getHours())}:${pad(lastSync.getMinutes())}`;
  else t = "구글 시트에서 불러오는 중…";
  $("syncHome").textContent = t; $("syncApp").textContent = t;
}

function saveLog(date, patch){
  const cur = JSON.parse(JSON.stringify(store.logs[date] || {}));
  const next = Object.assign(cur, patch, {
    checks: Object.assign({}, cur.checks || {}, patch.checks || {}),
    quiz: Object.assign({}, cur.quiz || {}, patch.quiz || {}),
    updatedAt: new Date().toISOString()
  });
  store.logs[date] = next; store.pending.logs[date] = true; persist();
  renderAll();
  return pushLog(date);
}

// ---------- 화면 상태 ----------
let set = null, logDate = todayStr(), weekStart = monday(new Date()), day = 1, dir = "ek", hideMeaning = false, Q = null;
const S = () => SETS[set];
const B = () => BANK[set];
function quizzesOf(L, key){ return Object.values((L && L.quiz) || {}).filter(q => q.set === key); }

// ---------- 첫 화면 ----------
function renderHome(){
  const fin = BANK.final, sun = BANK.suneung;
  let fi = fin && fin.words.length ? `${fin.words.length}단어 · Day ${fin.dayCount}개` : "준비 중 · 시험 범위 단어를 넣으면 열려요";
  if (CONFIG.FINAL_EXAM_DATE) {
    const diff = Math.round((parse(CONFIG.FINAL_EXAM_DATE) - parse(todayStr())) / 86400000);
    if (diff >= 0) fi = `D-${diff === 0 ? "DAY" : diff} · ` + fi;
  }
  $("finalInfo").textContent = fi;
  $("pick-final").classList.toggle("soon", !(fin && fin.words.length));
  $("suneungInfo").textContent = `${sun.words.length}단어 · 완료 Day ${doneDays("suneung").size}/${sun.dayCount} · 목표 영어 3등급`;
}
function doneDays(key){
  const s = new Set();
  Object.values(store.logs).forEach(L => quizzesOf(L, key).forEach(q => { if (q.score / q.total >= 0.8) s.add(q.day); }));
  return s;
}
document.querySelectorAll(".pick").forEach(b => b.onclick = () => openSet(b.dataset.set));
$("backHome").onclick = () => { $("app").hidden = true; $("home").hidden = false; renderHome(); window.scrollTo(0,0); };

function openSet(key){
  set = key; day = 1; Q = null;
  $("home").hidden = true; $("app").hidden = false;
  $("setTitle").textContent = S().name; $("setSub").textContent = S().sub;
  $("syntaxHint").textContent = S().syntaxHint; $("problemHint").textContent = S().problemHint;
  selectTab("today"); renderAll(); window.scrollTo(0,0);
}

// ---------- 탭 ----------
function selectTab(v){
  document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x.dataset.view === v));
  ["today","words","week"].forEach(k => $("view-"+k).hidden = k !== v);
  if (v === "words") backToWords();
  if (v === "week") renderWeek();
}
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => selectTab(b.dataset.view));

// ---------- 오늘 ----------
function renderToday(){
  $("logDate").value = logDate;
  const d = parse(logDate);
  $("todayTitle").textContent = logDate === todayStr() ? "오늘 할 일" : `${d.getMonth()+1}월 ${d.getDate()}일 기록`;
  const L = store.logs[logDate] || {}, c = L.checks || {};
  CHK.forEach(k => { $("chk-"+k).checked = !!c[k]; $("c-"+k).classList.toggle("done", !!c[k]); });
  if (document.activeElement !== $("memo")) $("memo").value = L.memo || "";
  const qs = Object.values(L.quiz || {});
  $("todayQuiz").textContent = qs.length
    ? "단어 퀴즈: " + qs.map(q => `${SET_LABEL[q.set]||q.set} Day ${q.day} ${q.score}/${q.total}`).join(" · ")
    : "아직 단어 퀴즈 기록이 없어요.";
}
CHK.forEach(k => $("chk-"+k).onchange = e => saveLog(logDate, { checks: { [k]: e.target.checked } }));
$("logDate").onchange = e => { if (e.target.value) { logDate = e.target.value; renderToday(); } };
$("saveMemo").onclick = async () => {
  $("saveStatus").textContent = "저장 중…";
  const ok = await saveLog(logDate, { memo: $("memo").value.trim() });
  $("saveStatus").textContent = ok ? "저장했어요" : (remote ? "이 기기에 저장했어요 · 시트 연결 후 다시 보내요" : "이 기기에 저장했어요");
};

// ---------- 단어 ----------
function renderWordsHome(){
  const has = B().words.length > 0;
  $("wordsTitle").textContent = has ? `${S().name} ${B().words.length}` : S().name;
  $("wordsEmpty").hidden = has; $("wordsBody").hidden = !has;
  if (!has) { $("wordsEmpty").textContent = "아직 시험 범위 단어가 없어요. 교과서 단어장이나 본문 사진을 주시면 Day별로 나눠서 넣어 드릴게요. 그동안 '오늘' 탭의 체크와 메모는 그대로 쓸 수 있어요."; return; }
  const done = doneDays(set);
  const per = Math.round(B().words.length / B().dayCount);
  $("dayLabel").textContent = `DAY 선택 (하루 ${per}개 · 80% 이상 맞히면 완료)`;
  const dp = $("dayPick"); dp.innerHTML = "";
  for (let i = 1; i <= B().dayCount; i++) {
    const b = document.createElement("button");
    b.setAttribute("aria-pressed", i === day);
    b.innerHTML = `Day ${i}<span class="done">${done.has(i) ? "완료" : "&nbsp;"}</span>`;
    b.onclick = () => { day = i; renderWordsHome(); if (!$("listBox").hidden) showList(); };
    dp.appendChild(b);
  }
  const n = recentWrong().length;
  $("startReview").disabled = !n;
  $("reviewInfo").textContent = n ? `최근 7일 동안 틀린 단어 ${n}개를 모아서 다시 풀 수 있어요.` : "퀴즈에서 틀린 단어가 생기면 여기서 모아 복습할 수 있어요.";
}
function setDir(d){ dir = d; $("dir-ek").setAttribute("aria-pressed", d === "ek"); $("dir-ke").setAttribute("aria-pressed", d === "ke"); }
$("dir-ek").onclick = () => setDir("ek");
$("dir-ke").onclick = () => setDir("ke");
function showList(){
  $("listBox").hidden = false;
  const ws = B().words.filter(w => w.day === day);
  $("listTitle").textContent = `DAY ${day} · ${ws.length}단어`;
  const box = $("wordList"); box.innerHTML = "";
  ws.forEach((w, i) => {
    const r = document.createElement("div"); r.className = "wl";
    r.innerHTML = `<span class="n">${i+1}</span><span class="w"></span><span class="m"></span>`;
    r.querySelector(".w").textContent = w.en;
    const m = r.querySelector(".m"); m.textContent = w.ko;
    if (hideMeaning) { m.classList.add("hide"); m.title = "눌러서 뜻 보기"; m.onclick = () => m.classList.remove("hide"); }
    box.appendChild(r);
  });
}
$("showList").onclick = showList;
$("toggleHide").onclick = () => { hideMeaning = !hideMeaning; $("toggleHide").textContent = hideMeaning ? "뜻 보이기" : "뜻 가리기"; showList(); };
function recentWrong(){
  const cut = new Date(); cut.setDate(cut.getDate()-6); const c = ymd(cut); const s = new Set();
  Object.entries(store.logs).forEach(([d, L]) => { if (d >= c) quizzesOf(L, set).forEach(q => (q.wrong||[]).forEach(id => B().byId[id] && s.add(id))); });
  return [...s];
}

const shuffle = a => { a = a.slice(); for (let i = a.length-1; i > 0; i--) { const j = Math.random()*(i+1)|0; [a[i],a[j]] = [a[j],a[i]]; } return a; };
function startQuiz(ids, label, quizDay){
  if (!ids.length) return;
  Q = { items: shuffle(ids), i: 0, wrong: [], label, quizDay, dir, set };
  $("wordsHome").hidden = true; $("resultBox").hidden = true; $("quizBox").hidden = false; showQ();
}
function showQ(){
  const bank = B(), w = bank.byId[Q.items[Q.i]], ek = Q.dir === "ek";
  $("qLabel").textContent = Q.label; $("qCount").textContent = `${Q.i+1} / ${Q.items.length}`;
  $("qBar").style.width = (Q.i / Q.items.length * 100) + "%";
  $("qWord").textContent = ek ? w.en : w.ko; $("qWord").classList.toggle("ko", !ek);
  const t = toks(w.ko);
  let pool = bank.words.filter(x => x.id !== w.id && !toks(x.ko).some(k => t.includes(k)));
  if (pool.length < 3 && set !== "suneung") pool = pool.concat(BANK.suneung.words.filter(x => !toks(x.ko).some(k => t.includes(k))));
  const opts = shuffle([w, ...shuffle(pool).slice(0,3)]);
  const box = $("qOpts"); box.innerHTML = "";
  opts.forEach(o => {
    const b = document.createElement("button");
    b.textContent = ek ? o.ko : o.en; if (!ek) b.className = "en";
    b.dataset.right = o.id === w.id ? "1" : "";
    b.onclick = () => answer(b, o.id === w.id, box, w);
    box.appendChild(b);
  });
}
function answer(btn, ok, box, w){
  box.querySelectorAll("button").forEach(b => { b.disabled = true; if (b.dataset.right) b.classList.add("right"); });
  if (!ok) { btn.classList.add("wrong"); Q.wrong.push(w.id); }
  setTimeout(() => { Q.i++; if (Q.i < Q.items.length) showQ(); else finish(); }, ok ? 450 : 1100);
}
async function finish(){
  $("quizBox").hidden = true; $("resultBox").hidden = false;
  const total = Q.items.length, score = total - Q.wrong.length;
  $("rLabel").textContent = Q.label + " 결과";
  $("rScore").innerHTML = `${score}<small> / ${total}</small>`;
  const ws = $("rWrongs"); ws.innerHTML = "";
  $("rWrongWrap").hidden = !Q.wrong.length; $("retry").hidden = !Q.wrong.length;
  Q.wrong.forEach(id => { const w = B().byId[id]; const d = document.createElement("div"); d.innerHTML = "<b></b><span></span>"; d.querySelector("b").textContent = w.en; d.querySelector("span").textContent = w.ko; ws.appendChild(d); });
  $("rSaved").textContent = "";
  if (Q.quizDay) {
    const t = todayStr(), key = `${Q.set}-${Q.quizDay}`;
    const prev = ((store.logs[t] || {}).quiz || {})[key];
    const wrong = [...new Set([...((prev && prev.wrong) || []), ...Q.wrong])];
    const ok = await saveLog(t, { quiz: { [key]: { set: Q.set, day: Q.quizDay, score, total, wrong } }, checks: { word: true } });
    $("rSaved").textContent = (ok || !remote) ? "오늘 기록에 저장하고 '단어' 항목을 체크했어요." : "이 기기에 저장했어요. 시트에는 다음에 다시 보낼게요.";
  }
}
function backToWords(){ $("quizBox").hidden = true; $("resultBox").hidden = true; $("wordsHome").hidden = false; renderWordsHome(); }
$("startQuiz").onclick = () => startQuiz(B().words.filter(w => w.day === day).map(w => w.id), `DAY ${day}`, day);
$("startReview").onclick = () => startQuiz(recentWrong(), "오답 복습", 0);
$("retry").onclick = () => startQuiz(Q.wrong.slice(), "틀린 것 다시", 0);
$("quitQuiz").onclick = backToWords;
$("backWords").onclick = backToWords;

// ---------- 이번 주 ----------
const DN = ["월","화","수","목","금","토","일"];
const studied = k => { const c = (store.logs[k] || {}).checks || {}; return CHK.some(x => c[x]); };
function renderWeek(){
  const g = $("weekGrid"); g.innerHTML = ""; const memos = []; let days = 0, sum = 0, cnt = 0;
  const end = new Date(weekStart); end.setDate(end.getDate()+6);
  $("weekTitle").textContent = ymd(weekStart) === ymd(monday(new Date())) ? "이번 주" : `${md(weekStart)} ~ ${md(end)}`;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart); d.setDate(d.getDate()+i);
    const k = ymd(d), L = store.logs[k] || {}, c = L.checks || {};
    if (studied(k)) days++;
    const qs = quizzesOf(L, set);
    qs.forEach(q => { sum += q.score / q.total * 100; cnt++; });
    if (L.memo) memos.push([d, L.memo]);
    const el = document.createElement("div"); el.className = "wd" + (k === todayStr() ? " today" : "");
    const sc = qs.length ? Math.round(qs.reduce((a,q) => a + q.score/q.total*100, 0) / qs.length) + "점" : "";
    el.innerHTML = `<span class="dn">${DN[i]}</span><span class="dd">${d.getDate()}</span><span class="dots">${CHK.map(x => `<i class="${c[x] ? "on" : ""}"></i>`).join("")}</span><span class="sc">${sc}</span>`;
    g.appendChild(el);
  }
  $("sDays").textContent = days + "일";
  $("sAvg").textContent = cnt ? Math.round(sum / cnt) + "점" : "–";
  let s = 0; const d = new Date();
  if (!studied(ymd(d))) d.setDate(d.getDate()-1);
  while (studied(ymd(d))) { s++; d.setDate(d.getDate()-1); }
  $("sStreak").textContent = s + "일";
  const mb = $("weekMemos"); mb.innerHTML = "";
  if (!memos.length) mb.innerHTML = '<p class="empty">이번 주에 남긴 메모가 없어요. 오늘 탭에서 한 줄 메모를 남기면 여기에 모여요.</p>';
  memos.forEach(([d, t]) => { const m = document.createElement("div"); m.className = "memo"; m.innerHTML = `<em>${md(d)}</em><span></span>`; m.querySelector("span").textContent = t; mb.appendChild(m); });
  if (document.activeElement !== $("momNote")) $("momNote").value = (store.notes[ymd(weekStart)] || {}).text || "";
}
$("prevWeek").onclick = () => { weekStart.setDate(weekStart.getDate()-7); renderWeek(); };
$("nextWeek").onclick = () => { weekStart.setDate(weekStart.getDate()+7); renderWeek(); };
$("saveMom").onclick = async () => {
  const wk = ymd(weekStart);
  store.notes[wk] = { text: $("momNote").value.trim(), updatedAt: new Date().toISOString() };
  store.pending.notes[wk] = true; persist();
  $("momStatus").textContent = "저장 중…";
  const ok = await pushNote(wk);
  $("momStatus").textContent = ok ? "저장했어요" : "이 기기에 저장했어요";
};

function renderAll(){
  renderHome();
  if (!set) return;
  renderToday();
  if (!$("view-week").hidden) renderWeek();
  if (!$("view-words").hidden && !$("wordsHome").hidden) renderWordsHome();
}

renderSync(); renderHome(); pullAll();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pullAll(); });
})();
