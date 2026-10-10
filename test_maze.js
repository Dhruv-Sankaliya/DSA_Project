const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'maze.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const dom = new JSDOM(html);
const window = dom.window;
const document = window.document;

// Add mock canvas context
HTMLCanvasElement.prototype.getContext = function() {
  return {
    fillStyle: '', fillRect: ()=>{}, strokeStyle: '', lineWidth: 0, strokeRect: ()=>{},
    globalAlpha: 1, createRadialGradient: ()=>({ addColorStop: ()=>{} })
  };
};
const performance = { now: () => 0 };

try {
  eval(code);
  generateMaze().then(() => {
    console.log("Success");
  }).catch(e => {
    console.error("Promise rejected:", e);
  });
} catch(e) {
  console.error("Eval error:", e);
}
