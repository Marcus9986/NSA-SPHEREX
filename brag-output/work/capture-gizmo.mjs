import { writeFileSync } from 'node:fs'
import { launch, sleep } from './cdp.mjs'
const { send, ev, close } = await launch(9343, process.argv[2], { scale: 2 })
const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } }); writeFileSync(file, Buffer.from(r.data, 'base64')) }
await send('Page.navigate', { url: 'http://localhost:5173/?ra=304.6935088&dec=42.4436872991&fov=1800' })
for (let i = 0; i < 120; i++) { await sleep(500); if (await ev(`document.querySelector('.info-badge')?.textContent === 'loaded'`)) break }
await sleep(1500)
const g = JSON.parse(await ev(`JSON.stringify(document.querySelector('.sky-gizmo svg').getBoundingClientRect())`))
const cx = g.x + g.width / 2, cy = g.y + 50
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy }); await sleep(800)
const G = JSON.parse(await ev(`JSON.stringify(document.querySelector('.sky-gizmo svg').getBoundingClientRect())`))
const clip = { x: G.x - 40, y: G.y - 10, width: G.width + 80, height: G.height + 30 }
// 0.012 / 1.8 rad per px while enlarged: 360 degrees is ~942 px. 90 steps of 10.5 px,
// in short drags that start and end inside the gizmo so it stays enlarged.
const STEPS = 90, STEP_PX = 942.5 / STEPS, PER_DRAG = 10
let frame = 0
for (let d = 0; d < STEPS / PER_DRAG; d++)
{
    let x = cx + (PER_DRAG * STEP_PX) / 2
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: cy }); await sleep(30)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y: cy, button: 'left', clickCount: 1 })
    // The first move past the click tolerance starts the drag without turning further than one step.
    for (let s = 0; s < PER_DRAG; s++)
    {
        x -= STEP_PX
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: cy, buttons: 1 })
        await sleep(50)
        await shot(`cap/gizmo/g${String(frame++).padStart(3, '0')}.png`, clip)
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: cy, button: 'left', clickCount: 1 })
    await sleep(40)
}
console.log('frames', frame, 'clip', clip, 'width now', await ev(`document.querySelector('.sky-gizmo svg').getBoundingClientRect().width`))
close(); process.exit(0)
