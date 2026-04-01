# WeChat Local Chat

<div align="center">

English | [中文](./README.md)

</div>

## 📖 Introduction

WeChat Local Chat is a locally deployed WeChat chat aggregation service that supports multi-account management, real-time message syncing, and AI Agent integration. It communicates with WeChat upstream APIs (ilink API) to send and receive messages, providing an intuitive web interface for management.

## ✨ Features

### 🎯 Core Features
- **Multi-Account Management**: Manage multiple WeChat accounts simultaneously with independent sessions and messages
- **Real-Time Message Sync**: Server-Sent Events (SSE) for real-time message delivery
- **Multi-Media Support**: Text, images, videos, voice messages, and files
- **Conversation Search**: Keyword search across message history
- **Data Export**: Export conversation records

### 🤖 Agent Integration
Support three AI Agent modes, triggered by commands:
- **Codex**: Code generation and editing
- **Claude**: Conversation and analysis
- **OpenClaw**: Supports auto / local / docker modes

### 🎨 User Experience
- **Dark/Light Theme**: Theme switching with system preference adaptation
- **Responsive Design**: Optimized for desktop and mobile
- **Debug Panel**: Real-time view of sync status, Agent bindings, and runtime logs
- **Notification System**: Desktop notifications (requires notify token configuration)

## 🛠️ Tech Stack

### Backend
- **Runtime**: Node.js >= 18
- **Language**: TypeScript
- **Database**: SQLite (better-sqlite3)
- **API**: RESTful + SSE (Server-Sent Events)

### Frontend
- **Framework**: Vue 3 (Composition API)
- **State Management**: Pinia
- **UI Library**: Naive UI
- **Build Tool**: Vite

## 📦 Installation & Configuration

### Prerequisites
- Node.js >= 18
- npm or yarn

### Installation Steps

```bash
# Clone the repository
git clone https://github.com/your-username/weixin-local-chat.git
cd weixin-local-chat

# Install dependencies
npm install

# Build the project
npm run build

# Start the service
npm start
```

### Development Mode

```bash
# Start frontend dev server (with hot reload)
npm run dev:web

# Start backend service (in another terminal)
npm run build:server && npm start
```

### Configuration

After starting the service, visit `http://127.0.0.1:3100` to open the web interface.

On first launch, an admin password is auto-generated. Check the console for:
```
[weixin-local-chat] admin password: <your-password>
[weixin-local-chat] notify token: <your-token>
```

After logging in, navigate to "Settings" to:
- Change the admin password
- Configure WeChat API base URL (default: `https://ilinkai.weixin.qq.com`)
- Configure Agent working directories
- Manage notification tokens

## 🚀 Usage Guide

### Scan QR Code Login
1. Click the "Scan QR Code" button
2. Use your phone's WeChat to scan the QR code
3. Confirm login and wait for account sync

### Send Messages
1. Select target account in the left panel
2. Select or create a conversation in the list
3. Enter message content in the bottom input box
4. Click "Send" or press Enter

### Agent Commands
Enter the following commands in the message input:
- `/codex <prompt>` - Invoke Codex Agent
- `/claude <prompt>` - Invoke Claude Agent
- `/openclaw <prompt>` - Invoke OpenClaw Agent

### Debug Panel
Click "Debug" in the top bar to open the debug panel, where you can view:
- **Overview**: Current account, message stats, sync status
- **Runtime Logs**: Filter logs by source and level
- **Raw JSON**: Complete debug data

## 📁 Project Structure

```
weixin-local-chat/
├── src/                      # Backend source code
│   ├── api/                  # WeChat upstream API wrappers
│   ├── auth/                 # Authentication related
│   ├── media/                # Media processing (CDN, transcoding)
│   ├── server/               # HTTP server
│   ├── service/              # Business logic
│   │   ├── chat-service.ts   # Chat service core
│   │   └── agent-router.ts   # Agent routing
│   ├── store/                # SQLite database
│   ├── utils/                # Utility functions
│   └── index.ts              # Entry point
├── public/                   # Frontend source code
│   └── src/
│       ├── api/              # API client
│       ├── components/       # Vue components
│       ├── stores/           # Pinia state management
│       ├── views/            # Page views
│       └── types.ts          # TypeScript type definitions
├── docs/                     # Documentation
│   ├── weixin-communication-openapi.md    # Local service API docs
│   ├── weixin-upstream-openapi.md          # WeChat upstream API docs
│   └── weixin-upstream-openapi-3.1.yaml   # WeChat upstream OpenAPI spec
├── data/                     # Runtime data (not committed)
├── dist/                     # Build output (not committed)
├── package.json
├── tsconfig.json
└── vite.config.mts
```

## 📚 Documentation

### docs Directory

| File | Description |
|------|-------------|
| `weixin-communication-openapi.md` | Documentation for local service HTTP/SSE APIs, including complete API routes, request parameters, and response formats |
| `weixin-upstream-openapi.md` | Documentation for WeChat upstream communication interfaces (`ilink/bot/*`) that this project depends on |
| `weixin-upstream-openapi-3.1.yaml` | OpenAPI 3.1 specification for WeChat upstream interfaces, useful for generating client code or API testing |

### API Categories

**Local Service APIs** (`/api/*`)
- `System` - Health check
- `Config` - Configuration management and validation
- `Account` - Account management (list, select, rename, delete)
- `Login` - QR code login (start, poll, status query)
- `Conversation` - Conversation management (list, open, select, clear)
- `Message` - Message operations (send, search, count, history loading)
- `Media` - Media file downloads
- `Export` - Data export
- `Debug` - Debug information and logs
- `Event` - SSE event push

**WeChat Upstream APIs** (`ilink/bot/*`)
- QR code login (get QR code, query status)
- Message pulling (incremental updates, historical messages)
- Message sending (text, media)
- Conversation configuration (typing status, pinned conversations)

## 🔧 Common Commands

```bash
# Type checking
npm run typecheck:web

# Clean build
npm run clean

# Full build
npm run build
```

## ⚠️ Important Notes

1. **Security**: Service binds to `127.0.0.1` by default, only accessible locally
2. **Data Storage**: All data stored in local `data/` directory, including SQLite database and media files
3. **Password Management**: The auto-generated password on first launch is shown only once, please save it securely
4. **Dependency Version**: Ensure Node.js version >= 18

## 🐛 Issue Reporting

When reporting issues, please provide:
- Operating system and Node.js version
- Complete error logs (console output)
- Steps to reproduce

## 📄 License

[To be added]

## 🙏 Acknowledgments

- [Vue.js](https://vuejs.org/) - The Progressive JavaScript Framework
- [Naive UI](https://www.naiveui.com/) - Vue 3 Component Library
- [Pinia](https://pinia.vuejs.org/) - Vue State Management
- [Vite](https://vitejs.dev/) - Next Generation Frontend Tooling
