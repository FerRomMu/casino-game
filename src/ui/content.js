import { validateConfig } from '../domain/config.js';

export function translator(strings, { production = false } = {}) {
  return key => {
    if (Object.hasOwn(strings, key)) return strings[key];
    return production ? '' : `MISSING:${key}`;
  };
}

export async function loadContent() {
  async function load(name) {
    const response = await fetch(new URL(`../../content/${name}.json`, import.meta.url));
    if (!response.ok) throw new Error(`CONTENT_HTTP:${name}:${response.status}`);
    return response.json();
  }
  const [config, strings, wheel1, wheel2] = await Promise.all([
    load('game.config'), load('strings'), load('cards_wheel_1'), load('cards_wheel_2')
  ]);
  const decks = { wheel_1: wheel1, wheel_2: wheel2 };
  validateConfig(config, decks);
  // The production build injects this marker; development stays deliberately visible.
  const production = document.documentElement.dataset.build === 'production';
  const t = translator(strings, { production });
  return { config, decks, t };
}
