const fs = require('fs');
const path = require('path');

const importMappings = {
  '@gitroom/helpers': '@postiz/shared/helpers',
  '@gitroom/nestjs-libraries': '@postiz/shared/nestjs-libraries',
  '@gitroom/plugins': '@postiz/shared/plugins',
  '@gitroom/react': '@postiz/shared/react',
  '@gitroom/backend': '@postiz/backend',
  '@gitroom/frontend': '@postiz/frontend',
  '@gitroom/workers': '@postiz/workers',
  '@gitroom/cron': '@postiz/cron'
};

function updateImports(filePath) {
  if (!filePath.match(/\.(ts|tsx|js|jsx)$/)) return;

  let content = fs.readFileSync(filePath, 'utf8');
  let hasChanges = false;

  for (const [oldPath, newPath] of Object.entries(importMappings)) {
    const regex = new RegExp(`from ['"]${oldPath}(/[^'"]*)?['"]`, 'g');
    const newContent = content.replace(regex, (match, subPath = '') => {
      hasChanges = true;
      return `from '${newPath}${subPath}'`;
    });

    if (content !== newContent) {
      content = newContent;
      console.log(`Updated imports in ${filePath}`);
    }
  }

  if (hasChanges) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function processDirectory(dir) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory() && !fullPath.includes('node_modules')) {
      processDirectory(fullPath);
    } else {
      updateImports(fullPath);
    }
  }
}

// Start processing from each service directory
['frontend', 'backend', 'workers', 'cron'].forEach(service => {
  const serviceDir = path.join(__dirname, service);
  if (fs.existsSync(serviceDir)) {
    console.log(`Processing ${service} directory...`);
    processDirectory(serviceDir);
  }
});

console.log('Import paths have been updated!');
