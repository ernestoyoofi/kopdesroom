import fs from 'fs';
import path from 'path';
import { createHash, randomBytes } from 'crypto';

const __dirname = path.resolve();
const ignoreList = ["sitemap.xml","robots.txt","version/*"]

const getListAssets = () => {
  const dir = path.join(__dirname, 'dist').replace(/\\/g, '/') + '/';
  function readDirectory(dirPath) {
    const files = fs.readdirSync(dirPath);
    const assets = [];
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        assets.push(...readDirectory(filePath));
      } else {
        const relativePath = filePath.replace(/\\/g, '/').replace(dir, '');
        if (ignoreList.some(pattern => {
          if (pattern.endsWith('/*')) {
            return relativePath.startsWith(pattern.slice(0, -1));
          }
          return relativePath === pattern;
        })) continue;
        const content = fs.readFileSync(filePath);
        const hash = createHash('md5').update(content).digest('hex');
        assets.push({ file: relativePath, hash });
      }
    }
    return assets;
  }
  return readDirectory(path.join(__dirname, 'dist'));
}

const assets = getListAssets();
const appversion = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version
const globalObject = {
  build: `${appversion}/${randomBytes(16).toString("hex")}`,
  app_support: "v1",
  version: appversion,
  list: assets,
}
fs.writeFileSync(path.join(__dirname, 'dist', 'assets-list.json'), JSON.stringify(globalObject));