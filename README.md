<div align="center">
<img width="1200" height="475" alt="Blind Eye Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# 👁️ Blind Eye

### AI-Powered Visual Companion for the Visually Impaired

[![Google Gemini](https://img.shields.io/badge/Powered%20by-Google%20Gemini-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)

</div>

---

## 🌟 Overview

**Blind Eye** is a real-time AI-powered visual companion designed to assist visually impaired individuals in navigating their environment safely and independently. Using cutting-edge Google Gemini AI models, the app acts as a trusted friend walking beside the user, providing natural, conversational guidance about their surroundings.

### 🎯 Key Features

| Feature | Description |
|---------|-------------|
| **🚶 Live Navigation Mode** | Continuous real-time guidance using camera feed. Warns about obstacles, stairs, and hazards using clock-face directions (e.g., "Chair at 2 o'clock, 3 steps away"). |
| **🎤 Voice Assistant (Ask AI)** | Voice-activated Q&A. Ask anything: "What's in front of me?", "Read this sign", "Is the path clear?" |
| **🧠 Intelligent Model Routing** | Automatically selects the optimal AI model - Flash for quick responses, Gemini 3 Pro for complex analysis like reading documents. |
| **📍 Location-Aware** | Integrates with device GPS for context-aware navigation assistance. |
| **🔊 Text-to-Speech** | Clear, natural voice feedback for all guidance. |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        BLIND EYE APP                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Camera     │  │  Microphone  │  │    GPS Location      │  │
│  │   (WebRTC)   │  │  (Web API)   │  │    (Geolocation)     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│         ▼                 ▼                      ▼              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    React Frontend                         │  │
│  │  • App.tsx (Main Controller)                              │  │
│  │  • HUD Component (User Interface)                         │  │
│  │  • useSpeechRecognition Hook                              │  │
│  └──────────────────────────┬───────────────────────────────┘  │
│                              │                                  │
│  ┌───────────────────────────┼───────────────────────────────┐ │
│  │                    Services Layer                          │ │
│  │  ┌─────────────────┐ ┌─────────────────┐ ┌──────────────┐ │ │
│  │  │ geminiService   │ │   liveClient    │ │speechService │ │ │
│  │  │ • Model Router  │ │ • Real-time API │ │ • TTS Output │ │ │
│  │  │ • Smart Assist  │ │ • Audio I/O     │ │              │ │ │
│  │  │ • Navigation    │ │ • Video Stream  │ │              │ │ │
│  │  └────────┬────────┘ └────────┬────────┘ └──────────────┘ │ │
│  └───────────┼───────────────────┼───────────────────────────┘ │
│              │                   │                              │
└──────────────┼───────────────────┼──────────────────────────────┘
               │                   │
               ▼                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                    GOOGLE GEMINI AI                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ gemini-2.5-flash │  │ gemini-3-pro    │  │ Gemini Live API │  │
│  │ (Fast responses) │  │ (Deep analysis) │  │ (Real-time)     │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18 or higher
- **Google Gemini API Key** ([Get one here](https://makersuite.google.com/app/apikey))
- Modern browser with camera and microphone access

### Installation

```bash
# Clone the repository
git clone https://github.com/vanductan-NLT/blind-eye.git
cd blind-eye

# Install dependencies
npm install

# Configure API key
cp .env.local.example .env.local
# Edit .env.local and add your GEMINI_API_KEY

# Start development server
npm run dev
```

### Environment Variables

Create a `.env.local` file in the project root:

```env
GEMINI_API_KEY=your_api_key_here
```

---

## 📱 Usage

### Live Navigation Mode
1. Click **"START LIVE"** button
2. Point your camera forward as you walk
3. Receive continuous guidance like:
   - *"Path is clear, keep going straight."*
   - *"Stop! Stairs going down right in front of you."*
   - *"Chair at 2 o'clock, 3 steps away. Bear left."*

### Voice Assistant Mode
1. Click **"ASK AI"** button
2. Speak your question naturally
3. Examples:
   - "What's in front of me?"
   - "Read this sign"
   - "Is the path clear?"
   - "What color is this?"

---

## 🧠 AI Model Strategy

| Task Type | Model Used | Reason |
|-----------|------------|--------|
| Quick identification | `gemini-2.5-flash` | Speed priority |
| Document reading | `gemini-3-pro-preview` | Accuracy priority |
| Live navigation | `gemini-2.5-flash` | Real-time performance |
| Complex reasoning | `gemini-3-pro-preview` | Deep analysis |

The app uses an intelligent router that analyzes each query and automatically selects the optimal model.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **AI**: Google Gemini API, Gemini Live API
- **Speech**: Web Speech API (Recognition + Synthesis)
- **Camera**: WebRTC, react-webcam
- **Styling**: Tailwind CSS

---

## 📁 Project Structure

```
blind-eye/
├── App.tsx                 # Main application component
├── components/
│   └── HUD.tsx             # User interface overlay
├── hooks/
│   └── useSpeechRecognition.ts  # Voice input hook
├── services/
│   ├── geminiService.ts    # AI analysis & routing
│   ├── liveClient.ts       # Real-time Gemini Live API
│   ├── speechService.ts    # Text-to-speech output
│   └── audioUtils.ts       # Audio processing utilities
├── types.ts                # TypeScript definitions
└── vite.config.ts          # Build configuration
```

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **[Blind-Nav Android App](https://github.com/knightafter/Blind-Nav-Android-App-for-Blind-persons)** - The original inspiration for this project. Our web implementation builds upon the concepts and approaches pioneered by this excellent Android application.
- **Google Gemini** for powering the AI vision and language capabilities
- **Google AI Studio** for the development environment
- All contributors and testers who helped improve accessibility

## 💡 Inspiration

This project was inspired by and references the **[Blind-Nav Android App for Blind Persons](https://github.com/knightafter/Blind-Nav-Android-App-for-Blind-persons)** by [@knightafter](https://github.com/knightafter). 

We adapted the core navigation concepts for a web-based experience, making it accessible across all platforms without requiring app installation. Key inspiration includes:
- Real-time camera frame analysis for navigation
- Continuous voice guidance approach
- Priority-based obstacle detection (hazards > obstacles > path)
- Natural, conversational AI responses

---

<div align="center">

**Made with ❤️ for accessibility**

*Empowering independence for the visually impaired*

[View in AI Studio](https://ai.studio/apps/drive/1_XfGi2NxDB6oOnBmmaHuCudS4AH5PMQB) • [Report Bug](https://github.com/vanductan-NLT/blind-eye/issues) • [Request Feature](https://github.com/vanductan-NLT/blind-eye/issues)

</div>
