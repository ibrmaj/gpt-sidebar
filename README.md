# GPT Sidebar

A Chrome extension that intelligently extracts and organizes questions from ChatGPT conversations, providing quick navigation and persistent storage across chat sessions.

## Demo

![Demo](https://github.com/ibrmaj/gpt-sidebar/blob/main/WhatsApp%20Video%202025-08-27%20at%2022.31.45.gif)

## Features

- **Smart Question Detection**: Automatically identifies and indexes user questions from ChatGPT conversations
- **Persistent Storage**: Saves questions per conversation using Chrome's local storage API
- **Quick Navigation**: Click any question to jump directly to the corresponding message
- **Theme Toggle**: Light/dark mode support with persistent preferences
- **Responsive Design**: Resizable sidebar with smooth animations and modern UI

## Technical Highlights

- Advanced DOM traversal and WeakMap-based node tracking
- SPA navigation detection with multiple fallback mechanisms
- Chrome extension API integration for storage and permissions
- Efficient state management across conversation switches
- CSS animations and responsive design patterns

## Installation

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `question-sidebar` folder
5. Visit ChatGPT and look for the "Questions" button on the right side

## Usage

- Click the "Questions" button to open the sidebar
- Questions are automatically captured as you chat
- Click any question in the sidebar to jump to that message
- Use the theme toggle for light/dark mode preference
- Resize the sidebar by dragging the left edge

## Development

Built with vanilla JavaScript, Chrome Extension APIs, and modern CSS. The extension intelligently handles ChatGPT's dynamic DOM structure and maintains conversation state across navigation.
