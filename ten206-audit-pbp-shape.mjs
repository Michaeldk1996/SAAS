import fs from 'fs';
const KEY=fs.readFileSync('/Users/Michael/bsp-consult-project/.env','utf8').match(/API_TENNIS_KEY=(\S+)/)[1];
const B='https://api.api-tennis.com/tennis/';
let req=0;
const call=async p=>{req++;return (await (await fetch(`${B}?method=get_fixtures&APIkey=${KEY}&${p}`)).json()).result||[];};
for (const [a,b] of [['2023-09-05','2023-09-14'],['2026-09-05','2026-09-14']]) {
  const res=await call(`date_start=${a}&date_stop=${b}&event_type_key=265`);
  const fin=res.filter(m=>String(m.event_status||'').toLowerCase()==='finished');
  const wp=fin.filter(m=>(m.pointbypoint||[]).length);
  console.log(`\n=== ${a} finished=${fin.length} withPbp=${wp.length}`);
  const s=wp[0];
  if(s){
    console.log('fixture:', s.event_first_player,'vs',s.event_second_player, s.event_final_result);
    const set1=s.pointbypoint[0];
    console.log('pbp entry keys:', Object.keys(set1));
    console.log('set label:', set1.set_number, 'games:', (set1.player_service||'')+'' );
    console.log(JSON.stringify(set1).slice(0,900));
  }
}
console.log('\nrequests',req);
