# SSTV IPTV

A production-oriented, mobile-first IPTV guide that imports one M3U playlist and one XMLTV guide, stores normalized data in SQLite, and serves a React PWA from an Express API.

## Features

- M3U and XMLTV ingestion with channel matching by `tvg-id`, `tvg-name`, normalized name, then conservative fuzzy match.
- Transaction-safe refreshes with run history, manual admin refresh, and scheduled refresh checks.
- Admin login from environment variables.
- Plex OAuth for regular users with configured server access validation.
- Channel browsing, groups, current airing view, search, favorites, and channel playback.
- Desktop HLS playback with `hls.js`; mobile opens streams natively.
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

Then deploy with the same `.env` values from `.env.example`.
The Portainer compose file includes an inline `environment` block, so you can paste it directly into a stack and set variables in Portainer.

On Linux, if Docker-created files are owned by root:

```bash
sudo chown -R $USER:$USER data cache
```

## Configuration

Edit `.env` before starting, or use the admin page after the first login.

Required for guide imports:

- `M3U_URL`
- `XMLTV_URL`

Required for Plex user login:

- `PLEX_SERVER_IDENTIFIER`
- `PLEX_CLIENT_IDENTIFIER`
- `PLEX_TOKEN` for admin status checks

Admin login uses:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

Set a long random `SESSION_SECRET` before exposing the app.

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
