const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

const HANDLE = 'phoenixcore_gym';
const ASSETS_DIR = path.join(__dirname, 'assets');

async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    const get = (u) => https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) return get(res.headers.location);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(filepath); });
    }).on('error', reject);
    get(url);
  });
}

async function scrapeInstagram() {
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();

  console.log(`Abriendo perfil de @${HANDLE}...`);
  await page.goto(`https://www.instagram.com/${HANDLE}/`, { waitUntil: 'networkidle', timeout: 40000 });

  // Cerrar popups
  for (const text of ['Allow all cookies', 'Decline optional cookies', 'Rechazar cookies opcionales', 'Aceptar todo']) {
    try { await page.click(`button:has-text("${text}")`, { timeout: 2000 }); } catch {}
  }
  try { await page.click('svg[aria-label="Close"]', { timeout: 2000 }); } catch {}
  try { await page.keyboard.press('Escape'); } catch {}
  await page.waitForTimeout(3000);

  // Extraer datos del perfil
  const profileData = await page.evaluate(() => {
    const imgEl = document.querySelector('img[data-testid="user-avatar"]') ||
                  document.querySelector('header img') ||
                  document.querySelector('span > img');
    const stats = Array.from(document.querySelectorAll('li span span, span.g47SY'))
      .map(el => el.textContent.trim()).filter(t => t && /[\d,KkMm]/.test(t));
    const postImgs = Array.from(document.querySelectorAll('article img, div._aagv img, main img'))
      .slice(0, 12).map(img => img.src).filter(s => s && !s.includes('data:'));
    const verified = !!document.querySelector('svg[aria-label="Verified"]');
    return { profilePic: imgEl?.src || '', stats, postImgs, verified };
  });

  const meta = await page.evaluate(() => ({
    title: document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '',
    desc:  document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
           document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
    img:   document.querySelector('meta[property="og:image"]')?.getAttribute('content') || ''
  }));

  console.log('Datos del perfil:', profileData);
  console.log('Meta:', meta);

  // Descargar foto de perfil
  let localProfilePic = '';
  const picUrl = profileData.profilePic || meta.img;
  if (picUrl?.startsWith('http')) {
    try {
      await downloadImage(picUrl, path.join(ASSETS_DIR, 'profile.jpg'));
      localProfilePic = 'assets/profile.jpg';
      console.log('Foto de perfil descargada');
    } catch (e) { console.log('Error foto de perfil:', e.message); }
  }

  // Descargar posts
  const localPostImages = [];
  for (let i = 0; i < Math.min(profileData.postImgs.length, 9); i++) {
    try {
      const p = path.join(ASSETS_DIR, `post_${i + 1}.jpg`);
      await downloadImage(profileData.postImgs[i], p);
      localPostImages.push(`assets/post_${i + 1}.jpg`);
      console.log(`Post ${i + 1} descargado`);
    } catch (e) { console.log(`Error post ${i + 1}:`, e.message); }
  }

  await browser.close();

  // Parsear nombre y bio
  let displayName = HANDLE;
  let bio = '';
  if (meta.title) {
    const m = meta.title.match(/^(.+?)\s*[\(@•]/);
    if (m) displayName = m[1].trim();
  }
  if (meta.desc) {
    bio = meta.desc.replace(/^[\d,\.]+ Followers.*?Following[^-]+-\s*/i, '').trim();
  }

  const result = {
    handle: HANDLE,
    displayName: displayName || 'Phoenix Core Gym',
    bio,
    verified: profileData.verified,
    stats: profileData.stats,
    profilePic: localProfilePic,
    postImages: localPostImages,
    rawMeta: meta
  };

  fs.writeFileSync(path.join(__dirname, 'instagram-data.json'), JSON.stringify(result, null, 2));
  console.log('\n✅ Datos guardados en instagram-data.json');
  console.log(result);
  return result;
}

scrapeInstagram().catch(console.error);
