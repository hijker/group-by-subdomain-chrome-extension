#!/usr/bin/env node

/**
 * Icon Generator Script
 *
 * Run: npm install canvas && node scripts/generate-icons.js
 * Or: bun install canvas && bun scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');

let createCanvas;
try {
  createCanvas = require('canvas').createCanvas;
} catch (e) {
  console.log('Canvas module not found. Please install it:');
  console.log('  npm install canvas');
  console.log('  or');
  console.log('  bun install canvas');
  console.log('\nAlternatively, open icons/generate-icons.html in a browser to generate icons manually.');
  process.exit(1);
}

const sizes = [16, 32, 48, 128];
const outputDir = path.join(__dirname, '..', 'icons');

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawIcon(canvas, size) {
  const ctx = canvas.getContext('2d');
  const scale = size / 128;

  // Clear canvas
  ctx.clearRect(0, 0, size, size);

  // Background circle with gradient
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#4285f4');
  gradient.addColorStop(1, '#1a73e8');

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.47, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Tab rectangles
  ctx.fillStyle = 'white';

  const tabs = [
    { y: 32, opacity: 0.95 },
    { y: 54, opacity: 0.75 },
    { y: 76, opacity: 0.55 }
  ];

  tabs.forEach(tab => {
    ctx.globalAlpha = tab.opacity;
    roundRect(ctx, 28 * scale, tab.y * scale, 72 * scale, 16 * scale, 4 * scale);
    ctx.fill();
  });

  ctx.globalAlpha = 1;

  // Grouping bracket
  ctx.strokeStyle = 'white';
  ctx.lineWidth = Math.max(1, 4 * scale);
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(22 * scale, 38 * scale);
  ctx.lineTo(22 * scale, 86 * scale);
  ctx.moveTo(22 * scale, 62 * scale);
  ctx.lineTo(16 * scale, 62 * scale);
  ctx.stroke();
}

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Generate icons
sizes.forEach(size => {
  const canvas = createCanvas(size, size);
  drawIcon(canvas, size);

  const buffer = canvas.toBuffer('image/png');
  const filename = path.join(outputDir, `icon${size}.png`);
  fs.writeFileSync(filename, buffer);
  console.log(`Generated: ${filename}`);
});

console.log('\nAll icons generated successfully!');
