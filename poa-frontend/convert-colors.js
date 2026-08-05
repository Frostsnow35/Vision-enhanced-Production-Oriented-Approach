
const convert = require('color-convert');

const colors = {
  // 方案四
  primary: '#06304F',     // 深海蓝 - 主色
  accent: '#2A6863',      // 暖青绿 - 强调色
  highlight: '#F8B682',   // 蜜桃橙 - 点缀色
};

console.log('=== 方案四配色转换 ===\n');

Object.entries(colors).forEach(([name, hex]) => {
  const oklch = convert.hex.oklch(hex);
  console.log(`${name}: ${hex}`);
  console.log(`  OKLCH: ${(oklch[0]/100).toFixed(3)} ${(oklch[1]/100).toFixed(4)} ${oklch[2].toFixed(1)}`);
  console.log();
});
