# Token Radar — pre-token protocols ranked by implied value

An entry for make.fun's `token-radar-01` bounty: a program that reads a sealed
DefiLlama snapshot, ranks every genuine pre-token protocol by an implied value,
and hands the reader a dashboard with a farm plan for each one.

## The model (`radar-2`, in `lib/model.ts`)

```
implied = TVL x 0.30 x (1 + growth% x w) x (0.55 + 0.45 x ln(1 + age) / ln(1096))
```

- `growth%` is the 7-day TVL change, clamped to -70..+150. `w` is 0.6 when growth
  is up and 0.9 when it is down: a fall costs more than the same rise gains.
- `age` is the days since the protocol was first listed: how long it has run with
  no token. The curve is logarithmic: the first year of waiting says far more
  than the third. An unknown age uses the board's median age.
- The board ranks every genuine pre-token protocol: the whole 40-protocol
  watchlist plus every other pre-token protocol below the floor. Left out, on
  purpose: wrapped, staked and bridged products of a protocol whose token
  already trades, exchanges, and versioned pools.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

`main.ts` (Node 22, standard library only) writes `out/board.json`,
`out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`.

## The dashboard

A static page, no network: a sortable, filterable board, a detail view per
protocol with the model's breakdown and a six-step farm plan (each step with
its cost and time), the live-token protocols set aside with their market caps,
and the model stated in full. Open `out/dashboard/index.html` in a browser.
