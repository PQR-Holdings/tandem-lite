const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const defaultRun = promisify(execFile);

async function jsonCommand(command, args, options = {}, runFile = defaultRun) {
  const { stdout } = await runFile(command, args, { maxBuffer: 4 * 1024 * 1024, ...options });
  const value = String(stdout).trim();
  return value ? JSON.parse(value) : {};
}

async function ps(script, env = {}, runFile = defaultRun) {
  return jsonCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, env: { ...process.env, ...env } }, runFile);
}

async function jxa(script, input = {}, runFile = defaultRun) {
  return jsonCommand('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, JSON.stringify(input)], {}, runFile);
}

const win32 = "$code=@'\nusing System; using System.Runtime.InteropServices; public static class AgentWindow { [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h,int n); [DllImport(\"user32.dll\")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l); }\n'@; if(-not ('AgentWindow' -as [type])){Add-Type -TypeDefinition $code};";

const macListWindows = `function run(argv){
  const input=JSON.parse(argv[0]),q=String(input.query||'').toLowerCase(),se=Application('System Events'),out=[];
  const processes=se.applicationProcesses.whose({visible:true})();
  for(let p=0;p<processes.length&&out.length<40;p++){let proc=processes[p],pid=proc.unixId(),name=proc.name(),wins=[];try{wins=proc.windows()}catch(e){}
    for(let i=0;i<wins.length&&out.length<40;i++){let title='';try{title=wins[i].name()}catch(e){};if(!q||String(title).toLowerCase().includes(q)||String(name).toLowerCase().includes(q))out.push({handle:String(pid)+':'+i,pid,title:String(title||name),process:String(name),windowIndex:i});}}
  return JSON.stringify({ok:true,windows:out,output:'Found '+out.length+' visible window(s).'});
}`;

const macWindowAction = `function run(argv){
  const input=JSON.parse(argv[0]),parts=String(input.handle).split(':'),pid=Number(parts[0]),index=Number(parts[1]||0),se=Application('System Events');
  const matches=se.applicationProcesses.whose({unixId:pid})();if(!matches.length)throw new Error('Application process is no longer available.');const proc=matches[0],wins=proc.windows();if(!wins[index])throw new Error('Window is no longer available.');
  if(input.operation==='focus'){proc.frontmost=true;try{wins[index].actions.byName('AXRaise').perform()}catch(e){}}
  else{let buttons=[];try{buttons=wins[index].buttons.whose({subrole:'AXCloseButton'})()}catch(e){};if(!buttons.length)throw new Error('Window has no accessible close control.');buttons[0].click();}
  return JSON.stringify({ok:true,output:input.operation==='focus'?'Focus requested.':'Close request sent.'});
}`;

const macInspectUi = `function run(argv){
  const input=JSON.parse(argv[0]),parts=String(input.handle).split(':'),pid=Number(parts[0]),index=Number(parts[1]||0),se=Application('System Events'),matches=se.applicationProcesses.whose({unixId:pid})();
  if(!matches.length)throw new Error('Application process is no longer available. Grant Accessibility access to VS Code if this persists.');const win=matches[0].windows()[index];if(!win)throw new Error('Window is no longer available.');const controls=[];
  function value(e,key){try{return String(e.attributes.byName(key).value()||'')}catch(x){return ''}}
  function walk(e,depth){if(controls.length>=120||depth>8)return;let name=value(e,'AXTitle')||value(e,'AXDescription'),identifier=value(e,'AXIdentifier'),role=value(e,'AXRole');if(name||identifier)controls.push({selector:{identifier,name,role},name,identifier,controlType:role});let children=[];try{children=e.uiElements()}catch(x){};for(let i=0;i<children.length&&controls.length<120;i++)walk(children[i],depth+1)}
  walk(win,0);return JSON.stringify({ok:true,controls,output:'Found '+controls.length+' accessible controls.'});
}`;

const macUiAction = `function run(argv){
  const input=JSON.parse(argv[0]),parts=String(input.handle).split(':'),pid=Number(parts[0]),index=Number(parts[1]||0),se=Application('System Events'),matches=se.applicationProcesses.whose({unixId:pid})();if(!matches.length)throw new Error('Application process is no longer available.');const root=matches[0].windows()[index],selector=input.selector||{};
  function value(e,key){try{return String(e.attributes.byName(key).value()||'')}catch(x){return ''}}
  function find(e,depth){if(depth>8)return null;let name=value(e,'AXTitle')||value(e,'AXDescription'),identifier=value(e,'AXIdentifier');if((selector.identifier&&identifier===selector.identifier)||(!selector.identifier&&selector.name&&name===selector.name))return e;let children=[];try{children=e.uiElements()}catch(x){};for(let i=0;i<children.length;i++){let found=find(children[i],depth+1);if(found)return found}return null}
  const target=find(root,0);if(!target)throw new Error('UI control not found.');if(input.operation==='focus'){target.focused=true}else if(input.operation==='invoke'){let actions=target.actions();let press=actions.find(a=>a.name()==='AXPress');if(!press)throw new Error('UI control does not support press.');press.perform()}else{target.value=input.value||''}
  return JSON.stringify({ok:true,output:'UI '+input.operation+' completed.'});
}`;

async function findMacApplications(query) {
  const roots = ['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications')];
  const needle = query.toLowerCase(); const apps = [];
  async function scan(root, depth = 0) {
    if (depth > 2 || apps.length >= 30) return;
    let entries; try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (apps.length >= 30) break;
      const fullPath = path.join(root, entry.name);
      if ((entry.isDirectory() || entry.isSymbolicLink()) && entry.name.toLowerCase().endsWith('.app')) {
        const name = entry.name.slice(0, -4); if (name.toLowerCase().includes(needle)) apps.push({ name, id: fullPath, kind: 'app' });
      } else if (entry.isDirectory()) await scan(fullPath, depth + 1);
    }
  }
  await Promise.all(roots.map((root) => scan(root)));
  return apps.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30);
}

function createWindowsDesktopTools(runFile) {
  const ui = async (input, operation) => {
    if (!input.handle || !input.selector) throw new Error(`ui.${operation} requires handle and selector.`);
    return ps(`Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes;$r=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([Int64]$env:DA_HANDLE));$s=$env:DA_SELECTOR|ConvertFrom-Json;$p=if($s.automationId){[System.Windows.Automation.AutomationElement]::AutomationIdProperty}else{[System.Windows.Automation.AutomationElement]::NameProperty};$v=if($s.automationId){$s.automationId}else{$s.name};$e=$r.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition($p,[string]$v)));if(!$e){throw 'UI control not found.'};switch($env:DA_OP){'focus'{$e.SetFocus()}'invoke'{($e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()}'setValue'{($e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($env:DA_VALUE)}};[pscustomobject]@{ok=$true;output=('UI '+$env:DA_OP+' completed.')}|ConvertTo-Json -Compress`, { DA_HANDLE: String(input.handle), DA_SELECTOR: JSON.stringify(input.selector), DA_OP: operation, DA_VALUE: input.value || '' }, runFile);
  };
  return [
    { name: 'applications.search', description: 'Find installed applications by query.', permissions: ['desktop.inspect'], async execute(input = {}) { if (!input.query?.trim()) throw new Error('applications.search requires query.'); return ps(`$q=$env:DA_QUERY;$a=@();try{$a+=Get-StartApps|?{$_.Name -like "*$q*"}|%{[pscustomobject]@{name=$_.Name;id=$_.AppID;kind='appx'}}}catch{};$roots=@([Environment]::GetFolderPath('CommonStartMenu'),[Environment]::GetFolderPath('StartMenu'));foreach($r in $roots){if(Test-Path $r){Get-ChildItem -LiteralPath $r -Filter *.lnk -Recurse -ErrorAction SilentlyContinue|?{$_.BaseName -like "*$q*"}|select -First 25|%{$a+=[pscustomobject]@{name=$_.BaseName;id=$_.FullName;kind='shortcut'}}}};[pscustomobject]@{ok=$true;apps=@($a|sort name -Unique|select -First 30);output=('Found '+@($a).Count+' application match(es).')}|ConvertTo-Json -Depth 4 -Compress`, { DA_QUERY: input.query.trim() }, runFile); } },
    { name: 'applications.open', description: 'Launch an application returned by applications.search.', permissions: ['windows.open'], async execute(input = {}) { if (!input.appId) throw new Error('applications.open requires appId.'); return ps(`if($env:DA_KIND -eq 'appx'){Start-Process "shell:AppsFolder\\$env:DA_APP"}else{Start-Process -LiteralPath $env:DA_APP};[pscustomobject]@{ok=$true;output='Application launch requested.'}|ConvertTo-Json -Compress`, { DA_APP: input.appId, DA_KIND: input.kind || 'shortcut' }, runFile); } },
    { name: 'windows.list', description: 'List visible application windows, optionally matching query.', permissions: ['desktop.inspect'], async execute(input = {}) { const raw = await ps(`$q=$env:DA_QUERY;Get-Process|?{$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle}|%{[pscustomobject]@{handle=$_.MainWindowHandle.ToInt64();pid=$_.Id;title=$_.MainWindowTitle;process=$_.ProcessName}}|?{!$q -or $_.title -like "*$q*" -or $_.process -like "*$q*"}|select -First 40|ConvertTo-Json -Compress`, { DA_QUERY: input.query || '' }, runFile); const windows = Array.isArray(raw) ? raw : raw.handle ? [raw] : []; return { ok: true, windows, output: `Found ${windows.length} visible window(s).` }; } },
    { name: 'windows.focus', description: 'Focus a window. Input: handle.', permissions: ['desktop.control'], async execute(input = {}) { if (!input.handle) throw new Error('windows.focus requires handle.'); return ps(`${win32}$h=[IntPtr]::new([Int64]$env:DA_HANDLE);[AgentWindow]::ShowWindow($h,9)|Out-Null;$ok=[AgentWindow]::SetForegroundWindow($h);[pscustomobject]@{ok=[bool]$ok;output='Focus requested.'}|ConvertTo-Json -Compress`, { DA_HANDLE: String(input.handle) }, runFile); } },
    { name: 'windows.close', description: 'Close a window. Input: handle.', permissions: ['desktop.control'], async execute(input = {}) { if (!input.handle) throw new Error('windows.close requires handle.'); return ps(`${win32}$h=[IntPtr]::new([Int64]$env:DA_HANDLE);$ok=[AgentWindow]::PostMessage($h,0x0010,[IntPtr]::Zero,[IntPtr]::Zero);[pscustomobject]@{ok=[bool]$ok;output='Close request sent.'}|ConvertTo-Json -Compress`, { DA_HANDLE: String(input.handle) }, runFile); } },
    { name: 'ui.inspect', description: 'Read accessible controls in a window.', permissions: ['desktop.inspect'], async execute(input = {}) { if (!input.handle) throw new Error('ui.inspect requires handle.'); return ps(`Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes;$r=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([Int64]$env:DA_HANDLE));if(!$r){throw 'Window unavailable to UI Automation.'};$a=@();foreach($e in @($r.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)|select -First 120)){try{if($e.Current.Name -or $e.Current.AutomationId){$a += [pscustomobject]@{selector=[pscustomobject]@{automationId=$e.Current.AutomationId;name=$e.Current.Name};name=$e.Current.Name;automationId=$e.Current.AutomationId;controlType=$e.Current.ControlType.ProgrammaticName}}}catch{}};[pscustomobject]@{ok=$true;controls=@($a);output=('Found '+@($a).Count+' accessible controls.')}|ConvertTo-Json -Depth 5 -Compress`, { DA_HANDLE: String(input.handle) }, runFile); } },
    { name: 'ui.focus', description: 'Focus accessible control.', permissions: ['desktop.control'], execute: (input = {}) => ui(input, 'focus') },
    { name: 'ui.invoke', description: 'Invoke accessible control.', permissions: ['desktop.control'], execute: (input = {}) => ui(input, 'invoke') },
    { name: 'ui.set_value', description: 'Set accessible text control.', permissions: ['desktop.control'], execute: (input = {}) => ui(input, 'setValue') }
  ];
}

function createMacDesktopTools(runFile) {
  const action = async (input, operation) => { if (!input.handle) throw new Error(`windows.${operation} requires handle.`); return jxa(macWindowAction, { ...input, operation }, runFile); };
  const ui = async (input, operation) => { if (!input.handle || !input.selector) throw new Error(`ui.${operation} requires handle and selector.`); return jxa(macUiAction, { ...input, operation }, runFile); };
  return [
    { name: 'applications.search', description: 'Find installed macOS applications by query.', permissions: ['desktop.inspect'], async execute(input = {}) { if (!input.query?.trim()) throw new Error('applications.search requires query.'); const apps = await findMacApplications(input.query.trim()); return { ok: true, apps, output: `Found ${apps.length} application match(es).` }; } },
    { name: 'applications.open', description: 'Launch a macOS application returned by applications.search.', permissions: ['windows.open'], async execute(input = {}) { if (!input.appId) throw new Error('applications.open requires appId.'); const result = await runFile('/usr/bin/open', [input.kind === 'app' ? input.appId : '-a', ...(input.kind === 'app' ? [] : [input.appId])]); return { ok: true, output: 'Application launch requested.', detail: String(result.stdout || '').trim() }; } },
    { name: 'windows.list', description: 'List visible macOS application windows, optionally matching query. Requires Accessibility permission.', permissions: ['desktop.inspect'], execute: (input = {}) => jxa(macListWindows, input, runFile) },
    { name: 'windows.focus', description: 'Focus a macOS window. Requires Accessibility permission.', permissions: ['desktop.control'], execute: (input = {}) => action(input, 'focus') },
    { name: 'windows.close', description: 'Close a macOS window. Requires Accessibility permission.', permissions: ['desktop.control'], execute: (input = {}) => action(input, 'close') },
    { name: 'ui.inspect', description: 'Read macOS Accessibility controls in a window.', permissions: ['desktop.inspect'], async execute(input = {}) { if (!input.handle) throw new Error('ui.inspect requires handle.'); return jxa(macInspectUi, input, runFile); } },
    { name: 'ui.focus', description: 'Focus a macOS Accessibility control.', permissions: ['desktop.control'], execute: (input = {}) => ui(input, 'focus') },
    { name: 'ui.invoke', description: 'Press a macOS Accessibility control.', permissions: ['desktop.control'], execute: (input = {}) => ui(input, 'invoke') },
    { name: 'ui.set_value', description: 'Set a macOS Accessibility text control.', permissions: ['desktop.control'], execute: (input = {}) => ui(input, 'setValue') }
  ];
}

function createDesktopTools({ platform = process.platform, runFile = defaultRun } = {}) {
  if (platform === 'darwin') return createMacDesktopTools(runFile);
  if (platform === 'win32') return createWindowsDesktopTools(runFile);
  return [];
}

module.exports = { createDesktopTools, createMacDesktopTools, createWindowsDesktopTools, findMacApplications, jxa };
