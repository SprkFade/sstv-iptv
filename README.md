# SSTV IPTV

A production-oriented, mobile-first IPTV guide that imports live channels from an XtremeCodes login, pairs them with XMLTV guide data, stores normalized data in SQLite, and serves a React PWA from an Express API.

## Features

- XtremeCodes and XMLTV ingestion with channel matching by EPG id, channel name, normalized name, then conservative fuzzy match.
- Transaction-safe refreshes with run history, manual admin refresh, and scheduled refresh checks.
- First-launch setup wizard for admin credentials, XtremeCodes login, guide settings, refresh cadence, and Plex server selection.
- Plex OAuth for regular users with configured server access validation.
- Channel browsing, groups, current airing view, search, favorites, and channel playback.
- Desktop and mobile playback through FFmpeg-generated live HLS, with raw diagnostic links available from playback errors.
- Installable PWA shell with cached static assets.
- SQLite data and cache directories persisted through bind mounts only.

## Setup

```bash
mkdir -p data cache
cp .env.example .env
docker compose up -d --build
```

Open [http://localhost:3025](http://localhost:3025).

## Portainer / GHCR

For Portainer stacks, use `docker-compose.portainer.yml` or this image:

```text
ghcr.io/sprkfade/sstv-iptv:latest
```

If GHCR shows the package as private, add a GHCR registry in Portainer with:

- Registry URL: `ghcr.io`
- Username: `SprkFade`
- Password/token: a GitHub token with `read:packages`

The included Docker GitHub Action is manual by default. If you want it to publish future images with `GITHUB_TOKEN`, open the GHCR package settings and add `SprkFade/sstv-iptv` under "Manage Actions access" with write access.

Create bind-mount directories on the host first:

```bash
mkdir -p data cache
```

Then deploy with the runtime values from `.env.example`.
The Portainer compose file includes a minimal inline `environment` block. App setup values are collected by the first-launch wizard in the browser.

On Linux, if Docker-created files are owned by root:

```bash
sudo chown -R $USER:$USER data cache
```

## Configuration

Edit `.env` before starting, then finish setup in the launch wizard.

The launch wizard collects:

- admin username and password
- XtremeCodes server URL, username, and password
- XMLTV guide URL, optional; blank uses the XtremeCodes XMLTV endpoint
- refresh interval
- Plex login, server selection, and token storage

Set a long random `SESSION_SECRET` before exposing the app.

`FFMPEG_PATH` defaults to `ffmpeg`. The published Docker image includes FFmpeg for desktop live transcoding. `FFMPEG_LOG_LEVEL` defaults to `info`; use `verbose` or `debug` temporarily when diagnosing stream lockups. `FFMPEG_USER_AGENT` defaults to a VLC-style user agent for IPTV provider compatibility.

Stream proxy defaults can be set with `FFMPEG_HLS_INPUT_MODE`, `FFMPEG_RECONNECT_DELAY_MAX`, `FFMPEG_RW_TIMEOUT_SECONDS`, and `FFMPEG_STALE_RESTART_SECONDS`, then edited later from the Admin page. Direct FFmpeg input is the default; switch to `pipe` only if a provider behaves better through the Node fallback.

## Data Persistence

The compose file uses bind mounts only:

- `./data:/app/data` stores `sstv-iptv.sqlite`
- `./cache:/app/cache` is reserved for cached runtime assets

The server creates both runtime directories on startup.

## Development

```bash
npm install
npm run dev
```

The API runs on port `3025`; Vite runs on `5173` and proxies `/api`.

## API Summary

- `GET /api/setup/status`
- `GET /api/setup/defaults`
- `POST /api/setup/plex/pin`
- `GET /api/setup/plex/pin/:id`
- `POST /api/setup/complete`
- `POST /api/auth/admin/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/plex/pin`
- `GET /api/auth/plex/pin/:id`
- `GET /api/admin/settings`
- `PUT /api/admin/settings`
- `POST /api/admin/refresh`
- `GET /api/admin/refresh-runs`
- `GET /api/admin/users`
- `GET /api/channels`
- `GET /api/guide/current`
- `GET /api/guide/channel/:id`
- `GET /api/search`
- `GET /api/favorites`
- `POST /api/favorites/:channelId`
- `DELETE /api/favorites/:channelId`
