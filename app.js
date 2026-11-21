"use strict";

const $ = id => document.getElementById(id);
let language = localStorage.getItem("reader-language") === "zh-CN" ? "zh-CN" : "en";
const t = (en, zh) => language === "zh-CN" ? zh : en;
let info, infoTimer;
function localizePage() {
  document.documentElement.lang = language;
  document.title = t("Claude Code Session Reader","Claude Code 会话阅读器");
  $("sidebar").ariaLabel = t("Project navigation","项目导航");
  $("projects").ariaLabel = t("Local projects","本地项目");
  $("projectSearch").placeholder = $("projectSearch").ariaLabel = t("Search all sessions","搜索全部项目和会话");
  $("refresh").textContent = t("Refresh","刷新");
  $("menu").textContent = t("Projects","项目目录");
  $("language").value = language;
  $("language").ariaLabel = t("Language","界面语言");
  showIndexStatus();
}
function showIndexStatus() {
  $("index-status").textContent = info?.index === "building" ? t("Indexing local messages…","正在索引本地消息…")
    : info?.index === "failed" ? t("Indexing stopped. Refresh to try your search.","索引中断，请刷新后搜索。") : "";
}
async function updateInfo() {
  info = await api("info");
  showIndexStatus();
  clearTimeout(infoTimer);
  if (info.index === "building") infoTimer = setTimeout(() => updateInfo().catch(() => {}), 1000);
}
$("language").onchange = () => {
  language = $("language").value;
  localStorage.setItem("reader-language",language);
  localizePage();
  route();
};
const md = window.markdownit({html: false, breaks: true});
const escape = md.utils.escapeHtml;
md.renderer.rules.image = (tokens, i) => escape(tokens[i].content || t("Image","图片")) + " (" + escape(tokens[i].attrGet("src") || "") + ")";
md.renderer.rules.link_open = (tokens, i) => {
  const href = tokens[i].attrGet("href");
  return /^https?:\/\//i.test(href) ? '<a target="_blank" rel="noopener noreferrer" href="' + escape(href) + '">' : "<a>";
};

let projects = [], project, session, mainAgents = [], request = 0;
const viewport = $("viewport"), content = $("content");
const n = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
function button(label, cls, click) {
  const el = n("button", cls, label);
  el.onclick = click;
  return el;
}
function navigate(params) {
  const hash = new URLSearchParams(params).toString();
  if (location.hash.slice(1) === hash) route();
  else location.hash = hash;
}
function timeString(value, options) {
  const date = new Date(value);
  return Number.isNaN(+date) ? "" : date.toLocaleString(language, {hour12:false, ...options});
}
async function api(endpoint, params = {}) {
  const response = await fetch("/api/" + endpoint + "?" + new URLSearchParams(params));
  if (!response.ok) throw new Error(t("Could not read this record. Refresh and try again.","无法读取记录，请刷新后重试。"));
  return response.json();
}
function showMenu(open) {
  document.body.classList.toggle("nav-open", open);
  $("menu").setAttribute("aria-expanded", String(open));
}
$("menu").onclick = () => showMenu(!document.body.classList.contains("nav-open"));
$("refresh").onclick = load;
function globalSearch() {
  const q = $("projectSearch").value.trim();
  const params = new URLSearchParams(location.hash.slice(1));
  const alreadySearching = params.has("all");
  if (!q && !alreadySearching) return;
  const hash = new URLSearchParams(q ? {all:q} : {project:project?.id || ""});
  history[alreadySearching ? "replaceState" : "pushState"](null,"","#" + hash);
  route();
}
$("projectSearch").oninput = e => { if (!e.isComposing) globalSearch(); };
$("projectSearch").oncompositionend = globalSearch;
window.addEventListener("hashchange", route);

async function load() {
  $("refresh").disabled = true;
  try {
    [projects] = await Promise.all([api("projects"),updateInfo()]);
    await route();
  } catch (e) {
    content.replaceChildren(n("p","error",e.message));
  } finally {
    $("refresh").disabled = false;
  }
}
function drawNav() {
  const list = document.createDocumentFragment();
  for (const p of projects) {
    const el = button("", "project", () => navigate({project:p.id}));
    el.title = p.path;
    if (p.id === project?.id) {
      el.classList.add("active");
      el.setAttribute("aria-current","true");
    }
    el.append(n("span","folder"), n("span","project-name",p.name), n("span","count",p.sessions.length));
    list.append(el);
  }
  if (!list.childNodes.length) list.append(n("p","notice",t("No projects found","没有匹配的项目")));
  $("projects").replaceChildren(list);
}
let agentSession = "", continuation;
let searchTimer;
async function route() {
  const version = ++request;
  clearTimeout(searchTimer);
  CSS.highlights?.delete("found-text");
  continuation?.disconnect();
  const params = new URLSearchParams(location.hash.slice(1));
  const id = params.get("session");
  const all = params.get("all") || "";
  if ($("projectSearch").value.trim() !== all) $("projectSearch").value = all;
  document.body.classList.toggle("global-search",Boolean(all));
  project = projects.find(p => p.id === (id ? id.split("/")[0] : params.get("project"))) || projects[0];
  session = project?.sessions.find(s => s.id === id);
  showMenu(false);
  drawNav();
  viewport.scrollTop = 0;
  if (!project) {
    content.replaceChildren(n("h1","",t("No local sessions yet","还没有本地会话")),
      n("p","",t("The reader looks for Claude Code transcripts here:","阅读器会在这个目录查找 Claude Code 的会话记录：")),
      n("code","",info?.root || ""), n("p","notice",t("Start a Claude Code session and refresh, or launch the reader with --demo to explore the example.","运行一次 Claude Code 后刷新，或用 --demo 启动阅读器体验示例。")));
    return;
  }
  if (!session) {
    showSessions(all,params.get("find") || "");
    return;
  }
  const current = session;
  const target = params.get("agent") || current.id;
  content.replaceChildren(n("p","notice",t("Reading session…","正在读取会话…")));
  try {
    if (target !== current.id && agentSession !== current.id) {
      const main = await api("session", {id:current.id});
      if (version !== request) return;
      mainAgents = main.agents;
      agentSession = current.id;
    }
    if (target !== current.id && !mainAgents.some(a => a.id === target)) {
      navigate({session:current.id});
      return;
    }
    const data = await api("session",{id:target});
    if (version !== request) return;
    if (target === current.id) {
      mainAgents = data.agents;
      agentSession = current.id;
    }
    showChat(data,target);
  } catch (e) {
    if (version === request) content.replaceChildren(button(t("← Project sessions","← 项目会话"),"back",() => navigate({project:project.id})),n("p","error",e.message));
  }
}
function sessionIdentifier(path) {
  const id = path.split("/").pop().replace(/\.jsonl$/, "");
  const el = n("span","session-id");
  el.append(n("span","",id),copyButton(t("Copy ID","复制 ID"),() => t("Claude Code local session: ","Claude Code 本地会话：") + id));
  return el;
}
function copyButton(label, getText) {
  let timer;
  const copy = button(label,"copy-id",async () => {
    clearTimeout(timer);
    try {
      await navigator.clipboard.writeText(getText());
      copy.textContent = t("Copied","已复制");
    } catch {
      copy.textContent = t("Copy failed","复制失败");
    }
    timer = setTimeout(() => { copy.textContent = label; }, 1600);
  });
  return copy;
}
function referenceText(hit, occurrence = 0) {
  const id = hit.parent.split("/").pop().replace(/\.jsonl$/, "");
  const speaker = hit.role === "user" ? t("User","用户") : "Claude";
  let quote = hit.before + hit.match + hit.after;
  if (hit.body) {
    const at = offsets(hit.body,hit.match)[occurrence];
    const end = at+hit.match.length+80;
    quote = (at > 56 ? "…" : "") + hit.body.slice(Math.max(0,at-56),end) + (end < hit.body.length ? "…" : "");
  }
  const source = (info.demo ? "example/projects" : info.root) + "/" + hit.file;
  return [t("Claude Code local session: ","Claude Code 本地会话：") + id,
    t("Transcript: ","记录文件：") + source,
    t("Byte offset: ","字节偏移：") + hit.at + t(", block: ","，内容块：") + hit.index,
    speaker + " · “" + quote.trim() + "”"].join("\n");
}
function searchInput(label) {
  const wrap = n("label","search");
  const input = n("input");
  input.type = "search";
  input.placeholder = label;
  input.setAttribute("aria-label",label);
  wrap.append(n("span"),input);
  return {wrap,input};
}
function hitButton(hit,term) {
  const params = {session:hit.parent,q:term,at:hit.at,index:hit.index};
  if (hit.file !== hit.parent) params.agent = hit.file;
  const el = button("","hit",() => navigate(params));
  const speaker = hit.role === "user" ? t("You","你") : "Claude";
  el.append(n("span","tag",t("Message","正文")),n("small","", (params.agent ? t("Subagent · ","子代理 · ") : "") + speaker),
    document.createTextNode(hit.before),n("mark","",hit.match),document.createTextNode(hit.after));
  const row = n("div","hit-row");
  row.append(el,copyButton(t("Copy reference","复制引用"),() => referenceText(hit)));
  return row;
}
function showSessions(all, initial) {
  const list = n("div");
  const status = n("div","search-status");
  status.setAttribute("role","status");
  const active = project;
  const {wrap,input} = searchInput(t("Search this project","搜索本项目会话"));
  input.value = initial;
  const toolbar = n("div","list-head");
  toolbar.append(wrap);
  content.replaceChildren(n("h1","",all ? t("Search results","搜索结果") : active.name));
  if (!all) content.append(n("div","path",active.path),toolbar);
  content.append(status,list);
  let sequence = 0;
  function draw(term,hits,complete) {
    const query = term.toLowerCase();
    const bySession = new Map();
    for (const hit of hits) {
      if (!bySession.has(hit.parent)) bySession.set(hit.parent,[]);
      bySession.get(hit.parent).push(hit);
    }
    const rows = document.createDocumentFragment();
    for (const p of all ? projects : projects.filter(p => p.id === active.id)) {
      if (all && p.path.toLowerCase().includes(query)) {
        rows.append(button(p.path,"project-hit",() => navigate({project:p.id})));
      }
      for (const s of p.sessions) {
        const found = bySession.get(s.id) || [];
        const titleHit = term && s.title.toLowerCase().includes(query);
        const idHit = term && s.id.split("/").pop().toLowerCase().includes(query);
        if (term && !found.length && !titleHit && !idHit) continue;
        const row = n("div","session");
        const text = n("div","session-text");
        const heading = button("","session-title",() => navigate({session:s.id}));
        if (titleHit || idHit) heading.append(n("span","tag",titleHit ? t("Title","标题") : "ID"));
        heading.append(document.createTextNode(s.title));
        if (all) text.append(n("small","project-caption",p.name));
        text.append(heading,sessionIdentifier(s.id));
        for (const hit of found.slice(0,3)) text.append(hitButton(hit,term));
        if (found.length > 3) text.append(disclosure(t("More messages (" + (found.length-3) + ")", "另有 " + (found.length-3) + " 条消息"),"",() => {
          const extra = document.createDocumentFragment();
          for (const hit of found.slice(3)) extra.append(hitButton(hit,term));
          return extra;
        },"extra-hits"));
        const date = new Date(s.date * 1000);
        row.append(n("span","bubble-icon"),text,n("span","date",timeString(date,{year:"numeric",month:"2-digit",day:"2-digit"}) + "\n" + timeString(date,{hour:"2-digit",minute:"2-digit"})));
        rows.append(row);
      }
    }
    if (complete && !rows.childNodes.length) rows.append(n("p","notice",t("No matches","没有匹配结果")));
    list.replaceChildren(rows);
  }
  function filter() {
    const ticket = ++sequence;
    const term = all || input.value.trim();
    if (!all) {
      const hash = new URLSearchParams({project:active.id});
      if (term) hash.set("find",term);
      history.replaceState(null,"","#" + hash);
    }
    clearTimeout(searchTimer);
    status.textContent = "";
    draw(term,[],!term);
    if (!term) return;
    searchTimer = setTimeout(async () => {
      status.textContent = t("Searching messages…","正在搜索正文…");
      try {
        const [hits,fresh] = await Promise.all([api("search",all ? {q:term} : {project:active.id,q:term}),api("projects")]);
        if (ticket !== sequence || !list.isConnected) return;
        projects = fresh;
        drawNav();
        draw(term,hits,true);
        status.textContent = "";
      } catch (err) {
        if (ticket === sequence && list.isConnected) status.textContent = err.message;
      }
    },180);
  }
  input.oninput = e => { if (!e.isComposing) filter(); };
  input.oncompositionend = filter;
  filter();
}
function markdown(text) {
  const el = n("div","prose");
  el.innerHTML = md.render(String(text));
  return el;
}
function pre(value) {
  return n("pre","",typeof value === "string" ? value : JSON.stringify(value,null,2));
}
function disclosure(label, hint, fill, cls = "") {
  const el = n("details",cls);
  const summary = n("summary","",label);
  if (hint) summary.append(n("span","hint",hint));
  const body = n("div","inside");
  el.append(summary,body);
  let pending;
  el.reveal = () => {
    el.open = true;
    if (!pending) {
      body.textContent = t("Loading…","正在读取…");
      pending = Promise.resolve().then(fill).then(result => body.replaceChildren(result)).catch(error => {
        body.textContent = error.message;
        pending = null;
        throw error;
      });
    }
    return pending;
  };
  el.addEventListener("toggle",() => { if (el.open) el.reveal().catch(() => {}); });
  return el;
}
function renderValue(value) {
  if (Array.isArray(value)) {
    const el = n("div");
    for (const item of value) el.append(renderValue(item));
    return el;
  }
  if (value?.type === "text") return pre(value.text);
  if (value?.type === "image" && value.source?.type === "base64" && /^image\/(png|jpeg|webp|gif)$/i.test(value.source.media_type)) {
    const img = n("img","media");
    img.alt = t("Transcript image","会话图片");
    img.src = "data:" + value.source.media_type + ";base64," + value.source.data;
    return img;
  }
  return pre(value);
}
function fields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return renderValue(value);
  const el = n("div","fields");
  for (const [key,entry] of Object.entries(value)) {
    el.append(n("small","",key),renderValue(entry));
  }
  if (!el.childNodes.length) el.append(pre("{}"));
  return el;
}
const blockLabels = () => ({image:t("Image","图片"),document:t("Document","文档"),redacted_thinking:t("Redacted thinking","已隐藏的思考"),tool_reference:t("Tool reference","工具引用"),tool_addition:t("Tool definition","工具说明")});
function renderEvent(e,id) {
  const el = eventContent(e,id);
  if ((e.kind === "text" || e.kind === "queued") && e.role !== "context") el.id = blockId(e);
  return el;
}
function blockId(e) {
  return "block-" + e.at + "-" + (e.index ?? 0);
}
function eventContent(e,id) {
  const read = (ref, part) => {
    const params = {id,at:ref.at,index:ref.index ?? 0};
    if (part !== undefined) params.part = part;
    return api("block", params);
  };
  function resultBody(result, ref) {
    const el = n("div");
    el.append(renderValue(result.content ?? result));
    (result.savedFiles || []).forEach((name,i) => {
      el.append(disclosure(t("Full output","完整输出"),name,async () => pre(await read(ref,i))));
    });
    if (result.structured) el.append(disclosure(t("Tool result details","工具记录详情"),"",async () => renderValue(await read(ref,"structured"))));
    return el;
  }
  if (e.kind === "text" && "text" in e) return markdown(e.text);
  if (e.kind === "text" && e.preview) {
    const el = n("div","long-message");
    el.append(markdown(e.preview + "…"),disclosure(t("Full message","完整消息"),"",async () => markdown((await read(e)).text)));
    return el;
  }
  if (e.kind === "queued") {
    const el = n("div");
    el.ready = read(e).then(a => el.replaceChildren(typeof a.prompt === "string" ? markdown(a.prompt) : renderValue(a.prompt))).catch(err => el.textContent = err.message);
    return el;
  }
  if (e.kind === "tool_use" || e.kind === "server_tool_use") {
    return disclosure((e.label === "Tool" ? t("Tool","工具") : e.label) + (e.error ? t(" · Error"," · 错误") : ""),e.hint,async () => {
      const [call,...results] = await Promise.all([read(e),...(e.results || []).map(ref => read(ref))]);
      const el = n("div");
      el.append(n("small","",t("Arguments","调用参数")),fields(call.input));
      results.forEach((r,i) => el.append(n("small",r.is_error ? "error" : "",r.is_error ? t("Error output","错误输出") : t("Result","返回结果")),resultBody(r,e.results[i])));
      if (!results.length) el.append(n("small","",t("No result recorded","无返回结果")));
      for (const a of mainAgents.filter(a => a.tool && a.tool === e.tool)) {
        el.append(button(t("Open subagent · ","查看子代理 · ") + a.name,"detail-link",() => navigate({session:session.id,agent:a.id})));
      }
      return el;
    },e.error ? "error" : "");
  }
  if (e.kind === "redacted_thinking") return n("small","notice",blockLabels()[e.kind]);
  const labels = {"Tool result":t("Tool result","工具结果"),"Thinking":t("Thinking","思考过程"),
    "Session summary":t("Session summary","会话摘要"),"Context message":t("Context message","上下文消息")};
  return disclosure(labels[e.label] || e.label || blockLabels()[e.kind] || e.kind,"",async () => {
    const value = await read(e);
    if (e.kind === "text") return markdown(value.text);
    if (e.kind === "thinking") return value.thinking ? markdown(value.thinking) : n("span","",t("No text recorded","无正文"));
    if (e.kind === "tool_result") return resultBody(value,e);
    if (e.kind === "record" && typeof value === "object") return fields(value);
    return renderValue(value);
  });
}
function groupEvents(events) {
  const groups = [];
  // Older transcripts omit stop_reason. Their trailing answer blocks are
  // identifiable when scanning backwards from the next user message.
  let trailingAnswer = true;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    let role = "activity";
    if (e.role === "user") {
      role = "user";
      trailingAnswer = true;
    } else if (e.role === "assistant") {
      const answerBlock = ["text","image","document"].includes(e.kind);
      const continues = e.stopReason === "tool_use" || e.stopReason === "pause_turn";
      trailingAnswer = answerBlock && !continues && (Boolean(e.stopReason) || trailingAnswer);
      if (trailingAnswer) role = "assistant";
    }
    let group = groups.at(-1);
    if (!group || group.role !== role || (role === "user" && group.at !== e.at)) {
      group = {role, at:e.at, events:[]};
      groups.push(group);
    }
    group.time = e.time;
    group.events.push(e);
  }
  for (const group of groups) group.events.reverse();
  return groups.reverse();
}
function renderGroup(g,id) {
  if (g.role === "activity") {
    const label = g.events.every(e => e.role === "context") ? t("Session context","会话上下文") : t("Activity","操作过程");
    return disclosure(label,"",() => {
      const lines = n("div");
      for (const e of g.events) lines.append(renderEvent(e,id));
      return lines;
    },"context");
  }
  const user = g.role === "user";
  const el = n("article","message " + g.role);
  const bar = n("header","byline");
  const time = n("time","",g.time ? timeString(g.time,{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}) : "");
  time.title = g.time;
  bar.append(n("strong","",user ? t("You","你") : "Claude"),time);
  const body = n("div","body");
  for (const e of g.events) body.append(renderEvent(e,id));
  el.append(bar,body);
  return el;
}
function offsets(text,term) {
  const fold = value => value.replace(/[A-Z]/g,c => c.toLowerCase());
  const haystack = fold(text), needle = fold(term), found = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle,at+needle.length)) found.push(at);
  return found;
}
function highlightHit(el,hit,term,occurrence) {
  const positions = offsets(el.textContent,term);
  if (CSS.highlights && positions.length === hit.count) {
    const start = positions[occurrence], end = start + term.length;
    const walker = document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    const range = new Range();
    let pos = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode, limit = pos + node.length;
      if (start >= pos && start < limit) range.setStart(node,start-pos);
      if (end > pos && end <= limit) {
        range.setEnd(node,end-pos);
        CSS.highlights.set("found-text",new Highlight(range));
        return range;
      }
      pos = limit;
    }
  }
  // A Markdown link destination or formatting marker can exist only in the source.
  const start = offsets(hit.body,term)[occurrence];
  const excerpt = n("pre","match-source");
  const mark = n("mark","",hit.body.slice(start,start+term.length));
  excerpt.append(document.createTextNode(hit.body.slice(Math.max(0,start-56),start)),mark,
    document.createTextNode(hit.body.slice(start+term.length,start+term.length+80)));
  el.after(excerpt);
  return mark;
}
document.addEventListener("keydown",event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && $("chat-find")) {
    event.preventDefault();
    $("chat-find").focus();
    $("chat-find").select();
  }
});
function showChat(data,id,seed = Object.fromEntries(new URLSearchParams(location.hash.slice(1))), freshHits = null) {
  const controls = n("div","chat-controls");
  controls.append(sessionIdentifier(session.id));
  const turns = groupEvents(data.events);
  const title = session.title;
  if (mainAgents.length) {
    const picker = n("select");
    picker.setAttribute("aria-label",t("Choose conversation","选择主对话或子代理"));
    picker.add(new Option(t("Main conversation","主对话"),session.id));
    mainAgents.forEach(a => picker.add(new Option(t("Subagent · ","子代理 · ") + a.name,a.id)));
    picker.value = id;
    picker.onchange = () => navigate(picker.value === session.id ? {session:session.id} : {session:session.id,agent:picker.value});
    controls.append(picker);
  }
  const thread = n("section","thread");
  thread.setAttribute("aria-label",t("Transcript","会话记录"));
  const bar = n("div","find-bar");
  const {wrap,input} = searchInput(t("Find in conversation","搜索此对话"));
  input.id = "chat-find";
  const count = n("span","find-count");
  count.setAttribute("role","status");
  const previous = button("↑","",() => move(-1));
  const following = button("↓","",() => move(1));
  previous.setAttribute("aria-label",t("Previous match","上一个匹配"));
  following.setAttribute("aria-label",t("Next match","下一个匹配"));
  let selected;
  const copyReference = copyButton(t("Copy reference","复制引用"),() => referenceText(selected.hit,selected.occurrence));
  copyReference.hidden = true;
  bar.append(wrap,count,previous,following,copyReference);
  content.replaceChildren(button(t("← Project sessions","← 项目会话"),"back",() => navigate({project:project.id})),n("h1","chat-title",title),controls,bar,thread);
  if (data.skipped) thread.append(n("p","notice",t("Unreadable transcript lines: " + data.skipped,"有 " + data.skipped + " 行记录无法读取")));
  if (!turns.length) thread.append(n("p","notice",t("No messages yet","暂无消息")));
  let first = 0, end = 0;
  const nodes = new Map();
  const earlier = button(t("Read earlier messages","阅读前面的消息"),"more",() => {
    const anchor = nodes.get(first);
    const top = anchor.getBoundingClientRect().top;
    const from = Math.max(0,first-60);
    earlier.after(renderRange(from,first));
    first = from;
    earlier.hidden = first === 0;
    viewport.scrollTop += anchor.getBoundingClientRect().top-top;
  });
  const more = button(t("Read more","继续阅读"),"more",next);
  continuation = new IntersectionObserver(entries => {
    if (more.isConnected && entries.some(entry => entry.isIntersecting)) next();
  },{root:viewport,rootMargin:"240px"});
  function renderRange(from,to) {
    const batch = document.createDocumentFragment();
    for (let i = from; i < to; i++) {
      const node = renderGroup(turns[i],id);
      nodes.set(i,node);
      batch.append(node);
    }
    return batch;
  }
  function next() {
    continuation.unobserve(more);
    const to = Math.min(end+60,turns.length);
    more.before(renderRange(end,to));
    end = to;
    more.hidden = end === turns.length;
    if (!more.hidden) continuation.observe(more);
  }
  function startAt(from) {
    continuation.unobserve(more);
    for (const node of nodes.values()) node.remove();
    nodes.clear();
    first = end = from;
    earlier.hidden = first === 0;
    next();
  }
  thread.append(earlier,more);
  startAt(0);
  let hits = [], total = 0, current = 0, revision = 0, jump = 0;
  const opened = [];
  function clearMatch() {
    CSS.highlights?.delete("found-text");
    thread.querySelector(".match-source")?.remove();
    for (const el of opened.splice(0).reverse()) el.open = false;
  }
  async function reveal(el) {
    if (!el.open) opened.push(el);
    await el.reveal();
  }
  async function locate() {
    const ticket = ++jump;
    const valid = () => ticket === jump && thread.isConnected;
    clearMatch();
    if (!total) return;
    let ordinal = current;
    const hit = hits.find(h => {
      if (ordinal < h.count) return true;
      ordinal -= h.count;
      return false;
    });
    count.textContent = (current+1) + " / " + total;
    const key = blockId(hit);
    const group = turns.findIndex(g => g.events.some(e => blockId(e) === key));
    if (group < 0) { count.textContent = t("The transcript changed. Search again.","记录已变动，请重新搜索"); return; }
    if (!nodes.has(group)) startAt(Math.max(0,group-12));
    const node = nodes.get(group);
    selected = {hit,occurrence:ordinal};
    copyReference.hidden = false;
    try {
      if (node.matches("details")) await reveal(node);
      if (!valid()) return;
      let el = $(key);
      if (el.ready) await el.ready;
      if (!valid()) return;
      if (el.classList.contains("long-message")) {
        const details = el.querySelector("details");
        await reveal(details);
        if (!valid()) return;
        el = details.querySelector(".inside");
      }
      const range = highlightHit(el,hit,input.value.trim(),ordinal);
      const y = range.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      viewport.scrollTop += y - Math.max(bar.offsetHeight+12,viewport.clientHeight*0.35);
    } catch (error) {
      if (valid()) count.textContent = error.message;
    }
  }
  function move(step) {
    if (!total) return;
    current = (current+step+total)%total;
    locate();
  }
  function find(target, cached) {
    const ticket = ++revision, term = input.value.trim();
    ++jump;
    clearMatch();
    clearTimeout(searchTimer);
    hits = [];
    selected = null;
    copyReference.hidden = true;
    total = current = 0;
    previous.disabled = following.disabled = true;
    count.textContent = "";
    if (!term) return;
    searchTimer = setTimeout(async () => {
      try {
        count.textContent = t("Searching…","搜索中…");
        const result = cached || await api("search",{file:id,q:term});
        if (ticket !== revision || !thread.isConnected) return;
        if (!cached && result.revision && result.revision !== data.revision) {
          const updated = await api("session",{id});
          if (ticket !== revision || !thread.isConnected) return;
          continuation.disconnect();
          const focused = document.activeElement === input;
          showChat(updated,id,{...target,q:term},result);
          if (focused) $("chat-find").focus({preventScroll:true});
          return;
        }
        hits = result.hits;
        for (const h of hits) {
          if (target && h.at === Number(target.at) && h.index === Number(target.index)) current = total;
          total += h.count;
        }
        previous.disabled = following.disabled = total < 2;
        count.textContent = total ? "" : "0 / 0";
        await locate();
      } catch (error) {
        if (ticket === revision && thread.isConnected) count.textContent = error.message;
      }
    },cached ? 0 : 160);
  }
  function changeFind() {
    const hash = new URLSearchParams(location.hash.slice(1));
    hash.delete("at"); hash.delete("index");
    if (input.value.trim()) hash.set("q",input.value.trim()); else hash.delete("q");
    history.replaceState(null,"","#" + hash);
    find();
  }
  input.oninput = e => { if (!e.isComposing) changeFind(); };
  input.oncompositionend = changeFind;
  input.onkeydown = e => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
  };
  input.value = seed.q || "";
  find(seed,freshHits);
}
localizePage();
load();
