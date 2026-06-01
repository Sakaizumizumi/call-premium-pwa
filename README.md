# Black-76 Call Premium PWA

A standalone Progressive Web App for calculating Black-76 call and put option premiums on futures.

## Local Preview

```powershell
python -m http.server 8765
```

Open http://127.0.0.1:8765/ in your browser.

## GitHub Pages Deployment

This repository includes a GitHub Actions workflow that deploys the app to GitHub Pages whenever `main` is pushed.

After pushing the repository to GitHub:

1. Open the repository on GitHub.
2. Go to Settings > Pages.
3. Set Build and deployment Source to GitHub Actions if GitHub asks for it.
4. Open the URL shown by the Deploy to GitHub Pages workflow.

The app is static and uses relative paths, so it works under a repository Pages path such as `/call-premium-pwa/`.
