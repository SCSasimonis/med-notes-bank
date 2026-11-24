"use strict";

{
/* ================= state ================= */
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const LBL={error:"Incorrect",outdated:"Outdated",caution:"Check",ok:"Checked",unchecked:"Not yet checked"};
const KIND={mcq:"MCCQE-style",vignette:"Clinical vignette",identify:"Identify the condition",attribute:"Feature recall",match:"Match",define:"Definition",mine:"Your question"};
const LET="ABCDE";
const DAY=864e5,MIN=6e4;
const DEFAULT_ME={settings:{theme:"system",fs:16,examDate:"",goal:40,secs:90},stars:{},qnotes:{},tnotes:{},act:{},t:0};
const S={data:null,base:[],qs:[],qById:{},cardById:{},view:"home",
 prog:{},srs:{},tests:[],reports:[],active:null,last:null,me:JSON.parse(JSON.stringify(DEFAULT_ME)),myq:[],
 build:{mode:"tutor",n:20,sps:new Set(),discs:new Set(),pool:"unused",kinds:"mcq",topic:"",secs:null},
 browse:{q:"",sp:"All",kf:"all",sort:"rel",shown:30,open:new Set(),noteOpen:new Set()},fc:null,fcSp:"All",review:{filter:"all"},edit:null};

/* ================= persistence: account (db) + this device (localStorage) ================= */
const LS="mnb2";
function lsLoad(){try{return JSON.parse(localStorage.getItem(LS)||"{}")}catch(e){return {}}}
function lsSave(){try{localStorage.setItem(LS,JSON.stringify({prog:S.prog,srs:S.srs,tests:S.tests,active:S.active,reports:S.reports,me:S.me,myq:S.myq,myqT:S.myqT||0}))}catch(e){}}
const DB={db:null,uid:null,ok:false,queue:new Map(),busy:false};
function setSync(t){$("#sync").textContent=t}
async function dbInit(){
 try{
  if(!window.claude||!claude.use){setSync("Saved on this device");return}
  const timer=setTimeout(()=>{if(!DB.ok)setSync("Saved on this device")},10000);
  const [db,user]=await Promise.all([claude.use("db"),claude.use("user")]);
  const uid=user?await user.id():null;
  if(!db||!uid){clearTimeout(timer);setSync("Saved on this device");return}
  DB.db=db;DB.uid=uid;
  const col=db.collection("data/users/"+uid);
  const snap=await col.get();clearTimeout(timer);DB.ok=true;
  let myqChanged=false;
  snap.docs.forEach(d=>{const v=d.data()||{};
   if(d.id.startsWith("p_"))mergeProg(v.p||{});
   else if(d.id==="tests")mergeTests(v.list||[]);
   else if(d.id==="active"&&v.t&&(!S.active||(v.t.updated||0)>(S.active.updated||0)))S.active=v.t;
   else if(d.id==="me"&&v.me&&(v.me.t||0)>(S.me.t||0)){S.me=normMe(v.me)}
   else if(d.id==="myq"&&Array.isArray(v.list)&&(v.t||0)>(S.myqT||0)){S.myq=v.list;S.myqT=v.t;myqChanged=true}});
  if(myqChanged)rebuildQs();
  applySettings();lsSave();setSync("Synced to your account");render();
 }catch(e){setSync("Saved on this device")}}
function normMe(m){const o=JSON.parse(JSON.stringify(DEFAULT_ME));if(!m)return o;Object.assign(o,m);o.settings=Object.assign({},DEFAULT_ME.settings,m.settings||{});["stars","qnotes","tnotes","act"].forEach(k=>o[k]=m[k]||{});return o}
function mergeProg(p){for(const [id,v] of Object.entries(p)){const mine=S.prog[id];if(!mine||(v.t||0)>(mine.t||0))S.prog[id]=v;if(v.srs&&(!S.srs[id]||(v.srs.t||0)>(S.srs[id].t||0)))S.srs[id]=v.srs}}
function mergeTests(list){const seen=new Set(S.tests.map(t=>t.id));list.forEach(t=>{if(!seen.has(t.id))S.tests.push(t)});S.tests.sort((a,b)=>b.date-a.date);S.tests=S.tests.slice(0,100)}
function spKey(sp){return "p_"+sp.replace(/[^A-Za-z0-9]+/g,"-").slice(0,40)}
function persist(keys){lsSave();if(!DB.ok)return;keys.forEach(k=>DB.queue.set(k,true));flush()}
function touchMe(){S.me.t=Date.now();clearTimeout(touchMe.t);lsSave();touchMe.t=setTimeout(()=>persist(["me"]),900)}
async function flush(){if(DB.busy||!DB.queue.size)return;DB.busy=true;
 try{while(DB.queue.size){const [k]=DB.queue.keys();DB.queue.delete(k);const ref=DB.db.doc("data/users/"+DB.uid+"/"+k);
  if(k==="tests")await ref.set({list:S.tests.slice(0,100)});
  else if(k==="active")await ref.set({t:S.active||null});
  else if(k==="me")await ref.set({me:S.me});
  else if(k==="myq")await ref.set({list:S.myq,t:S.myqT||Date.now()});
  else{const sp=k;const p={};S.qs.forEach(q=>{if(spKey(q.sp)===sp&&(S.prog[q.id]||S.srs[q.id]))p[q.id]={...(S.prog[q.id]||{}),srs:S.srs[q.id]}});await ref.set({p})}}
  setSync("Synced to your account")}
 catch(e){setSync(e&&e.code==="quota_exceeded"?"Account storage full — saved on this device":"Offline — saved on this device")}
 DB.busy=false}

/* ================= helpers ================= */
function toast(t){const el=$("#toast");el.textContent=t;el.classList.add("on");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("on"),2000)}
function fmtTime(s){s=Math.max(0,Math.round(s));const m=Math.floor(s/60),x=s%60;return m+":"+String(x).padStart(2,"0")}
function pct(a,b){return b?Math.round(100*a/b):0}
function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function specs(){const n={};S.qs.forEach(q=>n[q.sp]=(n[q.sp]||0)+1);return Object.entries(n).sort((a,b)=>b[1]-a[1])}
function allSpecs(){const n=new Set(S.data.cards.map(c=>c.sp));return [...n].sort()}
function stats(filterSp){let n=0,c=0,seen=0;S.qs.forEach(q=>{if(filterSp&&q.sp!==filterSp)return;const p=S.prog[q.id];if(p&&p.n){seen++;n+=p.n;c+=p.c}});return {n,c,seen}}
function dueCount(sp){const now=Date.now();return S.qs.filter(q=>S.srs[q.id]&&S.srs[q.id].due<=now&&(!sp||sp==="All"||q.sp===sp)).length}
function dkey(t){const d=new Date(t);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function today(){return dkey(Date.now())}
function bump(){const k=today();S.me.act[k]=(S.me.act[k]||0)+1;touchMe()}
function streak(){let n=0;const d=new Date();if(!S.me.act[dkey(d)])d.setDate(d.getDate()-1);while(S.me.act[dkey(d)]){n++;d.setDate(d.getDate()-1)}return n}
function isMine(q){return q.kind==="mine"}
function kindGroup(q){return q.kind==="attribute"||q.kind==="match"||q.kind==="define"?"recall":q.kind==="vignette"?"mcq":q.kind}
const DISCN={med:"Medicine",surg:"Surgery",peds:"Pediatrics",obgyn:"Obstetrics & gynecology",psych:"Psychiatry",phe:"Population health & ethics"};
const DIMN={hp:["Health promotion & prevention",20],acute:["Acute care",35],chronic:["Chronic care",25],psych:["Psychosocial aspects",20]};
const ACTN={dx:["Assessment & diagnosis",45],mx:["Management",35],comm:["Communication",10],prof:["Professional behaviours",10]};
function linkTxt(s){return esc(s)}

/* ================= settings ================= */
function applySettings(){const st=S.me.settings;const r=document.documentElement;
 if(st.theme==="light"||st.theme==="dark")r.dataset.theme=st.theme;else delete r.dataset.theme;
 r.style.setProperty("--fs",(+st.fs||16)+"px")}

/* ================= questions (bank + your own) ================= */
function mineToQ(m){return {id:m.id,kind:"mine",stem:m.stem,clue:m.clue||"",opts:m.opts,ans:m.ans,sp:m.sp||"General",topic:m.topic||"Your question",cid:m.cid||"",ctx:"Your question",fact:m.expl||"",also:[]}}
function rebuildQs(){S.qs=[...S.base,...S.myq.map(mineToQ)];S.qById={};S.qs.forEach(q=>S.qById[q.id]=q)}

/* ================= image packs ================= */
const P={idx:null,packs:{}};
function pack(n){return P.packs[n]||(P.packs[n]=Vault.json("content/packs/pack_"+String(n).padStart(2,"0")+".enc"))}
async function fillImgs(root){const els=[...root.querySelectorAll("img[data-src]")];if(!els.length)return;
 try{if(!P.idx)P.idx=await Vault.json("content/packs/index.enc");
  for(const el of els){const name=el.dataset.src;const n=P.idx[name];if(n===undefined){el.alt="Image not available";continue}const pk=await pack(n);el.src=pk[name];el.dataset.name=name;el.removeAttribute("data-src")}}
 catch(e){els.forEach(el=>el.alt="Image could not load")}}

/* ================= HOME ================= */
function planHTML(){const st=S.me.settings;const done=S.me.act[today()]||0;const goal=+st.goal||0;const sk=streak();
 const unused=S.qs.filter(q=>!S.prog[q.id]).length;
 let exam="";if(st.examDate){const days=Math.ceil((new Date(st.examDate+"T23:59:59")-Date.now())/DAY);
  exam=days>0?`<p style="margin:0"><b>${days}</b> day${days>1?"s":""} to your exam on ${new Date(st.examDate+"T12:00:00").toLocaleDateString(undefined,{month:"long",day:"numeric",year:"numeric"})}. To see every unused question once, do about <b>${Math.ceil(unused/days)}</b> a day.</p>`:`<p style="margin:0">Your exam date (${esc(st.examDate)}) has passed. <a href="#settings" style="color:var(--acc)">Update it</a>.</p>`}
 else exam=`<p style="margin:0" class="muted"><a href="#settings" style="color:var(--acc)">Set your exam date</a> to get a daily target.</p>`;
 return `<div class="plan"><div class="th"><h2>Today</h2><span class="muted" style="font-size:14px">${sk} day streak</span></div><p style="margin:0 0 6px;font-size:15px">${done} of ${goal} questions${done>=goal&&goal?" — goal reached":""}</p><div class="meter" role="img" aria-label="Daily goal ${Math.min(100,pct(done,goal))}% complete" style="margin-bottom:10px"><i class="${done>=goal?"good":"mid"}" style="width:${Math.min(100,pct(done,goal))}%"></i></div>${exam}</div>`}
function vHome(){
 const st=stats(),due=dueCount(),total=S.qs.length;
 const last=S.tests[0];
 const rows=specs().map(([sp,n])=>{const s=stats(sp);const acc=pct(s.c,s.n);const cl=!s.n?"":acc>=75?"good":acc>=55?"mid":"low";
  return `<div class="spec"><span>${esc(sp)}</span><div class="meter" role="img" aria-label="${esc(sp)} ${s.n?acc+"% correct":"not attempted"}"><i class="${cl}" style="width:${s.n?acc:0}%"></i></div><em>${s.n?acc+"%":"—"} · ${s.seen}/${n}</em></div>`}).join("");
 const resume=S.active&&!S.active.done?`<div class="cnote" style="background:var(--accbg)"><b style="color:var(--acc)">Test in progress:</b> ${S.active.qids.length} questions, ${Object.keys(S.active.answers).length} answered. <a href="#run" style="color:var(--acc);font-weight:600">Resume</a></div>`:"";
 return `<h1 class="h">Your progress</h1><p class="sub">${total} questions from ${S.data.meta.images} of your screenshots · ${S.data.cards.length} topics${S.myq.length?` · ${S.myq.length} written by you`:""}</p>${resume}
 ${planHTML()}
 <div class="kpis"><div class="kpi"><b>${st.n?pct(st.c,st.n)+"%":"—"}</b><span>Overall correct</span></div><div class="kpi"><b>${st.seen}</b><span>Questions used of ${total}</span></div>
 <div class="kpi"><b>${S.tests.length}</b><span>Tests taken</span></div><div class="kpi"><b>${due}</b><span>Flashcards due</span></div></div>
 <div class="cta"><a class="prim" href="#test"><b>Start a test</b><span>Tutor or timed exam mode, by specialty</span></a><a href="#cards"><b>Review flashcards</b><span>${due?due+" due now":"Spaced repetition from your misses"}</span></a></div>
 ${last?`<h2 class="sec-h">Last test</h2><p style="margin:0">${new Date(last.date).toLocaleDateString(undefined,{month:"short",day:"numeric"})} · ${last.mode==="exam"?"Timed exam":"Tutor"} · <b>${pct(last.c,last.n)}%</b> (${last.c}/${last.n}) · <a href="#history" style="color:var(--acc)">All tests</a> · <a href="#stats" style="color:var(--acc)">Performance</a></p>`:""}
 <h2 class="sec-h">Accuracy by specialty</h2>${rows}
 <p class="hint">Green 75%+, amber 55–74%, red below 55%. The count shows questions used out of those available.</p>`}

/* ================= TEST BUILDER ================= */
function matchPool(q,b){const p=S.prog[q.id];
 if(b.pool==="unused")return !p||!p.n;if(b.pool==="incorrect")return p&&p.last===0;if(b.pool==="marked")return p&&p.mk;if(b.pool==="noted")return !!S.me.qnotes[q.id];return true}
function matchKind(q,b){if(b.kinds==="all")return true;if(b.kinds==="recall")return kindGroup(q)==="recall";if(b.kinds==="mcq")return kindGroup(q)==="mcq";return q.kind===b.kinds}
function matchDisc(q,b){return !b.discs||!b.discs.size||b.discs.has(q.disc||"med")}
function matchTopic(q,b){const t=b.topic.trim().toLowerCase();return !t||q.topic.toLowerCase().includes(t)||(q.stem+" "+(q.clue||"")).toLowerCase().includes(t)}
function poolFor(b){return S.qs.filter(q=>(!b.sps.size||b.sps.has(q.sp))&&matchDisc(q,b)&&matchKind(q,b)&&matchTopic(q,b)&&matchPool(q,b))}
function curSecs(b){return b.secs===null?(b.mode==="exam"?(+S.me.settings.secs||90):0):b.secs}
function vTest(){
 const b=S.build,pool=poolFor(b);const n=Math.min(b.n,pool.length);
 const sps=specs();const cnt={};S.qs.forEach(q=>{if(matchKind(q,b)&&matchTopic(q,b)&&matchPool(q,b))cnt[q.sp]=(cnt[q.sp]||0)+1});
 const segs=(name,cur,opts)=>`<div class="seg" role="group" aria-label="${name}">${opts.map(([v,l])=>`<button type="button" data-set="${name}" data-val="${v}" aria-pressed="${String(cur)===String(v)}">${l}</button>`).join("")}</div>`;
 const secs=curSecs(b);
 const mockN=S.qs.filter(q=>q.kind==="mcq").length;
 return `<h1 class="h">Build a test</h1><p class="sub">Exam-style questions follow the MCCQE blueprint and Canadian guidelines. Recall drills come from your own notes; facts flagged as incorrect or outdated are left out.</p>
 <div class="mock"><div><b>MCCQE mock section</b><p class="muted" style="margin:2px 0 0;font-size:14px">115 exam-style questions in 2 h 40 min, weighted like the real exam (acute 35%, chronic 25%, prevention 20%, psychosocial 20%). Unused questions first. Answers at the end.</p></div><button class="btn" id="startMock" ${mockN<115?"disabled":""}>Start mock section</button></div>
 <fieldset><legend>Mode</legend>${segs("mode",b.mode,[["tutor","Tutor"],["exam","Exam"]])}<p class="hint">${b.mode==="tutor"?"See the answer and explanation after each question.":"Answers and explanations are shown at the end, like the real exam."}</p></fieldset>
 <fieldset><legend>Timer</legend>${segs("secs",secs,[[0,"Off"],[60,"60 s / question"],[90,"90 s"],[120,"120 s"]])}<p class="hint">${secs?`Total time: ${fmtTime(secs*n)} for ${n} questions.`:"Untimed — the clock still records how long you take."}</p></fieldset>
 <fieldset><legend>Questions</legend>${segs("pool",b.pool,[["unused","Unused"],["incorrect","Incorrect"],["marked","Marked"],["noted","With my notes"],["all","All"]])}</fieldset>
 <fieldset><legend>Type</legend>${segs("kinds",b.kinds,[["mcq","MCCQE-style"],["recall","Recall drills"],["identify","Identify"],["mine","Mine"],["all","All types"]])}<p class="hint">${b.kinds==="mcq"?"Clinical vignettes written to the MCCQE blueprint, with Canadian guidelines and a reason for every option.":b.kinds==="recall"?"Quick one-line facts from your notes — good for drilling, not exam-style.":""}</p></fieldset>
 <fieldset><legend>Discipline</legend><div class="chips">${Object.entries(DISCN).map(([k,l])=>`<button type="button" class="chip" data-disc="${k}" aria-pressed="${b.discs.has(k)}">${l}</button>`).join("")}</div><p class="hint">${b.discs.size?b.discs.size+" selected":"No selection means every discipline."}</p></fieldset>
 <fieldset><legend>Topic or keyword (optional)</legend><input class="inp" id="btopic" type="search" value="${esc(b.topic)}" placeholder="e.g. thyroid, lithium, preeclampsia" autocomplete="off" aria-label="Filter by topic or keyword"></fieldset>
 <fieldset><legend>Specialties <button type="button" class="linkbtn" id="spAll" style="margin-left:8px">${b.sps.size?"Clear":"All selected"}</button></legend>
 <div class="chips">${sps.map(([sp])=>`<button type="button" class="chip" data-sp="${esc(sp)}" aria-pressed="${b.sps.has(sp)}">${esc(sp)}<small>${cnt[sp]||0}</small></button>`).join("")}</div>
 <p class="hint">${b.sps.size?b.sps.size+" selected":"No selection means every specialty."}</p></fieldset>
 <fieldset><legend>Number of questions</legend><div class="row">${segs("n",b.n,[[10,"10"],[20,"20"],[40,"40"],[80,"80"]])}<label class="row" style="gap:6px"><span class="muted" style="font-size:14px">Custom</span><input class="inp num" id="bn" type="number" min="1" max="300" value="${b.n}" aria-label="Custom number of questions"></label></div></fieldset>
 <div class="row" style="margin-top:8px"><button class="btn" id="start" ${n?"":"disabled"}>Start ${n} question${n===1?"":"s"}</button><span class="muted" id="poolN">${pool.length} available${n<b.n&&n?" — fewer than requested":""}</span></div>
 ${!pool.length?`<p class="hint">No questions match. Try “All” questions, another type, or more specialties.</p>`:""}`}
function newActive(ids,mode,label,secs){return {id:"t"+Date.now(),mode,qids:ids,answers:{},first:{},struck:{},marked:{},qtime:{},idx:0,start:Date.now(),updated:Date.now(),
 limit:secs?ids.length*secs:null,elapsed:0,done:false,label}}
function startMock(){const all=S.qs.filter(q=>q.kind==="mcq");const fresh=q=>!(S.prog[q.id]&&S.prog[q.id].n);const picked=[];
 Object.entries({hp:23,acute:40,chronic:29,psych:23}).forEach(([d,k])=>{const g=all.filter(q=>q.dim===d);const f=shuffle(g.filter(fresh)),u=shuffle(g.filter(q=>!fresh(q)));picked.push(...f.concat(u).slice(0,k))});
 if(picked.length<115){const have=new Set(picked.map(q=>q.id));picked.push(...shuffle(all.filter(q=>!have.has(q.id))).slice(0,115-picked.length))}
 S.active=newActive(shuffle(picked).map(q=>q.id),"exam","MCCQE mock section",9600/115);persist(["active"]);location.hash="#run"}
function startTest(){const b=S.build;const pool=poolFor(b);if(!pool.length)return;
 const picked=shuffle(pool).slice(0,b.n);
 const lab=[b.sps.size?[...b.sps].join(", "):"All specialties",b.topic.trim()?"“"+b.topic.trim()+"”":""].filter(Boolean).join(" · ");
 S.active=newActive(picked.map(q=>q.id),b.mode,lab,curSecs(b));
 persist(["active"]);location.hash="#run"}

/* ================= TEST RUNNER ================= */
let tick=null;
function elapsed(){const a=S.active;return a.elapsed+(a.resumed?(Date.now()-a.resumed)/1000:0)}
function stampQ(id){const a=S.active;if(!a)return;a.qtime=a.qtime||{};const now=Date.now();
 if(a.cur!==undefined&&a.cur!==null&&a.qt0)a.qtime[a.cur]=(a.qtime[a.cur]||0)+(now-a.qt0)/1000;
 a.cur=id===undefined?null:id;a.qt0=id===undefined?null:now}
function vRun(){const a=S.active;if(!a||a.done){return `<p class="empty">No test in progress. <a href="#test" style="color:var(--acc)">Build one</a>.</p>`}
 a.first=a.first||{};a.qtime=a.qtime||{};
 if(!a.resumed)a.resumed=Date.now();
 const q=S.qById[a.qids[a.idx]];if(!q)return `<p class="empty">This question is no longer in the bank. <button class="btn small" id="skipMissing">Skip</button></p>`;
 if(a.cur!==q.id||!a.qt0)stampQ(q.id);
 const sel=a.answers[q.id];const tutorDone=a.mode==="tutor"&&a.revealed&&a.revealed[q.id];
 const answered=Object.keys(a.answers).length;
 const opts=q.opts.map((o,i)=>{let cl="";if(tutorDone){if(i===q.ans)cl="right";else if(i===sel)cl="wrong"}else if(i===sel)cl="sel";
  const st=a.struck[q.id]&&a.struck[q.id].includes(i);
  return `<div class="opt ${cl} ${st?"struck":""}"><button class="pick" data-pick="${i}" ${tutorDone?"disabled":""}><span class="let">${LET[i]}</span><span class="txt">${esc(o)}</span></button><button class="x" data-strike="${i}" title="Cross out" aria-label="Cross out option ${LET[i]}" ${tutorDone?"disabled":""}>×</button></div>`}).join("");
 const clock=a.limit?`<span class="clock ${a.limit-elapsed()<60?"warn":""}" id="clock" aria-label="Time left">${fmtTime(a.limit-elapsed())}</span>`:`<span class="clock" id="clock" aria-label="Time used">${fmtTime(elapsed())}</span>`;
 const isLast=a.idx===a.qids.length-1;
 let actions;
 if(a.mode==="tutor"){actions=tutorDone?`<button class="btn" id="next">${isLast?"Finish test":"Next question"}</button>`:`<button class="btn" id="submitQ" ${sel===undefined?"disabled":""}>Submit answer</button>`}
 else actions=`<button class="btn ghost" id="prev" ${a.idx?"":"disabled"}>Previous</button><button class="btn" id="next">${isLast?"Review & finish":"Next"}</button>`;
 return `<h1 class="sr-only">Test in progress</h1><div class="runbar"><button class="btn ghost small" id="exitTest" aria-label="Pause and exit">Pause</button><div class="prog" aria-hidden="true"><i style="width:${pct(answered,a.qids.length)}%"></i></div><button class="btn ghost small" id="labsBtn" title="Lab values (L)">Labs</button>${clock}</div>
 <div class="fadein"><div class="qhead"><span class="qmeta">Question ${a.idx+1} of ${a.qids.length} · ${esc(q.sp)}</span><div class="tools"><button class="btn ghost small mark" id="markQ" aria-pressed="${!!a.marked[q.id]}">${a.marked[q.id]?"Marked":"Mark for review"}</button></div></div>
 ${q.kind!=="vignette"&&q.kind!=="mcq"&&q.ctx&&q.kind!=="identify"?`<p class="qmeta" style="margin:0 0 4px">${esc(q.ctx)}</p>`:""}
 <p class="stem">${esc(q.stem)}</p>${q.lead?`<p class="lead">${esc(q.lead)}</p>`:""}${q.clue?`<p class="clue">${esc(q.clue)}</p>`:""}
 <div class="opts" role="radiogroup" aria-label="Answer options">${opts}</div>
 <div class="qnav">${actions}<span class="kbd">Press <kbd>?</kbd> for shortcuts</span></div>
 ${tutorDone?explHTML(q,sel):""}
 ${a.qids.length>1?`<div class="grid" aria-label="Question navigator">${a.qids.map((id,i)=>{const ans=a.answers[id]!==undefined;let cl=ans?"ans":"";if(a.mode==="tutor"&&a.revealed&&a.revealed[id]){const qq=S.qById[id];cl=qq&&a.answers[id]===qq.ans?"r":"w"}
   return `<button data-go="${i}" class="${cl} ${i===a.idx?"cur":""} ${a.marked[id]?"mk":""}" aria-label="Question ${i+1}${ans?", answered":""}${a.marked[id]?", marked":""}">${i+1}</button>`}).join("")}</div>`:""}
 <p class="qid">Question ID ${esc(q.id)} · ${esc(KIND[q.kind]||q.kind)}</p>
 </div>`}
function noteBox(id){return `<div class="mynote"><label><span class="muted">My note on this question — saved automatically</span><textarea data-qnote="${esc(id)}" aria-label="My note on this question" placeholder="Why I got it wrong, a mnemonic, what to look up…">${esc(S.me.qnotes[id]||"")}</textarea></label></div>`}
function explHTML(q,sel,extra){const right=sel===q.ans;const p=S.prog[q.id];
 const card=S.cardById[q.cid];
 return `<div class="expl fadein"><p class="verdict ${sel===undefined?"":right?"r":"w"}">${sel===undefined?"Not answered":right?"Correct":"Incorrect"} — answer ${LET[q.ans]}: ${esc(q.opts[q.ans])}</p>
 ${extra||""}
 ${q.kind==="mcq"?`${q.why?`<h2 class="eh">Why each option</h2><ul class="why">${q.opts.map((o,i)=>`<li class="${i===q.ans?"ok":i===sel?"bad":""}"><b>${LET[i]}.</b> ${esc(o)} — <span>${esc(q.why[i])}</span></li>`).join("")}</ul>`:""}<h2 class="eh">Key point</h2><p style="margin:0">${esc(q.fact)}</p>${q.ref?`<p class="stat-line">Source: ${esc(q.ref)}</p>`:""}<p class="stat-line">${esc(DISCN[q.disc]||"")} · ${esc((DIMN[q.dim]||[""])[0])} · ${esc((ACTN[q.act]||[""])[0])}</p>`:q.kind==="vignette"||isMine(q)?(q.fact?`<h2 class="eh">Explanation</h2><p style="margin:0">${esc(q.fact)}</p>`:""):`<h2 class="eh">From your notes · ${esc(q.topic)}</h2><p style="margin:0">${esc(q.fact)}</p>`}
 ${q.also&&q.also.length?`<h2 class="eh">Also know</h2><ul>${q.also.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}
 <div class="row" style="margin-top:12px">${card?`<button class="btn ghost small" data-topic="${q.cid}">Open topic</button>${card.imgs.length?`<button class="btn ghost small" data-srcimg="${q.id}">Show source screenshot</button>`:""}`:""}${isMine(q)?`<button class="btn ghost small" data-editq="${esc(q.id)}">Edit my question</button>`:`<button class="linkbtn" data-report="${q.id}">Report a problem</button>`}</div>
 <div class="srcimgs" id="si-${q.id}"></div>
 ${noteBox(q.id)}
 ${p&&p.n>1?`<p class="stat-line">You've answered this ${p.n} times, ${p.c} correct.</p>`:""}</div>`}
function record(q,sel){const p=S.prog[q.id]||{n:0,c:0};p.n++;const ok=sel===q.ans;if(ok)p.c++;p.last=ok?1:0;p.t=Date.now();S.prog[q.id]=p;
 if(!ok){S.srs[q.id]={due:Date.now()+10*MIN,ivl:0,ef:2.3,reps:0,t:Date.now()}}
 else if(!S.srs[q.id]){S.srs[q.id]={due:Date.now()+3*DAY,ivl:3,ef:2.5,reps:1,t:Date.now()}}
 bump();return spKey(q.sp)}
function finishTest(){const a=S.active;stampQ();a.elapsed=elapsed();a.resumed=null;a.done=true;a.updated=Date.now();
 const keys=new Set(["active","tests"]);let c=0;const bySp={};const chg={wr:0,rw:0,ww:0};
 a.qids.forEach(id=>{const q=S.qById[id];if(!q)return;const sel=a.answers[id];
  if(a.mode==="exam"&&sel!==undefined)keys.add(record(q,sel));
  const ok=sel===q.ans;if(ok)c++;const b=bySp[q.sp]||(bySp[q.sp]={n:0,c:0});b.n++;if(ok)b.c++;
  const f=a.first&&a.first[id];if(f!==undefined&&sel!==undefined&&f!==sel){if(f!==q.ans&&ok)chg.wr++;else if(f===q.ans&&!ok)chg.rw++;else chg.ww++}
  if(a.marked[id]){const p=S.prog[id]||{n:0,c:0};p.mk=1;p.t=Date.now();S.prog[id]=p;keys.add(spKey(q.sp))}});
 const qt={};Object.entries(a.qtime||{}).forEach(([k,v])=>qt[k]=Math.round(v));
 const sum={id:a.id,date:Date.now(),mode:a.mode,n:a.qids.length,c,secs:Math.round(a.elapsed),label:a.label,bySp,qids:a.qids,answers:a.answers,marked:a.marked,chg,qt,first:a.first||{}};
 S.tests.unshift(sum);S.tests=S.tests.slice(0,100);S.last=sum;S.active=null;S.review.filter="all";
 persist([...keys]);location.hash="#results"}

/* ================= RESULTS / HISTORY ================= */
function ring(p){const r=56,C=2*Math.PI*r;return `<svg class="ring" viewBox="0 0 132 132" role="img" aria-label="${p}% correct"><circle cx="66" cy="66" r="${r}" fill="none" stroke="var(--panel2)" stroke-width="12"/><circle cx="66" cy="66" r="${r}" fill="none" stroke="${p>=75?"var(--ok)":p>=55?"var(--mk)":"var(--err)"}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C*p/100} ${C}" transform="rotate(-90 66 66)"/><text x="66" y="74" text-anchor="middle" font-family="IBM Plex Sans Condensed, system-ui, sans-serif" font-weight="700" font-size="30" fill="currentColor">${p}%</text></svg>`}
function chgHTML(chg){if(!chg)return "";const tot=chg.wr+chg.rw+chg.ww;if(!tot)return `<p class="muted" style="font-size:14px;margin:4px 0">No answers changed.</p>`;
 return `<div class="chgs" aria-label="Answer changes"><span class="pill r">${chg.wr} wrong → right</span><span class="pill w">${chg.rw} right → wrong</span><span class="pill">${chg.ww} wrong → wrong</span></div>`}
function vResults(){const t=S.last||S.tests[0];if(!t)return `<p class="empty">No results yet.</p>`;
 const f=S.review.filter;
 const items=t.qids.map((id,i)=>({id,i,q:S.qById[id],sel:t.answers[id]})).filter(x=>x.q).filter(x=>f==="all"||(f==="wrong"&&x.sel!==x.q.ans)||(f==="marked"&&t.marked&&t.marked[x.id])||(f==="changed"&&t.first&&t.first[x.id]!==undefined&&t.first[x.id]!==x.sel));
 const sp=Object.entries(t.bySp||{}).sort((a,b)=>b[1].n-a[1].n).map(([s,v])=>{const a=pct(v.c,v.n);return `<div class="spec"><span>${esc(s)}</span><div class="meter"><i class="${a>=75?"good":a>=55?"mid":"low"}" style="width:${a}%"></i></div><em>${v.c}/${v.n}</em></div>`}).join("");
 const wrongN=t.qids.filter(id=>S.qById[id]&&t.answers[id]!==S.qById[id].ans).length;
 return `<h1 class="h">Test results</h1><p class="sub">${new Date(t.date).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"})} · ${t.mode==="exam"?"Exam":"Tutor"} · ${esc(t.label)}</p>
 <div class="score">${ring(pct(t.c,t.n))}<div><p style="margin:0;font-size:20px"><b>${t.c}</b> of ${t.n} correct</p><p class="muted" style="margin:4px 0 6px">Time ${fmtTime(t.secs)} · ${fmtTime(t.secs/Math.max(1,t.n))} per question</p>${chgHTML(t.chg)}
 <div class="row" style="margin-top:8px"><button class="btn" id="retryWrong" ${wrongN?"":"disabled"}>Retest ${wrongN} missed</button><a class="btn ghost" href="#test">New test</a></div></div></div>
 ${sp?`<h2 class="sec-h">By specialty</h2>${sp}`:""}
 <h2 class="sec-h">Review answers</h2><div class="seg" role="group" aria-label="Filter answers">${[["all","All"],["wrong","Incorrect"],["marked","Marked"],["changed","Changed"]].map(([v,l])=>`<button data-rf="${v}" aria-pressed="${f===v}">${l}</button>`).join("")}</div>
 <ul class="reviewlist" style="margin-top:10px">${items.map(x=>{const ok=x.sel===x.q.ans;const sk=x.sel===undefined;const tm=t.qt&&t.qt[x.id];const ch=t.first&&t.first[x.id]!==undefined&&t.first[x.id]!==x.sel;
  return `<li data-rv="${x.id}"><span class="dot ${sk?"s":ok?"r":"w"}">${sk?"–":ok?"✓":"✗"}</span><div><div>${x.i+1}. ${esc(x.q.stem)}${x.q.clue?` <span class="muted">${esc(x.q.clue)}</span>`:""}</div>
  <div class="muted" style="font-size:14px;margin-top:2px">${sk?"Not answered":"Your answer: "+esc(x.q.opts[x.sel])}${ok?"":` · Correct: <b style="color:var(--ok)">${esc(x.q.opts[x.q.ans])}</b>`}${tm!==undefined?` · ${fmtTime(tm)}`:""}${ch?" · changed answer":""}${S.me.qnotes[x.id]?" · has note":""}</div>
  <div id="rv-${x.id}"></div></div></li>`}).join("")||`<li class="muted">Nothing here.</li>`}</ul>`}
function vHistory(){if(!S.tests.length)return `<h1 class="h">Test history</h1><p class="empty">No tests yet. <a href="#test" style="color:var(--acc)">Start one</a>.</p>`;
 return `<h1 class="h">Test history</h1><p class="sub">${S.tests.length} test${S.tests.length>1?"s":""} · <a href="#stats" style="color:var(--acc)">See performance trends</a></p><div class="scroll" style="overflow-x:auto"><table class="hist"><thead><tr><th>Date</th><th>Mode</th><th>Specialties</th><th class="n">Score</th><th class="n">Time</th></tr></thead><tbody>
 ${S.tests.map((t,i)=>`<tr data-hist="${i}" style="cursor:pointer" tabindex="0"><td>${new Date(t.date).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</td><td>${t.mode==="exam"?"Exam":"Tutor"}</td><td>${esc(t.label.length>34?t.label.slice(0,32)+"…":t.label)}</td><td class="n"><b>${pct(t.c,t.n)}%</b> ${t.c}/${t.n}</td><td class="n">${fmtTime(t.secs)}</td></tr>`).join("")}</tbody></table></div>`}

/* ================= PERFORMANCE ================= */
function trendSVG(){const T=S.tests.slice(0,20).reverse();if(T.length<2)return `<p class="muted">Take at least two tests to see a trend.</p>`;
 const W=420,H=190,pad=30;const x=i=>pad+i*(W-2*pad)/(T.length-1),y=v=>H-pad-(v/100)*(H-2*pad);
 const pts=T.map((t,i)=>[x(i),y(pct(t.c,t.n))]);
 const grid=[0,25,50,75,100].map(v=>`<line x1="${pad}" x2="${W-pad}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pad-6}" y="${y(v)+4}" text-anchor="end" font-size="13" fill="var(--mute)">${v}</text>`).join("");
 return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score trend over your last ${T.length} tests, from ${pct(T[0].c,T[0].n)}% to ${pct(T[T.length-1].c,T[T.length-1].n)}%">${grid}<polyline fill="none" stroke="var(--acc)" stroke-width="2.5" points="${pts.map(p=>p.join(",")).join(" ")}"/>${pts.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="var(--acc)"><title>${new Date(T[i].date).toLocaleDateString()}: ${pct(T[i].c,T[i].n)}%</title></circle>`).join("")}</svg>`}
function heatHTML(){const cells=[];const d=new Date();d.setHours(12);const start=new Date(d);start.setDate(d.getDate()-83-d.getDay());
 for(let i=0;i<84+d.getDay()+1;i++){const c=new Date(start);c.setDate(start.getDate()+i);if(c>d)break;const k=dkey(c);const n=S.me.act[k]||0;const l=!n?"":n<10?"l1":n<30?"l2":"l3";
  cells.push(`<i class="${l} ${k===today()?"today":""}" title="${k}: ${n} question${n===1?"":"s"}"></i>`)}
 const days=Object.values(S.me.act).filter(Boolean).length;
 return `<div class="heat" role="img" aria-label="Activity over the last 12 weeks: ${days} active day${days===1?"":"s"}">${cells.join("")}</div><p class="hint">Each square is a day; darker means more questions answered.</p>`}
function blueprintHTML(){const ms=S.qs.filter(q=>q.kind==="mcq");const agg=(key,names)=>{const o={};ms.forEach(q=>{const k=q[key];if(!o[k])o[k]={n:0,c:0,bank:0};o[k].bank++;const p=S.prog[q.id];if(p&&p.n){o[k].n+=p.n;o[k].c+=p.c}});
  return Object.entries(names).map(([k,nm])=>{const v=o[k]||{n:0,c:0,bank:0};const a=v.n?pct(v.c,v.n):0;const label=Array.isArray(nm)?nm[0]:nm,w=`<small class="muted" style="display:block">${Array.isArray(nm)?"exam "+nm[1]+"% · ":""}${v.bank} in bank</small>`;
  return `<div class="spec"><span>${esc(label)}${w}</span><div class="meter"><i class="${a>=75?"good":a>=55?"mid":"low"}" style="width:${a}%"></i></div><em>${v.n?a+"% · "+v.n:"—"}</em></div>`}).join("")};
 return `<p class="hint">Accuracy on exam-style questions, grouped the way the MCC reports your result. Aim for 65%+ in every row.</p><h3 class="mini">Dimensions of care</h3>${agg("dim",DIMN)}<h3 class="mini">Physician activities</h3>${agg("act",ACTN)}<h3 class="mini">Discipline</h3>${agg("disc",DISCN)}`}
function vStats(){const st=stats();const tot=S.tests.reduce((a,t)=>a+t.n,0),secs=S.tests.reduce((a,t)=>a+t.secs,0);
 const chg=S.tests.reduce((a,t)=>{if(t.chg){a.wr+=t.chg.wr;a.rw+=t.chg.rw;a.ww+=t.chg.ww}return a},{wr:0,rw:0,ww:0});
 const byK={};S.qs.forEach(q=>{const p=S.prog[q.id];if(!p||!p.n)return;const k=KIND[q.kind]||q.kind;const b=byK[k]||(byK[k]={n:0,c:0});b.n+=p.n;b.c+=p.c});
 const byT={};S.qs.forEach(q=>{const p=S.prog[q.id];if(!p||!p.n)return;const k=q.cid||q.topic;const b=byT[k]||(byT[k]={n:0,c:0,title:q.topic,sp:q.sp,cid:q.cid});b.n+=p.n;b.c+=p.c});
 const weak=Object.values(byT).filter(b=>b.n>=2).sort((a,b)=>a.c/a.n-b.c/b.n||b.n-a.n).slice(0,12);
 return `<h1 class="h">Performance</h1><p class="sub">Everything here comes from the questions you have answered.</p>
 <div class="kpis"><div class="kpi"><b>${st.n?pct(st.c,st.n)+"%":"—"}</b><span>Overall correct</span></div><div class="kpi"><b>${st.n}</b><span>Answers given</span></div><div class="kpi"><b>${tot?fmtTime(secs/tot):"—"}</b><span>Average time per question</span></div><div class="kpi"><b>${streak()}</b><span>Day streak</span></div></div>
 <h2 class="sec-h">Score trend</h2>${trendSVG()}
 <h2 class="sec-h">Activity</h2>${heatHTML()}
 <h2 class="sec-h">MCCQE blueprint</h2>${blueprintHTML()}
 <h2 class="sec-h">By question type</h2>${Object.entries(byK).map(([k,v])=>{const a=pct(v.c,v.n);return `<div class="spec"><span>${esc(k)}</span><div class="meter"><i class="${a>=75?"good":a>=55?"mid":"low"}" style="width:${a}%"></i></div><em>${a}% · ${v.n}</em></div>`}).join("")||`<p class="muted">No answers yet.</p>`}
 <h2 class="sec-h">Weakest topics</h2>${weak.length?`<table class="wk"><thead><tr><th>Topic</th><th class="n">Correct</th><th></th></tr></thead><tbody>${weak.map(w=>`<tr><td>${esc(w.title)}<div class="muted" style="font-size:13px">${esc(w.sp)}</div></td><td class="n">${pct(w.c,w.n)}% (${w.c}/${w.n})</td><td class="n">${w.cid?`<button class="linkbtn" data-quiz="${esc(w.cid)}">Quiz</button>`:""}</td></tr>`).join("")}</tbody></table>`:`<p class="muted">Answer each topic at least twice to see your weakest areas.</p>`}
 <h2 class="sec-h">Answer changes</h2>${chgHTML(chg)}<p class="hint">If “right → wrong” is bigger than “wrong → right”, trust your first answer more.</p>`}

/* ================= FLASHCARDS (spaced repetition) ================= */
function fcQueue(){const now=Date.now();const inSp=q=>S.fcSp==="All"||q.sp===S.fcSp;
 const due=S.qs.filter(q=>inSp(q)&&S.srs[q.id]&&S.srs[q.id].due<=now).sort((a,b)=>S.srs[a.id].due-S.srs[b.id].due);
 const fresh=shuffle(S.qs.filter(q=>inSp(q)&&!S.srs[q.id])).slice(0,Math.max(0,15-due.length));return {due:due.map(q=>q.id),fresh:fresh.map(q=>q.id)}}
function deckChips(){const sps=["All",...specs().map(x=>x[0])];return `<div class="hscroll" aria-label="Deck">${sps.map(s=>`<button class="chip" data-fcsp="${esc(s)}" aria-pressed="${s===S.fcSp}">${esc(s)}<small>${dueCount(s)} due</small></button>`).join("")}</div>`}
function vCards(){if(!S.fc){const Q=fcQueue();S.fc={list:[...Q.due,...Q.fresh],i:0,shown:false,dueN:Q.due.length,done:0}}
 const f=S.fc;const id=f.list[f.i];const q=S.qById[id];
 if(!q)return `<h1 class="h">Flashcards</h1>${deckChips()}<div class="fc"><h3 style="font-size:24px">All caught up.</h3><p class="muted">You reviewed ${f.done} card${f.done===1?"":"s"}. Missed test questions are added here automatically.</p><div class="row"><button class="btn" id="fcMore">Study 15 new cards</button><a class="btn ghost" href="#test">Take a test</a></div></div>`;
 const s=S.srs[id];
 const iv=g=>{const n=nextSrs(s,g);const d=n.due-Date.now();return d<3600e3?Math.round(d/6e4)+"m":d<DAY*1.5?Math.round(d/3600e3)+"h":Math.round(d/DAY)+"d"};
 return `<h1 class="h">Flashcards</h1>${deckChips()}<p class="sub">${f.i+1} of ${f.list.length} · ${f.dueN} due, ${f.list.length-f.dueN} new · ${esc(q.sp)}</p>
 <div class="fc fadein"><p class="qmeta" style="margin:0 0 8px">${esc(q.kind==="identify"?"Identify":q.ctx)}</p><p class="stem">${esc(q.stem)}</p>${q.clue?`<p class="clue">${esc(q.clue)}</p>`:""}
 ${f.shown?`<div class="ans"><b>${esc(q.opts[q.ans])}</b>${q.kind!=="identify"&&q.fact&&q.fact!==q.clue?`<p class="muted" style="font-size:15px;margin:8px 0 0">${esc(q.fact)}</p>`:""}<p class="muted" style="font-size:13px;margin:8px 0 0">${esc(q.topic)}</p></div>`:""}</div>
 ${f.shown?`<div class="rate">${[["0","Again"],["1","Hard"],["2","Good"],["3","Easy"]].map(([g,l])=>`<button data-rate="${g}">${l}<small>${iv(+g)}</small></button>`).join("")}</div>`:`<div class="row" style="margin-top:14px"><button class="btn" id="fcShow">Show answer</button><span class="kbd">Space to reveal · 1–4 to rate</span></div>`}`}
function nextSrs(s,g){s=s||{ivl:0,ef:2.5,reps:0};let {ivl,ef,reps}=s;
 if(g===0){reps=0;ivl=0;ef=Math.max(1.3,ef-.2);return {due:Date.now()+10*MIN,ivl,ef,reps,t:Date.now()}}
 reps++;ef=Math.max(1.3,ef+(g===1?-.15:g===3?.15:0));
 ivl=reps===1?(g===1?1:g===3?4:2):reps===2?(g===1?3:g===3?8:6):Math.round(ivl*(g===1?1.2:g===3?ef*1.3:ef));
 return {due:Date.now()+ivl*DAY,ivl,ef,reps,t:Date.now()}}

/* ================= BROWSE ================= */
function hl(t){const q=S.browse.q.trim();if(!q)return esc(t);const w=q.split(/\s+/).filter(x=>x.length>1).map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));if(!w.length)return esc(t);return esc(t).replace(new RegExp("("+w.join("|")+")","gi"),"<mark>$1</mark>")}
function topicHTML(c){const B=S.browse;const open=B.open.has(c.id);const nopen=B.noteOpen.has(c.id)||!!S.me.tnotes[c.id];
 const groups=[];c.facts.forEach(f=>{const k=f.sec||"";let g=groups.find(x=>x.k===k);if(!g)groups.push(g={k,items:[]});g.items.push(f)});
 const facts=groups.map(g=>`${g.k?`<h3 class="fsec">${esc(g.k)}</h3>`:""}<ul>${g.items.map(f=>`<li class="${f.s}">${hl(f.t)}${f.n?`<span class="flag"><b>${LBL[f.s]}:</b> ${esc(f.n)}</span>`:""}</li>`).join("")}</ul>`).join("");
 const flags=c.facts.filter(f=>f.n).length+(c.note?1:0);const nq=S.qs.filter(q=>q.cid===c.id).length;const star=!!S.me.stars[c.id];
 return `<article class="topic" id="c-${c.id}"><div class="th"><div><h2>${hl(c.title)}</h2><div class="spn">${esc(c.sp)}${c.kind==="visual"?" · Diagram / table":""}${c.auth?` · <span class="ca">Canadian guidance</span>`:c.yield==="basic"?" · Basic science":""}</div></div><button class="star" data-star="${c.id}" aria-pressed="${star}" aria-label="${star?"Remove from":"Add to"} starred topics" title="Star">${star?"★":"☆"}</button></div>
 ${c.note?`<p class="cnote ${c.status}"><b>${LBL[c.status]}:</b> ${esc(c.note)}</p>`:""}
 ${facts?`<div class="facts">${facts}${c.ref?`<p class="tmeta">Sources: ${esc(c.ref)}</p>`:""}</div>`:""}
 ${!facts&&c.ocr&&S.browse.q?`<div class="ocr">${hl(c.ocr)}</div>`:""}
 ${nopen?`<div class="mynote"><label><span class="muted">My notes on this topic — saved automatically</span><textarea data-tnote="${c.id}" aria-label="My notes on ${esc(c.title)}">${esc(S.me.tnotes[c.id]||"")}</textarea></label></div>`:""}
 <div class="tmeta"><span class="badge">${LBL[c.status]}</span>${flags?`<span class="badge" style="color:var(--acc)">${flags} flag${flags>1?"s":""}</span>`:""}${nq?`<button class="linkbtn" data-quiz="${c.id}">Quiz this topic (${nq})</button>`:""}
 ${c.imgs.length?`<button class="linkbtn" data-open="${c.id}">${open?"Hide":"Show"} source${c.imgs.length>1?"s ("+c.imgs.length+")":""}</button>`:""}${nopen?"":`<button class="linkbtn" data-tnoteopen="${c.id}">Add my notes</button>`}<button class="linkbtn" data-newq="${c.id}">Write a question</button></div>
 ${open?`<div class="imgs">${c.imgs.map(s=>`<img data-src="${esc(s)}" alt="Source screenshot for ${esc(c.title)}" tabindex="0">`).join("")}</div>`:""}</article>`}
function browseList(){const B=S.browse;const q=B.q.trim().toLowerCase();
 let res=S.data.cards.filter(c=>(B.sp==="All"||c.sp===B.sp)&&(!q||q.split(/\s+/).every(w=>c._hay.includes(w)||(S.me.tnotes[c.id]||"").toLowerCase().includes(w))));
 if(B.kf==="canada")res=res.filter(c=>c.auth);else if(B.kf==="core")res=res.filter(c=>c.yield!=="basic");else if(B.kf==="notes")res=res.filter(c=>c.kind==="notes");else if(B.kf==="images")res=res.filter(c=>c.kind==="visual");else if(B.kf==="flagged")res=res.filter(c=>c.note||c.facts.some(f=>f.n));else if(B.kf==="starred")res=res.filter(c=>S.me.stars[c.id]);else if(B.kf==="mine")res=res.filter(c=>S.me.tnotes[c.id]);
 if(B.sort==="az")res=res.slice().sort((a,b)=>a.title.localeCompare(b.title));
 else res=res.slice().sort((a,b)=>{if(q){const ta=a.title.toLowerCase().includes(q)?0:1,tb=b.title.toLowerCase().includes(q)?0:1;if(ta!==tb)return ta-tb}return a.kind===b.kind?0:a.kind==="notes"?-1:1});
 return res}
function vBrowse(){const B=S.browse;const n={};S.data.cards.forEach(c=>n[c.sp]=(n[c.sp]||0)+1);
 const list=["All",...Object.keys(n).sort((a,b)=>n[b]-n[a])];const res=browseList();
 const kf=[["all","All"],["canada","Canadian guidance 🍁"],["core","MCCQE focus"],["notes","Notes"],["images","Images"],["flagged","Flagged"],["starred","Starred ★"],["mine","My notes"]];
 return `<h1 class="h">Your notes</h1><div class="search"><input id="bq" type="search" value="${esc(B.q)}" placeholder="Search diseases, drugs, signs…" autocomplete="off" aria-label="Search notes"></div>
 <div class="hscroll" id="bsp" aria-label="Specialty">${list.map(s=>`<button class="chip" data-bsp="${esc(s)}" aria-pressed="${s===B.sp}">${esc(s)}<small>${s==="All"?S.data.cards.length:n[s]}</small></button>`).join("")}</div>
 <div class="row" style="justify-content:space-between;margin:4px 0 6px"><div class="hscroll" style="padding:0" aria-label="Show">${kf.map(([v,l])=>`<button class="chip" data-kf="${v}" aria-pressed="${B.kf===v}">${l}</button>`).join("")}</div>
 <label class="row" style="gap:6px;font-size:14px"><span class="muted">Sort</span><select class="inp" id="bsort" style="width:auto;min-height:38px;padding:4px 8px" aria-label="Sort topics"><option value="rel" ${B.sort==="rel"?"selected":""}>Best match</option><option value="az" ${B.sort==="az"?"selected":""}>A–Z</option></select></label></div>
 <p class="muted" style="font-size:14px">${res.length} topic${res.length===1?"":"s"}</p><div id="blist">${res.slice(0,B.shown).map(topicHTML).join("")||`<p class="empty">Nothing matches${B.q?` “${esc(B.q)}”`:""}.</p>`}</div>
 ${res.length>B.shown?`<button class="btn ghost" id="bmore" style="margin:18px auto;display:flex">Show more (${res.length-B.shown} left)</button>`:""}`}

/* ================= FLAGS ================= */
function vFlags(){const items=[];S.data.cards.forEach(c=>{if(c.note)items.push({c,t:"Whole image",s:c.status,n:c.note});c.facts.forEach(f=>{if(f.n)items.push({c,t:f.t,s:f.s,n:f.n})})});
 const o={error:0,outdated:1,caution:2};items.sort((a,b)=>o[a.s]-o[b.s]);
 const reps=S.reports;
 return `<h1 class="h">Flags</h1><p class="sub">${items.length} items in your notes need attention. Incorrect first, then outdated, then Canada-specific checks. These are never used as quiz answers.</p>
 ${items.map(i=>`<article class="topic"><h2 style="font-size:19px">${esc(i.c.title)}</h2><div class="spn">${esc(i.c.sp)}</div><div class="facts"><ul><li class="${i.s}">${esc(i.t)}<span class="flag"><b>${LBL[i.s]}:</b> ${esc(i.n)}</span></li></ul></div><button class="linkbtn" data-topic="${i.c.id}">Open topic</button></article>`).join("")}
 <h2 class="sec-h">Your question reports</h2>${reps.length?`<ul class="reviewlist">${reps.slice().reverse().map(r=>`<li style="cursor:default"><span class="dot s">!</span><div><div>${esc(r.stem)}</div><div class="muted" style="font-size:14px">${esc(r.why)}${r.note?" — "+esc(r.note):""} · ${new Date(r.date).toLocaleDateString()}</div></div></li>`).join("")}</ul>`:`<p class="muted">None yet. Use “Report a problem” under any answer.</p>`}`}

/* ================= MORE ================= */
function vMore(){const flags=S.data.cards.reduce((a,c)=>a+(c.note?1:0)+c.facts.filter(f=>f.n).length,0);
 return `<h1 class="h">More</h1><div class="morelist">
 <a href="#stats"><b>Performance</b><span>Score trend, activity, weakest topics</span></a>
 <a href="#myq"><b>My questions</b><span>${S.myq.length} written · add your own</span></a>
 <a href="#history"><b>Test history</b><span>${S.tests.length} test${S.tests.length===1?"":"s"}</span></a>
 <button type="button" class="morebtn" id="pdfBtn"><b>Reference PDF</b><span>All notes by discipline, Canadian essentials first (about 1 MB)</span></button>
 <a href="#flags"><b>Flags</b><span>${flags} fact-check items · your reports</span></a>
 <button type="button" id="openLabs"><b>Lab values</b><span>SI reference ranges and unit converter</span></button>
 <a href="#settings"><b>Settings</b><span>Exam date, goal, theme, backup</span></a>
 <button type="button" id="openKeys"><b>Keyboard shortcuts</b><span>Press ? anywhere</span></button></div>`}

/* ================= MY QUESTIONS ================= */
function blankQ(cid){const c=cid&&S.cardById[cid];return {id:null,stem:"",clue:"",opts:["","","",""],ans:null,expl:"",sp:c?c.sp:"General",cid:c?c.id:"",topic:c?c.title:""}}
function vMyQ(){if(S.edit)return editHTML();
 return `<h1 class="h">My questions</h1><p class="sub">Write your own questions. They appear in tests (type “Mine”), flashcards and performance alongside the bank.</p>
 <div class="row"><button class="btn" id="newQ">New question</button><a class="btn ghost" href="#browse">Write one from a topic</a></div>
 ${S.myq.length?`<ul class="reviewlist" style="margin-top:14px">${S.myq.slice().reverse().map(m=>{const p=S.prog[m.id];return `<li style="cursor:default"><span class="dot s">${p&&p.n?pct(p.c,p.n)+"%":"•"}</span><div><div>${esc(m.stem)}</div><div class="muted" style="font-size:14px">Answer: ${esc(m.opts[m.ans])} · ${esc(m.sp)}${m.topic?" · "+esc(m.topic):""}</div>
 <div class="row" style="margin-top:4px"><button class="linkbtn" data-editq="${esc(m.id)}">Edit</button><button class="linkbtn" data-delq="${esc(m.id)}" style="color:var(--err)">${S.delArm===m.id?"Press again to delete":"Delete"}</button></div></div></li>`}).join("")}</ul>`:`<p class="empty">No questions yet.</p>`}`}
function editHTML(){const e=S.edit;const c=e.cid&&S.cardById[e.cid];
 return `<h1 class="h">${e.id?"Edit question":"New question"}</h1>${c?`<p class="sub">Linked to <b>${esc(c.title)}</b> · ${esc(c.sp)}</p>`:`<p class="sub">Not linked to a topic.</p>`}
 <form id="qform" novalidate>
 <label class="field"><span>Question stem</span><textarea class="inp" id="fStem" required>${esc(e.stem)}</textarea></label>
 <label class="field"><span>Extra detail shown below the stem (optional)</span><input class="inp" id="fClue" value="${esc(e.clue)}"></label>
 <fieldset class="field"><legend style="font:600 15px 'IBM Plex Sans Condensed',system-ui,sans-serif">Options — select the correct one</legend>
 ${[0,1,2,3].map(i=>`<div class="optrow"><input type="radio" name="fAns" value="${i}" ${e.ans===i?"checked":""} aria-label="Option ${LET[i]} is correct"><input class="inp" data-fopt="${i}" value="${esc(e.opts[i])}" placeholder="Option ${LET[i]}" aria-label="Option ${LET[i]}"></div>`).join("")}</fieldset>
 <label class="field"><span>Explanation</span><textarea class="inp" id="fExpl">${esc(e.expl)}</textarea></label>
 ${c&&c.facts.length?`<details style="margin:-6px 0 14px"><summary class="linkbtn" style="cursor:pointer">Insert a fact from this topic</summary><div class="factpick">${c.facts.filter(f=>f.s==="ok").slice(0,60).map((f,i)=>`<button type="button" data-ins="${i}">${esc(f.t)}</button>`).join("")}</div></details>`:""}
 <label class="field"><span>Specialty</span><select class="inp" id="fSp">${allSpecs().map(s=>`<option ${s===e.sp?"selected":""}>${esc(s)}</option>`).join("")}</select></label>
 <p class="err-msg" id="fErr" role="alert"></p>
 <div class="row"><button class="btn" type="submit" id="fSave">Save question</button><button class="btn ghost" type="button" id="fCancel2">Cancel</button></div></form>`}
function readForm(){const e=S.edit;e.stem=$("#fStem").value.trim();e.clue=$("#fClue").value.trim();e.expl=$("#fExpl").value.trim();e.sp=$("#fSp").value;
 e.opts=[0,1,2,3].map(i=>document.querySelector(`[data-fopt="${i}"]`).value.trim());const r=document.querySelector('input[name=fAns]:checked');e.ans=r?+r.value:null}
function saveForm(){readForm();const e=S.edit;let err="";
 if(e.stem.length<10)err="Write a question stem of at least 10 characters.";
 else if(e.opts.some(o=>!o))err="Fill in all four options.";
 else if(new Set(e.opts.map(o=>o.toLowerCase())).size<4)err="The four options must be different.";
 else if(e.ans===null)err="Select the correct option.";
 if(err){$("#fErr").textContent=err;return}
 const rec={id:e.id||"u_"+Date.now().toString(36),stem:e.stem,clue:e.clue,opts:e.opts,ans:e.ans,expl:e.expl,sp:e.sp,cid:e.cid,topic:e.topic,t:Date.now()};
 const i=S.myq.findIndex(m=>m.id===rec.id);if(i>=0)S.myq[i]=rec;else S.myq.push(rec);
 S.myqT=Date.now();rebuildQs();S.edit=null;persist(["myq"]);toast("Question saved");go("#myq")}

/* ================= SETTINGS ================= */
function vSettings(){const st=S.me.settings;const segs=(name,cur,opts)=>`<div class="seg" role="group" aria-label="${name}">${opts.map(([v,l])=>`<button type="button" data-st="${name}" data-val="${v}" aria-pressed="${String(cur)===String(v)}">${l}</button>`).join("")}</div>`;
 const D=S.data;const fc={ok:0,caution:0,error:0,outdated:0,unchecked:0};D.cards.forEach(c=>c.facts.forEach(f=>fc[f.s]=(fc[f.s]||0)+1));
 return `<h1 class="h">Settings</h1><p class="sub">${DB.ok?"Settings and progress sync to your account.":"Saved on this device."}</p>
 <h2 class="sec-h">Study plan</h2>
 <label class="field"><span>Exam date</span><input class="inp" id="sDate" type="date" value="${esc(st.examDate)}" style="max-width:240px"></label>
 <label class="field"><span>Daily goal (questions)</span><input class="inp num" id="sGoal" type="number" min="1" max="500" value="${+st.goal||40}"></label>
 <fieldset><legend>Default time per question in exam mode</legend>${segs("secs",st.secs,[[60,"60 s"],[90,"90 s"],[120,"120 s"]])}</fieldset>
 <h2 class="sec-h">Display</h2>
 <fieldset><legend>Theme</legend>${segs("theme",st.theme,[["system","Match device"],["light","Light"],["dark","Dark"]])}</fieldset>
 <fieldset><legend>Text size</legend>${segs("fs",st.fs,[[15,"Small"],[16,"Normal"],[18,"Large"],[20,"Extra large"]])}</fieldset>
 <h2 class="sec-h">Your data</h2>
 <p class="muted" style="margin-top:0">${Object.keys(S.prog).length} questions answered · ${S.tests.length} tests · ${Object.keys(S.srs).length} flashcards scheduled · ${S.myq.length} own questions · ${Object.keys(S.me.qnotes).length+Object.keys(S.me.tnotes).length} notes</p>
 <div class="row"><button class="btn ghost small" id="expBtn">Download a backup</button><button class="btn ghost small" id="copyBtn">Copy backup</button><label class="btn ghost small" style="cursor:pointer">Restore a backup<input type="file" id="impFile" accept="application/json,.json" hidden></label></div>
 <p class="hint">A backup holds your progress, tests, flashcard schedule, notes, stars and own questions.</p>
 <div class="plan" style="margin-top:18px"><h2 style="color:var(--err)">Reset progress</h2><p style="margin:0 0 8px;font-size:15px">Clears answers, tests, flashcards and the activity log. Your own questions, notes and stars are kept. Type RESET to confirm.</p>
 <div class="row"><input class="inp" id="resetTxt" style="max-width:160px" aria-label="Type RESET to confirm" autocomplete="off"><button class="btn small" id="resetBtn" style="background:var(--err)" disabled>Reset progress</button></div></div>
 <div class="plan" style="margin-top:18px"><h2>Lock this device</h2><p style="margin:0 0 8px;font-size:15px">Forgets the saved password key here. Your progress stays on this device; you will need the password to open the bank again.</p><button class="btn ghost small" id="lockBtn">Lock now</button></div>
 <h2 class="sec-h">About this bank</h2>
 <p style="margin:0;font-size:15px">${D.meta.images} source screenshots · ${D.cards.length} topics · ${D.meta.facts} facts · ${S.base.length} bank questions.<br>Fact checks: ${fc.ok} checked, ${fc.caution} flagged “check”, ${fc.outdated} outdated, ${fc.error} incorrect${fc.unchecked?`, ${fc.unchecked} not yet checked`:""}. Image-only topics are shown as the original screenshots and are not fact-checked.</p>`}
function backup(){return JSON.stringify({app:"med-notes-bank",v:2,date:new Date().toISOString(),prog:S.prog,srs:S.srs,tests:S.tests,reports:S.reports,me:S.me,myq:S.myq})}
function restore(obj){if(!obj||obj.app!=="med-notes-bank")throw new Error("Not a Med Notes Bank backup");
 S.prog=obj.prog||{};S.srs=obj.srs||{};S.tests=obj.tests||[];S.reports=obj.reports||[];S.me=normMe(obj.me);S.me.t=Date.now();S.myq=obj.myq||[];S.myqT=Date.now();
 rebuildQs();applySettings();S.fc=null;const keys=new Set(["tests","me","myq"]);S.qs.forEach(q=>keys.add(spKey(q.sp)));persist([...keys])}

/* ================= LAB VALUES ================= */
const LABS=[["Hematology",[["Hemoglobin","Male 135–175 g/L · Female 120–160 g/L"],["WBC","4.0–11.0 × 10⁹/L"],["Neutrophils","2.0–7.5 × 10⁹/L"],["Platelets","150–400 × 10⁹/L"],["MCV","80–100 fL"],["Reticulocytes","0.5–2.5%"],["Ferritin","Male 30–300 µg/L · Female 15–200 µg/L"],["Vitamin B12","> 150 pmol/L"],["INR","0.9–1.2"],["aPTT","25–35 s"],["Fibrinogen","2.0–4.0 g/L"],["ESR","Male < 15 mm/h · Female < 20 mm/h (rises with age)"]]],
 ["Electrolytes and kidney",[["Sodium","135–145 mmol/L"],["Potassium","3.5–5.0 mmol/L"],["Chloride","98–106 mmol/L"],["Bicarbonate","22–28 mmol/L"],["Anion gap","8–12 mmol/L"],["Urea","2.5–7.1 mmol/L"],["Creatinine","Male 60–110 µmol/L · Female 45–90 µmol/L"],["Calcium (total)","2.15–2.55 mmol/L"],["Calcium (ionized)","1.15–1.30 mmol/L"],["Magnesium","0.70–1.00 mmol/L"],["Phosphate","0.80–1.45 mmol/L"],["Serum osmolality","275–295 mOsm/kg"],["Uric acid","Male 200–430 µmol/L · Female 140–360 µmol/L"]]],
 ["Glucose and endocrine",[["Fasting glucose","3.6–6.0 mmol/L (diabetes: ≥ 7.0)"],["2-h glucose (75-g OGTT)","< 7.8 mmol/L (diabetes: ≥ 11.1)"],["HbA1c","< 6.0% (diabetes: ≥ 6.5%)"],["TSH","0.4–4.0 mU/L"],["Free T4","9–23 pmol/L"],["Morning cortisol","140–700 nmol/L"],["Prolactin","Female < 25 µg/L · Male < 20 µg/L"],["PTH","1.5–7.0 pmol/L"],["25-OH vitamin D","75–250 nmol/L sufficient"]]],
 ["Liver and pancreas",[["ALT","< 40 U/L"],["AST","< 40 U/L"],["ALP","40–120 U/L"],["GGT","< 50 U/L"],["Total bilirubin","< 20 µmol/L"],["Conjugated bilirubin","< 5 µmol/L"],["Albumin","35–50 g/L"],["Total protein","60–80 g/L"],["Lipase","< 60 U/L"],["Ammonia","< 35 µmol/L"]]],
 ["Cardiac, lipids, inflammation",[["Troponin (high-sensitivity)","Above the lab's 99th percentile = myocardial injury; use the local assay cut-off"],["BNP","< 100 ng/L (NT-proBNP < 125 ng/L outpatient)"],["CK","Roughly 30–200 U/L"],["LDL-C","Lab reports; CCS 2021 treatment thresholds in mmol/L"],["HDL-C","Male > 1.0 mmol/L · Female > 1.3 mmol/L"],["Triglycerides (fasting)","< 1.7 mmol/L"],["CRP","< 5 mg/L"],["Lactate","0.5–2.0 mmol/L"],["D-dimer","< 500 µg/L FEU (age-adjust after 50)"]]],
 ["Blood gas (arterial)",[["pH","7.35–7.45"],["PaCO₂","35–45 mmHg"],["PaO₂","80–100 mmHg (room air)"],["HCO₃⁻","22–26 mmol/L"],["Base excess","−2 to +2"],["SaO₂","95–100%"]]],
 ["CSF and urine",[["CSF opening pressure","10–20 cm H₂O"],["CSF WBC","0–5 × 10⁶/L"],["CSF protein","0.15–0.45 g/L"],["CSF glucose","2.2–3.9 mmol/L (about 60% of serum)"],["Urine specific gravity","1.005–1.030"],["Urine albumin:creatinine","< 3 mg/mmol"],["24-h urine protein","< 150 mg/day"]]]];
function labsRender(){const q=($("#labsQ").value||"").toLowerCase();
 $("#labsBody").innerHTML=`<table class="labs">${LABS.map(([g,rows])=>{const r=rows.filter(x=>!q||(x[0]+" "+g).toLowerCase().includes(q));return r.length?`<tr><th colspan="2">${esc(g)}</th></tr>${r.map(x=>`<tr><td>${esc(x[0])}</td><td class="v">${esc(x[1])}</td></tr>`).join("")}`:""}).join("")||"<tr><td>No match.</td></tr>"}</table>`}
const CONV={glu:[1/18,"mmol/L",1],cre:[88.4,"µmol/L",0],chol:[1/38.67,"mmol/L",2],tg:[1/88.57,"mmol/L",2],bili:[17.1,"µmol/L",0],ca:[0.2495,"mmol/L",2],hb:[10,"g/L",0],bun:[0.357,"mmol/L",1]};
function convRender(){const v=parseFloat($("#cvVal").value);const c=CONV[$("#cvType").value];$("#cvOut").textContent=isNaN(v)?"—":"= "+(v*c[0]).toFixed(c[2])+" "+c[1]}
function openLabs(){if(S.view==="run")pauseClock();labsRender();const d=$("#labsDlg");d.showModal?d.showModal():d.setAttribute("open","");setTimeout(()=>$("#labsQ").focus(),30)}
function closeDlg(id){const d=$(id);if(d.close)d.close();else d.removeAttribute("open")}

/* ================= router ================= */
function render(){if(!S.data)return;const v=(location.hash||"#home").slice(1);
 const V={home:vHome,test:vTest,run:vRun,results:vResults,history:vHistory,cards:vCards,browse:vBrowse,flags:vFlags,more:vMore,stats:vStats,myq:vMyQ,settings:vSettings};
 const view=V[v]?v:"home";
 if(S.view==="run"&&view!=="run"&&S.active)stampQ();
 S.view=view;
 const tabOf={run:"test",results:"test",history:"test",flags:"more",stats:"more",myq:"more",settings:"more"};
 document.querySelectorAll("nav.tabs a").forEach(a=>a.classList.toggle("on",a.dataset.v===(tabOf[view]||view)));
 document.body.classList.toggle("testing",view==="run");
 $("#main").innerHTML=V[view]();
 clearInterval(tick);
 if(view==="run"&&S.active&&!S.active.done){tick=setInterval(()=>{const a=S.active;if(!a||$("#labsDlg").open||$("#keysDlg").open){return}if(!a.resumed)a.resumed=Date.now();const el=$("#clock");if(!el)return;
  if(a.limit){const left=a.limit-elapsed();el.textContent=fmtTime(left);el.classList.toggle("warn",left<60);if(left<=0){clearInterval(tick);toast("Time is up");finishTest()}}else el.textContent=fmtTime(elapsed())},500)}
 fillImgs($("#main"))}
function go(h){if(location.hash===h)render();else location.hash=h}
function pauseClock(){const a=S.active;if(a&&a.resumed){a.elapsed=elapsed();a.resumed=null;a.updated=Date.now()}if(a)stampQ()}
window.addEventListener("hashchange",()=>{if(S.view==="run"&&location.hash!=="#run"){pauseClock();persist(["active"])}if(location.hash!=="#myq")S.edit=null;window.scrollTo(0,0);render()});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&S.view==="run"){pauseClock();persist(["active"])}else if(!document.hidden&&S.view==="run"&&S.active){S.active.resumed=Date.now();stampQ(S.active.qids[S.active.idx])}});

/* ================= events ================= */
function quizTopic(cid){const ids=shuffle(S.qs.filter(q=>q.cid===cid).map(q=>q.id)).slice(0,20);if(!ids.length)return;
 const c=S.cardById[cid];S.active=newActive(ids,"tutor",c?c.title:"Topic quiz",0);persist(["active"]);go("#run")}
function act(t){const a=S.active;
 // builder
 const set=t.closest("[data-set]");if(set){const k=set.dataset.set;S.build[k]=k==="n"||k==="secs"?+set.dataset.val:set.dataset.val;if(k==="mode")S.build.secs=null;render();return true}
 const sp=t.closest("[data-sp]");if(sp){const v=sp.dataset.sp;S.build.sps.has(v)?S.build.sps.delete(v):S.build.sps.add(v);render();return true}
 if(t.id==="spAll"){S.build.sps.clear();render();return true}
 if(t.id==="start"){startTest();return true}
 if(t.id==="startMock"){startMock();return true}
 const dc=t.closest("[data-disc]");if(dc){const v=dc.dataset.disc;S.build.discs.has(v)?S.build.discs.delete(v):S.build.discs.add(v);render();return true}
 // runner
 const pick=t.closest("[data-pick]");if(pick&&a){choose(+pick.dataset.pick);return true}
 const st=t.closest("[data-strike]");if(st&&a){strike(+st.dataset.strike);return true}
 if(t.id==="submitQ"){submitQ();return true}
 if(t.id==="next"){nextQ();return true}
 if(t.id==="prev"){a.idx=Math.max(0,a.idx-1);save();render();return true}
 const g=t.closest("[data-go]");if(g&&a){a.idx=+g.dataset.go;save();render();return true}
 if(t.id==="markQ"){const id=a.qids[a.idx];a.marked[id]=!a.marked[id];save();render();return true}
 if(t.id==="exitTest"){pauseClock();persist(["active"]);go("#home");toast("Test paused — resume from Home");return true}
 if(t.id==="skipMissing"){a.idx=Math.min(a.qids.length-1,a.idx+1);render();return true}
 if(t.id==="labsBtn"||t.closest("#openLabs")){openLabs();return true}
 if(t.closest("#openKeys")){openKeys();return true}
 // explanation extras
 const tp=t.closest("[data-topic]");if(tp){const c=S.cardById[tp.dataset.topic];if(c){pauseClock();S.browse.q=c.title;S.browse.sp="All";S.browse.kf="all";S.browse.open.add(c.id);go("#browse")}return true}
 const si=t.closest("[data-srcimg]");if(si){const q=S.qById[si.dataset.srcimg];const c=S.cardById[q.cid];const box=$("#si-"+q.id);if(box&&c){box.innerHTML=c.imgs.slice(0,3).map(s=>`<img data-src="${esc(s)}" alt="Source screenshot" tabindex="0">`).join("");fillImgs(box)}si.remove();return true}
 const rp=t.closest("[data-report]");if(rp){openReport(rp.dataset.report);return true}
 // results
 const rf=t.closest("[data-rf]");if(rf){S.review.filter=rf.dataset.rf;render();return true}
 const rv=t.closest("[data-rv]");if(rv&&!t.closest(".expl")){const id=rv.dataset.rv;const box=$("#rv-"+id);if(box){const tt=S.last||S.tests[0];box.innerHTML=box.innerHTML?"":explHTML(S.qById[id],tt.answers[id]);fillImgs(box)}return true}
 if(t.id==="retryWrong"){const tt=S.last||S.tests[0];const ids=tt.qids.filter(id=>S.qById[id]&&tt.answers[id]!==S.qById[id].ans);
  S.active=newActive(shuffle(ids),"tutor","Retest of missed questions",0);persist(["active"]);go("#run");return true}
 const h=t.closest("[data-hist]");if(h){S.last=S.tests[+h.dataset.hist];S.review.filter="all";go("#results");return true}
 // flashcards
 if(t.id==="fcShow"){S.fc.shown=true;render();return true}
 const rt=t.closest("[data-rate]");if(rt){rate(+rt.dataset.rate);return true}
 const fs=t.closest("[data-fcsp]");if(fs){S.fcSp=fs.dataset.fcsp;S.fc=null;render();return true}
 if(t.id==="fcMore"){const fresh=shuffle(S.qs.filter(q=>(S.fcSp==="All"||q.sp===S.fcSp)&&!S.srs[q.id])).slice(0,15).map(q=>q.id);S.fc={list:fresh,i:0,shown:false,dueN:0,done:S.fc.done};render();return true}
 // browse
 const bs=t.closest("[data-bsp]");if(bs){S.browse.sp=bs.dataset.bsp;S.browse.shown=30;render();return true}
 const kf=t.closest("[data-kf]");if(kf){S.browse.kf=kf.dataset.kf;S.browse.shown=30;render();return true}
 if(t.id==="bmore"){S.browse.shown+=30;render();return true}
 const op=t.closest("[data-open]");if(op){const id=op.dataset.open;S.browse.open.has(id)?S.browse.open.delete(id):S.browse.open.add(id);refreshTopic(id);return true}
 const sr=t.closest("[data-star]");if(sr){const id=sr.dataset.star;if(S.me.stars[id])delete S.me.stars[id];else S.me.stars[id]=1;touchMe();if(S.view==="browse"&&S.browse.kf==="starred")render();else refreshTopic(id);toast(S.me.stars[id]?"Starred":"Removed from starred");return true}
 const tno=t.closest("[data-tnoteopen]");if(tno){S.browse.noteOpen.add(tno.dataset.tnoteopen);refreshTopic(tno.dataset.tnoteopen);const ta=document.querySelector(`[data-tnote="${tno.dataset.tnoteopen}"]`);if(ta)ta.focus();return true}
 const qz=t.closest("[data-quiz]");if(qz){quizTopic(qz.dataset.quiz);return true}
 const nq=t.closest("[data-newq]");if(nq){S.edit=blankQ(nq.dataset.newq);go("#myq");return true}
 // my questions
 if(t.id==="newQ"){S.edit=blankQ();render();return true}
 const eq=t.closest("[data-editq]");if(eq){const m=S.myq.find(x=>x.id===eq.dataset.editq);if(m){if(S.view==="run")pauseClock();S.edit=JSON.parse(JSON.stringify(m));go("#myq")}return true}
 const dq=t.closest("[data-delq]");if(dq){const id=dq.dataset.delq;if(S.delArm===id){S.myq=S.myq.filter(m=>m.id!==id);S.myqT=Date.now();S.delArm=null;rebuildQs();persist(["myq"]);toast("Question deleted")}else{S.delArm=id;setTimeout(()=>{if(S.delArm===id){S.delArm=null;if(S.view==="myq")render()}},4000)}render();return true}
 if(t.id==="fCancel2"){S.edit=null;render();return true}
 const ins=t.closest("[data-ins]");if(ins){const c=S.cardById[S.edit.cid];const f=c.facts.filter(f=>f.s==="ok")[+ins.dataset.ins];const ta=$("#fExpl");ta.value=(ta.value?ta.value+" ":"")+f.t;return true}
 // settings
 const sg=t.closest("[data-st]");if(sg){const k=sg.dataset.st;const v=sg.dataset.val;S.me.settings[k]=k==="fs"||k==="secs"?+v:v;applySettings();touchMe();render();return true}
 if(t.id==="expBtn"){(async()=>{const fn="med-notes-bank-backup-"+today()+".json";const dl=null;
  if(dl){try{await dl.save({filename:fn,data:backup()});toast("Backup saved")}catch(e){toast("Download declined — use Copy backup")}return}
  try{const b=new Blob([backup()],{type:"application/json"});const u=URL.createObjectURL(b);const l=document.createElement("a");l.href=u;l.download=fn;document.body.appendChild(l);l.click();l.remove();setTimeout(()=>URL.revokeObjectURL(u),2000);toast("Backup downloaded")}catch(e){toast("Download blocked — use Copy backup")}})();return true}
 if(t.id==="copyBtn"){navigator.clipboard&&navigator.clipboard.writeText(backup()).then(()=>toast("Backup copied — paste it into a note or file"),()=>toast("Copy failed"));return true}
 if(t.closest("#pdfBtn")){const pb=t.closest("#pdfBtn");(async()=>{pb.disabled=true;toast("Preparing the PDF…");try{const b=await Vault.bytes("content/reference.pdf.enc");const u=URL.createObjectURL(new Blob([b],{type:"application/pdf"}));const l=document.createElement("a");l.href=u;l.download="Med-Notes-Bank-MCCQE-Reference.pdf";document.body.appendChild(l);l.click();l.remove();setTimeout(()=>URL.revokeObjectURL(u),4000)}catch(e){toast("The PDF could not be loaded")}pb.disabled=false})();return true}
 if(t.id==="lockBtn"){Vault.lock().then(()=>location.reload());return true}
 if(t.id==="resetBtn"){S.prog={};S.srs={};S.tests=[];S.active=null;S.last=null;S.fc=null;S.me.act={};touchMe();const keys=new Set(["tests","active"]);S.qs.forEach(q=>keys.add(spKey(q.sp)));persist([...keys]);toast("Progress reset");go("#home");return true}
 // image viewer
 if(t.tagName==="IMG"&&t.closest(".imgs,.srcimgs")&&t.src){openZoom(t);return true}
 return false}
function refreshTopic(id){const el=$("#c-"+id);if(!el)return;el.outerHTML=topicHTML(S.cardById[id]);fillImgs($("#c-"+id))}
const Z={list:[],i:0};
function openZoom(img){const box=img.closest(".imgs,.srcimgs");Z.list=[...box.querySelectorAll("img")].filter(x=>x.src&&x.src.startsWith("data:"));Z.i=Math.max(0,Z.list.indexOf(img));showZoom();$("#zoom").classList.add("on");$("#zClose").focus()}
function showZoom(){const z=$("#zoom");z.querySelector("img").src=Z.list[Z.i].src;$("#zCount").textContent=Z.list.length>1?(Z.i+1)+" / "+Z.list.length:"";$("#zPrev").hidden=$("#zNext").hidden=Z.list.length<2}
function zStep(d){if(Z.list.length<2)return;Z.i=(Z.i+d+Z.list.length)%Z.list.length;showZoom()}
function closeZoom(){$("#zoom").classList.remove("on")}
function save(){const a=S.active;if(a){a.updated=Date.now();lsSave();clearTimeout(save.t);save.t=setTimeout(()=>persist(["active"]),1500)}}
function choose(i){const a=S.active;const id=a.qids[a.idx];if(a.mode==="tutor"&&a.revealed&&a.revealed[id])return;a.first=a.first||{};if(a.first[id]===undefined)a.first[id]=i;a.answers[id]=i;save();render()}
function strike(i){const a=S.active;const id=a.qids[a.idx];if(a.mode==="tutor"&&a.revealed&&a.revealed[id])return;const s=a.struck[id]||(a.struck[id]=[]);const k=s.indexOf(i);k>=0?s.splice(k,1):s.push(i);if(a.answers[id]===i&&k<0)delete a.answers[id];save();render()}
function submitQ(){const a=S.active;const id=a.qids[a.idx];if(a.answers[id]===undefined)return;a.revealed=a.revealed||{};a.revealed[id]=true;const k=record(S.qById[id],a.answers[id]);persist([k,"active"]);render()}
function nextQ(){const a=S.active;if(a.idx<a.qids.length-1){a.idx++;save();render();return}
 if(a.mode==="exam"){openFinish();return}
 finishTest()}
function openFinish(){const a=S.active;const un=a.qids.filter(id=>a.answers[id]===undefined).length;const mk=a.qids.filter(id=>a.marked[id]).length;
 $("#finishMsg").textContent=`${a.qids.length-un} of ${a.qids.length} answered${un?`, ${un} unanswered`:""}${mk?`, ${mk} marked for review`:""}.`;
 $("#fGoUn").hidden=!un;$("#fGoMk").hidden=!mk;const d=$("#finishDlg");d.showModal?d.showModal():d.setAttribute("open","");$("#fFinish").focus()}
function rate(g){const f=S.fc;const id=f.list[f.i];S.srs[id]=nextSrs(S.srs[id],g);f.done++;f.i++;f.shown=false;bump();
 if(g===0&&f.list.indexOf(id,f.i)<0)f.list.push(id);persist([spKey(S.qById[id].sp)]);render()}
function openKeys(){const d=$("#keysDlg");d.showModal?d.showModal():d.setAttribute("open","")}

/* dialogs */
let repId=null,repWhy=null;
function openReport(id){repId=id;repWhy=null;const q=S.qById[id];$("#reportQ").textContent=q.stem+(q.clue?" "+q.clue:"");$("#reportNote").value="";
 document.querySelectorAll("#reportWhy .chip").forEach(c=>c.setAttribute("aria-pressed","false"));const d=$("#report");if(d.showModal)d.showModal();else d.setAttribute("open","")}
$("#reportWhy").addEventListener("click",e=>{const c=e.target.closest(".chip");if(!c)return;repWhy=c.dataset.why;document.querySelectorAll("#reportWhy .chip").forEach(x=>x.setAttribute("aria-pressed",String(x===c)))});
$("#report").addEventListener("close",async()=>{if($("#report").returnValue!=="send"||!repId)return;const q=S.qById[repId];
 const r={qid:repId,stem:q.stem+(q.clue?" "+q.clue:""),answer:q.opts[q.ans],topic:q.topic,why:repWhy||"Other",note:$("#reportNote").value.slice(0,1000),date:Date.now()};
 S.reports.push(r);lsSave();toast("Thanks — report saved");
 if(DB.ok){try{await DB.db.collection("reports").add({...r,uid:DB.uid})}catch(e){}}});
$("#fFinish").addEventListener("click",()=>{closeDlg("#finishDlg");finishTest()});
$("#fCancel").addEventListener("click",()=>closeDlg("#finishDlg"));
$("#fGoUn").addEventListener("click",()=>{const a=S.active;closeDlg("#finishDlg");const i=a.qids.findIndex(id=>a.answers[id]===undefined);if(i>=0){a.idx=i;save();render()}});
$("#fGoMk").addEventListener("click",()=>{const a=S.active;closeDlg("#finishDlg");const i=a.qids.findIndex(id=>a.marked[id]);if(i>=0){a.idx=i;save();render()}});
$("#labsClose").addEventListener("click",()=>closeDlg("#labsDlg"));$("#keysClose").addEventListener("click",()=>closeDlg("#keysDlg"));
$("#labsDlg").addEventListener("close",()=>{if(S.view==="run"&&S.active){S.active.resumed=Date.now();stampQ(S.active.qids[S.active.idx])}});
$("#labsQ").addEventListener("input",labsRender);$("#cvVal").addEventListener("input",convRender);$("#cvType").addEventListener("change",convRender);
$("#zPrev").addEventListener("click",e=>{e.stopPropagation();zStep(-1)});$("#zNext").addEventListener("click",e=>{e.stopPropagation();zStep(1)});$("#zClose").addEventListener("click",e=>{e.stopPropagation();closeZoom()});

document.addEventListener("click",e=>{if(e.target.closest("#zoom")){if(e.target.tagName!=="BUTTON")closeZoom();return}if(e.target.closest("dialog"))return;act(e.target)});
document.addEventListener("submit",e=>{if(e.target.id==="qform"){e.preventDefault();saveForm()}});
document.addEventListener("input",e=>{const t=e.target;
 if(t.id==="bq"){S.browse.q=t.value;S.browse.shown=30;const pos=t.selectionStart;clearTimeout(vBrowse.t);vBrowse.t=setTimeout(()=>{render();const i=$("#bq");if(i){i.focus();i.setSelectionRange(pos,pos)}},160);return}
 if(t.id==="btopic"){S.build.topic=t.value;const pos=t.selectionStart;clearTimeout(vTest.t);vTest.t=setTimeout(()=>{render();const i=$("#btopic");if(i){i.focus();i.setSelectionRange(pos,pos)}},250);return}
 if(t.id==="bn"){const v=Math.max(1,Math.min(300,parseInt(t.value)||0));if(v){S.build.n=v;clearTimeout(vTest.n);vTest.n=setTimeout(()=>{const pos=t.selectionStart;render();const i=$("#bn");if(i){i.focus()}},400)}return}
 if(t.dataset.qnote!==undefined){const id=t.dataset.qnote;const v=t.value.slice(0,4000);if(v.trim())S.me.qnotes[id]=v;else delete S.me.qnotes[id];touchMe();return}
 if(t.dataset.tnote!==undefined){const id=t.dataset.tnote;const v=t.value.slice(0,8000);if(v.trim())S.me.tnotes[id]=v;else delete S.me.tnotes[id];touchMe();return}
 if(t.id==="sGoal"){const v=parseInt(t.value);if(v>0){S.me.settings.goal=Math.min(500,v);touchMe()}return}
 if(t.id==="resetTxt"){$("#resetBtn").disabled=t.value.trim()!=="RESET";return}});
document.addEventListener("change",e=>{const t=e.target;
 if(t.id==="sDate"){S.me.settings.examDate=t.value;touchMe();toast(t.value?"Exam date saved":"Exam date cleared");return}
 if(t.id==="bsort"){S.browse.sort=t.value;render();return}
 if(t.id==="impFile"&&t.files[0]){const r=new FileReader();r.onload=()=>{try{restore(JSON.parse(r.result));toast("Backup restored");go("#home")}catch(err){toast("That file is not a valid backup")}};r.readAsText(t.files[0]);t.value=""}});
let xMode=false;
document.addEventListener("keydown",e=>{
 if(e.key==="Escape"&&$("#zoom").classList.contains("on")){closeZoom();return}
 if($("#zoom").classList.contains("on")){if(e.key==="ArrowRight")zStep(1);if(e.key==="ArrowLeft")zStep(-1);return}
 if(e.target.matches("input,textarea,select")||document.querySelector("dialog[open]"))return;
 if(e.key==="?"){openKeys();return}
 if(e.key==="/"&&S.view!=="run"){e.preventDefault();if(S.view!=="browse")go("#browse");setTimeout(()=>{const i=$("#bq");if(i)i.focus()},50);return}
 if(e.key==="Enter"&&e.target.matches("[data-hist]")){act(e.target);return}
 if(e.key==="Enter"&&e.target.tagName==="IMG"&&e.target.src){openZoom(e.target);return}
 if(S.view==="run"&&S.active){const k=e.key.toLowerCase();let i="12345".indexOf(k);if(i<0)i="abcde".indexOf(k);const qq=S.qById[S.active.qids[S.active.idx]];if(qq&&i>=qq.opts.length)i=-1;
  if(k==="x"){xMode=true;return}
  if(i>=0){xMode?strike(i):choose(i);xMode=false;e.preventDefault();return}xMode=false;
  if(k==="enter"){if(e.target.tagName==="BUTTON"&&e.target!==document.body)return;e.preventDefault();const a=S.active;const id=a.qids[a.idx];if(a.mode==="tutor"&&!(a.revealed&&a.revealed[id]))submitQ();else nextQ();return}
  if(k==="f"){act($("#markQ")||document.body);return}
  if(k==="l"){openLabs();return}
  if(k==="n"){const ta=document.querySelector("[data-qnote]");if(ta){e.preventDefault();ta.focus()}return}
  if(k==="arrowright"&&S.active.mode==="exam"){nextQ();return}
  if(k==="arrowleft"&&S.active.mode==="exam"){S.active.idx=Math.max(0,S.active.idx-1);save();render();return}}
 if(S.view==="cards"&&S.fc){if(e.key===" "&&!S.fc.shown){e.preventDefault();S.fc.shown=true;render();return}
  const i="1234".indexOf(e.key);if(i>=0&&S.fc.shown){rate(i)}}});

/* ================= boot ================= */
function loadAll(){document.body.classList.remove("locked");$("#lock").hidden=true;$("#main").innerHTML='<p class="empty" role="status">Opening your bank…</p>';
return Promise.all([Vault.json("content/data.enc"),Vault.json("content/questions.enc")]).then(([d,qd])=>{
 d.cards.forEach(c=>{c._hay=(c.title+" "+c.sp+" "+c.facts.map(f=>f.t+" "+(f.sec||"")+" "+f.n).join(" ")+" "+c.ocr).toLowerCase();S.cardById[c.id]=c});
 S.data=d;S.base=qd.questions;
 const L=lsLoad();S.prog=L.prog||{};S.srs=L.srs||{};S.tests=L.tests||[];S.active=L.active||null;S.reports=L.reports||[];S.me=normMe(L.me);S.myq=L.myq||[];S.myqT=L.myqT||0;
 rebuildQs();applySettings();
 if(S.active){S.active.resumed=null;S.active.qt0=null}
 render();dbInit();
}).catch(err=>{console.error(err);$("#main").innerHTML='<p class="empty">Could not load the question bank. Check your connection and reopen the page.</p>'});}
/* ---------- vault gate: unlock before loading any content ---------- */
async function gate(){
 if("serviceWorker" in navigator&&(location.protocol==="https:"||location.hostname==="localhost"))navigator.serviceWorker.register("sw.js").catch(()=>{});
 const L=$("#lock"),form=$("#lockForm"),pw=$("#lockPw"),err=$("#lockErr"),btn=$("#lockGo");
 if(!Vault.supported()){document.body.classList.add("locked");L.hidden=false;form.hidden=true;$("#lockUnsupported").hidden=false;return}
 let ok=false;try{ok=await Vault.tryStored()}catch(e){}
 if(ok){loadAll();return}
 document.body.classList.add("locked");L.hidden=false;setTimeout(()=>pw.focus(),50);
 $("#lockShow").addEventListener("click",()=>{const s=pw.type==="password";pw.type=s?"text":"password";$("#lockShow").textContent=s?"Hide":"Show";$("#lockShow").setAttribute("aria-pressed",String(s))});
 form.addEventListener("submit",async e=>{e.preventDefault();const v=pw.value.trim();if(!v){err.textContent="Enter the password.";pw.focus();return}
  btn.disabled=true;btn.textContent="Unlocking…";err.textContent="";
  let good=false;try{good=await Vault.unlock(v,$("#lockRemember").checked)}catch(x){err.textContent="Could not reach the site. Check your connection and try again.";btn.disabled=false;btn.textContent="Unlock";return}
  if(!good){err.textContent="That password did not work. Check it and try again.";btn.disabled=false;btn.textContent="Unlock";pw.select();return}
  pw.value="";loadAll()})}
gate();

}

