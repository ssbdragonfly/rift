const input = document.getElementById('input');
const status = document.getElementById('status');
let responseDiv = document.getElementById('response');
if (!responseDiv) {
  responseDiv = document.createElement('div');
  responseDiv.id = 'response';
  responseDiv.style.marginTop = '10px';
  responseDiv.style.fontSize = '1.08em';
  responseDiv.style.color = '#e0e0e0';
  responseDiv.style.opacity = '0.97';
  responseDiv.style.minHeight = '1.2em';
  responseDiv.style.wordBreak = 'break-word';
  input.parentNode.insertBefore(responseDiv, status.nextSibling);
}

function showStatus(msg, color = '#a0ffa0') {
  status.textContent = msg;
  status.style.color = color;
}

function showResponse(msg) {
  responseDiv.textContent = msg || '';
}

async function routePrompt() {
  const val = input.value.trim();
  if (!val) return;
  showStatus('Processing...');
  showResponse('');
  const res = await window.shifted.routePrompt(val);
  if (res.type === 'event') {
    if (res.success) {
      showStatus('Event added to Google Calendar!');
      input.value = '';
        if (res.result && res.result.summary) {
        const startTime = res.result.start && res.result.start.dateTime ? 
          new Date(res.result.start.dateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
        const eventDate = res.result.start && res.result.start.dateTime ? 
          new Date(res.result.start.dateTime).toLocaleDateString() : '';
        const eventInfo = `Created: ${res.result.summary}${startTime ? ' at ' + startTime : ''}${eventDate ? ' on ' + eventDate : ''}`;
        showResponse(eventInfo);
      }
    }
    else {
      showStatus('Error: ' + (res.error || 'Unknown error'), '#ffa0a0');
    }
  }
  
  else if (res.type === 'query' || res.type === 'chat' || res.type === 'delete') {
    showStatus('');
    showResponse(res.response || 'No response.');
  }
  else if (res.type === 'error') {
    showStatus(res.error || 'Unknown error', '#ffa0a0');
    showResponse('');
  }
  else {
    showStatus('Unknown response type.', '#ffa0a0');
    showResponse('');
  }
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') routePrompt();
  if (e.key === 'Escape') window.shifted.hideWindow();
  if (e.metaKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    input.value = '';
    showStatus('');
    showResponse('');
    input.focus();
  }
  
  if (e.metaKey && e.key.toLowerCase() === 'r') {
    e.preventDefault();
    input.value = '';
    showStatus('');
    showResponse('');
    input.focus();
    showStatus('Prompt reset', '#a0a0ff');
    setTimeout(() => showStatus(''), 1500);
  }
});

window.shifted.onFocusInput(() => {
  input.focus();
  input.select();
});