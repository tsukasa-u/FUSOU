import '@builder.io/qwik/qwikloader.js'

import { render } from '@builder.io/qwik'

import './index.css'

import { component$, useStyles$, useVisibleTask$ } from '@builder.io/qwik'
import globalStyles from './tailwind.css?inline';

import { invoke } from '@tauri-apps/api/tauri'

// import 'tachyons';
import './app.css';

const Splash = component$(() => {
  useStyles$(globalStyles);

  useVisibleTask$(() => {
    invoke('show_splashscreen')
  });

  return (
    <>
      <h1> FUDOU </h1>
    </>
  )
});

render(document.getElementById('app') as HTMLElement, <Splash />)