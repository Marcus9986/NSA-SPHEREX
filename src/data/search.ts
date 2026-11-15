// Fuzzy search over the built-in catalogue of well-known objects, for autocomplete.

import { OBJECTS, type CatalogObject } from './objects'

/** "M 42", "m42" and "Cat’s-Eye" all compare equal to their plain forms. */
export const normalize = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9*+]/g, '')

/** Edit distance with adjacent swaps ("Betelgeuse" / "Betelguese" = 1). */
function editDistance(a: string, b: string): number
{
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[])
    for (let j = 1; j <= b.length; j++)
        d[0][j] = j
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
        {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
        }
    return d[a.length][b.length]
}

/** How well a query matches one name (higher is better), or 0 for no match. */
export function matchScore(query: string, name: string): number
{
    const q = normalize(query), k = normalize(name)
    if (!q || !k)
        return 0
    if (k === q)
        return 1000
    if (k.startsWith(q))
        return 800 - Math.min(100, k.length - q.length)
    // Start of a later word: "nebula" -> "Orion Nebula", "pinwheel" -> "Southern Pinwheel Galaxy".
    const words = name.split(/[\s\-–'’]+/).map(normalize).filter(Boolean)
    if (words.some((w) => w.startsWith(q)))
        return 650 - Math.min(100, k.length - q.length)
    // Initials of a multi-word name: "ag" -> "Andromeda Galaxy", "lmc" -> "Large Magellanic Cloud".
    if (q.length >= 2 && words.length >= q.length && words.map((w) => w[0]).join('').startsWith(q))
        return 550
    const at = k.indexOf(q)
    if (at >= 0)
        return 500 - Math.min(100, at)
    // Small typos, against a same-length prefix: "betelguese", "andromida".
    if (q.length >= 4)
    {
        const typos = editDistance(q, k.slice(0, q.length))
        if (typos <= (q.length >= 8 ? 2 : 1))
            return 400 - typos * 50
    }
    // Letters in order with gaps (fzf-style): "hrsnb" -> "Horsehead Nebula"; tighter = better.
    let pos = -1, gaps = 0
    for (const ch of q)
    {
        const next = k.indexOf(ch, pos + 1)
        if (next < 0)
            return 0
        if (pos >= 0)
            gaps += next - pos - 1
        pos = next
    }
    return q.length >= 3 ? Math.max(1, 200 - gaps * 8) : 0
}

/** Best catalogue matches for what's typed, best first; ties go to the shorter name. */
export function searchObjects(query: string, limit = 8): CatalogObject[]
{
    if (!normalize(query))
        return []
    return OBJECTS
        .map((object) => ({ object, score: Math.max(matchScore(query, object.name), matchScore(query, object.id)) }))
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score || a.object.name.length - b.object.name.length)
        .slice(0, limit)
        .map((m) => m.object)
}

/** The catalogue entry this text names exactly (by name or designation), if any. */
export function exactObject(text: string): CatalogObject | undefined
{
    const q = normalize(text)
    return q ? OBJECTS.find((o) => normalize(o.name) === q || normalize(o.id) === q) : undefined
}
