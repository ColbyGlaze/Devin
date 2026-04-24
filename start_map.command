#!/bin/zsh

cd "/Users/colby.glaze/Documents/New project/world_pin_map" || exit 1

if lsof -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  :
else
  PORT=8000 node server.js >/tmp/devins-food-reviews-server.log 2>&1 &
fi

open "http://127.0.0.1:8000/"
