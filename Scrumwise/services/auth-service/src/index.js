// Auth service: accounts, log in, sign up, and the list of people.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { HttpError, mongoose, requireUser, startService, wrap } from '@scrumwise/common';

const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  title: { type: String, default: 'Team member', trim: true, maxlength: 80 },
  hue: { type: Number, default: () => Math.floor(Math.random() * 360) }, // avatar colour
  timeZone: { type: String, default: '' }, // '' means: use the zone of the device
  hour24: { type: Boolean, default: false },
  home: { type: String, enum: ['for-you', 'spaces', 'board'], default: 'for-you' }, // the page shown after logging in
}, { timestamps: true }));

const view = (u) => ({ id: u.id, name: u.name, email: u.email, title: u.title, hue: u.hue, timeZone: u.timeZone || '', hour24: !!u.hour24, home: u.home || 'for-you' });
const validZone = (zone) => { try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; } };
const token = (u) => jwt.sign({ sub: u.id, name: u.name }, process.env.JWT_SECRET, { expiresIn: '7d' });
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

await startService({
  name: 'auth-service',
  routes(app, bus) {
    app.post('/signup', wrap(async (req, res) => {
      const { name = '', email = '', password = '' } = req.body;
      if (!name.trim()) throw new HttpError(400, 'Enter your full name.');
      if (!EMAIL.test(email.trim())) throw new HttpError(400, 'Enter a valid email address, like you@company.com.');
      if (password.length < 8) throw new HttpError(400, 'The password needs at least 8 characters.');
      if (await User.exists({ email: email.trim().toLowerCase() })) throw new HttpError(409, 'An account with this email already exists. Log in instead.');
      const user = await User.create({ name, email, title: req.body.title || undefined, passwordHash: await bcrypt.hash(password, 10) });
      bus.publish('user.created', view(user));
      bus.publish('push.all', { type: 'people' }); // open pages reload their list of people
      res.status(201).json({ token: token(user), user: view(user) });
    }));

    app.post('/login', wrap(async (req, res) => {
      const { email = '', password = '' } = req.body;
      const user = await User.findOne({ email: email.trim().toLowerCase() });
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new HttpError(401, 'Incorrect email address or password.');
      res.json({ token: token(user), user: view(user) });
    }));

    // Everyone with an account, so they can be added to projects, assigned issues and messaged.
    app.get('/users', requireUser, wrap(async (_req, res) => {
      res.json((await User.find().sort('name')).map(view));
    }));

    app.get('/users/me', requireUser, wrap(async (req, res) => {
      const user = await User.findById(req.user.id);
      if (!user) throw new HttpError(401, 'This account no longer exists.');
      res.json(view(user));
    }));

    app.patch('/users/me', requireUser, wrap(async (req, res) => {
      const user = await User.findById(req.user.id);
      if (!user) throw new HttpError(401, 'This account no longer exists.');
      if (typeof req.body.name === 'string' && req.body.name.trim()) user.name = req.body.name;
      if (typeof req.body.title === 'string') user.title = req.body.title.trim() || 'Team member';
      if (typeof req.body.timeZone === 'string') {
        if (req.body.timeZone && !validZone(req.body.timeZone)) throw new HttpError(400, 'Choose a time zone from the list.');
        user.timeZone = req.body.timeZone;
      }
      if (typeof req.body.hour24 === 'boolean') user.hour24 = req.body.hour24;
      if (['for-you', 'spaces', 'board'].includes(req.body.home)) user.home = req.body.home;
      if (req.body.newPassword) {
        if (!(await bcrypt.compare(String(req.body.currentPassword || ''), user.passwordHash))) throw new HttpError(400, 'Your current password is not correct.');
        if (String(req.body.newPassword).length < 8) throw new HttpError(400, 'The new password needs at least 8 characters.');
        user.passwordHash = await bcrypt.hash(String(req.body.newPassword), 10);
      }
      await user.save();
      bus.publish('push.all', { type: 'people' });
      res.json({ token: token(user), user: view(user) }); // a fresh token, because the name is inside it
    }));
  },
});
