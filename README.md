# Devin's Food Reviews

Protected food-review map built for GitHub and Render deployment.

## What It Does

- Public visitors can view the map and existing food-review pins
- Only admins can add new pins
- Admin unlock uses a password/PIN
- Pins are stored server-side instead of browser local storage
- Default pin photo is baked into the app

## Local Run

1. Open `start_map.command`
2. Or run:

```bash
cd world_pin_map
PORT=8000 node server.js
```

3. Open `http://127.0.0.1:8000/world_pin_map/index.html`

## Admin Access

- Default admin password: `1635`
- For Render, set `ADMIN_PASSWORD` and `SESSION_SECRET` as environment variables

## Render Notes

- Deploy this app as a Render `Web Service`
- Root directory: `world_pin_map`
- Start command: `node server.js`
- Persistent pins on Render require either:
  - a persistent disk on a paid web service
  - or moving pin storage to a database
