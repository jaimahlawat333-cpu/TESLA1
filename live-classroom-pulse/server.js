import express from 'express';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: true }, maxHttpBufferSize: 12e6 });
const PORT = Number(process.env.PORT || 4173);
app.use(express.json({ limit: '1mb' }));
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_FILE = path.join(DATA_DIR, 'classroom-state.json');
const AUTH_FILE = path.join(DATA_DIR, 'accounts.json');
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json');
const SESSION_COOKIE = 'pulse_session';
let accounts = [];
try { if (fs.existsSync(AUTH_FILE)) accounts = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch { accounts = []; }
const sessions = new Map();
// Keep signed-in sessions available after a server restart (useful during local classroom demos).
try { if (fs.existsSync(SESSION_FILE)) for (const [token, user] of Object.entries(JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')))) sessions.set(token, user); } catch { /* start with empty sessions if the file is damaged */ }
const saveSessions = () => fs.writeFileSync(SESSION_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2));
function readSessionToken(req) {
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const item = part.trim();
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator) !== SESSION_COOKIE) continue;
    try { return decodeURIComponent(item.slice(separator + 1)); } catch { return item.slice(separator + 1); }
  }
  return null;
}
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') });
const verifyPassword = (password, record) => { try { return crypto.timingSafeEqual(Buffer.from(hashPassword(password, record.salt).hash, 'hex'), Buffer.from(record.hash, 'hex')); } catch { return false; } };
const saveAccounts = () => fs.writeFileSync(AUTH_FILE, JSON.stringify(accounts, null, 2));
function currentUser(req) { const token = readSessionToken(req); return token ? sessions.get(token) : null; }
function requireRole(role) { return (req,res,next) => { const user=currentUser(req); if (!user) return res.status(401).json({error:'Please log in first.'}); if (role && user.role!==role) return res.status(403).json({error:'Access denied. This portal is for '+role+' accounts only.'}); req.user=user; next(); }; }
app.post('/api/auth/register', (req,res) => {
  const { email, password, role } = req.body || {}; const normalized=String(email||'').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) return res.status(400).json({error:'Enter a valid email address.'});
  if (typeof password!=='string' || password.length<8) return res.status(400).json({error:'Password must be at least 8 characters.'});
  if (!['teacher','student'].includes(role)) return res.status(400).json({error:'Choose a valid portal.'});
  if (accounts.some(a=>a.email===normalized && a.role===role)) return res.status(409).json({error:'A '+role+' account with this email already exists. Sign in instead.'});
  // Allow multiple teacher accounts for this classroom project. Set ALLOW_TEACHER_SIGNUP=false to disable public teacher registration in a deployed environment.
  if (role==='teacher' && process.env.ALLOW_TEACHER_SIGNUP === 'false') return res.status(403).json({error:'Teacher registration is disabled by the administrator.'});
  const account={id:crypto.randomUUID(),email:normalized,role,password:hashPassword(password)}; accounts.push(account); saveAccounts();
  const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,{id:account.id,email:account.email,role:account.role}); saveSessions(); res.setHeader('Set-Cookie',`${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`); res.json({ok:true,user:{email:account.email,role:account.role}});
});
app.post('/api/auth/login', (req,res) => {
  const email=String(req.body?.email||'').trim().toLowerCase(), password=String(req.body?.password||''), role=req.body?.role;
  const account=accounts.find(a=>a.email===email && a.role===role && a.password && a.password.salt && a.password.hash);
  if (!account || !verifyPassword(password,account.password)) return res.status(401).json({error:'Invalid email or password for this portal.'});
  const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,{id:account.id,email:account.email,role:account.role}); saveSessions(); res.setHeader('Set-Cookie',`${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`); res.json({ok:true,user:{email:account.email,role:account.role}});
});
app.get('/api/auth/me',(req,res)=>{const user=currentUser(req); if(!user)return res.status(401).json({error:'Not signed in.'}); res.json({user});});
app.post('/api/auth/logout',(req,res)=>{const token=readSessionToken(req); if(token){sessions.delete(token);saveSessions();} res.setHeader('Set-Cookie',`${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`); res.json({ok:true});});
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const defaultState = {
  room: { name: 'Python Fundamentals', code: 'PULSE24', teacher: 'Demo Teacher' },
  topics: [
    { id: 'variables', name: 'Variables & Data Types', subtopics: ['Declaring variables', 'Common data types'] },
    { id: 'conditions', name: 'Conditional Statements', subtopics: ['if / else', 'Comparison operators'] },
    { id: 'loops', name: 'For & While Loops', subtopics: ['for loops', 'while loops'] },
    { id: 'functions', name: 'Functions', subtopics: ['Defining functions', 'Parameters and return values'] }
  ],
  session: { id: 'demo-session', started: Date.now() - 25 * 60000, active: true },
  events: [], participants: {},
  polls: [{ id: 'poll-1', topic: 'loops', question: 'What does a for loop help you do?', options: ['Repeat a block of code', 'Create a variable', 'Stop a program', 'Style a webpage'], correct: 0, active: true, revealed: false, responses: {} }],
  questions: [], doubts: [], quizzes: [], notes: []
};
let classroomState = defaultState;
try {
  if (fs.existsSync(DATA_FILE)) classroomState = { ...defaultState, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
} catch (error) { console.error('Could not read saved classroom state:', error.message); }
function persist() {
  const temp = DATA_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(classroomState, null, 2));
  fs.renameSync(temp, DATA_FILE);
}
function publicState(role = 'teacher') {
  const copy = JSON.parse(JSON.stringify(classroomState));
  copy.quizzes = (copy.quizzes || []).map(q => role === 'student'
    ? ({ id:q.id, topic:q.topic, createdAt:q.createdAt, warning:q.warning, questionCount:q.questions?.length || q.questionCount || 0 })
    : ({ id:q.id, topic:q.topic, createdAt:q.createdAt, warning:q.warning, questionCount:q.questions?.length || q.questionCount || 0, results:q.results || {} }));
  if (role === 'student') copy.doubts = [];
  return copy;
}
function getLanAddresses() {
  const found = [];
  for (const entries of Object.values(os.networkInterfaces())) for (const item of entries || []) {
    if (item.family === 'IPv4' && !item.internal && (item.address.startsWith('192.168.') || item.address.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(item.address))) found.push(item.address);
  }
  return [...new Set(found)].sort((a,b) => (a.startsWith('192.168.')?0:a.startsWith('10.')?1:2)-(b.startsWith('192.168.')?0:b.startsWith('10.')?1:2));
}
app.get('/api/state', (req, res) => { const user=currentUser(req); if(!user)return res.status(401).json({error:'Please log in.'}); if(req.query.view==='student' && user.role!=='student')return res.status(403).json({error:'Student portal only.'}); if(req.query.view!=='student' && user.role!=='teacher')return res.status(403).json({error:'Teacher dashboard only.'}); res.json(publicState(user.role)); });
app.post('/api/state', (req, res) => {
  const user=currentUser(req); if(!user)return res.status(401).json({error:'Please log in.'});
  const next = req.body;
  if(user.role==='student'){
    if(!next || !Array.isArray(next.events) || !next.participants || !Array.isArray(next.polls))return res.status(400).json({error:'Invalid student update.'});
    const knownEvents=new Set(classroomState.events.map(e=>e.id));
    for(const e of next.events.slice(-20)){if(e && !knownEvents.has(e.id) && ['understood','confused'].includes(e.kind) && typeof e.topic==='string')classroomState.events.push({...e,who:user.id,at:Date.now()});}
    classroomState.participants[user.id]={lastActive:Date.now()};
    classroomState.questions ||= []; for(const q of (next.questions||[]).slice(-5))if(q&&typeof q.text==='string'&&!classroomState.questions.some(x=>x.id===q.id))classroomState.questions.push({id:crypto.randomUUID(),text:q.text.slice(0,1000),at:Date.now()});
    for(const incoming of next.polls){const poll=classroomState.polls.find(p=>p.id===incoming.id);if(poll && incoming.responses && Object.hasOwn(incoming.responses,user.id)){const value=incoming.responses[user.id];if(Number.isInteger(value)&&value>=0&&value<poll.options.length)poll.responses[user.id]=value;}}
    publish(); return res.json({ok:true});
  }
  if (!next || typeof next !== 'object' || !next.room || !Array.isArray(next.topics) || !Array.isArray(next.events) || !Array.isArray(next.polls)) return res.status(400).json({ error: 'Invalid classroom state.' });
  const preservedQuizzes = classroomState.quizzes || [];
  const preservedDoubts = classroomState.doubts || [];
  classroomState = { ...classroomState, ...next };
  classroomState.doubts = preservedDoubts;
  classroomState.quizzes = preservedQuizzes.map(old => {
    const incoming = (next.quizzes || []).find(q => q.id === old.id);
    return incoming ? { ...old, results: incoming.results || old.results } : old;
  });
  try { publish(); } catch { return res.status(500).json({ error: 'Could not save classroom data.' }); }
  res.json({ ok: true });
});
app.get('/api/config', (_req, res) => {
  const ips = getLanAddresses();
  res.json({ joinOrigins: ips.map(ip => `http://${ip}:${PORT}`), joinOrigin: ips[0] ? `http://${ips[0]}:${PORT}` : `http://localhost:${PORT}`, aiConfigured: Boolean(process.env.OPENAI_API_KEY) });
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${path.extname(file.originalname).slice(0,12)}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
  const allowed = /\.(pdf|txt|md|docx|pptx|ppt|doc)$/i.test(file.originalname);
  cb(allowed ? null : new Error('Upload PDF, TXT, DOC/DOCX, or PPT/PPTX files only.'), allowed);
}});
app.post('/api/notes', requireRole('teacher'), upload.single('notes'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a notes file first.' });
  const note = { id: crypto.randomUUID(), name: path.basename(req.file.originalname), file: req.file.filename, size: req.file.size, uploadedAt: Date.now() };
  classroomState.notes ||= [];
  classroomState.notes.unshift(note);
  publish();
  res.json({ ok: true, note });
});
app.get('/api/notes/:id/download', (req, res) => { if(!currentUser(req))return res.status(401).send('Please log in.');
  const note = (classroomState.notes || []).find(n => n.id === req.params.id);
  if (!note) return res.status(404).send('Notes not found.');
  const filePath = path.join(UPLOAD_DIR, path.basename(note.file));
  if (!fs.existsSync(filePath)) return res.status(404).send('File is no longer available.');
  res.download(filePath, note.name);
});
app.delete('/api/notes/:id', requireRole('teacher'), (req, res) => {
  const index = (classroomState.notes || []).findIndex(n => n.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Notes not found.' });
  const [note] = classroomState.notes.splice(index, 1);
  try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(note.file))); } catch {}
  publish(); res.json({ ok: true });
});

app.post('/api/doubts', requireRole('student'), (req, res) => {
  const { name, question, studentToken } = req.body || {};
  if (!String(name || '').trim() || !String(question || '').trim() || !studentToken) return res.status(400).json({ error: 'Name and doubt are required for a private session.' });
  classroomState.doubts ||= [];
  const doubt = { id: crypto.randomUUID(), name: String(name).trim().slice(0,80), question: String(question).trim().slice(0,1500), studentToken: String(studentToken).slice(0,100), status: 'pending', createdAt: Date.now() };
  classroomState.doubts.unshift(doubt); publish(); res.json({ ok: true, doubtId: doubt.id });
});
app.post('/api/doubts/:id/status', requireRole('teacher'), (req, res) => {
  const doubt = (classroomState.doubts || []).find(d => d.id === req.params.id);
  if (!doubt) return res.status(404).json({ error: 'Request not found.' });
  if (!['accepted','declined','completed'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status.' });
  doubt.status = req.body.status; publish(); res.json({ ok: true });
});

app.post('/api/quizzes/generate', requireRole('teacher'), async (req, res) => {
  const { material, topic } = req.body || {};
  if (!String(material || '').trim() || String(material).trim().length < 100) return res.status(400).json({ error: 'Paste at least 100 characters of lecture transcript, notes, or slide text.' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'AI is not configured yet. Add OPENAI_API_KEY to your environment and restart the server. Your lecture text has not been sent anywhere.' });
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Create a quiz strictly from the supplied lecture material. Do not add facts not supported by it. Return JSON {"questions":[{"question":"...","options":["...","...","...","..."],"correct":0,"explanation":"..."}]}. Create exactly 30 distinct multiple-choice questions, each with four options and one correct option index 0-3. If the source does not support 30 distinct questions, create only as many grounded questions as possible and include a "warning" field explaining the limitation.' },
          { role: 'user', content: `Topic: ${String(topic || 'Lecture').slice(0,200)}\n\nLecture material:\n${String(material).slice(0,30000)}` }
        ]
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `AI request failed (${response.status})`);
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    const questions = (parsed.questions || []).filter(q => typeof q.question === 'string' && Array.isArray(q.options) && q.options.length === 4 && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < 4).slice(0,30);
    if (questions.length < 10) return res.status(422).json({ error: parsed.warning || 'The lecture material did not contain enough information for 10 reliable questions. Add more lecture content.' });
    const quiz = { id: crypto.randomUUID(), topic: String(topic || 'Lecture'), createdAt: Date.now(), questions, warning: parsed.warning || null, assignments: {}, results: {} };
    classroomState.quizzes ||= [];
    classroomState.quizzes.unshift(quiz); publish();
    res.json({ ok: true, quiz: { id: quiz.id, topic: quiz.topic, questionCount: quiz.questions.length, warning: quiz.warning } });
  } catch (error) { res.status(500).json({ error: error.message || 'Could not generate quiz.' }); }
});
function assignedQuestions(quiz, token) {
  const seed = crypto.createHash('sha256').update(`${quiz.id}:${token}`).digest();
  const shuffled = [...quiz.questions].sort((a,b) => {
    const ah = crypto.createHash('sha256').update(`${seed.toString('hex')}:${a.question}`).digest('hex');
    const bh = crypto.createHash('sha256').update(`${seed.toString('hex')}:${b.question}`).digest('hex');
    return ah.localeCompare(bh);
  });
  return shuffled.slice(0,10).map((q, i) => ({ id: `${i}`, question: q.question, options: q.options }));
}
app.get('/api/quizzes/active', requireRole('student'), (req, res) => {
  const token = String(req.query.token || '').slice(0,100);
  const quiz = (classroomState.quizzes || [])[0];
  if (!quiz || !token) return res.json({ quiz: null });
  const assigned = assignedQuestions(quiz, token);
  res.json({ quiz: { id: quiz.id, topic: quiz.topic, questions: assigned, submitted: Boolean(quiz.results[token]) } });
});
app.post('/api/quizzes/:id/submit', requireRole('student'), (req, res) => {
  const { token, answers } = req.body || {};
  const quiz = (classroomState.quizzes || []).find(q => q.id === req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  if (!token || !Array.isArray(answers) || quiz.results[token]) return res.status(400).json({ error: 'Invalid submission or quiz already submitted.' });
  const assigned = assignedQuestions(quiz, token);
  if (answers.length !== assigned.length) return res.status(400).json({ error: 'Please answer all 10 questions.' });
  const score = answers.reduce((sum, answer, i) => sum + (Number(answer) === quiz.questions.find(q => q.question === assigned[i].question)?.correct ? 1 : 0), 0);
  quiz.results[token] = { score, total: assigned.length, submittedAt: Date.now() };
  publish(); res.json({ ok: true, score, total: assigned.length });
});
app.use((error, req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is too large. Maximum upload size is 10 MB.' });
  console.error('Request failed:', req.method, req.path, error);
  res.status(400).json({ error: error.message || 'Request failed.' });
});

io.use((socket,next)=>{ const cookie=socket.handshake.headers.cookie||''; let token=null; for(const part of cookie.split(';')){const item=part.trim(),i=item.indexOf('=');if(i>=0&&item.slice(0,i)===SESSION_COOKIE){try{token=decodeURIComponent(item.slice(i+1));}catch{token=item.slice(i+1);}break;}} const user=token?sessions.get(token):null; if(!user)return next(new Error('Authentication required')); socket.data.user=user; next(); });
io.on('connection', socket => {
  const role = socket.data.user.role;
  socket.join(role === 'student' ? 'students' : 'teachers');
  socket.emit('state:update', publicState(role));
});
function publish() {
  persist();
  io.to('teachers').emit('state:update', publicState('teacher'));
  io.to('students').emit('state:update', publicState('student'));
}
const vite = await createViteServer({
  configFile: path.join(__dirname, 'vite.config.js'),
  server: { middlewareMode: true, hmr: { server: httpServer } },
  appType: 'spa'
});
app.use(vite.middlewares);
httpServer.listen(PORT, '0.0.0.0', () => {
  const ips = getLanAddresses();
  console.log(`\n  Live Classroom Pulse is ready`);
  console.log(`  Laptop:  http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Students on same Wi-Fi: http://${ip}:${PORT}`);
  console.log(`  AI quizzes: ${process.env.OPENAI_API_KEY ? 'configured' : 'not configured (set OPENAI_API_KEY)'}`);
  console.log(`  Press Ctrl+C to stop the server\n`);
});
