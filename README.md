# Rodriguez Forge LLC — Website

Premium static website for **Rodriguez Forge LLC** (rodriguezforge.com)  
Residential construction & remodeling · Eloy, Arizona

## Local preview

```bash
cd ~/Documents/rodriguezforge
python3 -m http.server 8080
```

Visit: http://localhost:8080

## Where to put files

### Logos (already installed from your uploads)
`assets/logo/`
- `emblem.png` — mark only (nav, intro, favicon)
- `logo-full.png` — full logo with name (footer)

### Project / team photography
`assets/images/` (create subfolders as needed)

```
assets/images/
  hero.jpg
  projects/
  team/
    albert.jpg
    isaac.jpg
```

Replace the gray gradient frames (`.ph` blocks) with real `<img>` tags when photos are ready.

## Stack

- Semantic HTML5
- Custom CSS design system
- Vanilla JS (intro typewriter, living grid FX, nav, reveals, form)

## Pages

| File | Page |
|------|------|
| `index.html` | Homepage |
| `projects.html` | Project gallery |
| `project.html` | Project detail |
| `about.html` | About |
| `services.html` | Services |
| `process.html` | Process |
| `contact.html` | Contact |

## Deploy

Upload the folder to Netlify, Vercel, Cloudflare Pages, or GitHub Pages. No build step.
