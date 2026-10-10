// TEN-417 step 11 (Live) — every check in test-ten417-live.mjs must FAIL when its rule is reverted or bent. Each mutant
// is applied to a copy of bsp-consult-dashboard.html (TEN417_HTML) and the suite runs against it; a mutant that leaves it
// green is a vacuous test and fails this runner. Anchors occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['header: In play counts interrupted matches', "const inPlay=LIVE.filter(m=>!m.interrupted).length;", "const inPlay=LIVE.length;"],
  ['header: Interrupted grey above 0', "interruptedColor:itr?'var(--amber)':'var(--text-label)'", "interruptedColor:itr?'var(--text)':'var(--text-label)'"],
  ['header: Updated reads the clock', "return typeof newsFmtHMS==='function' ? newsFmtHMS(FEED.updatedAt) : '—';", "return typeof newsFmtHMS==='function' ? newsFmtHMS(Date.now()) : '—';"],
  ['header: ready:false counted as 0 in play', "const hdr = FEED.ready\n", "const hdr = true\n"],
  ['card: raw tournament_name, not the canonical event', "const ev = (typeof sfEventName === 'function' ? sfEventName(raw) : raw) || raw;", "const ev = raw;"],
  ['card: Interrupted status not amber', "const stColor=live?'var(--text)':'var(--amber)';", "const stColor=live?'var(--text)':'var(--text-label)';"],
  ['card: Live dot stops pulsing', "animation:${live?'lvpulse 1.6s ease-in-out infinite':'none'}", "animation:none"],
  ['card: dead hover (edge inline again)', "<div class=\"lvcard\" data-open=\"${e(m.ek)}\" style=\"background:var(--card);", "<div class=\"lvcard\" data-open=\"${e(m.ek)}\" style=\"background:var(--card);border:1px solid transparent;"],
  ['sheet: opens on Stats', "setState({sel:ek,tab:'Ratings',scope:'MATCH',pset:1,hb:'HOLD'});", "setState({sel:ek,tab:'Stats',scope:'MATCH',pset:1,hb:'HOLD'});"],
  ['sheet: state carried between opens', "setState({sel:ek,tab:'Ratings',scope:'MATCH',pset:1,hb:'HOLD'});", "setState({sel:ek});"],
  ['sheet: no Esc', "if(ev.key==='Escape'&&ST.sel!=null", "if(ev.key==='Esc'&&ST.sel!=null"],
  ['sheet: "· serving" while interrupted', "(m.serving===side&&liveM?' · serving':'')", "(m.serving===side?' · serving':'')"],
  ['stats: only MATCH + the current set', ".concat(m.sets.map((_,i)=>({id:i+1,per:'set'+(i+1),label:'SET '+(i+1),name:'Set '+(i+1)})))", ".concat([{id:m.sets.length,per:'set'+m.sets.length,label:'SET '+m.sets.length,name:'Set '+m.sets.length}])"],
  ['stats: lead colour inverted', "aColor:aNull?MISS:(aLead?INK:'var(--text-soft)')", "aColor:aNull?MISS:(aLead?'var(--text-soft)':INK)"],
  ['points: tiebreak summary row shown as a game', "&&!(tbLogged&&isTbGame(gm)))", ")"],
  ['points: the 7–6 row keeps its LOST SERVE', "lost:!!gm.serve_lost&&!isTbGame(gm),", "lost:!!gm.serve_lost,"],
  ['points: MP never tagged', "const tag = setsBefore[lead] + 1 >= need ? 'MP' : 'SP';", "const tag = 'SP';"],
  ['points: a garbled last entry is lifted', "win:decided&&pi===pts.length-1&&winsFrom(pt),", "win:decided&&pi===pts.length-1,"],
  ['momentum: the tiebreak summary plotted', "!isTiebreakRow(gm) && !isTbGame(gm) && momDecided(gm)", "!isTiebreakRow(gm) && momDecided(gm)"],
  ['momentum: a garbled last entry labelled', "const label=!readable?'':(deuce?'AD':sv[0]+'-'+sv[1]);", "const label=deuce?'AD':sv[0]+'-'+sv[1];"],
  ['break/hold: num/den under the rate', "const sub=(c.gap!=null&&HBE())?HBE().gapText(c.gap):c.frac;", "const sub=c.frac;"],
  ['break/hold: HOLD / BREAK back on card tone', "const TRACK = 'display:inline-flex;gap:3px;background:var(--inner);", "const TRACK = 'display:inline-flex;gap:3px;background:var(--card);"],
  ['colour: player name in blue on the heatmap', "<span style=\"font-size:14px;font-weight:700;color:var(--text);\">${e(hp.name)}</span>", "<span style=\"font-size:14px;font-weight:700;color:var(--bar);\">${e(hp.name)}</span>"],
  ['colour: PTS back to --pos', "<span style=\"width:40px;text-align:right;${MONO}font-size:15px;font-weight:700;color:var(--text);\">${e(m.point[side])}</span>", "<span style=\"width:40px;text-align:right;${MONO}font-size:15px;font-weight:700;color:var(--pos);\">${e(m.point[side])}</span>"],
  ['review: Slam qualifying read as best-of-five', "&& String(fix.event_qualification).toLowerCase() !== 'true' ? 5 : 3;", "? 5 : 3;"],
  ['review: 10-point deciding tiebreak only in a best-of-five', "const target=(m.slam&&setNum===m.bo)?10:7;", "const target=(m.bo===5&&setNum===5)?10:7;"],
  ['review: tiebreak point winner from the running score', "const aWon=(aServes||bServes)?(aServes?gm.serve_lost==null:gm.serve_lost!=null):a>prev[0];", "const aWon=a>prev[0];"],
  ['review: momentum says "no games" while the log loads', "${d.pbpLoading?'Loading the point log…':d.pbpError?'Point log unavailable right now.':'No completed games to plot yet.'}", "No completed games to plot yet."],
  ['R1 fix 1: rail badge counts every underway match', "paint(p && typeof p.inPlay === 'number' ? p.inPlay : 0);", "paint(p && Array.isArray(p.live) ? p.live.length : 0);"],
  ['R1 fix 1: the page reads its own interrupted regex, not live-tab.js', "const interrupted = (LF() && typeof LF().isInterrupted === 'function') ? LF().isInterrupted(fix) : INTERRUPTED_RE.test(statusRaw);", "const interrupted = /interrupt/i.test(statusRaw);"],
  ['R1 fix 2: bars back to value out of 100', "const share=v=>(tot<=0||!v)?'0%':(v/tot*100).toFixed(1)+'%';\n    const aW=share(aV), bW=share(bV);", "const share=v=>(tot<=0||!v)?'0%':Math.min(100,v).toFixed(1)+'%';\n    const aW=share(aV), bW=share(bV);"],
  ['R1 fix 2: a missing side hands the other a full bar', "    const tot=(aNull||bNull)?0:aV+bV;\n    const share", "    const tot=(aNull?0:aV)+(bNull?0:bV);\n    const share"],
  ['R1 fix 6: 1st serve % without its count', "const one=/^1st serve percentage$/i.test(name);", "const one=false;"],
  ['R1 fix 7: point list verbatim', ":lvDecodePoints(gm.points,decided?aWonG:null);", ":(gm.points||[]).filter(ptScored);"],
  ['review: a log joining mid-game drops every chip', "if(pts.length&&ptState(pts[0])&&!ptReach(prev,ptState(pts[0]))){", "if(false){"],
  ['R1 fix 7: no walk past the prefix (lift lost on deuce games)', "if(winnerA==null||ptGamePoint(prev,winnerA)) return kept;", "return kept;"],
  ['R1 ruling: serve dot on an interrupted card', "background:${m.serving===side&&live?'var(--serve-ball)'", "background:${m.serving===side?'var(--serve-ball)'"],
  ['R2 fix 2: BP back to the feed flag', "bp:(()=>{ const st=ptState(pt); if(!st||!(aServ||bServ)) return false;", "bp:pt.break_point!=null&&String(pt.break_point).trim()!=='',bpX:(()=>{ const st=ptState(pt); if(!st||!(aServ||bServ)) return false;"],
  ['R2 fix 2: BP on deuce too', "return rc===4||(rc===3&&sv<=2); })(),", "return rc===4||(rc===3&&sv<=3); })(),"],
  ['R2 fix 4: no 0:0 chip', "const pts=(!isTbGame(gm)&&dec.length&&ptReach([0,0],ptState(dec[0])))?[{score:'0 - 0'}].concat(dec):dec;", "const pts=dec;"],
  ['photos back on the cards', "    ${avaHtml(lvIni(m.names[side]),30,11)}\n", "    <img src=\"x\" alt=\"\">\n"],
];
const SUITES = ['test-ten417-live.mjs'];
const run = env => spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, env), encoding: 'utf8', timeout: 60000 });
// Control: the unmutated file must pass, or every "caught" below means nothing.
if (run({}).status !== 0) { console.error('✖ the suite is red on the unmutated file — mutants are meaningless'); process.exit(1); }
console.log('✔ control: the unmutated file passes');
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten417-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (src.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, src.replace(from, to));
  if (run({ TEN417_HTML: file }).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
