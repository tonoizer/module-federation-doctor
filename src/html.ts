import type { DoctorReport } from "./types.js";

function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function htmlReport(report: DoctorReport): string {
  const data = jsonForHtml(report);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Module Federation Doctor</title>
<style>
:root{color-scheme:light dark;font:15px/1.5 ui-sans-serif,system-ui,sans-serif;--bg:#f7f8fa;--panel:#fff;--text:#18212f;--muted:#667085;--border:#d8dee8;--error:#b42318;--warning:#9a6700;--info:#175cd3}
@media(prefers-color-scheme:dark){:root{--bg:#101318;--panel:#181c23;--text:#f1f4f8;--muted:#aab4c3;--border:#343b48;--error:#ff7b72;--warning:#e3b341;--info:#79b8ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}main{max-width:1120px;margin:auto;padding:32px 20px 64px}header{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap}h1{margin:0;font-size:24px}.sub{color:var(--muted);margin:4px 0 0}.summary{display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));gap:12px;margin:24px 0}.card,.finding,.empty{background:var(--panel);border:1px solid var(--border);border-radius:10px}.card{padding:14px}.card strong{display:block;font-size:26px}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}button,input{font:inherit;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);padding:8px 11px}button[aria-pressed=true]{outline:2px solid var(--info);outline-offset:1px}input{flex:1;min-width:220px}.findings{display:grid;gap:10px}.finding{padding:15px;border-left:4px solid var(--info)}.finding.error{border-left-color:var(--error)}.finding.warning{border-left-color:var(--warning)}.row{display:flex;justify-content:space-between;gap:16px;align-items:start}.rule{font-weight:700}.severity{text-transform:uppercase;font-size:11px;letter-spacing:.06em;font-weight:800}.error .severity{color:var(--error)}.warning .severity{color:var(--warning)}.info .severity{color:var(--info)}.message{margin:8px 0}.suggestion{color:var(--muted)}details{margin-top:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg);padding:10px;border-radius:7px}.empty{padding:28px;text-align:center;color:var(--muted)}a{color:var(--info)}@media(max-width:560px){.summary{grid-template-columns:1fr}.row{display:block}}
</style>
</head>
<body>
<main>
<header><div><h1>Module Federation Doctor</h1><p class="sub">Portable report. No network requests. No source bodies.</p></div><div id="visible-count"></div></header>
<section class="summary" aria-label="Finding summary">
<div class="card"><span>Errors</span><strong>${report.summary.errors}</strong></div>
<div class="card"><span>Warnings</span><strong>${report.summary.warnings}</strong></div>
<div class="card"><span>Info</span><strong>${report.summary.info}</strong></div>
</section>
<section class="toolbar" aria-label="Report filters">
<button type="button" data-filter="all" aria-pressed="true">All</button>
<button type="button" data-filter="error" aria-pressed="false">Errors</button>
<button type="button" data-filter="warning" aria-pressed="false">Warnings</button>
<button type="button" data-filter="info" aria-pressed="false">Info</button>
<input id="search" type="search" placeholder="Search rules, projects, and messages" aria-label="Search findings">
</section>
<section id="findings" class="findings" aria-live="polite"></section>
</main>
<script id="report-data" type="application/json">${data}</script>
<script>
const report=JSON.parse(document.querySelector("#report-data").textContent);
const target=document.querySelector("#findings"),count=document.querySelector("#visible-count"),search=document.querySelector("#search");
let filter="all";
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el}
function render(){
 const query=search.value.trim().toLowerCase();
 const rows=report.findings.filter(f=>(filter==="all"||f.severity===filter)&&(!query||[f.ruleId,f.project,f.message,f.suggestion||""].join(" ").toLowerCase().includes(query)));
 target.replaceChildren();count.textContent=rows.length+" of "+report.findings.length+" findings";
 if(!rows.length){target.append(node("div","No findings match this view.","empty"));return}
 for(const f of rows){
  const item=node("article",undefined,"finding "+f.severity),top=node("div",undefined,"row"),left=node("div");
  left.append(node("div",f.ruleId,"rule"),node("div",f.project+(f.location?" · "+f.location.path:""),"sub"));
  top.append(left,node("span",f.severity,"severity"));item.append(top,node("p",f.message,"message"));
  if(f.suggestion)item.append(node("p","Fix: "+f.suggestion,"suggestion"));
  const details=node("details"),summary=node("summary","Evidence"),pre=node("pre",JSON.stringify(f.evidence,null,2));
  details.append(summary,pre);item.append(details);
  if(f.documentation){const link=node("a","Rule documentation");link.href="https://github.com/tonoizer/module-federation-doctor/blob/main/apps/docs/docs"+f.documentation+".md";item.append(link)}
  target.append(item);
 }
}
for(const button of document.querySelectorAll("[data-filter]"))button.addEventListener("click",()=>{filter=button.dataset.filter;for(const peer of document.querySelectorAll("[data-filter]"))peer.setAttribute("aria-pressed",String(peer===button));render()});
search.addEventListener("input",render);render();
</script>
</body>
</html>
`;
}
