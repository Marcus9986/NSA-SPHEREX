// Minimal types for the parts of Aladin Lite (CDS's HiPS sky viewer) this app uses;
// the package ships none. API: https://cds-astro.github.io/aladin-lite
declare module 'aladin-lite' {
    export interface AladinOverlay { add(item: unknown): void }
    export interface AladinCatalog { addSources(sources: unknown[]): void }
    export interface Aladin {
        setImageSurvey(id: string): void
        gotoRaDec(ra: number, dec: number): void
        setFoV(degrees: number): void
        addOverlay(overlay: AladinOverlay): void
        addCatalog(catalog: AladinCatalog): void
        removeOverlay(layer: AladinOverlay | AladinCatalog): void
    }
    const A: {
        init: Promise<void>
        aladin(element: HTMLElement, options: Record<string, unknown>): Aladin
        graphicOverlay(options: { color?: string, lineWidth?: number, lineDash?: number[], name?: string }): AladinOverlay
        polyline(points: [number, number][], options?: Record<string, unknown>): unknown
        catalog(options: Record<string, unknown>): AladinCatalog
        source(ra: number, dec: number, data?: Record<string, unknown>): unknown
    }
    export default A
}
