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

Realtime F columns fetch international gold and USD/CNY directly from:

```text
https://api.gold-api.com/price/XAU
https://api.frankfurter.dev/v2/rate/USD/CNY
```

No Cloudflare Worker or API token is required. Enable 实时价 in the PWA and choose `1 秒`, `15 秒`, or `1 分钟` refresh.

The app converts XAU/USD to CNY per gram:

```text
CNY/g = XAU/USD * USD/CNY / 31.1034768
```

When a realtime quote is available, each premium column is paired with a 手动F column and a 实时F column. 手动F uses the futures price entered in the form; 实时F uses the converted CNY/g price as the futures price while keeping each row's strike price.
