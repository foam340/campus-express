const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const source = fs.readFileSync(path.join(__dirname,'../server/src/routes/admin.js'),'utf8')
const routes = new Map()
const router = {use(){}}
for(const method of ['get','post','put','delete'])router[method]=(route,...handlers)=>routes.set(method+':'+route,handlers.at(-1))
const statements=[]
const row={auto_confirm_hours:72,observation_hours:24,claim_limit:200,campus:'nanhai'}
const db={async execute(sql,values){
  statements.push({sql,values})
  if(sql.startsWith('SELECT'))return [[{id:1,...row}]]
  if(sql.includes('auto_confirm_hours = ?'))Object.assign(row,{auto_confirm_hours:values[0],observation_hours:values[1],claim_limit:values[2]})
  return [{affectedRows:3}]
}}
const root=path.resolve(__dirname,'../server/src')
vm.runInNewContext(source,{
  module:{exports:{}},console,
  require(name){
    if(name==='express')return {Router:()=>router}
    if(name==='../db')return {pool:db,transaction:handler=>handler(db)}
    if(name==='../auth')return {authenticateAdmin(){},requireRoles:()=>()=>{}}
    if(name==='../idempotency')return {requireIdempotency(){},sendIdempotent:(request,response,data)=>response.json(data)}
    if(name==='../audit')return {writeAudit:async()=>{}}
    if(['../validation','../http','../campus-config'].includes(name))return require(path.resolve(root,name.slice(3)))
    return {}
  }
})
function invoke(route,body){
  return new Promise((resolve,reject)=>routes.get(route)({body,admin:{id:1}}, {json:resolve,status(){return this}},reject))
}
async function main(){
  for(const endpoint of ['put:/settings/operational','put:/settings'])for(const autoConfirmHours of [undefined,1,72,'invalid']){
    statements.length=0
    const result=await invoke(endpoint,{autoConfirmHours,observationHours:36,claimLimit:150,serviceStatus:'open',serviceNotice:''})
    assert.equal(result.autoConfirmHours,12)
    assert.equal(row.auto_confirm_hours,12)
    assert.equal(row.observation_hours,36)
    assert.equal(row.claim_limit,150)
    const update=statements.find(item=>item.sql.includes('auto_confirm_hours = ?'))
    assert.equal(update.values[0],12,'Old clients cannot change the fixed completion window')
    assert(!update.sql.includes('review_mode'),'Saving operational settings must not change review mode')
  }
  const admin=fs.readFileSync(path.join(__dirname,'../admin-web/src/app.js'),'utf8')
  assert(!admin.includes('name="autoConfirmHours"'))
  assert(!admin.includes("form.get('autoConfirmHours')"))
  const mini=fs.readFileSync(path.join(__dirname,'../server/src/routes/mini.js'),'utf8')
  assert(mini.includes("SET status = 'completed', completed_at = DATE_ADD(delivered_at, INTERVAL 12 HOUR)"))
  console.log('Operational settings checks passed: both write routes force 12 hours, old clients remain compatible, other settings and review mode preserved.')
}
main().catch(error=>{console.error(error);process.exitCode=1})
