# JerStock update — full file set

## IMPORTANT: delete the old favicon first

The build/crash was caused by `appfiles/app/favicon.ico`. Next.js's ICO
decoder requires the PNG inside an .ico to be RGBA and rejects it otherwise.
This set does NOT include a favicon.ico — `app/icon.png` covers browser tabs
on its own — so delete the old one:

    cd ~/JerStock
    rm -f appfiles/app/favicon.ico

(If you committed it to git, `git rm appfiles/app/favicon.ico` instead so it
doesn't come back on the next pull.)

## Files in this set

Unzip at the repo root; paths already match.

    databridge/login_guard.py                     login reliability
    databridge/reconnect_robinhood.py             login reliability
    appfiles/app/api/git-update/route.ts          update button backend
    appfiles/components/SettingsForm.tsx          settings UI
    appfiles/app/layout.tsx                       links manifest
    appfiles/app/icon.png                         512px app icon
    appfiles/app/apple-icon.png                   180px iOS home-screen icon
    appfiles/public/manifest.json                 PWA manifest
    appfiles/public/icons/icon-192.png            manifest icon
    appfiles/public/icons/icon-512.png            manifest icon

## Install

    cd ~/JerStock
    rm -f appfiles/app/favicon.ico
    # unzip this set over the repo root
    cd appfiles
    rm -rf .next          # clear the stale/corrupt build from the failed attempts
    npm install
    npm run build         # must succeed before restarting
    cd ~/JerStock
    pm2 restart all
    pm2 save

Only restart AFTER the build succeeds. If the build fails, the error text is
the useful part — the "Import traces" lines below it just show where the bad
file was pulled in, not what's wrong.

## If appfiles still crashes

Get the actual error:

    pm2 logs appfiles --lines 100 --nostream

The `pm2 status` table showing appfiles with blank status/cpu/memory means
pm2's own metadata for that entry is corrupt, which is separate from any code
problem. Rebuild the entry:

    pm2 delete appfiles
    pm2 start ecosystem.config.js --only appfiles
    pm2 save
