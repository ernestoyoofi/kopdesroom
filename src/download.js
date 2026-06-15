const GITHUB_API = 'https://api.github.com/repos/ernestoyoofi/kopdesroom/releases';

const OS_NAMES = {
  win: 'Windows',
  mac: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
};

const OS_ICONS = {
  win: '\u{1FA9F}',
  mac: '\u{1F5A5}\uFE0F',
  linux: '\u{1F427}',
  android: '\u{1F4F1}',
  ios: '\u{1F4F7}',
};

const ARCH_NAMES = {
  x86: '32-bit',
  x64: '64-bit',
  arm64: 'ARM64',
};

const EXT_LABELS = {
  exe: 'Installer',
  msi: 'MSI Package',
  dmg: 'DMG',
  deb: 'DEB',
  apk: 'APK',
  ipa: 'IPA',
  AppImage: 'AppImage',
};

function detectOS() {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iPad|iPhone|iPod/i.test(ua)) return 'ios';
  if (/mac/i.test(ua)) return 'mac';
  if (/win/i.test(ua)) return 'win';
  if (/linux/i.test(ua)) return 'linux';
  return 'win';
}

function detectArch() {
  const ua = navigator.userAgent;
  if (/arm64|aarch64/i.test(ua)) return 'arm64';
  if (/arm/i.test(ua)) return 'arm64';
  if (/x64|amd64|win64|wow64/i.test(ua)) return 'x64';
  if (/i686|i386/i.test(ua)) return 'x86';
  return 'x64';
}

const userOS = detectOS();
const userArch = detectArch();

function parseAssetName(name) {
  const m = name.match(/^kopdesroom-app-(.+)-(.+)-(.+)\.(.+)$/);
  if (!m) return null;
  return { tag: m[1], os: m[2], arch: m[3], ext: m[4] };
}

function formatSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${mb.toFixed(1)} MB`;
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

async function fetchReleases() {
  const res = await fetch(GITHUB_API);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function getLatestRelease(releases) {
  return releases
    .filter(r => !r.draft && r.assets && r.assets.length > 0)
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))[0];
}

function buildOSGroups(release) {
  const groups = {};
  for (const asset of release.assets) {
    const info = parseAssetName(asset.name);
    if (!info) continue;
    if (!groups[info.os]) groups[info.os] = {};
    if (!groups[info.os][info.arch]) groups[info.os][info.arch] = [];
    groups[info.os][info.arch].push({
      ext: info.ext,
      url: asset.browser_download_url,
      size: asset.size,
    });
  }
  return groups;
}

function render() {
  const grid = document.getElementById('download-grid');
  const detectedInfo = document.getElementById('detected-info');
  const headerVersion = document.getElementById('header-version');

  detectedInfo.textContent = `Terdeteksi: ${OS_NAMES[userOS] || userOS} \u2022 ${ARCH_NAMES[userArch] || userArch}`;

  fetchReleases()
    .then(releases => {
      const latest = getLatestRelease(releases);
      if (!latest) {
        grid.innerHTML = '<div class="loading">Tidak ada rilis yang tersedia.</div>';
        return;
      }

      const tag = latest.tag_name;
      const groups = buildOSGroups(latest);

      headerVersion.innerHTML = `<span class="version-badge">v${tag}</span>`;

      const osOrder = [userOS, 'win', 'mac', 'linux', 'android', 'ios'];
      const displayed = new Set();

      let html = '';
      for (const os of osOrder) {
        if (!groups[os] || displayed.has(os)) continue;
        displayed.add(os);

        const isRecommended = os === userOS;
        const arches = groups[os];
        const archKeys = Object.keys(arches);

        html += `<div class="os-group${isRecommended ? ' recommended' : ''}">`;
        html += `<div class="os-group-header">`;
        html += `<span class="os-icon">${OS_ICONS[os] || '\u{1F4BB}'}</span>`;
        html += `<span class="os-name">${OS_NAMES[os] || os}</span>`;
        if (isRecommended) {
          html += `<span class="os-tag recommended-tag">DIREKOMENDASIKAN</span>`;
        }
        html += `<span class="os-tag available-tag">${Object.values(arches).flat().length} file</span>`;
        html += `</div>`;
        html += `<div class="os-assets">`;

        for (const arch of archKeys.sort()) {
          const assets = arches[arch];
          for (const asset of assets) {
            const isExact = os === userOS && arch === userArch;
            html += `<a href="${asset.url}" class="download-btn${isExact ? ' download-btn-primary' : ''}" target="_blank" rel="noopener">`;
            html += `<span class="btn-arch">${ARCH_NAMES[arch] || arch}</span>`;
            html += `<span class="btn-ext">${asset.ext}</span>`;
            if (asset.size) {
              html += `<span class="btn-size">${formatSize(asset.size)}</span>`;
            }
            html += `</a>`;
          }
        }

        html += `</div></div>`;
      }

      if (!html) {
        html = '<div class="loading">Tidak ada file unduhan untuk rilis ini.</div>';
      }

      grid.innerHTML = html;

      // auto-download recommended on click
      grid.addEventListener('click', e => {
        const btn = e.target.closest('.download-btn');
        if (!btn) return;
        if (btn.classList.contains('download-btn-primary')) {
          showToast('Mengunduh aplikasi...');
        }
      });
    })
    .catch(err => {
      grid.innerHTML = `<div class="loading">Gagal memuat data rilis. <br><small>${err.message}</small></div>`;
      headerVersion.innerHTML = `<span class="version-badge">Gagal memuat</span>`;
    });
}

render();
