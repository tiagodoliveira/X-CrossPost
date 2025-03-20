const { execSync } = require('child_process');
const path = require('path');

// Define the sizes we need for Chrome extension icons
const sizes = [16, 32, 48, 128];

// Source SVG file
const sourceFile = path.join(__dirname, 'icons', 'icon.svg');

// Create icons directory if it doesn't exist
try {
    execSync('mkdir -p icons');
} catch (error) {
    console.error('Error creating icons directory:', error);
}

// Convert SVG to PNG for each size
sizes.forEach(size => {
    const outputFile = path.join(__dirname, 'icons', `icon${size}.png`);
    try {
        execSync(`convert -background none -size ${size}x${size} ${sourceFile} ${outputFile}`);
        console.log(`Created ${size}x${size} icon`);
    } catch (error) {
        console.error(`Error creating ${size}x${size} icon:`, error);
    }
}); 