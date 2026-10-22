// Website panel: reads data/<slug>/web.json (GA4 + Search Console aggregates, last 28 days).
const spark = (pts, key) => { if (pts.length < 2) return ''; const v = pts.map(p => p[key]), mx = Math.max(...v, 1);
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><polyline vector-effect="non-scaling-stroke" points="${v.map((y, i) => `${(i/(v.length-1)*100).toFixed(1)},${(28-y/mx*26).toFixed(1)}`).join(' ')}"/></svg>`; };
async function showWeb() {
  const slug = location.hash.slice(1) || channels[0]?.slug, c = channels.find(x => x.slug === slug); if (!c) return;
  document.querySelectorAll('main > section:not(#web-card)').forEach(s => { if (s.id !== 'pace-card' && s.id !== 'ypace-card') s.hidden = !!c.web_only; else if (c.web_only) s.hidden = true; });
  if (c.web_only) { $('meta').textContent = c.name; $('src').textContent = 'Sources: GA4 Data API · Search Console API.'; }
  const W = await get('data/' + slug + '/web.json'); $('web-card').hidden = !W; if (!W) return;
  const g = W.ga4, s = W.gsc || {}, d = g?.daily || [];
  $('web-sub').textContent = `${W.domain} · last 28 days ${W.range.start} → ${W.range.end}`;
  const kpi = (l, v, sub, sp = '') => `<div class="card kpi"><span>${l}</span><b>${fmt(v)}</b>${sp}<span>${esc(sub)}</span></div>`;
  $('web').innerHTML = `<div class="grid kpis">` + (g ? kpi('Users', g.users, 'GA4 ' + W.ga4_property, spark(d, 'users')) + kpi('Sessions', g.sessions, 'GA4', spark(d, 'sessions'))
      + kpi('Pageviews', g.pageviews, 'GA4', spark(d, 'pageviews')) : '')
    + (s.error ? '' : kpi('Search clicks', s.clicks, s.property) + kpi('Impressions', s.impressions, 'Search Console')) + `</div>`
    + (W.bot_spikes?.length ? `<p class="muted"><span class="tag" style="color:var(--warn);background:#f5b45022">Likely bot traffic</span> ${W.bot_spikes.map(b => `${b.day}: ${fmt(b.sessions)} sessions vs median ${fmt(b.median)}, ${Math.round(b.direct_share*100)}% Direct, ${Math.round(b.offsite_share*100)}% on preview hosts or unknown paths (${fmt(b.kept_sessions)} kept)`).join(' · ')}</p>` : '')
    + (W.ga4_raw ? `<p class="muted">Filtered: ${esc(W.ga4_filter)}. Unfiltered GA4: ${fmt(W.ga4_raw.users)} users, ${fmt(W.ga4_raw.sessions)} sessions, ${fmt(W.ga4_raw.pageviews)} pageviews.</p>` : '')
    + (W.ga4_note ? `<p class="muted">GA4: ${esc(W.ga4_note)}</p>` : '') + (W.ga4_error ? `<p class="muted">GA4 unavailable: ${esc(W.ga4_error)}</p>` : '')
    + (s.error ? `<p class="muted">Search Console unavailable: ${esc(s.error)}</p>` : '')
    + (g ? `<p class="muted">Daily trend: ${d.length} days with traffic</p>` : '')
    + `<div class="grid two" style="margin-top:12px">`
    + (g ? `<div><h2>Top pages</h2>${table(['Page', 'Views', 'Users'], g.top_pages.map(p => `<tr><td>${esc(p.page)}</td><td class="n">${fmt(p.views)}</td><td class="n">${fmt(p.users)}</td></tr>`))}</div>`
      + `<div><h2>Traffic sources</h2>${table(['Channel group', 'Sessions'], g.sources.map(r => `<tr><td>${esc(r.channel)}</td><td class="n">${fmt(r.sessions)}</td></tr>`))}</div>` : '')
    + (s.top_queries ? `<div><h2>Top search queries</h2>${table(['Query', 'Clicks', 'Impr.', 'Pos.'], s.top_queries.map(q => `<tr><td>${esc(q.query)}</td><td class="n">${fmt(q.clicks)}</td><td class="n">${fmt(q.impressions)}</td><td class="n">${q.position}</td></tr>`))}</div>` : '')
    + `</div>`;
}
addEventListener('hashchange', showWeb);
(function wait() { channels.length ? showWeb() : setTimeout(wait, 100); })();
