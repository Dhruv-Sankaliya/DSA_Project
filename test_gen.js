const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'maze.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const dom = new JSDOM(html, { runScripts: "dangerously" });
const window = dom.window;
const document = window.document;
const HTMLCanvasElement = window.HTMLCanvasElement;

// Mock canvas context
HTMLCanvasElement.prototype.getContext = function() {
  return {
    fillStyle: '', fillRect: ()=>{}, strokeStyle: '', lineWidth: 0, strokeRect: ()=>{},
    globalAlpha: 1, createRadialGradient: ()=>({ addColorStop: ()=>{} })
  };
};

window.performance = { now: () => 0 };
window.requestAnimationFrame = (cb) => setTimeout(cb, 16);
window.cancelAnimationFrame = (id) => clearTimeout(id);

let scriptEl = document.createElement('script');
scriptEl.textContent = code;
document.body.appendChild(scriptEl);

// Run generateMaze
window.generateMaze().then(() => {
  console.log("SUCCESS");
}).catch(e => {
  console.error("ERROR IN PROMISE:", e);
});

