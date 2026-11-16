// Minimal Chrome DevTools Protocol helper shared by the capture and render scripts.
import { spawn } from 'node:child_process'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function launch(port, profile, { width = 1920, height = 1080, scale = 1 } = {})
{
    const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',
        ['--headless=new', `--remote-debugging-port=${port}`, `--window-size=${width},${height}`, `--user-data-dir=${profile}`,
         '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', 'about:blank'])
    await sleep(2000)
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
    await new Promise((r) => (ws.onopen = r))
    let id = 0
    const pending = {}
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending[m.id]) { pending[m.id](m.result ?? m); delete pending[m.id] } }
    const send = (method, params = {}) => new Promise((r) => { pending[++id] = r; ws.send(JSON.stringify({ id, method, params })) })
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
    const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value
    return { chrome, send, ev, close: () => chrome.kill() }
}
