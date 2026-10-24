'use strict';
// Cofre AT: DPAPI CurrentUser no disco D:, sem passwords em JSON ou GitHub.
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');

const BASE='D:\\AssistenteFiscal\\Dados\\FiscalGuard';
const DEFAULT_FILE=path.win32.join(BASE,'AT-credenciais.dpapi');
const TEMP='D:\\AssistenteFiscal\\Temporarios';

function validCredentials(v) {
  return Boolean(v && typeof v==='object' && !Array.isArray(v) &&
    typeof v.nif==='string' && /^\d{9}$/.test(v.nif) &&
    typeof v.password==='string' && v.password.length>=1 &&
    v.password.length<=256 && !/[\r\n]/.test(v.password));
}

function pathLiteral(p) {
  if (!path.win32.isAbsolute(p) || !/^[D-S]:\\/i.test(p) ||
      p.includes("'") || p.includes('\r') || p.includes('\n')) {
    throw new Error('Cofre deve ficar noutra unidade, nunca em C:');
  }
  return "'"+p+"'";
}

function executePs(script,input='') {
  if (process.platform!=='win32') {
    return Promise.reject(new Error('DPAPI disponível apenas no Windows'));
  }
  const exe=path.join(process.env.SystemRoot || 'C:\\Windows',
    'System32','WindowsPowerShell','v1.0','powershell.exe');
  fs.mkdirSync(TEMP,{recursive:true});
  const encoded=Buffer.from(script,'utf16le').toString('base64');
  return new Promise((resolve,reject)=>{
    const proc=spawn(exe,
      ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded],
      {windowsHide:true,stdio:['pipe','pipe','pipe'],
       env:{...process.env,TEMP,TMP:TEMP,TMPDIR:TEMP}});
    let output='', stderr='';
    let settled=false;
    const rejectOnce=()=>{if(!settled){settled=true;reject(new Error('Motor DPAPI indisponível ou falhou'));}};
    proc.on('error',rejectOnce);
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data',v=>{
      output+=v;
      if(output.length>8192)proc.kill();
    });
    proc.stderr.on('data',v=>{
      stderr+=String(v).slice(0,process.env.GITHUB_ACTIONS==='true'?10000:100);
      stderr=stderr.slice(0,process.env.GITHUB_ACTIONS==='true'?10000:500);
    });
    proc.on('close',code=>{
      if(code!==0) {
        // Somente nos runners efémeros, com credenciais fictícias de teste.
        // Nunca emitir texto de erros do cofre no computador do utilizador.
        if(process.env.GITHUB_ACTIONS==='true') {
          console.error('CI_DPAPI_DADOS_TECNICOS:',stderr.slice(0,3500));
        }
        return rejectOnce();
      }
      if(!settled){settled=true;resolve(output.trim());}
    });
    proc.stdin.end(input,'utf8'); // credenciais exclusivamente por stdin
  });
}

function makeVault({filename=DEFAULT_FILE,runner=executePs}={}) {
  const file=pathLiteral(filename);
  return {
    available() {return process.platform==='win32';},
    has() {return process.platform==='win32' && fs.existsSync(filename);},
    async save(credentials) {
      if(!validCredentials(credentials))throw new Error('Credenciais AT inválidas');
      const script=[
        "$ErrorActionPreference='Stop'",
        "Add-Type -AssemblyName System.Security",
        "$file="+file,
        "$stdin=[Console]::OpenStandardInput()",
        "$memory=New-Object IO.MemoryStream",
        "$stdin.CopyTo($memory)",
        "$clear=$memory.ToArray()",
        "$memory.Dispose()",
        "try {",
        "  $blob=[Security.Cryptography.ProtectedData]::Protect(",
        "    $clear,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
        "  $folder=[IO.Path]::GetDirectoryName($file)",
        "  [IO.Directory]::CreateDirectory($folder)|Out-Null",
        "  [IO.File]::WriteAllBytes($file,$blob)",
        "  $ok=[Text.Encoding]::UTF8.GetBytes('OK')",
        "  $out=[Console]::OpenStandardOutput()",
        "  $out.Write($ok,0,$ok.Length)",
        "} finally {",
        "  [Array]::Clear($clear,0,$clear.Length)",
        "}"
      ].join('\n');
      const result=await runner(script,JSON.stringify({
        nif:credentials.nif,password:credentials.password
      }));
      if(result!=='OK')throw new Error('Confirmação DPAPI em falta');
      return {saved:true};
    },
    async read() {
      if(!this.has())return null;
      const script=[
        "$ErrorActionPreference='Stop'",
        "Add-Type -AssemblyName System.Security",
        "$file="+file,
        "$blob=[IO.File]::ReadAllBytes($file)",
        "$clear=[Security.Cryptography.ProtectedData]::Unprotect(",
        "  $blob,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
        "try {",
        "  $out=[Console]::OpenStandardOutput()",
        "  $out.Write($clear,0,$clear.Length)",
        "} finally {",
        "  [Array]::Clear($clear,0,$clear.Length)",
        "}"
      ].join('\n');
      const plain=await runner(script,'');
      let cred;
      try {cred=JSON.parse(plain);}catch {throw new Error('Conteúdo cifrado inválido');}
      if(!validCredentials(cred))throw new Error('Cofre inválido');
      return cred;
    }
  };
}

module.exports={makeVault,vault:makeVault(),validCredentials,DEFAULT_FILE};
