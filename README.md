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

## Realtime International Gold Quote

The realtime row fetches international gold directly from:

```text
https://api.gold-api.com/price/XAU
```

No Cloudflare Worker or API token is required. Enable 实时价 in the PWA and choose `1 秒`, `15 秒`, or `1 分钟` refresh.

The quote is XAU/USD. The realtime row calculates an ATM premium using that same price as both the futures price and strike price.
