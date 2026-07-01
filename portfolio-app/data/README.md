# data/

The Python bridge writes the app's JSON here at runtime —
`snapshot.json`, `vix.json`, `am_report.json`, `refresh-status.json`, and friends.

These files contain **your real account data**, so they are gitignored and are
**not** part of this repo. Point the bridge's `APP_DATA_DIR` at this folder.

**Want to see the UI without a bridge?** Run the app and click **Example** in the
header — it renders the whole dashboard with a built-in synthetic portfolio
(`lib/example.ts`), no real data required.
