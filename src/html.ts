import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DoctorReport, DoctorUiPayload } from "./types.js";
import { buildUiPayload } from "./ui-graph.js";

function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function uiTemplatePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "ui", "index.html"),
    path.join(here, "..", "dist", "ui", "index.html"),
    path.join(process.cwd(), "dist", "ui", "index.html"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]!;
}

function fallbackReport(payload: DoctorUiPayload): string {
  const data = jsonForHtml(payload);
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
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}main{max-width:1120px;margin:auto;padding:32px 20px 64px}header{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap}h1{margin:0;font-size:24px}.sub{color:var(--muted);margin:4px 0 0}.summary{display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));gap:12px;margin:24px 0}.card,.finding,.empty,.panel{background:var(--panel);border:1px solid var(--border);border-radius:10px}.card{padding:14px}.card strong{display:block;font-size:26px}.toolbar,.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}button,input{font:inherit;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);padding:8px 11px}button[aria-pressed=true]{outline:2px solid var(--info);outline-offset:1px}input{flex:1;min-width:220px}.findings{display:grid;gap:10px}.finding{padding:15px;border-left:4px solid var(--info)}.finding.error{border-left-color:var(--error)}.finding.warning{border-left-color:var(--warning)}.row{display:flex;justify-content:space-between;gap:16px;align-items:start}.rule{font-weight:700}.severity{text-transform:uppercase;font-size:11px;letter-spacing:.06em;font-weight:800}.error .severity{color:var(--error)}.warning .severity{color:var(--warning)}.info .severity{color:var(--info)}.message{margin:8px 0}.suggestion{color:var(--muted)}details{margin-top:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg);padding:10px;border-radius:7px}.empty,.panel{padding:28px}.panel h2{margin:0 0 12px;font-size:18px}.muted{color:var(--muted)}a{color:var(--info)}ul{margin:0;padding-left:18px}@media(max-width:560px){.summary{grid-template-columns:1fr}.row{display:block}}
</style>
</head>
<body>
<main>
<header><div><h1>Module Federation Doctor</h1><p class="sub">Portable report. No network requests. No source bodies.</p></div><div id="visible-count"></div></header>
<section class="summary" aria-label="Finding summary">
<div class="card"><span>Errors</span><strong id="errors"></strong></div>
<div class="card"><span>Warnings</span><strong id="warnings"></strong></div>
<div class="card"><span>Info</span><strong id="info"></strong></div>
</section>
<section class="tabs" role="tablist" aria-label="Dashboard views">
<button type="button" role="tab" data-tab="findings" aria-selected="true">Findings</button>
<button type="button" role="tab" data-tab="remotes" aria-selected="false">Remote graph</button>
<button type="button" role="tab" data-tab="shared" aria-selected="false">Shared</button>
<button type="button" role="tab" data-tab="orchestration" aria-selected="false">Orchestration</button>
<button type="button" role="tab" data-tab="modules" aria-selected="false">Module info</button>
</section>
<section id="findings-view">
<section class="toolbar" aria-label="Report filters">
<button type="button" data-filter="all" aria-pressed="true">All</button>
<button type="button" data-filter="error" aria-pressed="false">Errors</button>
<button type="button" data-filter="warning" aria-pressed="false">Warnings</button>
<button type="button" data-filter="info" aria-pressed="false">Info</button>
<input id="search" type="search" placeholder="Search rules, projects, and messages" aria-label="Search findings">
</section>
<section id="findings" class="findings" aria-live="polite"></section>
</section>
<section id="graph-view" class="panel" hidden></section>
</main>
<script id="report-data" type="application/json">${data}</script>
<script>
const payload=JSON.parse(document.querySelector("#report-data").textContent);
const report=payload.report;
document.getElementById("errors").textContent=report.summary.errors;
document.getElementById("warnings").textContent=report.summary.warnings;
document.getElementById("info").textContent=report.summary.info;
const target=document.querySelector("#findings"),count=document.querySelector("#visible-count"),search=document.querySelector("#search"),graphView=document.querySelector("#graph-view"),findingsView=document.querySelector("#findings-view");
let filter="all",tab="findings";
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el}
function renderFindings(){
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
function renderGraph(name){
 const graph=payload.graphs[name];
 graphView.replaceChildren();
 graphView.append(node("h2",name[0].toUpperCase()+name.slice(1)+" graph"));
 if(!graph.nodes.length){graphView.append(node("p","No graph data for this report.","muted"));return}
 const list=node("ul");
 for(const edge of graph.edges){
  const source=graph.nodes.find(n=>n.id===edge.source);
  const dest=graph.nodes.find(n=>n.id===edge.target);
  list.append(node("li",(source?.label||edge.source)+" → "+(dest?.label||edge.target)+(edge.label?" ("+edge.label+")":"")));
 }
 graphView.append(list);
}
function renderModules(){
 graphView.replaceChildren();
 graphView.append(node("h2","Module info"));
 if(!payload.projects.length){graphView.append(node("p","No projects in this report.","muted"));return}
 for(const project of payload.projects){
  const block=node("div");
  block.append(node("h3",project.project.name));
  const mf=project.moduleFederation;
  const lines=[
    "Federation name: "+(mf?.name||"(none)"),
    "Exposes: "+Object.keys(mf?.exposes||{}).join(", "),
    "Remotes: "+Object.keys(mf?.remotes||{}).join(", "),
    "Shared: "+Object.keys(mf?.shared||{}).join(", "),
  ];
  for(const line of lines)block.append(node("p",line,"muted"));
  graphView.append(block);
 }
}
function showTab(next){
 tab=next;
 for(const button of document.querySelectorAll("[data-tab]"))button.setAttribute("aria-selected",String(button.dataset.tab===tab));
 if(tab==="findings"){findingsView.hidden=false;graphView.hidden=true;renderFindings();return}
 findingsView.hidden=true;graphView.hidden=false;count.textContent="";
 if(tab==="modules")renderModules();
 else if(tab==="remotes")renderGraph("remotes");
 else if(tab==="shared")renderGraph("shared");
 else renderGraph("orchestration");
}
for(const button of document.querySelectorAll("[data-filter]"))button.addEventListener("click",()=>{filter=button.dataset.filter;for(const peer of document.querySelectorAll("[data-filter]"))peer.setAttribute("aria-pressed",String(peer===button));renderFindings()});
for(const button of document.querySelectorAll("[data-tab]"))button.addEventListener("click",()=>showTab(button.dataset.tab));
search.addEventListener("input",renderFindings);showTab("findings");
</script>
</body>
</html>
`;
}

export function htmlReport(input: DoctorReport | DoctorUiPayload): string {
  const payload: DoctorUiPayload =
    "graphs" in input && "projects" in input && "report" in input
      ? input
      : buildUiPayload([], input);
  const templateFile = uiTemplatePath();
  if (fs.existsSync(templateFile)) {
    const template = fs.readFileSync(templateFile, "utf8");
    const injection = `<script>window.__MF_DOCTOR_UI__=${jsonForHtml(payload)};</script>`;
    if (template.includes("<!-- !DOCTOR_UI_DATA! -->"))
      return template.replace("<!-- !DOCTOR_UI_DATA! -->", injection);
    return template.replace("</head>", `${injection}</head>`);
  }
  return fallbackReport(payload);
}

export function htmlReportFromFacts(
  projects: DoctorUiPayload["projects"],
  report: DoctorReport,
): string {
  return htmlReport(buildUiPayload(projects, report));
}
