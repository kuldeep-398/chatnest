# 🪺 ChatNest

A self-hosted, real-time 1-to-1 text chat app with a WhatsApp-Web-style UI. The backend runs on **your own MacBook**; friends reach it through a **Cloudflare Tunnel** or **ngrok** URL. All chat data stays in a local SQLite file, and messages **auto-delete after 24 hours**.

## Features
- Register / log in with JWT (SimpleJWT, auto-refresh). Usernames are unique (case-insensitive).
- Friend requests by username: send, accept, reject, see incoming and outgoing. Only accepted friends can chat.
- Real-time messaging over WebSockets (Django Channels + daphne). Each message is saved to the DB, then broadcast.
- Online/offline presence with "last seen". A per-user connection count means multiple tabs work.
- Typing indicator ("X is typing…"): debounced, and it clears on its own.
- Read receipts: ✓ sent, blue ✓✓ seen. A message counts as seen when the recipient has the chat open and visible, and the sender's view updates live.
- Live unread badges per conversation in the sidebar.
- Auto-delete: messages older than `MESSAGE_TTL_HOURS` (default 24) are purged on startup and then every hour by a background thread. There is also a `purge_old_messages` management command.
- Admin export (staff only): list conversations, export one as a `.txt` file (timestamps in IST, Asia/Kolkata), or export everything as a `.zip`. The backend enforces `IsAdminUser`.
- A "Server offline – reconnecting…" banner, with exponential-backoff reconnect.
- Responsive WhatsApp-like UI. On mobile you see the chat list first, then a full-screen chat with a back arrow.

## Architecture
```
Browser (React 18 + Vite + Tailwind v4)
   │  HTTPS  /api/...      → Django REST Framework (JWT)
   │  WSS    /ws/notifications/       → presence, unread, friend events (per user)
   │  WSS    /ws/chat/<conversation>/ → messages, typing, seen
   ▼
daphne (ASGI) ── Django 5 + Channels (InMemoryChannelLayer) ── SQLite (db.sqlite3)
                 └─ background purge thread (MESSAGE_TTL_HOURS)
```
- WebSocket auth: `?token=<access JWT>` is checked by a custom Channels middleware (`chat/middleware.py`).
- Groups: `user_<id>` for notifications and `chat_<id>` for each conversation.
- Django also serves the built frontend (`frontend/dist`) through a catch-all route, so **one URL / one tunnel serves everything**.
- InMemoryChannelLayer means you must run a single server process. That is the right fit for a laptop.

```
backend/   config/ (settings, asgi, urls)   chat/ (models, consumers, views, middleware, services, tests)
frontend/  src/ (pages, components, lib/api.js, lib/useSocket.js)
```

## Setup on macOS (Python 3.13)
### 1. Backend
```bash
cd chatnest/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then set SECRET_KEY (e.g. python3 -c "import secrets;print(secrets.token_urlsafe(50))")
python manage.py migrate
python manage.py createsuperuser   # this account can use the Admin export page
```

### 2. Frontend (build once; Django serves it)
```bash
cd ../frontend
npm install
npm run build        # creates frontend/dist, which Django serves automatically
```

### 3. Run
```bash
cd ../backend && source venv/bin/activate
python manage.py runserver 8000      # 'daphne' is in INSTALLED_APPS, so this runs the ASGI server
# or: daphne -b 0.0.0.0 -p 8000 config.asgi:application
```
Open http://localhost:8000.

**Dev mode (hot reload):** keep Django running and run `npm run dev` in `frontend/`, then open http://localhost:5173. Vite proxies `/api` and `/ws` to port 8000.

## Share with friends (single URL)
### Cloudflare Tunnel (free, no account needed for quick tunnels)
```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:8000
```
It prints a URL like `https://random-words.trycloudflare.com`. Send that to your friends.

### ngrok
```bash
brew install ngrok
ngrok config add-authtoken <your-token>
ngrok http 8000
```

`.trycloudflare.com`, `.ngrok-free.app` and `.ngrok.io` are already in the default `ALLOWED_HOSTS`. If you use a custom domain, add it to `ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS` in `.env`. WebSockets work automatically over `wss://` through both tunnels.

### How friends join
1. They open your tunnel URL and click **Create an account**.
2. One of you adds the other by username (👥 icon → *Add friend*), and the other accepts.
3. Start chatting.

> ⚠️ Chat only works while your laptop is on, awake and running the server and tunnel. Quick-tunnel URLs change each time you restart `cloudflared`. Use a named tunnel or a reserved ngrok domain if you want a stable URL. If you set `DEBUG=False`, keep using the commands above; Django serves the SPA itself.

## Configuration
| Backend `.env` | Purpose |
|---|---|
| `SECRET_KEY` | Django/JWT signing key (required in production) |
| `DEBUG` | `True`/`False` |
| `ALLOWED_HOSTS` | Comma-separated list of hosts |
| `CORS_ALLOWED_ORIGINS` | Needed only when the frontend is on a different origin |
| `CSRF_TRUSTED_ORIGINS` | Your tunnel origin(s), for the Django admin |
| `MESSAGE_TTL_HOURS` | Message lifetime (default 24) |
| `PURGE_INTERVAL_SECONDS` | How often the purge runs (default 3600) |

Frontend `.env` (optional): `VITE_API_URL` and `VITE_WS_URL`. Leave them empty to use the page's own origin, which is what the single-URL setup needs.

Manual purge: `python manage.py purge_old_messages [--hours 24]`

## Tests
```bash
cd backend && source venv/bin/activate && python manage.py test chat
```
The tests cover registration, the friend request flow, non-friends being refused on the WebSocket, message send/typing/seen/presence through the Channels `WebsocketCommunicator` with JWT, the purge deleting messages older than 24h, and admin-only export.
