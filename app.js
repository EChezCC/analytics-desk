const fmt = n => n == null ? '—' : Number(n).toLocaleString('en-US');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const yt = id => 'https://www.youtube.com/watch?v=' + id;
const dur = s => s ? (s >= 3600 ? (s/3600).toFixed(1) + ' h' : Math.round(s/60) + ' min') : '';
const $ = id => document.getElementById(id);
const get = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
const table = (head, rows) => rows.length ? `<table><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr>${rows.join('')}</table>` : '<p class="muted">No data.</p>';
const meter = (label, val, goal, src) => `<div class="meter"><div class="top"><b>${label}: ${fmt(val)} / ${fmt(goal)}</b><span>${val==null?'—':Math.min(100,val/goal*100).toFixed(1)+'%'}</span></div>
 <div class="bar"><i style="width:${Math.min(100,(val||0)/goal*100)}%"></i></div><div class="muted">${src}</div></div>`;

let channels = [];
async function show(slug) {
  const c = channels.find(x => x.slug === slug); location.hash = slug;
  document.querySelectorAll('nav button').forEach(b => b.setAttribute('aria-selected', b.dataset.slug === slug));
  const base = 'data/' + slug + '/';
  const [L, S, T, Y] = await Promise.all(['latest','snapshots','tracking','ypp'].map(f => get(base + f + '.json')));
  const k = L?.kpis || {}, snap = (S || [])[0] || {};
  $('meta').textContent = `${c.name} · ${c.handle} · Studio reading ${L?.day ?? '—'} · public feed ${T?.fetched ?? '—'}`;
  $('kpis').innerHTML = [['Subscribers', k.subs, 'Studio exact, ' + L?.day], ['Watch hours (Earn, 365d)', k.earn, 'Studio Earn' + (snap.earn_as_of ? ', as of ' + snap.earn_as_of : '')],
    ['Views 7d', k.views7, snap.an7_range || 'Studio 7d'], ['Hours 7d', k.an7, 'Studio 7d'], ['Views 28d', k.views28, snap.an28_range || 'Studio 28d'], ['Hours 28d', k.an28, 'Studio 28d'],
    ['Channel views', k.channel_views, 'YouTube Data API'], ['Videos', k.video_count, 'YouTube Data API']]
    .map(([l, v, s]) => `<div class="card kpi"><span>${l}</span><b>${fmt(v)}</b><span>${esc(s)}</span></div>`).join('');
  $('ypp').innerHTML = meter('Subscribers', k.subs, 1000, `Source: YouTube Studio (exact), read ${L?.day}. Public yt-dlp count ${fmt(T?.subs_public)} at ${T?.fetched ?? '—'}.`)
    + meter('Watch hours', k.earn, 4000, `Source: YouTube Studio Earn (qualified public hours, last 365d), read ${L?.day}${snap.earn_as_of ? ', meter as of ' + snap.earn_as_of : ''}.`);
  $('recs').innerHTML = (L?.recs || []).map(t => `<li>${esc(t)}</li>`).join('') || '<li class="muted">None.</li>';
  $('content').innerHTML = table(['Title', 'Kind', 'Views'], (L?.content || []).map(r => `<tr><td><a href="${yt(r.id)}" target="_blank" rel="noopener">${esc(r.title)}</a></td><td>${esc(r.kind)}</td><td class="n">${fmt(r.views)}</td></tr>`));
  $('pace-card').hidden = !Y;
  if (Y) $('pace').innerHTML = `<p class="muted">${esc(Y.hours_note || '')}</p>` + table(['Checkpoint', 'Target', 'Projected', 'Status'],
    (Y.checkpoints || []).map(p => `<tr><td>${fmt(p.hours)} h</td><td>${p.target}</td><td>${p.projected}</td><td>${esc(p.status)}</td></tr>`));
  $('snaps').innerHTML = table(['Day', 'Subs', 'Earn h', 'Views 7d', 'Hours 7d', 'Views 28d', 'Hours 28d'],
    (S || []).map(s => `<tr><td>${s.day}</td><td class="n">${fmt(s.subs)}</td><td class="n">${fmt(s.earn)}</td><td class="n">${fmt(s.views7)}</td><td class="n">${fmt(s.an7)}</td><td class="n">${fmt(s.views28)}</td><td class="n">${fmt(s.an28)}</td></tr>`));
  const vids = (list, tagged) => list.map(v => `<tr><td><a href="${yt(v.id)}" target="_blank" rel="noopener">${esc(v.title)}</a>${tagged && v.tag ? `<span class="tag">${esc(v.tag)}</span>` : ''}${v.live === 'is_live' ? '<span class="tag">LIVE</span>' : ''}</td><td class="n">${dur(v.duration)}</td><td class="n">${fmt(v.views)}</td></tr>`);
  const up = T?.uploads || [], lv = T?.streams || [];
  $('up-n').textContent = up.length + ' public'; $('uploads').innerHTML = table(['Title', 'Length', 'Views'], vids(up));
  const nt = lv.filter(s => s.tag).length;
  $('live-n').textContent = lv.length + ' public' + (c.live_tag ? ` · ${nt} ${c.live_tag}` : ''); $('lives').innerHTML = table(['Title', 'Length', 'Views'], vids(lv, true));
  const rel = T?.releases || [];
  $('rel-n').textContent = rel.length + ' in registry'; $('releases').innerHTML = table(['Release', 'Date', 'Status', 'Stores'],
    rel.map(r => `<tr><td>${esc(r.title)} <span class="muted">${esc(r.type)}</span></td><td>${r.date}</td><td>${esc(r.status)}</td><td>${Object.entries(r.stores).map(([n, u]) => `<a class="pill" href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a>`).join('') || '<span class="muted">none verified</span>'}</td></tr>`));
  $('src').textContent = 'Sources: ' + Object.values(T?.sources || {}).join(' · ') + '. Unverified Spotify links are omitted.';
}
(async () => {
  channels = await get('channels.json');
  $('tabs').innerHTML = channels.map(c => `<button role="tab" data-slug="${c.slug}">${esc(c.name)}</button>`).join('');
  $('tabs').onclick = e => e.target.dataset.slug && show(e.target.dataset.slug);
  show(channels.some(c => c.slug === location.hash.slice(1)) ? location.hash.slice(1) : channels[0].slug);
})();
