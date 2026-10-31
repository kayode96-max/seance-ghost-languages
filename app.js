import { GHOSTS, RULES, possessPrompt } from "./ghosts.js";

const $ = (s) => document.querySelector(s);
const board = $("#board"), input = $("#input"), send = $("#send"), stop = $("#stop");
const summonBtn = $("#summon"), modelSel = $("#model");
const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm@0.2.87";

let ghost = GHOSTS[0], engine = null, loadedModel = null, history = [], mode = "speak", busy = false;

// ---- ghost picker ----
const ghostsEl = $("#ghosts");
for (const g of GHOSTS) {
  const b = document.createElement("button");
  b.className = "ghost"; b.setAttribute("role", "radio"); b.dataset.id = g.id;
  b.setAttribute("aria-checked", String(g === ghost));
  b.innerHTML = `<b>${g.name} <small>· ${g.born}</small></b><small>${g.epithet}</small>`;
  b.onclick = () => pickGhost(g);
  ghostsEl.appendChild(b);
}
function pickGhost(g) {
  ghost = g;
  ghostsEl.querySelectorAll(".ghost").forEach((el) => el.setAttribute("aria-checked", String(el.dataset.id === g.id)));
  history = [];
  if (engine) { clearBoard(); reveal(ghost.greeting); }
}

// ---- tabs ----
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => {
  mode = t.dataset.mode;
  document.querySelectorAll(".tab").forEach((x) => { x.classList.toggle("active", x === t); x.setAttribute("aria-selected", String(x === t)); });
  input.placeholder = mode === "speak" ? "Ask the spirit something…" : "Paste modern code (JS, Python, Rust…) for the spirit to possess…";
  input.rows = mode === "speak" ? 3 : 8;
}));

// ---- WebGPU check ----
const hasWebGPU = "gpu" in navigator && !!navigator.gpu;
async function gpuUsable() {
  if (!hasWebGPU) return false;
  try { return !!(await navigator.gpu.requestAdapter()); } catch { return false; }
}
gpuUsable().then((ok) => {
  if (!ok) { $("#nogpu").hidden = false; summonBtn.disabled = true; summonBtn.textContent = "🕯️ Summoning unavailable"; }
});

// ---- summoning ----
summonBtn.onclick = async () => {
  const model = modelSel.value;
  if (engine && loadedModel === model) { clearBoard(); history = []; reveal(ghost.greeting); return; }
  summonBtn.disabled = true; modelSel.disabled = true;
  $("#progress-wrap").hidden = false;
  const txt = $("#progress-text"), bar = $("#bar");
  try {
    txt.textContent = "Lighting the candles (loading WebLLM)…";
    const webllm = await import(WEBLLM_URL);
    const onProgress = (r) => {
      bar.style.width = Math.round((r.progress || 0) * 100) + "%";
      txt.textContent = "Summoning… " + (r.text || "");
    };
    if (engine) { await engine.reload(model); } else {
      engine = await webllm.CreateMLCEngine(model, { initProgressCallback: onProgress });
    }
    loadedModel = model;
    bar.style.width = "100%"; txt.textContent = `The medium ${model.split("-q4")[0]} is present. Weights cached locally — next time works offline.`;
    input.disabled = false; send.disabled = false;
    clearBoard(); history = []; reveal(ghost.greeting);
  } catch (e) {
    console.error(e);
    txt.textContent = "The summoning failed: " + (e?.message || e);
  } finally { summonBtn.disabled = false; modelSel.disabled = false; summonBtn.textContent = "🕯️ Summon again"; }
};

// ---- board rendering ----
function clearBoard() { board.innerHTML = ""; }
function addYou(text) {
  const p = document.createElement("p"); p.className = "msg you"; p.textContent = text; board.appendChild(p); scroll();
}
function spiritBubble() {
  const p = document.createElement("div"); p.className = "msg spirit";
  p.innerHTML = `<span class="who">${ghost.name} speaks</span><span class="text"></span><span class="planchette"></span>`;
  board.appendChild(p); scroll(); return p;
}
const scroll = () => (board.scrollTop = board.scrollHeight);

// Ouija reveal: characters are queued and drawn one at a time, like a planchette spelling.
function makeRevealer(el) {
  const out = el.querySelector(".text"), queue = []; let timer = null, done = false, resolveDone;
  const finished = new Promise((r) => (resolveDone = r));
  const tick = () => {
    if (!queue.length) { timer = null; if (done) { el.querySelector(".planchette")?.remove(); resolveDone(); } return; }
    const n = queue.length > 200 ? 6 : queue.length > 60 ? 3 : 1;   // catch up if the model is faster than the planchette
    const span = document.createElement("span"); span.className = "l"; span.textContent = queue.splice(0, n).join("");
    out.appendChild(span); scroll(); timer = setTimeout(tick, 28);
  };
  return {
    push(s) { queue.push(...s); if (!timer) tick(); },
    end() { done = true; if (!timer) tick(); return finished; }
  };
}
function reveal(text) { const r = makeRevealer(spiritBubble()); r.push(text); return r.end(); }

// ---- asking ----
$("#ask").onsubmit = async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !engine || busy) return;
  input.value = ""; busy = true; send.disabled = true; stop.hidden = false;
  addYou(mode === "possess" ? "[offers code to be possessed]\n" + text : text);
  const userMsg = mode === "possess" ? possessPrompt(ghost) + "\n\n```\n" + text + "\n```" : text;
  const messages = [
    { role: "system", content: ghost.prompt + "\n\n" + RULES },
    ...history.slice(-6),
    { role: "user", content: userMsg }
  ];
  const r = makeRevealer(spiritBubble()); let full = "";
  try {
    const chunks = await engine.chat.completions.create({ messages, stream: true, temperature: 0.8, max_tokens: mode === "possess" ? 600 : 250 });
    for await (const c of chunks) { const d = c.choices[0]?.delta?.content || ""; full += d; r.push(d); }
  } catch (err) { r.push("\n…the connection to the other side was severed. (" + (err?.message || err) + ")"); }
  await r.end();
  history.push({ role: "user", content: userMsg }, { role: "assistant", content: full });
  busy = false; send.disabled = false; stop.hidden = true; input.focus();
};
stop.onclick = () => engine?.interruptGenerate();
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && mode === "speak") { e.preventDefault(); $("#ask").requestSubmit(); }
});
