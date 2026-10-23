// Initialize the newly added search service for this local fixture workspace.
// Rebuilds derived search entries only; no source messages/files are removed.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-accounts.local.json'), 'utf8'))
if (state.url !== 'http://huly-review.local:18087' || !state.workspaceUrl) throw new Error('Not an isolated review fixture')
const input = `
const owner = ${JSON.stringify(state.accounts.owner)};
const workspaceUrl = ${JSON.stringify(state.workspaceUrl)};
async function rpc(method,params,token){const r=await fetch('http://account:3000',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({method,params})});const j=await r.json();if(j.error)throw new Error(method+' failed');return j.result;}
(async()=>{const login=await rpc('login',{email:owner.email,password:owner.password});const ws=await rpc('selectWorkspace',{workspaceUrl,kind:'external'},login.token);const r=await fetch('http://localhost:4702/api/v1/reindex',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ws.token},body:JSON.stringify({onlyDrop:false}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('Local reindex HTTP '+r.status);console.log('PASS: local fixture search initialization requested');})().catch(e=>{console.error(e.message);process.exitCode=1});
`
const result = execFileSync('docker', ['compose', '-f', path.join(__dirname, 'huly.compose.local.json'), 'exec', '-T', 'fulltext_cockroach', 'node'], { input, encoding: 'utf8', timeout: 45000 })
process.stdout.write(result)
