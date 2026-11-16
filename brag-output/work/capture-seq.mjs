import { writeFileSync } from 'node:fs'
import { launch, sleep } from './cdp.mjs'
const out = 'cap'
const { send, ev, close } = await launch(9342, process.argv[2], { scale: 2 })
const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); writeFileSync(`${out}/${file}`, Buffer.from(r.data, 'base64')) }
const state = () => ev(`JSON.stringify({badge: document.querySelector('.info-badge')?.textContent, frame: document.querySelector('.pb-frame-info')?.textContent.replace(/\s+/g,' ').slice(0,70), wl: document.querySelector('.pb-wavelength')?.value, overlay: !!document.querySelector('[class*="viewport-loading"]')})`)
const waitLoaded = async (extra = 900) => { for (let i = 0; i < 240; i++) { await sleep(500); const s = JSON.parse(await state()); if (s.badge === 'loaded' && !s.overlay) { await sleep(extra); return s } } return JSON.parse(await state()) }
const VP = { x: 381, y: 40, width: 1157, height: 920 }
await send('Page.navigate', { url: 'http://localhost:5173/?ra=304.6935088&dec=42.4436872991&fov=1800' })
console.log('start', await waitLoaded(2500))
await ev(`document.querySelector('.sidebar')?.scrollTo(0,0)`); await sleep(400)
await shot('app-wide.png')
// Playback frames over time.
const n = Number(await ev(`document.querySelector('.pb-status')?.textContent.match(/(\d+) of \d+ images/)?.[1] ?? 8`))
for (let i = 0; i < n; i++)
{
    await shot(`frames/f${String(i).padStart(2, '0')}.png`, VP)
    console.log('frame', i, (await state()))
    await ev(`document.querySelector('[aria-label="Next frame"]').click()`)
    await waitLoaded()
}
// Back to the first frame, then the six detectors (shortest to longest wavelength).
const dets = JSON.parse(await ev(`JSON.stringify([...document.querySelector('.pb-detector').options].map(o=>o.value).filter(Boolean))`))
for (const d of dets)
{
    await ev(`(()=>{const s=document.querySelector('.pb-detector'); const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'${d}'); s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    const s = await waitLoaded(1200)
    await shot(`bands/d${d}.png`, VP)
    console.log('detector', d, s)
}
// Back to D1, then the difference view on a couple of frames.
await ev(`(()=>{const s=document.querySelector('.pb-detector'); const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'1'); s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
await waitLoaded()
await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Difference'))?.click()`)
for (let i = 0; i < 3; i++)
{
    const s = await waitLoaded(1500)
    await shot(`diff/d${i}.png`, VP)
    console.log('diff', i, s)
    await ev(`document.querySelector('[aria-label="Next frame"]').click()`)
}
await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('SPHEREx'))?.click()`)
await waitLoaded()
// Gizmo: hover (it grows), then drag across it in small steps.
const g = JSON.parse(await ev(`JSON.stringify(document.querySelector('.sky-gizmo svg').getBoundingClientRect())`))
let x = g.x + g.width / 2, y = g.y + 40
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(700)
const G = JSON.parse(await ev(`JSON.stringify(document.querySelector('.sky-gizmo svg').getBoundingClientRect())`))
const clip = { x: G.x - 40, y: G.y - 10, width: G.width + 80, height: G.height + 30 }
console.log('gizmo clip', clip)
await shot('gizmo/g000.png', clip)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
for (let i = 1; i <= 60; i++)
{
    x -= 5   // ~0.033 rad per step at this zoom: a slow full spin over the run
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 1 })
    await sleep(60)
    await shot(`gizmo/g${String(i).padStart(3, '0')}.png`, clip)
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
close(); process.exit(0)
