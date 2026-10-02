# DSH plugins

Четыре независимых пакета для Web-интерфейса DeepSeek Harness `0.2.0-rc.2`:

| Пакет | Что добавляет |
| --- | --- |
| [locale-ru](plugins/locale-ru/README.md) | Русский язык в штатном переключателе. |
| [personal-memory](plugins/personal-memory/README.md) | Общую для Host долговременную память пользователя и агента. |
| [artifact-download](plugins/artifact-download/README.md) | Поштучное скачивание файлов из `present` и ревью «Изменено». |
| [weather-forecast](plugins/weather-forecast/README.md) | Текстовый прогноз wttr.in и проверку регистрации инструмента до первого хода модели. |

Перед отправкой изменений выполните [проверку публикации](AGENTS.md#проверка-перед-отправкой).

## Подготовка среды

Каталог хранит исходники плагинов и не содержит данных профиля. `DSH_SOURCE_ROOT` указывает на отдельный, предварительно подготовленный checkout [официального DSH](https://github.com/deepseek-ai/deepseek-harness) версии `0.2.0-rc.2` с установленными зависимостями и готовой сборкой. Первоначальная подготовка DSH (`pnpm install`, `pnpm run build`) и его обновление — отдельные задачи; повторять их для обычной правки плагина не требуется. Скрипты сборки плагинов используют готовые зависимости DSH и создают `lib` внутри соответствующего пакета.

```powershell
$env:DSH_SOURCE_ROOT = '<абсолютный-путь-к-подготовленному-checkout-DSH>'
```

## Проверки

Команды из корня каталога выбираются по задаче, а не выполняются обязательной последовательностью:

| Команда | Что выполняет |
| --- | --- |
| `node scripts/check.mjs` | Проверяет только локализацию и актуальность примеров; пишет `plugins/locale-ru/coverage.json`. Примеры не перезаписывает. |
| `node scripts/typecheck.mjs` | Проверяет типы четырёх пакетов через готовые declarations DSH; создаёт и удаляет временную конфигурацию в пакете. |
| `node scripts/test.mjs` | Копирует три исходных пакета в `DSH_SOURCE_ROOT/plugins`, запускает их тесты и удаляет временную копию. Погодный пакет проверяется отдельно командой из его README. |

Тестовый скрипт пишет временные копии плагинов в `DSH_SOURCE_ROOT/plugins`. Используйте отдельный чистый тестовый checkout DSH, а не рабочий checkout. При существующем каталоге `plugins` скрипт откажется от запуска.

## Сборка и упаковка

Из корня каталога запускайте команды только нужного пакета:

```powershell
node plugins/personal-memory/scripts/pack.mjs
node plugins/artifact-download/scripts/pack.mjs
node plugins/weather-forecast/scripts/pack.mjs
```

Команды `personal-memory` и `artifact-download` сами собирают Host и Client перед упаковкой; `weather-forecast` собирает только Host. Для `locale-ru` сборка пока выполняется отдельно:

```powershell
node plugins/locale-ru/scripts/build.mjs
node plugins/locale-ru/scripts/pack.mjs
```

Общие `node scripts/build.mjs` и `node scripts/pack.mjs` обрабатывают все четыре пакета. Последовательность общего `build` и общего `pack` повторно собирает `personal-memory`, `artifact-download` и `weather-forecast`. Архивы `.tgz` создаются локально в `plugins/<пакет>/artifacts` и не отслеживаются Git.

## Установка и данные профиля

Следуйте установке в README нужного пакета. Перед установкой задайте `DSH_HOME` абсолютным путём к используемому профилю; установка меняет этот профиль. Установка четырёх пакетов вместе не обязательна.

`DSH_HOME` содержит постоянные настройки, credentials, сессии и хранилища. Не добавляйте его содержимое в Git и не удаляйте как временный кеш.

`personal-memory` хранит записи общими для всех пользователей одного Host с одним `DSH_HOME`. Для общего сервера это требует отдельного решения о допустимости такого доступа.
