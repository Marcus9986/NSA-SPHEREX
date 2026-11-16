import { writeFileSync } from 'node:fs'
import { launch, sleep } from './cdp.mjs'
const out = process.argv[2]
const { send, ev, close } = await launch(9341, process.argv[3], { scale: 2 })
const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); writeFileSync(`${out}/${file}`, Buffer.from(r.data, 'base64')) }
const state = () => ev(`JSON.stringify({badge: document.querySelector('.info-badge')?.textContent, caption: document.querySelector('.pb-frame-info')?.textContent.replace(/\s+/g,' ').slice(0,80), count: document.querySelector('.pb-status')?.textContent.match(/\d+ of \d+ images/)?.[0]})`)
await send('Page.navigate', { url: 'http://localhost:5173/' + (process.argv[4] ?? '') })
const waitLoaded = async () => { for (let i = 0; i < 120; i++) { await sleep(500); const s = JSON.parse(await state()); if (s.badge === 'loaded') return s } }
console.log('loaded', await waitLoaded())
await ev(`document.querySelector('.sidebar')?.scrollTo(0,0)`)
await sleep(1500)
await shot('app.png')
console.log('rects', await ev(`JSON.stringify(Object.fromEntries(['.viewport-panel','.sky-gizmo svg','.playback-panel','.sidebar','.target-form','.right-panel','.app-header'].map(s=>[s, (r=>r&&[r.x,r.y,r.width,r.height].map(Math.round))(document.querySelector(s)?.getBoundingClientRect())])))`))
close(); process.exit(0)
