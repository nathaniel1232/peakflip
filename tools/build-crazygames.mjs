// Builds the CrazyGames upload: dist/crazygames/ and peak-flip-crazygames.zip (upload either in the Developer Portal).
// Same game, but config.js says platform: 'crazygames' (account saves, CrazyGames names, chat and mute settings,
// single-ad rewards) and every other ad network, the domain move and Vercel analytics are taken out.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname, out = join(root, 'dist/crazygames'), zip = join(root, 'peak-flip-crazygames.zip');
const FILES = ['game.js', 'landscape.js', 'meta.js', 'ui.js', 'chat.js', 'icons.js', 'ads.js', 'config.js', 'net.js', 'cloud.js',
  'mp.js', 'live.js', 'crazy.js', 'clean.js', 'lib', 'secret'];

rmSync(out, { recursive: true, force: true }); rmSync(zip, { force: true });
mkdirSync(out, { recursive: true });
for (const f of FILES) cpSync(join(root, f), join(out, f), { recursive: true });
rmSync(join(out, 'secret/README.md'), { force: true });

// every module the game imports has to be in FILES
for (const f of FILES.filter(f => f.endsWith('.js'))) {
  for (const [, dep] of readFileSync(join(root, f), 'utf8').matchAll(/from '\.\/([\w./-]+)'/g))
    if (!FILES.includes(dep) && !FILES.some(d => dep.startsWith(d + '/'))) throw new Error(`${f} imports ${dep}, which isn't in the build. Add it to FILES.`);
}

// index.html without the AdSense tag (CrazyGames allows no other ad network)
const html = readFileSync(join(root, 'index.html'), 'utf8');
const cleanHtml = html.split('\n').filter(l => !l.includes('pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=')).join('\n');
if (cleanHtml.includes('adsbygoogle.js?client=ca-pub')) throw new Error('index.html still loads AdSense');
// and without ".io" in the logo: pointing players at another place to play is cross-promotion, which CrazyGames forbids
const noDomain = cleanHtml.replace('<small class="snowy" data-text=".io">.io</small>', '');
if (noDomain === cleanHtml) throw new Error('index.html: the ".io" in the logo moved; update build-crazygames.mjs');
writeFileSync(join(out, 'index.html'), noDomain);

// config.js for CrazyGames
let cfg = readFileSync(join(root, 'config.js'), 'utf8');
const set = (key, value) => {
  const re = new RegExp(`^(\\s*${key}:\\s*)[^,\\n]*,`, 'm');
  if (!re.test(cfg)) throw new Error(`config.js has no ${key}`);
  cfg = cfg.replace(re, `$1${value},`);
};
set('canonicalHost', "''"); set('adsenseClient', "''"); set('h5GamesAds', 'false'); set('adsenseSlotLeft', "''"); set('adsenseSlotRight', "''");
cfg = cfg.replace('window.PEAKFLIP_CONFIG = {', "window.PEAKFLIP_CONFIG = {\n  platform: 'crazygames',   // set by tools/build-crazygames.mjs");
writeFileSync(join(out, 'config.js'), cfg);

execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: out });

const walk = d => readdirSync(d).flatMap(f => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]);
const files = walk(out), bytes = files.reduce((n, f) => n + statSync(f).size, 0);
console.log(`dist/crazygames: ${files.length} files, ${(bytes / 1e6).toFixed(2)} MB (limits: 1,500 files, 50 MB)`);
console.log(`peak-flip-crazygames.zip: ${(statSync(zip).size / 1e6).toFixed(2)} MB`);
