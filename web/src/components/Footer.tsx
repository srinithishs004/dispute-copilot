import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <span className="footer__note">Sandbox demo, no real money</span>
        <nav aria-label="Legal">
          <ul className="footer__links">
            <li>
              <Link to="/privacy">Privacy</Link>
            </li>
            <li>
              <Link to="/terms">Terms</Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
