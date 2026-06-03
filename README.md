# Black-76 Call Premium PWA

A standalone Progressive Web App for calculating Black-76 call and put option premiums on futures.

## Local Preview

```powershell
python -m http.server 8765
```

Open http://127.0.0.1:8765/ in your browser.

## GitHub Pages Deployment

This repository is a static app and can be deployed with GitHub Pages from the `main` branch root.

After pushing the repository to GitHub:

1. Open the repository on GitHub.
2. Go to Settings > Pages.
3. Set Build and deployment Source to Deploy from a branch.
4. Choose `main` and `/ (root)`.
5. Open the URL shown by GitHub Pages.

The app is static and uses relative paths, so it works under a repository Pages path such as `/call-premium-pwa/`.

## Realtime Gold Main Quote

The PWA can show a realtime ATM premium row using a quote proxy. Keep API tokens out of GitHub Pages and deploy the Cloudflare Worker in `workers/gold-main-quote.js`.

1. Copy `workers/wrangler.toml.example` to `workers/wrangler.toml`.
2. Set the iTick token as a Worker secret:

```powershell
wrangler secret put ITICK_TOKEN
```

3. Deploy the Worker from the `workers` folder:

```powershell
wrangler deploy
```

4. In the PWA, paste the Worker endpoint into 行情代理, for example:

```text
https://your-worker.workers.dev/quote/gold-main
```

The Worker defaults to `ITICK_REGION=CN` and `ITICK_SYMBOL=au0`. If the data provider uses another code for 上期所黄金主连, change `ITICK_SYMBOL` in the Worker vars and redeploy.
