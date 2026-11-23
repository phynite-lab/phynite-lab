const statusLine = document.querySelector('#status');
const retry = document.querySelector('#retry');
const { invoke } = window.__TAURI__.core;

async function refresh() {
  try {
    const status = await invoke('startup_status');
    retry.hidden = status === 'starting' || status === 'ready';
    statusLine.textContent = retry.hidden ? 'Starting the local workspace…' : status;
  } catch (error) {
    statusLine.textContent = String(error);
  }
  setTimeout(refresh, 100);
}

retry.addEventListener('click', async () => {
  retry.hidden = true;
  try {
    await invoke('retry_startup');
  } catch (error) {
    statusLine.textContent = String(error);
    retry.hidden = false;
  }
});
void refresh();
