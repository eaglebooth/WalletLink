import { Buffer } from 'buffer/';
globalThis.Buffer = Buffer;
import('./main.js').catch(error => {
  document.getElementById('status').textContent = 'The app could not start. Reload the page and try again.';
  console.error(error);
});
