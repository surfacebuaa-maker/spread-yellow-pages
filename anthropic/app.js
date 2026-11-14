(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const keys = ['bitget', 'gate'];
  const STALE_MS = 45 * 60 * 1000;
  const state = { latest: null, samples: [], range: 24, loading: false, readError: null };
  const storage = {
    get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* Preferences are optional. */ } }
  };
  root.dataset.theme = storage.get('anthropic-theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  $('theme').addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    storage.set('anthropic-theme', root.dataset.theme);
  });
  let alertsEnabled = storage.get('anthropic-alerts', 'false') === 'true';
  const savedThreshold = storage.get('anthropic-threshold', '90');
  $('threshold').value = ['80', '90', '95', '98', '100'].includes(savedThreshold) ? savedThreshold : '90';

  function time(value, withDate = true) {
    if (!value || !Number.isFinite(Date.parse(value))) return '—';
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai',
      ...(withDate ? { month: '2-digit', day: '2-digit' } : {}),
      hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
  }
  const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const full = n => finite(n) ? '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : '—';
  function compact(n, signed = false) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
    const sign = signed && n > 0 ? '+' : n < 0 ? '−' : '';
    const value = Math.abs(n);
    return sign + (value >= 1e8 ? (value / 1e8).toFixed(4) + ' 亿' : value >= 1e4 ? (value / 1e4).toFixed(2) + ' 万' : value.toLocaleString('en-US', { maximumFractionDigits: 2 }));
  }
  function stale(source) {
    if (!source?.observedAt) return true;
    const age = Date.now() - Date.parse(source.observedAt);
    return !Number.isFinite(age) || age > STALE_MS || age < -300000;
  }
  function countdown(end) {
    if (!end) return '—';
    const left = Date.parse(end) - Date.now();
    if (!Number.isFinite(left)) return '—';
    if (left <= 0) return '已截止';
    const mins = Math.floor(left / 60000), days = Math.floor(mins / 1440), hours = Math.floor(mins % 1440 / 60);
    return (days ? days + '天 ' : '') + hours + '小时 ' + mins % 60 + '分';
  }
  function hourlyDelta(key, source) {
    if (!finite(source?.amount) || stale(source) || source.lastError) return null;
    const end = Date.parse(source.observedAt), target = end - 3600000;
    const candidates = state.samples.filter(s => s[key]?.observedAt &&
      finite(s[key].amount) && Math.abs(Date.parse(s[key].observedAt) - target) <= 15 * 60000);
    candidates.sort((a, b) => Math.abs(Date.parse(a[key].observedAt) - target) - Math.abs(Date.parse(b[key].observedAt) - target));
    return candidates.length ? source.amount - candidates[0][key].amount : null;
  }
  function setMoney(id, amount, primary = false) {
    const el = $(id);
    el.textContent = finite(amount) ? compact(amount) + (primary ? '' : ' USD') : '—';
    el.title = full(amount);
  }
  function showNotice(message, critical = false) {
    $('notice').hidden = !message;
    $('notice').textContent = message || '';
    $('notice').classList.toggle('critical', critical);
  }
  function paintAlerts() {
    $('enable-alert').setAttribute('aria-pressed', String(alertsEnabled));
    $('enable-alert').textContent = alertsEnabled ? '页面提醒已启用 ✓' : '启用页面提醒';
    const source = state.latest?.sources?.bitget;
    const threshold = Number($('threshold').value);
    const ratio = finite(source?.amount) && source.cap > 0 ? source.amount / source.cap * 100 : null;
    const valid = source && !stale(source) && !source.lastError;
    const triggered = alertsEnabled && valid && ratio !== null && ratio >= threshold;
    const ended = source?.endAt && Date.now() >= Date.parse(source.endAt);
    document.title = triggered && !ended ? '⚑ 额度接近上限 · Anthropic 监控' : 'Anthropic 认购额度监控';
    $('alert-detail').textContent = alertsEnabled ? `已设为 ${threshold}%。提醒仅在页面打开时生效，数据延迟或抓取失败时请核对官网。` : '提醒仅在此页面打开时生效，采集会在后台持续进行。';
    const failed = keys.filter(k => state.latest?.sources?.[k]?.lastError || (state.latest && stale(state.latest.sources?.[k])));
    if (state.readError) showNotice('暂时无法读取网站更新，正在保留上次显示的数据。请检查网络后重试。');
    else if (failed.length) showNotice(failed.map(k => k === 'bitget' ? 'Bitget' : 'Gate').join('、') + ' 数据延迟或采集失败。当前保留上次成功值，请打开官网核对额度。');
    else if (triggered && !ended) showNotice(`额度提醒：Bitget 公开轮使用率已达 ${ratio.toFixed(2)}%，剩余 ${full(Math.max(0, source.cap - source.amount))}。请在官方页面确认当前可用额度。`, true);
    else showNotice(null);
  }
  $('enable-alert').addEventListener('click', () => {
    alertsEnabled = !alertsEnabled;
    storage.set('anthropic-alerts', String(alertsEnabled));
    paintAlerts();
  });
  $('threshold').addEventListener('change', () => {
    storage.set('anthropic-threshold', $('threshold').value);
    paintAlerts();
  });

  function paint() {
    if (!state.latest) { paintAlerts(); return; }
    const sources = state.latest.sources;
    const healthy = keys.every(k => sources[k] && !stale(sources[k]) && !sources[k].lastError);
    $('health').className = 'status ' + (healthy ? '' : 'warning');
    $('health').replaceChildren(Object.assign(document.createElement('i'), {}), document.createTextNode(healthy ? '两家数据已更新' : '部分数据需核对'));
    $('checked-at').textContent = '最近采集 ' + time(state.latest.generatedAt) + ' · 约每15分钟更新';
    keys.forEach(key => {
      const s = sources[key];
      if (!s) return;
      setMoney(key + '-amount', s.amount);
      $(key + '-people').textContent = finite(s.participants) ? s.participants.toLocaleString('en-US') + ' 人' : '—';
      const delta = hourlyDelta(key, s);
      $(key + '-hour').textContent = delta === null ? '记录积累中' : compact(delta, true) + ' USD';
      $(key + '-hour').title = delta === null ? '需积累接近一小时的有效观测' : '与接近一小时前的观测相比，允许前后15分钟采样差';
      $(key + '-end').textContent = time(s.endAt);
      $(key + '-countdown').textContent = countdown(s.endAt);
      $(key + '-observed').textContent = '数据时间 ' + time(s.observedAt);
      const ended = s.endAt && Date.now() >= Date.parse(s.endAt);
      const tag = $(key + '-status');
      tag.textContent = stale(s) || s.lastError ? '数据待核对' : ended ? '认购已截止' : '认购进行中';
      tag.className = 'round-tag' + (!ended && !stale(s) && !s.lastError ? ' active' : '');
      if (s.lastError) $(key + '-observed').title = '最近采集失败；保留上次有效观测。';
    });
    const b = sources.bitget;
    if (finite(b?.amount) && b.cap > 0) {
      const ratio = b.amount / b.cap * 100, remaining = Math.max(0, b.cap - b.amount);
      setMoney('remaining', remaining, true);
      $('utilization').textContent = ratio.toFixed(2) + '%';
      $('cap-label').textContent = '总上限 $' + compact(b.cap);
      $('capacity-fill').style.width = Math.min(100, Math.max(0, ratio)) + '%';
      $('capacity').setAttribute('aria-valuenow', String(Math.min(100, ratio)));
      $('capacity').className = 'capacity-track' + (ratio >= 100 ? ' full' : ratio >= 90 ? ' warning' : '');
      $('capacity-caption').textContent = ratio >= 100 ? '页面统计已达到总认购上限，请核对官网。' : '尚余 ' + Math.max(0, 100 - ratio).toFixed(2) + '% 额度 · 以上限减已申购金额计算';
    } else {
      $('remaining').textContent = '上限未知';
      $('capacity-caption').textContent = '尚未读取到有效总上限，无法计算剩余额度。';
    }
    const gate = sources.gate;
    if (gate?.cap > 0 && finite(gate.amount)) {
      const panel = document.querySelector('.unknown-cap');
      panel.replaceChildren(document.createTextNode(compact(Math.max(0, gate.cap - gate.amount)) + ' USD'));
      document.querySelector('.unknown-note p').textContent = '官方已公布总上限 ' + full(gate.cap) + '，当前使用率 ' + (gate.amount / gate.cap * 100).toFixed(2) + '%。';
    }
    paintAlerts();
    paintChart();
    paintHistory();
    $('export').disabled = state.samples.length === 0;
  }

  function paintChart() {
    const all = state.samples;
    const end = all.length ? Date.parse(all[all.length - 1].timestamp) : Date.now();
    const samples = all.filter(s => !state.range || Date.parse(s.timestamp) >= end - state.range * 3600000);
    $('chart').replaceChildren();
    $('chart-caption').textContent = '历史从首次成功采集开始记录 · 已记录 ' + all.length + ' 次观测 · 缺失数据不补零';
    if (samples.length < 2) {
      const box = document.createElement('div'); box.className = 'chart-empty';
      const strong = document.createElement('b'); strong.textContent = samples.length ? '首条数据已记录' : '等待首次有效观测';
      const hint = document.createElement('span'); hint.textContent = '累积更多采集记录后显示资金走势';
      box.append(strong, hint); $('chart').append(box); return;
    }
    const W = 1000, H = 260, left = 63, right = 18, top = 22, bottom = 35;
    const maxAmount = Math.max(...samples.flatMap(s => keys.map(k => s[k]?.amount).filter(finite)), 1);
    const ceiling = Math.ceil(maxAmount / 1e6) * 1e6;
    const first = Date.parse(samples[0].timestamp), span = Math.max(1, end - first);
    const x = stamp => left + (Date.parse(stamp) - first) / span * (W - left - right);
    const y = n => H - bottom - n / ceiling * (H - top - bottom);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none');
    function el(name, attrs, text) { const e = document.createElementNS(ns, name); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); if (text !== undefined) e.textContent = text; svg.append(e); return e; }
    for (let i = 0; i <= 4; i++) {
      const value = ceiling * i / 4;
      el('line', { x1: left, x2: W - right, y1: y(value), y2: y(value), class: 'gridline' });
      el('text', { x: left - 12, y: y(value) + 4, 'text-anchor': 'end' }, (value / 1e4).toLocaleString('en-US', { maximumFractionDigits: 0 }));
    }
    [0, .25, .5, .75, 1].forEach((f, i) => el('text', { x: left + f * (W - left - right), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle' }, time(new Date(first + span * f).toISOString(), false)));
    keys.forEach(key => {
      const color = key === 'bitget' ? 'var(--teal)' : 'var(--blue)';
      let segment = [];
      function draw() { if (segment.length > 1) el('polyline', { points: segment.join(' '), stroke: color, fill: 'none', 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }); segment = []; }
      samples.forEach(s => {
        if (!finite(s[key]?.amount)) { draw(); return; }
        const px = x(s.timestamp), py = y(s[key].amount);
        segment.push(`${px},${py}`);
        const dot = el('circle', { cx: px, cy: py, r: 3.5, fill: color });
        const title = document.createElementNS(ns, 'title'); title.textContent = `${key === 'bitget' ? 'Bitget 公开轮' : 'Gate'} · ${time(s[key].observedAt)} · ${full(s[key].amount)}`; dot.append(title);
      }); draw();
    });
    $('chart').append(svg);
  }
  document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => {
    state.range = Number(button.dataset.range);
    document.querySelectorAll('[data-range]').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
    paintChart();
  }));

  function paintHistory() {
    $('history').replaceChildren();
    const records = state.samples.slice(-10).reverse();
    if (!records.length) {
      const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 5; td.className = 'empty'; td.textContent = '尚无有效观测，等待后台采集。'; tr.append(td); $('history').append(tr); return;
    }
    records.forEach(s => {
      const tr = document.createElement('tr');
      const remaining = finite(s.bitget?.amount) && s.bitget.cap > 0 ? Math.max(0, s.bitget.cap - s.bitget.amount) : null;
      [time(s.timestamp), full(s.bitget?.amount), full(remaining), full(s.gate?.amount)].forEach(value => { const td = document.createElement('td'); td.textContent = value; tr.append(td); });
      const status = document.createElement('td'), badge = document.createElement('span');
      badge.className = s.bitget && s.gate ? 'ok' : 'partial'; badge.textContent = s.bitget && s.gate ? '两家成功' : '部分成功'; status.append(badge); tr.append(status); $('history').append(tr);
    });
  }
  $('export').addEventListener('click', () => {
    const rows = [['采集时间(UTC)', '采集时间(北京)', 'Bitget公开轮金额USD', 'Bitget公开轮上限USD', 'Bitget剩余额度USD', 'Bitget参与人数', 'Bitget源数据时间UTC', 'Gate金额USD', 'Gate参与人数', 'Gate源数据时间UTC']];
    state.samples.forEach(s => rows.push([s.timestamp, time(s.timestamp), s.bitget?.amount ?? '', s.bitget?.cap ?? '', s.bitget?.cap > 0 ? Math.max(0, s.bitget.cap - s.bitget.amount) : '', s.bitget?.participants ?? '', s.bitget?.observedAt ?? '', s.gate?.amount ?? '', s.gate?.participants ?? '', s.gate?.observedAt ?? '']));
    const csv = '\ufeff' + rows.map(row => row.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'anthropic-public-subscriptions.csv'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  async function load() {
    if (state.loading) return;
    state.loading = true; $('refresh').disabled = true; $('refresh').textContent = '正在检查…';
    try {
      const stamp = Date.now();
      const [latest, history] = await Promise.all(['latest', 'history'].map(async name => {
        const response = await fetch(`data/${name}.json?t=${stamp}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      }));
      if (latest.schemaVersion !== 1 || latest.scope !== 'public' || !latest.sources || !Array.isArray(history.samples)) throw new Error('Invalid data schema');
      state.latest = latest; state.samples = history.samples.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp)); state.readError = null;
      paint();
    } catch (error) {
      state.readError = error;
      if (!state.latest) { $('health').className = 'status warning'; $('health').textContent = '数据暂时不可用'; $('checked-at').textContent = '请稍后重试或查看官方页面'; }
      paintAlerts();
    } finally { state.loading = false; $('refresh').disabled = false; $('refresh').textContent = '↻ 检查更新'; }
  }
  $('refresh').addEventListener('click', load);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  setInterval(load, 60000);
  setInterval(() => {
    if (!state.latest) return;
    keys.forEach(k => { $(k + '-countdown').textContent = countdown(state.latest.sources[k]?.endAt); });
    paintAlerts();
  }, 10000);
  paintAlerts(); load();
})();
