const input = document.getElementById('input');
const status = document.getElementById('status');
const responseDiv = document.getElementById('response');

function showStatus(msg, color = '#a0ffa0') {
  status.textContent = msg;
  status.style.color = color;
}

function showResponse(msg) {
  if (!msg) {
    responseDiv.innerHTML = '';
    responseDiv.style.display = 'none';
    return;
  }
  
  const formattedMsg = formatMarkdown(msg);
  responseDiv.innerHTML = formattedMsg;
  responseDiv.style.display = 'block';
  resizeWindowToFitContent();
}

function formatMarkdown(text) {
  if (!text) return '';
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
  text = text.replace(/\n/g, '<br>');
  
  return text;
}

function resizeWindowToFitContent() {
  const container = document.getElementById('bar-container');
  if (container) {
    const height = container.scrollHeight + 40;
    window.shifted.resizeWindow(480, Math.max(300, height));
  }
}

async function routePrompt() {
  const val = input.value.trim();
  if (!val) return;
  
  console.log('Processing prompt:', val);
  showStatus('Processing...');
  showResponse('');
  
  try {
    const res = await window.shifted.routePrompt(val);
    console.log('Response received:', res);
    
    if (res.type === 'event') {
      if (res.success) {
        showStatus('Event added to Google Calendar!');
        input.value = '';
        
        if (res.result && res.result.summary) {
          const startTime = res.result.start && res.result.start.dateTime ? 
            new Date(res.result.start.dateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
          const startDate = res.result.start && res.result.start.dateTime ? 
            new Date(res.result.start.dateTime).toLocaleDateString() : '';
          
          showResponse(`✅ Created: **${res.result.summary}**${startTime ? ' at ' + startTime : ''}${startDate ? ' on ' + startDate : ''}`);
        }
      } else {
        showStatus('Error: ' + (res.error || 'Unknown error'), '#ffa0a0');
      }
    } else if (res.type === 'query') {
      showStatus('Calendar query results:');
      showResponse(`📅 Here's what I found on your calendar:\n\n${res.response || 'No events found.'}`);
    } else if (res.type === 'delete') {
      showStatus('Event deleted successfully!');
      showResponse(`🗑️ ${res.response || 'Event deleted.'}`);
    } else if (res.type === 'email-unread') {
      showStatus('Unread emails:');
      showResponse(`📬 ${res.response || 'No unread emails.'}`);
    } else if (res.type === 'email-view') {
      showStatus('Email content:');
      showResponse(`📨 ${res.response || 'Email not found.'}`);
    } else if (res.type === 'email-draft') {
      showStatus('Email draft created');
      showResponse(`📝 ${res.response || 'Draft created.'}`);
    } else if (res.type === 'email-sent') {
      showStatus('Email sent successfully!');
      input.value = '';
      showResponse(`📤 ${res.response || 'Email sent.'}`);
    } else if (res.type === 'chat') {
      showStatus('');
      showResponse(`💬 ${res.response || 'I understand your request.'}`);
    } else if (res.type === 'error') {
      showStatus(res.error || 'Unknown error', '#ffa0a0');
      showResponse(`❌ ${res.error || 'An error occurred.'}`);
    } else {
      showStatus('Unknown response type.', '#ffa0a0');
      showResponse('');
    }
  } catch (err) {
    console.error('Error in routePrompt:', err);
    showStatus('Error processing request', '#ffa0a0');
    showResponse(`❌ Error: ${err.message}`);
  }
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    console.log('Enter key pressed');
    e.preventDefault();
    routePrompt();
  }
  if (e.key === 'Escape') window.shifted.hideWindow();
});

window.shifted.onFocusInput(() => {
  input.focus();
  input.select();
});