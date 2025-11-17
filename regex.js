// ===== Utilities =====
const $ = (s)=>document.querySelector(s);
const escapeHtml = (s)=> s.replace(/[&<>"']/g, c=> ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const ls = {
  get(k, d){ try{ return JSON.parse(localStorage.getItem(k)) ?? d }catch{return d} },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)) }
};
function stableColor(key){
  // deterministic pastel color from string key
  let h=0; for(let i=0;i<key.length;i++) h = (h*31 + key.charCodeAt(i))>>>0;
  const hue = h % 360; return `hsl(${hue}deg 70% 60% / .35)`;
}
function flagsString(){
  return ( $('#f_g').checked? 'g':'') + ($('#f_i').checked? 'i':'') + ($('#f_m').checked? 'm':'') + ($('#f_s').checked? 's':'') + ($('#f_u').checked? 'u':'');
}
function updateFlagsView(){ $('#flagsView').textContent = `/${$('#pattern').value||'…'}/${flagsString()}` }

// ===== Core state =====
let state = ls.get('regexlab', { pattern:"(?<user>\\w+)@(?<domain>[\\w.]+)", flags:{g:true,i:false,m:false,s:false,u:true}, text: `cliff@example.com\ninvalid@!\nSam@Test.ORG\nnotes@of.cliff.dev` });
$('#pattern').value = state.pattern; $('#f_g').checked=!!state.flags.g; $('#f_i').checked=!!state.flags.i; $('#f_m').checked=!!state.flags.m; $('#f_s').checked=!!state.flags.s; $('#f_u').checked=!!state.flags.u; $('#text').value = state.text;
updateFlagsView();

// ===== Explainer dictionary (tiny, not exhaustive) =====
const TOKENS = [
  ['^','Start of line (or string if no m flag)'],
  ['$','End of line (or string if no m flag)'],
  ['.','Any char (except newline unless s flag)'],
  ['\\d','Digit'], ['\\D','Non-digit'], ['\\w','Word char'], ['\\W','Non-word char'], ['\\s','Whitespace'], ['\\S','Non-whitespace'],
  ['*','0 or more'], ['+','1 or more'], ['?','0 or 1 / non-greedy'], ['{n}','Exactly n'], ['{n,}','At least n'], ['{n,m}','Between n and m'],
  ['[abc]','Character class'], ['[^abc]','Negated class'], ['(x)','Capturing group'], ['(?:x)','Non-capturing group'], ['(?<name>x)','Named group']
];
function buildExplainer(pat){
  const hits = [];
  for(const [tok, help] of TOKENS){ if(pat.includes(tok)) hits.push(`<code>${escapeHtml(tok)}</code> — ${escapeHtml(help)}`); }
  $('#explainer').innerHTML = hits.length? hits.join('<br>') : '<span class="muted">Tip: add tokens to see quick explanations.</span>';
}

// ===== Rendering matches =====
function render(){
  const pattern = $('#pattern').value; const flags = flagsString(); updateFlagsView(); buildExplainer(pattern);
  // persist
  ls.set('regexlab', { pattern, flags:{g:$('#f_g').checked, i:$('#f_i').checked, m:$('#f_m').checked, s:$('#f_s').checked, u:$('#f_u').checked}, text: $('#text').value });

  let re;
  try{ re = new RegExp(pattern, flags || undefined); $('#errorMsg').style.display='none'; }
  catch(e){ $('#errorMsg').style.display='inline-block'; $('#errorMsg').textContent = e.message; $('#matchCount').textContent='0 matches'; $('#output').innerHTML = ''; $('#groups').innerHTML=''; return; }

  const text = $('#text').value;
  let html = '', total = 0, groupCounts = new Map();

  // Determine group names from pattern by scanning for (?<name>
  const groupNameRE = /\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g;
  const names = new Set(); let m; while((m = groupNameRE.exec(pattern))){ names.add(m[1]); }

  // Build color map (stable)
  const colors = {}; for(const n of names){ colors[n] = stableColor(n); }

  // Global walk (fall back to manual if no g)
  if(!flags.includes('g')){
    const single = text.match(re);
    if(single){
      total = 1;
      html = highlightLine(text, [single], colors, groupCounts);
    }else{
      html = escapeHtml(text);
    }
  } else {
    // For global search, scan line by line for clearer highlighting
    const lines = text.split(/\r?\n/);
    for(const line of lines){
      let matches = []; let mm; re.lastIndex = 0; // reset per line
      while((mm = re.exec(line))){ matches.push(mm); if(mm[0]==='') re.lastIndex++; }
      total += matches.length;
      html += highlightLine(line, matches, colors, groupCounts) + '\n';
    }
  }

  $('#output').innerHTML = html;
  $('#matchCount').textContent = `${total} match${total===1?'':'es'}`;

  // Render groups panel
  const frag = document.createDocumentFragment();
  if(names.size===0){ const span=document.createElement('span'); span.className='muted'; span.textContent='No named groups. Use (?<name>...) to capture and colorize.'; frag.appendChild(span); }
  else{
    [...names].forEach(n=>{
      const el = document.createElement('div'); el.className='group'; el.innerHTML = `<span class="swatch" style="background:${colors[n]}"></span><b>${escapeHtml(n)}</b> <span class="k">×${groupCounts.get(n)||0}</span>`;
      el.addEventListener('mouseenter', ()=> toggleGroupHighlight(n, true));
      el.addEventListener('mouseleave', ()=> toggleGroupHighlight(n, false));
      frag.appendChild(el);
    });
  }
  $('#groups').innerHTML = ''; $('#groups').appendChild(frag);
}

function highlightLine(line, matches, colors, groupCounts){
  if(matches.length===0) return escapeHtml(line);
  let out = ''; let idx = 0;
  for(const m of matches){
    const start = m.index; const end = m.index + m[0].length;
    out += escapeHtml(line.slice(idx, start));
    let inner = escapeHtml(line.slice(start, end));
    // Highlight named groups inside the match, if present
    if(m.groups){
      // Sort spans by position using a naive re-run over the substring
      const spans = [];
      for(const [name,val] of Object.entries(m.groups)){
        if(val==null) continue;
        const sub = line.slice(start, end);
        const pos = sub.indexOf(val);
        if(pos>=0){ spans.push({name, s:pos, e:pos+val.length, val}); groupCounts.set(name, (groupCounts.get(name)||0)+1); }
      }
      spans.sort((a,b)=>a.s-b.s);
      let cur = 0; let buf = '';
      for(const sp of spans){
        buf += escapeHtml(inner.slice(cur, sp.s));
        buf += `<mark data-group="${sp.name}" style="background:${colors[sp.name]}">${escapeHtml(sp.val)}</mark>`;
        cur = sp.e;
      }
      buf += escapeHtml(inner.slice(cur));
      inner = buf;
    }
    out += `<mark class="m" style="background: rgba(255,255,0,.15); outline:1px solid rgba(255,255,255,.08)">${inner}</mark>`;
    idx = end;
  }
  out += escapeHtml(line.slice(idx));
  return out;
}

function toggleGroupHighlight(name, on){
  document.querySelectorAll(`mark[data-group="${name}"]`).forEach(el=>{
    el.style.outline = on ? '2px solid var(--accent)' : 'none';
    el.style.filter = on ? 'brightness(1.2)' : 'none';
  });
}

// ===== Events =====
['pattern','text','f_i','f_g','f_m','f_s','f_u'].forEach(id=> $('#'+id).addEventListener('input', render));
$('#sample').addEventListener('click', ()=>{
  $('#pattern').value = '(?<ip>\\d{1,3}(?:\\.\\d{1,3}){3}) - (?<user>\\w+) \\[(?<ts>[0-9\\- :]*?)\\] "(?<verb>[A-Z]+) (?<path>[^s]+)';
  $('#text').value = `127.0.0.1 - cliff [2025-11-05 13:22:01] "GET /index.html" 200\n10.2.3.4 - alice [2025-11-05 13:22:05] "POST /api/login" 401\ninvalid line...`;
  render();
});

// Share pattern via URL hash (base64 of JSON)
$('#share').addEventListener('click', ()=>{
  const data = {p: $('#pattern').value, f: flagsString(), t: $('#text').value};
  const blob = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  location.hash = blob; navigator.clipboard.writeText(location.href).then(()=>{
    alert('Link copied to clipboard. Anyone opening it will load your pattern and text locally.');
  });
});

// Load from hash on open
(function(){
  const h = location.hash.slice(1); if(!h) return; try{
    const json = decodeURIComponent(escape(atob(h))); const data = JSON.parse(json);
    $('#pattern').value = data.p || '';
    $('#text').value = data.t || '';
    ['i','g','m','s','u'].forEach(ch=> $('#f_'+ch).checked = (data.f||'').includes(ch));
  }catch{}
})();

// Export/import JSON
$('#export').addEventListener('click', ()=>{
  const data = { pattern: $('#pattern').value, flags: flagsString(), text: $('#text').value };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'regexlab.json'; a.click();
});
$('#importBtn').addEventListener('click', ()=> $('#import').click());
$('#import').addEventListener('change', async (e)=>{
  const f = e.target.files[0]; if(!f) return; const text = await f.text();
  try{ const data = JSON.parse(text); $('#pattern').value=data.pattern||''; $('#text').value=data.text||''; ['i','g','m','s','u'].forEach(ch=> $('#f_'+ch).checked=(data.flags||'').includes(ch)); render(); }
  catch(err){ alert('Invalid JSON'); }
});

// ===== Theme functionality =====
function initializeTheme() {
  const savedTheme = localStorage.getItem('logsieve-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  // Use saved theme, or fall back to system preference
  const isDark = savedTheme ? savedTheme === 'dark' : prefersDark;
  
  setTheme(isDark);
}

function setTheme(isDark) {
  const root = document.documentElement;
  
  if (isDark) {
    root.classList.add('dark-theme');
  } else {
    root.classList.remove('dark-theme');
  }
  
  // Save preference
  localStorage.setItem('logsieve-theme', isDark ? 'dark' : 'light');
  
  updateThemeIcons();
}

function updateThemeIcons() {
  const isDark = document.documentElement.classList.contains('dark-theme');
  document.querySelectorAll('.theme-icon').forEach(icon => {
    icon.textContent = isDark ? '☀️' : '🌙';
  });
}

function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark-theme');
  setTheme(!isDark);
}

function initializeThemeToggle() {
  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
  
  // Initialize theme on page load
  initializeTheme();
}

// Init
render();
initializeThemeToggle();