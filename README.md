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
- **End-to-end encryption** for all messages (browser Web Crypto API, no extra libraries). The server stores only ciphertext. See [End-to-end encryption](#end-to-end-encryption).
- "Verify encryption" panel in each chat header shows a safety number to compare with your friend.
- Export chat: anyone can export **their own** conversation as a readable `.txt` from the chat menu. It is decrypted in the browser. The admin page shows aggregate stats only; admins can no longer read or export chats.
- A "Reconnecting…" banner, with exponential-backoff reconnect.
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
python manage.py createsuperuser   # this account can open the Admin stats page
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
# Static files (Django admin CSS) are served by WhiteNoise. With DEBUG=True nothing extra is needed;
# with DEBUG=False run `python manage.py collectstatic --noinput` first (output: backend/staticfiles/).
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
The tests cover registration, the friend request flow, non-friends being refused on the WebSocket, message send/typing/seen/presence through the Channels `WebsocketCommunicator` with JWT, the purge deleting messages older than 24h, E2EE (the server never stores plaintext and rejects malformed or plaintext payloads, plus auth and validation on the key endpoints), the removed export endpoints (404), and the staff-only stats endpoint.

## End-to-end encryption
ChatNest encrypts every 1-to-1 message in the browser. The server only relays and stores data it cannot read. Everything is in `frontend/src/lib/e2ee.js` and uses only the built-in Web Crypto API.

**Keys per user**
1. On register (or the first login after this update, for older accounts), the browser generates an **ECDH P-256 key pair**.
2. It derives a *wrapping key* from your password with **PBKDF2-SHA256 (600,000 iterations, random 16-byte salt)**, then wraps (encrypts) the private key with **AES-GCM**.
3. It uploads the public key (JWK) plus the wrapped private key, salt, IV and iteration count (`PUT /api/keys/me/`). Your password and raw private key never leave the browser. The server only checks your password at login, through Django's normal hashed login.
4. On login on any device, the browser downloads the bundle and unwraps it with your password. The private key is kept as a **non-extractable** `CryptoKey`, meaning JavaScript can use it but cannot read its bytes. It is also cached in IndexedDB, so a page refresh does not ask for your password. If the cache is missing (site data cleared, or a different device after a refresh), you see an "Unlock your messages" screen. Logging out deletes the cached key.

**Keys per conversation**
`ECDH(my private key, friend's public key)` gives both people the same shared secret. Running **HKDF-SHA256** over it with `info = "conversation:<id>"` gives a 256-bit **AES-GCM** key for that chat.

**Messages**
Each message is encrypted with AES-GCM and a fresh random 12-byte IV. The socket carries `{ciphertext, iv}` (base64), and the `Message` table has only `ciphertext` and `iv` columns. There is no plaintext column, and the server rejects plaintext. The sidebar preview, the chat view and the export are all decrypted client-side.

**Safety number**
In the chat menu, open "Verify encryption". It shows SHA-256 of both public keys (sorted, so both sides compute the same value), formatted as 8 groups of 5 digits. If you and your friend see the same digits, you have each other's real keys and the server did not swap them.

**Password changes / resets**
- The app has no self-service password change. If one is added, it must re-wrap the private key with the new password: unwrap with the old password, wrap with the new one, then `PUT /api/keys/me/` with the same public key.
- If an admin resets a password (Django admin or `changepassword`), the old wrapped key can't be opened. On the next login the browser creates a **new key pair**, and messages encrypted under the old key show as "Unable to decrypt". The safety number also changes. Messages expire after 24h anyway.

**Limitations (be honest about what E2EE does not protect)**
- **Metadata is visible** to the server: who is friends with whom, who messages whom and when, message sizes, typing and seen events, and online status.
- **You must trust the JavaScript the server sends.** A malicious or compromised server could serve modified JS that leaks keys or plaintext. This is the basic limit of web-based E2EE.
- **Device compromise**: malware or a malicious browser extension on your device can read decrypted messages. Anyone with your password plus database access can unwrap your key, so use a strong password (PBKDF2 slows guessing but can't stop it).
- **Admins can no longer read chats.** The old server-side export endpoints were removed (`/api/admin/conversations/...` and `/api/admin/export-all/` now return 404). Each user can export only their own chats, in their own browser.
- No forward secrecy: one static key pair per user, with no ratchet. That's fine for a learning project, but Signal-style protocols do better.
- Web Crypto needs a secure context: `https://` (the tunnels provide it) or `http://localhost`. Opening the app over plain `http://<LAN-IP>` won't work.

**Upgrading an existing install:** run `python manage.py migrate`. Migration `0002_e2ee` **deletes all existing (plaintext) messages**, drops the `content` column, and adds `ciphertext`/`iv` and the `UserKey` table. Existing users get keys automatically on their next login. A friend who hasn't logged in since the update shows "Waiting for … to log in once", and you can't message them until they do.
