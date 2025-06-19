const meetFunctions = require('./google');
const { shell } = require('electron');
const { ensureAuth } = require('../calendar/google');
const { parseEvent } = require('../calendar/parser');
const axios = require('axios');

async function handleCreateMeeting(prompt, shell, win) {
  try {
    console.log('[meet-handlers] Starting to create meeting from prompt:', prompt);
    await ensureAuth(win);
    const { meetingDetails, emailRecipients } = await extractMeetingDetailsWithGemini(prompt);
    console.log('[meet-handlers] Extracted meeting details:', meetingDetails ? 'yes' : 'no');
    console.log('[meet-handlers] Extracted email recipients:', emailRecipients);
    
    if (!meetingDetails) {
      console.log('[meet-handlers] No meeting details from Gemini, using calendar parser');
      const parsed = await parseEvent(prompt);
      if (typeof parsed === 'string') {
        return { type: 'chat', response: parsed };
      }
      
      if (!parsed.start || !parsed.end) {
        return { 
          type: 'chat', 
          response: `I understood you want to create a meeting, but I need more information about the date and time.` 
        };
      }
      
      console.log('[meet-handlers] Creating meeting with parsed details:', parsed.title);
      const meeting = await meetFunctions.createMeeting(
        parsed.title,
        parsed.start,
        parsed.end,
        parsed.attendees || [],
        parsed.description || ''
      );
      console.log('[meet-handlers] Meeting created successfully with ID:', meeting.id);
      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
      const emails = prompt.match(emailRegex) || [];
      if (emails.length > 0 && /\b(email|send|share|invite)\b/i.test(prompt)) {
        try {
          console.log('[meet-handlers] Sending meeting link via email to:', emails);
          const { ensureEmailAuth, getUserEmail, sendEmail } = require('../email/email');
          await ensureEmailAuth(win);
          
          const userEmail = await getUserEmail();
          const { generateMeetingInvitation } = require('./emailTemplates');
          const emailContent = await generateMeetingInvitation(meeting, userEmail, prompt);
          const emailDraft = {
            from: userEmail,
            to: emails.join(', '),
            subject: emailContent.subject,
            body: emailContent.body
          };
          
          await sendEmail(emailDraft);
          console.log('[meet-handlers] Email sent successfully');
          
          return { 
            type: 'meet-create', 
            response: `Created Google Meet: "${meeting.summary}"\n\nMeet link: ${meeting.meetLink}\n\nShared the meeting link via email with: ${emails.join(', ')}`,
            meeting: meeting
          };
        } catch (err) {
          console.error('[meet-handlers] Error sending meeting link via email:', err);
          return { 
            type: 'meet-create', 
            response: `Created Google Meet: "${meeting.summary}"\n\nMeet link: ${meeting.meetLink}\n\nNote: I couldn't send the meeting link via email due to an error: ${err.message}`,
            meeting: meeting
          };
        }
      }
      
      return { 
        type: 'meet-create', 
        response: `Created Google Meet: "${meeting.summary}"\n\nMeet link: ${meeting.meetLink}\n\nAttendees: ${meeting.attendees ? meeting.attendees.map(a => a.email).join(', ') : 'None'}`,
        meeting: meeting
      };
    }
    
    console.log('[meet-handlers] Creating meeting with extracted details:', meetingDetails.title);
    const meeting = await meetFunctions.createMeeting(
      meetingDetails.title,
      meetingDetails.start,
      meetingDetails.end,
      meetingDetails.attendees || [],
      meetingDetails.description || ''
    );
    console.log('[meet-handlers] Meeting created successfully with ID:', meeting.id);
    
    if (emailRecipients && emailRecipients.length > 0) {
      try {
        console.log('[meet-handlers] Sending meeting link via email to:', emailRecipients);
        const { ensureEmailAuth, getUserEmail, sendEmail } = require('../email/email');
        await ensureEmailAuth(win);
        const userEmail = await getUserEmail();
        const { generateMeetingInvitation } = require('./emailTemplates');
        const emailContent = await generateMeetingInvitation(meeting, userEmail, prompt);
        const emailDraft = {
          from: userEmail,
          to: emailRecipients.join(', '),
          subject: emailContent.subject,
          body: emailContent.body
        };
        
        await sendEmail(emailDraft);
        console.log('[meet-handlers] Email sent successfully');
        
        return { 
          type: 'meet-create', 
          response: `Created Google Meet: "${meeting.summary}"\n\nMeet link: ${meeting.meetLink}\n\nShared the meeting link via email with: ${emailRecipients.join(', ')}`,
          meeting: meeting
        };
      } catch (err) {
        console.error('[meet-handlers] Error sending meeting link via email:', err);
        return { 
          type: 'meet-create', 
          response: `Created Google Meet: "${meeting.summary}"\n\nMeet link: ${meeting.meetLink}\n\nNote: I couldn't send the meeting link via email due to an error: ${err.message}`,
          meeting: meeting
        };
      }
    }
    
    return { 
      type: 'meet-create', 
      response: `Created Google Meet: "${meeting.summary}"\n\nMeet link: ${meeting.meetLink}\n\nAttendees: ${meeting.attendees ? meeting.attendees.map(a => a.email).join(', ') : 'None'}`,
      meeting: meeting
    };
  } catch (err) {
    console.error('[meet-handlers] Error creating meeting:', err);
    if (err.message === 'auth required') {
      const { getAuthUrl } = require('../calendar/google');
      const authUrl = await getAuthUrl();
      shell.openExternal(authUrl);
      return { 
        type: 'error', 
        error: 'Authentication required. Please check your browser to complete the sign-in process.' 
      };
    }
    return { type: 'error', error: `Failed to create meeting: ${err.message}` };
  }
}

async function handleAddAttendeesToMeeting(prompt, shell, win) {
  try {
    await ensureAuth(win);
    const { meetingId, attendees } = await extractMeetingAttendeesWithGemini(prompt);
    
    if (!meetingId || attendees.length === 0) {
      return { 
        type: 'meet-update', 
        response: 'Please specify which meeting to update and which attendees to add.' 
      };
    }
    
    const result = await meetFunctions.addAttendeesToMeeting(meetingId, attendees);
    return { 
      type: 'meet-update', 
      response: `Added ${attendees.join(', ')} to the meeting "${result.summary}".`,
      meeting: result
    };
  } catch (err) {
    console.error('[meet-handlers] Error adding attendees to meeting:', err);
    if (err.message === 'auth required') {
      const { getAuthUrl } = require('../calendar/google');
      const authUrl = await getAuthUrl();
      shell.openExternal(authUrl);
      return { 
        type: 'error', 
        error: 'Authentication required. Please check your browser to complete the sign-in process.' 
      };
    }
    return { type: 'error', error: `Failed to update meeting: ${err.message}` };
  }
}

async function handleShareMeetingViaEmail(prompt, shell, win) {
  try {
    await ensureAuth(win);
    const { meetingId, recipients } = await extractMeetingShareDetailsWithGemini(prompt);
    if (!meetingId || recipients.length === 0) {
      return { 
        type: 'meet-share', 
        response: 'Please specify which meeting to share and with whom (email addresses).' 
      };
    }
    
    const meeting = await meetFunctions.getMeeting(meetingId);
    const { ensureEmailAuth, getUserEmail } = require('../email/email');
    await ensureEmailAuth(win);
    const userEmail = await getUserEmail();
    const { generateMeetingInvitation } = require('./emailTemplates');
    const emailContent = await generateMeetingInvitation(meeting, userEmail, prompt);
    const emailDraft = {
      from: userEmail,
      to: recipients.join(', '),
      subject: emailContent.subject,
      body: emailContent.body
    };
    
    const { sendEmail } = require('../email/email');
    await sendEmail(emailDraft);
    
    return { 
      type: 'meet-share', 
      response: `Shared meeting "${meeting.summary}" via email with ${recipients.join(', ')}.`,
      meeting: meeting
    };
  } catch (err) {
    console.error('[meet-handlers] Error sharing meeting via email:', err);
    if (err.message === 'auth required') {
      const { getAuthUrl } = require('../calendar/google');
      const authUrl = await getAuthUrl();
      shell.openExternal(authUrl);
      return { 
        type: 'error', 
        error: 'Authentication required. Please check your browser to complete the sign-in process.' 
      };
    }
    return { type: 'error', error: `Failed to share meeting: ${err.message}` };
  }
}

async function extractMeetingDetailsWithGemini(prompt) {
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emails = prompt.match(emailRegex) || [];
  const defaultEmailRecipients = /\b(email|send|share|invite)\b/i.test(prompt) ? emails : [];
  
  if (!process.env.GEMINI_API_KEY) {
    console.log('[meet-handlers] No Gemini API key, using regex fallback');
    return { 
      meetingDetails: null, 
      emailRecipients: defaultEmailRecipients
    };
  }
  
  try {
    console.log('[meet-handlers] Sending request to Gemini API for meeting details');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Extract meeting details and email recipients from this request:
    "${prompt}"
    
    Return a JSON object with these fields:
    - meetingDetails: An object containing meeting information with these fields:
      - title: The title for the meeting (do NOT include email addresses in the title)
      - start: The start time in ISO format (e.g., "2023-06-15T15:00:00-07:00")
      - end: The end time in ISO format
      - attendees: An array of email addresses for attendees (can be empty)
      - description: Meeting description (or null if not specified)
    - emailRecipients: An array of email addresses to send the meeting link to (separate from attendees)
    
    IMPORTANT: If the user wants to "email the meeting link" or similar, extract the email addresses and put them in emailRecipients, NOT in the meeting title.
    
    Examples:
    Request: "Create a Google Meet for tomorrow at 3pm and email it to john@example.com"
    Response: {
      "meetingDetails": {
        "title": "Meeting",
        "start": "2023-06-15T15:00:00-07:00",
        "end": "2023-06-15T16:00:00-07:00",
        "attendees": [],
        "description": null
      },
      "emailRecipients": ["john@example.com"]
    }
    
    Request: "make a google meet and invite bishtshaurya314@gmail.com"
    Response: {
      "meetingDetails": {
        "title": "Meeting",
        "start": "2023-06-15T15:00:00-07:00",
        "end": "2023-06-15T16:00:00-07:00",
        "attendees": [],
        "description": null
      },
      "emailRecipients": ["bishtshaurya314@gmail.com"]
    }
    
    Only return the JSON object, nothing else.
    `;
    
    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }],
      generationConfig: {
        temperature: 0.1,
        topP: 1.0,
        topK: 1
      }
    };
    
    const resp = await axios.post(url, body, { timeout: 5000 });
    const text = resp.data.candidates[0].content.parts[0].text.trim();
    console.log('[meet-handlers] Received response from Gemini API');
    
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        console.log('[meet-handlers] Successfully parsed Gemini response');
        if (result.meetingDetails && result.meetingDetails.title) {
          const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
          if (emailRegex.test(result.meetingDetails.title)) {
            console.log('[meet-handlers] Found email in title, removing');
            result.meetingDetails.title = "Meeting";
          }
        }
        
        if (!result.emailRecipients || result.emailRecipients.length === 0) {
          if (emails.length > 0 && /\b(email|send|share|invite)\b/i.test(prompt)) {
            console.log('[meet-handlers] Adding emails from prompt to recipients:', emails);
            result.emailRecipients = emails;
          }
        }
        
        return result;
      } else {
        console.error('[meet-handlers] No JSON found in Gemini response');
      }
    } catch (err) {
      console.error('[meet-handlers] Error parsing Gemini response:', err);
    }
    
    console.log('[meet-handlers] Falling back to regex extraction');
    return { 
      meetingDetails: null, 
      emailRecipients: defaultEmailRecipients
    };
  } catch (err) {
    console.error('[meet-handlers] Error using Gemini for meeting details extraction:', err);
    
    console.log('[meet-handlers] Falling back to regex extraction after error');
    return { 
      meetingDetails: null, 
      emailRecipients: defaultEmailRecipients
    };
  }
}

async function extractMeetingAttendeesWithGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    return extractMeetingAttendees(prompt);
  }
  
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Extract the meeting ID and attendees to add from this request:
    "${prompt}"
    
    Return a JSON object with these fields:
    - meetingId: The meeting ID
    - attendees: An array of email addresses to add to the meeting
    
    Example:
    Request: "Add john@example.com and sarah@example.com to meeting abc123"
    Response: {"meetingId": "abc123", "attendees": ["john@example.com", "sarah@example.com"]}
    
    Only return the JSON object, nothing else.
    `;
    
    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }],
      generationConfig: {
        temperature: 0.0,
        topP: 1.0,
        topK: 1
      }
    };
    
    const resp = await axios.post(url, body, { timeout: 3000 });
    const text = resp.data.candidates[0].content.parts[0].text.trim();
    
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (err) {
      console.error('[meet-handlers] Error parsing Gemini response:', err);
    }
    
    return extractMeetingAttendees(prompt);
  } catch (err) {
    console.error('[meet-handlers] Error using Gemini for meeting attendees extraction:', err);
    return extractMeetingAttendees(prompt);
  }
}

async function extractMeetingShareDetailsWithGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    return extractMeetingShareDetails(prompt);
  }
  
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Extract the meeting ID and recipients from this sharing request:
    "${prompt}"
    
    Return a JSON object with these fields:
    - meetingId: The meeting ID
    - recipients: An array of email addresses to share the meeting with
    
    Example:
    Request: "Share meeting abc123 with john@example.com and sarah@example.com"
    Response: {"meetingId": "abc123", "recipients": ["john@example.com", "sarah@example.com"]}
    
    Only return the JSON object, nothing else.
    `;
    
    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }],
      generationConfig: {
        temperature: 0.0,
        topP: 1.0,
        topK: 1
      }
    };
    
    const resp = await axios.post(url, body, { timeout: 3000 });
    const text = resp.data.candidates[0].content.parts[0].text.trim();
    
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (err) {
      console.error('[meet-handlers] Error parsing Gemini response:', err);
    }
    
    return extractMeetingShareDetails(prompt);
  } catch (err) {
    console.error('[meet-handlers] Error using Gemini for meeting share details extraction:', err);
    return extractMeetingShareDetails(prompt);
  }
}

function extractMeetingAttendees(prompt) {
  const meetingIdMatch = prompt.match(/meeting\s+(?:id\s+)?([a-zA-Z0-9_-]+)/i);
  const meetingId = meetingIdMatch ? meetingIdMatch[1] : null;
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const attendees = prompt.match(emailRegex) || [];
  
  return { meetingId, attendees };
}

function extractMeetingShareDetails(prompt) {
  const meetingIdMatch = prompt.match(/meeting\s+(?:id\s+)?([a-zA-Z0-9_-]+)/i);
  const meetingId = meetingIdMatch ? meetingIdMatch[1] : null;
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const recipients = prompt.match(emailRegex) || [];
  
  return { meetingId, recipients };
}

module.exports = {
  handleCreateMeeting,
  handleAddAttendeesToMeeting,
  handleShareMeetingViaEmail
};