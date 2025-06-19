# Rift

Rift is an AI-powered personal assistant that helps you manage your calendar events and emails through a simple, natural language interface.

## Features

### Calendar Management
- Create calendar events with natural language
- Query your calendar for upcoming events
- Delete events
- Modify existing events

### Email Management
- View unread emails
- Search emails by subject or sender
- View email content with HTML rendering
- Reply to emails directly from the viewer
- Draft new emails with professional formatting

### Google Meet Management

### Google Drive Management


### Authentication Flow

1. OAuth2 authentication with Google
2. Token storage using keytar for secure credential management
3. Automatic token refresh
4. Re-authentication when tokens expire or become invalid

## Keyboard Shortcuts
- **Cmd+Shift+Space**: Show/hide the app
- **Cmd+Shift+R**: Reset the prompt
- **Cmd+Shift+F**: Store context for follow-up
- **Cmd+Y**: Send email draft

## Technical Details

### Dependencies
- Electron: Desktop application framework
- Google APIs: Calendar and Gmail integration
- Gemini AI: Intent detection and content generation
- Keytar: Secure credential storage

### Authentication
- Uses OAuth2 for Google API authentication
- Stores refresh tokens securely using keytar
- Automatically refreshes access tokens
- Handles re-authentication when needed

### Data Flow
1. User enters a prompt
2. Intent is detected using Gemini AI
3. Prompt is routed to appropriate handler
4. Handler processes the request and returns a response
5. Response is displayed to the user

## Development

### Setup
1. Clone the repository
2. Install dependencies: `npm install`
3. Create a .env file with required API keys and credentials
4. Start the app: `npm start`

### Environment Variables
- `GOOGLE_CLIENT_ID`: Google OAuth client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret
- `GOOGLE_API_KEY`: Google API key
- `GEMINI_API_KEY`: Google Gemini API key

### Building
- Build for macOS: `npm run build:mac`
- Build for Windows: `npm run build:win`
- Build for Linux: `npm run build:linux`