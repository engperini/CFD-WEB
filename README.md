# CFD-WEB | Data Hall MVP

Web app para modelagem parametrica de Data Hall controlado por interface grafica, texto e voz.

## Funcionalidades

- Sala parametrica com largura, comprimento e altura.
- Racks com largura, profundidade, altura, potencia, orientacao e posicao `x`, `y`, `z`.
- Fan walls com dimensoes, vazao, parede selecionada, orientacao e posicao `x`, `y`, `z`.
- Organizacao automatica em fileiras com corredores frios/quentes e afastamento das paredes.
- Canvas 2D com React Konva, arraste por mouse/touch e rotacao por duplo clique/toque.
- Validacao geometrica para limites da sala, altura e sobreposicoes.
- Desfazer, refazer, limpar layout, salvar JSON e carregar JSON.
- Indicadores de racks, fan walls, potencia total, area ocupada, ocupacao e alertas.
- Entrada por texto e voz com fluxo push-to-talk.

## Fluxo de Voz

1. O usuario pressiona e mantem pressionado o botao de microfone.
2. O navegador grava audio com `MediaRecorder`.
3. Ao soltar, a gravacao termina e o audio e enviado ao backend.
4. O backend envia o audio para a API de transcricao da OpenAI.
5. A transcricao aparece na interface.
6. O texto transcrito e enviado ao backend para interpretacao pela OpenAI Responses API.
7. O backend valida os comandos JSON com Zod antes de devolver ao frontend.
8. O frontend valida novamente e aplica os comandos no motor geometrico.

A Realtime API nao e usada. `OPENAI_API_KEY` permanece somente no backend.

## Comandos Estruturados

- `create_room`
- `resize_room`
- `add_racks`
- `create_rack_rows`
- `add_fan_walls`
- `move_element`
- `rotate_element`
- `set_aisle_width`
- `set_wall_clearance`
- `auto_arrange`
- `delete_element`
- `clear_layout`
- `undo`
- `redo`

## Arquitetura

```text
React + TypeScript + Vite
        |
React Konva canvas 2D
        |
Estado centralizado em App
        |
Motor geometrico tipado em src/shared
        |
Backend Node.js + TypeScript + Zod
        |
OpenAI Audio Transcriptions + Responses API
```

O modelo ja inclui `x`, `y`, `z`, largura, profundidade, altura e rotacao para cada elemento, preparando a evolucao para 3D e CFD.

## Instalar

Requisito: Node.js 20.11 ou superior.

```bash
npm install
cp .env.example .env
```

Edite `.env` e informe:

```env
OPENAI_API_KEY=
OPENAI_TEXT_MODEL=gpt-5-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
PORT=3000
```

Nao versione `.env`.

## Executar

Para desenvolvimento com proxy Vite:

```bash
npm run dev
npm run dev:client
```

Abra `http://localhost:5173`.

Para build de producao:

```bash
npm run build
npm start
```

Abra `http://localhost:3000`.

## Testes

```bash
npm test
```

Os testes unitarios cobrem auto-arranjo, comandos estruturados, limites da sala e deteccao de sobreposicao.
