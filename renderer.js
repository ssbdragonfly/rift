const input = document.getElementById('input');
const status = document.getElementById('status');
const responseDiv = document.getElementById('response');

function showStatus(msg, color = '#a0ffa0') {
  status.textContent = msg;
  status.style.color = color;
}

function clearFollowUpMode() {
  responseDiv.classList.remove('follow-up-mode');
  delete responseDiv.dataset.contextPrompt;
  delete responseDiv.dataset.contextResponse;
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
  
  const isFollowUp = responseDiv.classList.contains('follow-up-mode');
  const contextPrompt = responseDiv.dataset.contextPrompt;
  const contextResponse = responseDiv.dataset.contextResponse;
  
  if (!isFollowUp) {
    showResponse('');
  }
  
  let effectivePrompt = val;
  if (isFollowUp && contextPrompt) {
    console.log('Using follow-up context');
    effectivePrompt = `FOLLOW_UP_CONTEXT: ${contextPrompt}\nPREVIOUS_RESPONSE: ${contextResponse}\nNEW_PROMPT: ${val}`;
  }
  
  try {
    const res = await window.shifted.routePrompt(effectivePrompt);
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
    } else if (res.type === 'event-modified') {
      if (res.success) {
        showStatus('Event modified successfully!');
        input.value = '';
        
        if (res.result && res.result.summary) {
          const startTime = res.result.start && res.result.start.dateTime ? 
            new Date(res.result.start.dateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
          const startDate = res.result.start && res.result.start.dateTime ? 
            new Date(res.result.start.dateTime).toLocaleDateString() : '';
          
          showResponse(`✅ Modified: **${res.result.summary}**${startTime ? ' at ' + startTime : ''}${startDate ? ' on ' + startDate : ''}\n\nChanges: ${res.changes}`);
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
      
      responseDiv.dataset.contextPrompt = val;
      responseDiv.dataset.contextResponse = res.response || 'Draft created.';
      responseDiv.classList.add('follow-up-mode');
    } else if (res.type === 'email-sent') {
      showStatus('Email sent successfully!');
      input.value = '';
      showResponse(`📤 ${res.response || 'Email sent.'}`);
      clearFollowUpMode();
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
  
  // cmd shift r - Reset prompt and clear follow-up mode
  if (e.metaKey && e.shiftKey && e.key === 'R') {
    e.preventDefault();
    input.value = '';
    showStatus('Prompt reset');
    showResponse('');
    
    clearFollowUpMode();
    
    setTimeout(() => showStatus(''), 1500);
  }
  
  // cmd shift f - Store prompt and response for follow-up
  if (e.metaKey && e.shiftKey && e.key === 'F') {
    e.preventDefault();
    const currentPrompt = input.value.trim();
    const currentResponse = responseDiv.innerHTML.trim();
    
    if (currentPrompt || currentResponse) {
      console.log('Storing prompt and response for follow-up');
      window.shifted.storeHistory(currentPrompt, currentResponse)
        .then(() => {
          return window.shifted.getHistory(1);
        })
        .then(history => {
          if (history && history.length > 0) {
            input.value = '';
            showStatus('Prompt stored. You can now follow up on this conversation.');
            responseDiv.dataset.contextPrompt = history[0].prompt;
            responseDiv.dataset.contextResponse = history[0].response;
            responseDiv.classList.add('follow-up-mode');
            
            setTimeout(() => showStatus(''), 2000);
          } else {
            showStatus('Prompt stored');
            setTimeout(() => showStatus(''), 1500);
          }
        })
        .catch(err => {
          console.error('Error storing history:', err);
          showStatus('Error storing history', '#ffa0a0');
        });
    }
  }
  
  // cmd y
  if (e.metaKey && e.key === 'y') {
    e.preventDefault();
    console.log('Cmd+Y pressed, attempting to send email draft');
    if (input.value.trim().match(/\b(draft|write|compose|create|send).+\b(to|for)\s+[^\s@]+@[^\s@]+\.[^\s@]+/i)) {
      console.log('Creating draft from current input before sending');
      routePrompt().then(() => {
        setTimeout(() => {
          window.shifted.sendDraft()
            .then(result => {
              if (result.success) {
                showStatus('Email sent successfully!');
                input.value = '';
                showResponse('📤 Email sent successfully!');
              } else {
                showStatus('Failed to send email: ' + (result.error || 'Unknown error'), '#ffa0a0');
              }
            })
            .catch(err => {
              showStatus('Error sending email: ' + err.message, '#ffa0a0');
            });
        }, 1000);
      });
    } else {
      window.shifted.sendDraft()
        .then(result => {
          if (result.success) {
            showStatus('Email sent successfully!');
            input.value = '';
            showResponse('📤 Email sent successfully!');
          } else {
            showStatus('Failed to send email: ' + (result.error || 'Unknown error'), '#ffa0a0');
          }
        })
        .catch(err => {
          showStatus('Error sending email: ' + err.message, '#ffa0a0');
        });
    }
  }
});

window.shifted.onFocusInput(() => {
  input.focus();
  input.select();
});