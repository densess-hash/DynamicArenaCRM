/************************************************************
 * ORI-ON DYNAMIC CRM BACKEND (Date-Safe + Dashboard + Search)
 ************************************************************/

const SPREADSHEET_ID = '1yUbwz5q-yE9E8zWRIqBzfSup7I8E5q5y6dWSBezeaAE';

/** Core spreadsheet utils */
function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}
function sheetExists(name){
  try { return !!getSpreadsheet().getSheetByName(name); } catch(e){ return false; }
}
function safeGet(entity){
  return sheetExists(entity) ? getData(entity) : [];
}

/** Entities & data */
function getEntities() {
  return getSpreadsheet().getSheets().map(s => s.getName());
}
function getHeaders(entity) {
  const sh = getSpreadsheet().getSheetByName(entity);
  if (!sh) return [];
  return sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
}
function getData(entity) {
  const sh = getSpreadsheet().getSheetByName(entity);
  if (!sh) return [];
  const values = sh.getDataRange().getValues();
  if (!values.length) return [];
  const headers = values.shift();
  return values.map(row => {
    const o = {};
    headers.forEach((h,i) => {
      let v = row[i];
      if (v instanceof Date) {
        v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      }
      o[h] = v;
    });
    return o;
  });
}
function saveData(entity, record) {
  const sh = getSpreadsheet().getSheetByName(entity);
  if (!sh) throw new Error(`Entity not found: ${entity}`);
  const values = sh.getDataRange().getValues();
  const headers = values[0] || [];
  const idField = headers.find(h => /ID$/i.test(h));
  if (!idField) throw new Error('No ID column found');
  const idIndex = headers.indexOf(idField);
  const idValue = record[idField];
  let updated = false;
  for (let r=1; r<values.length; r++){
    if (values[r][idIndex] === idValue && idValue){
      headers.forEach((h,c)=> sh.getRange(r+1, c+1).setValue(record[h] ?? ''));
      updated = true;
      break;
    }
  }
  if (!updated){
    const newRow = headers.map(h => record[h] ?? '');
    sh.appendRow(newRow);
  }
  SpreadsheetApp.flush();
  return 'OK';
}

/** HTML include & webapp */
function include(filename){ return HtmlService.createHtmlOutputFromFile(filename).getContent(); }
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Ori-On Dynamic CRM')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/** Aggregations for dashboard tiles */
function getAggregations(entity, header) {
  const sh = getSpreadsheet().getSheetByName(entity);
  if (!sh) return null;
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return null;
  const headers = values.shift();
  const idx = headers.indexOf(header);
  if (idx === -1) return null;

  const col = values.map(r=>r[idx]).filter(v=>v!==''&&v!=null);

  // numeric?
  const nums = col.map(v => Number(String(v).replace(/[^0-9.\-]/g,'')));
  if (nums.every(n => !isNaN(n)) && nums.length){
    const min = Math.min(...nums), max = Math.max(...nums);
    const n=6, step = (max-min)/(n||1) || 1;
    const buckets=[];
    for (let i=0;i<n;i++){
      const low=min+i*step, high=(i===n-1?max:(low+step));
      const count=nums.filter(x=>x>=low&&x<=high).length;
      buckets.push({range:`${Math.round(low)}–${Math.round(high)}`,count});
    }
    return {type:'numeric',buckets};
  }

  // date-ish
  if (/date|on|posted|hire|start|created/i.test(header)){
    const m={};
    col.forEach(v=>{
      const d=new Date(v);
      if (!isNaN(d.getTime())){
        const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        m[key]=(m[key]||0)+1;
      }
    });
    const buckets = Object.entries(m).map(([k,v])=>({k,v})).sort((a,b)=>a.k.localeCompare(b.k));
    return {type:'date',buckets};
  }

  // categorical
  const counts={};
  col.forEach(v=>counts[String(v)] = (counts[String(v)]||0)+1);
  const buckets = Object.entries(counts).map(([k,v])=>({k,v})).sort((a,b)=>b.v-a.v);
  return {type:'categorical', buckets};
}

/** Filters & aggregates for Advanced Mode */
function getFilteredData(entity, filters){
  const rows = getData(entity);
  if (!filters || !filters.length) return rows;
  return rows.filter(row => {
    return filters.every(f => {
      const raw = row[f.field];
      const val = (raw==null)?'':String(raw);
      const cmp = String(f.value ?? '');
      switch (f.op) {
        case '=':  return val.toLowerCase() === cmp.toLowerCase();
        case '!=': return val.toLowerCase() !== cmp.toLowerCase();
        case 'contains': return val.toLowerCase().includes(cmp.toLowerCase());
        case '>':  return Number(val) >  Number(cmp);
        case '<':  return Number(val) <  Number(cmp);
        case '>=': return Number(val) >= Number(cmp);
        case '<=': return Number(val) <= Number(cmp);
        case 'between': {
          const [min,max] = cmp.split(',').map(s=>Number(s.trim()));
          const n = Number(val);
          return !isNaN(n) && n>=min && n<=max;
        }
        case 'in': {
          const list = cmp.split(',').map(s=>s.trim());
          return list.includes(val);
        }
        default: return true;
      }
    });
  });
}
function aggregateData(entity, dimension, measure, filters){
  const rows = getFilteredData(entity, filters);
  if (!rows.length) return {};
  const series = rows.map(r => r[dimension]);
  const numeric = series.every(v => !isNaN(Number(v)));

  if (measure==='sum' && numeric){
    const out={}; series.forEach(v=>{ const k=String(v||'Unknown'); out[k]=(out[k]||0)+Number(v||0); });
    return out;
  }
  if (measure==='avg' && numeric){
    const m={}; series.forEach(v=>{ const k=String(v||'Unknown'); if(!m[k]) m[k]={s:0,n:0}; m[k].s+=Number(v||0); m[k].n++; });
    const out={}; Object.keys(m).forEach(k => out[k] = Math.round(m[k].s/m[k].n));
    return out;
  }
  // count
  const out={}; series.forEach(v=>{ const k=String(v||'Unknown'); out[k]=(out[k]||0)+1; }); return out;
}

/** Dashboard default 6 tiles */
function getDashboardMetrics(){
  const out={};

  // 1) Hires per Recruiter
  if (sheetExists('Hires')){
    const data = getData('Hires'); const m={};
    data.forEach(r=>{ const k=r.RecruiterID||'Unassigned'; m[k]=(m[k]||0)+1; });
    out.hiresPerRecruiter = m;
  }

  // 2) Candidates per Company
  if (sheetExists('Candidates')){
    const data = getData('Candidates'); const m={};
    data.forEach(r=>{ const k=r.CurrentCompany||'Unknown'; m[k]=(m[k]||0)+1; });
    out.candidatesPerCompany = m;
  }

  // 3) Jobs by Status
  if (sheetExists('Jobs')){
    const data = getData('Jobs'); const m={};
    data.forEach(r=>{ const k=r.Status||'Unspecified'; m[k]=(m[k]||0)+1; });
    out.jobsByStatus = m;
  }

  // 4) Avg Expected Salary
  if (sheetExists('Candidates')){
    const data = getData('Candidates');
    const vals = data.map(r=>Number(String(r.SalaryExpectGrossMonthly_MXN||'').replace(/[^0-9.]/g,''))).filter(v=>!isNaN(v));
    if (vals.length) out.avgSalary = Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
  }

  // 5) Candidates by City
  if (sheetExists('Candidates')){
    const data = getData('Candidates'); const m={};
    data.forEach(r=>{ const k=r.Location||'Unknown'; m[k]=(m[k]||0)+1; });
    out.candidatesByCity = m;
  }

  // 6) Open Jobs by Owner
  if (sheetExists('Jobs')){
    const data = getData('Jobs'); const m={};
    data.forEach(r=>{
      const open = (String(r.Status||'').toLowerCase()!=='closed');
      const k = r.OwnerRecruiter || 'Unassigned';
      if (open) m[k]=(m[k]||0)+1;
    });
    out.openJobsByOwner = m;
  }

  return out;
}

/** Debug */
function verifySpreadsheetConnection(){
  const ss = getSpreadsheet();
  Logger.log('Connected to: ' + ss.getName());
  Logger.log('URL: ' + ss.getUrl());
}

/************************************************************
 * ORI-ON BOOLEAN SEARCH BACKEND (Search tab)
 ************************************************************/

/** Unique values helper (for dynamic dropdowns) */
function getUniqueValues(entity, header){
  const rows = getData(entity);
  const vals = rows.map(r => r[header]).filter(v => v!=null && v!=='');
  return Array.from(new Set(vals));
}

/** Shunting yard → AST for AND/OR/NOT, quotes, (), and field:value */
function buildFilterPlan(q){
  let s = String(q||'').trim();
  if (!s) return {type:'TRUE'};

  const tokens=[];
  const re = /"([^"]+)"|\(|\)|\bAND\b|\bOR\b|\bNOT\b|[^\s()]+/gi;
  let m; while ((m=re.exec(s))) tokens.push(m[0]);

  const out=[], ops=[];
  const prec={NOT:3, AND:2, OR:1};
  const isOp=t=>['AND','OR','NOT'].includes(t.toUpperCase());

  tokens.forEach(tok=>{
    if (tok==='('){ ops.push(tok); return; }
    if (tok===')'){ while(ops.length && ops[ops.length-1]!=='(') out.push(ops.pop()); ops.pop(); return; }
    if (isOp(tok)){
      const op = tok.toUpperCase();
      while (ops.length && isOp(ops[ops.length-1]) && prec[ops[ops.length-1]]>=prec[op]) out.push(ops.pop());
      ops.push(op); return;
    }
    out.push(tok);
  });
  while (ops.length) out.push(ops.pop());

  const stack=[];
  out.forEach(tok=>{
    const T = tok.toUpperCase();
    if (T==='AND'||T==='OR'){ const b=stack.pop(), a=stack.pop(); stack.push({type:T,a,b}); }
    else if (T==='NOT'){ const a=stack.pop(); stack.push({type:'NOT',a}); }
    else {
      const mf = tok.match(/^([a-zA-Z]+):(.*)$/);
      if (mf){
        const field = mf[1].toLowerCase();
        const value = mf[2].replace(/^"(.+)"$/,'$1').toLowerCase();
        stack.push({type:'FIELD', field, value});
      } else {
        const value = tok.replace(/^"(.+)"$/,'$1').toLowerCase();
        stack.push({type:'TEXT', value});
      }
    }
  });
  return stack[0] || {type:'TRUE'};
}

function evalPlan(node, getter){
  if (!node) return true;
  switch(node.type){
    case 'TRUE': return true;
    case 'TEXT': return getter('text', node.value);
    case 'FIELD': return getter(node.field, node.value);
    case 'NOT': return !evalPlan(node.a, getter);
    case 'AND': return evalPlan(node.a, getter) && evalPlan(node.b, getter);
    case 'OR':  return evalPlan(node.a, getter) ||  evalPlan(node.b, getter);
    default: return true;
  }
}

/**
 * Boolean search over Candidates.
 * Supports:
 *   - Free text and "quoted phrases"
 *   - AND / OR / NOT, parentheses
 *   - field:value (fields: skill, english, city/location, company,
 *                  status, recruiter, country, region, salary>=, salary<=)
 * @param {string} query
 * @param {object} extra {english, salaryMin, salaryMax, country, region}
 */
function searchCandidates(query, extra){
  const candidates = getData('Candidates');
  const apps = safeGet('Applications');

  // last contact per candidate (from Applications.LastContact)
  const lastByCand = {};
  apps.forEach(a=>{
    const id = a.CandidateID;
    const lc = a.LastContact ? new Date(a.LastContact) : null;
    if (!id || !lc || isNaN(lc.getTime())) return;
    if (!lastByCand[id] || lc > lastByCand[id]) lastByCand[id] = lc;
  });

  // skills map from CandidateSkills (SkillName OR Skill column, also split lists)
  const skillByCand = {};
  try {
    safeGet('CandidateSkills').forEach(r=>{
      const id = String(r.CandidateID||'').trim();
      const raw = r.SkillName ?? r.Skill ?? r.Skills ?? '';
      String(raw).split(/[;,]/).forEach(s=>{
        const t = String(s).trim().toLowerCase();
        if (!t) return;
        if (!skillByCand[id]) skillByCand[id] = new Set();
        skillByCand[id].add(t);
      });
    });
  } catch(e){}

  const plan = buildFilterPlan(query||'');

  const out = candidates.filter(c => {
    // Extra filters
    if (extra) {
      if (extra.english) {
        if (!String(c.EnglishLevel||'').toLowerCase().includes(String(extra.english).toLowerCase())) return false;
      }
      const sal = Number(String(c.SalaryExpectGrossMonthly_MXN||'').replace(/[^0-9.]/g,'')) || null;
      if (extra.salaryMin!=null && (sal==null || sal < extra.salaryMin)) return false;
      if (extra.salaryMax!=null && (sal==null || sal > extra.salaryMax)) return false;
      if (extra.country) {
        if (!String(c.Country||'').toLowerCase().includes(String(extra.country).toLowerCase())) return false;
      }
      if (extra.region) {
        if (!String(c.Region||'').toLowerCase().includes(String(extra.region).toLowerCase())) return false;
      }
    }

    // Boolean plan (empty plan = TRUE → passes)
    return evalPlan(plan, (kind, value) => {
      const v = String(value||'').toLowerCase();

      if (kind==='skill'){
        const set = skillByCand[String(c.CandidateID)] || new Set();
        return set.has(v) || String(c.DesiredRoles||'').toLowerCase().includes(v);
      }
      if (kind==='english')   return String(c.EnglishLevel||'').toLowerCase().includes(v);
      if (kind==='city' || kind==='location') return String(c.Location||'').toLowerCase().includes(v);
      if (kind==='company')   return String(c.CurrentCompany||'').toLowerCase().includes(v);
      if (kind==='status')    return String(c.CandidateStatus||'').toLowerCase().includes(v);
      if (kind==='recruiter') return String(c.OwnerRecruiter||'').toLowerCase().includes(v);
      if (kind==='country')   return String(c.Country||'').toLowerCase().includes(v);
      if (kind==='region')    return String(c.Region||'').toLowerCase().includes(v);

      if (kind==='salary>=' || kind==='salary<='){
        const n = Number(v);
        const s = Number(String(c.SalaryExpectGrossMonthly_MXN||'').replace(/[^0-9.]/g,''));
        if (isNaN(n) || isNaN(s)) return false;
        return (kind==='salary>=') ? (s>=n) : (s<=n);
      }

      // free text blob
      const blob = [
        c.FullName, c.FirstName, c.LastName, c.Email, c.Phone,
        c.CurrentTitle, c.DesiredRoles, c.Notes, c.Location, c.CurrentCompany
      ].join(' ').toLowerCase();
      return blob.includes(v);
    });
  }).map(c => {
    c._LastContact = lastByCand[c.CandidateID]
      ? Utilities.formatDate(lastByCand[c.CandidateID], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
      : '';
    return c;
  });

  return out.slice(0, 500);
}

/** Candidate drawer data */
function getCandidateDeep(candidateId) {
  const out = { candidate:null, skills:[], activities:[], applications:[], interviews:[], hires:[] };
  const cand = safeGet('Candidates').find(r => String(r.CandidateID) === String(candidateId));
  if (!cand) return out;
  out.candidate = cand;
  try { out.skills       = safeGet('CandidateSkills').filter(s=>String(s.CandidateID)===String(candidateId)).map(s=> s.SkillName ?? s.Skill ?? s.Skills).filter(Boolean); } catch(e){}
  try { out.activities   = safeGet('Activities').filter(a=>String(a.CandidateID)===String(candidateId)); } catch(e){}
  try { out.applications = safeGet('Applications').filter(a=>String(a.CandidateID)===String(candidateId)); } catch(e){}
  try { out.interviews   = safeGet('Interviews').filter(i=>String(i.CandidateID)===String(candidateId)); } catch(e){}
  try { out.hires        = safeGet('Hires').filter(h=>String(h.CandidateID)===String(candidateId)); } catch(e){}
  return out;
}

/** Add note to Activities and append to Candidates.Notes */
function addCandidateNote(candidateId, recruiterId, text){
  const shA = getSpreadsheet().getSheetByName('Activities');
  if (!shA) throw new Error('Activities sheet not found');
  const headA = shA.getRange(1,1,1,shA.getLastColumn()).getValues()[0];
  const idxA = n => headA.indexOf(n);
  const rowA = new Array(headA.length).fill('');

  if (idxA('ActivityID')>-1)     rowA[idxA('ActivityID')] = 'ACT_'+Date.now();
  if (idxA('Type')>-1)           rowA[idxA('Type')] = 'Note';
  if (idxA('RecruiterID')>-1)    rowA[idxA('RecruiterID')] = recruiterId || Session.getActiveUser().getEmail();
  if (idxA('CandidateID')>-1)    rowA[idxA('CandidateID')] = candidateId;
  if (idxA('ApplicationID')>-1)  rowA[idxA('ApplicationID')] = '';
  if (idxA('DateTime')>-1)       rowA[idxA('DateTime')] = new Date();
  if (idxA('DurationMinutes')>-1)rowA[idxA('DurationMinutes')] = '';
  if (idxA('Outcome')>-1)        rowA[idxA('Outcome')] = '';
  if (idxA('Notes')>-1)          rowA[idxA('Notes')] = text || '';
  if (idxA('CreatedOn')>-1)      rowA[idxA('CreatedOn')] = new Date();
  shA.appendRow(rowA);

  const shC = getSpreadsheet().getSheetByName('Candidates');
  if (!shC) return 'OK';
  const headC = shC.getRange(1,1,1,shC.getLastColumn()).getValues()[0];
  const idxC = n => headC.indexOf(n);
  const idCol = idxC('CandidateID') + 1;
  const notesCol = idxC('Notes') + 1;
  if (idCol<=0 || notesCol<=0) return 'OK';

  const last = shC.getLastRow();
  const ids = last>1 ? shC.getRange(2, idCol, last-1, 1).getValues() : [];
  for (let i=0;i<ids.length;i++){
    if (String(ids[i][0]) === String(candidateId)){
      const r = i+2;
      const cur = String(shC.getRange(r, notesCol).getValue() || '');
      const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
      shC.getRange(r, notesCol).setValue(cur ? `${cur}; ${stamp} - ${text}` : `${stamp} - ${text}`);
      break;
    }
  }
  SpreadsheetApp.flush();
  return 'OK';
}

/** Call Lists */
function listCallLists(){
  if (!sheetExists('CallLists')) return [];
  const data = getData('CallLists');
  return data; // expects columns: CallListID, Name, Recruiter, CreatedOn, Notes, CandidateIDs, SourceQuery, ...
}
function createCallList(name, recruiter, notes, idsCsv, sourceQuery){
  const sh = getSpreadsheet().getSheetByName('CallLists');
  if (!sh) throw new Error('CallLists sheet not found');
  const head = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const idx = n => head.indexOf(n);

  const id = 'CL-' + Date.now();
  const row = new Array(head.length).fill('');

  if (idx('CallListID')>-1)  row[idx('CallListID')] = id;
  if (idx('Name')>-1)        row[idx('Name')] = name || ('List '+id);
  if (idx('Recruiter')>-1)   row[idx('Recruiter')] = recruiter || Session.getActiveUser().getEmail();
  if (idx('CreatedOn')>-1)   row[idx('CreatedOn')] = new Date();
  if (idx('Notes')>-1)       row[idx('Notes')] = notes || '';
  if (idx('CandidateIDs')>-1)row[idx('CandidateIDs')] = idsCsv || '';
  if (idx('SourceQuery')>-1) row[idx('SourceQuery')] = sourceQuery || '';

  sh.appendRow(row);
  SpreadsheetApp.flush();
  return id;
}
function addCandidatesToCallList(listId, ids){
  const sh = getSpreadsheet().getSheetByName('CallLists');
  if (!sh) return;
  const values = sh.getDataRange().getValues();
  const headers = values[0] || [];
  const iId = headers.indexOf('CallListID');
  const iC  = headers.indexOf('CandidateIDs');
  for (let r=1;r<values.length;r++){
    if (String(values[r][iId])===String(listId)){
      const cur = String(values[r][iC] || '');
      const merged = cur ? (cur + ',' + ids.join(',')) : ids.join(',');
      sh.getRange(r+1, iC+1).setValue(merged);
      SpreadsheetApp.flush();
      return;
    }
  }
}


/**********************************************************************
 * ORI-ON CRM — COMPLETE BACKEND SELF-TEST SUITE
 * Run manually:  Run → runAllTests()
 * It calls each backend function safely and logs detailed results.
 **********************************************************************/

function runAllTests() {
  const tests = [
    ['Spreadsheet Connection', test_verifySpreadsheetConnection],
    ['Entities', test_getEntities],
    ['Headers', test_getHeaders],
    ['Data', test_getData],
    ['Save Data', test_saveData],
    ['Save Data (invalid)', test_saveData_invalid], // ✅ added edge-case test
    ['Aggregations', test_getAggregations],
    ['Dashboard Metrics', test_getDashboardMetrics],
    ['Filtered Data', test_getFilteredData],
    ['Aggregate Data', test_aggregateData],
    ['Unique Values', test_getUniqueValues],
    ['Boolean Search', test_searchCandidates],
    ['Candidate Deep', test_getCandidateDeep],
    ['Add Candidate Note', test_addCandidateNote],
    ['List Call Lists', test_listCallLists],
    ['Create Call List', test_createCallList],
    ['Add Candidates To Call List', test_addCandidatesToCallList],
  ];

  const results = [];
  for (let i = 0; i < tests.length; i++) {
    const entry = tests[i];
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [name, fn] = entry;
    try {
      const res = fn();
      results.push({ name, status: '✅ OK', detail: res });
    } catch (err) {
      results.push({ name, status: '❌ FAIL', detail: err.message });
    }
  }

  Logger.log('=== ORI-ON CRM BACKEND DIAGNOSTIC REPORT ===');
  results.forEach(r => Logger.log(`${r.status} ${r.name} → ${r.detail}`));
  return results;
}


/************ Individual test wrappers ************/

function test_verifySpreadsheetConnection() {
  verifySpreadsheetConnection();
  return 'Spreadsheet connected';
}

function test_getEntities() {
  const e = getEntities();
  if (!Array.isArray(e) || !e.length) throw new Error('No sheets found');
  return `${e.length} entities`;
}

function test_getHeaders() {
  const e = getEntities()[0];
  const h = getHeaders(e);
  if (!h || !h.length) throw new Error(`No headers for ${e}`);
  return `${e}: ${h.length} headers`;
}

function test_getData() {
  const e = getEntities().find(x => x !== 'Dashboard');
  const d = getData(e);
  if (!Array.isArray(d)) throw new Error('Not array');
  return `${e}: ${d.length} rows`;
}

function test_saveData() {
  const e = getEntities().find(x => x !== 'Dashboard');
  const firstHeader = getHeaders(e)[0];
  const dummy = { [firstHeader]: 'TEST_' + Date.now() };
  try {
    saveData(e, dummy);
    return `${e}: dummy row accepted`;
  } catch (err) {
    throw new Error(err.message);
  }
}

function test_getAggregations() {
  const e = getEntities().find(x => x !== 'Dashboard');
  const h = getHeaders(e).find(f => f);
  const res = getAggregations(e, h);
  return res ? `${e}:${h} ok` : 'null';
}

function test_getDashboardMetrics() {
  const m = getDashboardMetrics();
  return 'Keys: ' + Object.keys(m).join(', ');
}

function test_getFilteredData() {
  const e = getEntities().find(x => x === 'Candidates' || x === 'Jobs');
  const rows = getFilteredData(e, []);
  if (!Array.isArray(rows)) throw new Error('Not array');
  return `${e}: ${rows.length} rows`;
}

function test_aggregateData() {
  const e = getEntities().find(x => x === 'Candidates' || x === 'Jobs');
  const headers = getHeaders(e);
  const res = aggregateData(e, headers[0], 'count', []);
  return Object.keys(res).length + ' keys';
}

function test_getUniqueValues() {
  const e = getEntities().find(x => x === 'Candidates' || x === 'Jobs');
  const h = getHeaders(e)[0];
  const vals = getUniqueValues(e, h);
  return vals.length + ' unique';
}

function test_searchCandidates() {
  const res = searchCandidates('english:basic', {});
  return `${res.length} found`;
}

function test_getCandidateDeep() {
  const cands = getData('Candidates');
  const id = cands[0]?.CandidateID;
  if (!id) throw new Error('No CandidateID');
  const deep = getCandidateDeep(id);
  if (!deep || !deep.candidate) throw new Error('No candidate data');
  return `Candidate ${id} ok`;
}

function test_addCandidateNote() {
  const cands = getData('Candidates');
  const id = cands[0]?.CandidateID;
  if (!id) return 'Skipped: no candidate';
  addCandidateNote(id, 'tester@ori-on.com', 'Test note via automation');
  return `Note added to ${id}`;
}

function test_listCallLists() {
  const lists = listCallLists();
  return `${lists.length} lists`;
}

function test_createCallList() {
  const id = createCallList('Test List', 'tester', 'testing', '1,2,3', 'manual');
  return `Created ${id}`;
}

function test_addCandidatesToCallList() {
  const lists = listCallLists();
  if (!lists.length) return 'Skipped: no call list';
  const id = lists[0].CallListID;
  addCandidatesToCallList(id, ['TEST1','TEST2']);
  return `Added to ${id}`;
}

function test_saveData_invalid() {
  try {
    saveData(undefined, { any: 'thing' });
    throw new Error('Expected error but none thrown');
  } catch (err) {
    if (!/Entity not found/i.test(err.message))
      throw new Error('Wrong error: ' + err.message);
    return 'Properly threw "Entity not found: undefined"';
  }
}







/************************************************************
 * PHASE 7A – Activities engine (Call / Note / Timeline)
 * Safe to append at end of Code.gs. No existing code touched.
 ************************************************************/

/** Minimal column contract for Activities (create these headers in row 1):
ActivityID, CandidateID, RecruiterID, RecruiterName, JobID, CallListID, CompanyID, CompanyName, ClientID, ClientName, ActivityType, Result, Comments, AttachmentURL, CreatedAt, UpdatedAt
*/
function _ensureActivitiesSheet_(){
  const ss = getSpreadsheet();
  const sh = ss.getSheetByName('Activities') || ss.insertSheet('Activities');
  const need = ['ActivityID','CandidateID','RecruiterID','RecruiterName','JobID','CallListID','CompanyID','CompanyName','ClientID','ClientName','ActivityType','Result','Comments','AttachmentURL','CreatedAt','UpdatedAt'];
  const cur = sh.getRange(1,1,1,Math.max(need.length, sh.getLastColumn()||need.length)).getValues()[0] || [];
  if (!cur[0]) {
    sh.getRange(1,1,1,need.length).setValues([need]);
  } else {
    // Ensure missing columns are appended
    const missing = need.filter(h=>!cur.includes(h));
    if (missing.length) {
      sh.insertColumnsAfter(sh.getLastColumn()||need.length, missing.length);
      const merged = cur.concat(missing);
      sh.getRange(1,1,1,merged.length).setValues([merged]);
    }
  }
  return sh;
}

/** Resolve current user (ID + name) from Users sheet; fallback to Session email */
function _resolveRecruiter_(){
  const email = Session.getActiveUser().getEmail() || 'unknown@local';
  let name = email;
  if (sheetExists('Users')) {
    const users = getData('Users');
    const u = users.find(x => String(x.Email||'').toLowerCase() === String(email).toLowerCase());
    if (u) name = u.FullName || (u.FirstName? (u.FirstName+' '+(u.LastName||'')) : (u.Name||email));
  }
  return { recruiterId: email, recruiterName: name };
}

/** Resolve job/company/client info from Jobs sheet */
function _resolveJobEnvelope_(jobId){
  const out = { JobID: jobId||'', CompanyID:'', CompanyName:'', ClientID:'', ClientName:'', JobStatus:'' };
  if (!jobId || !sheetExists('Jobs')) return out;
  const jobs = getData('Jobs');
  const j = jobs.find(r => String(r.JobID)===String(jobId));
  if (!j) return out;
  out.CompanyID   = j.CompanyID || '';
  out.CompanyName = j.CompanyName || j.ClientCompany || j.Company || '';
  // Primary client fields vary; try common options
  out.ClientID    = j.PrimaryClientID || j.ClientID || '';
  out.ClientName  = j.PrimaryClientName || j.ClientName || '';
  out.JobStatus   = j.Status || '';
  return out;
}

/** Log an activity row (Call/Note/Email/Interview/Hire/Reminder etc.) */
function logActivity(activity){
  const sh = _ensureActivitiesSheet_();
  const head = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const idx  = (n)=> head.indexOf(n);

  const now = new Date();
  const rid = _resolveRecruiter_();
  const env = _resolveJobEnvelope_(activity.JobID);

  const row = new Array(head.length).fill('');
  const put = (name, val) => { const i = idx(name); if (i>-1) row[i] = (val==null?'':val); };

  put('ActivityID', activity.ActivityID || ('ACT-'+now.getTime()));
  put('CandidateID', activity.CandidateID || '');
  put('RecruiterID', rid.recruiterId);
  put('RecruiterName', rid.recruiterName);
  put('JobID', env.JobID);
  put('CallListID', activity.CallListID || '');
  put('CompanyID', env.CompanyID);
  put('CompanyName', env.CompanyName);
  put('ClientID', env.ClientID);
  put('ClientName', env.ClientName);
  put('ActivityType', activity.ActivityType || 'note');
  put('Result', activity.Result || '');
  put('Comments', activity.Comments || '');
  put('AttachmentURL', activity.AttachmentURL || '');
  put('CreatedAt', now);
  put('UpdatedAt', now);

  sh.appendRow(row);
  SpreadsheetApp.flush();
  return 'OK';
}

/** Timeline fetch – newest first; optional filters {candidateId, jobId, limit} */
function listActivitiesTimeline(params){
  params = params || {};
  const limit = Math.max(1, Math.min(200, Number(params.limit||50)));
  if (!sheetExists('Activities')) return [];
  const all = getData('Activities');
  const filtered = all.filter(a=>{
    if (params.candidateId && String(a.CandidateID)!==String(params.candidateId)) return false;
    if (params.jobId && String(a.JobID)!==String(params.jobId)) return false;
    return true;
  }).sort((a,b)=>{
    // Sort by UpdatedAt or CreatedAt (desc)
    const ta = new Date(a.UpdatedAt || a.CreatedAt || 0).getTime();
    const tb = new Date(b.UpdatedAt || b.CreatedAt || 0).getTime();
    return tb - ta;
  });
  return filtered.slice(0, limit);
}
