// Analytics Desk frontend. Reads only data/<slug>/*.json; never computes or fills in numbers that are not in the files.
const fmt = n => n == null ? '—' : Number(n).toLocaleString('en-US');
const short = n => n == null ? '—' : n >= 1e6 ? (n/1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n/1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(Math.round(n*10)/10);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const yt = id => 'https://www.youtube.com/watch?v=' + id;
const dur = s => s ? (s >= 3600 ? (s/3600).toFixed(1) + ' h' : Math.round(s/60) + ' min') : '';
const $ = id => document.getElementById(id);
const get = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
const table = (head, rows) => rows.length ? `<table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.join('')}</table>` : na('No rows', 'The data file has no entries for this list.');
const na = (title, why) => `<div class="na"><b>${esc(title)}</b><span>${esc(why)}</span></div>`;
const card = (title, sub, body, cls = '') => `<section class="card ${cls}"><div class="hd"><h2>${title}</h2>${sub ? `<span class="muted">${sub}</span>` : ''}</div>${body}</section>`;
const kpi = (l, v, d) => `<div class="card kpi"><div class="l">${esc(l)}</div><b>${v}</b><div class="d">${esc(d)}</div></div>`;
const tag = (s, cls) => `<span class="tag ${cls}">${esc(s)}</span>`;

// Horizontal bar list (top videos, pages, sources).
const hbars = (rows, label, value, link) => {
  rows = rows.filter(r => r[value] != null); if (!rows.length) return null;
  const mx = Math.max(...rows.map(r => r[value]), 1);
  return `<div class="hbars">${rows.map(r => `<div class="hb"><span class="t" title="${esc(r[label])}">${link ? `<a href="${esc(link(r))}" target="_blank" rel="noopener">${esc(r[label])}</a>` : esc(r[label])}</span><span class="v">${fmt(r[value])}</span><span class="tr"><i style="width:${(r[value]/mx*100).toFixed(1)}%"></i></span></div>`).join('')}</div>`;
};
// Vertical SVG bar chart: pts = [{x:'MM-DD', y}] (only reported points).
const vbars = pts => {
  if (!pts.length) return null;
  const W = 600, H = 200, L = 34, B = 20, mx = Math.max(...pts.map(p => p.y), 1), bw = (W - L) / pts.length, ev = Math.ceil(pts.length / 8);
  const ticks = [0, .5, 1].map(f => `<line x1="${L}" x2="${W}" y1="${(H-B) - f*(H-B-8)}" y2="${(H-B) - f*(H-B-8)}"/><text x="${L-6}" y="${(H-B) - f*(H-B-8) + 3}" text-anchor="end">${short(mx*f)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"><g class="grid">${ticks}</g>${pts.map((p, i) => { const h = p.y/mx*(H-B-8);
    return `<rect class="b" rx="2" x="${(L + i*bw + bw*.15).toFixed(1)}" y="${(H-B-h).toFixed(1)}" width="${(bw*.7).toFixed(1)}" height="${h.toFixed(1)}"><title>${p.x}: ${fmt(p.y)}</title></rect>`
      + (i % ev === 0 || i === pts.length - 1 ? `<text x="${(L + i*bw + bw/2).toFixed(1)}" y="${H-5}" text-anchor="middle">${p.x}</text>` : ''); }).join('')}</svg>`;
};
// Line chart over reported points only; gaps are skipped, never interpolated.
const line = pts => {
  if (pts.length < 2) return null;
  const W = 600, H = 200, L = 40, B = 20, ys = pts.map(p => p.y), lo = Math.min(...ys), hi = Math.max(...ys), pad = Math.max(1, (hi-lo)*.1), a = Math.max(0, lo-pad), b = hi+pad;
  const X = i => L + i/(pts.length-1)*(W-L-6), Y = v => (H-B) - (v-a)/(b-a)*(H-B-8), ev = Math.ceil(pts.length/7);
  const d = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const ticks = [0, .5, 1].map(f => { const v = a + f*(b-a); return `<line x1="${L}" x2="${W}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L-6}" y="${Y(v)+3}" text-anchor="end">${short(v)}</text>`; }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"><defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#7c9cff" stop-opacity=".35"/><stop offset="1" stop-color="#7c9cff" stop-opacity="0"/></linearGradient></defs><g class="grid">${ticks}</g>
    <polygon class="ar" points="${X(0)},${H-B} ${d} ${X(pts.length-1)},${H-B}"/><polyline class="ln" points="${d}"/>
    ${pts.map((p, i) => `<circle r="2.5" cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}"><title>${p.x}: ${fmt(p.y)}</title></circle>` + (i % ev === 0 || i === pts.length-1 ? `<text x="${X(i).toFixed(1)}" y="${H-5}" text-anchor="middle">${p.x}</text>` : '')).join('')}</svg>`;
};

let channels = [];
// Only files that exist are requested (no 404s).
const OPTIONAL = { chezerecta: ['ypp'], morntide: ['pace'] };
const WEB = ['chezerecta', 'morntide', 'flbh'];
const TREND = [['subs', 'Subscribers'], ['earn', 'YPP hours (Earn)'], ['views7', 'Views, 7d rolling'], ['an7', 'Hours, 7d rolling']];
let trendKey = 'subs', S_cur = [];

function drawTrend() {
  const rows = [...S_cur].reverse(), pts = rows.filter(r => r[trendKey] != null).map(r => ({ x: r.day.slice(5), y: r[trendKey] })), miss = rows.filter(r => r[trendKey] == null).map(r => r.day.slice(5));
  document.querySelectorAll('#trend-seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === trendKey));
  $('trend').innerHTML = (line(pts) || na('Not enough readings', 'Need at least two snapshot days with this metric.'))
    + `<p class="muted">${pts.length} snapshot readings from snapshots.json${miss.length ? '; no reading on ' + miss.join(', ') + ' (skipped, not interpolated)' : ''}.</p>`;
}

async function webSection(slug) {
  const W = WEB.includes(slug) ? await get('data/' + slug + '/web.json') : null;
  if (!W) return card('Website', '', na('Website data unavailable', 'No web.json for this channel.'));
  const g = W.ga4, s = W.gsc || {}, d = g?.daily || [];
  const range = `${esc(W.domain)} · ${W.range.start} → ${W.range.end}`;
  let h = `<div class="grid k4">` + (g ? kpi('Users', fmt(g.users), 'GA4, 28 days') + kpi('Sessions', fmt(g.sessions), 'GA4, 28 days') + kpi('Pageviews', fmt(g.pageviews), 'GA4, 28 days')
      : kpi('GA4', '—', 'unavailable')) + (s.error ? kpi('Search clicks', '—', 'Search Console unavailable') : kpi('Search clicks', fmt(s.clicks), `${fmt(s.impressions)} impressions`)) + `</div>`;
  const notes = (W.bot_spikes?.length ? `${tag('Likely bot traffic', 'warn')} ${W.bot_spikes.map(b => `${b.day}: ${fmt(b.sessions)} sessions vs median ${fmt(b.median)}, ${Math.round(b.direct_share*100)}% Direct, ${Math.round(b.offsite_share*100)}% off-site (${fmt(b.kept_sessions)} kept)`).join(' · ')}<br>` : '')
    + (W.ga4_raw ? `Filtered: ${esc(W.ga4_filter)}. Unfiltered GA4: ${fmt(W.ga4_raw.users)} users, ${fmt(W.ga4_raw.sessions)} sessions, ${fmt(W.ga4_raw.pageviews)} pageviews.` : '')
    + (W.ga4_note ? `<br>GA4: ${esc(W.ga4_note)}` : '') + (W.ga4_error ? `<br>GA4 unavailable: ${esc(W.ga4_error)}` : '') + (s.error ? `<br>Search Console unavailable: ${esc(s.error)}` : '');
  h += card('Sessions per day', `${range} · ${d.length} days with traffic`, (vbars(d.map(r => ({ x: r.day.slice(5), y: r.sessions }))) || na('Daily sessions unavailable', 'web.json has no ga4.daily rows.'))
      + `<p class="muted">Only days GA4 returned rows for are shown; other days are not plotted.</p>`);
  h += `<div class="grid two">` + card('Top pages', 'pageviews', hbars(g?.top_pages || [], 'page', 'views') || na('Top pages unavailable', 'web.json has no ga4.top_pages.'))
    + card('Traffic sources', 'sessions by channel group', hbars(g?.sources || [], 'channel', 'sessions') || na('Traffic sources unavailable', 'web.json has no ga4.sources.')) + `</div>`;
  h += card('Top search queries', esc(s.property || ''), s.top_queries?.length ? table(['Query', 'Clicks', 'Impr.', 'Pos.'], s.top_queries.map(q => `<tr><td>${esc(q.query)}</td><td class="n">${fmt(q.clicks)}</td><td class="n">${fmt(q.impressions)}</td><td class="n">${q.position}</td></tr>`)) : na('No search queries', s.error || 'Search Console returned no queries.'));
  if (notes) h += `<p class="muted">${notes}</p>`;
  return h;
}

async function show(slug) {
  const c = channels.find(x => x.slug === slug); if (!c) return;
  if (location.hash.slice(1) !== slug) history.replaceState(null, '', '#' + slug);
  document.querySelectorAll('nav button').forEach(b => b.setAttribute('aria-selected', b.dataset.slug === slug));
  if (c.web_only) {
    $('meta').textContent = c.name.replace(/ \(web only\)/, '') + ' · website analytics';
    $('view').innerHTML = await webSection(slug); $('src').textContent = 'Sources: GA4 Data API · Search Console API (data/' + slug + '/web.json).'; return;
  }
  const base = 'data/' + slug + '/', extra = OPTIONAL[slug] || [], opt = f => extra.includes(f) ? get(base + f + '.json') : Promise.resolve(null);
  const [L, S, T, Y, P] = await Promise.all([get(base + 'latest.json'), get(base + 'snapshots.json'), get(base + 'tracking.json'), opt('ypp'), opt('pace')]);
  const k = L?.kpis || {}, snap = (S || [])[0] || {}, prev7 = (S || []).find(x => x.day && snap.day && (new Date(snap.day) - new Date(x.day)) / 864e5 === 7);
  $('meta').textContent = `${c.name} · ${c.handle} · Studio ${L?.day ?? '—'} · public feed ${T?.fetched ?? '—'}`;
  let h = `<div class="grid k4">`
    + kpi('Subscribers', fmt(k.subs), prev7?.subs != null && k.subs != null ? `${k.subs - prev7.subs >= 0 ? '+' : ''}${k.subs - prev7.subs} vs ${prev7.day} snapshot` : 'Studio exact')
    + kpi('Views, 7d', fmt(k.views7), `${fmt(k.views28)} in 28d`)
    + kpi('Watch hours, 7d', fmt(k.an7), `${fmt(k.an28)} h in 28d`)
    + kpi('YPP hours', fmt(k.earn), 'Studio Earn, 365d' + (snap.earn_as_of ? ', as of ' + snap.earn_as_of : '')) + `</div>`;
  // YPP
  let pace = '';
  if (Y) pace = `<dl class="props"><dt>Goal</dt><dd>${fmt(Y.goal_hours)} h by ${Y.deadline}</dd><dt>Status</dt><dd>${tag(Y.overall_status, Y.overall_status === 'behind' ? 'warn' : '')} ${esc(Y.overall_note)}</dd><dt>Pace</dt><dd>${Y.pace_h_per_day} h/day (28d) · ${Y.pace_7d_h_per_day} h/day (7d)</dd></dl>`
    + `<div class="scroll" style="margin-top:12px">${table(['Checkpoint', 'Target', 'Projected', 'Status'], (Y.checkpoints || []).map(p => `<tr><td>${fmt(p.hours)} h</td><td>${p.target}</td><td>${p.projected}</td><td>${tag(p.status, p.status === 'behind' ? 'warn' : '')}</td></tr>`))}</div><p class="muted">${esc(Y.hours_note || '')}</p>`;
  else if (P) pace = (P.metrics || []).map(m => `<dl class="props"><dt>${esc(m.metric)}</dt><dd><b>${fmt(m.last)}</b> / ${fmt(m.goal)} · ${m.projected ? `${m.rate_per_day} ${esc(m.unit)}/day, projected <b>${m.projected}</b>` : esc(m.status)}<div class="muted">${esc(m.window || '')}</div></dd></dl>`).join('') + `<p class="muted">Method: ${esc(P.method)}</p>`;
  else pace = na('Pace unavailable', 'No ypp.json or pace.json for this channel.');
  const meter = (label, val, goal) => `<div class="meter"><div class="top"><b>${label}</b><span>${fmt(val)} / ${fmt(goal)} · ${val == null ? '—' : Math.min(100, val/goal*100).toFixed(1) + '%'}</span></div><div class="bar"><i style="width:${Math.min(100, (val||0)/goal*100)}%"></i></div></div>`;
  h += `<div class="grid two">` + card('YPP progress', 'Studio', meter('Subscribers', k.subs, 1000) + meter('Watch hours (Earn)', k.earn, 4000) + `<p class="muted">Public yt-dlp count ${fmt(T?.subs_public)} at ${T?.fetched ?? '—'}.</p>`)
    + card('YPP pace', Y ? 'ypp.json' : P ? 'pace.json' : '', pace) + `</div>`;
  // Trends
  h += card('Trend', 'daily snapshots', `<div class="seg" id="trend-seg" style="margin-bottom:10px">${TREND.map(([key, l]) => `<button data-k="${key}">${l}</button>`).join('')}</div><div id="trend"></div>`);
  h += `<div class="grid two">`
    + card('Views per day', '', na('Daily views unavailable', 'The data files hold only rolling 7d / 28d view totals per snapshot, not per-day views.'))
    + card('Watch hours per day', '', na('Daily watch hours unavailable', 'The data files hold only rolling 7d / 28d hours and the Earn meter, not per-day hours.')) + `</div>`;
  // Top content
  const up = T?.uploads || [], lv = T?.streams || [];
  h += `<div class="grid two">` + card('Top content', 'lifetime views · latest.json', hbars((L?.content || []).slice(0, 10), 'title', 'views', r => yt(r.id)) || na('Top content unavailable', 'latest.json has no content list.'))
    + card('Top lives', 'public views · tracking.json', hbars([...lv].filter(v => v.views != null).sort((a, b) => b.views - a.views).slice(0, 10), 'title', 'views', r => yt(r.id)) || na('No live views', 'tracking.json has no streams with view counts.')) + `</div>`;
  h += `<div class="grid two">` + card('Do this next', '', `<ol>${(L?.recs || []).map(t => `<li>${esc(t)}</li>`).join('') || '<li class="muted">None.</li>'}</ol>`);
  // Releases with next-up row: earliest pending release dated today or later.
  const rel = [...(T?.releases || [])].sort((a, b) => a.date < b.date ? 1 : -1), today = L?.day || new Date().toISOString().slice(0, 10);
  const next = [...rel].reverse().find(r => r.status === 'pending' && r.date >= today);
  const st = s => tag(s, s === 'live' ? '' : s === 'pending' ? 'acc' : s === 'TAKEN DOWN' ? 'bad' : 'mut');
  h += card('Next up', next ? next.date : '', next ? `<div style="font-size:18px;font-weight:600">${esc(next.title)}</div><div class="muted">${esc(next.type)} · ${st(next.status)} · checked ${esc(next.checked || '')}</div>` : na('Nothing scheduled', 'No pending release dated today or later in tracking.json.')) + `</div>`;
  h += card('Releases', rel.length + ' in registry', `<div class="scroll">${table(['Release', 'Date', 'Status', 'Stores'], rel.map(r => `<tr${r === next ? ' class="next"' : ''}><td>${esc(r.title)} <span class="muted">${esc(r.type)}</span>${r === next ? tag('next up', 'acc') : ''}</td><td>${r.date}</td><td>${st(r.status)}</td><td>${Object.entries(r.stores || {}).map(([n, u]) => `<a class="pill" href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a>`).join('') || '<span class="muted">none verified</span>'}</td></tr>`))}</div>`);
  const vids = (list, tagged) => list.map(v => `<tr><td><a href="${yt(v.id)}" target="_blank" rel="noopener">${esc(v.title)}</a>${tagged && v.tag ? tag(v.tag, 'acc') : ''}${v.live === 'is_live' ? tag('LIVE', 'bad') : ''}</td><td class="n">${dur(v.duration)}</td><td class="n">${fmt(v.views)}</td></tr>`);
  h += `<div class="grid two">` + card('Uploads', up.length + ' public', `<div class="scroll">${table(['Title', 'Length', 'Views'], vids(up))}</div>`)
    + card('Lives', lv.length + ' public' + (c.live_tag ? ` · ${lv.filter(s => s.tag).length} ${esc(c.live_tag)}` : ''), `<div class="scroll">${table(['Title', 'Length', 'Views'], vids(lv, true))}</div>`) + `</div>`;
  h += card('Snapshots', (S || []).length + ' days', `<div class="scroll">${table(['Day', 'Subs', 'Earn h', 'Views 7d', 'Hours 7d', 'Views 28d', 'Hours 28d'], (S || []).map(s => `<tr><td>${s.day}</td><td class="n">${fmt(s.subs)}</td><td class="n">${fmt(s.earn)}</td><td class="n">${fmt(s.views7)}</td><td class="n">${fmt(s.an7)}</td><td class="n">${fmt(s.views28)}</td><td class="n">${fmt(s.an28)}</td></tr>`))}</div>`);
  h += await webSection(slug);
  $('view').innerHTML = h;
  S_cur = S || []; drawTrend();
  $('trend-seg').onclick = e => { if (e.target.dataset.k) { trendKey = e.target.dataset.k; drawTrend(); } };
  $('src').textContent = 'Sources: ' + Object.values(T?.sources || {}).join(' · ') + ' · GA4 / Search Console (web.json). Unverified Spotify links are omitted.';
}
(async () => {
  channels = await get('channels.json') || [];
  $('tabs').innerHTML = channels.map(c => `<button role="tab" data-slug="${c.slug}">${esc(c.name.replace(/ \(web only\)/, ''))}${c.web_only ? ' <span class="muted">web</span>' : ''}</button>`).join('');
  $('tabs').onclick = e => { const b = e.target.closest('button'); b && show(b.dataset.slug); };
  addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(channels.some(c => c.slug === location.hash.slice(1)) ? location.hash.slice(1) : channels[0]?.slug);
})();
