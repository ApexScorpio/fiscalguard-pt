'use strict';

// Recolhas AT no computador do titular. Dados pessoais NUNCA enviados
// para GitHub Actions, GitHub artefactos, telemetria ou stdout.
const fs=require('node:fs');
const path=require('node:path');
const {executePs}=require('./at-vault');

const FILE='D:\\AssistenteFiscal\\Dados\\FiscalGuard\\AT-registos.dpapi';
const MAX_RECORDS=1000;
const MAX_BYTES=4*1024*1024;
const FIELDS=Object.freeze({
  atMessages:['listaMensagens','mensagens','messages','dataFromResponseList'],
  atAlerts:['listaAlertas','alertas','alerts','dataFromResponseList'],
  atInteractions:['listaInteracoes','interacoes','interactions','dataFromResponseList'],
  atDebts:['dataFromResponseList','listaDividas','dividas','debts'],
  atFines:['dataFromResponseList','listaCoimas','coimas','fines']
});
// Estes campos nunca devem ser incorporados numa captura, mesmo que
// apareçam inesperadamente numa resposta JSON da AT.
const SECRET=/^(?:password|passwd|pass|senha|palavra.?passe|nif|niss|token|access.?token|refresh.?token|authorization|cookie|set.?cookie|secret|session|sessionid|csrf|xsrf|chave.?privada|private.?key)$/i;
function safeValue(v,depth=0) {
  if(v===null || typeof v==='boolean')return v;
  if(typeof v==='number')return Number.isFinite(v)?v:null;
  if(typeof v==='string')return v.slice(0,3000);
  if(depth>=5)return null;
  if(Array.isArray(v))return v.slice(0,MAX_RECORDS).map(x=>safeValue(x,depth+1));
  if(typeof v==='object') {
    const obj={};
    for(const [key,value] of Object.entries(v).slice(0,100)){
      if(SECRET.test(key)||key.startsWith('__'))continue;
      obj[key.slice(0,100)]=safeValue(value,depth+1);
    }
    return obj;
  }
  return null;
}
function recordsFromPayload(kind,data) {
  if(!Object.hasOwn(FIELDS,kind))return {status:'unsupported',count:null,records:[]};
  if(!data || typeof data!=='object'||data.error||data.errors||data.unauthorized)
    return {status:'unverified',count:null,records:[]};
  let list=Array.isArray(data)?data:null;
  if(!list){
    for(const key of FIELDS[kind]){
      if(Array.isArray(data[key])){list=data[key];break;}
    }
  }
  if(!list)return {status:'unverified',count:null,records:[]};
  return {
    status:list.length?'records':'empty',
    count:list.length,
    records:list.slice(0,MAX_RECORDS).map(x=>safeValue(x)),
    truncated:list.length>MAX_RECORDS
  };
}
function bundleFromInspection(inspected,capturedAt=new Date().toISOString()){
  const sections={};
  const input=inspected?.recordPayloads||{};
  for(const kind of Object.keys(FIELDS)){
    if(Object.hasOwn(input,kind)){
      sections[kind]=recordsFromPayload(kind,input[kind]);
    }else{
      sections[kind]={status:'unverified',count:null,records:[]};
    }
  }
  return {
    version:1,source:'authenticated-at-capture',capturedAt,
    sections
  };
}
function displayValue(v) {
  if(v===null||v===undefined)return '';
  if(typeof v==='object')return JSON.stringify(v).slice(0,3000);
  return String(v).slice(0,3000);
}
function displayRows(bundle) {
  const sections={};
  for(const kind of Object.keys(FIELDS)){
    const raw=bundle?.sections?.[kind];
    const status=['records','empty','unverified'].includes(raw?.status)?raw.status:'unverified';
    const count=status==='unverified'?null:
      Number.isSafeInteger(raw?.count)&&raw.count>=0?raw.count:null;
    const items=status==='records'&&Array.isArray(raw.records)?raw.records.slice(0,MAX_RECORDS):[];
    sections[kind]={
      status,count,
      truncated:Boolean(raw?.truncated),
      items:items.map((entry,i)=>{
        const data=entry&&typeof entry==='object'&&!Array.isArray(entry)?entry:{valor:entry};
        return {
          id:i+1,
          fields:Object.entries(data).slice(0,50).map(([key,value])=>({
            label:key.slice(0,100),value:displayValue(value)
          })).filter(x=>x.value!=='')
        };
      })
    };
  }
  return {capturedAt:bundle?.capturedAt||null,sections};
}
function validateBundle(input) {
  if(!input||input.version!==1||input.source!=='authenticated-at-capture'||
    !Number.isFinite(Date.parse(input.capturedAt)))throw Error('Formato da recolha AT inválido');
  if(!input.sections||typeof input.sections!=='object'||Array.isArray(input.sections))
    throw Error('Secções AT em falta');
  const result={version:1,source:input.source,capturedAt:new Date(input.capturedAt).toISOString(),sections:{}};
  for(const kind of Object.keys(FIELDS)){
    const section=input.sections[kind]||{};
    const status=['records','empty','unverified'].includes(section.status)?section.status:'unverified';
    const records=status==='records'&&Array.isArray(section.records)?
      section.records.slice(0,MAX_RECORDS).map(x=>safeValue(x)):[];
    const count=status==='unverified'?null:
      Number.isSafeInteger(section.count)&&section.count>=records.length?section.count:null;
    result.sections[kind]={status:count===null?'unverified':status,count,
      truncated:Boolean(section.truncated)||count>MAX_RECORDS,records};
  }
  if(Buffer.byteLength(JSON.stringify(result),'utf8')>MAX_BYTES)throw Error('Recolha AT demasiado extensa');
  return result;
}
function makeRecordStore({filename=FILE,runner=executePs,platform=process.platform}={}) {
  if(!path.win32.isAbsolute(filename)||!/^[D-S]:\\/i.test(filename)||
    /['\r\n]/.test(filename))throw Error('Os registos têm de ficar fora do disco C:');
  const file="'"+filename+"'";
  return {
    available:()=>platform==='win32',
    has:()=>platform==='win32'&&fs.existsSync(filename),
    async save(input) {
      if(platform!=='win32')throw Error('DPAPI Windows necessário');
      const bundle=validateBundle(input);
      const script=[
        "$ErrorActionPreference='Stop'",
        'Add-Type -AssemblyName System.Security',
        '$file='+file,
        '$stdin=[Console]::OpenStandardInput()',
        '$buffer=New-Object IO.MemoryStream',
        '$stdin.CopyTo($buffer)',
        '$clear=$buffer.ToArray()',
        '$buffer.Dispose()',
        '$folder=[IO.Path]::GetDirectoryName($file)',
        '[IO.Directory]::CreateDirectory($folder)|Out-Null',
        '$tmp=[IO.Path]::Combine($folder,[IO.Path]::GetRandomFileName())',
        'try {',
        '  $blob=[Security.Cryptography.ProtectedData]::Protect($clear,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
        '  [IO.File]::WriteAllBytes($tmp,$blob)',
        '  if([IO.File]::Exists($file)){[IO.File]::Replace($tmp,$file,$null)}',
        '  else {[IO.File]::Move($tmp,$file)}',
        '  $out=[Console]::OpenStandardOutput()',
        "  $done=[Text.Encoding]::UTF8.GetBytes('OK')",
        '  $out.Write($done,0,$done.Length)',
        '} finally {',
        '  [Array]::Clear($clear,0,$clear.Length)',
        '  if([IO.File]::Exists($tmp)){[IO.File]::Delete($tmp)}',
        '}'
      ].join('\n');
      const result=await runner(script,JSON.stringify(bundle));
      if(result!=='OK')throw Error('Não foi possível confirmar a cifragem');
      return {saved:true,capturedAt:bundle.capturedAt};
    },
    async read() {
      if(!this.has())return null;
      if(fs.statSync(filename).size>MAX_BYTES+8192)throw Error('Arquivo AT excede limite');
      const script=[
        "$ErrorActionPreference='Stop'",
        'Add-Type -AssemblyName System.Security',
        '$file='+file,
        '$blob=[IO.File]::ReadAllBytes($file)',
        '$clear=[Security.Cryptography.ProtectedData]::Unprotect($blob,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
        'try {',
        '  $out=[Console]::OpenStandardOutput()',
        '  $out.Write($clear,0,$clear.Length)',
        '} finally {[Array]::Clear($clear,0,$clear.Length)}'
      ].join('\n');
      const content=await runner(script,'',MAX_BYTES+8192);
      return validateBundle(JSON.parse(content));
    }
  };
}
module.exports={FIELDS,MAX_RECORDS,recordsFromPayload,bundleFromInspection,
  displayRows,validateBundle,makeRecordStore,recordStore:makeRecordStore()};
