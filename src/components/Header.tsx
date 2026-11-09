import nasaLogo from '../assets/nasa-logo-1.svg'

export default function Header()
{
    return (
        <header className="app-header">
            <div className="brand">
                <img src={nasaLogo} alt="NASA logo" className="nasa-logo" />
                <div className="brand-copy">
                    <span className="eyebrow">2026 NASA Space Apps Challenge</span>
                    <strong>Planet X and SPHEREx</strong>
                </div>
            </div>
        </header>
    )
}