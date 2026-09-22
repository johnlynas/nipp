
const fs = require('fs');
function parseEnvFile(filePath){
  const result={};
  const content=fs.readFileSync(filePath,'utf8');
  for(const line of content.split('\n')){
    const trimmed=line.trim();
    if(!trimmed||trimmed.startsWith('#'))continue;
    const eqIndex=trimmed.indexOf('=');
    if(eqIndex===-1)continue;
    const key=trimmed.slice(0,eqIndex).trim();
    let value=trimmed.slice(eqIndex+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    result[key]=value;
  }
  return result;
}
const v=parseEnvFile('/Users/johnlynas/dev/nipp-0807/.env.test');
let ok=true;
for(const k of Object.keys(v)){
  if(/^RATE_LIMIT_/.test(k) && !/^\d+$/.test(v[k])){ console.log('BAD', k, JSON.stringify(v[k])); ok=false; }
}
for (const k of ['POSTGRES_PORT','NIPP_APP_DB_PASSWORD','SEED_RLS_DSN','DATABASE_URL']) {
  const val=v[k];
  console.log(k, val ? 'set (len '+val.length+')' : 'MISSING');
}
console.log('PGBOUNCER_PASSWORD present:', 'PGBOUNCER_PASSWORD' in v);
console.log('all RATE_LIMIT clean:', ok);
