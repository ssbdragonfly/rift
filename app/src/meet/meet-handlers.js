const meetFunctions = require('./google');
const { shell } = require('electron');
const { ensureAuth } = require('../calendar/google');
const { parseEvent } = require('../calendar/parser');
const axios = require('axios');

async function handleCreateMeeting(prompt, shell, win) {
  try {
    console.log('[meet-handlers] Creating meeting from prompt:', prompt);
    await ensureAuth(win);
    
    const { meetingDetails, emailRecipients } = await extractMeetingDetailsWithGemini(prompt);
    
    if (!meetingDetails) {
      return{
        type: 'error', 
        error: 'Unable to extract meeting details. Please try again with more specific information.' 
      };
    }
    
    console.log('[meet-handlers] Creating meeting:', meetingDetails.title);
    const meeting = await meetFunctions.createMeeting(
      meetingDetails.title,
      meetingDetails.start,
      meetingDetails.end,
      meetingDetails.attendees || [],
      meetingDetails.description || ''
    );
    
    let response = `Created Google Meet: "${meeting.summary}"\n\nMeet link: ${meeting.meetLink}`;
    
    if (emailRecipients && emailRecipients.length > 0) {
      try {
        const { ensureEmailAuth, getUserEmail, sendEmail } = require('../email/email');
        await ensureEmailAuth(win);
        const userEmail = await getUserEmail();
        const { generateMeetingInvitation } = require('./emailTemplates');
        const emailContent = await generateMeetingInvitation(meeting, userEmail, prompt);
        
        await sendEmail({
          from: userEmail,
          to: emailRecipients.join(', '),
          subject: emailContent.subject,
          body: emailContent.body
        });
        
        response += `\n\nShared via email with: ${emailRecipients.join(', ')}`;
      } catch (err) {
        console.error('[meet-handlers] Error sending email:', err);
        response += `\n\nNote: Couldn't send email invitation: ${err.message}`;
      }
    }
    
    if (meeting.attendees && meeting.attendees.length > 0) {
      response += `\n\nAttendees: ${meeting.attendees.map(a => a.email).join(', ')}`;
    }
    
    return { 
      type: 'meet-create', 
      response,
      meeting
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
  if (!process.env.GEMINI_API_KEY) {
    console.log('[meet-handlers] No Gemini API key available');
    return { meetingDetails: null, emailRecipients: [] };
  }
  
  try {
    console.log('[meet-handlers] Using Gemini to extract meeting details');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    
    const geminiPrompt = `
    Extract meeting details from this request: "${prompt}"
    
    Current time: ${now.toISOString()}
    
    Create a meeting with smart defaults if information is missing:
    - If no time specified, use next hour (${new Date(now.getTime() + 60 * 60 * 1000).toISOString()})
    - If no duration specified, make it 1 hour
    - If vague like "make a meeting", create for next available time
    
    Return JSON:
    {
      "meetingDetails": {
        "title": "Meeting title (default: 'Meeting')",
        "start": "ISO datetime",
        "end": "ISO datetime", 
        "attendees": ["email addresses"],
        "description": "description or null"
      },
      "emailRecipients": ["emails to send meeting link to"]
    }
    
    Be smart about extracting emails and times. Return only the JSON.
    `;
    
    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }],
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        topK: 40
      }
    };
    
    const resp = await axios.post(url, body, { timeout: 8000 });
    const text = resp.data.candidates[0].content.parts[0].text.trim();
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      console.log('[meet-handlers] Successfully extracted meeting details with Gemini');
      return result;
    }
  } catch (err) {
    console.error('[meet-handlers] Error using Gemini for meeting extraction:', err);
  }
  
  const now = new Date();
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  const endTime = new Date(nextHour.getTime() + 60 * 60 * 1000);
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emails = prompt.match(emailRegex) || [];
  
  return {
    meetingDetails: {
      title: "Meeting",
      start: nextHour.toISOString(),
      end: endTime.toISOString(),
      attendees: emails,
      description: null
    },
    emailRecipients: /\b(email|send|share)\b/i.test(prompt) ? emails : []
  };
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