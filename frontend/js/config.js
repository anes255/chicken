// Point this at your backend. When the backend serves the frontend,
// leaving it as '' (same origin) works automatically.
window.API_BASE = window.location.port === '4000' ? '' : 'http://localhost:4000';
