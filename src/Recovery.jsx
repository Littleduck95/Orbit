import { Component } from 'react';

/*
 * The last line of defence. If drawing the app ever throws, React would
 * otherwise unmount everything and leave a blank page, with no way to get at
 * the data behind it. This shows what happened instead, says plainly that
 * nothing has been deleted, and offers a copy of everything saved, exactly as
 * it is stored, before trying again.
 *
 * It never touches storage. While nothing is wrong it renders the app as it
 * is, and changes nothing.
 */

const PREFIX = 'orbit:';

// Every saved value, as the raw text it is stored as, so nothing is
// reinterpreted on the way out.
const savedCopy = () => {
  const out = {};
  const store = window.localStorage;
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key && key.startsWith(PREFIX)) out[key.slice(PREFIX.length)] = store.getItem(key);
  }
  return out;
};

const download = (name, text) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const button = {
  font: 'inherit', fontSize: 14, fontWeight: 600, padding: '9px 14px', borderRadius: 7,
  cursor: 'pointer', border: '1px solid #15211B', marginRight: 8, marginBottom: 8,
};

export default class Recovery extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, note: '' };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  save = () => {
    try {
      download('orbit-saved-data.json', JSON.stringify(savedCopy(), null, 2));
      this.setState({ note: 'Downloaded. Keep that file somewhere safe.' });
    } catch {
      this.setState({ note: 'This browser would not give up its saved data here.' });
    }
  };

  render() {
    const { error, note } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" style={{
        maxWidth: 460, margin: '0 auto', padding: '40px 16px', color: '#15211B', background: '#FBFDFB',
        fontFamily: "'Segoe UI', system-ui, sans-serif", lineHeight: 1.5,
      }}>
        <h1 style={{ fontSize: 24, margin: '0 0 10px', letterSpacing: '-0.02em' }}>Orbit hit a problem showing your data</h1>
        <p style={{ margin: '0 0 18px', fontSize: 15 }}>
          Nothing you saved has been deleted. Download a copy of everything saved in this browser
          first, then try again.
        </p>
        <button type="button" onClick={this.save} style={{ ...button, background: '#72DE88', color: '#15211B' }}>
          Download a copy
        </button>
        <button type="button" onClick={() => window.location.reload()} style={{ ...button, background: 'transparent' }}>
          Try again
        </button>
        {note && <p aria-live="polite" style={{ margin: '4px 0 0', fontSize: 14 }}>{note}</p>}
        <details style={{ marginTop: 22, fontSize: 13, color: '#5A6B60' }}>
          <summary style={{ cursor: 'pointer' }}>What went wrong</summary>
          <pre style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{String(error?.message || error)}</pre>
        </details>
      </div>
    );
  }
}
