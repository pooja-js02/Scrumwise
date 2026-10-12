// Runs this micro-frontend on its own, without the shell: npm run standalone -w @scrumwise/workspace-app
import '@scrumwise/ui/styles.css';
import { mount } from './remote.jsx';

const params = Object.fromEntries(new URLSearchParams(location.search));
mount(document.getElementById('root'), params);
