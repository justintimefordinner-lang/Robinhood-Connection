module.exports = {
  apps: [
    {
      // Next.js dashboard — always-on, restarts on crash.
      // Was: systemd/portfolio-app.service
      name: "portfolio-app",
      cwd: "/home/jimmydaux/JerStock/portfolio-app",
      script: "npm",
      args: "start",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
      },
      autorestart: true,
      restart_delay: 5000,
    },
    {
      // auto_push.py scheduler loop — the same process that already calls
      // am_report.main() every 30 min and refresh_ladders() more often.
      // Always-on, restarts on crash.
      // Was: systemd/robinhood-bridge.service
      name: "robinhood-bridge",
      cwd: "/home/jimmydaux/JerStock/robinhood-bridge",
      script: "/home/jimmydaux/JerStock/robinhood-bridge/.venv/bin/python",
      args: "auto_push.py",
      interpreter: "none", // script IS the interpreter binary; don't let pm2 wrap it again
      autorestart: true,
      restart_delay: 15000, // matches the old RestartSec=15
    },
    {
      // Daily trade-history sync — was a oneshot service triggered by a timer
      // (Mon-Fri 20:15 in the Pi's local system timezone, i.e. shortly after
      // market close). cron_restart runs it once at that time each day; since
      // autorestart is false, pm2 leaves it stopped in between rather than
      // looping it. NOTE: unlike the old timer, this has no `Persistent=true`
      // equivalent — if the Pi happens to be off/rebooting at 20:15, this
      // won't "catch up" on the next boot the way the systemd timer did.
      // Was: systemd/robinhood-history.service + robinhood-history.timer
      name: "robinhood-history",
      cwd: "/home/jimmydaux/JerStock/robinhood-bridge",
      script: "/home/jimmydaux/JerStock/robinhood-bridge/.venv/bin/python",
      args: "sync_trade_history.py",
      interpreter: "none",
      autorestart: false,
      cron_restart: "15 20 * * 1-5",
    },
  ],
};
