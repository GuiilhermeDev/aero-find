# AeroFind

Buscador de promocoes de passagens com front-end estatico e funcoes serverless na Vercel.

## Requisitos

- Node.js 18 ou superior
- Conta na [Vercel](https://vercel.com/)
- Token da Travelpayouts

## Variaveis de ambiente

Crie um arquivo `.env.local` na raiz do projeto com base em [.env.local.example](C:/Users/guilh/Documents/2026/AeroFind/.env.local.example:1):

```env
TRAVELPAYOUTS_API_TOKEN=seu_token
TRAVELPAYOUTS_API_BASE_URL=https://api.travelpayouts.com/aviasales/v3
```

## Rodando localmente

```powershell
npm i -g vercel
vercel login
vercel dev
```

Depois abra:

- [http://localhost:3000](http://localhost:3000)

## Como validar se a API esta pronta

Abra:

- [http://localhost:3000/api/health](http://localhost:3000/api/health)

O retorno esperado e parecido com este:

```json
{
  "ok": true,
  "configured": true,
  "provider": "travelpayouts",
  "baseUrl": "https://api.travelpayouts.com/aviasales/v3"
}
```

Se `configured` vier como `false`, o token nao foi carregado.

## Observacao sobre os dados

Este projeto usa a Travelpayouts Data API, que trabalha com precos em cache baseados em buscas recentes. Ela e adequada para promocoes, tendencias e descoberta de tarifas, mas nao representa cotacao final em tempo real no mesmo nivel de uma busca live.

## Deploy na Vercel

No projeto da Vercel, configure:

- `TRAVELPAYOUTS_API_TOKEN`
- `TRAVELPAYOUTS_API_BASE_URL`
