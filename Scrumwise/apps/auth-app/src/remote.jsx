// Micro-frontend: log in and sign up.
import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { createRemote, fields } from '@scrumwise/ui';
import { cleared, store, submitted } from './store.js';

const DEMO = { email: 'maya.chen@atlas.example', password: 'demo1234' };

function Password({ name, label, ...rest }) {
  const [shown, setShown] = useState(false);
  return (
    <label>{label}
      <span className="pass">
        <input name={name} type={shown ? 'text' : 'password'} required {...rest} />
        <button type="button" className="link" onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</button>
      </span>
    </label>
  );
}

export function App({ mode = 'login', note }) {
  const login = mode !== 'signup';
  const dispatch = useDispatch();
  const { busy, error } = useSelector((state) => state.auth);
  const [values, setValues] = useState({});
  useEffect(() => { dispatch(cleared()); }, [mode, dispatch]); // an error from the other form should not linger

  // The saga in store.js does the work: it calls the server, saves the session and moves on.
  const submit = (e) => {
    e.preventDefault();
    dispatch(submitted({ mode: login ? 'login' : 'signup', values: fields(e.target) }));
  };

  return (
    <div className="auth">
      <aside className="auth-side">
        <p className="auth-kicker">Scrumwise</p>
        <h2>Plan the sprint.<br />Ship the work.<br />Keep the client in the loop.</h2>
        <ul>
          <li><b>Backlog, sprints and a board</b> that work the way your team already does.</li>
          <li><b>Channels and direct messages</b> beside the work, not in another app.</li>
          <li><b>Clients</b> follow progress and talk to the team in one place.</li>
        </ul>
      </aside>
      <form className="auth-card" onSubmit={submit} key={mode} noValidate>
        <img src="/images/logo.jpg" alt="Scrumwise" className="brand-logo" />
        <h1>{login ? 'Log in to continue' : 'Sign up to continue'}</h1>
        {note && !error && <p className="auth-note">{note}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {!login && <label>Full name<input name="name" required autoComplete="name" autoFocus /></label>}
        <label>Email address
          <input name="email" type="email" required autoComplete="email" placeholder="Enter your email" autoFocus={login}
            value={values.email ?? ''} onChange={(e) => setValues({ ...values, email: e.target.value })} />
        </label>
        <Password name="password" label="Password" autoComplete={login ? 'current-password' : 'new-password'} placeholder={login ? 'Enter your password' : 'At least 8 characters'}
          value={values.password ?? ''} onChange={(e) => setValues({ ...values, password: e.target.value })} />
        {!login && <Password name="confirm" label="Confirm password" autoComplete="new-password" />}
        <button className="btn primary big" disabled={busy}>{busy ? 'Please wait…' : login ? 'Log in' : 'Sign up'}</button>
        <p className="auth-switch">
          {login
            ? <>New here? <a className="link" href="#/signup">Create an account</a></>
            : <>Already have an account? <a className="link" href="#/login">Log in</a></>}
        </p>
        {login && (
          <div className="demo">
            <span><b>Demo account</b><br />{DEMO.email} · {DEMO.password}</span>
            <button type="button" className="btn" onClick={() => setValues(DEMO)}>Use it</button>
          </div>
        )}
      </form>
    </div>
  );
}

export const mount = createRemote(App, store);
