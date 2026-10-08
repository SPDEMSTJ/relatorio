const TYPES = new Set(['honoraria', 'anestesia', 'A', 'B', 'C']);
const TTL = 3600;
const random = () => crypto.randomUUID() + crypto.randomUUID();
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type':'application/json','Cache-Control':'no-store'}});
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
}
export function validateUpload(tipo, vigencia, csv) {
  if (!TYPES.has(tipo)) throw new Error('Tipo de tabela inválido.');
  if (!validDate(vigencia)) throw new Error('Vigência inválida.');
  if (!csv.trim() || new TextEncoder().encode(csv).length > 15*1024*1024) throw new Error('CSV vazio ou acima de 15 MB.');
  if (csv.includes('\0') || !/[;,\t]/.test(csv)) throw new Error('Arquivo CSV inválido.');
  if (tipo === 'anestesia') {
    if (!/PORTES?\s+ANEST[EÉ]SICOS?/i.test(csv) || !/VALOR/i.test(csv)) throw new Error('Cabeçalho da anestesiologia não encontrado.');
  } else if (!/C[ÓO]DIGO/i.test(csv) || !/DESCRI[ÇC][ÃA]O/i.test(csv)) throw new Error('Cabeçalho de códigos/descrição não encontrado.');
  if (['A','B','C'].includes(tipo)) {
    const matches=[...csv.matchAll(/TIPO\s*[“"']?\s*([ABC])\b/gi)];
    if (!matches.length || matches.some(m=>m[1].toUpperCase()!==tipo)) throw new Error('O tipo hospitalar do conteúdo não corresponde ao campo selecionado.');
  }
  return {tipo,ano:vigencia.slice(0,4),vigencia};
}
function base64(bytes) {
  let s='';for(const byte of bytes)s+=String.fromCharCode(byte);return btoa(s);
}
async function github(env, token, path, options={}) {
  const response=await fetch('https://api.github.com'+path,{...options,headers:{'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'PEG-Tabelas-Teste',...(options.body?{'Content-Type':'application/json'}:{})}});
  if(!response.ok)throw new Error(response.status===403?'GitHub recusou a operação. Confira as permissões da aplicação.':response.status===422||response.status===409?'O repositório mudou durante a publicação. Confira e tente novamente.':'Falha na comunicação com o GitHub ('+response.status+').');
  return response.status===204?null:response.json();
}
async function session(request, env) {
  const token=request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  const data=token?await env.SESSIONS.get('session:'+token,'json'):null;
  if(!data || data.expires<Date.now())throw new Error('Entre novamente com GitHub.');
  return data;
}
export async function publish(env, token, entry, csv, replace=false) {
  const repo='/repos/'+env.REPOSITORY;
  const ref=await github(env,token,repo+'/git/ref/heads/'+env.BRANCH);
  const commit=await github(env,token,repo+'/git/commits/'+ref.object.sha);
  let catalog={versao:1,tabelas:[]};
  try {
    const response=await fetch('https://api.github.com'+repo+'/contents/tabelas-teste/catalogo.json?ref='+ref.object.sha,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github.raw+json','User-Agent':'PEG-Tabelas-Teste'}});
    if(response.status!==404){if(!response.ok)throw new Error('Não foi possível ler o catálogo.');catalog=await response.json();}
  }catch{throw new Error('Não foi possível ler o catálogo de teste.');}
  if(catalog.versao!==1 || !Array.isArray(catalog.tabelas))throw new Error('Catálogo de teste inválido.');
  const exists=catalog.tabelas.some(t=>t.tipo===entry.tipo&&t.ano===entry.ano);
  if(exists&&!replace)return {conflict:true};
  const path=`tabelas-teste/${entry.tipo}-${entry.ano}.csv`;
  const published={...entry,arquivo:path,publicadoEm:new Date().toISOString()};
  catalog.tabelas=catalog.tabelas.filter(t=>!(t.tipo===entry.tipo&&t.ano===entry.ano)).concat(published);
  const blob=await github(env,token,repo+'/git/blobs',{method:'POST',body:JSON.stringify({content:base64(new TextEncoder().encode(csv)),encoding:'base64'})});
  const tree=await github(env,token,repo+'/git/trees',{method:'POST',body:JSON.stringify({base_tree:commit.tree.sha,tree:[{path,mode:'100644',type:'blob',sha:blob.sha},{path:'tabelas-teste/catalogo.json',mode:'100644',type:'blob',content:JSON.stringify(catalog,null,2)+'\n'}]})});
  const created=await github(env,token,repo+'/git/commits',{method:'POST',body:JSON.stringify({message:`Publica tabela de teste ${entry.tipo} ${entry.ano} — vigência ${entry.vigencia}`,tree:tree.sha,parents:[ref.object.sha]})});
  await github(env,token,repo+'/git/refs/heads/'+env.BRANCH,{method:'PATCH',body:JSON.stringify({sha:created.sha,force:false})});
  return {ok:true,commit:created.sha,url:`https://github.com/${env.REPOSITORY}/commit/${created.sha}`};
}
async function handle(request,env) {
  const url=new URL(request.url),path=url.pathname;
  if(path==='/auth/login') {
    if(env.GITHUB_CLIENT_ID==='PREENCHER')return json({error:'Configure a GitHub App antes de entrar.'},503);
    const state=random();await env.SESSIONS.put('state:'+state,'1',{expirationTtl:600});
    const target=new URL('https://github.com/login/oauth/authorize');target.searchParams.set('client_id',env.GITHUB_CLIENT_ID);target.searchParams.set('state',state);target.searchParams.set('redirect_uri',url.origin+'/auth/callback');
    return new Response(null,{status:302,headers:{Location:target.href,'Set-Cookie':`peg_oauth=${state}; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=600`,'Cache-Control':'no-store'}});
  }
  if(path==='/auth/callback') {
    const state=url.searchParams.get('state');
    const cookie=request.headers.get('cookie')?.match(/(?:^|;\s*)peg_oauth=([^;]+)/)?.[1];
    if(!state||state!==cookie||!await env.SESSIONS.get('state:'+state))return json({error:'Autenticação inválida ou expirada.'},400);
    await env.SESSIONS.delete('state:'+state);
    const response=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code:url.searchParams.get('code'),redirect_uri:url.origin+'/auth/callback'})});
    const result=await response.json();if(!response.ok||!result.access_token)throw new Error('GitHub não concluiu a autenticação.');
    const user=await github(env,result.access_token,'/user');
    if(user.login.toLowerCase()!==env.ALLOWED_LOGIN.toLowerCase())return json({error:'Esta conta não está autorizada a publicar tabelas.'},403);
    const ticket=random();await env.SESSIONS.put('ticket:'+ticket,JSON.stringify({githubToken:result.access_token,login:user.login,expires:Date.now()+TTL*1000}),{expirationTtl:60});
    return new Response(null,{status:302,headers:{Location:env.TEST_PAGE+'#ticket='+ticket,'Set-Cookie':'peg_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=0','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  }
  if(request.headers.get('Origin')!==env.SITE_ORIGIN)return json({error:'Origem não autorizada.'},403);
  if(path==='/api/exchange'&&request.method==='POST') {
    const {ticket}=await request.json();if(typeof ticket!=='string'||ticket.length>100)return json({error:'Entrada inválida.'},400);
    const data=await env.SESSIONS.get('ticket:'+ticket);if(!data)return json({error:'Autenticação expirada. Entre novamente.'},401);
    await env.SESSIONS.delete('ticket:'+ticket);const key=random();await env.SESSIONS.put('session:'+key,data,{expirationTtl:TTL});return json({token:key,login:JSON.parse(data).login});
  }
  if(path==='/api/logout'&&request.method==='POST') {
    const key=request.headers.get('Authorization')?.replace(/^Bearer /,'');if(key)await env.SESSIONS.delete('session:'+key);return json({ok:true});
  }
  if(path==='/api/publish'&&request.method==='POST') {
    const login=await session(request,env);
    if(Number(request.headers.get('Content-Length'))>16*1024*1024)return json({error:'Arquivo acima do limite.'},413);
    const form=await request.formData(),file=form.get('file');if(!file||typeof file.text!=='function'||file.size>15*1024*1024)return json({error:'Selecione um CSV de até 15 MB.'},400);
    const csv=await file.text(),entry=validateUpload(form.get('tipo'),form.get('vigencia'),csv);
    return json(await publish(env,login.githubToken,entry,csv,form.get('replace')==='true'));
  }
  return json({error:'Endereço não encontrado.'},404);
}
export default {async fetch(request,env) {
  let response;
  if(request.method==='OPTIONS')response=new Response(null,{status:204});
  else try{response=await handle(request,env);}catch(e){response=json({error:e.message},400);}
  const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
  if(request.headers.get('Origin')===env.SITE_ORIGIN){headers.set('Access-Control-Allow-Origin',env.SITE_ORIGIN);headers.set('Vary','Origin');headers.set('Access-Control-Allow-Headers','Authorization, Content-Type');headers.set('Access-Control-Allow-Methods','POST, OPTIONS');}
  return new Response(response.body,{status:response.status,headers});
}};
