const axios = require('axios');

async function generateMeetingInvitation(meeting, userEmail, prompt = '') {
  const now = new Date();
  const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
  const currentDate = now.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  const currentTime = now.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit'
  });
  
  const startDate = new Date(meeting.start.dateTime);
  const endDate = new Date(meeting.end.dateTime);
  
  const meetingDay = startDate.toLocaleDateString('en-US', { weekday: 'long' });
  const meetingDate = startDate.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  const startTime = startDate.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit'
  });
  const endTime = endDate.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit'
  });
  
  const defaultSubject = `Invitation: ${meeting.summary}`;
  const defaultBody = `
Hello,

I'd like to invite you to a meeting: ${meeting.summary}

Date: ${meetingDay}, ${meetingDate}
Time: ${startTime} - ${endTime}
Google Meet link: ${meeting.meetLink}

${meeting.description || ''}

This invitation was sent on ${currentDay}, ${currentDate} at ${currentTime}.

Best regards,
${userEmail.split('@')[0]}
`.trim();

  if (process.env.GEMINI_API_KEY) {
    try {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
      
      const geminiPrompt = `
      Create a professional meeting invitation email based on these details:
      
      Meeting title: ${meeting.summary}
      Meeting day: ${meetingDay}
      Meeting date: ${meetingDate}
      Meeting time: ${startTime} - ${endTime}
      Google Meet link: ${meeting.meetLink}
      Meeting description: ${meeting.description || 'N/A'}
      
      User's email: ${userEmail}
      Current day: ${currentDay}
      Current date: ${currentDate}
      Current time: ${currentTime}
      
      Original user request: "${prompt}"
      
      Return a JSON object with "subject" and "body" fields:
      {
        "subject": "The email subject line",
        "body": "The complete email body with greeting, details, and signature"
      }
      
      Make sure the email:
      1. Has a professional tone
      2. Includes all meeting details clearly formatted
      3. Includes the Google Meet link prominently
      4. Has a proper greeting and signature
      5. Mentions the current date/time as context for when the invitation was sent
      6. Incorporates any specific details or tone from the original user request
      
      Only return the JSON object, nothing else.
      `;
      
      const body = {
        contents: [{ parts: [{ text: geminiPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          topP: 0.95,
          topK: 40
        }
      };
      
      const resp = await axios.post(url, body, { timeout: 5000 });
      const text = resp.data.candidates[0].content.parts[0].text.trim();
      
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const emailContent = JSON.parse(jsonMatch[0]);
          return {
            subject: emailContent.subject || defaultSubject,
            body: emailContent.body || defaultBody
          };
        }
      } catch (err) {
        console.error('[emailTemplates] Error parsing Gemini response:', err);
      }
    } catch (err) {
      console.error('[emailTemplates] Error generating email with Gemini:', err);
    }
  }
  
  return {
    subject: defaultSubject,
    body: defaultBody
  };
}

module.exports = {
  generateMeetingInvitation
};