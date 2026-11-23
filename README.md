# Shine Shop ✦

Веб-прототип мобильной игры: расслабляющая ASMR-реставрация старых вещей с прокачкой и автоматизацией (idle).
Вертикальный экран 9:16, касания и мышь. TypeScript + Three.js + Vite + Vitest.

**Играть:** https://nikolay-inc.github.io/shine-shop/

## Как играть

- **Палец по предмету** — чистка. **По пустому месту** — вращение. **Щипок / колесо мыши** — приближение.
- Грязь двух слоёв: **пыль** снимает любой инструмент, **ржавчину/налёт** — щётка и выше (губкой — очень медленно).
- На **97 %** — автодочистка, искры, звон и «до/после». Продаём → монеты. 1 из 20 предметов — **золотая находка ×5**.
- Инструменты: губка → щётка → мойка высокого давления → лазер; скины за монеты.
- Помощники (верстак-автомат, робот-полировщик) чистят сами — видно в левом верхнем углу; работают и без тебя до 2 часов.
- «Коллекция» — карточки восстановленных предметов и редкости. «Статистика» — сводка и лог событий с кнопкой «Скопировать».

## Команды

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # тесты экономики, сохранений, лога и темпа
npm run sim        # симуляция первых 30 минут
npm run build
```

## Модели (Poly Haven, CC0)

Модели уже лежат в `public/models`: 24 файла (~8 МБ, meshopt + webp, текстуры 1k, до 15k полигонов),
из них 26 предметов — из чайного набора берутся отдельно чашка, сахарница и чайник, из набора кубков — один кубок.
Предметы в реальном масштабе (Poly Haven — метры): размер виден по подставке, доскам стола и подписи «≈ N см».
Перекачать:

```bash
npm run models
```

Скрипт `scripts/fetch-models.mjs` берёт файлы через публичный API `https://api.polyhaven.com/files/<id>` и сжимает
`gltf-transform optimize --compress meshopt --texture-compress webp --texture-size 1024` (+ упрощение до 15k полигонов).

| Предмет | Ключ модели | Poly Haven (CC0) |
|---|---|---|
| Карманные часы | `watch` | [pocket_watch](https://polyhaven.com/a/pocket_watch) |
| Морской компас | `compass` | [seadogs_compass](https://polyhaven.com/a/seadogs_compass) |
| Лупа | `magnifier` | [magnifying_glass_01](https://polyhaven.com/a/magnifying_glass_01) |
| Резной слоник | `elephant` | [carved_wooden_elephant](https://polyhaven.com/a/carved_wooden_elephant) |
| Чайная чашка | `teaset` | [tea_set_01](https://polyhaven.com/a/tea_set_01) |
| Плоскогубцы | `pliers` | [pliers](https://polyhaven.com/a/pliers) |
| Сахарница | `teaset` | [tea_set_01](https://polyhaven.com/a/tea_set_01) |
| Латунная вазочка | `brassvase` | [brass_vase_04](https://polyhaven.com/a/brass_vase_04) |
| Кузнечный молоток | `hammer` | [cross_pein_hammer](https://polyhaven.com/a/cross_pein_hammer) |
| Латунный кубок | `goblets` | [brass_goblets](https://polyhaven.com/a/brass_goblets) |
| Молочник | `jug` | [jug_01](https://polyhaven.com/a/jug_01) |
| Маслёнка | `oilcan` | [small_oil_can_01](https://polyhaven.com/a/small_oil_can_01) |
| Разводной ключ | `wrench` | [adjustable_wrench](https://polyhaven.com/a/adjustable_wrench) |
| Заварочный чайник | `teaset` | [tea_set_01](https://polyhaven.com/a/tea_set_01) |
| Бинокль | `binocular` | [vintage_binocular](https://polyhaven.com/a/vintage_binocular) |
| Металлический кувшин | `metaljug` | [metal_jug](https://polyhaven.com/a/metal_jug) |
| Латунный котелок | `kettle` | [brass_pot_02](https://polyhaven.com/a/brass_pot_02) |
| Бронзовый конь | `horse` | [horse_statue_01](https://polyhaven.com/a/horse_statue_01) |
| Старинная ваза | `vase` | [antique_ceramic_vase_01](https://polyhaven.com/a/antique_ceramic_vase_01) |
| Фонарь | `lantern` | [Lantern_01](https://polyhaven.com/a/Lantern_01) |
| Фотоаппарат | `camera` | [Camera_01](https://polyhaven.com/a/Camera_01) |
| Ручная дрель | `drill` | [vintage_hand_drill](https://polyhaven.com/a/vintage_hand_drill) |
| Микроскоп | `microscope` | [vintage_microscope](https://polyhaven.com/a/vintage_microscope) |
| Каминные часы | `mantelclock` | [mantel_clock_01](https://polyhaven.com/a/mantel_clock_01) |
| Керосиновая лампа | `oillamp` | [vintage_oil_lamp](https://polyhaven.com/a/vintage_oil_lamp) |
| Старый сундук | `chest` | [treasure_chest](https://polyhaven.com/a/treasure_chest) |

**Без сети:** положите файлы `<ключ>.glb` в `public/models/` и опишите их в `public/models/manifest.json`
(ключи — поле `model` в `src/core/config.ts`; для наборов предмет выбирает узлы по именам, поле `nodes`):

```json
{ "models": { "lantern": { "file": "lantern.glb" } } }
```

Если модели или манифеста нет — игра использует процедурные запасные предметы (LatheGeometry и примитивы), всё
работает сразу; при появлении сети модель подгрузится при следующем показе предмета.
Любая модель с UV подходит: игра сама строит атлас маски (разреженные UV переупаковывает), находит видимые снаружи
поверхности и генерирует грязь шумом.

## Как устроена чистка

1. Raycast (three-mesh-bvh) в точку касания → точка на поверхности.
2. 3D-кисть: все тексели маски (canvas 512²), чья точка поверхности в радиусе инструмента, получают «снято»
   (R — пыль, G — ржавчина). Маска лежит в собственном UV-атласе `maskUv`, поэтому работает на любой модели.
3. Шейдер (патч `MeshStandardMaterial`) смешивает чистый материал с процедурной пылью и ржавчиной по маске.
4. Видимость: предмет один раз рендерится с 40 направлений в id-буфер (каждый пиксель = тексель маски) —
   что не видно ни с одной стороны, в процент не входит.
5. Прогресс — по всем видимым текселям маски (80 % снято = чисто, ровно как показывает шейдер); на 97 % — автодочистка.

Устройство кода и правила — в [CLAUDE.md](CLAUDE.md).
