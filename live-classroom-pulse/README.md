# Live Classroom Pulse — upgraded demo

## What's included

- Teacher dashboard with live anonymous understanding/confusion signals.
- Main lecture topics with teacher-added subheadings; students can select a subheading when sending feedback.
- Classroom QR display that refreshes its visual scan URL every 15 seconds. The room link remains valid so students who already joined are not disconnected.
- AI lecture quiz generation from teacher-pasted lecture text/slides/notes, or uploaded .txt/.md files. It creates a question bank (up to 30 questions) and assigns 10 questions per student token. Teacher dashboard shows aggregate scores.
- Private doubt request workflow: students provide their name only in the separate one-to-one request form; teachers can accept or decline.
- Teacher notes upload (PDF, TXT, MD, DOC/DOCX, PPT/PPTX, max 10 MB) and student download links.

## Run on Windows 11

1. Install Node.js 20 or newer.
2. Extract the ZIP.
3. Open the inner `live-classroom-pulse` folder in VS Code — it must contain `package.json` and `server.js`.
4. In the VS Code terminal, run these one at a time:

   ```powershell
   npm.cmd install
   npm.cmd run dev
   ```

5. Open `http://localhost:4173` on the laptop.
6. Students should scan the QR or open the LAN address printed in the terminal. Both devices must be on the same Wi-Fi.

## Enable AI quiz generation

AI generation requires an OpenAI API key. It is not bundled with this project and must not be placed in frontend code or shared in screenshots.

In PowerShell, set it for the current terminal session before starting the server:

```powershell
$env:OPENAI_API_KEY="paste-your-own-key-here"
npm.cmd run dev
```

Optional model override:

```powershell
$env:OPENAI_MODEL="gpt-4o-mini"
```

If no key is configured, the quiz page will explain that AI is unavailable. The app does not pretend to generate AI questions without the key. Teacher can paste lecture transcript, notes text, or slide text into the quiz form, or upload a plain-text .txt/.md file. PDF/DOC/PPT quiz-content extraction is not included; those formats can still be uploaded as downloadable lecture notes.

## Data and limitations

- Uploaded files are stored locally in `uploads/`; classroom data is stored in `data/classroom-state.json`.
- The QR's visual URL changes every 15 seconds, but it is not a security token and does not invalidate previous links.
- Each student browser session receives a deterministic individualized 10-question subset from the generated bank. Different students are very likely to receive different subsets; this is not an identity-based anti-cheating system.
- The doubt request separates the student's name from anonymous feedback in the app interface. **This prototype has no teacher authentication or hardened access control**, so do not use real student names or sensitive personal details on an untrusted network. Add teacher login, authorization, HTTPS, database security rules, retention controls, and audit logs before real classroom deployment.
- One-to-one doubt feature currently supports request + teacher accept/decline status. It does not provide built-in live video/chat.
- Local server / same-Wi-Fi hackathon demo only. It is not public internet hosting and has not been load-tested for 100+ simultaneous users.
- Use the `npm.cmd run build` command to run a production build check.


## Separate teacher and student login

- Open `http://localhost:4173/teacher-login` to create a teacher account and sign in (multiple teacher accounts are allowed by default; set ALLOW_TEACHER_SIGNUP=false to disable new teacher registrations).
- Open `http://localhost:4173/student-login` to create student accounts and sign in.
- Both use email + password. Passwords are stored as salted scrypt hashes in `data/accounts.json`; raw passwords are not stored.
- Teacher accounts are restricted to the teacher dashboard and teacher-only API actions. Student accounts are restricted to the student portal and student actions. Sessions use an HttpOnly cookie and are retained across local server restarts.
- Account data is stored locally in `data/accounts.json`. Back up this file securely. For deployment beyond a trusted local network, add HTTPS, persistent session storage, CSRF protection, rate limiting, and a managed database.
