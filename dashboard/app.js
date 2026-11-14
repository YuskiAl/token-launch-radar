// Token Radar's page: the ranked board, a filterable table, a per-protocol detail view with the
// model's own breakdown and the farm plan, the live-token set aside, and the model stated in full.
//
// The page renders with no network. It reads window.RADAR (data.js, written by main.ts from the
// same board board.json holds) and recomputes every row's implied value from the snapshot figures
// with the formula below, so the numbers on screen are the formula's numbers, not a pasted list.
//
//   implied = TVL x 0.30 x (1 + growth% x w) x (0.55 + 0.45 x ln(1 + age) / ln(1096))
//   growth% is the 7-day TVL change clamped to -70..+150; w is 0.6 when growth is up, 0.9 when
//   it is down, so a fall costs more than the same rise gains. age is the days since the protocol
//   was first listed; an unknown age uses the median age of the board. No name is special-cased.

(function () {
  var DATA = window.RADAR;
  var state = { q: '', category: 'all', chain: 'all', wl: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function fmtUsd(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + String(Math.round(n));
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days, known) {
    if (!known || days === null || days === undefined) return 'unknown';
    return days + ' d';
  }
  function fmtMult(n) { return n.toFixed(2) + 'x'; }

  /** The model's own recompute of one row, from the snapshot figures the row carries. */
  function impliedOf(row) {
    var m = DATA.model;
    var growth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    growth = Math.min(m.growth_cap, Math.max(m.growth_floor, growth));
    var w = growth >= 0 ? m.growth_up_weight : m.growth_down_weight;
    var growthMult = 1 + (growth / 100) * w;
    var ageUsed = row.age_known && row.age_days !== null ? row.age_days : DATA.median_age_days;
    var maturityMult = m.maturity_floor + (Math.log(1 + Math.min(Math.max(ageUsed, 0), m.maturity_days * 4)) / Math.log(1 + m.maturity_days)) * m.maturity_range;
    var base = row.tvl_usd * m.base_multiple;
    var implied = Math.max(1, Math.round(base * growthMult * maturityMult));
    return { base: base, growthPct: growth, growthMult: growthMult, maturityMult: maturityMult, ageUsed: ageUsed, implied: implied };
  }

  /** How many rows recompute to the board's own implied value: the page checks itself. */
  var CHECK = (function () {
    var ok = 0;
    DATA.rows.forEach(function (r) { if (impliedOf(r).implied === r.implied_value_usd) ok++; });
    return { ok: ok, total: DATA.rows.length };
  })();

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (k === 'class') node.className = attrs[k];
        else if (attrs[k] === null || attrs[k] === undefined) { /* skip */ }
        else node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
      else if (typeof child === 'string' || typeof child === 'number') node.appendChild(document.createTextNode(String(child)));
      else if (child) node.appendChild(child);
    }
    return node;
  }

  var watchlistSet = new Set();
  // The watchlist is the floor: the builder marks every watchlist row in data.js.
  DATA.rows.forEach(function (r) { if (r.on_watchlist) watchlistSet.add(r.slug); });

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    state.selected = null;
    if (hash.indexOf('/p/') === 0) {
      state.selected = decodeURIComponent(hash.slice(3));
      return;
    }
    if (hash.indexOf('/?') === 0) {
      var params = new URLSearchParams(hash.slice(2));
      state.q = params.get('q') || '';
      state.category = params.get('cat') || 'all';
      state.chain = params.get('chain') || 'all';
      state.wl = params.get('wl') === '1';
      state.tab = params.get('tab') || 'pre-token';
    }
  }
  function writeHash() {
    if (state.selected) { window.location.hash = '#/p/' + encodeURIComponent(state.selected); return; }
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('cat', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.wl) params.set('wl', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    var s = params.toString();
    window.location.hash = s ? '#/?' + s : '#/';
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.wl && !watchlistSet.has(r.slug)) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var d = 0;
      if (key === 'name') d = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      else if (key === 'tvl') d = a.tvl_usd - b.tvl_usd;
      else if (key === 'growth') d = (a.change_7d || 0) - (b.change_7d || 0);
      else if (key === 'age') d = (a.age_days || 0) - (b.age_days || 0);
      else d = a.implied_value_usd - b.implied_value_usd;
      if (d === 0) d = a.rank - b.rank;
      return d * state.dir;
    });
  }

  function header() {
    return el('div', { class: 'shell' },
      el('div', { class: 'top' },
        el('div', null,
          el('p', { class: 'eyebrow', text: 'Token Radar · ' + DATA.model_version }),
          el('h1', { text: 'Pre-token protocols, ranked by implied value' }),
          el('p', { class: 'lede', text: 'Every protocol in the snapshot with no token yet, scored by one formula from its own TVL, seven-day growth and age. A launch is what the record is worth, not a prediction of when it comes.' })),
        el('span', { class: 'badge' + (CHECK.ok === CHECK.total ? ' good' : ' warn'), text: CHECK.ok === CHECK.total ? 'model check ' + CHECK.ok + '/' + CHECK.total : 'model check ' + CHECK.ok + '/' + CHECK.total + ' — mismatch' })));
  }

  function facts() {
    return el('div', { class: 'facts' },
      el('div', { class: 'fact' }, el('span', { text: 'Board rows' }), el('b', { text: String(DATA.board_size) })),
      el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
      el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
      el('div', { class: 'fact' }, el('span', { text: 'Snapshot date' }), el('b', { text: DATA.as_of })));
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains); }, []))).sort();
    var search = el('input', { type: 'search', placeholder: 'Search a protocol…', value: state.q, 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { 'aria-label': 'Category' },
      [el('option', { value: 'all', text: 'All categories' })].concat(categories.map(function (c) {
        return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null });
      })));
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = el('select', { 'aria-label': 'Chain' },
      [el('option', { value: 'all', text: 'All chains' })].concat(chains.map(function (c) {
        return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null });
      })));
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', checked: state.wl ? 'checked' : null, id: 'wl-only' });
    wl.addEventListener('change', function () { state.wl = wl.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field grow' }, el('span', { class: 'sub', text: 'Search' }), search),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Chain' }), chain),
      el('label', { class: 'check', for: 'wl-only' }, wl, el('span', { text: 'Watchlist only' })),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? filteredRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' }));
  }

  function sortHeader(key, label) {
    return el('th', { class: key === 'name' ? '' : 'num' },
      el('button', { class: 'sortbtn', type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null));
  }

  function openDetail(slug) { state.selected = slug; writeHash(); render(); window.scrollTo(0, 0); }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { class: 'sub', text: 'Loosen the search or clear a filter to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; writeHash(); render(); } }));
    }
    var body = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? el('td', { class: 'num', text: '—' }) : el('td', { class: 'num ' + (r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) });
      body.appendChild(el('tr', { class: state.selected === r.slug ? 'selected' : null, tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        el('td', { class: 'num', text: '#' + r.rank }),
        el('td', null, el('b', { text: r.name }), ' ', watchlistSet.has(r.slug) ? el('span', { class: 'tag wl', text: 'watchlist' }) : null),
        el('td', { text: r.category || 'Other' }),
        el('td', { text: r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        growth,
        el('td', { class: 'num', text: fmtAge(r.age_days, r.age_known) }),
        el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) })));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'tablewrap' },
        el('table', null,
          el('caption', { text: 'Ranked by implied value, highest first. Click a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            el('th', { text: 'Category' }),
            el('th', { text: 'Chains' }),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'))),
          body)));
  }

  function detailPanel() {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === state.selected) row = r; });
    if (!row) return el('div', { class: 'panel' }, el('h2', { text: 'Protocol not found' }), el('p', { class: 'sub', text: 'That slug is not on this board.' }));
    var m = impliedOf(row);
    var why = row.change_7d !== null && row.change_7d >= 20
      ? 'Its TVL is growing fast, and it has run ' + (row.age_known ? row.age_days + ' days' : 'a long time') + ' with no token: the record, not the name, puts it here.'
      : row.change_7d !== null && row.change_7d < 0
      ? 'Its TVL is falling, which the model prices in, but its size and its age with no token keep it on the board.'
      : 'Its size and its age with no token carry the rank: steady TVL, long wait, no token yet.';
    var bar = function (label, value, max, neg) {
      var pct = Math.max(2, Math.min(100, (value / max) * 100));
      return el('div', null,
        el('div', { class: 'kv' }, el('dt', { text: label }), el('dd', { text: fmtMult(value) })),
        el('div', { class: 'bar' }, el('i', { class: neg ? 'neg' : null, style: 'width:' + pct + '%' })));
    };
    var steps = el('ol', { class: 'steps' });
    row.farm_steps.forEach(function (s, i) {
      var parts = s.split(' Cost: ');
      var main = parts[0] || s;
      var rest = parts[1] ? parts[1].split(' Time: ') : [];
      steps.appendChild(el('li', null,
        el('span', { class: 'n', text: String(i + 1) }),
        el('div', null, el('p', { text: main }), el('p', { class: 'meta', text: (rest[0] ? 'Cost: ' + rest[0] : '') + (rest[1] ? ' · Time: ' + rest[1] : '') }))));
    });
    return el('div', { class: 'panel' },
      el('button', { class: 'button', type: 'button', text: '← Back to the board', onclick: function () { state.selected = null; writeHash(); render(); } }),
      el('h2', { text: '#' + row.rank + ' ' + row.name }),
      el('p', null,
        el('span', { class: 'tag', text: row.category || 'Other' }), ' ',
        el('span', { class: 'tag', text: row.chains.join(', ') || 'no chain listed' }), ' ',
        watchlistSet.has(row.slug) ? el('span', { class: 'tag wl', text: 'on the watchlist' }) : null),
      el('p', { class: 'lede', text: why }),
      el('div', { class: 'detail-grid' },
        el('div', null,
          el('h3', { text: 'Why this value' }),
          el('dl', { class: 'kv' },
            el('dt', { text: 'TVL' }), el('dd', { text: fmtUsd(row.tvl_usd) }),
            el('dt', { text: 'Base (TVL x 0.30)' }), el('dd', { text: fmtUsd(m.base) }),
            el('dt', { text: '7-day change' }), el('dd', { text: fmtPct(row.change_7d) }),
            el('dt', { text: 'Age' }), el('dd', { text: fmtAge(row.age_days, row.age_known) + (row.age_known ? '' : ' (median ' + DATA.median_age_days + ' d used)') }),
            el('dt', { text: 'Implied value' }), el('dd', { text: fmtUsd(row.implied_value_usd) })),
          bar('Growth multiplier', m.growthMult, 2, m.growthMult < 1),
          bar('Maturity multiplier', m.maturityMult, 1.2, false)),
        el('div', null,
          el('h3', { text: 'How to farm it' }),
          steps)));
  }

  function liveTable() {
    var body = el('tbody');
    DATA.live.forEach(function (r) {
      body.appendChild(el('tr', null,
        el('td', null, el('b', { text: r.name })),
        el('td', { text: r.category || 'Other' }),
        el('td', { text: r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num ' + ((r.change_7d || 0) >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) })));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'tablewrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'Chains' }),
            el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: '7d' }))),
          body)));
  }

  function modelPanel() {
    var m = DATA.model;
    return el('div', { class: 'panel' },
      el('h2', { text: 'How the value is scored' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('pre', { class: 'formula', text: 'implied = TVL x ' + m.base_multiple + ' x (1 + growth% x w) x (' + m.maturity_floor + ' + ' + m.maturity_range + ' x ln(1 + age) / ln(' + (m.maturity_days + 1) + '))\n' +
        'growth% = 7-day TVL change, clamped to ' + m.growth_floor + '..+' + m.growth_cap + '; w = ' + m.growth_up_weight + ' up, ' + m.growth_down_weight + ' down\n' +
        'age = days since first listed; unknown age uses the board median of ' + DATA.median_age_days + ' days' }),
      el('p', { class: 'sub', text: 'The board ranks every genuine pre-token protocol: the whole watchlist plus every other pre-token protocol below the floor. Left out, on purpose: wrapped, staked and bridged products of a protocol whose token already trades, exchanges, and versioned pools. A launch is what the record is worth; the model never says whether or when a token comes.' }),
      el('p', { class: 'sub', text: 'Source: the sealed snapshot as of ' + DATA.as_of + ', ' + DATA.board_size + ' rows scored, ' + DATA.live_size + ' live-token protocols set aside.' }));
  }

  function render() {
    var main = document.getElementById('board');
    main.setAttribute('aria-busy', 'false');
    while (main.firstChild) main.removeChild(main.firstChild);
    var shell = header();
    shell.appendChild(facts());
    if (state.selected) shell.appendChild(detailPanel());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'live' ? liveTable() : boardTable());
    shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'foot', text: 'Token Radar ' + DATA.model_version + ' · snapshot ' + DATA.as_of + ' · implied values are the entry\u2019s own claim, never a promise of a launch.' }));
    main.appendChild(shell);
  }

  window.addEventListener('hashchange', function () { readHash(); render(); });
  readHash();
  render();
})();
