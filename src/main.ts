import './style.css';
import { Game } from './game/game';

const root = document.getElementById('app')!;
new Game(root).start().catch((e) => {
  console.error(e);
  root.insertAdjacentHTML('beforeend', `<div class="fatal">Не удалось запустить игру: ${String(e?.message ?? e)}</div>`);
});
