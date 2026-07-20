# Multichat leaderboard + auth relay

Small Express service deployed on Render at `https://multichatapi.onrender.com`.
Sits between the private Discord bot and the public website.

- The **bot** pushes data here every few seconds using `Authorization: Bearer PUSH_SECRET`.
- The **website** reads leaderboard data with no auth (`GET /leaderboard/:kind`).
- The **website** lets a user sign in with their existing bot API key
  (`POST /auth/login`), which is checked against a hash the bot pushed —
  the relay never sees or stores raw API keys.

## Deploy on Render

1. Push this `leaderboard-server/` folder to its own GitHub repo (or point
   Render at a subdirectory of this repo).
2. New Web Service on Render → connect the repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. Add an environment variable `PUSH_SECRET` set to a long random string.
4. Set the same value as `LEADERBOARD_PUSH_SECRET` in the bot's environment
   (Discord bot host, e.g. also on Render), along with
   `LEADERBOARD_RELAY_URL=https://<your-relay>.onrender.com`.
5. Deploy. The bot will start pushing leaderboard + auth data within a few
   seconds of starting up.

## Endpoints

| Method | Path              | Auth              | Purpose |
|--------|-------------------|-------------------|---------|
| POST   | `/push/:kind`     | Bearer PUSH_SECRET | Bot pushes leaderboard entries |
| POST   | `/push/auth`      | Bearer PUSH_SECRET | Bot pushes `key_hash -> user` records |
| GET    | `/leaderboard/:kind` | none           | Website reads a leaderboard |
| POST   | `/auth/login`     | none (body: `api_key`) | Website signs a user in |
| GET    | `/auth/me`        | Bearer session token | Website checks current session |
| POST   | `/auth/logout`    | Bearer session token | Website signs out |

## Notes / limitations

- Storage is in-memory, mirrored to a local `data.json` as a best-effort
  cache. Render's free-tier disk is ephemeral, so a restart can lose data
  briefly — the bot re-pushes everything every few seconds, so this
  self-heals fast, but don't treat this as a durable database.
- Sessions are also in-memory and will be cleared on a relay restart —
  users would just need to sign in again.
