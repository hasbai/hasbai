import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
document.documentElement.classList.toggle('dark',matchMedia('(prefers-color-scheme: dark)').matches);
mount(App, { target: document.getElementById('app')! });
