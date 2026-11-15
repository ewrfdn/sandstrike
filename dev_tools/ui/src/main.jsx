/**
 * SANDSTRIKE // DEV TOOLS — browser entry point.
 *
 * Mounts the React shell (src/App.jsx) into dev_tools/ui/index.html. This file
 * only exists in the dev-tools app; the shipping game boots from src/main.js.
 */
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './app.css';

const host = document.getElementById('root');
if (!host) throw new Error('[dev-tools] missing #root mount point');

createRoot(host).render(<App />);
