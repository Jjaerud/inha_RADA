# RADA Honeycomb Panel

40 PC lab honeycomb status grid — custom Grafana panel plugin for RADA monitoring.

## Build

```
npm install
npm run build
```

Output: `dist/` (drop into Grafana plugins folder; unsigned plugin allow flag required).

## Usage in Grafana

1. Mount `dist/` at `/var/lib/grafana/plugins/rada-hexmap-panel/` (see repo root `docker-compose.yml`)
2. Set `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=rada-hexmap-panel`
3. Restart Grafana
4. In any dashboard, "Add panel" → search "RADA Honeycomb"

## Data shape

Expects a single Grafana data frame with one row per PC, columns:
- `pc_id` (string) — required
- `score` (number) — required, drives color when severity field absent
- `severity` (number 0~3 or string `NORMAL/LOW/MEDIUM/HIGH/OFFLINE`) — optional
- `cpu`, `gpu`, `mem` (number, %) — optional, shown in hover tooltip
- `hostname` (string) — optional

Field names are configurable in Panel options → Field mapping.
