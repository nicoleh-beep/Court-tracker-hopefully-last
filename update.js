// Must sit at the top level of the repository, next to sources.json and data.json.
// Runs in GitHub Actions on a schedule. Reads sources.json, updates data.json. Node 18+.
const fs = require('fs'), crypto = require('crypto');
const CFG = JSON.parse(fs.readFileSync('sources.json', 'utf8'));
let state; try { state = JSON.parse(fs.readFileSync('data.json', 'utf8')); } catch { state = {}; }
state.items = state.items || [];
state.pages = state.pages || {};
const RULES = [
  ['ops', /clos(ed|ure)|weather|emergency|holiday|tolling|extend(ed|s)? deadline|in-person|clerk'?s office/i],
  ['tech', /cm\/?ecf|e-?fil|pacer|outage|maintenance|upgrade|nextgen|system|unavailable|noticing center|bnc/i],
  ['practice', /fee|admission|pro hac|service of|good standing|filing requirement/i],
  ['judicial', /judge|judicial|vacanc|nominat|confirm|chief|administrative order|assignment/i],
  ['rules', /rule|amend|standing order|local rule|procedure|comment/i],
];
const classify = t => (RULES.find(([, re]) => re.test(t)) || ['rules'])[0];
const strip = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, '’').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? strip(m[1]) : ''; };
const id = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const get = async url => { const r = await fetch(url, { headers: { 'User-Agent': 'CourtUpdateTracker/1.0' }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); };
const add = it => { if (!state.items.some(i => i.id === it.id)) state.items.unshift(it); };
(async () => {
  const errors = [], now = new Date().toISOString();
  for (const f of CFG.feeds) {
    try {
      for (const it of (await get(f.url)).split(/<item[\s>]|<entry[\s>]/i).slice(1)) {
        const title = tag(it, 'title'); if (!title) continue;
        const link = tag(it, 'link') || (it.match(/href="([^"]+)"/) || [])[1] || f.url;
        const desc = tag(it, 'description') || tag(it, 'summary');
        const d = tag(it, 'pubDate') || tag(it, 'updated') || tag(it, 'published');
        add({ id: id(f.url + title + link), title, detail: desc.slice(0, 400), link, court: f.court, level: f.level, source: f.name,
              cat: classify(title + ' ' + desc), posted: d && !isNaN(new Date(d)) ? new Date(d).toISOString().slice(0, 10) : now.slice(0, 10) });
      }
    } catch (e) { errors.push(`${f.name}: ${e.message}`); }
  }
  for (const p of CFG.watchPages) {
    try {
      const text = strip((await get(p.url)).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ''));
      const h = id(text), prev = state.pages[p.url];
      if (prev && prev.hash !== h) {
        const old = new Set(prev.words || []);
        const snip = text.split(/(?<=[.!?])\s+/).filter(s => s.split(' ').some(w => w.length > 3 && !old.has(w))).slice(0, 3).join(' ');
        add({ id: id(p.url + h), title: `Updated: ${p.name}`, detail: snip.slice(0, 400) || 'Page content changed – review the page.', link: p.url,
              court: p.court, level: p.level, source: p.name, cat: classify(p.name + ' ' + snip), posted: now.slice(0, 10) });
      }
      state.pages[p.url] = { hash: h, words: [...new Set(text.split(' '))].slice(0, 8000) };
    } catch (e) { errors.push(`${p.name}: ${e.message}`); }
  }
  Object.assign(state, { items: state.items.slice(0, 1500), lastRun: now, errors, sources: CFG.feeds.length + CFG.watchPages.length });
  fs.writeFileSync('data.json', JSON.stringify(state));
  console.log(`${state.items.length} items, ${errors.length} errors`);
  errors.forEach(e => console.log('  could not reach: ' + e));
})().catch(e => { console.error('Unexpected problem:', e); process.exit(0); });
