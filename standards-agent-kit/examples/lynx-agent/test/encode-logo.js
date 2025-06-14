#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Save the provided logo to assets directory
const saveLogo = () => {
  // Ensure assets directory exists
  const assetsDir = path.join(__dirname, '..', 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  // Check if logo already exists in assets
  const logoPath = path.join(assetsDir, 'sentinel-logo.png');
  
  // If logo doesn't exist in assets, copy from wherever user placed it
  if (!fs.existsSync(logoPath)) {
    console.log('Looking for logo file...');
    
    // Try to find the logo in common locations
    const possibleLocations = [
      path.join(process.cwd(), 'sentinel-logo.png'),
      path.join(process.cwd(), 'logo.png'),
      path.join(__dirname, 'sentinel-logo.png'),
      path.join(__dirname, 'logo.png')
    ];
    
    let foundLogo = false;
    for (const location of possibleLocations) {
      if (fs.existsSync(location)) {
        console.log(`Found logo at: ${location}`);
        fs.copyFileSync(location, logoPath);
        console.log(`Copied logo to: ${logoPath}`);
        foundLogo = true;
        break;
      }
    }
    
    if (!foundLogo) {
      console.error('Logo file not found in common locations. Please place it in the project root or assets directory.');
      process.exit(1);
    }
  } else {
    console.log(`Logo already exists at: ${logoPath}`);
  }
  
  return logoPath;
};

// Read the logo and convert to base64
const encodeLogoToBase64 = (logoPath) => {
  try {
    const logoData = fs.readFileSync(logoPath);
    const base64Data = logoData.toString('base64');
    const dataUri = `data:image/png;base64,${base64Data}`;
    
    // Output the data URI for copying
    console.log('\nBase64 Data URI (for register-sentinel.ts):\n');
    console.log(`const profilePicture = "${dataUri}";`);
    
    // Get file size
    const stats = fs.statSync(logoPath);
    console.log(`\nLogo file size: ${(stats.size / 1024).toFixed(2)} KB`);
    console.log(`Base64 string length: ${dataUri.length} characters`);
    
    // Save to a JS file for easy importing
    const outputPath = path.join(__dirname, 'logo-base64.js');
    fs.writeFileSync(outputPath, `// Auto-generated base64 encoding of sentinel-logo.png
export const logoBase64 = "${dataUri}";
`);
    console.log(`\nSaved base64 data to: ${outputPath}`);
    console.log('You can now import this in register-sentinel.ts with:');
    console.log('import { logoBase64 } from \'./logo-base64.js\';');
    
    return dataUri;
  } catch (error) {
    console.error(`Error encoding logo: ${error}`);
    process.exit(1);
  }
};

// Main function
const main = () => {
  const logoPath = saveLogo();
  encodeLogoToBase64(logoPath);
};

main(); 