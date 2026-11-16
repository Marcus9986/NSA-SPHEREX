// node render.mjs <profileDir> stills <t1,t2,...>   -> stills/s_<t>.jpg
// node render.mjs <profileDir> frames               -> frames/00000.jpg ...
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { launch, sleep } from './cdp.mjs'
const [profile, mode, list] = process.argv.slice(2)
const { send, ev, close } = await launch(9344, profile, { scale: 1 })
await send('Page.navigate', { url: pathToFileURL(resolve('comp.html')).href })
await sleep(1500)
const ok = await ev('window.ready')
if (!ok) { console.error('assets failed to load'); close(); process.exit(1) }
const grab = async (t, file) =>
{
    await ev(`window.render(${t}); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 95 })
    writeFileSync(file, Buffer.from(r.data, 'base64'))
}
if (mode === 'stills')
{
    mkdirSync('stills', { recursive: true })
    for (const t of list.split(',').map(Number)) await grab(t, `stills/s_${t.toFixed(2)}.jpg`)
}
else
{
    mkdirSync('frames', { recursive: true })
    const fps = await ev('window.FPS'), total = Math.round((await ev('window.DURATION')) * fps)
    for (let f = 0; f < total; f++)
    {
        await grab(f / fps, `frames/${String(f).padStart(5, '0')}.jpg`)
        if (f % 60 === 0) console.log('frame', f, '/', total)
    }
}
close(); process.exit(0)
