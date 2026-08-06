# CFD-WEB — Data Hall AI Modeler

MVP de um modelador paramétrico de data hall controlado por formulário, texto e voz.

O usuário pressiona e segura o botão de microfone, fala a instrução e solta. O navegador envia o áudio ao servidor, o servidor transcreve pela API de áudio da OpenAI e envia a transcrição para um modelo de linguagem. A IA devolve ações estruturadas, validadas pelo servidor, e a planta 2D é atualizada automaticamente.

## Funcionalidades atuais

- Sala paramétrica: largura, comprimento e altura.
- Racks: quantidade, fileiras, dimensões e potência térmica.
- Fan walls: quantidade, parede, largura e vazão.
- Corredores frio/quente e afastamento perimetral.
- Organização automática básica.
- Entrada de comando por texto.
- Push-to-talk com `MediaRecorder`.
- Transcrição automática após soltar o botão.
- Interpretação por IA com ações permitidas e sanitizadas.
- Planta SVG com seleção e arraste manual.
- Indicadores de potência, vazão, densidade e ocupação.
- Alertas geométricos básicos.
- Desfazer, refazer, persistência local e exportação JSON.

## Executar localmente

Requisito: Node.js 20.11 ou superior.

```bash
cp .env.example .env
# edite .env e informe OPENAI_API_KEY
npm start
```

Abra `http://localhost:3000`.

O servidor lê o arquivo `.env` diretamente, portanto não há dependências npm nesta primeira versão.

## Variáveis de ambiente

```env
OPENAI_API_KEY=
OPENAI_TEXT_MODEL=gpt-5-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
PORT=3000
```

A chave da OpenAI é usada somente no servidor e nunca é enviada ao navegador.

## Testes

```bash
npm test
```

## Comandos de voz esperados

- “Crie uma sala de 24 por 18 metros e 5 metros de altura.”
- “Coloque 32 racks de 600 milímetros em quatro fileiras, com 40 kW por rack.”
- “Instale seis fan walls na parede sul.”
- “Use corredor frio de 1,2 metro e corredor quente de 1 metro.”
- “Limpe os racks.”
- “Organize o layout priorizando manutenção.”

## Arquitetura

```text
Microfone no navegador
        ↓
POST /api/transcribe
        ↓
OpenAI Audio Transcriptions
        ↓
POST /api/interpret
        ↓
OpenAI Responses API
        ↓
Ações estruturadas e sanitizadas
        ↓
Motor geométrico
        ↓
Planta SVG + modelo JSON
```

## Próximas etapas

1. Criar zonas restritas, portas e pilares.
2. Melhorar o solucionador de layout com restrições e múltiplos objetivos.
3. Adicionar relações espaciais por seleção: “mova esta fileira”.
4. Incluir equipamentos elétricos, CDUs e tubulações.
5. Criar visualização 3D a partir do mesmo modelo JSON.
6. Exportar geometrias para preparação de CFD/OpenFOAM.
7. Adicionar autenticação e armazenamento de projetos no backend.
