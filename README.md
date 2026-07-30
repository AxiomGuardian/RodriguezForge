# Rodriguez Forge LLC

Premium website for **Rodriguez Forge LLC** — residential construction & remodeling in Eloy, Arizona.

## Live site

**https://axiomguardian.github.io/RodriguezForge/**

| | |
|---|---|
| **GitHub** | https://github.com/AxiomGuardian/RodriguezForge |
| **Local** | `http://localhost:8080` |
| **Domain (planned)** | rodriguezforge.com |

## Local preview

```bash
cd ~/Documents/rodriguezforge
python3 -m http.server 8080
```

Open: http://localhost:8080

## Stack

- Semantic HTML5 (multi-page)
- Custom CSS design system
- Vanilla JS (intro, grid FX, nav, typewriter titles, form UX)
- GitHub Pages hosting

## Pages

| File | Page |
|------|------|
| `index.html` | Homepage |
| `projects.html` | Project gallery |
| `project.html` | Project detail |
| `about.html` | About / legacy |
| `services.html` | Services |
| `process.html` | Process |
| `contact.html` | Contact |
| `404.html` | Not found |

## Assets

```
assets/logo/          # Emblem + full logo
assets/images/        # Drop real project photos here
```

## Deploy

Hosting is **GitHub Pages** from the `main` branch (root).

Push updates:

```bash
cd ~/Documents/rodriguezforge
git add .
git commit -m "Update site"
git push origin main
```

Pages rebuilds automatically after each push to `main`.

### Custom domain (rodriguezforge.com)

1. In the repo: **Settings → Pages → Custom domain** → enter `rodriguezforge.com`
2. At your domain registrar, add DNS:
   - `A` records to GitHub Pages IPs, **or**
   - `CNAME` for `www` → `axiomguardian.github.io`
3. Wait for DNS + HTTPS to provision in GitHub Pages settings

## Contact placeholders

Update real phone/email in the HTML when ready (`hello@rodriguezforge.com` is currently used).

## License

Proprietary — Rodriguez Forge LLC. All rights reserved.
