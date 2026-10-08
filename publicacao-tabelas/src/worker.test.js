import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{validateUpload,publish} from './worker.js';
function environment() {
 const items=new Map();return {SITE_ORIGIN:'https://samuelcnovaes.github.io',TEST_PAGE:'https://samuelcnovaes.github.io/Relatorio_PEG/Teste-publicacao.html',REPOSITORY:'samuelcnovaes/Relatorio_PEG',BRANCH:'main',ALLOWED_LOGIN:'samuelcnovaes',GITHUB_CLIENT_ID:'test',SESSIONS:{get:async(k,format)=>{const v=items.get(k);return v&&format==='json'?JSON.parse(v):v;},put:async(k,v)=>items.set(k,v),delete:async k=>items.delete(k)}};
}
test('rejects wrong type, invalid date and empty CSV',()=>{
 assert.throws(()=>validateUpload('B','2027-03-01','TIPO A;\nCÓDIGO;DESCRIÇÃO;VALOR\n98104006;Sala;100'));
 assert.throws(()=>validateUpload('A','2027-02-30','TIPO A;CÓDIGO;DESCRIÇÃO;VALOR'));
 assert.throws(()=>validateUpload('honoraria','2027-03-01',''));
 assert.deepEqual(validateUpload('A','2027-03-01','TIPO A;\nCÓDIGO;DESCRIÇÃO;VALOR\n98104006;Sala;100'),{tipo:'A',ano:'2027',vigencia:'2027-03-01'});
});
test('rejects publication without a session and unauthorized origin',async()=>{
 const env=environment();let response=await worker.fetch(new Request('https://worker.test/api/publish',{method:'POST',headers:{Origin:env.SITE_ORIGIN}}),env);
 assert.equal(response.status,400);assert.match((await response.json()).error,/Entre novamente/);
 response=await worker.fetch(new Request('https://worker.test/api/exchange',{method:'POST',headers:{Origin:'https://other.test'},body:'{}'}),env);assert.equal(response.status,403);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
});
test('OAuth callback requires matching cookie and state',async()=>{
 const env=environment();await env.SESSIONS.put('state:abc','1');
 const response=await worker.fetch(new Request('https://worker.test/auth/callback?state=abc&code=123',{headers:{Cookie:'peg_oauth=different'}}),env);assert.equal(response.status,400);
});
test('one-time ticket exchanges without exposing GitHub token and logout invalidates session',async()=>{
 const env=environment();await env.SESSIONS.put('ticket:test',JSON.stringify({githubToken:'PRIVATE',login:'samuelcnovaes',expires:Date.now()+10000}));
 const req=()=>new Request('https://worker.test/api/exchange',{method:'POST',headers:{Origin:env.SITE_ORIGIN},body:JSON.stringify({ticket:'test'})});
 const response=await worker.fetch(req(),env),result=await response.json();assert.ok(result.token);assert.equal(result.githubToken,undefined);assert.equal((await worker.fetch(req(),env)).status,401);
 await worker.fetch(new Request('https://worker.test/api/logout',{method:'POST',headers:{Origin:env.SITE_ORIGIN,Authorization:'Bearer '+result.token}}),env);assert.equal(await env.SESSIONS.get('session:'+result.token),undefined);
});
test('publishes CSV and manifest atomically and never writes index.html',async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,options={})=>{
  calls.push({url,options});let body={};if(url.includes('/git/ref/'))body={object:{sha:'base'}};else if(url.includes('/git/commits/base'))body={tree:{sha:'tree'}};else if(url.includes('/contents/'))body={versao:1,tabelas:[]};else if(url.endsWith('/git/blobs'))body={sha:'blob'};else if(url.endsWith('/git/trees'))body={sha:'newtree'};else if(url.endsWith('/git/commits'))body={sha:'newcommit'};return new Response(JSON.stringify(body));
 };
 try {const result=await publish(environment(),'PRIVATE',{tipo:'A',ano:'2027',vigencia:'2027-03-01'},'CSV');assert.equal(result.ok,true);const tree=JSON.parse(calls.find(c=>c.url.endsWith('/git/trees')).options.body);assert.deepEqual(tree.tree.map(t=>t.path),['tabelas-teste/A-2027.csv','tabelas-teste/catalogo.json']);assert.equal(JSON.parse(calls.at(-1).options.body).force,false);}finally{globalThis.fetch=original;}
});
test('existing type and year requires explicit replacement',async()=>{
 const original=globalThis.fetch;let writes=0;globalThis.fetch=async(url,options={})=>{if(options.method)writes++;return new Response(JSON.stringify(url.includes('/git/ref/')?{object:{sha:'base'}}:url.includes('/git/commits/')?{tree:{sha:'tree'}}:{versao:1,tabelas:[{tipo:'A',ano:'2027'}]}));};
 try{assert.deepEqual(await publish(environment(),'token',{tipo:'A',ano:'2027',vigencia:'2027-03-01'},'CSV'),{conflict:true});assert.equal(writes,0);}finally{globalThis.fetch=original;}
});

test('accepts STJ Procedimentos header and hospital descriptions mentioning another type',()=>{
 assert.equal(validateUpload('honoraria','2027-03-01',';CÓDIGO;PROCEDIMENTOS;VALOR TOTAL EM R$;\n;1.01.01.012;Consulta;121,34;').tipo,'honoraria');
 assert.equal(validateUpload('A','2027-03-01','SERVIÇOS HOSPITALARES TIPO A;\nCÓDIGO;DESCRIÇÃO;VALOR\n98101003;DIÁRIA DE APTO TIPO B;100,00').tipo,'A');
 assert.throws(()=>validateUpload('honoraria','2027-03-01','CÓDIGO;DESCRIÇÃO;VALOR'));
});
